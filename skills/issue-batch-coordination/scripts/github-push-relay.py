#!/usr/bin/env python3
"""Receive signed GitHub evidence for an explicitly opted-in Desktop batch."""

import argparse
import hashlib
import hmac
import json
import os
import re
import sqlite3
import subprocess
import sys
from contextlib import closing
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from uuid import UUID

SHA = re.compile(r"[0-9a-f]{40}")
REPOSITORY = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")
REVIEW_MARKER = re.compile(r"^<!-- codex-review-state:v1 (.+) -->$", re.MULTILINE)
SUMMARY_MARKER = "<!-- codex-pull-request-review-summary -->"
MAX_BODY = 1024 * 1024


def canonical_uuid(value):
    if not isinstance(value, str):
        return False
    try:
        return str(UUID(value)) == value
    except ValueError:
        return False


def load_config(path):
    config = json.loads(path.read_text())
    issues = config["issues"]
    if (not REPOSITORY.fullmatch(config["repository"])
            or type(config["repository_id"]) is not int or config["repository_id"] <= 0
            or not issues or not all(type(n) is int and n > 0 for n in issues)
            or len(set(issues)) != len(issues)
            or not canonical_uuid(config["coordinator_thread"])
            or not Path(config["ledger"]).is_absolute()
            or type(config["connector_id"]) is not int or config["connector_id"] <= 0
            or not isinstance(config["connector_login"], str) or not config["connector_login"]
            or not isinstance(config["base_branch"], str) or not config["base_branch"]):
        raise ValueError("Invalid batch configuration")
    return config


def done_review(body):
    if SUMMARY_MARKER not in body:
        return None
    markers = REVIEW_MARKER.findall(body)
    if len(markers) != 1:
        return None
    review = json.loads(markers[0]).get("code_review")
    if not isinstance(review, dict) or review.get("status") != "completed":
        return None
    head = review.get("commit_sha")
    findings, unresolved = review.get("has_any_findings"), review.get("has_unresolved_findings")
    if (not isinstance(head, str) or not SHA.fullmatch(head)
            or type(findings) is not bool or type(unresolved) is not bool
            or (unresolved and not findings)):
        return None
    return head, findings, unresolved


