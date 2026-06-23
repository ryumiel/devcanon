import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  canCreateSymlinks,
  cleanupTempDir,
} from "../__test-helpers__/fixtures.js";

const execFileAsync = promisify(execFile);
const symlinkAvailable = await canCreateSymlinks();
const jqAvailable = await commandAvailable("jq");
const mkfifoAvailable = await commandAvailable("mkfifo");
const helperScript = path.join(
  process.cwd(),
  "skills/pr-review/scripts/approved-review-artifacts.sh",
);
const headSha = "0123456789abcdef0123456789abcdef01234567";
const staleHeadSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const findingsFile = `.ephemeral/topic-${headSha}-findings.json`;
const reviewBodyFile = ".ephemeral/topic-review-body.md";
const payloadFile = `.ephemeral/topic-${headSha}-review-payload.json`;
const scopeDecisionFile = `.ephemeral/topic-${headSha}-scope-decision.json`;
const providerScopeEvidenceFile = `.ephemeral/topic-${headSha}-provider-scope-evidence.json`;
const PROVIDER_EVIDENCE_SCHEMA = "pr-review/provider-scope-evidence/v2";
const DIGEST_PROVENANCE_SCHEMA = "pr-review/digest-provenance/v1";
const CANONICAL_GIT_DIFF_DIALECT = "canonical-git-diff/v1";
const approvedReviewFile = `.ephemeral/topic-${headSha}-approved-review.json`;
const priorThreadsFile = `.ephemeral/topic-${headSha}-prior-threads.json`;

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync("bash", ["-c", `command -v ${command}`]);
    return true;
  } catch {
    return false;
  }
}

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "devcanon-pr-review-approved-"),
  );
  await mkdir(path.join(dir, ".ephemeral"));
  return dir;
}

async function makeGitWorkspace(): Promise<string> {
  const cwd = await makeWorkspace();
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd,
  });
  await writeFile(path.join(cwd, "README.md"), "baseline\n");
  await execFileAsync("git", ["add", "README.md"], { cwd });
  await execFileAsync("git", ["commit", "-m", "chore: baseline"], { cwd });
  await execFileAsync("git", ["switch", "-C", "topic"], { cwd });
  return cwd;
}

function findingsEnvelope() {
  return {
    schema: "play-review/findings/v1",
    findings: [],
    carry_forward: [],
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    commit_id: headSha,
    event: "COMMENT",
    body: "Review body\n",
    comments: [
      {
        path: "src/example.ts",
        line: 12,
        side: "RIGHT",
        body: "Inline comment\n",
      },
    ],
    ...overrides,
  };
}

function payloadWithRange(overrides: Record<string, unknown> = {}) {
  return payload({
    comments: [
      {
        path: "src/example.ts",
        line: 12,
        start_line: 10,
        start_side: "RIGHT",
        side: "RIGHT",
        body: "Ranged inline comment\n",
      },
      {
        path: "src/other.ts",
        line: 4,
        side: "RIGHT",
        body: "Single-line inline comment\n",
      },
    ],
    ...overrides,
  });
}

function prReviewInitialScope(
  baseSha: string,
  headShaValue: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    schema: "pr-review/scope-decision/v1",
    surface: "pr-review",
    mode: "initial",
    head_sha: headShaValue,
    full_range: `${baseSha}..${headShaValue}`,
    selected_range: `${baseSha}..${headShaValue}`,
    candidate_narrow_range: `${baseSha}..${headShaValue}`,
    last_reviewed_sha: null,
    is_followup_narrow: false,
    selection_reason: "Initial PR review uses the full review range.",
    changed_files: ["src/example.ts"],
    language_hints: ["ts"],
    escalation_reasons: ["not-followup"],
    prior_context: {
      kind: "none",
      path: null,
    },
    mechanical_facts: {
      changed_file_count: 1,
      followup_sha_usable: false,
      mechanical_escalate_full: true,
      mechanical_escalation_reason: "not-followup",
    },
    semantic_decision: {
      checked: true,
      ambiguous: false,
      notes: "",
    },
    artifacts: {
      provider_scope_evidence_file: `.ephemeral/topic-${headShaValue}-provider-scope-evidence.json`,
      provider_scope_evidence_sha256: "0".repeat(64),
    },
    ...overrides,
  };
}

async function writeJson(cwd: string, relPath: string, value: unknown) {
  await writeFile(path.join(cwd, relPath), JSON.stringify(value, null, 2));
}

async function canonicalGitDiffRaw(
  cwd: string,
  range: string,
  pathspecs: readonly string[] = [],
): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    [
      "-c",
      "diff.noprefix=false",
      "-c",
      "diff.mnemonicPrefix=false",
      "-c",
      "diff.srcPrefix=a/",
      "-c",
      "diff.dstPrefix=b/",
      "-c",
      "diff.relative=false",
      "-c",
      "core.abbrev=40",
      "-c",
      "diff.abbrev=40",
      "-c",
      "diff.context=3",
      "-c",
      "diff.interHunkContext=0",
      "-c",
      "diff.algorithm=myers",
      "-c",
      "diff.renames=true",
      "-c",
      "diff.renameLimit=0",
      "-c",
      "diff.color=false",
      "-c",
      "color.ui=false",
      "-c",
      "core.quotePath=true",
      "-c",
      "diff.suppressBlankEmpty=false",
      "-c",
      "diff.indentHeuristic=false",
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--find-renames",
      "--diff-algorithm=myers",
      "--unified=3",
      "--inter-hunk-context=0",
      range,
      ...(pathspecs.length > 0 ? ["--", ...pathspecs] : []),
    ],
    { cwd },
  );
  return stdout;
}

