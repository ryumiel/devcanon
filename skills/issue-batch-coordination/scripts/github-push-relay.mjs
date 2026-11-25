#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";

const execute = promisify(execFile);
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const sha = /^[0-9a-f]{40}$/;
const maxBody = 1024 * 1024;
const waits = new Set(["owner_result", "external_event"]);
const outcomes = new Set(["success", "failure", "cancelled"]);
const pullQuery = [
  "query=query($owner: String!, $repo: String!, $number: Int!) {",
  "repository(owner: $owner, name: $repo) { pullRequest(number: $number) {",
  "state headRefOid headRefName baseRefName merged closedAt",
  "headRepository { nameWithOwner } mergeCommit { oid }",
  "closingIssuesReferences(first: 20) {",
  "nodes { number repository { nameWithOwner } } pageInfo { hasNextPage }",
  "} } } }",
].join(" ");

function positive(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function matches(pattern, value) {
  return typeof value === "string" && pattern.test(value);
}

function text(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function validateConfig(config) {
  if (
    !matches(/^[\w.-]+\/[\w.-]+$/, config.repository) ||
    config.repository
      .split("/")
      .some((part) => part === "." || part === "..") ||
    !positive(config.repository_id) ||
    !matches(uuid, config.coordinator_thread) ||
    !text(config.base_branch) ||
    !positive(config.connector_id) ||
    !text(config.connector_login) ||
    (config.ci_workflow_id !== undefined && !positive(config.ci_workflow_id))
  ) {
    throw new Error("Invalid relay instance configuration");
  }
  return config;
}

function verdict(body) {
  if (!body.includes("<!-- codex-pull-request-review-summary -->")) return;
  const markers = [...body.matchAll(/^<!-- codex-review-state:v1 (.+) -->$/gm)];
  if (markers.length !== 1) return;
  const review = JSON.parse(markers[0][1]).code_review;
  if (
    review?.status !== "completed" ||
    !matches(sha, review.commit_sha) ||
    typeof review.has_any_findings !== "boolean" ||
    typeof review.has_unresolved_findings !== "boolean" ||
    (review.has_unresolved_findings && !review.has_any_findings)
  )
    return;
  return [
    review.commit_sha,
    review.has_any_findings,
    review.has_unresolved_findings,
  ];
}

export class Relay {
  constructor({ config, database, ledger, secret, gitHub, send }) {
    this.config = validateConfig(config);
    this.database = database;
    this.ledgerFile = ledger;
    this.secret = secret;
    this.gitHub = gitHub;
    this.send = send;
    this.database.exec(
      "PRAGMA busy_timeout = 2000;" +
        "CREATE TABLE IF NOT EXISTS binding (id INTEGER PRIMARY KEY CHECK (id = 1), identity TEXT NOT NULL);" +
        "CREATE TABLE IF NOT EXISTS notices (delivery TEXT PRIMARY KEY, identity TEXT UNIQUE NOT NULL," +
        " state TEXT NOT NULL, queue_id TEXT);",
    );
    const identity = JSON.stringify([
      ledger,
      config.repository,
      config.repository_id,
      config.coordinator_thread,
    ]);
    this.database
      .prepare("INSERT OR IGNORE INTO binding VALUES (1, ?)")
      .run(identity);
    if (
      this.database.prepare("SELECT identity FROM binding WHERE id = 1").get()
        .identity !== identity
    ) {
      throw new Error(
        "Receipt state belongs to a different ledger or coordinator",
      );
    }
  }

  ledger() {
    const ledger = readJson(this.ledgerFile);
    if (
      ledger.repository !== this.config.repository ||
      ledger.controller?.host !== "local" ||
      ledger.controller.thread_id !== this.config.coordinator_thread ||
      ledger.monitor?.mode !== "github_push"
    )
      return;
    if (!Array.isArray(ledger.items))
      throw new Error("Opted-in ledger is missing its items array");
    for (const item of ledger.items) {
      if (!text(item?.source_issue_identifier))
        throw new Error("Ledger item is missing its issue identity");
    }
    return ledger;
  }

  issueNumber(identifier) {
    const prefix = `github:${this.config.repository}#`;
    if (!identifier.startsWith(prefix)) return;
    const suffix = identifier.slice(prefix.length);
    const issue = Number(suffix);
    if (positive(issue) && String(issue) === suffix) return issue;
  }

  async pull(number) {
    const [owner, repo] = this.config.repository.split("/");
    const result = await this.gitHub(
      "graphql",
      "-f",
      pullQuery,
      "-f",
      `owner=${owner}`,
      "-f",
      `repo=${repo}`,
      "-F",
      `number=${number}`,
    );
    return result.data?.repository?.pullRequest;
  }

  binding(pull, number, lifecycle) {
    const ledger = this.ledger();
    const repo = this.config.repository;
    if (
      !ledger ||
      !pull ||
      pull.baseRefName !== this.config.base_branch ||
      pull.headRepository?.nameWithOwner !== repo ||
      !text(pull.headRefName)
    )
      return;
    const refs = pull.closingIssuesReferences;
    if (!refs || refs.pageInfo.hasNextPage) return;
    const linked = new Set(
      refs.nodes
        .filter((node) => node.repository.nameWithOwner === repo)
        .map((node) => node.number),
    );
    if (linked.size > 1) return;
    const expectedPr = `github:${repo}#${number}`;
    const batch = ledger.items.filter((item) =>
      this.issueNumber(item.source_issue_identifier),
    );
    let items = batch.filter(
      (item) =>
        item.pr_identifier === expectedPr ||
        linked.has(this.issueNumber(item.source_issue_identifier)),
    );
    if (
      items.length === 0 &&
      lifecycle === "opened" &&
      refs.nodes.length === 0
    ) {
      items = batch.filter((item) => item.branch_name === pull.headRefName);
    }
    if (items.length !== 1) return;
    const [item] = items;
    if (!text(item.source_state))
      throw new Error("Opted-in ledger item is missing its source state");
    if (item.owner_thread_id && !text(item.owner_host_id))
      throw new Error("Registered ledger owner is missing its host");
    const issue = this.issueNumber(item.source_issue_identifier);
    if (
      batch.filter(
        (entry) =>
          entry.source_issue_identifier === item.source_issue_identifier,
      ).length !== 1 ||
      (linked.size === 1 && !linked.has(issue)) ||
      item.source_state !== "OPEN" ||
      item.owner_host_id !== "local" ||
      !matches(uuid, item.owner_thread_id) ||
      item.owner_thread_id === this.config.coordinator_thread ||
      item.branch_name !== pull.headRefName ||
      (item.pr_identifier != null && item.pr_identifier !== expectedPr) ||
      (!lifecycle && !waits.has(item.wait_reason))
    )
      return;
    return { issue, item };
  }

  isConnector(user) {
    return (
      user?.id === this.config.connector_id &&
      user.login === this.config.connector_login
    );
  }

  async review(delivery, payload) {
    const { action, issue, comment, sender } = payload;
    if (
      (action !== "edited" && action !== "created") ||
      !issue?.pull_request ||
      !this.isConnector(comment?.user) ||
      !this.isConnector(sender)
    )
      return;
    const number = issue.number;
    if (
      !positive(number) ||
      !positive(comment.id) ||
      typeof comment.body !== "string"
    )
      return;
    const observed = verdict(comment.body);
    if (!observed) return;
    const [head, findings, unresolved] = observed;
    const repo = this.config.repository;
    const live = await this.gitHub(
      `repos/${repo}/issues/comments/${comment.id}`,
    );
    if (
      live.id !== comment.id ||
      !this.isConnector(live.user) ||
      live.issue_url !==
        `https://api.github.com/repos/${repo}/issues/${number}` ||
      JSON.stringify(verdict(live.body)) !== JSON.stringify(observed)
    )
      return;
    const pull = await this.pull(number);
    if (pull?.state !== "OPEN" || pull.headRefOid !== head) return;
    const binding = this.binding(pull, number);
    if (!binding) return;
    const owner = binding.item.owner_thread_id;
    return this.queue(
      delivery,
      [repo, number, "review", head, owner, findings, unresolved],
      owner,
      [
        `GitHub Connector review for ${repo} issue #${binding.issue}, PR #${number}, head ${head}.`,
        `Code review completed. Findings: ${findings}. Unresolved findings: ${unresolved}.`,
        `Source: https://github.com/${repo}/pull/${number}#issuecomment-${comment.id}.`,
        `Delivery: ${delivery}. Verify the current review and PR head through your owning workflow.`,
        "Report a new actionable outcome through the existing owner reporting path. This notice is evidence only.",
      ],
    );
  }

  async ci(delivery, payload) {
    const workflow = this.config.ci_workflow_id;
    const reported = payload.workflow_run;
    if (
      !workflow ||
      payload.action !== "completed" ||
      reported?.workflow_id !== workflow ||
      reported.event !== "pull_request" ||
      reported.status !== "completed" ||
      !outcomes.has(reported.conclusion) ||
      !positive(reported.id) ||
      !positive(reported.run_attempt) ||
      !matches(sha, reported.head_sha)
    )
      return;
    const {
      repository: repo,
      repository_id: repoId,
      base_branch: base,
    } = this.config;
    const {
      id: runId,
      run_attempt: attempt,
      head_sha: head,
      conclusion,
    } = reported;
    const run = await this.gitHub(`repos/${repo}/actions/runs/${runId}`);
    const evidence = [
      "id",
      "workflow_id",
      "event",
      "status",
      "conclusion",
      "run_attempt",
      "head_sha",
    ];
    if (
      evidence.some((key) => run[key] !== reported[key]) ||
      run.repository?.id !== repoId ||
      run.head_repository?.id !== repoId ||
      !text(run.head_branch)
    )
      return;
    const numbers = new Set(
      run.pull_requests
        .filter(
          (ref) =>
            positive(ref.number) &&
            ref.head.repo.id === repoId &&
            ref.head.sha === head &&
            ref.head.ref === run.head_branch &&
            ref.base.repo.id === repoId &&
            ref.base.ref === base,
        )
        .map((ref) => ref.number),
    );
    if (numbers.size !== 1) return;
    const [number] = numbers;
    const pull = await this.pull(number);
    if (
      pull?.state !== "OPEN" ||
      pull.headRefOid !== head ||
      pull.headRefName !== run.head_branch
    )
      return;
    const binding = this.binding(pull, number);
    if (!binding) return;
    const owner = binding.item.owner_thread_id;
    const result = {
      success: "passed",
      failure: "failed",
      cancelled: "cancelled",
    }[conclusion];
    return this.queue(
      delivery,
      [repo, number, "ci", head, owner, workflow, runId, attempt],
      owner,
      [
        `GitHub CI notice for ${repo} issue #${binding.issue}, PR #${number}, head ${head}.`,
        `CI ${result} for workflow run ${runId}, attempt ${attempt}.`,
        `Source: https://github.com/${repo}/actions/runs/${runId}/attempts/${attempt}.`,
        `Delivery: ${delivery}. Verify the current PR head and CI result through your owning workflow.`,
        "Report a new actionable outcome via the existing owner reporting path. This notice is evidence only.",
      ],
    );
  }

  async lifecycle(delivery, payload) {
    const { action, number, pull_request: reported } = payload;
    if (
      (action !== "opened" && action !== "closed") ||
      !positive(number) ||
      reported?.number !== number
    )
      return;
    const pull = await this.pull(number);
    if (
      !pull ||
      pull.headRefName !== reported.head?.ref ||
      !matches(sha, pull.headRefOid)
    )
      return;
    const head = pull.headRefOid;
    if (action === "opened" && pull.state !== "OPEN") return;
    let outcome = "opened";
    let occurrence = null;
    let commit;
    if (action === "closed") {
      const merged = reported.merged;
      occurrence = pull.closedAt;
      if (
        !text(occurrence) ||
        occurrence !== reported.closed_at ||
        typeof merged !== "boolean" ||
        pull.merged !== merged ||
        pull.state !== (merged ? "MERGED" : "CLOSED")
      )
        return;
      outcome = merged ? "merged" : "closed without merge";
      commit = merged ? pull.mergeCommit?.oid : undefined;
      if (merged && !matches(sha, commit))
        throw new Error("Merge commit unavailable");
    }
    const binding = this.binding(pull, number, action);
    if (!binding) return;
    const { issue, item } = binding;
    const repo = this.config.repository;
    const url = `https://github.com/${repo}/pull/${number}`;
    if (
      action === "opened" &&
      item.pr_identifier === `github:${repo}#${number}` &&
      item.current_head_sha === head
    )
      return;
    if (
      commit &&
      item.closeout?.merge?.pr === url &&
      item.closeout.merge.commit === commit
    )
      return;
    const coordinator = this.config.coordinator_thread;
    return this.queue(
      delivery,
      [repo, number, outcome, occurrence, coordinator],
      coordinator,
      [
        `GitHub PR lifecycle notice for ${repo} issue #${issue}: PR #${number} ${outcome}, head ${head}.`,
        ...(commit ? [`Merge commit ${commit}.`] : []),
        `Source: ${url}. Delivery: ${delivery}.`,
        "Verify current provider facts and reconcile the existing batch ledger.",
        "Leave outcomes already reconciled through an owner report unchanged. This notice is evidence only.",
      ],
    );
  }

  async queue(delivery, key, target, notice) {
    const identity = JSON.stringify(key);
    const claim = this.database
      .prepare(
        "INSERT OR IGNORE INTO notices (delivery, identity, state) VALUES (?, ?, 'received')",
      )
      .run(delivery, identity);
    if (claim.changes !== 1) {
      const rows = this.database
        .prepare("SELECT state FROM notices WHERE delivery = ? OR identity = ?")
        .all(delivery, identity);
      return rows.length > 0 && rows.every((row) => row.state === "queued");
    }
    let queueId = null;
    try {
      const stdout = await this.send(target, notice.join(" "));
      const match =
        /^Queued message ([0-9a-f-]+) for thread ([0-9a-f-]+)\.?\s*$/.exec(
          stdout,
        );
      if (match?.[2] === target && matches(uuid, match[1])) queueId = match[1];
    } catch {
      // The CLI may have submitted the notice before it failed.
    } finally {
      this.database
        .prepare(
          "UPDATE notices SET state = ?, queue_id = ? WHERE delivery = ?",
        )
        .run(queueId ? "queued" : "unresolved", queueId, delivery);
    }
    return queueId !== null;
  }

  async receive(event, signature, delivery, raw) {
    if (!matches(/^sha256=[0-9a-f]{64}$/, signature)) return 403;
    const expected = createHmac("sha256", this.secret).update(raw).digest();
    if (!timingSafeEqual(Buffer.from(signature.slice(7), "hex"), expected))
      return 403;
    const handlers = new Map([
      ["issue_comment", this.review],
      ["workflow_run", this.ci],
      ["pull_request", this.lifecycle],
    ]);
    const handler = handlers.get(event);
    if (!handler) return 204;
    if (!matches(uuid, delivery)) return 400;
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return 400;
    }
    if (
      payload?.repository?.id !== this.config.repository_id ||
      payload.repository.full_name !== this.config.repository
    )
      return 204;
    try {
      if (!this.ledger()) return 204;
      return (await handler.call(this, delivery, payload)) === false
        ? 503
        : 202;
    } catch (error) {
      // Keep provider output, credentials, and the signed body out of logs.
      console.error(
        delivery,
        "verification or receipt unavailable",
        error?.code ?? error?.name ?? "Error",
      );
      return 503;
    }
  }
}

export function listener(relay) {
  return createServer(
    { headersTimeout: 5000, requestTimeout: 10000 },
    async (request, response) => {
      if (request.method !== "POST" || request.url !== "/github") {
        response.writeHead(404).end();
        return;
      }
      const declared = request.headers["content-length"];
      if (!matches(/^\d+$/, declared) || Number(declared) === 0) {
        response.writeHead(400).end();
        return;
      }
      const length = Number(declared);
      if (length > maxBody) {
        response.writeHead(413, { Connection: "close" }).end();
        return;
      }
      const chunks = [];
      let size = 0;
      try {
        for await (const chunk of request) {
          size += chunk.length;
          if (size > length) {
            response.writeHead(400).end();
            return;
          }
          chunks.push(chunk);
        }
        if (size !== length) {
          response.writeHead(400).end();
          return;
        }
        const status = await relay.receive(
          request.headers["x-github-event"],
          request.headers["x-hub-signature-256"],
          request.headers["x-github-delivery"],
          Buffer.concat(chunks),
        );
        response.writeHead(status).end();
      } catch {
        if (!response.headersSent) response.writeHead(503);
        response.end();
      }
    },
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    if (args.length !== 1) {
      throw new Error("--help does not accept additional arguments");
    }
    const usage = new URL(
      "../references/github-push-relay-usage.md",
      import.meta.url,
    );
    const usagePath = fileURLToPath(usage);
    if (!lstatSync(usagePath, { throwIfNoEntry: false })?.isFile()) {
      throw new Error("Relay usage document missing or unreadable");
    }
    process.stdout.write(readFileSync(usage));
    return;
  }
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      ledger: { type: "string" },
      "state-dir": { type: "string" },
      port: { type: "string", default: "38762" },
      gh: { type: "string", default: "gh" },
      codex: { type: "string", default: "codex" },
    },
  });
  const [action] = positionals;
  if (
    positionals.length !== 1 ||
    !["serve", "status"].includes(action) ||
    !values.ledger ||
    !values["state-dir"]
  )
    throw new Error(
      "A serve or status action, --ledger, and --state-dir are required",
    );
  const port = Number(values.port);
  if (!/^\d+$/.test(values.port) || port < 1 || port > 65535)
    throw new Error("Invalid listener port");
  process.umask(0o077);
  const state = realpathSync(values["state-dir"]);
  const ledger = realpathSync(values.ledger);
  const receipt = path.join(state, "deliveries.sqlite3");
  if (
    ledger === receipt ||
    lstatSync(receipt, { throwIfNoEntry: false })?.isSymbolicLink()
  ) {
    throw new Error("The ledger and receipt database must be separate files");
  }
  const config = validateConfig(readJson(path.join(state, "config.json")));
  const { DatabaseSync } = await import("node:sqlite");
  if (action === "status") {
    const database = new DatabaseSync(receipt, { readOnly: true });
    try {
      const binding = database
        .prepare("SELECT identity FROM binding WHERE id = 1")
        .get()?.identity;
      if (
        binding !==
        JSON.stringify([
          ledger,
          config.repository,
          config.repository_id,
          config.coordinator_thread,
        ])
      ) {
        throw new Error(
          "Receipt state belongs to a different ledger or coordinator",
        );
      }
      for (const row of database
        .prepare("SELECT * FROM notices ORDER BY rowid")
        .all()) {
        console.log(
          JSON.stringify({ ...row, identity: JSON.parse(row.identity) }),
        );
      }
    } finally {
      database.close();
    }
    return;
  }
  const secret = readFileSync(
    path.join(state, "webhook.secret"),
    "utf8",
  ).trim();
  if (Buffer.byteLength(secret) < 32)
    throw new Error(
      "webhook.secret needs at least 32 bytes of high-entropy key material",
    );
  const database = new DatabaseSync(receipt);
  const relay = new Relay({
    config,
    database,
    ledger,
    secret,
    gitHub: async (...args) => {
      const { stdout } = await execute(
        values.gh,
        ["api", "--hostname", "github.com", ...args],
        { timeout: 3000 },
      );
      return JSON.parse(stdout);
    },
    send: async (target, message) => {
      const { stdout } = await execute(
        values.codex,
        ["queue", "--thread", target, "--message", message],
        { timeout: 3000 },
      );
      return stdout;
    },
  });
  if (!relay.ledger())
    throw new Error("Ledger must identify the opted-in local coordinator");
  listener(relay).listen(port, "127.0.0.1", () => {
    console.log(`Listening on 127.0.0.1:${port}/github`);
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  try {
    await main();
  } catch (error) {
    console.error("GitHub relay setup failed:", error.message);
    process.exitCode = 1;
  }
}
