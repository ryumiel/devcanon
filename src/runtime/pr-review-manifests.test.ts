import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PrReviewCommandHarness } from "../__test-helpers__/pr-review-command-harness.js";

const originalCwd = process.cwd();
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
  "DRIFT_FILE",
  "DELAYED_REFUSAL_MARKER",
] as const;
const commandHarness = new PrReviewCommandHarness({
  envKeys: managedEnvKeys,
  seed: "review",
});
let sharedPrReviewDir = "";
let sharedPlayReviewHelper = "";

beforeAll(async () => {
  await commandHarness.setup();
  const helperRoot = path.join(commandHarness.suiteRoot, "h");
  commandHarness.assertOwnedPath(
    path.join(helperRoot, "pr-review", "scripts", "prior-thread-artifacts.sh"),
  );
  sharedPrReviewDir = await writePrReviewHelper(helperRoot);
  sharedPlayReviewHelper = await writeExecutable(
    path.join(helperRoot, "play-review-helper.sh"),
    ["#!/usr/bin/env bash", "set -euo pipefail", "exit 0", ""].join("\n"),
  );
});

beforeEach(() => {
  commandHarness.beginTest();
});

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
  await commandHarness.endTest();
  vi.doUnmock("./pr-review-leases.js");
  vi.doUnmock("./pr-review-result-validation.js");
  vi.resetModules();
});

afterAll(async () => {
  await commandHarness.dispose();
});