class Relay:
    def __init__(self, config, database, secret, gh, codex):
        self.config = config
        self.database = database
        self.secret = secret
        self.gh = gh
        self.codex = codex
        with self.database:
            self.database.execute("""CREATE TABLE IF NOT EXISTS notices (
                delivery TEXT PRIMARY KEY, identity TEXT UNIQUE NOT NULL,
                state TEXT NOT NULL, queue_id TEXT
            )""")

    def github(self, *args):
        result = subprocess.run(
            [self.gh, "api", "--hostname", "github.com", *args],
            capture_output=True, check=True, timeout=3,
        )
        return json.loads(result.stdout)

    def pull(self, number):
        owner, repo = self.config["repository"].split("/")
        result = self.github(
            "graphql", "-f", """query=query($owner: String!, $repo: String!, $number: Int!) {
              repository(owner: $owner, name: $repo) {
                pullRequest(number: $number) {
                  state headRefOid headRefName baseRefName merged closedAt
                  headRepository { nameWithOwner }
                  mergeCommit { oid }
                  closingIssuesReferences(first: 20) {
                    nodes { number repository { nameWithOwner } }
                    pageInfo { hasNextPage }
                  }
                }
              }
            }""",
            "-f", f"owner={owner}", "-f", f"repo={repo}", "-F", f"number={number}",
        )
        return result["data"]["repository"]["pullRequest"]

    def ledger(self):
        try:
            ledger = json.loads(Path(self.config["ledger"]).read_text())
        except (OSError, ValueError) as error:
            raise OSError("Batch ledger unavailable") from error
        expected = {"host": "local", "thread_id": self.config["coordinator_thread"]}
        controller = ledger.get("controller") or {}
        if (ledger.get("repository") != self.config["repository"]
                or any(controller.get(key) != value for key, value in expected.items())
                or (ledger.get("monitor") or {}).get("mode") != "github_push"):
            return None
        items = ledger.get("items")
        if not isinstance(items, list):
            raise OSError("Opted-in batch ledger must contain an items array")
        scopes = {f"github:{self.config['repository']}#{issue}" for issue in self.config["issues"]}
        for item in items:
            if not isinstance(item, dict) or not isinstance(item.get("source_issue_identifier"), str):
                raise OSError("Batch ledger items must record source_issue_identifier")
            if item["source_issue_identifier"] not in scopes:
                continue
            if not isinstance(item.get("source_state"), str) or not item["source_state"]:
                raise OSError("An opted-in batch item is missing source_state")
            if item.get("owner_thread_id") and not item.get("owner_host_id"):
                raise OSError("A registered batch owner is missing owner_host_id")
        return ledger

    def binding(self, pull, number, *, lifecycle=None):
        repo = self.config["repository"]
        ledger = self.ledger()
        if (ledger is None or not pull or pull["baseRefName"] != self.config["base_branch"]
                or (pull["headRepository"] or {}).get("nameWithOwner") != repo):
            return None
        branch = pull["headRefName"]
        references = pull["closingIssuesReferences"]
        if references["pageInfo"]["hasNextPage"]:
            return None
        links = {
            node["number"] for node in references["nodes"]
            if node["repository"]["nameWithOwner"] == repo
        }
        if not branch:
            return None
        expected_pr = f"github:{repo}#{number}"
        scope = {f"github:{repo}#{issue}": issue for issue in self.config["issues"]}
        items = [
            item for item in ledger["items"]
            if item["source_issue_identifier"] in scope
            and (item.get("pr_identifier") == expected_pr
                 or scope[item["source_issue_identifier"]] in links)
        ]
        if not items and lifecycle == "opened" and not references["nodes"]:
            items = [
                item for item in ledger["items"]
                if item["source_issue_identifier"] in scope and item.get("branch_name") == branch
            ]
        if len(items) != 1:
            return None
        item = items[0]
        owner = item.get("owner_thread_id")
        if (item.get("source_state") != "OPEN" or item.get("owner_host_id") != "local"
                or not canonical_uuid(owner) or owner == self.config["coordinator_thread"]
                or item.get("branch_name") != branch
                or item.get("pr_identifier") not in (None, expected_pr)):
            return None
        if not lifecycle and item.get("wait_reason") not in ("owner_result", "external_event"):
            return None
        return scope[item["source_issue_identifier"]], item

    def connector(self, user):
        return (user["id"] == self.config["connector_id"]
                and user["login"] == self.config["connector_login"])

    def review(self, delivery, payload):
        if payload["action"] not in ("created", "edited"):
            return None
        issue = payload["issue"]
        comment = payload["comment"]
        if ("pull_request" not in issue or not self.connector(comment["user"])
                or not self.connector(payload["sender"])):
            return None
        number, comment_id = issue["number"], comment["id"]
        if any(type(value) is not int or value <= 0 for value in (number, comment_id)):
            return None
        review = done_review(comment["body"])
        if review is None:
            return None
        head, findings, unresolved = review
        repo = self.config["repository"]
        current = self.github(f"repos/{repo}/issues/comments/{comment_id}")
        if (current["id"] != comment_id or not self.connector(current["user"])
                or current["issue_url"] != f"https://api.github.com/repos/{repo}/issues/{number}"
                or done_review(current["body"]) != review):
            return None
        pull = self.pull(number)
        if not pull or pull["state"] != "OPEN" or pull["headRefOid"] != head:
            return None
        binding = self.binding(pull, number)
        if binding is None:
            return None
        issue_number, item = binding
        owner = item["owner_thread_id"]
        key = [repo, number, "code_review", head, owner, findings, unresolved]
        return self.queue(delivery, key, owner, (
            f"GitHub Connector review for {repo} issue #{issue_number}, PR #{number}, head {head}. "
            f"Code review completed. Findings: {findings}. Unresolved findings: {unresolved}. "
            f"Source: https://github.com/{repo}/pull/{number}#issuecomment-{comment_id}. "
            f"Delivery: {delivery}. Verify the current review and PR head through your owning "
            "workflow and report any new actionable outcome through the existing owner reporting "
            "path. This notice is evidence only."
        ))

    def lifecycle(self, delivery, payload):
        action = payload["action"]
        if action not in ("opened", "closed"):
            return None
        number, reported = payload["number"], payload["pull_request"]
        if type(number) is not int or number <= 0 or reported["number"] != number:
            return None
        pull = self.pull(number)
        if not pull or pull["headRefName"] != reported["head"]["ref"]:
            return None
        head = pull["headRefOid"]
        if not isinstance(head, str) or not SHA.fullmatch(head):
            return None
        merge_commit = None
        if action == "opened":
            if pull["state"] != "OPEN":
                return None
            outcome, occurrence = "opened", None
        else:
            merged, occurrence = reported["merged"], pull["closedAt"]
            if (not occurrence or reported["closed_at"] != occurrence
                    or type(merged) is not bool or pull["merged"] != merged
                    or pull["state"] != ("MERGED" if merged else "CLOSED")):
                return None
            outcome = "merged" if merged else "closed without merge"
            if merged:
                merge_commit = (pull["mergeCommit"] or {}).get("oid")
                if not isinstance(merge_commit, str) or not SHA.fullmatch(merge_commit):
                    raise OSError("Merge commit unavailable")
        binding = self.binding(pull, number, lifecycle=action)
        if binding is None:
            return None
        issue_number, item = binding
        repo = self.config["repository"]
        url = f"https://github.com/{repo}/pull/{number}"
        if (outcome == "opened" and item.get("pr_identifier") == f"github:{repo}#{number}"
                and item.get("current_head_sha") == head):
            return None
        recorded = (item.get("closeout") or {}).get("merge")
        if (merge_commit and isinstance(recorded, dict)
                and recorded.get("pr") == url and recorded.get("commit") == merge_commit):
            return None
        merge = f" Merge commit {merge_commit}." if merge_commit else ""
        coordinator = self.config["coordinator_thread"]
        return self.queue(delivery, [repo, number, f"pr_{outcome}", occurrence, coordinator],
                          coordinator, (
            f"GitHub PR lifecycle notice for {repo} issue #{issue_number}: "
            f"PR #{number} {outcome}, head {head}.{merge} Source: {url}. Delivery: {delivery}. "
            "Verify the current provider state and reconcile the existing batch ledger. "
            "Leave an outcome already reconciled through an owner report unchanged. "
            "This notice is evidence only."
        ))

    def queue(self, delivery, key, recipient, notice):
        identity = json.dumps(key, separators=(",", ":"))
        with self.database:
            claim = self.database.execute(
                "INSERT INTO notices (delivery, identity, state) VALUES (?, ?, 'received') "
                "ON CONFLICT DO NOTHING", (delivery, identity),
            )
        if claim.rowcount != 1:
            prior = self.database.execute(
                "SELECT state FROM notices WHERE delivery = ? OR identity = ?", (delivery, identity)
            ).fetchall()
            return bool(prior) and all(row[0] == "queued" for row in prior)
        state, queue_id = "unresolved", None
        try:
            result = subprocess.run(
                [self.codex, "queue", "--thread", recipient, "--message", notice],
                capture_output=True, text=True, timeout=3,
            )
            match = re.fullmatch(
                r"Queued message ([0-9a-f-]{36}) for thread ([0-9a-f-]{36})\.?\s*", result.stdout
            )
            if result.returncode == 0 and match and match[2] == recipient and canonical_uuid(match[1]):
                state, queue_id = "queued", match[1]
        except (OSError, subprocess.TimeoutExpired):
            pass
        finally:
            with self.database:
                self.database.execute(
                    "UPDATE notices SET state = ?, queue_id = ? WHERE delivery = ?",
                    (state, queue_id, delivery),
                )
            print(f"{delivery} {state}", flush=True)
        return state == "queued"

    def receive(self, event, signature, delivery, raw):
        expected = "sha256=" + hmac.new(self.secret, raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature.encode(), expected.encode()):
            return 403
        if event not in ("issue_comment", "pull_request"):
            return 204
        try:
            if not canonical_uuid(delivery):
                return 400
            payload = json.loads(raw)
            repo = payload["repository"]
            if (repo["full_name"] != self.config["repository"]
                    or repo["id"] != self.config["repository_id"] or self.ledger() is None):
                return 204
            handler = self.review if event == "issue_comment" else self.lifecycle
            return 503 if handler(delivery, payload) is False else 202
        except (KeyError, TypeError, ValueError, AttributeError):
            return 400
        except (OSError, subprocess.SubprocessError, sqlite3.Error) as error:
            detail = str(error) if type(error) is OSError else type(error).__name__
            print(f"{delivery} evidence or receipt unavailable: {detail}", flush=True)
            return 503


