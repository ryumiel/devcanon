import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const helperScript = path.join(
  process.cwd(),
  "skills/pr-review/scripts/review-leases.sh",
);
const bashExecutable =
  process.platform === "win32" &&
  existsSync("C:\\Program Files\\Git\\bin\\bash.exe")
    ? "C:\\Program Files\\Git\\bin\\bash.exe"
    : "bash";
const jqAvailable = await commandAvailable("jq");
const prNumber = "382";
const repository = "owner/repo";
const createdAt = "2026-06-05T00:00:00Z";
const reducerFixtureTimeout = process.platform === "win32" ? 360_000 : 30_000;

type Workspace = {
  cwd: string;
  baseSha: string;
  headSha: string;
};

type FixtureContext = {
  primary: Workspace;
  review: Workspace;
  leaseFile: string;
  manifestHelper: string;
  approvedHelper: string;
};

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync(bashExecutable, ["-lc", `command -v ${command}`]);
    return true;
  } catch {
    return false;
  }
}

function usesGitBash() {
  return bashExecutable.toLowerCase().includes("\\git\\bin\\bash.exe");
}

function bashPath(filePath: string) {
  if (process.platform !== "win32") {
    return filePath;
  }
  const normalized = filePath.replace(/\\/gu, "/");
  const driveMatch = /^([A-Za-z]):\/(.*)$/u.exec(normalized);
  if (!driveMatch) {
    return normalized;
  }
  return usesGitBash()
    ? `/${driveMatch[1].toLowerCase()}/${driveMatch[2]}`
    : `/mnt/${driveMatch[1].toLowerCase()}/${driveMatch[2]}`;
}

function bashPhysicalPath(filePath: string) {
  if (process.platform !== "win32" || !usesGitBash()) {
    return bashPath(filePath);
  }
  const normalized = filePath.replace(/\\/gu, "/");
  const tempRoot = os.tmpdir().replace(/\\/gu, "/").replace(/\/$/u, "");
  const lowerNormalized = normalized.toLowerCase();
  const lowerTempRoot = tempRoot.toLowerCase();
  if (
    lowerNormalized === lowerTempRoot ||
    lowerNormalized.startsWith(`${lowerTempRoot}/`)
  ) {
    const relative = normalized.slice(tempRoot.length).replace(/^\/+/u, "");
    return relative ? `/tmp/${relative}` : "/tmp";
  }
  return bashPath(filePath);
}

function normalizePathText(value: string) {
  let normalized = value.replace(/\\/gu, "/");
  if (process.platform === "win32") {
    normalized = normalized.replace(
      /^\/([A-Za-z])\//u,
      (_match, drive: string) => `${drive}:/`,
    );
    if (/^[A-Za-z]:\//u.test(normalized)) {
      normalized = normalized.toLowerCase();
    }
  }
  return normalized;
}

function leaseDigest(worktreePath: string) {
  return createHash("sha256")
    .update(normalizePathText(bashPhysicalPath(worktreePath)))
    .digest("hex");
}

function leasePath(worktreePath: string) {
  return `.ephemeral/pr-${prNumber}-${leaseDigest(worktreePath)}-lease.json`;
}

function shellSingleQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function handoffPath(headSha: string) {
  return `.ephemeral/pr-${prNumber}-${headSha}-handoff.json`;
}

function resultPath(headSha: string) {
  return `.ephemeral/pr-${prNumber}-${headSha}-result.json`;
}

function approvedReviewPath(headSha: string) {
  return `.ephemeral/topic-${headSha}-approved-review.json`;
}

function validatedPayloadPath(headSha: string) {
  return `.ephemeral/pr-${prNumber}-${headSha}-validated-review-payload.json`;
}

function scopePath(headSha: string) {
  return `.ephemeral/topic-${headSha}-scope-decision.json`;
}

function findingsPath(headSha: string) {
  return `.ephemeral/topic-${headSha}-findings.json`;
}

function reviewBodyPath(headSha: string) {
  return `.ephemeral/topic-${headSha}-review-body.md`;
}

async function git(cwd: string, ...args: string[]) {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function makeGitWorkspace(prefix: string): Promise<Workspace> {
  const logicalCwd = await mkdtemp(path.join(os.tmpdir(), prefix));
  const cwd = await realpath(logicalCwd);
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd,
  });
  await writeFile(path.join(cwd, "README.md"), "baseline\n");
  await execFileAsync("git", ["add", "README.md"], { cwd });
  await execFileAsync("git", ["commit", "-m", "chore: baseline"], { cwd });
  const baseSha = await git(cwd, "rev-parse", "HEAD");
  await execFileAsync("git", ["switch", "-C", "topic"], { cwd });
  await writeFile(path.join(cwd, "feature.txt"), "feature\n");
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync("git", ["commit", "-m", "feat: add feature"], { cwd });
  const headSha = await git(cwd, "rev-parse", "HEAD");
  await mkdir(path.join(cwd, ".ephemeral"));
  return { cwd, baseSha, headSha };
}

async function writeJson(cwd: string, relPath: string, value: unknown) {
  await mkdir(path.dirname(path.join(cwd, relPath)), { recursive: true });
  await writeFile(path.join(cwd, relPath), JSON.stringify(value, null, 2));
}

async function readJson(cwd: string, relPath: string) {
  return JSON.parse(await readFile(path.join(cwd, relPath), "utf8"));
}

