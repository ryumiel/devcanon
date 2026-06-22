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
const rmTempRootOptions = {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 100,
} as const;
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
  providerScopeEvidenceFile: string;
}

afterEach(async () => {
  process.chdir(originalCwd);
  for (const key of managedEnvKeys) {
    delete process.env[key];
  }
  vi.doUnmock("./pr-review-leases.js");
  vi.resetModules();
  for (const tempRoot of tempRoots.splice(0)) {
    await rm(tempRoot, rmTempRootOptions);
  }
});

describe("pr-review Phase 5 audit summary renderer", () => {
  it("keeps POSIX single-letter roots as operational paths", async () => {
    const { toOperationalPathText } = await import("./pr-review-manifests.js");
    expect(toOperationalPathText("/c/repo")).toBe("/c/repo");
    expect(toOperationalPathText("/w/worktree")).toBe("/w/worktree");
    expect(toOperationalPathText("C:\\repo")).toBe("C:/repo");
  });

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
      `Active diff range: \`${workspace.baseSha}..${workspace.headSha}\``,
    );
    expect(result.stdout).toContain(
      `Full PR diff range: \`${workspace.baseSha}..${workspace.headSha}\``,
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

      try {
        const result = await runManifestCommand([
          "render-phase5-audit-summary",
        ]);

        expect(result.exitCode, testCase.name).toBe(1);
        expect(result.stdout, testCase.name).toBe("");
        expect(result.stderr, testCase.name).toContain(testCase.expectStderr);
      } finally {
        vi.doUnmock("./pr-review-leases.js");
        vi.resetModules();
      }
    }
  }, 30_000);

  it("reports dirty-but-valid worktree status and fails closed for false status booleans", async () => {
    const dirty = await makeManifestWorkspace("pr-review-summary-dirty-");
    setSummaryEnv(dirty);
    let result = await runManifestCommand(["render-phase5-audit-summary"]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("dirty `true`");

    const falseStatusWorkspace = await makeManifestWorkspace(
      "pr-review-summary-false-status-",
    );
    for (const [field, expected] of [
      ["worktree_exists", "worktree does not exist"],
      ["worktree_registered", "worktree is not registered"],
      ["identity_match", "identity mismatch"],
    ] as const) {
      setSummaryEnv(falseStatusWorkspace);
      vi.resetModules();
      vi.doMock("./pr-review-leases.js", () => ({
        runPrReviewLeasesCommand: vi.fn(async () => ({
          exitCode: 0,
          stdout: `${JSON.stringify({ ...validStatus(falseStatusWorkspace), [field]: false })}\n`,
          stderr: "",
        })),
      }));

      try {
        result = await runManifestCommand(["render-phase5-audit-summary"]);

        expect(result.exitCode, field).toBe(1);
        expect(result.stderr, field).toContain(expected);
      } finally {
        vi.doUnmock("./pr-review-leases.js");
        vi.resetModules();
      }
    }
  });

  it("escapes backticks in dynamic audit summary code spans", async () => {
    const workspace = await makeManifestWorkspace("pr-review-summary-`ticks-");
    const resultPath = path.join(workspace.worktree, workspace.resultFile);
    const resultManifest = JSON.parse(
      await readFile(resultPath, "utf8"),
    ) as Record<string, unknown>;
    const artifacts = resultManifest.artifacts as Record<string, unknown>;
    const digests = resultManifest.digests as Record<string, unknown>;
    const handoffFile = artifacts.handoff_file as string;
    const handoffPath = path.join(workspace.worktree, handoffFile);
    const handoff = JSON.parse(await readFile(handoffPath, "utf8")) as Record<
      string,
      unknown
    >;
    await writeJson(workspace.worktree, handoffFile, {
      ...handoff,
      head_ref: "topic`review",
    });
    await writeJson(workspace.worktree, workspace.resultFile, {
      ...resultManifest,
      digests: {
        ...digests,
        handoff_sha256: await sha256File(handoffPath),
      },
    });
    const leasePath = path.join(workspace.primary, workspace.leaseFile);
    const lease = JSON.parse(await readFile(leasePath, "utf8")) as Record<
      string,
      unknown
    >;
    const validation = lease.validation as Record<string, unknown>;
    const resultValidation = validation.result_manifest as Record<
      string,
      unknown
    >;
    await writeJson(workspace.primary, workspace.leaseFile, {
      ...lease,
      head_ref: "topic`review",
      validation: {
        ...validation,
        result_manifest: {
          ...resultValidation,
          sha256: await sha256File(resultPath),
        },
      },
    });
    setSummaryEnv(workspace);

    const result = await runManifestCommand(["render-phase5-audit-summary"]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "Base/head refs: `main` -> `` topic`review ``",
    );
    expect(result.stdout).toContain(
      `worktree ${formatExpectedMarkdownCodeSpan(workspace.physicalWorktree)}`,
    );
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

  it("rejects provider evidence digest drift during Phase 5 result validation", async () => {
    const workspace = await makeManifestWorkspace(
      "pr-review-provider-evidence-drift-",
    );
    setSummaryEnv(workspace);
    await writeJson(workspace.worktree, workspace.providerScopeEvidenceFile, {
      schema: "pr-review/provider-scope-evidence/v2",
      provider: "github",
      repository: "owner/repo",
      pr_number: 432,
      baseRefOid: workspace.baseSha,
      headRefOid: workspace.headSha,
      provider_pr_diff_base_sha: workspace.baseSha,
      local_review_head_sha: workspace.headSha,
      full_pr_diff_range: `${workspace.baseSha}..${workspace.headSha}`,
      evidence_complete: true,
      digest_provenance: {
        schema: "pr-review/digest-provenance/v1",
        provider_diff: "canonical-git-diff/v1",
        local_diff: "canonical-git-diff/v1",
        provider_patches: "canonical-git-diff/v1",
        local_patches: "canonical-git-diff/v1",
      },
      provider_files: [],
      local_files: [],
      provider_diff_sha256: "0".repeat(64),
      local_diff_sha256: "1".repeat(64),
    });

    const result = await runManifestCommand(["render-phase5-audit-summary"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("provider scope evidence digest mismatch");
  });

  it.each([
    {
      name: "repository",
      patch: { repository: "other/repo" },
      stderr: "provider evidence repository mismatch",
    },
    {
      name: "PR number",
      patch: { pr_number: 433 },
      stderr: "provider evidence PR number mismatch",
    },
  ])(
    "rejects provider evidence $name mismatch during Phase 5 result validation",
    async ({ patch, stderr }) => {
      const workspace = await makeManifestWorkspace(
        "pr-review-provider-evidence-identity-",
      );
      setSummaryEnv(workspace);
      const evidence = JSON.parse(
        await readFile(
          path.join(workspace.worktree, workspace.providerScopeEvidenceFile),
          "utf8",
        ),
      ) as Record<string, unknown>;
      await writeJson(workspace.worktree, workspace.providerScopeEvidenceFile, {
        ...evidence,
        ...patch,
      });
      const providerScopeEvidenceSha256 = await sha256File(
        path.join(workspace.worktree, workspace.providerScopeEvidenceFile),
      );
      const scopeFile = `.ephemeral/topic-${workspace.headSha}-scope-decision.json`;
      const handoffFile = `.ephemeral/pr-432-${workspace.headSha}-handoff.json`;
      const scope = JSON.parse(
        await readFile(path.join(workspace.worktree, scopeFile), "utf8"),
      ) as Record<string, unknown>;
      await writeJson(workspace.worktree, scopeFile, {
        ...scope,
        artifacts: {
          ...(scope.artifacts as Record<string, unknown>),
          provider_scope_evidence_sha256: providerScopeEvidenceSha256,
        },
      });
      const scopeSha256 = await sha256File(
        path.join(workspace.worktree, scopeFile),
      );
      const handoff = JSON.parse(
        await readFile(path.join(workspace.worktree, handoffFile), "utf8"),
      ) as Record<string, unknown>;
      await writeJson(workspace.worktree, handoffFile, {
        ...handoff,
        artifacts: {
          ...(handoff.artifacts as Record<string, unknown>),
          provider_scope_evidence_sha256: providerScopeEvidenceSha256,
        },
      });
      const handoffSha256 = await sha256File(
        path.join(workspace.worktree, handoffFile),
      );
      const resultManifest = JSON.parse(
        await readFile(
          path.join(workspace.worktree, workspace.resultFile),
          "utf8",
        ),
      ) as Record<string, unknown>;
      await writeJson(workspace.worktree, workspace.resultFile, {
        ...resultManifest,
        digests: {
          ...(resultManifest.digests as Record<string, unknown>),
          handoff_sha256: handoffSha256,
          scope_decision_sha256: scopeSha256,
          provider_scope_evidence_sha256: providerScopeEvidenceSha256,
        },
      });
      const resultSha256 = await sha256File(
        path.join(workspace.worktree, workspace.resultFile),
      );
      const lease = JSON.parse(
        await readFile(
          path.join(workspace.primary, workspace.leaseFile),
          "utf8",
        ),
      ) as Record<string, unknown>;
      const validation = lease.validation as Record<string, unknown>;
      await writeJson(workspace.primary, workspace.leaseFile, {
        ...lease,
        validation: {
          ...validation,
          result_manifest: {
            ...(validation.result_manifest as Record<string, unknown>),
            sha256: resultSha256,
          },
        },
      });

      const result = await runManifestCommand(["render-phase5-audit-summary"]);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(stderr);
    },
  );

  it("requires explicit provider evidence input for adapter scope validation", async () => {
    const workspace = await makeManifestWorkspace(
      "pr-review-explicit-provider-input-",
    );
    const helper = await writeExecutable(
      path.join(workspace.tempRoot, "pass-validator.sh"),
      ["#!/usr/bin/env bash", "set -euo pipefail", "exit 0", ""].join("\n"),
    );
    const adapter = path.join(
      originalCwd,
      "skills/pr-review/scripts/prior-thread-artifacts.sh",
    );

    await expect(
      execFileAsync("bash", [adapter, "validate-scope-decision"], {
        cwd: workspace.worktree,
        env: {
          ...process.env,
          HEAD_SHA: workspace.headSha,
          BASE_REF: workspace.baseSha,
          SCOPE_DECISION_FILE: `.ephemeral/topic-${workspace.headSha}-scope-decision.json`,
          PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: helper,
        },
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "PROVIDER_SCOPE_EVIDENCE_FILE is required",
      ),
    });
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
  const providerScopeEvidenceFile = `.ephemeral/topic-${headSha}-provider-scope-evidence.json`;
  const providerPrDiffRange = `${baseSha}..${headSha}`;
  await writeJson(worktree, providerScopeEvidenceFile, {
    schema: "pr-review/provider-scope-evidence/v2",
    provider: "github",
    repository: "owner/repo",
    pr_number: 432,
    baseRefOid: baseSha,
    headRefOid: headSha,
    provider_pr_diff_base_sha: baseSha,
    local_review_head_sha: headSha,
    full_pr_diff_range: providerPrDiffRange,
    evidence_complete: true,
    digest_provenance: {
      schema: "pr-review/digest-provenance/v1",
      provider_diff: "canonical-git-diff/v1",
      local_diff: "canonical-git-diff/v1",
      provider_patches: "canonical-git-diff/v1",
      local_patches: "canonical-git-diff/v1",
    },
    provider_files: [],
    local_files: [],
    provider_diff_sha256: "0".repeat(64),
    local_diff_sha256: "0".repeat(64),
  });
  const providerScopeEvidenceSha256 = await sha256File(
    path.join(worktree, providerScopeEvidenceFile),
  );

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
    selected_range: providerPrDiffRange,
    full_range: providerPrDiffRange,
    is_followup_narrow: false,
    language_hints: [],
    mode: "initial",
    last_reviewed_sha: null,
    prior_context: { kind: "none", path: null },
    artifacts: {
      provider_scope_evidence_file: providerScopeEvidenceFile,
      provider_scope_evidence_sha256: providerScopeEvidenceSha256,
    },
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
    active_diff_range: providerPrDiffRange,
    full_pr_diff_range: providerPrDiffRange,
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
      provider_scope_evidence_file: providerScopeEvidenceFile,
      provider_scope_evidence_sha256: providerScopeEvidenceSha256,
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
      provider_scope_evidence_file: providerScopeEvidenceFile,
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
      provider_scope_evidence_sha256: providerScopeEvidenceSha256,
    },
    scope_decision: {
      summary: "Initial review covers the full pull request.",
      selected_range: providerPrDiffRange,
      full_range: providerPrDiffRange,
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
    providerScopeEvidenceFile,
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

function formatExpectedMarkdownCodeSpan(value: string): string {
  const backtickRuns = value.match(/`+/gu) ?? [];
  if (backtickRuns.length === 0) {
    return `\`${value}\``;
  }
  const delimiter = "`".repeat(
    Math.max(...backtickRuns.map((run) => run.length)) + 1,
  );
  return `${delimiter} ${value} ${delimiter}`;
}

function normalizeComparablePath(value: string): string {
  const normalized = value.replace(/\\/gu, "/");
  return /^[A-Za-z]:\//u.test(normalized)
    ? normalized.toLowerCase()
    : normalized;
}
