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
const playReviewDir = path.join(process.cwd(), "skills/play-review");
const headSha = "0123456789abcdef0123456789abcdef01234567";
const staleHeadSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const findingsFile = `.ephemeral/topic-${headSha}-findings.json`;
const reviewBodyFile = ".ephemeral/topic-review-body.md";
const payloadFile = `.ephemeral/topic-${headSha}-review-payload.json`;
const approvedReviewFile = `.ephemeral/topic-${headSha}-approved-review.json`;
const missingFilePrefix =
  "Missing-file finding (no natural anchor — see body):";

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

async function makeReviewSourceWorkspace(): Promise<{
  cwd: string;
  reviewHeadSha: string;
  reviewFindingsFile: string;
  reviewPayloadFile: string;
  reviewScopeDecisionFile: string;
}> {
  const cwd = await makeGitWorkspace();
  await mkdir(path.join(cwd, "src"));
  await writeFile(
    path.join(cwd, "src/review-target.ts"),
    [
      "export function alpha() {",
      "  const first = 1;",
      "  const second = 2;",
      "  return first + second;",
      "}",
      "",
      "export function beta() {",
      "  return alpha();",
      "}",
      "",
    ].join("\n"),
  );
  await execFileAsync("git", ["add", "src/review-target.ts"], { cwd });
  await execFileAsync("git", ["commit", "-m", "feat: add review target"], {
    cwd,
  });
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd,
  });
  const reviewHeadSha = stdout.trim();
  const reviewScopeDecisionFile = `.ephemeral/topic-${reviewHeadSha}-scope-decision.json`;
  await writeJson(cwd, reviewScopeDecisionFile, {
    schema: "pr-review/scope-decision/v1",
    surface: "pr-review",
    mode: "initial",
    selected_range: "main...HEAD",
    full_range: "main...HEAD",
    candidate_narrow_range: "main...HEAD",
    is_followup_narrow: false,
    selection_reason: "initial review",
    escalation_reasons: ["not-followup"],
    last_reviewed_sha: null,
    head_sha: reviewHeadSha,
    changed_files: ["src/review-target.ts"],
    language_hints: ["ts"],
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
      notes: "Initial review.",
    },
  });
  return {
    cwd,
    reviewHeadSha,
    reviewFindingsFile: `.ephemeral/topic-${reviewHeadSha}-findings.json`,
    reviewPayloadFile: `.ephemeral/topic-${reviewHeadSha}-review-payload.json`,
    reviewScopeDecisionFile,
  };
}

function findingsEnvelope() {
  return {
    schema: "play-review/findings/v1",
    findings: [],
    carry_forward: [],
  };
}

function sourceFinding(overrides: Record<string, unknown> = {}) {
  return {
    path: "src/review-target.ts",
    line: 4,
    start_line: null,
    severity: "Blocking",
    category: "Contracts",
    critic: "VALID",
    anchor: "natural",
    why: "The reviewed source has a problem.",
    recommendation: "Adjust the reviewed source.",
    body: "**Blocking | Contracts** - The reviewed source has a problem.\n\n**Recommendation:** Adjust the reviewed source.",
    ...overrides,
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    commit_id: headSha,
    event: "COMMENT",
    body: "Review body",
    comments: [],
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

async function writeJson(cwd: string, relPath: string, value: unknown) {
  await writeFile(path.join(cwd, relPath), JSON.stringify(value, null, 2));
}

async function sha256File(cwd: string, relPath: string) {
  return createHash("sha256")
    .update(await readFile(path.join(cwd, relPath)))
    .digest("hex");
}

async function currentHead(cwd: string) {
  return (
    await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })
  ).stdout.trim();
}

async function writeScopeDecision(
  cwd: string,
  reviewHeadSha: string,
  scopeDecisionFile: string,
  overrides: Record<string, unknown> = {},
) {
  await writeJson(cwd, scopeDecisionFile, {
    schema: "pr-review/scope-decision/v1",
    surface: "pr-review",
    mode: "initial",
    selected_range: "main...HEAD",
    full_range: "main...HEAD",
    candidate_narrow_range: "main...HEAD",
    is_followup_narrow: false,
    selection_reason: "initial review",
    escalation_reasons: ["not-followup"],
    last_reviewed_sha: null,
    head_sha: reviewHeadSha,
    changed_files: [],
    language_hints: [],
    prior_context: {
      kind: "none",
      path: null,
    },
    mechanical_facts: {
      changed_file_count: 0,
      followup_sha_usable: false,
      mechanical_escalate_full: true,
      mechanical_escalation_reason: "not-followup",
    },
    semantic_decision: {
      checked: true,
      ambiguous: false,
      notes: "Initial review.",
    },
    ...overrides,
  });
}

