import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  listener,
  Relay,
} from "../../skills/issue-batch-coordination/scripts/github-push-relay.mjs";

const repo = "example/project";
const repository = { id: 42, full_name: repo };
const connector = { id: 56, login: "connector[bot]" };
const head = "a".repeat(40);
const nextHead = "b".repeat(40);
const mergedHead = "c".repeat(40);
const script = fileURLToPath(
  new URL(
    "../../skills/issue-batch-coordination/scripts/github-push-relay.mjs",
    import.meta.url,
  ),
);
const stamp = "2026-11-22T01:00:00Z";
const id = (number) =>
  `c21b2039-727e-4361-8d2e-${String(number).padStart(12, "0")}`;

function fixture(t, issue, secret) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "devcanon-relay-")));
  const ledger = path.join(dir, "ledger.json");
  const database = new DatabaseSync(path.join(dir, "deliveries.sqlite3"));
  const thread = id(issue * 10);
  const owner = id(issue * 10 + 1);
  const number = issue + 100;
  const branch = `feat/${issue}-example`;
  const config = {
    repository: repo,
    repository_id: repository.id,
    issues: [issue],
    base_branch: "main",
    connector_id: connector.id,
    connector_login: connector.login,
    coordinator_thread: thread,
    ci_workflow_id: 55,
  };
  writeFileSync(path.join(dir, "config.json"), JSON.stringify(config));
  const item = {
    source_issue_identifier: `github:${repo}#${issue}`,
    source_state: "OPEN",
    owner_thread_id: owner,
    owner_host_id: "local",
    branch_name: branch,
    wait_reason: "external_event",
    pr_identifier: `github:${repo}#${number}`,
  };
  const ledgerContents = {
    repository: repo,
    controller: { host: "local", thread_id: thread },
    monitor: { mode: "github_push" },
    items: [item],
  };
  const saveLedger = () =>
    writeFileSync(ledger, JSON.stringify(ledgerContents));
  saveLedger();
  const pull = {
    headRefOid: head,
    headRefName: branch,
    baseRefName: "main",
    headRepository: { nameWithOwner: repo },
    state: "OPEN",
    closingIssuesReferences: {
      nodes: [{ number: issue, repository: { nameWithOwner: repo } }],
      pageInfo: { hasNextPage: false },
    },
  };
  const review = {
    status: "completed",
    commit_sha: head,
    has_any_findings: false,
    has_unresolved_findings: false,
  };
  const comment = {
    id: 57,
    user: connector,
    issue_url: `https://api.github.com/repos/${repo}/issues/${number}`,
  };
  const reviewEvent = (changes = {}) => {
    comment.body = [
      "<!-- codex-pull-request-review-summary -->",
      `<!-- codex-review-state:v1 ${JSON.stringify({ code_review: { ...review, ...changes } })} -->`,
    ].join("\n");
    return {
      repository,
      action: "edited",
      sender: connector,
      issue: { number, pull_request: {} },
      comment,
    };
  };
  const run = {
    id: 84,
    workflow_id: config.ci_workflow_id,
    event: "pull_request",
    status: "completed",
    conclusion: "failure",
    run_attempt: 1,
    head_sha: head,
    repository,
    head_repository: repository,
    head_branch: branch,
    pull_requests: [
      {
        number,
        head: { sha: head, repo: repository, ref: branch },
        base: { repo: repository, ref: "main" },
      },
    ],
  };
  const lifecycle = (action, merged = false) => ({
    repository,
    action,
    number,
    pull_request: {
      number,
      head: { ref: branch },
      merged,
      closed_at: stamp,
    },
  });
  const queries = [];
  const sent = [];
  const options = {
    config,
    database,
    ledger,
    secret,
    gitHub: async (endpoint, ...args) => {
      queries.push(endpoint);
      if (endpoint === "graphql") {
        const requested = args.at(-1);
        if (requested === `number=${number}`) {
          return { data: { repository: { pullRequest: pull } } };
        }
        return {};
      }
      if (endpoint === `repos/${repo}/issues/comments/${comment.id}`)
        return comment;
      if (endpoint === `repos/${repo}/actions/runs/${run.id}`) return run;
      throw new Error("Unexpected fixture GitHub request");
    },
    send: async (target, message) => {
      sent.push({ target, message });
      return `Queued message ${id(700)} for thread ${target}.\n`;
    },
  };
  const relay = new Relay(options);
  t.after(() => {
    database.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const sign = (raw) =>
    `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  return {
    relay,
    options,
    owner,
    thread,
    number,
    item,
    ledgerContents,
    saveLedger,
    pull,
    reviewEvent,
    run,
    lifecycle,
    queries,
    sent,
    sign,
    status: (pathOverride = ledger) =>
      execFileSync(
        process.execPath,
        [script, "status", "--ledger", pathOverride, "--state-dir", dir],
        { encoding: "utf8", stdio: "pipe" },
      ),
    receipts: () =>
      database
        .prepare("SELECT state, queue_id FROM notices ORDER BY rowid")
        .all(),
    deliver(event, delivery, payload) {
      const raw = Buffer.from(JSON.stringify(payload));
      return relay.receive(event, sign(raw), id(delivery), raw);
    },
  };
}

async function endpoint(t, instance) {
  const server = listener(instance.relay);
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  return `http://127.0.0.1:${server.address().port}/github`;
}

async function post(url, signer, event, delivery, payload) {
  const body = JSON.stringify(payload);
  return (
    await fetch(url, {
      method: "POST",
      headers: {
        "x-github-event": event,
        "x-github-delivery": id(delivery),
        "x-hub-signature-256": signer.sign(body),
      },
      body,
    })
  ).status;
}

test("signed deliveries stay within their coordinator instance and deduplicate concurrent review events", async (t) => {
  const alpha = fixture(t, 101, "alpha-fixture-key");
  const beta = fixture(t, 102, "beta-fixture-key");
  const [alphaUrl, betaUrl] = await Promise.all([
    endpoint(t, alpha),
    endpoint(t, beta),
  ]);
  const review = alpha.reviewEvent();
  assert.equal(await post(betaUrl, alpha, "issue_comment", 1, review), 403);
  assert.equal(beta.queries.length, 0);
  assert.equal(await post(betaUrl, beta, "issue_comment", 1, review), 202);
  assert.equal(beta.sent.length, 0);
  alpha.pull.closingIssuesReferences.nodes.push({
    number: 102,
    repository: { nameWithOwner: repo },
  });
  assert.equal(await post(alphaUrl, alpha, "issue_comment", 1, review), 202);
  assert.equal(alpha.sent.length, 0);
  alpha.pull.closingIssuesReferences.nodes.pop();
  const statuses = await Promise.all([
    post(alphaUrl, alpha, "issue_comment", 1, review),
    post(alphaUrl, alpha, "issue_comment", 2, review),
  ]);
  assert.deepEqual(statuses, [202, 202]);
  assert.equal(await post(alphaUrl, alpha, "issue_comment", 1, review), 202);
  assert.equal(alpha.sent.length, 1);
  assert.equal(alpha.sent[0].target, alpha.owner);
  assert.match(alpha.sent[0].message, new RegExp(head));
  assert.equal(alpha.receipts()[0].state, "queued");
  const receipt = JSON.parse(alpha.status());
  assert.equal(receipt.queue_id, id(700));
  assert.equal(receipt.identity[4], alpha.owner);
  assert.throws(
    () => alpha.status(beta.options.ledger),
    /different ledger or coordinator/,
  );

  delete beta.item.pr_identifier;
  beta.saveLedger();
  beta.pull.closingIssuesReferences.nodes = [];
  const opened = beta.lifecycle("opened");
  assert.equal(await post(betaUrl, beta, "pull_request", 3, opened), 202);
  assert.equal(beta.sent.length, 1);
  assert.equal(beta.sent[0].target, beta.thread);
  assert.match(beta.sent[0].message, /opened/);
  assert.throws(
    () => new Relay({ ...alpha.options, ledger: beta.options.ledger }),
    /different ledger or coordinator/,
  );
});

test("review skips stale heads, nonterminal verdicts, unrelated authors and inactive ledgers", async (t) => {
  const instance = fixture(t, 103, "review-fixture-key");
  instance.pull.headRefOid = nextHead;
  assert.equal(
    await instance.deliver("issue_comment", 5, instance.reviewEvent()),
    202,
  );
  instance.pull.headRefOid = head;
  assert.equal(
    await instance.deliver(
      "issue_comment",
      6,
      instance.reviewEvent({ status: "pending" }),
    ),
    202,
  );
  const wrongAuthor = {
    ...instance.reviewEvent(),
    sender: { ...connector, id: 1001 },
  };
  assert.equal(await instance.deliver("issue_comment", 7, wrongAuthor), 202);
  instance.ledgerContents.monitor.mode = "disabled";
  instance.saveLedger();
  assert.equal(
    await instance.deliver("issue_comment", 8, instance.reviewEvent()),
    204,
  );
  assert.equal(instance.sent.length, 0);
});

test("CI verifies the exact current PR head, then sends one failure or success per run attempt to the owner", async (t) => {
  const instance = fixture(t, 104, "ci-fixture-key");
  const event = (fields = {}) => ({
    action: "completed",
    repository,
    workflow_run: { ...instance.run, ...fields },
  });
  instance.pull.headRefOid = nextHead;
  assert.equal(await instance.deliver("workflow_run", 9, event()), 202);
  instance.pull.headRefOid = head;
  assert.equal(
    await instance.deliver("workflow_run", 10, event({ workflow_id: 99 })),
    202,
  );
  assert.equal(await instance.deliver("workflow_run", 11, event()), 202);
  assert.equal(await instance.deliver("workflow_run", 12, event()), 202);
  instance.run.run_attempt = 2;
  instance.run.conclusion = "success";
  assert.equal(
    await instance.deliver("workflow_run", 13, event({ run_attempt: 1 })),
    202,
  );
  assert.equal(await instance.deliver("workflow_run", 14, event()), 202);
  assert.equal(instance.sent.length, 2);
  assert.ok(instance.sent.every((notice) => notice.target === instance.owner));
  assert.match(instance.sent[0].message, /CI failed/);
  assert.match(instance.sent[1].message, /CI passed/);
});

test("cancelled CI wakes the bound owner only for matching current evidence", async (t) => {
  const instance = fixture(t, 107, "cancelled-ci-fixture-key");
  instance.run.conclusion = "cancelled";
  const event = (fields = {}) => ({
    action: "completed",
    repository,
    workflow_run: { ...instance.run, ...fields },
  });

  instance.pull.headRefOid = nextHead;
  await instance.deliver("workflow_run", 50, event());
  instance.pull.headRefOid = head;
  await instance.deliver("workflow_run", 51, event({ run_attempt: 2 }));
  await instance.deliver("workflow_run", 52, event({ conclusion: "failure" }));
  await instance.deliver("workflow_run", 55, event({ conclusion: "skipped" }));
  assert.equal(instance.sent.length, 0);
  await instance.deliver("workflow_run", 53, event());
  await instance.deliver("workflow_run", 54, event());
  assert.equal(instance.sent.length, 1);
  assert.equal(instance.sent[0].target, instance.owner);
  assert.match(instance.sent[0].message, /CI cancelled for workflow run 84, attempt 1\./);
  assert.ok(instance.sent[0].message.includes(`issue #107, PR #207, head ${head}`));
  assert.ok(instance.sent[0].message.includes(`${repo}/actions/runs/84/attempts/1`));
  assert.deepEqual(instance.receipts().map(({ state }) => state), ["queued"]);
});

test("a corrected head in external-event wait keeps CI and review bound to the existing owner", async (t) => {
  const instance = fixture(t, 106, "corrected-head-fixture-key");
  const workflowEvent = () => ({
    action: "completed",
    repository,
    workflow_run: instance.run,
  });

  instance.pull.headRefOid = nextHead;
  instance.item.current_head_sha = nextHead;
  instance.saveLedger();

  await instance.deliver("workflow_run", 40, workflowEvent());
  await instance.deliver("issue_comment", 41, instance.reviewEvent());
  assert.equal(instance.sent.length, 0);

  instance.run.head_sha = nextHead;
  instance.run.pull_requests[0].head.sha = nextHead;
  instance.run.conclusion = "success";
  await instance.deliver("workflow_run", 42, workflowEvent());
  await instance.deliver(
    "issue_comment",
    43,
    instance.reviewEvent({ commit_sha: nextHead }),
  );

  assert.equal(instance.sent.length, 2);
  assert.match(instance.sent[0].message, /CI passed/);
  assert.match(instance.sent[1].message, /review/i);
  for (const notice of instance.sent) {
    assert.equal(notice.target, instance.owner);
    assert.ok(notice.message.includes(nextHead));
  }
  assert.deepEqual(
    instance.receipts().map(({ state }) => state),
    ["queued", "queued"],
  );
});

test("closures route to the coordinator and an ambiguous queue result is retained without replay", async (t) => {
  const instance = fixture(t, 105, "lifecycle-fixture-key");
  Object.assign(instance.pull, {
    state: "CLOSED",
    merged: false,
    closedAt: stamp,
  });
  assert.equal(
    await instance.deliver("pull_request", 15, instance.lifecycle("closed")),
    202,
  );
  assert.match(instance.sent[0].message, /closed without merge/);
  Object.assign(instance.pull, {
    state: "MERGED",
    merged: true,
    mergeCommit: { oid: mergedHead },
  });
  instance.relay.send = async (target, message) => {
    instance.sent.push({ target, message });
    return "Accepted without a queue receipt";
  };
  assert.equal(
    await instance.deliver(
      "pull_request",
      16,
      instance.lifecycle("closed", true),
    ),
    503,
  );
  assert.equal(
    await instance.deliver(
      "pull_request",
      17,
      instance.lifecycle("closed", true),
    ),
    503,
  );
  assert.equal(instance.sent.length, 2);
  assert.ok(instance.sent.every((notice) => notice.target === instance.thread));
  assert.match(instance.sent[1].message, new RegExp(mergedHead));
  assert.deepEqual(
    instance.receipts().map((row) => row.state),
    ["queued", "unresolved"],
  );
});

test("CLI requires the ledger parameter and reports usage", () => {
  assert.match(
    execFileSync(process.execPath, [script, "--help"], { encoding: "utf8" }),
    /--ledger/,
  );
  assert.throws(
    () =>
      execFileSync(process.execPath, [script, "serve", "--state-dir", "."], {
        stdio: "pipe",
      }),
    /--ledger, and --state-dir are required/,
  );
});