async function writePassingHelper(cwd: string, name: string) {
  const helper = path.join(cwd, ".ephemeral", name);
  await writeFile(
    helper,
    ["#!/usr/bin/env bash", "set -euo pipefail", "exit 0", ""].join("\n"),
  );
  await chmod(helper, 0o755);
  return helper;
}

async function writeReviewArtifacts(review: Workspace) {
  const digest = "1".repeat(64);
  await writeJson(review.cwd, handoffPath(review.headSha), {
    repository,
    pr_number: Number(prNumber),
    base_ref: "main",
    head_ref: "topic",
    execution: {
      working_directory:
        process.platform === "win32"
          ? review.cwd.replace(/\\/gu, "/")
          : review.cwd,
    },
    review_head_sha: review.headSha,
  });
  await writeJson(review.cwd, resultPath(review.headSha), {
    repository,
    pr_number: Number(prNumber),
    review_head_sha: review.headSha,
    handoff_file: handoffPath(review.headSha),
    findings_file: findingsPath(review.headSha),
    review_body_file: reviewBodyPath(review.headSha),
    artifacts: {
      handoff_file: handoffPath(review.headSha),
      scope_decision_file: scopePath(review.headSha),
    },
    digests: {
      handoff_sha256: digest,
      findings_sha256: digest,
      review_body_sha256: digest,
      scope_decision_sha256: digest,
    },
    presentation: {
      status: "preview-current",
      notes: null,
    },
  });
  await writeJson(review.cwd, scopePath(review.headSha), {
    full_range: `${review.baseSha}...HEAD`,
  });
  await writeFile(
    path.join(review.cwd, reviewBodyPath(review.headSha)),
    "body\n",
  );
  await writeJson(review.cwd, findingsPath(review.headSha), {
    schema: "play-review/findings/v1",
    findings: [],
    carry_forward: [],
  });
  await writeJson(review.cwd, approvedReviewPath(review.headSha), {
    schema: "pr-review/approved-review/v1",
    review_head_sha: review.headSha,
    findings_file: findingsPath(review.headSha),
    review_body_file: reviewBodyPath(review.headSha),
    review_payload_file: `.ephemeral/topic-${review.headSha}-review-payload.json`,
    scope_decision_file: scopePath(review.headSha),
    findings_sha256: digest,
    review_body_sha256: digest,
    review_payload_sha256: digest,
    scope_decision_sha256: digest,
    payload: {
      commit_id: review.headSha,
      event: "COMMENT",
      body: "body",
      comments: [],
    },
  });
  await writeJson(review.cwd, validatedPayloadPath(review.headSha), {
    commit_id: review.headSha,
    event: "COMMENT",
    body: "body",
    comments: [],
  });
}

async function runBashScript(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) {
  const envFile = path.join(
    cwd,
    ".ephemeral",
    `.lease-env-${process.pid}-${randomUUID()}.sh`,
  );
  const lines: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (name === "PATH" || name === "Path") {
      continue;
    }
    if (value !== undefined && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
      lines.push(`export ${name}=${shellSingleQuote(value)}`);
    }
  }
  await writeFile(envFile, `${lines.join("\n")}\n`);
  const command = [
    `source ${shellSingleQuote(bashPath(envFile))}`,
    `exec ${shellSingleQuote(bashPath(bashExecutable))} ${shellSingleQuote(
      bashPath(helperScript),
    )} ${args.map((arg) => shellSingleQuote(arg)).join(" ")}`,
  ].join("; ");
  try {
    return await execFileAsync(bashExecutable, ["-lc", command], {
      cwd,
      maxBuffer: 1024 * 1024,
    });
  } finally {
    await unlink(envFile).catch(() => undefined);
  }
}

async function runLeaseHelper(
  ctx: FixtureContext,
  command: string,
  env: NodeJS.ProcessEnv,
) {
  return await runBashScript(ctx.primary.cwd, [command], {
    ...process.env,
    REPOSITORY: repository,
    PR_NUMBER: prNumber,
    PRIMARY_REPOSITORY_ROOT: bashPath(ctx.primary.cwd),
    WORKTREE_PATH: bashPath(ctx.review.cwd),
    LEASE_FILE: ctx.leaseFile,
    BASE_REF: "main",
    HEAD_REF: "topic",
    CREATED_AT: createdAt,
    UPDATED_AT: "2026-06-05T00:01:00Z",
    REVIEW_MANIFEST_HELPER: bashPath(ctx.manifestHelper),
    APPROVED_REVIEW_HELPER: bashPath(ctx.approvedHelper),
    ...env,
  });
}

async function makeFixture(): Promise<FixtureContext> {
  const primary = await makeGitWorkspace("devcanon-pr-lease-reducer-primary-");
  const review = await makeGitWorkspace("devcanon-pr-lease-reducer-review-");
  const manifestHelper = await writePassingHelper(
    review.cwd,
    "manifest-helper.sh",
  );
  const approvedHelper = await writePassingHelper(
    review.cwd,
    "approved-helper.sh",
  );
  await writeReviewArtifacts(review);
  return {
    primary,
    review,
    leaseFile: leasePath(review.cwd),
    manifestHelper,
    approvedHelper,
  };
}

async function cleanupFixture(ctx: FixtureContext) {
  await rm(ctx.primary.cwd, { recursive: true, force: true });
  await rm(ctx.review.cwd, { recursive: true, force: true });
}