describe("pr-review Phase 5 audit summary renderer", () => {
  it("refuses extraneous arguments before reading a result preview", async () => {
    const outcome = await runManifestCommand([
      "read-result-for-preview",
      "unexpected",
    ]);

    expect(outcome).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "read-result-for-preview does not accept arguments\n",
    });
  });

  it("reads a result-owned preview with the exact stable schema and nullable paths", async () => {
    const workspace = await makeManifestWorkspace("pr-review-result-preview-");
    setSummaryEnv(workspace);
    process.chdir(workspace.worktree);
    const result = JSON.parse(
      await readFile(
        path.join(workspace.worktree, workspace.resultFile),
        "utf8",
      ),
    ) as {
      digests: Record<string, unknown>;
    };
    await writeJson(workspace.worktree, workspace.resultFile, {
      ...result,
      review_body_file: null,
      digests: { ...result.digests, review_body_sha256: null },
    });

    const outcome = await runManifestCommand(["read-result-for-preview"]);

    expect(outcome.exitCode, outcome.stderr).toBe(0);
    expect(outcome.stderr).toBe("");
    expect(JSON.parse(outcome.stdout)).toEqual({
      schema: "pr-review/result-preview/v1",
      review_head_sha: workspace.headSha,
      handoff_file: `.ephemeral/pr-432-${workspace.headSha}-handoff.json`,
      head_ref: "topic",
      findings_file: workspace.findingsFile,
      review_body_file: null,
      scope_decision_file: `.ephemeral/topic-${workspace.headSha}-scope-decision.json`,
      prior_threads_file: null,
      rendered_preview_file: `.ephemeral/topic-${workspace.headSha}-review-preview.md`,
    });
    expect(Object.keys(JSON.parse(outcome.stdout))).toEqual([
      "schema",
      "review_head_sha",
      "handoff_file",
      "head_ref",
      "findings_file",
      "review_body_file",
      "scope_decision_file",
      "prior_threads_file",
      "rendered_preview_file",
    ]);
  });

  it("rejects stale result evidence before emitting a preview", async () => {
    const workspace = await makeManifestWorkspace("pr-review-stale-preview-");
    setSummaryEnv(workspace);
    process.chdir(workspace.worktree);
    await writeFile(
      path.join(workspace.worktree, workspace.reviewBodyFile),
      "Changed after validation.\n",
    );

    const outcome = await runManifestCommand(["read-result-for-preview"]);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stdout).toBe("");
    expect(outcome.stderr).toContain("review body digest mismatch");
  });

  it("projects the preview from validator-accepted result and handoff evidence", async () => {
    const workspace = await makeManifestWorkspace(
      "pr-review-preview-evidence-",
    );
    setSummaryEnv(workspace);
    process.chdir(workspace.worktree);
    const acceptedResult = JSON.parse(
      await readFile(
        path.join(workspace.worktree, workspace.resultFile),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const acceptedHandoff = JSON.parse(
      await readFile(
        path.join(
          workspace.worktree,
          `.ephemeral/pr-432-${workspace.headSha}-handoff.json`,
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    await writeJson(workspace.worktree, workspace.resultFile, {
      ...acceptedResult,
      findings_file: ".ephemeral/replaced-findings.json",
    });
    await writeJson(
      workspace.worktree,
      `.ephemeral/pr-432-${workspace.headSha}-handoff.json`,
      { ...acceptedHandoff, head_ref: "replaced-head" },
    );
    vi.doMock("./pr-review-result-validation.js", async (importOriginal) => ({
      ...(await importOriginal<
        typeof import("./pr-review-result-validation.js")
      >()),
      validatePrReviewResultCommandAuthority: vi.fn(async () => ({
        result: acceptedResult,
        handoff: acceptedHandoff,
      })),
    }));

    const outcome = await runManifestCommand(["read-result-for-preview"]);

    expect(outcome.exitCode, outcome.stderr).toBe(0);
    expect(JSON.parse(outcome.stdout)).toMatchObject({
      findings_file: workspace.findingsFile,
      head_ref: "topic",
    });
  });

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

  it.each([
    {
      name: "non-json",
      stdout: () => "not json\n",
      expectStderr: "single JSON object",
    },
    {
      name: "missing-field",
      stdout: (workspace: ManifestWorkspace) => {
        const { presented_at: _presentedAt, ...status } =
          validStatus(workspace);
        return `${JSON.stringify(status)}\n`;
      },
      expectStderr: "schema mismatch",
    },
    {
      name: "unknown-field",
      stdout: (workspace: ManifestWorkspace) =>
        `${JSON.stringify({ ...validStatus(workspace), can_remove: true })}\n`,
      expectStderr: "schema mismatch",
    },
    {
      name: "invalid-domain",
      stdout: (workspace: ManifestWorkspace) =>
        `${JSON.stringify({ ...validStatus(workspace), lease_state: "reviewed" })}\n`,
      expectStderr: "lease state must be gated",
    },
    {
      name: "digest-mismatch",
      stdout: (workspace: ManifestWorkspace) =>
        `${JSON.stringify({ ...validStatus(workspace), result_sha256: "0".repeat(64) })}\n`,
      expectStderr: "result digest mismatch",
    },
    {
      name: "stale-status",
      stdout: (workspace: ManifestWorkspace) =>
        `${JSON.stringify({ ...validStatus(workspace), result_validated_at: "2026-06-11T00:01:00Z" })}\n`,
      expectStderr: "validation timestamp is stale",
    },
    {
      name: "presentation-mismatch",
      stdout: (workspace: ManifestWorkspace) =>
        `${JSON.stringify({ ...validStatus(workspace), presentation_status: "edited" })}\n`,
      expectStderr: "presentation status mismatch",
    },
    {
      name: "status-diagnostic",
      stderr: "result manifest digest mismatch\n",
      expectStderr: "read-status failed",
    },
  ] satisfies Array<{
    name: string;
    stdout?: (workspace: ManifestWorkspace) => string;
    stderr?: string;
    expectStderr: string;
  }>)(
    "fails closed for malformed or inconsistent read-status output: $name",
    async (testCase) => {
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
    },
  );

  it("reports dirty-but-valid worktree status", async () => {
    const dirty = await makeManifestWorkspace("pr-review-summary-dirty-");
    setSummaryEnv(dirty);
    const result = await runManifestCommand(["render-phase5-audit-summary"]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("dirty `true`");
  });

  it.each([
    ["worktree_exists", "worktree does not exist"],
    ["worktree_registered", "worktree is not registered"],
    ["identity_match", "identity mismatch"],
  ] as const)("fails closed when %s is false", async (field, expected) => {
    const falseStatusWorkspace = await makeManifestWorkspace(
      "pr-review-summary-false-status-",
    );
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
      const result = await runManifestCommand(["render-phase5-audit-summary"]);

      expect(result.exitCode, field).toBe(1);
      expect(result.stderr, field).toContain(expected);
    } finally {
      vi.doUnmock("./pr-review-leases.js");
      vi.resetModules();
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
    {
      name: "schema",
      patch: { schema: "pr-review/provider-scope-evidence/v1" },
      stderr: "provider evidence schema mismatch",
    },
    {
      name: "provider",
      patch: { provider: "gitlab" },
      stderr: "provider evidence provider must be github",
    },
    {
      name: "baseRefOid",
      patch: { baseRefOid: "main" },
      stderr: "provider evidence baseRefOid is malformed",
    },
    {
      name: "full range",
      patch: { full_pr_diff_range: `${"0".repeat(40)}..${"1".repeat(40)}` },
      stderr: "provider evidence full range mismatch",
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
    const workspace = await commandHarness.createReviewRepository();
    const headSha = (
      await commandHarness.run("git", ["rev-parse", "HEAD"], {
        cwd: workspace.repository,
      })
    ).stdout.trim();
    const helper = await writeExecutable(
      path.join(workspace.tempRoot, "pass-validator.sh"),
      ["#!/usr/bin/env bash", "set -euo pipefail", "exit 0", ""].join("\n"),
    );
    const adapter = path.join(
      originalCwd,
      "skills/pr-review/scripts/prior-thread-artifacts.sh",
    );

    await expect(
      commandHarness.run("bash", [adapter, "validate-scope-decision"], {
        cwd: workspace.repository,
        env: {
          ...process.env,
          HEAD_SHA: headSha,
          BASE_REF: headSha,
          SCOPE_DECISION_FILE: `.ephemeral/main-${headSha}-scope-decision.json`,
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

describe("pr-review manifest review body writer", () => {
  it("derives, creates, and reports the canonical body for an initial null target", async () => {
    const workspace = await makeManifestWorkspace("pr-review-body-null-");
    setSummaryEnv(workspace);
    process.chdir(workspace.worktree);
    const result = JSON.parse(
      await readFile(
        path.join(workspace.worktree, workspace.resultFile),
        "utf8",
      ),
    ) as { digests: Record<string, unknown> };
    await writeJson(workspace.worktree, workspace.resultFile, {
      ...result,
      review_body_file: null,
      digests: { ...result.digests, review_body_sha256: null },
    });
    await rm(path.join(workspace.worktree, workspace.reviewBodyFile));

    const outcome = await runManifestCommandWithStdin(
      ["write-review-body"],
      "Initial body.\n",
    );

    expect(outcome).toEqual({
      exitCode: 0,
      stdout: `${workspace.reviewBodyFile}\n`,
      stderr: "",
    });
    await expect(
      readFile(path.join(workspace.worktree, workspace.reviewBodyFile), "utf8"),
    ).resolves.toBe("Initial body.\n");
    await expect(
      runManifestCommand(["recover-review-body-publication"]),
    ).resolves.toEqual({
      exitCode: 0,
      stdout: `${workspace.resultFile}\n`,
      stderr: "",
    });
    const preview = await runManifestCommand(["read-result-for-preview"]);
    expect(preview.exitCode, preview.stderr).toBe(0);
    expect(JSON.parse(preview.stdout)).toMatchObject({
      review_body_file: workspace.reviewBodyFile,
    });
  });

  it("replaces the canonical result-bound review body from complete Markdown stdin", async () => {
    const workspace = await makeManifestWorkspace("pr-review-body-write-");
    setSummaryEnv(workspace);
    process.chdir(workspace.worktree);

    const outcome = await runManifestCommandWithStdin(
      ["write-review-body"],
      "# Replacement\n\nBody text.\n",
    );

    expect(outcome).toEqual({
      exitCode: 0,
      stdout: `${workspace.reviewBodyFile}\n`,
      stderr: "",
    });
    await expect(
      readFile(path.join(workspace.worktree, workspace.reviewBodyFile), "utf8"),
    ).resolves.toBe("# Replacement\n\nBody text.\n");
  });

  it("recovers an interrupted body publication before validating, reading, and retrying", async () => {
    const workspace = await makeManifestWorkspace("pr-review-body-recovery-");
    setSummaryEnv(workspace);
    process.chdir(workspace.worktree);

    const publication = await runManifestCommandWithStdin(
      ["write-review-body"],
      "Published before interruption.\n",
    );
    expect(publication.exitCode, publication.stderr).toBe(0);

    const staleValidation = await runManifestCommand(["validate-result"]);
    expect(staleValidation.exitCode).toBe(1);
    expect(staleValidation.stderr).toContain("review body digest mismatch");

    const recovery = await runManifestCommand([
      "recover-review-body-publication",
    ]);
    expect(recovery).toEqual({
      exitCode: 0,
      stdout: `${workspace.resultFile}\n`,
      stderr: "",
    });

    await expect(runManifestCommand(["validate-result"])).resolves.toEqual({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
    await expect(
      runManifestCommand(["read-result-for-preview"]),
    ).resolves.toMatchObject({ exitCode: 0 });
    const result = JSON.parse(
      await readFile(
        path.join(workspace.worktree, workspace.resultFile),
        "utf8",
      ),
    ) as {
      artifacts: Record<string, unknown>;
      digests: Record<string, unknown>;
      presentation: Record<string, unknown>;
    };
    expect(result.artifacts.rendered_preview_file).toBeNull();
    expect(result.digests.rendered_preview_sha256).toBeNull();
    expect(result.presentation.status).toBe("edited");

    const retry = await runManifestCommandWithStdin(
      ["write-review-body"],
      "Retried body publication.\n",
    );
    expect(retry).toEqual({
      exitCode: 0,
      stdout: `${workspace.reviewBodyFile}\n`,
      stderr: "",
    });
    await expect(
      runManifestCommand(["recover-review-body-publication"]),
    ).resolves.toEqual({
      exitCode: 0,
      stdout: `${workspace.resultFile}\n`,
      stderr: "",
    });
    await expect(
      runManifestCommand(["read-result-for-preview"]),
    ).resolves.toMatchObject({
      exitCode: 0,
    });
  });

  it.each([
    {
      name: "stale findings authority",
      input: "Replacement\n",
      mutate: async (workspace: ManifestWorkspace) =>
        writeFile(
          path.join(workspace.worktree, workspace.findingsFile),
          '{"invalid":true}\n',
        ),
      stderr: "findings digest mismatch",
    },
    {
      name: "a noncanonical result body path",
      input: "Replacement\n",
      mutate: async (workspace: ManifestWorkspace) => {
        const result = JSON.parse(
          await readFile(
            path.join(workspace.worktree, workspace.resultFile),
            "utf8",
          ),
        ) as Record<string, unknown>;
        await writeJson(workspace.worktree, workspace.resultFile, {
          ...result,
          review_body_file: ".ephemeral/other-review-body.md",
        });
      },
      stderr: "review body path mismatch",
    },
    {
      name: "malformed UTF-8 stdin",
      input: Buffer.from([0xff]),
      mutate: async () => undefined,
      stderr: "review body stdin must be valid UTF-8 Markdown",
    },
  ])("preserves the body for $name", async ({ input, mutate, stderr }) => {
    const workspace = await makeManifestWorkspace("pr-review-body-reject-");
    setSummaryEnv(workspace);
    process.chdir(workspace.worktree);
    const before = await readFile(
      path.join(workspace.worktree, workspace.reviewBodyFile),
      "utf8",
    );
    await mutate(workspace);

    const outcome = await runManifestCommandWithStdin(
      ["write-review-body"],
      input,
    );

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stdout).toBe("");
    expect(outcome.stderr).toContain(stderr);
    await expect(
      readFile(path.join(workspace.worktree, workspace.reviewBodyFile), "utf8"),
    ).resolves.toBe(before);
  });

  it.each([
    {
      name: "directory",
      prepare: async (workspace: ManifestWorkspace) => {
        const body = path.join(workspace.worktree, workspace.reviewBodyFile);
        await rm(body);
        await mkdir(body);
      },
      stderr: "review body file missing or not a regular file",
    },
    {
      name: "symlink",
      prepare: async (workspace: ManifestWorkspace) => {
        const body = path.join(workspace.worktree, workspace.reviewBodyFile);
        const externalBody = path.join(workspace.worktree, "external-body.md");
        await rm(body);
        await writeFile(externalBody, "External.\n");
        await symlink(externalBody, body);
      },
      stderr: "review body file must not be a symlink",
    },
  ])(
    "rejects a $name review body before writing",
    async ({ prepare, stderr }) => {
      const workspace = await makeManifestWorkspace("pr-review-body-hostile-");
      setSummaryEnv(workspace);
      process.chdir(workspace.worktree);
      await prepare(workspace);

      const outcome = await runManifestCommandWithStdin(
        ["write-review-body"],
        "Replacement\n",
      );

      expect(outcome.exitCode).toBe(1);
      expect(outcome.stdout).toBe("");
      expect(outcome.stderr).toContain(stderr);
      const body = await lstat(
        path.join(workspace.worktree, workspace.reviewBodyFile),
      );
      expect(body.isDirectory() || body.isSymbolicLink()).toBe(true);
    },
  );
});

describe("pr-review findings publication rebinder", () => {
  it("refuses without the public findings helper input", async () => {
    const workspace = await makeManifestWorkspace("pr-review-findings-input-");
    setSummaryEnv(workspace);
    process.chdir(workspace.worktree);
    Reflect.deleteProperty(process.env, "PLAY_REVIEW_HELPER");

    await expect(
      runManifestCommandWithStdin(["replace-findings"], "{}"),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "PLAY_REVIEW_HELPER is required\n",
    });
  });

  it("rebinds published findings and invalidates the rendered preview", async () => {
    const workspace = await makeManifestWorkspace("pr-review-findings-rebind-");
    setSummaryEnv(workspace);
    process.env.PLAY_REVIEW_HELPER = await writePublishingPlayReviewHelper(
      workspace.tempRoot,
    );
    process.chdir(workspace.worktree);
    const replacement = JSON.stringify({
      schema: "play-review/findings/v2",
      findings: [{ id: "F2", title: "Replacement finding" }],
      carry_forward: [],
    });

    await expect(
      runManifestCommandWithStdin(["replace-findings"], replacement),
    ).resolves.toEqual({
      exitCode: 0,
      stdout: `${workspace.resultFile}\n`,
      stderr: "",
    });

    const result = JSON.parse(
      await readFile(
        path.join(workspace.worktree, workspace.resultFile),
        "utf8",
      ),
    ) as {
      artifacts: Record<string, unknown>;
      digests: Record<string, unknown>;
      presentation: Record<string, unknown>;
    };
    expect(result.digests.findings_sha256).toBe(
      await sha256File(path.join(workspace.worktree, workspace.findingsFile)),
    );
    expect(result.artifacts.rendered_preview_file).toBeNull();
    expect(result.digests.rendered_preview_sha256).toBeNull();
    expect(result.presentation.status).toBe("edited");
    await expect(runManifestCommand(["validate-result"])).resolves.toEqual({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
  });

  it("refuses a successful publisher that leaves the old findings canonical", async () => {
    const workspace = await makeManifestWorkspace("pr-review-findings-noop-");
    setSummaryEnv(workspace);
    process.env.PLAY_REVIEW_HELPER = await writeNoopPlayReviewHelper(
      workspace.tempRoot,
    );
    process.chdir(workspace.worktree);
    const beforeFindings = await readFile(
      path.join(workspace.worktree, workspace.findingsFile),
      "utf8",
    );
    const beforeResult = await readFile(
      path.join(workspace.worktree, workspace.resultFile),
      "utf8",
    );
    const replacement = JSON.stringify({
      schema: "play-review/findings/v2",
      findings: [{ id: "F2", title: "Unpublished replacement" }],
      carry_forward: [],
    });

    const outcome = await runManifestCommandWithStdin(
      ["replace-findings"],
      replacement,
    );

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stdout).toBe("");
    expect(outcome.stderr).toContain("published findings digest mismatch");
    await expect(
      readFile(path.join(workspace.worktree, workspace.findingsFile), "utf8"),
    ).resolves.toBe(beforeFindings);
    await expect(
      readFile(path.join(workspace.worktree, workspace.resultFile), "utf8"),
    ).resolves.toBe(beforeResult);
  });

  it("retries after publication when only the canonical findings digest is stale", async () => {
    const workspace = await makeManifestWorkspace("pr-review-findings-retry-");
    setSummaryEnv(workspace);
    process.env.PLAY_REVIEW_HELPER = await writePublishingPlayReviewHelper(
      workspace.tempRoot,
    );
    process.chdir(workspace.worktree);
    const published = JSON.stringify({
      schema: "play-review/findings/v2",
      findings: [{ id: "F2", title: "Published before interruption" }],
      carry_forward: [],
    });
    await writeFile(
      path.join(workspace.worktree, workspace.findingsFile),
      published,
    );

    const stale = await runManifestCommand(["validate-result"]);
    expect(stale.exitCode).toBe(1);
    expect(stale.stderr).toContain("findings digest mismatch");

    await expect(
      runManifestCommandWithStdin(["replace-findings"], published),
    ).resolves.toEqual({
      exitCode: 0,
      stdout: `${workspace.resultFile}\n`,
      stderr: "",
    });
    await expect(runManifestCommand(["validate-result"])).resolves.toEqual({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
  });

  it("refuses retry authority when canonical findings drift differs from stdin", async () => {
    const workspace = await makeManifestWorkspace(
      "pr-review-findings-unrelated-drift-",
    );
    setSummaryEnv(workspace);
    process.env.PLAY_REVIEW_HELPER = await writePublishingPlayReviewHelper(
      workspace.tempRoot,
    );
    process.chdir(workspace.worktree);
    const drifted = JSON.stringify({
      schema: "play-review/findings/v2",
      findings: [{ id: "F2", title: "Unrelated canonical drift" }],
      carry_forward: [],
    });
    const replacement = JSON.stringify({
      schema: "play-review/findings/v2",
      findings: [{ id: "F3", title: "Different submitted envelope" }],
      carry_forward: [],
    });
    await writeFile(
      path.join(workspace.worktree, workspace.findingsFile),
      drifted,
    );
    const beforeResult = await readFile(
      path.join(workspace.worktree, workspace.resultFile),
      "utf8",
    );

    await expect(
      runManifestCommandWithStdin(["replace-findings"], replacement),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: `findings digest mismatch: ${workspace.findingsFile}\n`,
    });
    await expect(
      readFile(path.join(workspace.worktree, workspace.findingsFile), "utf8"),
    ).resolves.toBe(drifted);
    await expect(
      readFile(path.join(workspace.worktree, workspace.resultFile), "utf8"),
    ).resolves.toBe(beforeResult);
  });

  it("refuses to overwrite a result when publication causes unrelated drift", async () => {
    const workspace = await makeManifestWorkspace("pr-review-findings-race-");
    setSummaryEnv(workspace);
    process.env.PLAY_REVIEW_HELPER = await writePublishingPlayReviewHelper(
      workspace.tempRoot,
    );
    process.env.DRIFT_FILE = path.join(
      workspace.worktree,
      workspace.reviewBodyFile,
    );
    process.chdir(workspace.worktree);
    const beforeResult = await readFile(
      path.join(workspace.worktree, workspace.resultFile),
      "utf8",
    );

    const outcome = await runManifestCommandWithStdin(
      ["replace-findings"],
      JSON.stringify({
        schema: "play-review/findings/v2",
        findings: [{ id: "F2", title: "Published before body drift" }],
        carry_forward: [],
      }),
    );

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stdout).toBe("");
    expect(outcome.stderr).toContain("review body digest mismatch");
    await expect(
      readFile(path.join(workspace.worktree, workspace.resultFile), "utf8"),
    ).resolves.toBe(beforeResult);
  });

  it("waits for a delayed publisher refusal after stdin closes early", async () => {
    const workspace = await makeManifestWorkspace("pr-review-findings-epipe-");
    setSummaryEnv(workspace);
    process.env.PLAY_REVIEW_HELPER = await writeEarlyStdinRefusalHelper(
      workspace.tempRoot,
    );
    const marker = path.join(workspace.tempRoot, "publisher-terminal-marker");
    process.env.DELAYED_REFUSAL_MARKER = marker;
    process.chdir(workspace.worktree);

    const outcome = await runManifestCommandWithStdin(
      ["replace-findings"],
      Buffer.alloc(1024 * 1024, "x"),
    );

    expect(outcome).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "delayed publisher refusal\n",
    });
    await expect(readFile(marker, "utf8")).resolves.toBe("closed\n");
  });

  it.each([
    {
      name: "invalid input",
      input: "",
      mutate: async () => undefined,
      stderr: "findings input must contain exactly one complete JSON envelope",
    },
    {
      name: "stale immutable identity",
      input: JSON.stringify({
        schema: "play-review/findings/v2",
        findings: [],
        carry_forward: [],
      }),
      mutate: async () => {
        process.env.HEAD_SHA = "a".repeat(40);
      },
      stderr: "review head mismatch",
    },
    {
      name: "unrelated result drift",
      input: JSON.stringify({
        schema: "play-review/findings/v2",
        findings: [],
        carry_forward: [],
      }),
      mutate: async (workspace: ManifestWorkspace) =>
        writeFile(
          path.join(workspace.worktree, workspace.reviewBodyFile),
          "Changed outside findings publication.\n",
        ),
      stderr: "review body digest mismatch",
    },
  ])("preserves artifacts for $name", async ({ input, mutate, stderr }) => {
    const workspace = await makeManifestWorkspace("pr-review-findings-refuse-");
    setSummaryEnv(workspace);
    process.env.PLAY_REVIEW_HELPER = await writePublishingPlayReviewHelper(
      workspace.tempRoot,
    );
    process.chdir(workspace.worktree);
    const beforeFindings = await readFile(
      path.join(workspace.worktree, workspace.findingsFile),
      "utf8",
    );
    const beforeResult = await readFile(
      path.join(workspace.worktree, workspace.resultFile),
      "utf8",
    );
    await mutate(workspace);

    const outcome = await runManifestCommandWithStdin(
      ["replace-findings"],
      input,
    );

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stdout).toBe("");
    expect(outcome.stderr).toContain(stderr);
    await expect(
      readFile(path.join(workspace.worktree, workspace.findingsFile), "utf8"),
    ).resolves.toBe(beforeFindings);
    await expect(
      readFile(path.join(workspace.worktree, workspace.resultFile), "utf8"),
    ).resolves.toBe(beforeResult);
  });
});

async function runManifestCommand(
  args: readonly string[],
): Promise<RuntimeCommandOutcome> {
  const { runPrReviewManifestsCommand } = await import(
    "./pr-review-manifests.js"
  );
  return commandHarness.trackOuter(
    runPrReviewManifestsCommand(args),
    `pr-review-manifests ${args.join(" ")}`,
  );
}

async function runManifestCommandWithStdin(
  args: readonly string[],
  input: string | Buffer,
): Promise<RuntimeCommandOutcome> {
  const descriptor = Object.getOwnPropertyDescriptor(process, "stdin");
  Object.defineProperty(process, "stdin", {
    configurable: true,
    value: Readable.from([input]),
  });
  try {
    return await runManifestCommand(args);
  } finally {
    if (descriptor === undefined) {
      Reflect.deleteProperty(process, "stdin");
    } else {
      Object.defineProperty(process, "stdin", descriptor);
    }
  }
}

async function makeManifestWorkspace(
  _prefix: string,
): Promise<ManifestWorkspace> {
  const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
    await commandHarness.createRegisteredReviewWorkspace();
  const baseSha = (
    await commandHarness.run("git", ["rev-parse", "HEAD"], { cwd: primary })
  ).stdout.trim();
  const headSha = (
    await commandHarness.run("git", ["rev-parse", "HEAD"], { cwd: worktree })
  ).stdout.trim();
  const prReviewDir = sharedPrReviewDir;
  const playReviewHelper = sharedPlayReviewHelper;

  await mkdir(path.join(primary, ".ephemeral"), { recursive: true });
  await mkdir(path.join(worktree, ".ephemeral"), { recursive: true });
  const findingsFile = `.ephemeral/topic-${headSha}-findings.json`;
  const scopeFile = `.ephemeral/topic-${headSha}-scope-decision.json`;
  const handoffFile = `.ephemeral/pr-432-${headSha}-handoff.json`;
  const resultFile = `.ephemeral/pr-432-${headSha}-result.json`;
  const reviewBodyFile = `.ephemeral/pr-432-${headSha}-review-body.md`;
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
    schema: "play-review/findings/v2",
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

async function writePublishingPlayReviewHelper(
  tempRoot: string,
): Promise<string> {
  return writeExecutable(
    path.join(tempRoot, "publishing-play-review-helper.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'case "$1" in',
      "  validate-findings)",
      "    exit 0",
      "    ;;",
      "  publish-findings)",
      '    staged="$(mktemp)"',
      "    trap 'rm -f \"$staged\"' EXIT",
      '    cat > "$staged"',
      "    jq -e -s 'length == 1' \"$staged\" >/dev/null || {",
      '      echo "findings input must contain exactly one complete JSON envelope" >&2',
      "      exit 1",
      "    }",
      '    mv "$staged" "$FINDINGS_FILE"',
      "    trap - EXIT",
      '    if [ -n "${DRIFT_FILE:-}" ]; then',
      '      printf "Changed after findings publication.\\n" > "$DRIFT_FILE"',
      "    fi",
      '    printf "%s\\n" "$FINDINGS_FILE"',
      "    ;;",
      "  *)",
      '    echo "unexpected helper command" >&2',
      "    exit 1",
      "    ;;",
      "esac",
      "",
    ].join("\n"),
  );
}

async function writeNoopPlayReviewHelper(tempRoot: string): Promise<string> {
  return writeExecutable(
    path.join(tempRoot, "noop-play-review-helper.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'case "$1" in',
      "  validate-findings)",
      "    exit 0",
      "    ;;",
      "  publish-findings)",
      "    cat >/dev/null",
      '    printf "%s\\n" "$FINDINGS_FILE"',
      "    ;;",
      "  *)",
      "    exit 1",
      "    ;;",
      "esac",
      "",
    ].join("\n"),
  );
}

async function writeEarlyStdinRefusalHelper(tempRoot: string): Promise<string> {
  return writeExecutable(
    path.join(tempRoot, "early-stdin-refusal-helper.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'case "$1" in',
      "  validate-findings)",
      "    exit 0",
      "    ;;",
      "  publish-findings)",
      "    exec 0<&-",
      "    sleep 0.15",
      '    printf "closed\\n" > "$DELAYED_REFUSAL_MARKER"',
      '    echo "delayed publisher refusal" >&2',
      "    exit 1",
      "    ;;",
      "  *)",
      "    exit 1",
      "    ;;",
      "esac",
      "",
    ].join("\n"),
  );
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