async function sha256File(cwd: string, relPath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path.join(cwd, relPath)))
    .digest("hex");
}

async function writeInputs(cwd: string) {
  await writeJson(cwd, providerScopeEvidenceFile, {
    schema: "pr-review/provider-scope-evidence/v1",
  });
  await writeJson(cwd, findingsFile, findingsEnvelope());
  await writeFile(path.join(cwd, reviewBodyFile), "Review body\n");
  await writeJson(cwd, payloadFile, payload());
  await writeJson(
    cwd,
    scopeDecisionFile,
    prReviewInitialScope(headSha, headSha),
  );
}

async function writeRealProviderEvidence(
  cwd: string,
  baseSha: string,
  headShaValue: string,
  filePath: string,
) {
  const patch = await canonicalGitDiffRaw(cwd, `${baseSha}..${headShaValue}`, [
    "src/example.ts",
  ]);
  const fullDiff = await canonicalGitDiffRaw(
    cwd,
    `${baseSha}..${headShaValue}`,
  );
  const entry = {
    path: "src/example.ts",
    status: "added",
    previous_path: null,
    additions: 1,
    deletions: 0,
    changes: 1,
    patch_sha256: createHash("sha256").update(patch).digest("hex"),
    patch_available: true,
  };
  await writeJson(cwd, filePath, {
    schema: PROVIDER_EVIDENCE_SCHEMA,
    provider: "github",
    repository: "owner/repo",
    pr_number: 390,
    baseRefOid: baseSha,
    headRefOid: headShaValue,
    provider_pr_diff_base_sha: baseSha,
    local_review_head_sha: headShaValue,
    full_pr_diff_range: `${baseSha}..${headShaValue}`,
    evidence_complete: true,
    digest_provenance: {
      schema: DIGEST_PROVENANCE_SCHEMA,
      provider_diff: CANONICAL_GIT_DIFF_DIALECT,
      local_diff: CANONICAL_GIT_DIFF_DIALECT,
      provider_patches: CANONICAL_GIT_DIFF_DIALECT,
      local_patches: CANONICAL_GIT_DIFF_DIALECT,
    },
    provider_files: [entry],
    local_files: [entry],
    provider_diff_sha256: createHash("sha256").update(fullDiff).digest("hex"),
    local_diff_sha256: createHash("sha256").update(fullDiff).digest("hex"),
  });
}

async function runHelper(
  cwd: string,
  command: string,
  env: NodeJS.ProcessEnv = {},
) {
  const supportValidator =
    env.PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT ??
    (await writePassingSupportValidator(cwd));
  return execFileAsync("bash", [helperScript, command], {
    cwd,
    env: {
      ...process.env,
      BASE_REF: "main",
      HEAD_SHA: headSha,
      PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: supportValidator,
      ...env,
    },
  });
}

async function writePassingSupportValidator(cwd: string) {
  const validator = path.join(cwd, ".ephemeral/support-validator.sh");
  await writeFile(
    validator,
    ["#!/usr/bin/env bash", "set -euo pipefail", "exit 0", ""].join("\n"),
  );
  await chmod(validator, 0o755);
  return validator;
}

async function writeRecordingSupportValidator(cwd: string, stderr = "") {
  const validator = path.join(cwd, ".ephemeral/recording-support-validator.sh");
  await writeFile(
    validator,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'printf "%s\\n" "$@" > ".ephemeral/support-validator-args.txt"',
      stderr ? `printf '%s\\n' ${JSON.stringify(stderr)} >&2` : "",
      stderr ? "exit 1" : "exit 0",
      "",
    ].join("\n"),
  );
  await chmod(validator, 0o755);
  return validator;
}

async function readRecordedSupportArgs(cwd: string): Promise<string[]> {
  const args = await readFile(
    path.join(cwd, ".ephemeral/support-validator-args.txt"),
    "utf8",
  );
  return args.trimEnd().split("\n");
}

function expectArgValue(args: string[], flag: string, value: string) {
  const index = args.indexOf(flag);
  expect(index).toBeGreaterThanOrEqual(0);
  expect(args[index + 1]).toBe(value);
}

