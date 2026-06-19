import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";

const execFileAsync = promisify(execFile);

const originalCwd = process.cwd();
const tempRoots: string[] = [];
const managedEnvKeys = [
  "REPOSITORY",
  "PR_NUMBER",
  "HEAD_SHA",
  "RESULT_FILE",
  "PRIMARY_REPOSITORY_ROOT",
  "WORKTREE_PATH",
  "LEASE_FILE",
  "PR_REVIEW_DIR",
  "PLAY_REVIEW_HELPER",
] as const;

type RuntimeCommandOutcome =
  | { exitCode: 0; stdout: string; stderr: string }
  | { exitCode: 1; stdout: string; stderr: string };

interface ManifestWorkspace {
  tempRoot: string;
  primary: string;
  worktree: string;
  physicalPrimary: string;
  physicalWorktree: string;
  prReviewDir: string;
  playReviewHelper: string;
  baseSha: string;
  headSha: string;
  resultFile: string;
  leaseFile: string;
  resultSha256: string;
  worktreeDigest: string;
  findingsFile: string;
  reviewBodyFile: string;
}

afterEach(async () => {
  process.chdir(originalCwd);
  for (const key of managedEnvKeys) {
    delete process.env[key];
  }
  vi.doUnmock("./pr-review-leases.js");
  vi.resetModules();
  for (const tempRoot of tempRoots.splice(0)) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("pr-review Phase 5 audit summary renderer", () => {
  it("renders all mandatory audit families from the worktree and read-only lease status", async () => {
    const workspace = await makeManifestWorkspace(
      "pr-review-manifest-summary-",
    );
    setSummaryEnv(workspace);
    process.chdir(workspace.tempRoot);

    const result = await runManifestCommand(["render-phase5-audit-summary"]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("## Phase 5 Artifact Audit Summary");
    expect(result.stdout).toContain(
      `Reviewed head SHA: \`${workspace.headSha}\``,
    );
    expect(result.stdout).toContain("Base/head refs: `main` -> `topic`");
    expect(result.stdout).toContain(
      `Active diff range: \`${workspace.baseSha}..HEAD\``,
    );
    expect(result.stdout).toContain(
      `Full PR diff range: \`${workspace.baseSha}...HEAD\``,
    );
    expect(result.stdout).toContain(
      `Result manifest: \`${workspace.resultFile}\``,
    );
    expect(result.stdout).toContain(`Findings: \`${workspace.findingsFile}\``);
    expect(result.stdout).toContain("Result artifacts:");
    expect(result.stdout).toContain("Validation status: result `valid`");
    expect(result.stdout).toContain("lease result digest");
    expect(result.stdout).toContain("Lease/worktree status: lease `gated`");
    expect(result.stdout).toContain("dirty `true`");
    expect(result.stdout).toContain(
      "Cleanup note: lease-gated cleanup pending",
    );
  });

  it("uses WORKTREE_PATH for result artifacts and PRIMARY_REPOSITORY_ROOT for lease status", async () => {
    const workspace = await makeManifestWorkspace("pr-review-distinct-roots-");
    setSummaryEnv(workspace);
    process.chdir(workspace.tempRoot);

    const result = await runManifestCommand(["render-phase5-audit-summary"]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      `worktree \`${workspace.physicalWorktree}\``,
    );
    await expect(
      readFile(path.join(workspace.primary, workspace.resultFile), "utf8"),
    ).rejects.toThrow();
  });

  it("does not mutate the lease file or result artifacts", async () => {
    const workspace = await makeManifestWorkspace(
      "pr-review-summary-readonly-",
    );
    setSummaryEnv(workspace);
    const leasePath = path.join(workspace.primary, workspace.leaseFile);
    const resultPath = path.join(workspace.worktree, workspace.resultFile);
    const bodyPath = path.join(workspace.worktree, workspace.reviewBodyFile);
    const before = {
      lease: await readFile(leasePath, "utf8"),
      result: await readFile(resultPath, "utf8"),
      body: await readFile(bodyPath, "utf8"),
    };

    const result = await runManifestCommand(["render-phase5-audit-summary"]);

    expect(result.exitCode, result.stderr).toBe(0);
    await expect(readFile(leasePath, "utf8")).resolves.toBe(before.lease);
    await expect(readFile(resultPath, "utf8")).resolves.toBe(before.result);
    await expect(readFile(bodyPath, "utf8")).resolves.toBe(before.body);
  });

  it("fails closed for malformed or inconsistent read-status output", async () => {
    const cases: Array<{
      name: string;
      stdout?: (workspace: ManifestWorkspace) => string;
      stderr?: string;
      expectStderr: string;
    }> = [
      {
        name: "non-json",
        stdout: () => "not json\n",
        expectStderr: "single JSON object",
      },
      {
        name: "missing-field",
        stdout: (workspace) => {
          const { presented_at: _presentedAt, ...status } =
            validStatus(workspace);
          return `${JSON.stringify(status)}\n`;
        },
        expectStderr: "schema mismatch",
      },
      {
        name: "unknown-field",
        stdout: (workspace) =>
          `${JSON.stringify({ ...validStatus(workspace), can_remove: true })}\n`,
        expectStderr: "schema mismatch",
      },
      {
        name: "invalid-domain",
        stdout: (workspace) =>
          `${JSON.stringify({ ...validStatus(workspace), lease_state: "reviewed" })}\n`,
        expectStderr: "lease state must be gated",
      },
      {
        name: "digest-mismatch",
        stdout: (workspace) =>
          `${JSON.stringify({ ...validStatus(workspace), result_sha256: "0".repeat(64) })}\n`,
        expectStderr: "result digest mismatch",
      },
      {
        name: "stale-status",
        stdout: (workspace) =>
          `${JSON.stringify({ ...validStatus(workspace), result_validated_at: "2026-06-11T00:01:00Z" })}\n`,
        expectStderr: "validation timestamp is stale",
      },
      {
        name: "presentation-mismatch",
        stdout: (workspace) =>
          `${JSON.stringify({ ...validStatus(workspace), presentation_status: "edited" })}\n`,
        expectStderr: "presentation status mismatch",
      },
      {
        name: "status-diagnostic",
        stderr: "result manifest digest mismatch\n",
        expectStderr: "read-status failed",
      },
    ];

    for (const testCase of cases) {
      const workspace = await makeManifestWorkspace(
        `pr-review-summary-${testCase.name}-`,
      );
      setSummaryEnv(workspace);
      vi.doMock("./pr-review-leases.js", () => ({
        runPrReviewLeasesCommand: vi.fn(async () => ({
          exitCode: testCase.stderr === undefined ? 0 : 1,
          stdout: testCase.stdout?.(workspace) ?? "",
          stderr: testCase.stderr ?? "",
        })),
      }));

      const result = await runManifestCommand(["render-phase5-audit-summary"]);

      expect(result.exitCode, testCase.name).toBe(1);
      expect(result.stdout, testCase.name).toBe("");
      expect(result.stderr, testCase.name).toContain(testCase.expectStderr);
      vi.doUnmock("./pr-review-leases.js");
      vi.resetModules();
    }
  });

  it("reports dirty-but-valid worktree status and fails closed for false status booleans", async () => {
    const dirty = await makeManifestWorkspace("pr-review-summary-dirty-");
    setSummaryEnv(dirty);
    let result = await runManifestCommand(["render-phase5-audit-summary"]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("dirty `true`");

    for (const [field, expected] of [
      ["worktree_exists", "worktree does not exist"],
      ["worktree_registered", "worktree is not registered"],
      ["identity_match", "identity mismatch"],
    ] as const) {
      const workspace = await makeManifestWorkspace(
        `pr-review-summary-${field}-`,
      );
      setSummaryEnv(workspace);
      vi.resetModules();
      vi.doMock("./pr-review-leases.js", () => ({
        runPrReviewLeasesCommand: vi.fn(async () => ({
          exitCode: 0,
          stdout: `${JSON.stringify({ ...validStatus(workspace), [field]: false })}\n`,
          stderr: "",
        })),
      }));

      result = await runManifestCommand(["render-phase5-audit-summary"]);

      expect(result.exitCode, field).toBe(1);
      expect(result.stderr, field).toContain(expected);
      vi.doUnmock("./pr-review-leases.js");
      vi.resetModules();
    }
  });

  it("uses only Phase 5-safe cleanup wording", async () => {
    const workspace = await makeManifestWorkspace("pr-review-cleanup-wording-");
    setSummaryEnv(workspace);

    const result = await runManifestCommand(["render-phase5-audit-summary"]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("cleanup pending");
    expect(result.stdout).toContain("cleanup not attempted");
    expect(result.stdout).not.toMatch(
      /can remove|force remove|removed|cleanup complete/i,
    );
  });

  it("keeps pr-review/result/v1 forbidden lease and approval fields rejected", async () => {
    const workspace = await makeManifestWorkspace("pr-review-forbidden-field-");
    setSummaryEnv(workspace);
    const resultPath = path.join(workspace.worktree, workspace.resultFile);
    const result = JSON.parse(await readFile(resultPath, "utf8")) as Record<
      string,
      unknown
    >;
    await writeJson(workspace.worktree, workspace.resultFile, {
      ...result,
      approval_state: "approved",
    });

    const outcome = await runManifestCommand(["render-phase5-audit-summary"]);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stdout).toBe("");
    expect(outcome.stderr).toContain("result schema mismatch");
  });
});

async function runManifestCommand(
  args: readonly string[],
): Promise<RuntimeCommandOutcome> {
  const { runPrReviewManifestsCommand } = await import(
    "./pr-review-manifests.js"
  );
  return runPrReviewManifestsCommand(args);
}

async function makeManifestWorkspace(
  prefix: string,
): Promise<ManifestWorkspace> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), prefix));
  tempRoots.push(tempRoot);
  const primary = path.join(tempRoot, "primary");
  const worktree = path.join(tempRoot, "review-worktree");
  await mkdir(primary, { recursive: true });
  await execFileAsync("git", ["init", "--initial-branch=main"], {
    cwd: primary,
  });
  await execFileAsync("git", ["config", "user.name", "Test User"], {
    cwd: primary,
  });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd: primary,
  });
  await writeFile(path.join(primary, "README.md"), "baseline\n");
  await execFileAsync("git", ["add", "README.md"], { cwd: primary });
  await execFileAsync("git", ["commit", "-m", "chore: baseline"], {
    cwd: primary,
  });
  const baseSha = (
    await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: primary })
  ).stdout.trim();
  await execFileAsync("git", ["worktree", "add", "-b", "topic", worktree], {
    cwd: primary,
  });
  const physicalPrimary = await realpath(primary);
  const physicalWorktree = await realpath(worktree);
  const headSha = (
    await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: worktree })
  ).stdout.trim();
  const prReviewDir = await writePrReviewHelper(tempRoot);
  const playReviewHelper = await writeExecutable(
    path.join(tempRoot, "play-review-helper.sh"),
    ["#!/usr/bin/env bash", "set -euo pipefail", "exit 0", ""].join("\n"),
  );

  await mkdir(path.join(primary, ".ephemeral"), { recursive: true });
  await mkdir(path.join(worktree, ".ephemeral"), { recursive: true });
  const findingsFile = `.ephemeral/topic-${headSha}-findings.json`;
  const scopeFile = `.ephemeral/topic-${headSha}-scope-decision.json`;
  const handoffFile = `.ephemeral/pr-432-${headSha}-handoff.json`;
  const resultFile = `.ephemeral/pr-432-${headSha}-result.json`;
  const reviewBodyFile = `.ephemeral/topic-${headSha}-review-body.md`;
  const previewFile = `.ephemeral/topic-${headSha}-review-preview.md`;

  await writeJson(worktree, findingsFile, {
    schema: "play-review/findings/v1",
    findings: [{ id: "F1", title: "Finding" }],
    carry_forward: [],
  });
  await writeFile(path.join(worktree, reviewBodyFile), "Review body.\n");
  await writeFile(path.join(worktree, previewFile), "Rendered preview.\n");
  await writeJson(worktree, scopeFile, {
    head_sha: headSha,
    selection_reason: "Initial review covers the full pull request.",
    selected_range: `${baseSha}..HEAD`,
    full_range: `${baseSha}...HEAD`,
    is_followup_narrow: false,
    language_hints: [],
    mode: "initial",
    last_reviewed_sha: null,
    prior_context: { kind: "none", path: null },
  });
  await writeJson(worktree, handoffFile, {
    schema: "pr-review/handoff/v1",
    pr_number: 432,
    repository: "owner/repo",
    execution: {
      kind: "review-worktree",
      working_directory: physicalWorktree,
    },
    base_ref: "main",
    head_ref: "topic",
    review_scope_base_ref: baseSha,
    active_diff_range: `${baseSha}..HEAD`,
    full_pr_diff_range: `${baseSha}...HEAD`,
    review_head_sha: headSha,
    mode: "github-post",
    language_hints: [],
    follow_up: {
      state: "initial",
      last_reviewed_sha: null,
      is_followup_narrow: false,
    },
    artifacts: {
      scope_decision_file: scopeFile,
      prior_threads_file: null,
    },
  });
  const resultManifest = {
    schema: "pr-review/result/v1",
    pr_number: 432,
    repository: "owner/repo",
    review_head_sha: headSha,
    findings_file: findingsFile,
    review_body_file: reviewBodyFile,
    context_file: null,
    artifacts: {
      handoff_file: handoffFile,
      scope_decision_file: scopeFile,
      prior_threads_file: null,
      rendered_preview_file: previewFile,
    },
    digests: {
      handoff_sha256: await sha256File(path.join(worktree, handoffFile)),
      findings_sha256: await sha256File(path.join(worktree, findingsFile)),
      review_body_sha256: await sha256File(path.join(worktree, reviewBodyFile)),
      context_sha256: null,
      scope_decision_sha256: await sha256File(path.join(worktree, scopeFile)),
      prior_threads_sha256: null,
      rendered_preview_sha256: await sha256File(
        path.join(worktree, previewFile),
      ),
    },
    scope_decision: {
      summary: "Initial review covers the full pull request.",
      selected_range: `${baseSha}..HEAD`,
      full_range: `${baseSha}...HEAD`,
      is_followup_narrow: false,
    },
    presentation: {
      status: "preview-current",
      notes: null,
    },
    validation: {
      status: "valid",
      findings_validated: true,
      scope_decision_validated: true,
    },
  };
  await writeJson(worktree, resultFile, resultManifest);
  const resultSha256 = await sha256File(path.join(worktree, resultFile));
  const worktreeDigest = digestPath(physicalWorktree);
  const leaseFile = `.ephemeral/pr-432-${worktreeDigest}-lease.json`;
  await writeJson(primary, leaseFile, {
    schema: "pr-review/lease/v1",
    repository: "owner/repo",
    pr_number: 432,
    state: "gated",
    base_ref: "main",
    head_ref: "topic",
    worktree_path: physicalWorktree,
    worktree_digest: worktreeDigest,
    lease_file: leaseFile,
    created_at: "2026-06-11T00:00:00Z",
    updated_at: "2026-06-11T00:02:00Z",
    artifacts: {
      handoff_file: handoffFile,
      result_file: resultFile,
      approved_review_file: null,
      validated_payload_file: null,
    },
    validation: {
      result_manifest: {
        status: "valid",
        validated_at: "2026-06-11T00:02:00Z",
        sha256: resultSha256,
      },
    },
    presentation: {
      presented_at: "2026-06-11T00:02:00Z",
      status: "preview-current",
    },
    terminal: { finished_at: null, reason: null },
    failure: { phase: null, reason: null, recoverability: null },
    github: {
      github_post_attempted: false,
      github_post_result: "not-attempted",
      github_posted_at: null,
    },
  });

  return {
    tempRoot,
    primary,
    worktree,
    physicalPrimary,
    physicalWorktree,
    prReviewDir,
    playReviewHelper,
    baseSha,
    headSha,
    resultFile,
    leaseFile,
    resultSha256,
    worktreeDigest,
    findingsFile,
    reviewBodyFile,
  };
}

