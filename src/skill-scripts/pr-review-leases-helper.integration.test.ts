import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  access,
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
import { cleanupTempDir } from "../__test-helpers__/fixtures.js";

const execFileAsync = promisify(execFile);
const helperScript = path.join(
  process.cwd(),
  "skills/pr-review/scripts/review-leases.sh",
);
const manifestHelperScript = path.join(
  process.cwd(),
  "skills/pr-review/scripts/review-manifests.sh",
);
const bashExecutable = resolveBashExecutable();
const jqAvailable = await commandAvailable("jq");
const prNumber = "382";
const repository = "owner/repo";
const createdAt = "2026-06-05T00:00:00Z";
const updatedAt = "2026-06-05T00:01:00Z";
const longTestTimeout = process.platform === "win32" ? 240_000 : 20_000;
async function commandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync(bashExecutable, ["-c", `command -v ${command}`]);
    return true;
  } catch {
    return false;
  }
}

function resolveBashExecutable() {
  if (process.platform !== "win32") {
    return "bash";
  }
  const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
  return existsSync(gitBash) ? gitBash : "bash";
}

async function makeGitWorkspace(prefix: string) {
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
  await mkdir(path.join(cwd, "docs/guidelines"), { recursive: true });
  await writeFile(path.join(cwd, "docs/guidelines/app.md"), "# App\n");
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync("git", ["commit", "-m", "feat: add app"], { cwd });
  const headSha = await git(cwd, "rev-parse", "HEAD");
  await mkdir(path.join(cwd, ".ephemeral"));
  return { cwd, baseSha, headSha };
}

type GitWorkspace = Awaited<ReturnType<typeof makeGitWorkspace>>;

async function makeLinkedReviewWorkspace(prefix: string) {
  const primary = await makeGitWorkspace(`${prefix}primary-`);
  const linked = await addLinkedReviewWorktree(primary, prefix);
  return { primary, ...linked };
}