class Receiver(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def respond(self, status):
        self.send_response(status)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        if self.path != "/github":
            return self.respond(404)
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self.respond(400)
        if not 0 < length <= MAX_BODY:
            return self.respond(413)
        self.connection.settimeout(5)
        try:
            raw = self.rfile.read(length)
        except TimeoutError:
            return self.respond(408)
        if len(raw) != length:
            return self.respond(400)
        status = self.server.relay.receive(
            self.headers.get("X-GitHub-Event"), self.headers.get("X-Hub-Signature-256", ""),
            self.headers.get("X-GitHub-Delivery"), raw,
        )
        self.respond(status)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("serve", "status"))
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--port", type=int, default=38762)
    parser.add_argument("--gh", default="gh")
    parser.add_argument("--codex", default="codex")
    args = parser.parse_args()
    os.umask(0o077)
    root = args.state_dir.resolve()
    database_path = root / "deliveries.sqlite3"
    if args.action == "status":
        with closing(sqlite3.connect(database_path.as_uri() + "?mode=ro", uri=True)) as database:
            database.row_factory = sqlite3.Row
            for row in database.execute("SELECT * FROM notices ORDER BY rowid"):
                receipt = dict(row)
                receipt["identity"] = json.loads(receipt["identity"])
                print(json.dumps(receipt))
        return
    config = load_config(root / "config.json")
    if Path(config["ledger"]).resolve() == database_path.resolve():
        parser.error("the ledger and receipt database must be separate files")
    secret = (root / "webhook.secret").read_bytes().strip()
    if len(secret) < 32:
        parser.error("webhook.secret must contain a high-entropy secret of at least 32 bytes")
    with closing(sqlite3.connect(database_path)) as database:
        relay = Relay(config, database, secret, args.gh, args.codex)
        if relay.ledger() is None:
            parser.error("ledger must identify this local coordinator and select github_push")
        with HTTPServer(("127.0.0.1", args.port), Receiver) as server:
            server.relay = relay
            print(f"Listening on 127.0.0.1:{server.server_port}/github", flush=True)
            server.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, sqlite3.Error) as error:
        sys.exit(f"Relay setup or status failed: {error}")