async function writeState(
  ctx: FixtureContext,
  state: string,
  env: NodeJS.ProcessEnv = {},
) {
  await runLeaseHelper(ctx, "write", { STATE: state, ...env });
}

async function createLease(ctx: FixtureContext) {
  await writeState(ctx, "created");
}

async function attachHandoff(ctx: FixtureContext) {
  await createLease(ctx);
  await writeState(ctx, "created", {
    HANDOFF_FILE: handoffPath(ctx.review.headSha),
    UPDATED_AT: "2026-06-05T00:02:00Z",
  });
}

async function reviewedLease(ctx: FixtureContext) {
  await createLease(ctx);
  await writeState(ctx, "reviewed", {
    RESULT_FILE: resultPath(ctx.review.headSha),
    UPDATED_AT: "2026-06-05T00:03:00Z",
  });
}

async function gatedLease(ctx: FixtureContext) {
  await reviewedLease(ctx);
  await writeState(ctx, "gated", {
    PRESENTED_AT: "2026-06-05T00:04:00Z",
    PRESENTATION_STATUS: "preview-current",
    UPDATED_AT: "2026-06-05T00:04:00Z",
  });
}

async function failedGithubPostLease(ctx: FixtureContext) {
  await gatedLease(ctx);
  await writeState(ctx, "failed", {
    APPROVED_REVIEW_FILE: approvedReviewPath(ctx.review.headSha),
    FINISHED_AT: "2026-06-05T00:05:00Z",
    FAILURE_PHASE: "github-post",
    FAILURE_REASON: "GitHub API rejected the review",
    FAILURE_RECOVERABILITY: "recoverable",
    GITHUB_POST_ATTEMPTED: "true",
    GITHUB_POST_RESULT: "failed",
    UPDATED_AT: "2026-06-05T00:05:00Z",
  });
}