async function addLinkedReviewWorktree(primary: GitWorkspace, prefix: string) {
  const logicalParent = await mkdtemp(path.join(os.tmpdir(), `${prefix}wt-`));
  const parent = await realpath(logicalParent);
  const reviewPath = path.join(parent, "review");
  const branch = `review-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  await execFileAsync(
    "git",
    ["worktree", "add", "-b", branch, reviewPath, "HEAD"],
    { cwd: primary.cwd },
  );
  const review = {
    cwd: await realpath(reviewPath),
    baseSha: primary.baseSha,
    headSha: await git(reviewPath, "rev-parse", "HEAD"),
  };
  await mkdir(path.join(review.cwd, ".ephemeral"), { recursive: true });
  return { review, parent };
}

async function cleanupLinkedReviewWorkspace(
  primary: { cwd: string },
  review: { cwd: string },
  parent: string,
) {
  await execFileAsync("git", ["worktree", "remove", review.cwd], {
    cwd: primary.cwd,
  }).catch(() => undefined);
  await cleanupTempDir(parent);
  await cleanupTempDir(primary.cwd);
}

async function git(cwd: string, ...args: string[]) {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function bashPhysicalCwd(cwd: string) {
  const { stdout } = await execFileAsync(bashExecutable, ["-lc", "pwd -P"], {
    cwd,
  });
  return stdout.trim();
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function leaseDigest(worktreePath: string) {
  let normalized = bashPhysicalPath(worktreePath).replace(/\\/gu, "/");
  if (process.platform === "win32") {
    normalized = normalized.replace(
      /^\/([A-Za-z])\//u,
      (_match, drive: string) => `${drive}:/`,
    );
    if (/^[A-Za-z]:\//u.test(normalized)) {
      normalized = normalized.toLowerCase();
    }
  }
  return createHash("sha256").update(normalized).digest("hex");
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
  if (usesGitBash()) {
    return `/${driveMatch[1].toLowerCase()}/${driveMatch[2]}`;
  }
  return `/mnt/${driveMatch[1].toLowerCase()}/${driveMatch[2]}`;
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

function artifactAbsolutePath(filePath: string) {
  if (process.platform !== "win32") {
    return filePath;
  }
  return filePath.replace(/\\/gu, "/");
}

function bashPathEnv(env: NodeJS.ProcessEnv) {
  const pathKeys = [
    "APPROVED_REVIEW_HELPER",
    "EXECUTION_WORKING_DIRECTORY",
    "PLAY_REVIEW_HELPER",
    "PRIMARY_REPOSITORY_ROOT",
    "REVIEW_MANIFEST_HELPER",
    "WORKTREE_PATH",
  ];
  const normalized = { ...env };
  for (const key of pathKeys) {
    if (normalized[key]) {
      normalized[key] = bashPath(normalized[key]);
    }
  }
  return normalized;
}

async function acceptedPhysicalRoots(cwd: string) {
  return Array.from(
    new Set([cwd, await bashPhysicalCwd(cwd)].map(normalizePathText)),
  );
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

function leasePath(worktreePath: string) {
  return `.ephemeral/pr-${prNumber}-${leaseDigest(worktreePath)}-lease.json`;
}

function shellSingleQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function runBashScript(
  cwd: string,
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (name === "PATH" || name === "Path") {
      continue;
    }
    if (value !== undefined && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
      lines.push(`export ${name}=${shellSingleQuote(value)}`);
    }
  }
  const envFile = path.join(
    cwd,
    ".ephemeral",
    `.lease-env-${process.pid}-${randomUUID()}.sh`,
  );
  await writeFile(envFile, `${lines.join("\n")}\n`);
  const command = [
    `source ${shellSingleQuote(bashPath(envFile))}`,
    `exec ${shellSingleQuote(bashPath(bashExecutable))} ${shellSingleQuote(bashPath(script))} ${args
      .map((arg) => shellSingleQuote(arg))
      .join(" ")}`,
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

function removeToken(worktreePath: string) {
  return `remove-pr-review-worktree-${prNumber}-${leaseDigest(worktreePath)}`;
}

function slugBranch(branchName: string) {
  return branchName.replaceAll(/[^A-Za-z0-9._-]/gu, "-");
}

function scopePath(branchName: string, headSha: string) {
  return `.ephemeral/${slugBranch(branchName)}-${headSha}-scope-decision.json`;
}

function findingsPath(headSha: string, branchName = "topic") {
  return `.ephemeral/${slugBranch(branchName)}-${headSha}-findings.json`;
}

function reviewBodyPath(headSha: string, branchName = "topic") {
  return `.ephemeral/${slugBranch(branchName)}-${headSha}-review-body.md`;
}

function handoffPath(headSha: string) {
  return `.ephemeral/pr-${prNumber}-${headSha}-handoff.json`;
}

function resultPath(headSha: string) {
  return `.ephemeral/pr-${prNumber}-${headSha}-result.json`;
}

function approvedReviewPath(headSha: string, branchName = "topic") {
  return `.ephemeral/${slugBranch(branchName)}-${headSha}-approved-review.json`;
}

function leaseHandoffArtifact(worktree: string, headSha: string) {
  return {
    repository,
    pr_number: Number(prNumber),
    base_ref: "main",
    head_ref: "topic",
    execution: {
      working_directory: artifactAbsolutePath(worktree),
    },
    review_head_sha: headSha,
  };
}

function leaseResultArtifact(headSha: string) {
  return {
    repository,
    pr_number: Number(prNumber),
    review_head_sha: headSha,
    handoff_file: handoffPath(headSha),
  };
}

async function writeLeaseIdentityArtifacts(review: GitWorkspace) {
  await writeJson(
    review.cwd,
    handoffPath(review.headSha),
    leaseHandoffArtifact(review.cwd, review.headSha),
  );
  await writeJson(
    review.cwd,
    resultPath(review.headSha),
    leaseResultArtifact(review.headSha),
  );
}

function initialScope(baseSha: string, headSha: string) {
  return {
    schema: "pr-review/scope-decision/v1",
    surface: "pr-review",
    mode: "initial",
    head_sha: headSha,
    full_range: `${baseSha}...HEAD`,
    selected_range: `${baseSha}...HEAD`,
    candidate_narrow_range: `${baseSha}...HEAD`,
    last_reviewed_sha: null,
    is_followup_narrow: false,
    selection_reason: "Initial review uses the full review range.",
    changed_files: ["docs/guidelines/app.md"],
    language_hints: ["md"],
    escalation_reasons: ["not-followup"],
    prior_context: { kind: "none", path: null },
    mechanical_facts: {
      changed_file_count: 1,
      followup_sha_usable: false,
      mechanical_escalate_full: true,
      mechanical_escalation_reason: "not-followup",
    },
    semantic_decision: { checked: true, ambiguous: false, notes: "" },
  };
}

function findingsEnvelope() {
  return {
    schema: "play-review/findings/v1",
    findings: [],
    carry_forward: [],
  };
}

async function writeJson(cwd: string, relPath: string, value: unknown) {
  await mkdir(path.dirname(path.join(cwd, relPath)), { recursive: true });
  await writeFile(path.join(cwd, relPath), JSON.stringify(value, null, 2));
}

async function readJson(cwd: string, relPath: string) {
  return JSON.parse(await readFile(path.join(cwd, relPath), "utf8"));
}

async function leaseTempFiles(cwd: string, worktreePath: string) {
  const ephemeralPath = path.join(cwd, ".ephemeral");
  const prefix = `.lease-${prNumber}-${leaseDigest(worktreePath)}.`;
  const entries = await readdir(ephemeralPath);
  return entries.filter((entry) => entry.startsWith(prefix)).sort();
}

async function writePassingPlayHelper(cwd: string) {
  const helper = path.join(cwd, ".ephemeral/play-review-helper.sh");
  await writeFile(
    helper,
    ["#!/usr/bin/env bash", "set -euo pipefail", "exit 0", ""].join("\n"),
  );
  await chmod(helper, 0o755);
  return helper;
}

async function writePassingManifestHelper(cwd: string) {
  const helper = path.join(cwd, ".ephemeral/review-manifest-helper.sh");
  await writeFile(
    helper,
    ["#!/usr/bin/env bash", "set -euo pipefail", "exit 0", ""].join("\n"),
  );
  await chmod(helper, 0o755);
  return helper;
}

async function writeRecordingPlayHelper(cwd: string) {
  const helper = path.join(cwd, ".ephemeral/recording-play-helper.sh");
  await writeFile(
    helper,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'printf "%s\\n" "$@" > ".ephemeral/play-helper-args.txt"',
      'printf "%s\\n" "${HEAD_SHA:-}" > ".ephemeral/play-helper-head.txt"',
      'printf "%s\\n" "${FINDINGS_FILE:-}" > ".ephemeral/play-helper-findings.txt"',
      "exit 0",
      "",
    ].join("\n"),
  );
  await chmod(helper, 0o755);
  return helper;
}

async function writeRecordingApprovedHelper(cwd: string) {
  const helper = path.join(cwd, ".ephemeral/recording-approved-helper.sh");
  await writeFile(
    helper,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'printf "%s\\n" "$@" > ".ephemeral/approved-helper-args.txt"',
      'printf "%s\\n" "${BASE_REF:-}" > ".ephemeral/approved-helper-base.txt"',
      'printf "%s\\n" "${HEAD_SHA:-}" > ".ephemeral/approved-helper-head.txt"',
      'printf "%s\\n" "${APPROVED_REVIEW_FILE:-}" > ".ephemeral/approved-helper-file.txt"',
      "exit 0",
      "",
    ].join("\n"),
  );
  await chmod(helper, 0o755);
  return helper;
}

async function writeValidReviewManifests(
  worktree: string,
  baseSha: string,
  headSha: string,
) {
  const branchName = await git(worktree, "branch", "--show-current");
  const scopeDecisionPath = scopePath(branchName || "detached", headSha);
  await writeJson(worktree, scopeDecisionPath, initialScope(baseSha, headSha));
  await writeJson(
    worktree,
    findingsPath(headSha, branchName),
    findingsEnvelope(),
  );
  await writeFile(
    path.join(worktree, reviewBodyPath(headSha, branchName)),
    "Review body\n",
  );
  const playHelper = await writePassingPlayHelper(worktree);
  await runBashScript(worktree, manifestHelperScript, ["write-handoff"], {
    ...process.env,
    PR_NUMBER: prNumber,
    HEAD_SHA: headSha,
    REPOSITORY: repository,
    EXECUTION_WORKING_DIRECTORY: artifactAbsolutePath(worktree),
    BASE_REF: "main",
    HEAD_REF: "topic",
    REVIEW_SCOPE_BASE_REF: baseSha,
    ACTIVE_DIFF_RANGE: `${baseSha}...HEAD`,
    FULL_PR_DIFF_RANGE: `${baseSha}...HEAD`,
    MODE: "github-post",
    LANGUAGE_HINTS_JSON: '["md"]',
    FOLLOW_UP_STATE: "initial",
    IS_FOLLOWUP_NARROW: "false",
    SCOPE_DECISION_FILE: scopeDecisionPath,
  });
  await runBashScript(worktree, manifestHelperScript, ["write-result"], {
    ...process.env,
    PR_NUMBER: prNumber,
    HEAD_SHA: headSha,
    REPOSITORY: repository,
    FINDINGS_FILE: findingsPath(headSha, branchName),
    SCOPE_DECISION_FILE: scopeDecisionPath,
    REVIEW_BODY_FILE: reviewBodyPath(headSha, branchName),
    PRESENTATION_STATUS: "preview-current",
    PLAY_REVIEW_HELPER: bashPath(playHelper),
  });
  return { branchName, scopeDecisionPath };
}

async function runLeaseHelper(
  cwd: string,
  command: string,
  env: NodeJS.ProcessEnv = {},
) {
  return await runBashScript(cwd, helperScript, [command], {
    ...process.env,
    REPOSITORY: repository,
    PR_NUMBER: prNumber,
    PRIMARY_REPOSITORY_ROOT: bashPath(cwd),
    BASE_REF: "main",
    HEAD_REF: "topic",
    CREATED_AT: createdAt,
    UPDATED_AT: updatedAt,
    ...bashPathEnv(env),
  });
}

async function writeCreatedLease(primary: string, worktree: string) {
  const file = leasePath(worktree);
  await runLeaseHelper(primary, "write", {
    WORKTREE_PATH: worktree,
    LEASE_FILE: file,
    STATE: "created",
  });
  return file;
}

async function writeGatedLease(primary: string, review: GitWorkspace) {
  await writeLeaseIdentityArtifacts(review);
  const manifestHelper = await writePassingManifestHelper(review.cwd);
  await execFileAsync("git", ["add", ".ephemeral"], { cwd: review.cwd });
  await execFileAsync("git", ["commit", "-m", "test: add review artifacts"], {
    cwd: review.cwd,
  });

  const file = await writeCreatedLease(primary, review.cwd);
  await runLeaseHelper(primary, "write", {
    WORKTREE_PATH: review.cwd,
    LEASE_FILE: file,
    REVIEW_MANIFEST_HELPER: manifestHelper,
    STATE: "created",
    HANDOFF_FILE: handoffPath(review.headSha),
  });
  await runLeaseHelper(primary, "write", {
    WORKTREE_PATH: review.cwd,
    LEASE_FILE: file,
    REVIEW_MANIFEST_HELPER: manifestHelper,
    STATE: "reviewed",
    RESULT_FILE: resultPath(review.headSha),
  });
  await runLeaseHelper(primary, "write", {
    WORKTREE_PATH: review.cwd,
    LEASE_FILE: file,
    REVIEW_MANIFEST_HELPER: manifestHelper,
    STATE: "gated",
    PRESENTED_AT: "2026-06-05T00:03:00Z",
    PRESENTATION_STATUS: "preview-current",
  });
  return file;
}

describe.skipIf(!jqAvailable)("pr-review lease helper", () => {
  it("derives a deterministic primary-repo lease path from PR and physical worktree identity", async () => {
    const primary = await makeGitWorkspace("devcanon-pr-lease-primary-");
    const review = await makeGitWorkspace("devcanon-pr-lease-review-");
    try {
      await expect(
        runLeaseHelper(primary.cwd, "derive-path", {
          WORKTREE_PATH: review.cwd,
        }),
      ).resolves.toMatchObject({
        stdout: `${leasePath(review.cwd)}\n`,
      });
      await expect(
        runLeaseHelper(primary.cwd, "derive-path", {
          REPOSITORY: "owner repo",
          WORKTREE_PATH: review.cwd,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("REPOSITORY must be owner/name"),
      });
      await expect(
        runLeaseHelper(primary.cwd, "derive-path", {
          PR_NUMBER: "0",
          WORKTREE_PATH: review.cwd,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("PR_NUMBER must be a positive integer"),
      });
      await expect(
        runLeaseHelper(primary.cwd, "derive-path", {
          WORKTREE_PATH: ".",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("WORKTREE_PATH must be absolute"),
      });
    } finally {
      await cleanupTempDir(primary.cwd);
      await cleanupTempDir(review.cwd);
    }
  });

  it("writes and silently validates a closed created lease schema", async () => {
    const primary = await makeGitWorkspace("devcanon-pr-lease-primary-");
    const review = await makeGitWorkspace("devcanon-pr-lease-review-");
    try {
      const file = await writeCreatedLease(primary.cwd, review.cwd);
      const acceptedRoots = await acceptedPhysicalRoots(review.cwd);
      await expect(
        runLeaseHelper(primary.cwd, "validate", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
        }),
      ).resolves.toMatchObject({ stdout: "" });
      const lease = await readJson(primary.cwd, file);
      expect(lease).toMatchObject({
        schema: "pr-review/lease/v1",
        repository,
        pr_number: Number(prNumber),
        state: "created",
        base_ref: "main",
        head_ref: "topic",
        worktree_digest: leaseDigest(review.cwd),
        lease_file: file,
        created_at: createdAt,
        updated_at: updatedAt,
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
        },
        github: {
          github_post_attempted: false,
          github_post_result: "not-attempted",
          github_posted_at: null,
        },
      });
      expect(acceptedRoots).toContain(normalizePathText(lease.worktree_path));
      await expect(readJson(primary.cwd, file)).resolves.not.toHaveProperty(
        "cleanup",
      );

      await writeJson(primary.cwd, file, { ...lease, extra: true });
      await expect(
        runLeaseHelper(primary.cwd, "validate", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("lease schema mismatch"),
      });

      await writeJson(primary.cwd, file, {
        ...lease,
        cleanup: { last_outcome: "removed", last_checked_at: updatedAt },
      });
      await expect(
        runLeaseHelper(primary.cwd, "validate", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
        }),
      ).resolves.toMatchObject({ stdout: "" });

      await writeJson(primary.cwd, file, {
        ...lease,
        cleanup: { last_outcome: "unsafe", last_checked_at: updatedAt },
      });
      await expect(
        runLeaseHelper(primary.cwd, "validate", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("lease schema mismatch"),
      });
    } finally {
      await cleanupTempDir(primary.cwd);
      await cleanupTempDir(review.cwd);
    }
  });

  it("rejects impossible UTC timestamp dates and times", async () => {
    const primary = await makeGitWorkspace("devcanon-pr-lease-primary-");
    const review = await makeGitWorkspace("devcanon-pr-lease-review-");
    try {
      await expect(
        runLeaseHelper(primary.cwd, "write", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: leasePath(review.cwd),
          STATE: "created",
          CREATED_AT: "2026-99-05T00:00:00Z",
          UPDATED_AT: updatedAt,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "created_at is not a valid UTC timestamp",
        ),
      });

      const file = await writeCreatedLease(primary.cwd, review.cwd);
      const lease = await readJson(primary.cwd, file);
      await writeJson(primary.cwd, file, {
        ...lease,
        updated_at: "2026-06-05T99:00:00Z",
      });
      await expect(
        runLeaseHelper(primary.cwd, "validate", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "updated_at is not a valid UTC timestamp",
        ),
      });
    } finally {
      await cleanupTempDir(primary.cwd);
      await cleanupTempDir(review.cwd);
    }
  });

  it(
    "enforces allowed transitions and rejects terminal-state reopening",
    async () => {
      const primary = await makeGitWorkspace("devcanon-pr-lease-primary-");
      const review = await makeGitWorkspace("devcanon-pr-lease-review-");
      try {
        await writeLeaseIdentityArtifacts(review);
        const manifestHelper = await writePassingManifestHelper(review.cwd);
        const file = await writeCreatedLease(primary.cwd, review.cwd);

        await expect(
          runLeaseHelper(primary.cwd, "write", {
            WORKTREE_PATH: review.cwd,
            LEASE_FILE: file,
            REVIEW_MANIFEST_HELPER: manifestHelper,
            STATE: "created",
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("invalid lease transition"),
        });
        await expect(
          runLeaseHelper(primary.cwd, "write", {
            WORKTREE_PATH: review.cwd,
            LEASE_FILE: file,
            STATE: "posted",
            RESULT_FILE: resultPath(review.headSha),
            APPROVED_REVIEW_FILE: approvedReviewPath(review.headSha),
            FINISHED_AT: "2026-06-05T00:02:00Z",
            GITHUB_POST_ATTEMPTED: "true",
            GITHUB_POST_RESULT: "succeeded",
            GITHUB_POSTED_AT: "2026-06-05T00:02:00Z",
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("invalid lease transition"),
        });

        await expect(
          runLeaseHelper(primary.cwd, "write", {
            WORKTREE_PATH: review.cwd,
            LEASE_FILE: file,
            REVIEW_MANIFEST_HELPER: manifestHelper,
            STATE: "created",
            HANDOFF_FILE: handoffPath(review.headSha),
          }),
        ).resolves.toMatchObject({ stdout: `${file}\n` });
        await expect(
          runLeaseHelper(primary.cwd, "write", {
            WORKTREE_PATH: review.cwd,
            LEASE_FILE: file,
            REVIEW_MANIFEST_HELPER: manifestHelper,
            STATE: "created",
            HANDOFF_FILE: handoffPath(review.headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("invalid lease transition"),
        });
        await expect(
          runLeaseHelper(primary.cwd, "write", {
            WORKTREE_PATH: review.cwd,
            LEASE_FILE: file,
            REVIEW_MANIFEST_HELPER: manifestHelper,
            STATE: "reviewed",
            RESULT_FILE: resultPath(review.headSha),
          }),
        ).resolves.toMatchObject({ stdout: `${file}\n` });
        await expect(
          runLeaseHelper(primary.cwd, "write", {
            WORKTREE_PATH: review.cwd,
            LEASE_FILE: file,
            REVIEW_MANIFEST_HELPER: manifestHelper,
            STATE: "gated",
            PRESENTED_AT: "2026-06-05T00:03:00Z",
            PRESENTATION_STATUS: "preview-current",
          }),
        ).resolves.toMatchObject({ stdout: `${file}\n` });
        await expect(readJson(primary.cwd, file)).resolves.toMatchObject({
          state: "gated",
          artifacts: {
            handoff_file: handoffPath(review.headSha),
            result_file: resultPath(review.headSha),
          },
          presentation: {
            presented_at: "2026-06-05T00:03:00Z",
            status: "preview-current",
          },
        });

        await expect(
          runLeaseHelper(primary.cwd, "write", {
            WORKTREE_PATH: review.cwd,
            LEASE_FILE: file,
            REVIEW_MANIFEST_HELPER: manifestHelper,
            STATE: "gated",
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("invalid lease transition"),
        });
        await expect(
          runLeaseHelper(primary.cwd, "write", {
            WORKTREE_PATH: review.cwd,
            LEASE_FILE: file,
            REVIEW_MANIFEST_HELPER: manifestHelper,
            STATE: "gated",
            PRESENTED_AT: "2026-06-05T00:03:30Z",
            PRESENTATION_STATUS: "edited",
          }),
        ).resolves.toMatchObject({ stdout: `${file}\n` });
        await runLeaseHelper(primary.cwd, "write", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          REVIEW_MANIFEST_HELPER: manifestHelper,
          STATE: "aborted",
          FINISHED_AT: "2026-06-05T00:04:00Z",
          TERMINAL_REASON: "User aborted review",
        });
        await expect(
          runLeaseHelper(primary.cwd, "write", {
            WORKTREE_PATH: review.cwd,
            LEASE_FILE: file,
            REVIEW_MANIFEST_HELPER: manifestHelper,
            STATE: "gated",
            PRESENTED_AT: "2026-06-05T00:05:00Z",
            PRESENTATION_STATUS: "edited",
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("invalid lease transition"),
        });
        await expect(
          runLeaseHelper(primary.cwd, "write", {
            WORKTREE_PATH: review.cwd,
            LEASE_FILE: file,
            REVIEW_MANIFEST_HELPER: manifestHelper,
            STATE: "aborted",
            FINISHED_AT: "2026-06-05T00:06:00Z",
            TERMINAL_REASON: "Rewrite terminal metadata",
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("invalid lease transition"),
        });
      } finally {
        await cleanupTempDir(primary.cwd);
        await cleanupTempDir(review.cwd);
      }
    },
    longTestTimeout,
  );

  it("allows reviewed leases to abort through terminal result validation", async () => {
    const primary = await makeGitWorkspace("devcanon-pr-lease-primary-");
    const review = await makeGitWorkspace("devcanon-pr-lease-review-");
    try {
      await writeLeaseIdentityArtifacts(review);
      const manifestHelper = await writePassingManifestHelper(review.cwd);
      const file = await writeCreatedLease(primary.cwd, review.cwd);

      await runLeaseHelper(primary.cwd, "write", {
        WORKTREE_PATH: review.cwd,
        LEASE_FILE: file,
        REVIEW_MANIFEST_HELPER: manifestHelper,
        STATE: "reviewed",
        RESULT_FILE: resultPath(review.headSha),
      });
      await expect(
        runLeaseHelper(primary.cwd, "write", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          REVIEW_MANIFEST_HELPER: manifestHelper,
          STATE: "aborted",
          FINISHED_AT: "2026-06-05T00:04:00Z",
          TERMINAL_REASON: "User aborted after review",
        }),
      ).resolves.toMatchObject({ stdout: `${file}\n` });
      await expect(readJson(primary.cwd, file)).resolves.toMatchObject({
        state: "aborted",
        artifacts: {
          result_file: resultPath(review.headSha),
        },
        terminal: {
          finished_at: "2026-06-05T00:04:00Z",
          reason: "User aborted after review",
        },
      });
    } finally {
      await cleanupTempDir(primary.cwd);
      await cleanupTempDir(review.cwd);
    }
  });

  it("preserves immutable base and head refs after lease creation", async () => {
    const primary = await makeGitWorkspace("devcanon-pr-lease-primary-");
    const review = await makeGitWorkspace("devcanon-pr-lease-review-");
    try {
      await writeLeaseIdentityArtifacts(review);
      const manifestHelper = await writePassingManifestHelper(review.cwd);
      const file = await writeCreatedLease(primary.cwd, review.cwd);

      await runLeaseHelper(primary.cwd, "write", {
        WORKTREE_PATH: review.cwd,
        LEASE_FILE: file,
        REVIEW_MANIFEST_HELPER: manifestHelper,
        STATE: "reviewed",
        RESULT_FILE: resultPath(review.headSha),
      });
      await runLeaseHelper(primary.cwd, "write", {
        WORKTREE_PATH: review.cwd,
        LEASE_FILE: file,
        REVIEW_MANIFEST_HELPER: manifestHelper,
        STATE: "gated",
        BASE_REF: "main",
        HEAD_REF: "topic",
        PRESENTED_AT: "2026-06-05T00:03:00Z",
        PRESENTATION_STATUS: "preview-current",
      });
      await expect(readJson(primary.cwd, file)).resolves.toMatchObject({
        base_ref: "main",
        head_ref: "topic",
      });
    } finally {
      await cleanupTempDir(primary.cwd);
      await cleanupTempDir(review.cwd);
    }
  });

  it("rejects repeated posted transitions from a terminal lease fixture", async () => {
    const primary = await makeGitWorkspace("devcanon-pr-lease-primary-");
    const review = await makeGitWorkspace("devcanon-pr-lease-review-");
    try {
      const physicalWorktree = await bashPhysicalCwd(review.cwd);
      const digest = leaseDigest(physicalWorktree);
      const file = leasePath(physicalWorktree);
      const manifestHelper = await writePassingManifestHelper(review.cwd);
      const approvedHelper = await writeRecordingApprovedHelper(review.cwd);
      await writeLeaseIdentityArtifacts(review);
      await writeJson(review.cwd, approvedReviewPath(review.headSha), {
        schema: "pr-review/approved-review/v1",
        review_head_sha: review.headSha,
      });
      await writeJson(primary.cwd, file, {
        schema: "pr-review/lease/v1",
        repository,
        pr_number: Number(prNumber),
        state: "posted",
        base_ref: "main",
        head_ref: "topic",
        worktree_path: physicalWorktree,
        worktree_digest: digest,
        lease_file: file,
        created_at: createdAt,
        updated_at: updatedAt,
        artifacts: {
          handoff_file: null,
          result_file: resultPath(review.headSha),
          approved_review_file: approvedReviewPath(review.headSha),
        },
        presentation: {
          presented_at: "2026-06-05T00:03:00Z",
          status: "preview-current",
        },
        terminal: {
          finished_at: "2026-06-05T00:04:00Z",
          reason: null,
        },
        failure: {
          phase: null,
          reason: null,
          recoverability: null,
        },
        github: {
          github_post_attempted: true,
          github_post_result: "succeeded",
          github_posted_at: "2026-06-05T00:04:00Z",
        },
      });

      await expect(
        runLeaseHelper(primary.cwd, "write", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          REVIEW_MANIFEST_HELPER: manifestHelper,
          APPROVED_REVIEW_HELPER: approvedHelper,
          STATE: "posted",
          APPROVED_REVIEW_FILE: approvedReviewPath(review.headSha),
          FINISHED_AT: "2026-06-05T00:05:00Z",
          GITHUB_POST_ATTEMPTED: "true",
          GITHUB_POST_RESULT: "succeeded",
          GITHUB_POSTED_AT: "2026-06-05T00:05:00Z",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("invalid lease transition"),
      });
    } finally {
      await cleanupTempDir(primary.cwd);
      await cleanupTempDir(review.cwd);
    }
  });

  it("rejects base ref mismatches without rewriting the lease or leaving temp residue", async () => {
    const primary = await makeGitWorkspace("devcanon-pr-lease-primary-");
    const review = await makeGitWorkspace("devcanon-pr-lease-review-");
    try {
      await writeLeaseIdentityArtifacts(review);
      const manifestHelper = await writePassingManifestHelper(review.cwd);
      const file = await writeCreatedLease(primary.cwd, review.cwd);
      const beforeContents = await readFile(
        path.join(primary.cwd, file),
        "utf8",
      );
      const beforeTemps = await leaseTempFiles(primary.cwd, review.cwd);

      await expect(
        runLeaseHelper(primary.cwd, "write", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          REVIEW_MANIFEST_HELPER: manifestHelper,
          STATE: "reviewed",
          BASE_REF: "release",
          RESULT_FILE: resultPath(review.headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("base_ref is immutable"),
      });
      await expect(
        readFile(path.join(primary.cwd, file), "utf8"),
      ).resolves.toBe(beforeContents);
      await expect(leaseTempFiles(primary.cwd, review.cwd)).resolves.toEqual(
        beforeTemps,
      );
    } finally {
      await cleanupTempDir(primary.cwd);
      await cleanupTempDir(review.cwd);
    }
  });

  it("rejects head ref mismatches without rewriting the lease or leaving temp residue", async () => {
    const primary = await makeGitWorkspace("devcanon-pr-lease-primary-");
    const review = await makeGitWorkspace("devcanon-pr-lease-review-");
    try {
      await writeLeaseIdentityArtifacts(review);
      const manifestHelper = await writePassingManifestHelper(review.cwd);
      const file = await writeCreatedLease(primary.cwd, review.cwd);
      const beforeContents = await readFile(
        path.join(primary.cwd, file),
        "utf8",
      );
      const beforeTemps = await leaseTempFiles(primary.cwd, review.cwd);

      await expect(
        runLeaseHelper(primary.cwd, "write", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          REVIEW_MANIFEST_HELPER: manifestHelper,
          STATE: "reviewed",
          HEAD_REF: "feature/other",
          RESULT_FILE: resultPath(review.headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("head_ref is immutable"),
      });
      await expect(
        readFile(path.join(primary.cwd, file), "utf8"),
      ).resolves.toBe(beforeContents);
      await expect(leaseTempFiles(primary.cwd, review.cwd)).resolves.toEqual(
        beforeTemps,
      );
    } finally {
      await cleanupTempDir(primary.cwd);
      await cleanupTempDir(review.cwd);
    }
  });

  it(
    "delegates referenced result validation through manifest and play-review authority",
    async () => {
      const primary = await makeGitWorkspace("devcanon-pr-lease-primary-");
      const review = await makeGitWorkspace("devcanon-pr-lease-review-");
      try {
        await writeValidReviewManifests(
          review.cwd,
          review.baseSha,
          review.headSha,
        );
        const recordingPlayHelper = await writeRecordingPlayHelper(review.cwd);
        const file = await writeCreatedLease(primary.cwd, review.cwd);
        await expect(
          runLeaseHelper(primary.cwd, "write", {
            WORKTREE_PATH: review.cwd,
            LEASE_FILE: file,
            STATE: "reviewed",
            RESULT_FILE: resultPath(review.headSha),
            PLAY_REVIEW_HELPER: recordingPlayHelper,
          }),
        ).resolves.toMatchObject({ stdout: `${file}\n` });

        await expect(
          readFile(
            path.join(review.cwd, ".ephemeral/play-helper-args.txt"),
            "utf8",
          ),
        ).resolves.toBe("validate-findings\n");
        await expect(
          readFile(
            path.join(review.cwd, ".ephemeral/play-helper-head.txt"),
            "utf8",
          ),
        ).resolves.toBe(`${review.headSha}\n`);
        await expect(
          readFile(
            path.join(review.cwd, ".ephemeral/play-helper-findings.txt"),
            "utf8",
          ),
        ).resolves.toBe(`${findingsPath(review.headSha)}\n`);

        await expect(
          runLeaseHelper(primary.cwd, "write", {
            WORKTREE_PATH: review.cwd,
            LEASE_FILE: file,
            STATE: "gated",
            RESULT_FILE: ".ephemeral/nested/result.json",
            PRESENTED_AT: "2026-06-05T00:03:00Z",
            PRESENTATION_STATUS: "preview-current",
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("nested result path rejected"),
        });
      } finally {
        await cleanupTempDir(primary.cwd);
        await cleanupTempDir(review.cwd);
      }
    },
    longTestTimeout,
  );

  it(
    "delegates approved-review validation without constructing payloads or mutating GitHub",
    async () => {
      const primary = await makeGitWorkspace("devcanon-pr-lease-primary-");
      const review = await makeGitWorkspace("devcanon-pr-lease-review-");
      try {
        await writeValidReviewManifests(
          review.cwd,
          review.baseSha,
          review.headSha,
        );
        await writeJson(review.cwd, approvedReviewPath(review.headSha), {
          schema: "pr-review/approved-review/v1",
          review_head_sha: review.headSha,
        });
        const manifestHelper = await writePassingManifestHelper(review.cwd);
        const approvedHelper = await writeRecordingApprovedHelper(review.cwd);
        const file = await writeCreatedLease(primary.cwd, review.cwd);
        await runLeaseHelper(primary.cwd, "write", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          REVIEW_MANIFEST_HELPER: manifestHelper,
          STATE: "reviewed",
          RESULT_FILE: resultPath(review.headSha),
        });
        await runLeaseHelper(primary.cwd, "write", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          REVIEW_MANIFEST_HELPER: manifestHelper,
          STATE: "gated",
          PRESENTED_AT: "2026-06-05T00:03:00Z",
          PRESENTATION_STATUS: "preview-current",
        });
        await expect(
          runLeaseHelper(primary.cwd, "write", {
            WORKTREE_PATH: review.cwd,
            LEASE_FILE: file,
            REVIEW_MANIFEST_HELPER: manifestHelper,
            STATE: "posted",
            APPROVED_REVIEW_FILE: approvedReviewPath(review.headSha),
            APPROVED_REVIEW_HELPER: approvedHelper,
            FINISHED_AT: "2026-06-05T00:04:00Z",
            GITHUB_POST_ATTEMPTED: "true",
            GITHUB_POST_RESULT: "succeeded",
            GITHUB_POSTED_AT: "2026-06-05T00:04:00Z",
          }),
        ).resolves.toMatchObject({ stdout: `${file}\n` });
        await expect(
          readFile(
            path.join(review.cwd, ".ephemeral/approved-helper-args.txt"),
            "utf8",
          ),
        ).resolves.toBe("validate-approved-review\n");
        await expect(
          readFile(
            path.join(review.cwd, ".ephemeral/approved-helper-file.txt"),
            "utf8",
          ),
        ).resolves.toBe(`${approvedReviewPath(review.headSha)}\n`);

        const helperSource = await readFile(helperScript, "utf8");
        expect(helperSource).not.toContain("gh ");
        expect(helperSource).not.toContain("build-github-review-payload");
        expect(helperSource).not.toContain("--force");
        expect(helperSource).not.toContain("rm -rf");
      } finally {
        await cleanupTempDir(primary.cwd);
        await cleanupTempDir(review.cwd);
      }
    },
    longTestTimeout,
  );

  it("inspects cleanup safety facts with fixed keys without removing the worktree", async () => {
    const { primary, review, parent } = await makeLinkedReviewWorkspace(
      "devcanon-pr-lease-cleanup-",
    );
    try {
      const file = await writeCreatedLease(primary.cwd, review.cwd);
      await expect(
        runLeaseHelper(primary.cwd, "inspect-worktree", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          EXPECTED_STATE: "created",
        }),
      ).resolves.toMatchObject({
        stdout: [
          "OUTCOME=inspect",
          "CAN_REMOVE=no",
          "REFUSAL_REASON=confirmation-required",
          "DIRTY=no",
          "LEASE_STATE=created",
          "IDENTITY_MATCH=yes",
          "REQUIRES_CONFIRMATION=yes",
          "",
        ].join("\n"),
      });
      await expect(pathExists(review.cwd)).resolves.toBe(true);
      await expect(readJson(primary.cwd, file)).resolves.toMatchObject({
        cleanup: {
          last_checked_at: expect.stringMatching(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u,
          ),
        },
      });
    } finally {
      await cleanupLinkedReviewWorkspace(primary, review, parent);
    }
  });

  it("retains dirty worktrees absolutely even with policy override and token", async () => {
    const { primary, review, parent } = await makeLinkedReviewWorkspace(
      "devcanon-pr-lease-cleanup-",
    );
    try {
      const file = await writeCreatedLease(primary.cwd, review.cwd);
      await writeFile(path.join(review.cwd, "dirty.txt"), "local change\n");

      await expect(
        runLeaseHelper(primary.cwd, "inspect-worktree", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
        }),
      ).resolves.toMatchObject({
        stdout: expect.stringContaining("DIRTY=yes\n"),
      });
      await expect(
        runLeaseHelper(primary.cwd, "cleanup-worktree", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          ALLOW_POLICY_OVERRIDE: "yes",
          CONFIRM_REMOVE_TOKEN: removeToken(review.cwd),
        }),
      ).resolves.toMatchObject({
        stdout: "OUTCOME=retained\nMESSAGE=dirty worktree retained\n",
      });
      await expect(pathExists(review.cwd)).resolves.toBe(true);
      await expect(readJson(primary.cwd, file)).resolves.toMatchObject({
        cleanup: { last_outcome: "retained" },
      });
    } finally {
      await cleanupTempDir(parent);
      await cleanupTempDir(primary.cwd);
    }
  });

  it("retains untracked .ephemeral artifacts before plain worktree removal", async () => {
    const { primary, review, parent } = await makeLinkedReviewWorkspace(
      "devcanon-pr-lease-cleanup-",
    );
    try {
      const file = await writeCreatedLease(primary.cwd, review.cwd);
      await writeFile(
        path.join(review.cwd, ".ephemeral/review-evidence.txt"),
        "untracked evidence\n",
      );

      await expect(
        runLeaseHelper(primary.cwd, "inspect-worktree", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
        }),
      ).resolves.toMatchObject({
        stdout: expect.stringContaining(
          "REFUSAL_REASON=untracked-artifacts\nDIRTY=no\n",
        ),
      });
      await expect(
        runLeaseHelper(primary.cwd, "cleanup-worktree", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          ALLOW_POLICY_OVERRIDE: "yes",
          CONFIRM_REMOVE_TOKEN: removeToken(review.cwd),
        }),
      ).resolves.toMatchObject({
        stdout:
          "OUTCOME=retained\nMESSAGE=untracked .ephemeral artifacts retained\n",
      });
      await expect(pathExists(review.cwd)).resolves.toBe(true);
      await expect(
        readFile(
          path.join(review.cwd, ".ephemeral/review-evidence.txt"),
          "utf8",
        ),
      ).resolves.toBe("untracked evidence\n");
    } finally {
      await cleanupTempDir(parent);
      await cleanupTempDir(primary.cwd);
    }
  });

  it("retains ignored .ephemeral artifacts before plain worktree removal", async () => {
    const { primary, review, parent } = await makeLinkedReviewWorkspace(
      "devcanon-pr-lease-cleanup-",
    );
    try {
      await writeFile(path.join(review.cwd, ".gitignore"), ".ephemeral/\n");
      await execFileAsync("git", ["add", ".gitignore"], { cwd: review.cwd });
      await execFileAsync("git", ["commit", "-m", "test: ignore artifacts"], {
        cwd: review.cwd,
      });
      const file = await writeCreatedLease(primary.cwd, review.cwd);
      await writeFile(
        path.join(review.cwd, ".ephemeral/ignored-evidence.txt"),
        "ignored evidence\n",
      );

      await expect(
        runLeaseHelper(primary.cwd, "inspect-worktree", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
        }),
      ).resolves.toMatchObject({
        stdout: expect.stringContaining(
          "REFUSAL_REASON=untracked-artifacts\nDIRTY=no\n",
        ),
      });
      await expect(
        runLeaseHelper(primary.cwd, "cleanup-worktree", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          ALLOW_POLICY_OVERRIDE: "yes",
          CONFIRM_REMOVE_TOKEN: removeToken(review.cwd),
        }),
      ).resolves.toMatchObject({
        stdout:
          "OUTCOME=retained\nMESSAGE=untracked .ephemeral artifacts retained\n",
      });
      await expect(pathExists(review.cwd)).resolves.toBe(true);
      await expect(
        readFile(
          path.join(review.cwd, ".ephemeral/ignored-evidence.txt"),
          "utf8",
        ),
      ).resolves.toBe("ignored evidence\n");
    } finally {
      await cleanupTempDir(parent);
      await cleanupTempDir(primary.cwd);
    }
  });

  it("allows clean removal with an empty ignored .ephemeral directory and a valid token", async () => {
    const { primary, review, parent } = await makeLinkedReviewWorkspace(
      "devcanon-pr-lease-cleanup-",
    );
    try {
      await writeFile(path.join(review.cwd, ".gitignore"), ".ephemeral/\n");
      await execFileAsync("git", ["add", ".gitignore"], { cwd: review.cwd });
      await execFileAsync("git", ["commit", "-m", "test: ignore artifacts"], {
        cwd: review.cwd,
      });
      const file = await writeCreatedLease(primary.cwd, review.cwd);

      await expect(
        runLeaseHelper(primary.cwd, "inspect-worktree", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
        }),
      ).resolves.toMatchObject({
        stdout: expect.stringContaining(
          "REFUSAL_REASON=confirmation-required\nDIRTY=no\n",
        ),
      });
      await expect(
        runLeaseHelper(primary.cwd, "cleanup-worktree", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          ALLOW_POLICY_OVERRIDE: "yes",
          CONFIRM_REMOVE_TOKEN: removeToken(review.cwd),
        }),
      ).resolves.toMatchObject({
        stdout: "OUTCOME=removed\nMESSAGE=worktree removed\n",
      });
      await expect(pathExists(review.cwd)).resolves.toBe(false);
    } finally {
      await cleanupLinkedReviewWorkspace(primary, review, parent);
    }
  });

  it("treats an absent .ephemeral directory as no cleanup artifact residue", async () => {
    const { primary, review, parent } = await makeLinkedReviewWorkspace(
      "devcanon-pr-lease-cleanup-",
    );
    try {
      const file = await writeCreatedLease(primary.cwd, review.cwd);
      await rm(path.join(review.cwd, ".ephemeral"), {
        recursive: true,
        force: true,
      });

      await expect(
        runLeaseHelper(primary.cwd, "inspect-worktree", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
        }),
      ).resolves.toMatchObject({
        stdout: expect.stringContaining(
          "REFUSAL_REASON=confirmation-required\nDIRTY=no\n",
        ),
      });
      await expect(
        runLeaseHelper(primary.cwd, "cleanup-worktree", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          ALLOW_POLICY_OVERRIDE: "yes",
          CONFIRM_REMOVE_TOKEN: removeToken(review.cwd),
        }),
      ).resolves.toMatchObject({
        stdout: "OUTCOME=removed\nMESSAGE=worktree removed\n",
      });
      await expect(pathExists(review.cwd)).resolves.toBe(false);
    } finally {
      await cleanupLinkedReviewWorkspace(primary, review, parent);
    }
  });

  it("retains deleted tracked .ephemeral artifacts during cleanup inspection", async () => {
    const { primary, review, parent } = await makeLinkedReviewWorkspace(
      "devcanon-pr-lease-cleanup-",
    );
    try {
      await writeFile(path.join(review.cwd, ".ephemeral/tracked.txt"), "x\n");
      await execFileAsync("git", ["add", ".ephemeral/tracked.txt"], {
        cwd: review.cwd,
      });
      await execFileAsync("git", ["commit", "-m", "test: track artifact"], {
        cwd: review.cwd,
      });
      const file = await writeCreatedLease(primary.cwd, review.cwd);
      await rm(path.join(review.cwd, ".ephemeral"), {
        recursive: true,
        force: true,
      });

      await expect(
        runLeaseHelper(primary.cwd, "inspect-worktree", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
        }),
      ).resolves.toMatchObject({
        stdout: expect.stringContaining(
          "REFUSAL_REASON=untracked-artifacts\nDIRTY=no\n",
        ),
      });
      await expect(
        runLeaseHelper(primary.cwd, "cleanup-worktree", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          ALLOW_POLICY_OVERRIDE: "yes",
          CONFIRM_REMOVE_TOKEN: removeToken(review.cwd),
        }),
      ).resolves.toMatchObject({
        stdout:
          "OUTCOME=retained\nMESSAGE=untracked .ephemeral artifacts retained\n",
      });
      await expect(pathExists(review.cwd)).resolves.toBe(true);
    } finally {
      await cleanupLinkedReviewWorkspace(primary, review, parent);
    }
  });

  it("reports invalid lease mechanics through fixed inspect and cleanup outputs", async () => {
    const { primary, review, parent } = await makeLinkedReviewWorkspace(
      "devcanon-pr-lease-cleanup-",
    );
    try {
      const file = await writeCreatedLease(primary.cwd, review.cwd);
      const lease = await readJson(primary.cwd, file);
      await writeJson(primary.cwd, file, { ...lease, extra: true });

      await expect(
        runLeaseHelper(primary.cwd, "inspect-worktree", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
        }),
      ).resolves.toMatchObject({
        stdout: [
          "OUTCOME=inspect",
          "CAN_REMOVE=no",
          "REFUSAL_REASON=invalid-lease",
          "DIRTY=no",
          "LEASE_STATE=invalid",
          "IDENTITY_MATCH=no",
          "REQUIRES_CONFIRMATION=no",
          "",
        ].join("\n"),
      });
      await expect(
        runLeaseHelper(primary.cwd, "cleanup-worktree", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          ALLOW_POLICY_OVERRIDE: "yes",
          CONFIRM_REMOVE_TOKEN: removeToken(review.cwd),
        }),
      ).resolves.toMatchObject({
        stdout: expect.stringContaining(
          "OUTCOME=failed\nMESSAGE=invalid lease mechanics: lease schema mismatch:",
        ),
      });
      await expect(pathExists(review.cwd)).resolves.toBe(true);

      await writeJson(primary.cwd, file, {
        ...lease,
        updated_at: "2026-06-05T99:00:00Z",
      });
      await expect(
        runLeaseHelper(primary.cwd, "cleanup-worktree", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          ALLOW_POLICY_OVERRIDE: "yes",
          CONFIRM_REMOVE_TOKEN: removeToken(review.cwd),
        }),
      ).resolves.toMatchObject({
        stdout: expect.stringContaining(
          "OUTCOME=failed\nMESSAGE=invalid lease mechanics: updated_at is not a valid UTC timestamp",
        ),
      });
      await expect(pathExists(review.cwd)).resolves.toBe(true);
    } finally {
      await cleanupLinkedReviewWorkspace(primary, review, parent);
    }
  });

  it("sanitizes malformed lease JSON into a single cleanup message line", async () => {
    const { primary, review, parent } = await makeLinkedReviewWorkspace(
      "devcanon-pr-lease-invalid-",
    );
    try {
      const file = await writeCreatedLease(primary.cwd, review.cwd);
      await writeFile(path.join(primary.cwd, file), "{not valid json\n");

      const result = await runLeaseHelper(primary.cwd, "cleanup-worktree", {
        WORKTREE_PATH: review.cwd,
        LEASE_FILE: file,
        ALLOW_POLICY_OVERRIDE: "no",
        CONFIRM_REMOVE_TOKEN: "",
      });
      expect(result.stdout).toMatch(
        /^OUTCOME=failed\nMESSAGE=invalid lease mechanics: [^\n]+\n$/u,
      );
      expect(result.stdout).not.toContain("\njq:");
      await expect(pathExists(review.cwd)).resolves.toBe(true);
    } finally {
      await cleanupLinkedReviewWorkspace(primary, review, parent);
    }
  });

  it("retains gated leases without a valid token and removes only with a valid token", async () => {
    const { primary, review, parent } = await makeLinkedReviewWorkspace(
      "devcanon-pr-lease-cleanup-",
    );
    try {
      const file = await writeGatedLease(primary.cwd, review);

      await expect(
        runLeaseHelper(primary.cwd, "cleanup-worktree", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          ALLOW_POLICY_OVERRIDE: "no",
          CONFIRM_REMOVE_TOKEN: "",
        }),
      ).resolves.toMatchObject({
        stdout:
          "OUTCOME=retained\nMESSAGE=confirmation required for gated lease\n",
      });
      await expect(pathExists(review.cwd)).resolves.toBe(true);

      await expect(
        runLeaseHelper(primary.cwd, "cleanup-worktree", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          ALLOW_POLICY_OVERRIDE: "yes",
          CONFIRM_REMOVE_TOKEN: "wrong-token",
        }),
      ).resolves.toMatchObject({
        stdout:
          "OUTCOME=retained\nMESSAGE=confirmation token mismatch for gated lease\n",
      });
      await expect(pathExists(review.cwd)).resolves.toBe(true);

      await expect(
        runLeaseHelper(primary.cwd, "cleanup-worktree", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          ALLOW_POLICY_OVERRIDE: "yes",
          CONFIRM_REMOVE_TOKEN: removeToken(review.cwd),
        }),
      ).resolves.toMatchObject({
        stdout: "OUTCOME=removed\nMESSAGE=worktree removed\n",
      });
      await expect(pathExists(review.cwd)).resolves.toBe(false);
      await expect(readJson(primary.cwd, file)).resolves.toMatchObject({
        cleanup: { last_outcome: "removed" },
      });
    } finally {
      await cleanupLinkedReviewWorkspace(primary, review, parent);
    }
  });

  it("retains worktrees with untracked .ephemeral artifacts before plain removal can fail", async () => {
    const { primary, review, parent } = await makeLinkedReviewWorkspace(
      "devcanon-pr-lease-cleanup-",
    );
    try {
      const file = await writeGatedLease(primary.cwd, review);
      const manifestHelper = await writePassingManifestHelper(review.cwd);
      await runLeaseHelper(primary.cwd, "write", {
        WORKTREE_PATH: review.cwd,
        LEASE_FILE: file,
        REVIEW_MANIFEST_HELPER: manifestHelper,
        STATE: "aborted",
        FINISHED_AT: "2026-06-05T00:04:00Z",
        TERMINAL_REASON: "User aborted review",
      });
      const recoveryArtifact = path.join(
        review.cwd,
        ".ephemeral/untracked-recovery-artifact.txt",
      );
      await writeFile(recoveryArtifact, "preserve me\n");

      await expect(
        runLeaseHelper(primary.cwd, "inspect-worktree", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
        }),
      ).resolves.toMatchObject({
        stdout: expect.stringContaining(
          "REFUSAL_REASON=untracked-artifacts\nDIRTY=no\n",
        ),
      });
      await expect(
        runLeaseHelper(primary.cwd, "cleanup-worktree", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          ALLOW_POLICY_OVERRIDE: "no",
          CONFIRM_REMOVE_TOKEN: "",
        }),
      ).resolves.toMatchObject({
        stdout:
          "OUTCOME=retained\nMESSAGE=untracked .ephemeral artifacts retained\n",
      });
      await expect(pathExists(review.cwd)).resolves.toBe(true);
      await expect(readFile(recoveryArtifact, "utf8")).resolves.toBe(
        "preserve me\n",
      );
      await expect(readJson(primary.cwd, file)).resolves.toMatchObject({
        cleanup: { last_outcome: "retained" },
      });
    } finally {
      await cleanupTempDir(parent);
      await cleanupTempDir(primary.cwd);
    }
  });

  it("gates missing-lease cleanup and refuses identity mismatches", async () => {
    const { primary, review, parent } = await makeLinkedReviewWorkspace(
      "devcanon-pr-lease-cleanup-",
    );
    const second = await addLinkedReviewWorktree(
      primary,
      "devcanon-pr-lease-cleanup-",
    );
    try {
      await expect(
        runLeaseHelper(primary.cwd, "cleanup-worktree", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: leasePath(review.cwd),
          ALLOW_POLICY_OVERRIDE: "no",
          CONFIRM_REMOVE_TOKEN: "",
        }),
      ).resolves.toMatchObject({
        stdout:
          "OUTCOME=retained\nMESSAGE=confirmation required for missing lease\n",
      });
      await expect(pathExists(review.cwd)).resolves.toBe(true);

      const firstLease = await writeCreatedLease(primary.cwd, review.cwd);
      await expect(
        runLeaseHelper(primary.cwd, "cleanup-worktree", {
          WORKTREE_PATH: second.review.cwd,
          LEASE_FILE: firstLease,
          ALLOW_POLICY_OVERRIDE: "yes",
          CONFIRM_REMOVE_TOKEN: removeToken(second.review.cwd),
        }),
      ).resolves.toMatchObject({
        stdout: "OUTCOME=retained\nMESSAGE=lease identity mismatch retained\n",
      });
      await expect(pathExists(second.review.cwd)).resolves.toBe(true);
    } finally {
      await execFileAsync("git", ["worktree", "remove", second.review.cwd], {
        cwd: primary.cwd,
      }).catch(() => undefined);
      await cleanupTempDir(second.parent);
      await cleanupLinkedReviewWorkspace(primary, review, parent);
    }
  });

  it("reports fixed inspect and cleanup outputs for invalid lease schema", async () => {
    const { primary, review, parent } = await makeLinkedReviewWorkspace(
      "devcanon-pr-lease-invalid-",
    );
    try {
      const file = await writeCreatedLease(primary.cwd, review.cwd);
      const lease = await readJson(primary.cwd, file);
      await writeJson(primary.cwd, file, { ...lease, extra: true });

      await expect(
        runLeaseHelper(primary.cwd, "inspect-worktree", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
        }),
      ).resolves.toMatchObject({
        stdout: [
          "OUTCOME=inspect",
          "CAN_REMOVE=no",
          "REFUSAL_REASON=invalid-lease",
          "DIRTY=no",
          "LEASE_STATE=invalid",
          "IDENTITY_MATCH=no",
          "REQUIRES_CONFIRMATION=no",
          "",
        ].join("\n"),
      });
      await expect(
        runLeaseHelper(primary.cwd, "cleanup-worktree", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          ALLOW_POLICY_OVERRIDE: "no",
          CONFIRM_REMOVE_TOKEN: "",
        }),
      ).resolves.toMatchObject({
        stdout: expect.stringContaining(
          "OUTCOME=failed\nMESSAGE=invalid lease mechanics: lease schema mismatch:",
        ),
      });
      await expect(pathExists(review.cwd)).resolves.toBe(true);
    } finally {
      await cleanupLinkedReviewWorkspace(primary, review, parent);
    }
  });

  it("reports fixed inspect and cleanup outputs for invalid lease timestamps", async () => {
    const { primary, review, parent } = await makeLinkedReviewWorkspace(
      "devcanon-pr-lease-invalid-",
    );
    try {
      const file = await writeCreatedLease(primary.cwd, review.cwd);
      const lease = await readJson(primary.cwd, file);
      await writeJson(primary.cwd, file, {
        ...lease,
        updated_at: "2026-06-05T99:00:00Z",
      });

      await expect(
        runLeaseHelper(primary.cwd, "inspect-worktree", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
        }),
      ).resolves.toMatchObject({
        stdout: expect.stringContaining(
          "OUTCOME=inspect\nCAN_REMOVE=no\nREFUSAL_REASON=invalid-lease\n",
        ),
      });
      await expect(
        runLeaseHelper(primary.cwd, "cleanup-worktree", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          ALLOW_POLICY_OVERRIDE: "no",
          CONFIRM_REMOVE_TOKEN: "",
        }),
      ).resolves.toMatchObject({
        stdout: expect.stringContaining(
          "MESSAGE=invalid lease mechanics: updated_at is not a valid UTC timestamp",
        ),
      });
      await expect(pathExists(review.cwd)).resolves.toBe(true);
    } finally {
      await cleanupLinkedReviewWorkspace(primary, review, parent);
    }
  });

  it("records failed state with safe recovery pointers and preserves artifacts after GitHub post failure", async () => {
    const { primary, review, parent } = await makeLinkedReviewWorkspace(
      "devcanon-pr-lease-failed-",
    );
    try {
      const { branchName, scopeDecisionPath } = await writeValidReviewManifests(
        review.cwd,
        review.baseSha,
        review.headSha,
      );
      const manifestHelper = await writePassingManifestHelper(review.cwd);
      const file = await writeCreatedLease(primary.cwd, review.cwd);
      await writeJson(
        review.cwd,
        approvedReviewPath(review.headSha, branchName),
        {
          schema: "pr-review/approved-review/v1",
          review_head_sha: review.headSha,
          scope_decision_file: scopeDecisionPath,
        },
      );
      const approvedHelper = await writeRecordingApprovedHelper(review.cwd);

      await expect(
        runLeaseHelper(primary.cwd, "write", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          REVIEW_MANIFEST_HELPER: manifestHelper,
          STATE: "failed",
          RESULT_FILE: resultPath(review.headSha),
          APPROVED_REVIEW_FILE: approvedReviewPath(review.headSha, branchName),
          APPROVED_REVIEW_HELPER: approvedHelper,
          FINISHED_AT: "2026-06-05T00:04:00Z",
          FAILURE_PHASE: "github-post",
          FAILURE_REASON: "GitHub post failed after approval",
          FAILURE_RECOVERABILITY: "recoverable",
          GITHUB_POST_ATTEMPTED: "true",
          GITHUB_POST_RESULT: "failed",
        }),
      ).resolves.toMatchObject({ stdout: `${file}\n` });
      await expect(
        readFile(
          path.join(review.cwd, ".ephemeral/approved-helper-args.txt"),
          "utf8",
        ),
      ).resolves.toBe("validate-approved-review\n");
      await expect(
        readFile(
          path.join(review.cwd, ".ephemeral/approved-helper-file.txt"),
          "utf8",
        ),
      ).resolves.toBe(`${approvedReviewPath(review.headSha, branchName)}\n`);
      await expect(readJson(primary.cwd, file)).resolves.toMatchObject({
        state: "failed",
        artifacts: {
          result_file: resultPath(review.headSha),
          approved_review_file: approvedReviewPath(review.headSha, branchName),
        },
        failure: {
          phase: "github-post",
          reason: "GitHub post failed after approval",
          recoverability: "recoverable",
        },
        terminal: {
          finished_at: "2026-06-05T00:04:00Z",
        },
      });
      await expect(
        readFile(path.join(review.cwd, resultPath(review.headSha)), "utf8"),
      ).resolves.toContain("pr-review/result/v1");
      await expect(
        readFile(
          path.join(review.cwd, findingsPath(review.headSha, branchName)),
          "utf8",
        ),
      ).resolves.toContain("play-review/findings/v1");
      await expect(
        readFile(
          path.join(review.cwd, reviewBodyPath(review.headSha, branchName)),
          "utf8",
        ),
      ).resolves.toBe("Review body\n");
      await expect(
        readFile(
          path.join(review.cwd, approvedReviewPath(review.headSha, branchName)),
          "utf8",
        ),
      ).resolves.toContain("pr-review/approved-review/v1");

      await expect(
        runLeaseHelper(primary.cwd, "cleanup-worktree", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          REVIEW_MANIFEST_HELPER: manifestHelper,
          APPROVED_REVIEW_HELPER: approvedHelper,
          BASE_REF: "",
          HEAD_REF: "",
          ALLOW_POLICY_OVERRIDE: "no",
          CONFIRM_REMOVE_TOKEN: "",
        }),
      ).resolves.toMatchObject({
        stdout:
          "OUTCOME=retained\nMESSAGE=untracked .ephemeral artifacts retained\n",
      });
      await expect(
        readFile(path.join(review.cwd, resultPath(review.headSha)), "utf8"),
      ).resolves.toContain("pr-review/result/v1");
      await expect(
        readFile(
          path.join(review.cwd, ".ephemeral/approved-helper-base.txt"),
          "utf8",
        ),
      ).resolves.toBe(`${review.baseSha}\n`);
      await expect(
        readFile(
          path.join(review.cwd, findingsPath(review.headSha, branchName)),
          "utf8",
        ),
      ).resolves.toContain("play-review/findings/v1");
      await expect(
        readFile(
          path.join(review.cwd, reviewBodyPath(review.headSha, branchName)),
          "utf8",
        ),
      ).resolves.toBe("Review body\n");
      await expect(
        readFile(
          path.join(review.cwd, approvedReviewPath(review.headSha, branchName)),
          "utf8",
        ),
      ).resolves.toContain("pr-review/approved-review/v1");
    } finally {
      await cleanupTempDir(parent);
      await cleanupTempDir(primary.cwd);
    }
  });

  it("rejects failed leases that claim the GitHub post succeeded", async () => {
    const { primary, review, parent } = await makeLinkedReviewWorkspace(
      "devcanon-pr-lease-failed-",
    );
    try {
      await writeValidReviewManifests(
        review.cwd,
        review.baseSha,
        review.headSha,
      );
      const file = await writeCreatedLease(primary.cwd, review.cwd);

      await expect(
        runLeaseHelper(primary.cwd, "write", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          STATE: "failed",
          RESULT_FILE: resultPath(review.headSha),
          FINISHED_AT: "2026-06-05T00:04:00Z",
          FAILURE_PHASE: "github-post",
          FAILURE_REASON: "Post succeeded cannot be failed",
          FAILURE_RECOVERABILITY: "unknown",
          GITHUB_POST_ATTEMPTED: "true",
          GITHUB_POST_RESULT: "succeeded",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "GITHUB_POST_RESULT must be failed for github-post failure",
        ),
      });
    } finally {
      await cleanupLinkedReviewWorkspace(primary, review, parent);
    }
  });

  it("requires failed leases to record a failure timestamp", async () => {
    const { primary, review, parent } = await makeLinkedReviewWorkspace(
      "devcanon-pr-lease-failed-",
    );
    try {
      await writeValidReviewManifests(
        review.cwd,
        review.baseSha,
        review.headSha,
      );
      const file = await writeCreatedLease(primary.cwd, review.cwd);

      await expect(
        runLeaseHelper(primary.cwd, "write", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          STATE: "failed",
          RESULT_FILE: resultPath(review.headSha),
          FAILURE_PHASE: "github-post",
          FAILURE_REASON: "Missing failure timestamp",
          FAILURE_RECOVERABILITY: "recoverable",
          GITHUB_POST_ATTEMPTED: "true",
          GITHUB_POST_RESULT: "failed",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("FINISHED_AT is required for failed"),
      });
    } finally {
      await cleanupLinkedReviewWorkspace(primary, review, parent);
    }
  });

  it(
    "retains terminal leases with missing referenced artifacts during cleanup",
    async () => {
      const { primary, review, parent } = await makeLinkedReviewWorkspace(
        "devcanon-pr-lease-cleanup-",
      );
      try {
        const { branchName, scopeDecisionPath } =
          await writeValidReviewManifests(
            review.cwd,
            review.baseSha,
            review.headSha,
          );
        await writeJson(
          review.cwd,
          approvedReviewPath(review.headSha, branchName),
          {
            schema: "pr-review/approved-review/v1",
            review_head_sha: review.headSha,
            scope_decision_file: scopeDecisionPath,
          },
        );
        const approvedHelper = await writeRecordingApprovedHelper(review.cwd);

        const file = await writeCreatedLease(primary.cwd, review.cwd);
        await runLeaseHelper(primary.cwd, "write", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          STATE: "reviewed",
          RESULT_FILE: resultPath(review.headSha),
        });
        await runLeaseHelper(primary.cwd, "write", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          STATE: "gated",
          PRESENTED_AT: "2026-06-05T00:03:00Z",
          PRESENTATION_STATUS: "preview-current",
        });
        await runLeaseHelper(primary.cwd, "write", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: file,
          STATE: "posted",
          APPROVED_REVIEW_FILE: approvedReviewPath(review.headSha, branchName),
          APPROVED_REVIEW_HELPER: approvedHelper,
          FINISHED_AT: "2026-06-05T00:04:00Z",
          GITHUB_POST_ATTEMPTED: "true",
          GITHUB_POST_RESULT: "succeeded",
          GITHUB_POSTED_AT: "2026-06-05T00:04:00Z",
        });

        await unlink(path.join(review.cwd, resultPath(review.headSha)));

        await expect(
          runLeaseHelper(primary.cwd, "validate", {
            WORKTREE_PATH: review.cwd,
            LEASE_FILE: file,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "result file missing or not a regular file",
          ),
        });
        await expect(
          runLeaseHelper(primary.cwd, "inspect-worktree", {
            WORKTREE_PATH: review.cwd,
            LEASE_FILE: file,
          }),
        ).resolves.toMatchObject({
          stdout: expect.stringContaining(
            "OUTCOME=inspect\nCAN_REMOVE=no\nREFUSAL_REASON=invalid-lease\n",
          ),
        });
        await expect(
          runLeaseHelper(primary.cwd, "cleanup-worktree", {
            WORKTREE_PATH: review.cwd,
            LEASE_FILE: file,
            ALLOW_POLICY_OVERRIDE: "yes",
            CONFIRM_REMOVE_TOKEN: removeToken(review.cwd),
          }),
        ).resolves.toMatchObject({
          stdout: expect.stringContaining(
            "OUTCOME=failed\nMESSAGE=invalid lease mechanics: result file missing or not a regular file",
          ),
        });
        await expect(pathExists(review.cwd)).resolves.toBe(true);
      } finally {
        await cleanupLinkedReviewWorkspace(primary, review, parent);
      }
    },
    longTestTimeout,
  );

  it("does not remove preexisting temp-like files after failed writes", async () => {
    const primary = await makeGitWorkspace("devcanon-pr-lease-primary-");
    const review = await makeGitWorkspace("devcanon-pr-lease-review-");
    try {
      const sentinel = `.ephemeral/.lease-${prNumber}-${leaseDigest(
        review.cwd,
      )}.sentinel`;
      await writeFile(path.join(primary.cwd, sentinel), "do not delete\n");

      await expect(
        runLeaseHelper(primary.cwd, "write", {
          WORKTREE_PATH: review.cwd,
          LEASE_FILE: leasePath(review.cwd),
          STATE: "created",
          UPDATED_AT: "2026-99-05T00:00:00Z",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "updated_at is not a valid UTC timestamp",
        ),
      });
      await expect(
        readFile(path.join(primary.cwd, sentinel), "utf8"),
      ).resolves.toBe("do not delete\n");

      const helperSource = await readFile(helperScript, "utf8");
      expect(helperSource).toContain("mktemp");
      expect(helperSource).not.toContain(".${expected#.ephemeral/}.$$");
    } finally {
      await cleanupTempDir(primary.cwd);
      await cleanupTempDir(review.cwd);
    }
  });
});