describe.skipIf(!jqAvailable)(
  "pr-review approved review artifact helper",
  () => {
    it("derives and prepares the review payload write path from the checked-out git branch", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await expect(
          runHelper(cwd, "prepare-review-payload-write", {
            REVIEW_PAYLOAD_FILE: "",
            BRANCH_NAME: "caller-override-must-not-apply",
          }),
        ).resolves.toMatchObject({
          stdout: `${payloadFile}\n`,
        });

        await execFileAsync("git", ["switch", "-C", "Feature/ABC.1_2"], {
          cwd,
        });
        await expect(
          runHelper(cwd, "prepare-review-payload-write"),
        ).resolves.toMatchObject({
          stdout: `.ephemeral/Feature-ABC.1_2-${headSha}-review-payload.json\n`,
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("freezes an approved-review artifact with schema, paths, digests, and complete payload", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeInputs(cwd);

        const { stdout } = await runHelper(cwd, "freeze-approved-review", {
          FINDINGS_FILE: findingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: payloadFile,
        });
        expect(stdout).toBe(`${approvedReviewFile}\n`);

        const artifact = JSON.parse(
          await readFile(path.join(cwd, approvedReviewFile), "utf-8"),
        ) as {
          schema: string;
          review_head_sha: string;
          findings_file: string;
          review_body_file: string;
          review_payload_file: string;
          scope_decision_file: string;
          findings_sha256: string;
          review_body_sha256: string;
          review_payload_sha256: string;
          scope_decision_sha256: string;
          payload: unknown;
        };
        expect(artifact).toMatchObject({
          schema: "pr-review/approved-review/v1",
          review_head_sha: headSha,
          findings_file: findingsFile,
          review_body_file: reviewBodyFile,
          review_payload_file: payloadFile,
          scope_decision_file: scopeDecisionFile,
          payload: payload(),
        });
        expect(artifact.findings_sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(artifact.review_body_sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(artifact.review_payload_sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(artifact.scope_decision_sha256).toMatch(/^[0-9a-f]{64}$/);
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("delegates approved payload equivalence with explicit scope-policy inputs", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeInputs(cwd);
        const validator = await writeRecordingSupportValidator(cwd);

        await runHelper(cwd, "freeze-approved-review", {
          FINDINGS_FILE: findingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: payloadFile,
          PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: validator,
        });

        const args = await readFile(
          path.join(cwd, ".ephemeral/support-validator-args.txt"),
          "utf8",
        );
        expect(args).toContain("compare-approved-payload");
        expect(args).toContain("--base-ref");
        expect(args).toContain("main");
        expect(args).toContain("--expected-schema");
        expect(args).toContain("pr-review/scope-decision/v1");
        expect(args).toContain("--expected-prior-context-kind");
        expect(args).toContain("--governed-path-pattern");
        expect(args).toContain("--max-narrow-changed-files");
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("uses follow-up prior context from the scope artifact when the sibling prior-thread file is absent", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeInputs(cwd);
        await rm(path.join(cwd, priorThreadsFile), { force: true });
        await writeJson(
          cwd,
          scopeDecisionFile,
          prReviewInitialScope(headSha, headSha, {
            mode: "follow-up",
            is_followup_narrow: true,
            prior_context: {
              kind: "github-prior-threads",
              path: priorThreadsFile,
            },
          }),
        );
        const validator = await writeRecordingSupportValidator(cwd);

        await runHelper(cwd, "freeze-approved-review", {
          FINDINGS_FILE: findingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: payloadFile,
          PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: validator,
        });
        await runHelper(cwd, "validate-approved-review", {
          APPROVED_REVIEW_FILE: approvedReviewFile,
          PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: validator,
        });

        const args = await readRecordedSupportArgs(cwd);
        expectArgValue(
          args,
          "--expected-prior-context-kind",
          "github-prior-threads",
        );
        expectArgValue(args, "--expected-prior-context-path", priorThreadsFile);
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("uses none from an initial scope artifact when a stale sibling prior-thread file exists", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeInputs(cwd);
        await writeJson(cwd, priorThreadsFile, {
          schema: "pr-review/prior-threads/v1",
          stale: true,
        });
        const validator = await writeRecordingSupportValidator(cwd);

        await runHelper(cwd, "freeze-approved-review", {
          FINDINGS_FILE: findingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: payloadFile,
          PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: validator,
        });
        await runHelper(cwd, "validate-approved-review", {
          APPROVED_REVIEW_FILE: approvedReviewFile,
          PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: validator,
        });

        const args = await readRecordedSupportArgs(cwd);
        expectArgValue(args, "--expected-prior-context-kind", "none");
        expectArgValue(args, "--expected-prior-context-path", "null");
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("fails closed when explicit PRIOR_THREADS_FILE conflicts with the scope artifact", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeInputs(cwd);
        await writeJson(
          cwd,
          scopeDecisionFile,
          prReviewInitialScope(headSha, headSha, {
            mode: "follow-up",
            is_followup_narrow: true,
            prior_context: {
              kind: "github-prior-threads",
              path: priorThreadsFile,
            },
          }),
        );
        const validator = await writeRecordingSupportValidator(cwd);

        await expect(
          runHelper(cwd, "freeze-approved-review", {
            FINDINGS_FILE: findingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_PAYLOAD_FILE: payloadFile,
            PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: validator,
            PRIOR_THREADS_FILE: `.ephemeral/topic-${staleHeadSha}-prior-threads.json`,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("prior threads context mismatch"),
        });
        await expect(
          readFile(path.join(cwd, ".ephemeral/support-validator-args.txt")),
        ).rejects.toThrow();
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects freezing when the canonical scope decision artifact is missing", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeInputs(cwd);
        await rm(path.join(cwd, scopeDecisionFile));

        await expect(
          runHelper(cwd, "freeze-approved-review", {
            FINDINGS_FILE: findingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_PAYLOAD_FILE: payloadFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "scope decision file missing or not a regular file",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("requires BASE_REF before invoking the support validator", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeInputs(cwd);
        const validator = await writeRecordingSupportValidator(cwd);

        await expect(
          runHelper(cwd, "freeze-approved-review", {
            BASE_REF: "",
            FINDINGS_FILE: findingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_PAYLOAD_FILE: payloadFile,
            PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: validator,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("BASE_REF is required"),
        });
        await expect(
          readFile(path.join(cwd, ".ephemeral/support-validator-args.txt")),
        ).rejects.toThrow();
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("surfaces missing and failing support-validator delegation", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeInputs(cwd);
        await expect(
          runHelper(cwd, "freeze-approved-review", {
            FINDINGS_FILE: findingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_PAYLOAD_FILE: payloadFile,
            PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT:
              ".ephemeral/missing-validator.sh",
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "play-validate-review-artifacts validator missing",
          ),
        });

        const failingValidator = await writeRecordingSupportValidator(
          cwd,
          "approved review payload does not match generated payload",
        );
        await expect(
          runHelper(cwd, "freeze-approved-review", {
            FINDINGS_FILE: findingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_PAYLOAD_FILE: payloadFile,
            PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: failingValidator,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "approved review payload does not match generated payload",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects wrong-base scope decisions through the real support validator", async () => {
      const cwd = await makeGitWorkspace();
      try {
        const baseSha = (
          await execFileAsync("git", ["rev-parse", "main"], { cwd })
        ).stdout.trim();
        await mkdir(path.join(cwd, "src"));
        await writeFile(
          path.join(cwd, "src/example.ts"),
          "export const x = 1;\n",
        );
        await execFileAsync("git", ["add", "."], { cwd });
        await execFileAsync("git", ["commit", "-m", "feat: add example"], {
          cwd,
        });
        const realHeadSha = (
          await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })
        ).stdout.trim();
        const realFindingsFile = `.ephemeral/topic-${realHeadSha}-findings.json`;
        const realPayloadFile = `.ephemeral/topic-${realHeadSha}-review-payload.json`;
        const realScopeDecisionFile = `.ephemeral/topic-${realHeadSha}-scope-decision.json`;
        const realProviderEvidenceFile = `.ephemeral/topic-${realHeadSha}-provider-scope-evidence.json`;
        const realApprovedReviewFile = `.ephemeral/topic-${realHeadSha}-approved-review.json`;
        const realValidator = path.join(
          process.cwd(),
          "skills/play-validate-review-artifacts/scripts/review-artifacts.sh",
        );
        await writeJson(cwd, realFindingsFile, findingsEnvelope());
        await writeFile(path.join(cwd, reviewBodyFile), "Review body");
        await writeJson(
          cwd,
          realPayloadFile,
          payload({
            body: "Review body",
            commit_id: realHeadSha,
            comments: [],
          }),
        );
        await writeJson(
          cwd,
          realScopeDecisionFile,
          prReviewInitialScope(realHeadSha, realHeadSha, {
            full_range: `${realHeadSha}..${realHeadSha}`,
            selected_range: `${realHeadSha}..${realHeadSha}`,
            candidate_narrow_range: `${realHeadSha}..${realHeadSha}`,
            changed_files: [],
            language_hints: [],
            mechanical_facts: {
              changed_file_count: 0,
              followup_sha_usable: false,
              mechanical_escalate_full: true,
              mechanical_escalation_reason: "not-followup",
            },
            artifacts: {
              provider_scope_evidence_file: realProviderEvidenceFile,
              provider_scope_evidence_sha256: "0".repeat(64),
            },
          }),
        );
        await writeRealProviderEvidence(
          cwd,
          baseSha,
          realHeadSha,
          realProviderEvidenceFile,
        );
        const providerDigest = await sha256File(cwd, realProviderEvidenceFile);
        await writeJson(
          cwd,
          realScopeDecisionFile,
          prReviewInitialScope(baseSha, realHeadSha, {
            full_range: `${realHeadSha}..${realHeadSha}`,
            selected_range: `${realHeadSha}..${realHeadSha}`,
            candidate_narrow_range: `${realHeadSha}..${realHeadSha}`,
            artifacts: {
              provider_scope_evidence_file: realProviderEvidenceFile,
              provider_scope_evidence_sha256: providerDigest,
            },
          }),
        );

        await expect(
          runHelper(cwd, "freeze-approved-review", {
            BASE_REF: baseSha,
            HEAD_SHA: realHeadSha,
            FINDINGS_FILE: realFindingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_PAYLOAD_FILE: realPayloadFile,
            PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: realValidator,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "full range must use provider PR diff base",
          ),
        });

        await writeJson(
          cwd,
          realScopeDecisionFile,
          prReviewInitialScope(baseSha, realHeadSha, {
            artifacts: {
              provider_scope_evidence_file: realProviderEvidenceFile,
              provider_scope_evidence_sha256: providerDigest,
            },
          }),
        );
        await runHelper(cwd, "freeze-approved-review", {
          BASE_REF: baseSha,
          HEAD_SHA: realHeadSha,
          FINDINGS_FILE: realFindingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: realPayloadFile,
          PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: realValidator,
        });
        const nonContractProviderEvidenceFile =
          ".ephemeral/topic-provider-scope-evidence.json";
        await writeRealProviderEvidence(
          cwd,
          baseSha,
          realHeadSha,
          nonContractProviderEvidenceFile,
        );
        const nonContractProviderDigest = await sha256File(
          cwd,
          nonContractProviderEvidenceFile,
        );
        await writeJson(
          cwd,
          realScopeDecisionFile,
          prReviewInitialScope(baseSha, realHeadSha, {
            artifacts: {
              provider_scope_evidence_file: nonContractProviderEvidenceFile,
              provider_scope_evidence_sha256: nonContractProviderDigest,
            },
          }),
        );
        await expect(
          runHelper(cwd, "freeze-approved-review", {
            BASE_REF: baseSha,
            HEAD_SHA: realHeadSha,
            FINDINGS_FILE: realFindingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_PAYLOAD_FILE: realPayloadFile,
            PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: realValidator,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "provider scope evidence path mismatch",
          ),
        });
        await writeJson(
          cwd,
          realScopeDecisionFile,
          prReviewInitialScope(realHeadSha, realHeadSha, {
            full_range: `${realHeadSha}..${realHeadSha}`,
            selected_range: `${realHeadSha}..${realHeadSha}`,
            candidate_narrow_range: `${realHeadSha}..${realHeadSha}`,
            changed_files: [],
            language_hints: [],
            mechanical_facts: {
              changed_file_count: 0,
              followup_sha_usable: false,
              mechanical_escalate_full: true,
              mechanical_escalation_reason: "not-followup",
            },
            artifacts: {
              provider_scope_evidence_file: realProviderEvidenceFile,
              provider_scope_evidence_sha256: providerDigest,
            },
          }),
        );
        const approvedArtifact = JSON.parse(
          await readFile(path.join(cwd, realApprovedReviewFile), "utf-8"),
        );
        approvedArtifact.scope_decision_sha256 = await sha256File(
          cwd,
          realScopeDecisionFile,
        );
        await writeJson(cwd, realApprovedReviewFile, approvedArtifact);

        await expect(
          runHelper(cwd, "validate-approved-review", {
            BASE_REF: baseSha,
            HEAD_SHA: realHeadSha,
            APPROVED_REVIEW_FILE: realApprovedReviewFile,
            PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: realValidator,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "full range must use provider PR diff base",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects approved-review freezing when provider diff-base is not derived from baseRefOid", async () => {
      const cwd = await makeGitWorkspace();
      try {
        const baseSha = (
          await execFileAsync("git", ["rev-parse", "main"], { cwd })
        ).stdout.trim();
        await mkdir(path.join(cwd, "src"));
        await writeFile(
          path.join(cwd, "src/example.ts"),
          "export const x = 1;\n",
        );
        await execFileAsync("git", ["add", "."], { cwd });
        await execFileAsync("git", ["commit", "-m", "feat: add example"], {
          cwd,
        });
        const realHeadSha = (
          await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })
        ).stdout.trim();
        const realFindingsFile = `.ephemeral/topic-${realHeadSha}-findings.json`;
        const realPayloadFile = `.ephemeral/topic-${realHeadSha}-review-payload.json`;
        const realScopeDecisionFile = `.ephemeral/topic-${realHeadSha}-scope-decision.json`;
        const realProviderEvidenceFile = `.ephemeral/topic-${realHeadSha}-provider-scope-evidence.json`;
        const realValidator = path.join(
          process.cwd(),
          "skills/play-validate-review-artifacts/scripts/review-artifacts.sh",
        );
        await writeJson(cwd, realFindingsFile, findingsEnvelope());
        await writeFile(path.join(cwd, reviewBodyFile), "Review body");
        await writeJson(
          cwd,
          realPayloadFile,
          payload({
            body: "Review body",
            commit_id: realHeadSha,
            comments: [],
          }),
        );
        await writeRealProviderEvidence(
          cwd,
          baseSha,
          realHeadSha,
          realProviderEvidenceFile,
        );
        const evidence = JSON.parse(
          await readFile(path.join(cwd, realProviderEvidenceFile), "utf-8"),
        ) as Record<string, unknown>;
        await writeJson(cwd, realProviderEvidenceFile, {
          ...evidence,
          baseRefOid: realHeadSha,
        });
        await writeJson(
          cwd,
          realScopeDecisionFile,
          prReviewInitialScope(baseSha, realHeadSha, {
            artifacts: {
              provider_scope_evidence_file: realProviderEvidenceFile,
              provider_scope_evidence_sha256: await sha256File(
                cwd,
                realProviderEvidenceFile,
              ),
            },
          }),
        );

        await expect(
          runHelper(cwd, "freeze-approved-review", {
            BASE_REF: baseSha,
            HEAD_SHA: realHeadSha,
            FINDINGS_FILE: realFindingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_PAYLOAD_FILE: realPayloadFile,
            PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: realValidator,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "provider PR diff base must equal single merge base",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("validates the approved review and prints the exact frozen payload", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeInputs(cwd);
        await runHelper(cwd, "freeze-approved-review", {
          FINDINGS_FILE: findingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: payloadFile,
        });

        const { stdout } = await runHelper(cwd, "validate-approved-review", {
          APPROVED_REVIEW_FILE: approvedReviewFile,
        });

        expect(JSON.parse(stdout)).toEqual(payload());
        expect(stdout).toContain('"body": "Review body\\n"');
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("allows start_side only on ranged inline comments", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeInputs(cwd);
        await writeJson(cwd, payloadFile, payloadWithRange());

        await runHelper(cwd, "freeze-approved-review", {
          FINDINGS_FILE: findingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: payloadFile,
        });

        const { stdout } = await runHelper(cwd, "validate-approved-review", {
          APPROVED_REVIEW_FILE: approvedReviewFile,
        });

        const validatedPayload = JSON.parse(stdout) as {
          comments: Array<Record<string, unknown>>;
        };
        expect(validatedPayload.comments[0]).toMatchObject({
          start_line: 10,
          start_side: "RIGHT",
        });
        expect(validatedPayload.comments[1]).not.toHaveProperty("start_line");
        expect(validatedPayload.comments[1]).not.toHaveProperty("start_side");
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects malformed start_side relationships in frozen payload validation", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeInputs(cwd);
        await runHelper(cwd, "freeze-approved-review", {
          FINDINGS_FILE: findingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: payloadFile,
        });

        const malformedPayloads = [
          payloadWithRange({
            comments: [
              {
                path: "src/example.ts",
                line: 12,
                start_line: 10,
                side: "RIGHT",
                body: "Missing start_side\n",
              },
            ],
          }),
          payloadWithRange({
            comments: [
              {
                path: "src/example.ts",
                line: 12,
                start_line: 10,
                start_side: "LEFT",
                side: "RIGHT",
                body: "Invalid start_side\n",
              },
            ],
          }),
          payloadWithRange({
            comments: [
              {
                path: "src/example.ts",
                line: 12,
                start_side: "RIGHT",
                side: "RIGHT",
                body: "start_side without start_line\n",
              },
            ],
          }),
        ];

        for (const malformedPayload of malformedPayloads) {
          await writeJson(cwd, payloadFile, malformedPayload);
          await expect(
            runHelper(cwd, "validate-approved-review", {
              APPROVED_REVIEW_FILE: approvedReviewFile,
            }),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining("payload shape mismatch"),
          });
        }
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects findings, review body, payload, and approved artifact paths that are unsafe or non-canonical", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeInputs(cwd);

        await expect(
          runHelper(cwd, "prepare-review-payload-write", {
            REVIEW_PAYLOAD_FILE: "payload.json",
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "review payload path validation failed",
          ),
        });
        await expect(
          runHelper(cwd, "prepare-review-payload-write", {
            REVIEW_PAYLOAD_FILE: ".ephemeral/nested/review-payload.json",
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "nested review payload path rejected",
          ),
        });
        await expect(
          runHelper(cwd, "freeze-approved-review", {
            FINDINGS_FILE: ".ephemeral/wrong-findings.json",
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_PAYLOAD_FILE: payloadFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("findings path mismatch"),
        });
        await expect(
          runHelper(cwd, "freeze-approved-review", {
            FINDINGS_FILE: findingsFile,
            REVIEW_BODY_FILE: "review-body.md",
            REVIEW_PAYLOAD_FILE: payloadFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("review body path validation failed"),
        });
        await runHelper(cwd, "freeze-approved-review", {
          FINDINGS_FILE: findingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: payloadFile,
        });
        await writeFile(
          path.join(cwd, ".ephemeral/wrong-approved-review.json"),
          await readFile(path.join(cwd, approvedReviewFile)),
        );
        await expect(
          runHelper(cwd, "validate-approved-review", {
            APPROVED_REVIEW_FILE: ".ephemeral/wrong-approved-review.json",
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("approved review path mismatch"),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects schema mismatch, malformed payload JSON, and malformed approved-review schema", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeInputs(cwd);
        await writeJson(cwd, payloadFile, payload({ event: "DISMISS" }));
        await expect(
          runHelper(cwd, "freeze-approved-review", {
            FINDINGS_FILE: findingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_PAYLOAD_FILE: payloadFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("payload shape mismatch"),
        });

        await writeJson(cwd, payloadFile, payload());
        await runHelper(cwd, "freeze-approved-review", {
          FINDINGS_FILE: findingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: payloadFile,
        });
        await writeJson(cwd, approvedReviewFile, {
          schema: "wrong/v1",
          review_head_sha: headSha,
          findings_file: findingsFile,
          review_body_file: reviewBodyFile,
          review_payload_file: payloadFile,
          findings_sha256: "0".repeat(64),
          review_body_sha256: "0".repeat(64),
          review_payload_sha256: "0".repeat(64),
          payload: payload(),
        });

        await expect(
          runHelper(cwd, "validate-approved-review", {
            APPROVED_REVIEW_FILE: approvedReviewFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("approved review schema mismatch"),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects digest drift for findings, review body, payload files, and recorded digests", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeInputs(cwd);
        await runHelper(cwd, "freeze-approved-review", {
          FINDINGS_FILE: findingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: payloadFile,
        });

        await writeJson(cwd, findingsFile, {
          ...findingsEnvelope(),
          extra: "drift",
        });
        await expect(
          runHelper(cwd, "validate-approved-review", {
            APPROVED_REVIEW_FILE: approvedReviewFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("findings digest mismatch"),
        });

        await writeJson(cwd, findingsFile, findingsEnvelope());
        await writeFile(path.join(cwd, reviewBodyFile), "Changed body\n");
        await expect(
          runHelper(cwd, "validate-approved-review", {
            APPROVED_REVIEW_FILE: approvedReviewFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("review body digest mismatch"),
        });

        await writeFile(path.join(cwd, reviewBodyFile), "Review body\n");
        await writeJson(cwd, payloadFile, payload({ body: "Changed payload" }));
        await expect(
          runHelper(cwd, "validate-approved-review", {
            APPROVED_REVIEW_FILE: approvedReviewFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("payload digest mismatch"),
        });

        await writeJson(cwd, payloadFile, payload());
        await writeJson(cwd, scopeDecisionFile, { drift: true });
        await expect(
          runHelper(cwd, "validate-approved-review", {
            APPROVED_REVIEW_FILE: approvedReviewFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("scope decision digest mismatch"),
        });

        await writeJson(cwd, scopeDecisionFile, {});
        const artifact = JSON.parse(
          await readFile(path.join(cwd, approvedReviewFile), "utf-8"),
        );
        artifact.review_payload_sha256 = "0".repeat(64);
        await writeJson(cwd, approvedReviewFile, artifact);
        await expect(
          runHelper(cwd, "validate-approved-review", {
            APPROVED_REVIEW_FILE: approvedReviewFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("payload digest mismatch"),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects invalid findings entries before freezing or validating approved reviews", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeInputs(cwd);
        const invalidFreezeEntries = [
          {
            line: 12,
            start_line: null,
            severity: "Blocking",
            category: "Safety",
            critic: "VALID",
            anchor: "natural",
            why: "Missing path should be rejected.",
            recommendation: "Reject malformed entries.",
            body: "body",
          },
          {
            path: "src/example.ts",
            line: 12,
            start_line: null,
            severity: "Blocking",
            category: "Safety",
            anchor: "natural",
            why: "Missing critic should be rejected.",
            recommendation: "Reject malformed entries.",
            body: "body",
          },
        ];

        for (const invalidEntry of invalidFreezeEntries) {
          await writeJson(cwd, findingsFile, {
            schema: "play-review/findings/v1",
            findings: [invalidEntry],
            carry_forward: [],
          });

          await expect(
            runHelper(cwd, "freeze-approved-review", {
              FINDINGS_FILE: findingsFile,
              REVIEW_BODY_FILE: reviewBodyFile,
              REVIEW_PAYLOAD_FILE: payloadFile,
            }),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining("findings schema mismatch"),
          });
        }

        await writeInputs(cwd);
        await runHelper(cwd, "freeze-approved-review", {
          FINDINGS_FILE: findingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: payloadFile,
        });
        const artifact = JSON.parse(
          await readFile(path.join(cwd, approvedReviewFile), "utf-8"),
        );
        artifact.findings_sha256 = "0".repeat(64);
        await writeJson(cwd, approvedReviewFile, artifact);
        await writeJson(cwd, findingsFile, {
          schema: "play-review/findings/v1",
          findings: [
            {
              path: "src/example.ts",
              line: 12,
              start_line: null,
              severity: "Nit",
              category: "Safety",
              critic: "VALID",
              anchor: "natural",
              why: "Nit with critic verdict should be rejected.",
              recommendation: "Mirror play-review semantics.",
              body: "body",
            },
          ],
          carry_forward: [],
        });

        await expect(
          runHelper(cwd, "validate-approved-review", {
            APPROVED_REVIEW_FILE: approvedReviewFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("findings schema mismatch"),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects multi-document review payload JSON streams", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeJson(cwd, findingsFile, findingsEnvelope());
        await writeFile(path.join(cwd, reviewBodyFile), "Review body\n");
        await writeJson(cwd, scopeDecisionFile, {});
        await writeFile(
          path.join(cwd, payloadFile),
          `${JSON.stringify(payload())}\n${JSON.stringify(payload({ event: "APPROVE" }))}\n`,
        );

        await expect(
          runHelper(cwd, "freeze-approved-review", {
            FINDINGS_FILE: findingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_PAYLOAD_FILE: payloadFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "payload must contain exactly one JSON object",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects stale PR heads before printing a frozen payload", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeInputs(cwd);
        await runHelper(cwd, "freeze-approved-review", {
          FINDINGS_FILE: findingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: payloadFile,
        });

        await expect(
          runHelper(cwd, "validate-approved-review", {
            HEAD_SHA: staleHeadSha,
            APPROVED_REVIEW_FILE: approvedReviewFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("review head mismatch"),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it.skipIf(!symlinkAvailable)(
      "rejects symlinked approved-review read targets and symlinked .ephemeral",
      async () => {
        const cwd = await makeGitWorkspace();
        const outside = path.join(cwd, "outside-approved-review.json");
        try {
          await writeInputs(cwd);
          await runHelper(cwd, "freeze-approved-review", {
            FINDINGS_FILE: findingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_PAYLOAD_FILE: payloadFile,
          });
          await writeFile(
            outside,
            await readFile(path.join(cwd, approvedReviewFile)),
          );
          await rm(path.join(cwd, approvedReviewFile));
          await symlink(outside, path.join(cwd, approvedReviewFile));

          await expect(
            runHelper(cwd, "validate-approved-review", {
              APPROVED_REVIEW_FILE: approvedReviewFile,
            }),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining(
              "approved review file must not be a symlink",
            ),
          });

          await rm(path.join(cwd, ".ephemeral"), {
            recursive: true,
            force: true,
          });
          await mkdir(path.join(cwd, "outside-ephemeral"));
          await symlink(
            path.join(cwd, "outside-ephemeral"),
            path.join(cwd, ".ephemeral"),
          );
          await expect(
            runHelper(cwd, "prepare-review-payload-write"),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining(
              ".ephemeral must be a directory, not a symlink",
            ),
          });
        } finally {
          await cleanupTempDir(cwd);
        }
      },
    );

    it.skipIf(!symlinkAvailable)(
      "rejects symlinked write targets without removing them",
      async () => {
        const cwd = await makeGitWorkspace();
        const outsidePayload = path.join(cwd, "outside-payload.json");
        const outsideApproved = path.join(cwd, "outside-approved-review.json");
        try {
          await writeInputs(cwd);
          await rm(path.join(cwd, payloadFile));
          await writeFile(outsidePayload, "do not remove\n");
          await symlink(outsidePayload, path.join(cwd, payloadFile));

          await expect(
            runHelper(cwd, "prepare-review-payload-write", {
              REVIEW_PAYLOAD_FILE: payloadFile,
            }),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining(
              "review payload path must not be a symlink",
            ),
          });
          expect(await readFile(outsidePayload, "utf-8")).toBe(
            "do not remove\n",
          );
          expect(
            (await lstat(path.join(cwd, payloadFile))).isSymbolicLink(),
          ).toBe(true);

          await rm(path.join(cwd, payloadFile));
          await writeJson(cwd, payloadFile, payload());
          await writeFile(outsideApproved, "do not remove\n");
          await symlink(outsideApproved, path.join(cwd, approvedReviewFile));

          await expect(
            runHelper(cwd, "freeze-approved-review", {
              FINDINGS_FILE: findingsFile,
              REVIEW_BODY_FILE: reviewBodyFile,
              REVIEW_PAYLOAD_FILE: payloadFile,
            }),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining(
              "approved review path must not be a symlink",
            ),
          });
          expect(await readFile(outsideApproved, "utf-8")).toBe(
            "do not remove\n",
          );
          expect(
            (await lstat(path.join(cwd, approvedReviewFile))).isSymbolicLink(),
          ).toBe(true);
        } finally {
          await cleanupTempDir(cwd);
        }
      },
    );

    it.skipIf(!mkfifoAvailable)(
      "rejects non-regular review payload write targets when mkfifo is available",
      async () => {
        const cwd = await makeGitWorkspace();
        try {
          await execFileAsync("mkfifo", [path.join(cwd, payloadFile)]);

          await expect(
            runHelper(cwd, "prepare-review-payload-write", {
              REVIEW_PAYLOAD_FILE: payloadFile,
            }),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining(
              "review payload path exists but is not a regular file",
            ),
          });
        } finally {
          await cleanupTempDir(cwd);
        }
      },
    );

    it("rejects unreadable approved-review files where the platform enforces chmod permissions", async () => {
      const cwd = await makeGitWorkspace();
      const absoluteApprovedReviewFile = path.join(cwd, approvedReviewFile);
      try {
        await writeInputs(cwd);
        await runHelper(cwd, "freeze-approved-review", {
          FINDINGS_FILE: findingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: payloadFile,
        });
        await chmod(absoluteApprovedReviewFile, 0o000);
        try {
          await readFile(absoluteApprovedReviewFile);
          return;
        } catch {
          await expect(
            runHelper(cwd, "validate-approved-review", {
              APPROVED_REVIEW_FILE: approvedReviewFile,
            }),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining(
              "approved review file missing or unreadable",
            ),
          });
        }
      } finally {
        await chmod(absoluteApprovedReviewFile, 0o600).catch(() => undefined);
        await cleanupTempDir(cwd);
      }
    });
  },
);