const positiveRows = [
  {
    row: "LC-01",
    run: async (ctx: FixtureContext) => {
      await createLease(ctx);
      expect(await readJson(ctx.primary.cwd, ctx.leaseFile)).toMatchObject({
        state: "created",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
        },
        presentation: { presented_at: null, status: null },
        terminal: { finished_at: null, reason: null },
        failure: { phase: null, reason: null, recoverability: null },
        github: {
          github_post_attempted: false,
          github_post_result: "not-attempted",
          github_posted_at: null,
        },
      });
    },
  },
  {
    row: "LC-02",
    run: async (ctx: FixtureContext) => {
      await attachHandoff(ctx);
      expect(await readJson(ctx.primary.cwd, ctx.leaseFile)).toMatchObject({
        state: "created",
        created_at: createdAt,
        artifacts: { handoff_file: handoffPath(ctx.review.headSha) },
      });
    },
  },
  {
    row: "LC-03",
    run: async (ctx: FixtureContext) => {
      await reviewedLease(ctx);
      expect(await readJson(ctx.primary.cwd, ctx.leaseFile)).toMatchObject({
        state: "reviewed",
        artifacts: {
          handoff_file: handoffPath(ctx.review.headSha),
          result_file: resultPath(ctx.review.headSha),
          approved_review_file: null,
        },
        github: { github_post_result: "not-attempted" },
      });
    },
  },
  {
    row: "LC-04",
    run: async (ctx: FixtureContext) => {
      await gatedLease(ctx);
      expect(await readJson(ctx.primary.cwd, ctx.leaseFile)).toMatchObject({
        state: "gated",
        presentation: {
          presented_at: "2026-06-05T00:04:00Z",
          status: "preview-current",
        },
        terminal: { finished_at: null },
      });
    },
  },
  {
    row: "LC-05",
    run: async (ctx: FixtureContext) => {
      await gatedLease(ctx);
      await writeState(ctx, "gated", {
        PRESENTED_AT: "2026-06-05T00:06:00Z",
        PRESENTATION_STATUS: "edited",
        UPDATED_AT: "2026-06-05T00:06:00Z",
      });
      expect(await readJson(ctx.primary.cwd, ctx.leaseFile)).toMatchObject({
        state: "gated",
        presentation: {
          presented_at: "2026-06-05T00:06:00Z",
          status: "edited",
        },
        artifacts: { approved_review_file: null },
      });
    },
  },
  {
    row: "LC-06",
    run: async (ctx: FixtureContext) => {
      await reviewedLease(ctx);
      await writeState(ctx, "aborted", {
        FINISHED_AT: "2026-06-05T00:06:00Z",
        TERMINAL_REASON: "User aborted after review",
        UPDATED_AT: "2026-06-05T00:06:00Z",
      });
      expect(await readJson(ctx.primary.cwd, ctx.leaseFile)).toMatchObject({
        state: "aborted",
        artifacts: { result_file: resultPath(ctx.review.headSha) },
        terminal: {
          finished_at: "2026-06-05T00:06:00Z",
          reason: "User aborted after review",
        },
        failure: { phase: null },
      });
    },
  },
  {
    row: "LC-07",
    run: async (ctx: FixtureContext) => {
      await gatedLease(ctx);
      await writeState(ctx, "aborted", {
        FINISHED_AT: "2026-06-05T00:06:00Z",
        TERMINAL_REASON: "User aborted after preview",
        UPDATED_AT: "2026-06-05T00:06:00Z",
      });
      expect(await readJson(ctx.primary.cwd, ctx.leaseFile)).toMatchObject({
        state: "aborted",
        presentation: { status: "preview-current" },
        artifacts: {
          result_file: resultPath(ctx.review.headSha),
          approved_review_file: null,
        },
      });
    },
  },
  {
    row: "LC-08",
    run: async (ctx: FixtureContext) => {
      await gatedLease(ctx);
      await writeState(ctx, "posted", {
        APPROVED_REVIEW_FILE: approvedReviewPath(ctx.review.headSha),
        FINISHED_AT: "2026-06-05T00:06:00Z",
        GITHUB_POSTED_AT: "2026-06-05T00:06:00Z",
        UPDATED_AT: "2026-06-05T00:06:00Z",
      });
      expect(await readJson(ctx.primary.cwd, ctx.leaseFile)).toMatchObject({
        state: "posted",
        artifacts: {
          result_file: resultPath(ctx.review.headSha),
          approved_review_file: approvedReviewPath(ctx.review.headSha),
          validated_payload_file: validatedPayloadPath(ctx.review.headSha),
        },
        github: {
          github_post_attempted: true,
          github_post_result: "succeeded",
          github_posted_at: "2026-06-05T00:06:00Z",
        },
        failure: { phase: null },
      });
    },
  },
  {
    row: "LC-09",
    run: async (ctx: FixtureContext) => {
      await createLease(ctx);
      await writeState(ctx, "failed", {
        FINISHED_AT: "2026-06-05T00:03:00Z",
        FAILURE_PHASE: "handoff-validation",
        FAILURE_REASON: "Handoff validation failed",
        FAILURE_RECOVERABILITY: "unrecoverable",
        UPDATED_AT: "2026-06-05T00:03:00Z",
      });
      expect(await readJson(ctx.primary.cwd, ctx.leaseFile)).toMatchObject({
        state: "failed",
        artifacts: { result_file: null, approved_review_file: null },
        failure: { phase: "handoff-validation" },
        github: { github_post_result: "not-attempted" },
      });
    },
  },
  {
    row: "LC-10",
    run: async (ctx: FixtureContext) => {
      await reviewedLease(ctx);
      await writeState(ctx, "failed", {
        FINISHED_AT: "2026-06-05T00:04:00Z",
        FAILURE_PHASE: "preview-render",
        FAILURE_REASON: "Preview render failed",
        FAILURE_RECOVERABILITY: "recoverable",
        UPDATED_AT: "2026-06-05T00:04:00Z",
      });
      expect(await readJson(ctx.primary.cwd, ctx.leaseFile)).toMatchObject({
        state: "failed",
        artifacts: { result_file: resultPath(ctx.review.headSha) },
        failure: { phase: "preview-render" },
        presentation: { status: null },
      });
    },
  },
  {
    row: "LC-11",
    run: async (ctx: FixtureContext) => {
      await gatedLease(ctx);
      await writeState(ctx, "failed", {
        FINISHED_AT: "2026-06-05T00:05:00Z",
        FAILURE_PHASE: "stale-head",
        FAILURE_REASON: "Head changed before approval",
        FAILURE_RECOVERABILITY: "recoverable",
        UPDATED_AT: "2026-06-05T00:05:00Z",
      });
      expect(await readJson(ctx.primary.cwd, ctx.leaseFile)).toMatchObject({
        state: "failed",
        artifacts: {
          result_file: resultPath(ctx.review.headSha),
          approved_review_file: null,
        },
        presentation: { status: "preview-current" },
        github: { github_post_attempted: false },
      });
    },
  },
  {
    row: "LC-12",
    run: async (ctx: FixtureContext) => {
      await gatedLease(ctx);
      await writeState(ctx, "failed", {
        APPROVED_REVIEW_FILE: approvedReviewPath(ctx.review.headSha),
        FINISHED_AT: "2026-06-05T00:05:00Z",
        FAILURE_PHASE: "approval-freeze",
        FAILURE_REASON: "Approval freeze failed",
        FAILURE_RECOVERABILITY: "recoverable",
        UPDATED_AT: "2026-06-05T00:05:00Z",
      });
      expect(await readJson(ctx.primary.cwd, ctx.leaseFile)).toMatchObject({
        state: "failed",
        artifacts: {
          result_file: resultPath(ctx.review.headSha),
          approved_review_file: approvedReviewPath(ctx.review.headSha),
        },
        failure: { phase: "approval-freeze" },
        github: { github_post_result: "not-attempted" },
      });
    },
  },
  {
    row: "LC-13",
    run: async (ctx: FixtureContext) => {
      await failedGithubPostLease(ctx);
      expect(await readJson(ctx.primary.cwd, ctx.leaseFile)).toMatchObject({
        state: "failed",
        artifacts: {
          approved_review_file: approvedReviewPath(ctx.review.headSha),
          validated_payload_file: validatedPayloadPath(ctx.review.headSha),
        },
        failure: { phase: "github-post" },
        github: {
          github_post_attempted: true,
          github_post_result: "failed",
          github_posted_at: null,
        },
      });
    },
  },
  {
    row: "LC-14",
    run: async (ctx: FixtureContext) => {
      await createLease(ctx);
      await writeState(ctx, "failed", {
        FINISHED_AT: "2026-06-05T00:03:00Z",
        FAILURE_PHASE: "handoff-validation",
        FAILURE_REASON: "Handoff validation failed",
        FAILURE_RECOVERABILITY: "recoverable",
        UPDATED_AT: "2026-06-05T00:03:00Z",
      });
      await writeState(ctx, "gated", {
        RESULT_FILE: resultPath(ctx.review.headSha),
        PRESENTED_AT: "2026-06-05T00:06:00Z",
        PRESENTATION_STATUS: "preview-current",
        UPDATED_AT: "2026-06-05T00:06:00Z",
      });
      expect(await readJson(ctx.primary.cwd, ctx.leaseFile)).toMatchObject({
        state: "gated",
        artifacts: {
          result_file: resultPath(ctx.review.headSha),
          approved_review_file: null,
        },
        terminal: { finished_at: null },
        failure: { phase: null },
      });
    },
  },
  {
    row: "LC-15",
    run: async (ctx: FixtureContext) => {
      await createLease(ctx);
      await writeState(ctx, "failed", {
        FINISHED_AT: "2026-06-05T00:03:00Z",
        FAILURE_PHASE: "handoff-validation",
        FAILURE_REASON: "Handoff validation failed",
        FAILURE_RECOVERABILITY: "recoverable",
        UPDATED_AT: "2026-06-05T00:03:00Z",
      });
      await writeState(ctx, "aborted", {
        FINISHED_AT: "2026-06-05T00:06:00Z",
        TERMINAL_REASON: "Abandon failed review",
        UPDATED_AT: "2026-06-05T00:06:00Z",
      });
      expect(await readJson(ctx.primary.cwd, ctx.leaseFile)).toMatchObject({
        state: "aborted",
        artifacts: { result_file: null, approved_review_file: null },
        failure: { phase: null },
      });
    },
  },
  {
    row: "LC-16",
    run: async (ctx: FixtureContext) => {
      await createLease(ctx);
      await writeState(ctx, "failed", {
        FINISHED_AT: "2026-06-05T00:03:00Z",
        FAILURE_PHASE: "handoff-validation",
        FAILURE_REASON: "Handoff validation failed",
        FAILURE_RECOVERABILITY: "recoverable",
        UPDATED_AT: "2026-06-05T00:03:00Z",
      });
      await writeState(ctx, "failed", {
        FINISHED_AT: "2026-06-05T00:04:00Z",
        FAILURE_PHASE: "preview-render",
        FAILURE_REASON: "Preview render failed",
        FAILURE_RECOVERABILITY: "recoverable",
        UPDATED_AT: "2026-06-05T00:04:00Z",
      });
      expect(await readJson(ctx.primary.cwd, ctx.leaseFile)).toMatchObject({
        state: "failed",
        failure: {
          phase: "preview-render",
          reason: "Preview render failed",
        },
        github: { github_post_result: "not-attempted" },
      });
    },
  },
  {
    row: "LC-17",
    run: async (ctx: FixtureContext) => {
      await failedGithubPostLease(ctx);
      await writeState(ctx, "posted", {
        FINISHED_AT: "2026-06-05T00:07:00Z",
        GITHUB_POSTED_AT: "2026-06-05T00:07:00Z",
        UPDATED_AT: "2026-06-05T00:07:00Z",
      });
      expect(await readJson(ctx.primary.cwd, ctx.leaseFile)).toMatchObject({
        state: "posted",
        artifacts: {
          result_file: resultPath(ctx.review.headSha),
          approved_review_file: approvedReviewPath(ctx.review.headSha),
          validated_payload_file: validatedPayloadPath(ctx.review.headSha),
        },
        github: {
          github_post_attempted: true,
          github_post_result: "succeeded",
        },
        failure: { phase: null },
      });
    },
  },
  {
    row: "LC-18-posted",
    run: async (ctx: FixtureContext) => {
      await gatedLease(ctx);
      await writeState(ctx, "posted", {
        APPROVED_REVIEW_FILE: approvedReviewPath(ctx.review.headSha),
        FINISHED_AT: "2026-06-05T00:06:00Z",
        GITHUB_POSTED_AT: "2026-06-05T00:06:00Z",
        UPDATED_AT: "2026-06-05T00:06:00Z",
      });
      await writeState(ctx, "created", {
        UPDATED_AT: "2026-06-05T00:08:00Z",
      });
      expect(await readJson(ctx.primary.cwd, ctx.leaseFile)).toMatchObject({
        state: "created",
        artifacts: {
          result_file: null,
          approved_review_file: null,
        },
      });
      const archived = await readdir(path.join(ctx.primary.cwd, ".ephemeral"));
      expect(
        archived.filter((entry) =>
          entry.endsWith("-posted-archived-lease.json"),
        ),
      ).toHaveLength(1);
    },
  },
  {
    row: "LC-18-aborted",
    run: async (ctx: FixtureContext) => {
      await gatedLease(ctx);
      await writeState(ctx, "aborted", {
        FINISHED_AT: "2026-06-05T00:06:00Z",
        TERMINAL_REASON: "User aborted",
        UPDATED_AT: "2026-06-05T00:06:00Z",
      });
      await writeState(ctx, "created", {
        UPDATED_AT: "2026-06-05T00:08:00Z",
      });
      const archived = await readdir(path.join(ctx.primary.cwd, ".ephemeral"));
      expect(await readJson(ctx.primary.cwd, ctx.leaseFile)).toMatchObject({
        state: "created",
        terminal: { finished_at: null, reason: null },
      });
      expect(
        archived.filter((entry) =>
          entry.endsWith("-aborted-archived-lease.json"),
        ),
      ).toHaveLength(1);
    },
  },
] satisfies Array<{
  row: string;
  run: (ctx: FixtureContext) => Promise<void>;
}>;