function setSummaryEnv(workspace: ManifestWorkspace): void {
  process.env.REPOSITORY = "owner/repo";
  process.env.PR_NUMBER = "432";
  process.env.HEAD_SHA = workspace.headSha;
  process.env.RESULT_FILE = workspace.resultFile;
  process.env.PRIMARY_REPOSITORY_ROOT = workspace.physicalPrimary;
  process.env.WORKTREE_PATH = workspace.physicalWorktree;
  process.env.LEASE_FILE = workspace.leaseFile;
  process.env.PR_REVIEW_DIR = workspace.prReviewDir;
  process.env.PLAY_REVIEW_HELPER = workspace.playReviewHelper;
}

function validStatus(workspace: ManifestWorkspace): Record<string, unknown> {
  return {
    lease_state: "gated",
    worktree_path: workspace.physicalWorktree,
    worktree_digest: workspace.worktreeDigest,
    worktree_exists: true,
    worktree_registered: true,
    worktree_dirty: true,
    identity_match: true,
    result_file: workspace.resultFile,
    result_sha256: workspace.resultSha256,
    result_validated_at: "2026-06-11T00:02:00Z",
    lease_updated_at: "2026-06-11T00:02:00Z",
    presentation_status: "preview-current",
    presented_at: "2026-06-11T00:02:00Z",
  };
}

async function writePrReviewHelper(tempRoot: string): Promise<string> {
  const prReviewDir = path.join(tempRoot, "pr-review");
  await mkdir(path.join(prReviewDir, "scripts"), { recursive: true });
  await writeExecutable(
    path.join(prReviewDir, "scripts/prior-thread-artifacts.sh"),
    ["#!/usr/bin/env bash", "set -euo pipefail", "exit 0", ""].join("\n"),
  );
  return prReviewDir;
}

async function writeExecutable(file: string, content: string): Promise<string> {
  await writeFile(file, content);
  await chmod(file, 0o755);
  return file;
}

async function writeJson(
  root: string,
  relPath: string,
  value: unknown,
): Promise<void> {
  await mkdir(path.dirname(path.join(root, relPath)), { recursive: true });
  await writeFile(
    path.join(root, relPath),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

async function sha256File(file: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

function digestPath(value: string): string {
  return createHash("sha256")
    .update(normalizeComparablePath(value))
    .digest("hex");
}

function normalizeComparablePath(value: string): string {
  const normalized = value.replace(/\\/gu, "/");
  return /^[A-Za-z]:\//u.test(normalized)
    ? normalized.toLowerCase()
    : normalized;
}