async function writeInputs(cwd: string) {
  const reviewHeadSha = await currentHead(cwd);
  const reviewFindingsFile = `.ephemeral/topic-${reviewHeadSha}-findings.json`;
  const reviewPayloadFile = `.ephemeral/topic-${reviewHeadSha}-review-payload.json`;
  const reviewApprovedFile = `.ephemeral/topic-${reviewHeadSha}-approved-review.json`;
  const reviewScopeDecisionFile = `.ephemeral/topic-${reviewHeadSha}-scope-decision.json`;
  const reviewPayload = payload({ commit_id: reviewHeadSha });
  await writeJson(cwd, reviewFindingsFile, findingsEnvelope());
  await writeFile(path.join(cwd, reviewBodyFile), "Review body\n");
  await writeJson(cwd, reviewPayloadFile, reviewPayload);
  await writeScopeDecision(cwd, reviewHeadSha, reviewScopeDecisionFile);
  return {
    reviewHeadSha,
    reviewFindingsFile,
    reviewBodyFile,
    reviewPayloadFile,
    reviewApprovedFile,
    reviewScopeDecisionFile,
    reviewPayload,
  };
}

async function runHelper(
  cwd: string,
  command: string,
  env: NodeJS.ProcessEnv = {},
) {
  return execFileAsync("bash", [helperScript, command], {
    cwd,
    env: {
      ...process.env,
      HEAD_SHA: headSha,
      PLAY_REVIEW_DIR: playReviewDir,
      REVIEW_EVENT: "COMMENT",
      ...env,
    },
  });
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

    it("builds a GitHub review payload with anchor partitioning and allowlisted comments", async () => {
      const { cwd, reviewHeadSha, reviewFindingsFile } =
        await makeReviewSourceWorkspace();
      try {
        await writeFile(path.join(cwd, reviewBodyFile), "Top-level summary\n");
        await writeJson(cwd, reviewFindingsFile, {
          schema: "play-review/findings/v1",
          findings: [
            sourceFinding({
              anchor: "natural",
              body: "**Blocking | Contracts** - Natural body.\n\n**Recommendation:** Fix it.",
            }),
            sourceFinding({
              line: 8,
              anchor: "missing-file",
              body: `${missingFilePrefix}\n\n**Blocking | Contracts** - Missing-file body.\n\n**Recommendation:** Anchor to fallback.`,
            }),
            sourceFinding({
              line: 9,
              anchor: "out-of-diff",
              body: "**Blocking | Contracts** - Out-of-diff body.\n\n**Recommendation:** Put in body.",
            }),
          ],
          carry_forward: [
            sourceFinding({
              line: 3,
              start_line: 2,
              severity: "Nit",
              category: "Tests",
              critic: null,
              anchor: "natural",
              body: "**Nit | Tests** - Range body.\n\n**Recommendation:** Keep range.",
            }),
            sourceFinding({
              line: 7,
              anchor: "out-of-diff",
              body: "**Blocking | Contracts** - Carry-forward out-of-diff.\n\n**Recommendation:** Put in body too.",
            }),
          ],
        });

        const { stdout } = await runHelper(cwd, "build-github-review-payload", {
          HEAD_SHA: reviewHeadSha,
          FINDINGS_FILE: reviewFindingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_EVENT: "COMMENT",
        });
        const reviewPayload = JSON.parse(stdout) as {
          commit_id: string;
          event: string;
          body: string;
          comments: Array<Record<string, unknown>>;
        };

        expect(reviewPayload.commit_id).toBe(reviewHeadSha);
        expect(reviewPayload.event).toBe("COMMENT");
        expect(reviewPayload.body).toContain("Top-level summary");
        expect(reviewPayload.body).toContain("Out-of-diff body");
        expect(reviewPayload.body).toContain("Carry-forward out-of-diff");
        expect(reviewPayload.comments).toHaveLength(3);
        expect(reviewPayload.comments[0]).toEqual({
          path: "src/review-target.ts",
          line: 4,
          side: "RIGHT",
          body: "**Blocking | Contracts** - Natural body.\n\n**Recommendation:** Fix it.",
        });
        expect(reviewPayload.comments[1]).toEqual({
          path: "src/review-target.ts",
          line: 8,
          side: "RIGHT",
          body: `${missingFilePrefix}\n\n**Blocking | Contracts** - Missing-file body.\n\n**Recommendation:** Anchor to fallback.`,
        });
        expect(reviewPayload.comments[2]).toMatchObject({
          path: "src/review-target.ts",
          start_line: 2,
          start_side: "RIGHT",
          line: 3,
          side: "RIGHT",
        });
        expect(Object.keys(reviewPayload.comments[2]).sort()).toEqual([
          "body",
          "line",
          "path",
          "side",
          "start_line",
          "start_side",
        ]);
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects missing-file inline bodies without the required explanatory prefix", async () => {
      const { cwd, reviewHeadSha, reviewFindingsFile, reviewPayloadFile } =
        await makeReviewSourceWorkspace();
      const approvedFile = `.ephemeral/topic-${reviewHeadSha}-approved-review.json`;
      try {
        const validMissingFileFinding = sourceFinding({
          line: 8,
          anchor: "missing-file",
          body: `${missingFilePrefix}\n\n**Blocking | Contracts** - Missing-file body.\n\n**Recommendation:** Anchor to fallback.`,
        });
        const malformedMissingFileFinding = sourceFinding({
          line: 8,
          anchor: "missing-file",
          body: "**Blocking | Contracts** - Missing-file body.\n\n**Recommendation:** Anchor to fallback.",
        });

        await writeFile(path.join(cwd, reviewBodyFile), "Top-level summary\n");
        await writeJson(cwd, reviewFindingsFile, {
          schema: "play-review/findings/v1",
          findings: [malformedMissingFileFinding],
          carry_forward: [],
        });
        await expect(
          runHelper(cwd, "build-github-review-payload", {
            HEAD_SHA: reviewHeadSha,
            FINDINGS_FILE: reviewFindingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_EVENT: "COMMENT",
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "missing-file finding body prefix mismatch",
          ),
        });

        await writeJson(cwd, reviewFindingsFile, {
          schema: "play-review/findings/v1",
          findings: [validMissingFileFinding],
          carry_forward: [],
        });
        const { stdout } = await runHelper(cwd, "build-github-review-payload", {
          HEAD_SHA: reviewHeadSha,
          FINDINGS_FILE: reviewFindingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_EVENT: "COMMENT",
        });
        await writeFile(path.join(cwd, reviewPayloadFile), stdout);

        await writeJson(cwd, reviewFindingsFile, {
          schema: "play-review/findings/v1",
          findings: [malformedMissingFileFinding],
          carry_forward: [],
        });
        await expect(
          runHelper(cwd, "freeze-approved-review", {
            HEAD_SHA: reviewHeadSha,
            FINDINGS_FILE: reviewFindingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_PAYLOAD_FILE: reviewPayloadFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "missing-file finding body prefix mismatch",
          ),
        });

        await writeJson(cwd, reviewFindingsFile, {
          schema: "play-review/findings/v1",
          findings: [validMissingFileFinding],
          carry_forward: [],
        });
        await runHelper(cwd, "freeze-approved-review", {
          HEAD_SHA: reviewHeadSha,
          FINDINGS_FILE: reviewFindingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: reviewPayloadFile,
        });

        await writeJson(cwd, reviewFindingsFile, {
          schema: "play-review/findings/v1",
          findings: [malformedMissingFileFinding],
          carry_forward: [],
        });
        const approved = JSON.parse(
          await readFile(path.join(cwd, approvedFile), "utf-8"),
        );
        approved.findings_sha256 = await sha256File(cwd, reviewFindingsFile);
        await writeJson(cwd, approvedFile, approved);

        await expect(
          runHelper(cwd, "validate-approved-review", {
            HEAD_SHA: reviewHeadSha,
            APPROVED_REVIEW_FILE: approvedFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "missing-file finding body prefix mismatch",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects inline comments on HEAD lines outside the selected review diff", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await mkdir(path.join(cwd, "src"));
        await writeFile(
          path.join(cwd, "src/review-target.ts"),
          "export const unchanged = 1;\n",
        );
        await execFileAsync("git", ["add", "src/review-target.ts"], { cwd });
        await execFileAsync("git", ["commit", "-m", "feat: add target"], {
          cwd,
        });
        const baseSha = (
          await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })
        ).stdout.trim();
        await writeFile(
          path.join(cwd, "src/changed.ts"),
          "export const changed = 1;\n",
        );
        await execFileAsync("git", ["add", "src/changed.ts"], { cwd });
        await execFileAsync("git", ["commit", "-m", "feat: add changed"], {
          cwd,
        });
        const reviewHeadSha = (
          await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })
        ).stdout.trim();
        const reviewFindingsFile = `.ephemeral/topic-${reviewHeadSha}-findings.json`;
        const reviewScopeDecisionFile = `.ephemeral/topic-${reviewHeadSha}-scope-decision.json`;

        await writeFile(path.join(cwd, reviewBodyFile), "Top-level summary\n");
        await writeJson(cwd, reviewFindingsFile, {
          schema: "play-review/findings/v1",
          findings: [sourceFinding({ line: 1 })],
          carry_forward: [],
        });
        await writeJson(cwd, reviewScopeDecisionFile, {
          schema: "pr-review/scope-decision/v1",
          surface: "pr-review",
          mode: "follow-up",
          selected_range: `${baseSha}..HEAD`,
          full_range: "main...HEAD",
          candidate_narrow_range: `${baseSha}..HEAD`,
          is_followup_narrow: true,
          selection_reason: "mechanical and semantic checks passed",
          escalation_reasons: [],
          last_reviewed_sha: baseSha,
          head_sha: reviewHeadSha,
          changed_files: ["src/changed.ts"],
          language_hints: ["ts"],
          prior_context: {
            kind: "github-prior-threads",
            path: `.ephemeral/topic-${reviewHeadSha}-prior-threads.json`,
          },
          mechanical_facts: {
            changed_file_count: 1,
            followup_sha_usable: true,
            mechanical_escalate_full: false,
            mechanical_escalation_reason: "",
          },
          semantic_decision: {
            checked: true,
            ambiguous: false,
            notes: "No escalation.",
          },
        });

        await expect(
          runHelper(cwd, "build-github-review-payload", {
            HEAD_SHA: reviewHeadSha,
            FINDINGS_FILE: reviewFindingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_EVENT: "COMMENT",
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "inline anchor is outside selected review diff",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("allows empty comments when every finding is out-of-diff or the envelope is empty", async () => {
      const { cwd, reviewHeadSha, reviewFindingsFile } =
        await makeReviewSourceWorkspace();
      try {
        await writeFile(path.join(cwd, reviewBodyFile), "Summary\n");
        await writeJson(cwd, reviewFindingsFile, {
          schema: "play-review/findings/v1",
          findings: [sourceFinding({ anchor: "out-of-diff" })],
          carry_forward: [],
        });
        const outOfDiffOnly = await runHelper(
          cwd,
          "build-github-review-payload",
          {
            HEAD_SHA: reviewHeadSha,
            FINDINGS_FILE: reviewFindingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_EVENT: "APPROVE",
          },
        );
        expect(JSON.parse(outOfDiffOnly.stdout).comments).toEqual([]);

        await writeJson(cwd, reviewFindingsFile, {
          schema: "play-review/findings/v1",
          findings: [],
          carry_forward: [],
        });
        const empty = await runHelper(cwd, "build-github-review-payload", {
          HEAD_SHA: reviewHeadSha,
          FINDINGS_FILE: reviewFindingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_EVENT: "APPROVE",
        });
        expect(JSON.parse(empty.stdout).comments).toEqual([]);
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects invalid payload-builder events, malformed findings streams, and invalid review-head anchors", async () => {
      const { cwd, reviewHeadSha, reviewFindingsFile } =
        await makeReviewSourceWorkspace();
      try {
        await writeFile(path.join(cwd, reviewBodyFile), "Summary\n");
        await writeJson(cwd, reviewFindingsFile, {
          schema: "play-review/findings/v1",
          findings: [sourceFinding()],
          carry_forward: [],
        });

        await expect(
          runHelper(cwd, "build-github-review-payload", {
            HEAD_SHA: reviewHeadSha,
            FINDINGS_FILE: reviewFindingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_EVENT: "DISMISS",
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "REVIEW_EVENT must be APPROVE, REQUEST_CHANGES, or COMMENT",
          ),
        });

        await writeFile(
          path.join(cwd, reviewFindingsFile),
          `${JSON.stringify(findingsEnvelope())}\n${JSON.stringify({
            schema: "play-review/findings/v1",
            findings: [sourceFinding()],
            carry_forward: [],
          })}\n`,
        );
        await expect(
          runHelper(cwd, "build-github-review-payload", {
            HEAD_SHA: reviewHeadSha,
            FINDINGS_FILE: reviewFindingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_EVENT: "COMMENT",
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("envelope schema mismatch"),
        });

        await writeFile(path.join(cwd, "src/empty.ts"), "");
        await execFileAsync("git", ["add", "src/empty.ts"], { cwd });
        await execFileAsync("git", ["commit", "-m", "feat: add empty source"], {
          cwd,
        });
        const { stdout: emptyHeadStdout } = await execFileAsync(
          "git",
          ["rev-parse", "HEAD"],
          { cwd },
        );
        const emptyHeadSha = emptyHeadStdout.trim();
        const emptyFindingsFile = `.ephemeral/topic-${emptyHeadSha}-findings.json`;
        await writeJson(cwd, emptyFindingsFile, {
          schema: "play-review/findings/v1",
          findings: [sourceFinding({ path: "src/empty.ts", line: 1 })],
          carry_forward: [],
        });
        await expect(
          runHelper(cwd, "build-github-review-payload", {
            HEAD_SHA: emptyHeadSha,
            FINDINGS_FILE: emptyFindingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_EVENT: "COMMENT",
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "review-head source line out of range: src/empty.ts:1",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("freezes an approved-review artifact with schema, paths, digests, and complete payload", async () => {
      const cwd = await makeGitWorkspace();
      try {
        const inputs = await writeInputs(cwd);

        const { stdout } = await runHelper(cwd, "freeze-approved-review", {
          HEAD_SHA: inputs.reviewHeadSha,
          FINDINGS_FILE: inputs.reviewFindingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: inputs.reviewPayloadFile,
        });
        expect(stdout).toBe(`${inputs.reviewApprovedFile}\n`);

        const artifact = JSON.parse(
          await readFile(path.join(cwd, inputs.reviewApprovedFile), "utf-8"),
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
          review_head_sha: inputs.reviewHeadSha,
          findings_file: inputs.reviewFindingsFile,
          review_body_file: reviewBodyFile,
          review_payload_file: inputs.reviewPayloadFile,
          scope_decision_file: inputs.reviewScopeDecisionFile,
          payload: inputs.reviewPayload,
        });
        expect(artifact.findings_sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(artifact.review_body_sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(artifact.review_payload_sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(artifact.scope_decision_sha256).toMatch(/^[0-9a-f]{64}$/);
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects stale payload content before freezing approved reviews", async () => {
      const cwd = await makeGitWorkspace();
      try {
        const inputs = await writeInputs(cwd);
        await writeJson(
          cwd,
          inputs.reviewPayloadFile,
          payload({
            commit_id: inputs.reviewHeadSha,
            body: "Stale review body",
          }),
        );

        await expect(
          runHelper(cwd, "freeze-approved-review", {
            HEAD_SHA: inputs.reviewHeadSha,
            FINDINGS_FILE: inputs.reviewFindingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_PAYLOAD_FILE: inputs.reviewPayloadFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "review payload does not match generated payload",
          ),
        });

        await expect(
          readFile(path.join(cwd, inputs.reviewApprovedFile), "utf-8"),
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects payloads that omit comments from current findings", async () => {
      const { cwd, reviewHeadSha, reviewFindingsFile, reviewPayloadFile } =
        await makeReviewSourceWorkspace();
      try {
        await writeFile(path.join(cwd, reviewBodyFile), "Review body\n");
        await writeJson(cwd, reviewFindingsFile, {
          schema: "play-review/findings/v1",
          findings: [sourceFinding()],
          carry_forward: [],
        });
        await writeJson(cwd, reviewPayloadFile, {
          commit_id: reviewHeadSha,
          event: "COMMENT",
          body: "Review body",
          comments: [],
        });

        await expect(
          runHelper(cwd, "freeze-approved-review", {
            HEAD_SHA: reviewHeadSha,
            FINDINGS_FILE: reviewFindingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_PAYLOAD_FILE: reviewPayloadFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "review payload does not match generated payload",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("requires the review event when freezing approved reviews", async () => {
      const cwd = await makeGitWorkspace();
      try {
        const inputs = await writeInputs(cwd);

        await expect(
          runHelper(cwd, "freeze-approved-review", {
            HEAD_SHA: inputs.reviewHeadSha,
            FINDINGS_FILE: inputs.reviewFindingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_PAYLOAD_FILE: inputs.reviewPayloadFile,
            REVIEW_EVENT: "",
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("REVIEW_EVENT is required"),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("validates the approved review and prints the exact frozen payload", async () => {
      const cwd = await makeGitWorkspace();
      try {
        const inputs = await writeInputs(cwd);
        await runHelper(cwd, "freeze-approved-review", {
          HEAD_SHA: inputs.reviewHeadSha,
          FINDINGS_FILE: inputs.reviewFindingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: inputs.reviewPayloadFile,
        });

        const { stdout } = await runHelper(cwd, "validate-approved-review", {
          HEAD_SHA: inputs.reviewHeadSha,
          APPROVED_REVIEW_FILE: inputs.reviewApprovedFile,
        });

        expect(JSON.parse(stdout)).toEqual(inputs.reviewPayload);
        expect(stdout).toContain('"body": "Review body"');
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("allows start_side only on ranged inline comments", async () => {
      const {
        cwd,
        reviewHeadSha,
        reviewFindingsFile,
        reviewPayloadFile,
        reviewScopeDecisionFile,
      } = await makeReviewSourceWorkspace();
      try {
        const reviewApprovedFile = `.ephemeral/topic-${reviewHeadSha}-approved-review.json`;
        await writeFile(path.join(cwd, reviewBodyFile), "Review body\n");
        await writeJson(cwd, reviewFindingsFile, {
          schema: "play-review/findings/v1",
          findings: [
            sourceFinding({
              line: 3,
              start_line: 2,
              body: "**Blocking | Contracts** - Ranged inline body.\n\n**Recommendation:** Keep the ranged body.",
            }),
            sourceFinding({
              line: 4,
              body: "**Blocking | Contracts** - Single-line inline body.\n\n**Recommendation:** Keep the single-line body.",
            }),
          ],
          carry_forward: [],
        });
        const { stdout: generatedPayload } = await runHelper(
          cwd,
          "build-github-review-payload",
          {
            HEAD_SHA: reviewHeadSha,
            FINDINGS_FILE: reviewFindingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_EVENT: "COMMENT",
          },
        );
        await writeFile(path.join(cwd, reviewPayloadFile), generatedPayload);

        await runHelper(cwd, "freeze-approved-review", {
          HEAD_SHA: reviewHeadSha,
          FINDINGS_FILE: reviewFindingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: reviewPayloadFile,
        });
        const approvedArtifact = JSON.parse(
          await readFile(path.join(cwd, reviewApprovedFile), "utf-8"),
        ) as {
          scope_decision_file?: string;
          scope_decision_sha256?: string;
        };
        expect(approvedArtifact.scope_decision_file).toBe(
          reviewScopeDecisionFile,
        );
        expect(approvedArtifact.scope_decision_sha256).toMatch(
          /^[0-9a-f]{64}$/,
        );

        const { stdout } = await runHelper(cwd, "validate-approved-review", {
          HEAD_SHA: reviewHeadSha,
          APPROVED_REVIEW_FILE: reviewApprovedFile,
        });

        const validatedPayload = JSON.parse(stdout) as {
          comments: Array<Record<string, unknown>>;
        };
        expect(validatedPayload.comments[0]).toMatchObject({
          start_line: 2,
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
        const inputs = await writeInputs(cwd);
        await runHelper(cwd, "freeze-approved-review", {
          HEAD_SHA: inputs.reviewHeadSha,
          FINDINGS_FILE: inputs.reviewFindingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: inputs.reviewPayloadFile,
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
          payloadWithRange({
            comments: [
              {
                path: "src/example.ts",
                line: 12,
                side: "LEFT",
                body: "Wrong side\n",
              },
            ],
          }),
        ];

        for (const malformedPayload of malformedPayloads) {
          await writeJson(cwd, inputs.reviewPayloadFile, {
            ...malformedPayload,
            commit_id: inputs.reviewHeadSha,
          });
          await expect(
            runHelper(cwd, "validate-approved-review", {
              HEAD_SHA: inputs.reviewHeadSha,
              APPROVED_REVIEW_FILE: inputs.reviewApprovedFile,
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
        const inputs = await writeInputs(cwd);

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
            REVIEW_PAYLOAD_FILE: inputs.reviewPayloadFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("findings path mismatch"),
        });
        await expect(
          runHelper(cwd, "freeze-approved-review", {
            HEAD_SHA: inputs.reviewHeadSha,
            FINDINGS_FILE: inputs.reviewFindingsFile,
            REVIEW_BODY_FILE: "review-body.md",
            REVIEW_PAYLOAD_FILE: inputs.reviewPayloadFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("review body path validation failed"),
        });
        await runHelper(cwd, "freeze-approved-review", {
          HEAD_SHA: inputs.reviewHeadSha,
          FINDINGS_FILE: inputs.reviewFindingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: inputs.reviewPayloadFile,
        });
        await writeFile(
          path.join(cwd, ".ephemeral/wrong-approved-review.json"),
          await readFile(path.join(cwd, inputs.reviewApprovedFile)),
        );
        await expect(
          runHelper(cwd, "validate-approved-review", {
            HEAD_SHA: inputs.reviewHeadSha,
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
        const inputs = await writeInputs(cwd);
        await writeJson(cwd, inputs.reviewPayloadFile, {
          ...inputs.reviewPayload,
          event: "DISMISS",
        });
        await expect(
          runHelper(cwd, "freeze-approved-review", {
            HEAD_SHA: inputs.reviewHeadSha,
            FINDINGS_FILE: inputs.reviewFindingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_PAYLOAD_FILE: inputs.reviewPayloadFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("payload shape mismatch"),
        });

        await writeJson(cwd, inputs.reviewPayloadFile, inputs.reviewPayload);
        await runHelper(cwd, "freeze-approved-review", {
          HEAD_SHA: inputs.reviewHeadSha,
          FINDINGS_FILE: inputs.reviewFindingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: inputs.reviewPayloadFile,
        });
        await writeJson(cwd, inputs.reviewApprovedFile, {
          schema: "wrong/v1",
          review_head_sha: inputs.reviewHeadSha,
          findings_file: inputs.reviewFindingsFile,
          review_body_file: reviewBodyFile,
          review_payload_file: inputs.reviewPayloadFile,
          scope_decision_file: inputs.reviewScopeDecisionFile,
          findings_sha256: "0".repeat(64),
          review_body_sha256: "0".repeat(64),
          review_payload_sha256: "0".repeat(64),
          scope_decision_sha256: "0".repeat(64),
          payload: inputs.reviewPayload,
        });

        await expect(
          runHelper(cwd, "validate-approved-review", {
            HEAD_SHA: inputs.reviewHeadSha,
            APPROVED_REVIEW_FILE: inputs.reviewApprovedFile,
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
        const inputs = await writeInputs(cwd);
        await runHelper(cwd, "freeze-approved-review", {
          HEAD_SHA: inputs.reviewHeadSha,
          FINDINGS_FILE: inputs.reviewFindingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: inputs.reviewPayloadFile,
        });

        await writeJson(cwd, inputs.reviewFindingsFile, {
          ...findingsEnvelope(),
          extra: "drift",
        });
        await expect(
          runHelper(cwd, "validate-approved-review", {
            HEAD_SHA: inputs.reviewHeadSha,
            APPROVED_REVIEW_FILE: inputs.reviewApprovedFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("findings digest mismatch"),
        });

        await writeJson(cwd, inputs.reviewFindingsFile, findingsEnvelope());
        await writeFile(path.join(cwd, reviewBodyFile), "Changed body\n");
        await expect(
          runHelper(cwd, "validate-approved-review", {
            HEAD_SHA: inputs.reviewHeadSha,
            APPROVED_REVIEW_FILE: inputs.reviewApprovedFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("review body digest mismatch"),
        });

        await writeFile(path.join(cwd, reviewBodyFile), "Review body\n");
        await writeJson(cwd, inputs.reviewPayloadFile, {
          ...inputs.reviewPayload,
          body: "Changed payload",
        });
        await expect(
          runHelper(cwd, "validate-approved-review", {
            HEAD_SHA: inputs.reviewHeadSha,
            APPROVED_REVIEW_FILE: inputs.reviewApprovedFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("payload digest mismatch"),
        });

        await writeJson(cwd, inputs.reviewPayloadFile, inputs.reviewPayload);
        const artifact = JSON.parse(
          await readFile(path.join(cwd, inputs.reviewApprovedFile), "utf-8"),
        );
        artifact.review_payload_sha256 = "0".repeat(64);
        await writeJson(cwd, inputs.reviewApprovedFile, artifact);
        await expect(
          runHelper(cwd, "validate-approved-review", {
            HEAD_SHA: inputs.reviewHeadSha,
            APPROVED_REVIEW_FILE: inputs.reviewApprovedFile,
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
        const inputs = await writeInputs(cwd);
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
          await writeJson(cwd, inputs.reviewFindingsFile, {
            schema: "play-review/findings/v1",
            findings: [invalidEntry],
            carry_forward: [],
          });

          await expect(
            runHelper(cwd, "freeze-approved-review", {
              HEAD_SHA: inputs.reviewHeadSha,
              FINDINGS_FILE: inputs.reviewFindingsFile,
              REVIEW_BODY_FILE: reviewBodyFile,
              REVIEW_PAYLOAD_FILE: inputs.reviewPayloadFile,
            }),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining("envelope schema mismatch"),
          });
        }

        await writeInputs(cwd);
        await runHelper(cwd, "freeze-approved-review", {
          HEAD_SHA: inputs.reviewHeadSha,
          FINDINGS_FILE: inputs.reviewFindingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: inputs.reviewPayloadFile,
        });
        const artifact = JSON.parse(
          await readFile(path.join(cwd, inputs.reviewApprovedFile), "utf-8"),
        );
        artifact.findings_sha256 = "0".repeat(64);
        await writeJson(cwd, inputs.reviewApprovedFile, artifact);
        await writeJson(cwd, inputs.reviewFindingsFile, {
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
            HEAD_SHA: inputs.reviewHeadSha,
            APPROVED_REVIEW_FILE: inputs.reviewApprovedFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("envelope schema mismatch"),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects multi-document review payload JSON streams", async () => {
      const cwd = await makeGitWorkspace();
      try {
        const inputs = await writeInputs(cwd);
        await writeFile(
          path.join(cwd, inputs.reviewPayloadFile),
          `${JSON.stringify(inputs.reviewPayload)}\n${JSON.stringify({
            ...inputs.reviewPayload,
            event: "APPROVE",
          })}\n`,
        );

        await expect(
          runHelper(cwd, "freeze-approved-review", {
            HEAD_SHA: inputs.reviewHeadSha,
            FINDINGS_FILE: inputs.reviewFindingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_PAYLOAD_FILE: inputs.reviewPayloadFile,
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
        const inputs = await writeInputs(cwd);
        await runHelper(cwd, "freeze-approved-review", {
          HEAD_SHA: inputs.reviewHeadSha,
          FINDINGS_FILE: inputs.reviewFindingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: inputs.reviewPayloadFile,
        });

        await expect(
          runHelper(cwd, "validate-approved-review", {
            HEAD_SHA: staleHeadSha,
            APPROVED_REVIEW_FILE: inputs.reviewApprovedFile,
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
          const inputs = await writeInputs(cwd);
          await runHelper(cwd, "freeze-approved-review", {
            HEAD_SHA: inputs.reviewHeadSha,
            FINDINGS_FILE: inputs.reviewFindingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_PAYLOAD_FILE: inputs.reviewPayloadFile,
          });
          await writeFile(
            outside,
            await readFile(path.join(cwd, inputs.reviewApprovedFile)),
          );
          await rm(path.join(cwd, inputs.reviewApprovedFile));
          await symlink(outside, path.join(cwd, inputs.reviewApprovedFile));

          await expect(
            runHelper(cwd, "validate-approved-review", {
              HEAD_SHA: inputs.reviewHeadSha,
              APPROVED_REVIEW_FILE: inputs.reviewApprovedFile,
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
          const inputs = await writeInputs(cwd);
          await rm(path.join(cwd, inputs.reviewPayloadFile));
          await writeFile(outsidePayload, "do not remove\n");
          await symlink(
            outsidePayload,
            path.join(cwd, inputs.reviewPayloadFile),
          );

          await expect(
            runHelper(cwd, "prepare-review-payload-write", {
              HEAD_SHA: inputs.reviewHeadSha,
              REVIEW_PAYLOAD_FILE: inputs.reviewPayloadFile,
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
            (
              await lstat(path.join(cwd, inputs.reviewPayloadFile))
            ).isSymbolicLink(),
          ).toBe(true);

          await rm(path.join(cwd, inputs.reviewPayloadFile));
          await writeJson(cwd, inputs.reviewPayloadFile, inputs.reviewPayload);
          await writeFile(outsideApproved, "do not remove\n");
          await symlink(
            outsideApproved,
            path.join(cwd, inputs.reviewApprovedFile),
          );

          await expect(
            runHelper(cwd, "freeze-approved-review", {
              HEAD_SHA: inputs.reviewHeadSha,
              FINDINGS_FILE: inputs.reviewFindingsFile,
              REVIEW_BODY_FILE: reviewBodyFile,
              REVIEW_PAYLOAD_FILE: inputs.reviewPayloadFile,
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
            (
              await lstat(path.join(cwd, inputs.reviewApprovedFile))
            ).isSymbolicLink(),
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
      let absoluteApprovedReviewFile = "";
      try {
        const inputs = await writeInputs(cwd);
        absoluteApprovedReviewFile = path.join(cwd, inputs.reviewApprovedFile);
        await runHelper(cwd, "freeze-approved-review", {
          HEAD_SHA: inputs.reviewHeadSha,
          FINDINGS_FILE: inputs.reviewFindingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: inputs.reviewPayloadFile,
        });
        await chmod(absoluteApprovedReviewFile, 0o000);
        try {
          await readFile(absoluteApprovedReviewFile);
          return;
        } catch {
          await expect(
            runHelper(cwd, "validate-approved-review", {
              HEAD_SHA: inputs.reviewHeadSha,
              APPROVED_REVIEW_FILE: inputs.reviewApprovedFile,
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