describe.skipIf(!jqAvailable)(
  "pr-review lease reducer contract fixtures",
  () => {
    it.each(positiveRows)(
      "$row positive fixture",
      async ({ run }) => {
        const ctx = await makeFixture();
        try {
          await run(ctx);
          await expect(
            runLeaseHelper(ctx, "validate", {
              UPDATED_AT: "2026-06-05T00:09:00Z",
            }),
          ).resolves.toMatchObject({ stdout: "" });
        } finally {
          await cleanupFixture(ctx);
        }
      },
      reducerFixtureTimeout,
    );

    it(
      "rejects invalid state/event cross-products with boundary-specific failures",
      async () => {
        const ctx = await makeFixture();
        try {
          await createLease(ctx);
          await expect(
            runLeaseHelper(ctx, "write", {
              STATE: "posted",
              APPROVED_REVIEW_FILE: approvedReviewPath(ctx.review.headSha),
              FINISHED_AT: "2026-06-05T00:03:00Z",
              GITHUB_POSTED_AT: "2026-06-05T00:03:00Z",
            }),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining(
              "invalid lease transition: created -> posted",
            ),
          });

          await expect(
            runLeaseHelper(ctx, "write", {
              STATE: "created",
              UPDATED_AT: "2026-06-05T00:03:00Z",
            }),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining(
              "invalid lease transition: created -> created",
            ),
          });
        } finally {
          await cleanupFixture(ctx);
        }
      },
      reducerFixtureTimeout,
    );

    it(
      "rejects missing and stale artifact bindings separately from shell invocation",
      async () => {
        const ctx = await makeFixture();
        try {
          await createLease(ctx);
          await expect(
            runLeaseHelper(ctx, "write", {
              STATE: "reviewed",
              RESULT_FILE: resultPath(ctx.review.headSha),
            }),
          ).resolves.toMatchObject({ stdout: `${ctx.leaseFile}\n` });

          await rm(path.join(ctx.review.cwd, resultPath(ctx.review.headSha)));
          await expect(
            runLeaseHelper(ctx, "write", {
              STATE: "gated",
              PRESENTED_AT: "2026-06-05T00:04:00Z",
              PRESENTATION_STATUS: "preview-current",
              UPDATED_AT: "2026-06-05T00:04:00Z",
            }),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining(
              "result file missing or not a regular file",
            ),
          });

          await writeReviewArtifacts(ctx.review);
          const staleHandoff =
            ".ephemeral/pr-382-0000000000000000000000000000000000000000-handoff.json";
          await writeJson(ctx.review.cwd, staleHandoff, {
            repository,
            pr_number: Number(prNumber),
            base_ref: "main",
            head_ref: "topic",
            execution: { working_directory: ctx.review.cwd },
            review_head_sha: "0".repeat(40),
          });
          await writeJson(ctx.review.cwd, resultPath(ctx.review.headSha), {
            ...(await readJson(ctx.review.cwd, resultPath(ctx.review.headSha))),
            handoff_file: staleHandoff,
          });
          await expect(
            runLeaseHelper(ctx, "write", {
              STATE: "gated",
              RESULT_FILE: resultPath(ctx.review.headSha),
              PRESENTED_AT: "2026-06-05T00:04:00Z",
              PRESENTATION_STATUS: "preview-current",
              UPDATED_AT: "2026-06-05T00:04:00Z",
            }),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining("result review head mismatch"),
          });
        } finally {
          await cleanupFixture(ctx);
        }
      },
      reducerFixtureTimeout,
    );

    it(
      "rejects LC-17 retry-to-post from non-GitHub-post failures and replacement artifacts",
      async () => {
        const ctx = await makeFixture();
        try {
          await gatedLease(ctx);
          await writeState(ctx, "failed", {
            FINISHED_AT: "2026-06-05T00:05:00Z",
            FAILURE_PHASE: "stale-head",
            FAILURE_REASON: "Head changed before approval",
            FAILURE_RECOVERABILITY: "recoverable",
            UPDATED_AT: "2026-06-05T00:05:00Z",
          });
          await expect(
            runLeaseHelper(ctx, "write", {
              STATE: "posted",
              FINISHED_AT: "2026-06-05T00:06:00Z",
              GITHUB_POSTED_AT: "2026-06-05T00:06:00Z",
              UPDATED_AT: "2026-06-05T00:06:00Z",
            }),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining(
              "invalid lease transition: failed -> posted requires github-post failure",
            ),
          });
        } finally {
          await cleanupFixture(ctx);
        }

        const replacementCtx = await makeFixture();
        try {
          await failedGithubPostLease(replacementCtx);
          const replacement =
            ".ephemeral/topic-replacement-approved-review.json";
          await writeJson(replacementCtx.review.cwd, replacement, {
            ...(await readJson(
              replacementCtx.review.cwd,
              approvedReviewPath(replacementCtx.review.headSha),
            )),
          });
          await expect(
            runLeaseHelper(replacementCtx, "write", {
              STATE: "posted",
              APPROVED_REVIEW_FILE: replacement,
              FINISHED_AT: "2026-06-05T00:07:00Z",
              GITHUB_POSTED_AT: "2026-06-05T00:07:00Z",
              UPDATED_AT: "2026-06-05T00:07:00Z",
            }),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining(
              "APPROVED_REVIEW_FILE must match existing failed approved-review",
            ),
          });
        } finally {
          await cleanupFixture(replacementCtx);
        }
      },
      reducerFixtureTimeout,
    );

    it(
      "rejects replacement result pointers for LC-10 through LC-13",
      async () => {
        const approvedReviewPlaceholder = "__approved_review__";
        const replacement = ".ephemeral/replacement-result.json";
        const rows = [
          {
            row: "LC-10",
            setup: reviewedLease,
            env: {
              FINISHED_AT: "2026-06-05T00:05:00Z",
              FAILURE_PHASE: "preview-render",
              FAILURE_REASON: "Preview render failed",
              FAILURE_RECOVERABILITY: "recoverable",
              UPDATED_AT: "2026-06-05T00:05:00Z",
            },
            priorState: "reviewed",
          },
          {
            row: "LC-11",
            setup: gatedLease,
            env: {
              FINISHED_AT: "2026-06-05T00:05:00Z",
              FAILURE_PHASE: "stale-head",
              FAILURE_REASON: "Head changed before approval",
              FAILURE_RECOVERABILITY: "recoverable",
              UPDATED_AT: "2026-06-05T00:05:00Z",
            },
            priorState: "gated",
          },
          {
            row: "LC-12",
            setup: gatedLease,
            env: {
              APPROVED_REVIEW_FILE: approvedReviewPlaceholder,
              FINISHED_AT: "2026-06-05T00:05:00Z",
              FAILURE_PHASE: "approval-freeze",
              FAILURE_REASON: "Approval freeze failed",
              FAILURE_RECOVERABILITY: "recoverable",
              UPDATED_AT: "2026-06-05T00:05:00Z",
            },
            priorState: "gated",
          },
          {
            row: "LC-13",
            setup: gatedLease,
            env: {
              APPROVED_REVIEW_FILE: approvedReviewPlaceholder,
              FINISHED_AT: "2026-06-05T00:05:00Z",
              FAILURE_PHASE: "github-post",
              FAILURE_REASON: "GitHub post failed",
              FAILURE_RECOVERABILITY: "recoverable",
              GITHUB_POST_ATTEMPTED: "true",
              GITHUB_POST_RESULT: "failed",
              UPDATED_AT: "2026-06-05T00:05:00Z",
            },
            priorState: "gated",
          },
        ];

        for (const { env, priorState, row, setup } of rows) {
          const ctx = await makeFixture();
          try {
            await setup(ctx);
            const before = await readJson(ctx.primary.cwd, ctx.leaseFile);
            const resolvedEnv = Object.fromEntries(
              Object.entries(env).map(([key, value]) => [
                key,
                value === approvedReviewPlaceholder
                  ? approvedReviewPath(ctx.review.headSha)
                  : value,
              ]),
            );

            await expect(
              runLeaseHelper(ctx, "write", {
                ...resolvedEnv,
                STATE: "failed",
                RESULT_FILE: replacement,
              }),
              row,
            ).rejects.toMatchObject({
              stderr: expect.stringContaining(
                `RESULT_FILE must match existing ${priorState} result`,
              ),
            });

            expect(await readJson(ctx.primary.cwd, ctx.leaseFile), row).toEqual(
              before,
            );
          } finally {
            await cleanupFixture(ctx);
          }
        }
      },
      reducerFixtureTimeout,
    );

    it(
      "validates LC-12 approved-review path identity without full payload validation",
      async () => {
        const ctx = await makeFixture();
        try {
          await gatedLease(ctx);
          const replacement = ".ephemeral/replacement-approved-review.json";
          await writeJson(ctx.review.cwd, replacement, {
            ...(await readJson(
              ctx.review.cwd,
              approvedReviewPath(ctx.review.headSha),
            )),
          });

          await expect(
            runLeaseHelper(ctx, "write", {
              STATE: "failed",
              APPROVED_REVIEW_FILE: replacement,
              FINISHED_AT: "2026-06-05T00:05:00Z",
              FAILURE_PHASE: "approval-freeze",
              FAILURE_REASON: "Approval freeze failed",
              FAILURE_RECOVERABILITY: "recoverable",
              UPDATED_AT: "2026-06-05T00:05:00Z",
            }),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining("approved review path mismatch"),
          });
        } finally {
          await cleanupFixture(ctx);
        }

        const skipHelperCtx = await makeFixture();
        try {
          await gatedLease(skipHelperCtx);
          const failingApprovedHelper = path.join(
            skipHelperCtx.review.cwd,
            ".ephemeral",
            "failing-approved-helper.sh",
          );
          await writeFile(
            failingApprovedHelper,
            [
              "#!/usr/bin/env bash",
              "set -euo pipefail",
              'echo "approved helper should not run for approval-freeze" >&2',
              "exit 1",
              "",
            ].join("\n"),
          );
          await chmod(failingApprovedHelper, 0o755);

          await expect(
            runLeaseHelper(skipHelperCtx, "write", {
              STATE: "failed",
              APPROVED_REVIEW_FILE: approvedReviewPath(
                skipHelperCtx.review.headSha,
              ),
              APPROVED_REVIEW_HELPER: bashPath(failingApprovedHelper),
              FINISHED_AT: "2026-06-05T00:05:00Z",
              FAILURE_PHASE: "approval-freeze",
              FAILURE_REASON: "Approval freeze failed",
              FAILURE_RECOVERABILITY: "recoverable",
              UPDATED_AT: "2026-06-05T00:05:00Z",
            }),
          ).resolves.toMatchObject({ stdout: `${skipHelperCtx.leaseFile}\n` });
        } finally {
          await cleanupFixture(skipHelperCtx);
        }
      },
      reducerFixtureTimeout,
    );

    it(
      "clears phase-inapplicable artifacts when a GitHub-post failure is refreshed",
      async () => {
        const ctx = await makeFixture();
        try {
          await failedGithubPostLease(ctx);
          await writeState(ctx, "failed", {
            RESULT_FILE: resultPath(ctx.review.headSha),
            FINISHED_AT: "2026-06-05T00:06:00Z",
            FAILURE_PHASE: "stale-head",
            FAILURE_REASON: "Head changed before retry",
            FAILURE_RECOVERABILITY: "recoverable",
            UPDATED_AT: "2026-06-05T00:06:00Z",
          });

          expect(await readJson(ctx.primary.cwd, ctx.leaseFile)).toMatchObject({
            state: "failed",
            artifacts: {
              result_file: resultPath(ctx.review.headSha),
              approved_review_file: null,
            },
            failure: { phase: "stale-head" },
            github: {
              github_post_attempted: false,
              github_post_result: "not-attempted",
              github_posted_at: null,
            },
          });
        } finally {
          await cleanupFixture(ctx);
        }
      },
      reducerFixtureTimeout,
    );

    it(
      "does not archive a terminal lease until the fresh created lease validates",
      async () => {
        const ctx = await makeFixture();
        try {
          await gatedLease(ctx);
          await writeState(ctx, "posted", {
            APPROVED_REVIEW_FILE: approvedReviewPath(ctx.review.headSha),
            FINISHED_AT: "2026-06-05T00:06:00Z",
            GITHUB_POSTED_AT: "2026-06-05T00:06:00Z",
            UPDATED_AT: "2026-06-05T00:06:00Z",
          });

          await expect(
            runLeaseHelper(ctx, "write", {
              STATE: "created",
              CREATED_AT: "2026-99-05T00:00:00Z",
              UPDATED_AT: "2026-06-05T00:08:00Z",
            }),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining(
              "created_at is not a valid UTC timestamp",
            ),
          });

          expect(await readJson(ctx.primary.cwd, ctx.leaseFile)).toMatchObject({
            state: "posted",
          });
          const archived = await readdir(
            path.join(ctx.primary.cwd, ".ephemeral"),
          );
          expect(
            archived.filter((entry) =>
              entry.endsWith("-posted-archived-lease.json"),
            ),
          ).toHaveLength(0);
        } finally {
          await cleanupFixture(ctx);
        }
      },
      reducerFixtureTimeout,
    );

    it(
      "leaves the prior terminal lease active when LC-18 archive preparation fails",
      async () => {
        const ctx = await makeFixture();
        try {
          await gatedLease(ctx);
          await writeState(ctx, "posted", {
            APPROVED_REVIEW_FILE: approvedReviewPath(ctx.review.headSha),
            FINISHED_AT: "2026-06-05T00:06:00Z",
            GITHUB_POSTED_AT: "2026-06-05T00:06:00Z",
            UPDATED_AT: "2026-06-05T00:06:00Z",
          });
          await expect(
            runLeaseHelper(ctx, "write", {
              STATE: "created",
              REVIEW_LEASE_ENABLE_TEST_HOOKS: "yes",
              REVIEW_LEASE_TEST_FAIL_ARCHIVE_PREPARATION: "yes",
              UPDATED_AT: "2026-06-05T00:08:00Z",
            }),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining(
              "test requested archive preparation failure",
            ),
          });

          expect(await readJson(ctx.primary.cwd, ctx.leaseFile)).toMatchObject({
            state: "posted",
          });
        } finally {
          await cleanupFixture(ctx);
        }
      },
      reducerFixtureTimeout,
    );

    it(
      "keeps the terminal archive discoverable when LC-18 active lease write fails after archive",
      async () => {
        const ctx = await makeFixture();
        try {
          await gatedLease(ctx);
          await writeState(ctx, "aborted", {
            FINISHED_AT: "2026-06-05T00:06:00Z",
            TERMINAL_REASON: "User aborted",
            UPDATED_AT: "2026-06-05T00:06:00Z",
          });

          await expect(
            runLeaseHelper(ctx, "write", {
              STATE: "created",
              REVIEW_LEASE_ENABLE_TEST_HOOKS: "yes",
              REVIEW_LEASE_TEST_FAIL_ACTIVE_WRITE_AFTER_ARCHIVE: "yes",
              UPDATED_AT: "2026-06-05T00:08:00Z",
            }),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining(
              "test requested active lease write failure after archive",
            ),
          });

          await expect(
            readFile(path.join(ctx.primary.cwd, ctx.leaseFile), "utf8"),
          ).rejects.toMatchObject({ code: "ENOENT" });
          const archived = await readdir(
            path.join(ctx.primary.cwd, ".ephemeral"),
          );
          const archivedLeases = archived.filter((entry) =>
            entry.endsWith("-aborted-archived-lease.json"),
          );
          expect(archivedLeases).toHaveLength(1);
          expect(
            await readJson(ctx.primary.cwd, `.ephemeral/${archivedLeases[0]}`),
          ).toMatchObject({ state: "aborted" });
        } finally {
          await cleanupFixture(ctx);
        }
      },
      reducerFixtureTimeout,
    );
  },
);
