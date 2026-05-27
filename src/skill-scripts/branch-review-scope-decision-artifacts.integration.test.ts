import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  canCreateSymlinks,
  cleanupTempDir,
} from "../__test-helpers__/fixtures.js";

const execFileAsync = promisify(execFile);
const helperScript = path.join(
  process.cwd(),
  "skills/branch-review/scripts/scope-decision-artifacts.sh",
);
const headSha = "0123456789abcdef0123456789abcdef01234567";
const lastReviewedSha = "89abcdef0123456789abcdef0123456789abcdef";
const scopeDecisionFile = `.ephemeral/topic-${headSha}-scope-decision.json`;
const findingsFile = `.ephemeral/topic-${lastReviewedSha}-findings.json`;
const symlinkAvailable = await canCreateSymlinks();
const jqAvailable = await commandAvailable("jq");

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync("bash", ["-c", `command -v ${command}`]);
    return true;
  } catch {
    return false;
  }
}

async function makeGitWorkspace(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devcanon-branch-scope-"));
  await mkdir(path.join(cwd, ".ephemeral"), { recursive: true });
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

async function writeJson(cwd: string, relPath: string, value: unknown) {
  await mkdir(path.dirname(path.join(cwd, relPath)), { recursive: true });
  await writeFile(path.join(cwd, relPath), JSON.stringify(value, null, 2));
}

async function runHelper(
  cwd: string,
  command: string,
  env: NodeJS.ProcessEnv = {},
) {
  return execFileAsync("bash", [helperScript, command], {
    cwd,
    env: { ...process.env, HEAD_SHA: headSha, ...env },
  });
}

function scopeDecision(overrides: Record<string, unknown> = {}) {
  return {
    schema: "branch-review/scope-decision/v1",
    surface: "branch-review",
    mode: "follow-up",
    selected_range: `${lastReviewedSha}..HEAD`,
    full_range: "main...HEAD",
    candidate_narrow_range: `${lastReviewedSha}..HEAD`,
    is_followup_narrow: true,
    selection_reason: "mechanical and semantic checks passed",
    escalation_reasons: [],
    last_reviewed_sha: lastReviewedSha,
    head_sha: headSha,
    changed_files: ["skills/branch-review/SKILL.md"],
    language_hints: ["md"],
    prior_context: {
      kind: "branch-findings",
      path: findingsFile,
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
    ...overrides,
  };
}

const validateFollowupEnv = {
  PRIOR_BRANCH_FINDINGS: findingsFile,
};

describe.skipIf(!jqAvailable)(
  "branch-review scope decision artifact helper",
  () => {
    it("derives a guarded scope-decision write path from the checked-out branch", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await expect(
          runHelper(cwd, "prepare-scope-decision-write"),
        ).resolves.toMatchObject({ stdout: `${scopeDecisionFile}\n` });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("validates initial, narrow follow-up, and full-escalation decisions", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeJson(cwd, scopeDecisionFile, scopeDecision());
        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
            ...validateFollowupEnv,
          }),
        ).resolves.toMatchObject({ stdout: "" });

        await writeJson(
          cwd,
          scopeDecisionFile,
          scopeDecision({
            mode: "initial",
            selected_range: "main...HEAD",
            candidate_narrow_range: "main...HEAD",
            is_followup_narrow: false,
            escalation_reasons: ["not-followup"],
            last_reviewed_sha: null,
            prior_context: { kind: "none", path: null },
            changed_files: [
              "skills/branch-review/SKILL.md",
              "skills/play-review/SKILL.md",
            ],
            mechanical_facts: {
              changed_file_count: 2,
              followup_sha_usable: false,
              mechanical_escalate_full: true,
              mechanical_escalation_reason: "not-followup",
            },
          }),
        );
        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
          }),
        ).resolves.toMatchObject({ stdout: "" });

        await writeJson(
          cwd,
          scopeDecisionFile,
          scopeDecision({
            selected_range: "main...HEAD",
            is_followup_narrow: false,
            selection_reason: "file-count escalation",
            escalation_reasons: ["file-count"],
            changed_files: [
              "skills/branch-review/SKILL.md",
              "skills/play-review/SKILL.md",
              "skills/pr-review/SKILL.md",
              "skills/play-review/references/follow-up-scope-policy.md",
              "src/skill-scripts/branch-review-scope-decision-artifacts.integration.test.ts",
              "src/skill-scripts/pr-review-prior-thread-artifacts.integration.test.ts",
              "docs/guidelines/gh-api-hygiene.md",
            ],
            mechanical_facts: {
              changed_file_count: 7,
              followup_sha_usable: true,
              mechanical_escalate_full: true,
              mechanical_escalation_reason: "file-count",
            },
          }),
        );
        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
            ...validateFollowupEnv,
          }),
        ).resolves.toMatchObject({ stdout: "" });

        await writeJson(
          cwd,
          scopeDecisionFile,
          scopeDecision({
            selected_range: "main...HEAD",
            candidate_narrow_range: "main...HEAD",
            is_followup_narrow: false,
            selection_reason: "unusable baseline escalation",
            escalation_reasons: ["last-reviewed-unusable"],
            mechanical_facts: {
              changed_file_count: 1,
              followup_sha_usable: false,
              mechanical_escalate_full: true,
              mechanical_escalation_reason: "last-reviewed-unusable",
            },
          }),
        );
        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
            ...validateFollowupEnv,
          }),
        ).resolves.toMatchObject({ stdout: "" });

        await writeJson(
          cwd,
          scopeDecisionFile,
          scopeDecision({
            full_range: "origin/release+1...HEAD",
          }),
        );
        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
            ...validateFollowupEnv,
          }),
        ).resolves.toMatchObject({ stdout: "" });

        await writeJson(
          cwd,
          scopeDecisionFile,
          scopeDecision({
            prior_context: {
              kind: "branch-findings",
              path: `.ephemeral/renamed-${lastReviewedSha}-findings.json`,
            },
          }),
        );
        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
            PRIOR_BRANCH_FINDINGS: `.ephemeral/renamed-${lastReviewedSha}-findings.json`,
          }),
        ).resolves.toMatchObject({ stdout: "" });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects multi-document, malformed, and contradictory scope decisions", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeFile(
          path.join(cwd, scopeDecisionFile),
          `${JSON.stringify({ raw_scope_claim: true })}\n${JSON.stringify(scopeDecision())}`,
        );
        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("scope decision schema mismatch"),
        });

        await writeJson(
          cwd,
          scopeDecisionFile,
          scopeDecision({
            prior_context: { kind: "none", path: null },
          }),
        );
        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
            ...validateFollowupEnv,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("scope decision schema mismatch"),
        });

        await writeJson(
          cwd,
          scopeDecisionFile,
          scopeDecision({
            prior_context: {
              kind: "branch-findings",
              path: `.ephemeral/topic-${headSha}-findings.json`,
            },
          }),
        );
        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
            ...validateFollowupEnv,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("scope decision schema mismatch"),
        });

        await writeJson(cwd, scopeDecisionFile, scopeDecision());
        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("scope decision schema mismatch"),
        });

        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
            PRIOR_BRANCH_FINDINGS: `.ephemeral/stale-${lastReviewedSha}-findings.json`,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("scope decision schema mismatch"),
        });

        await writeJson(
          cwd,
          scopeDecisionFile,
          scopeDecision({
            candidate_narrow_range: "main..HEAD",
            selected_range: "main..HEAD",
          }),
        );
        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
            ...validateFollowupEnv,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("scope decision schema mismatch"),
        });

        await writeJson(
          cwd,
          scopeDecisionFile,
          scopeDecision({
            mechanical_facts: {
              changed_file_count: 1,
              followup_sha_usable: false,
              mechanical_escalate_full: false,
              mechanical_escalation_reason: "",
            },
          }),
        );
        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
            ...validateFollowupEnv,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("scope decision schema mismatch"),
        });

        await writeJson(
          cwd,
          scopeDecisionFile,
          scopeDecision({
            mechanical_facts: {
              changed_file_count: 0,
              followup_sha_usable: true,
              mechanical_escalate_full: false,
              mechanical_escalation_reason: "",
            },
          }),
        );
        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
            ...validateFollowupEnv,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("scope decision schema mismatch"),
        });

        await writeJson(
          cwd,
          scopeDecisionFile,
          scopeDecision({
            selected_range: "main...HEAD",
            candidate_narrow_range: `${lastReviewedSha}..HEAD`,
            is_followup_narrow: false,
            selection_reason: "unusable baseline escalation",
            escalation_reasons: ["last-reviewed-unusable"],
            mechanical_facts: {
              changed_file_count: 1,
              followup_sha_usable: false,
              mechanical_escalate_full: true,
              mechanical_escalation_reason: "last-reviewed-unusable",
            },
          }),
        );
        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
            ...validateFollowupEnv,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("scope decision schema mismatch"),
        });

        await writeJson(
          cwd,
          scopeDecisionFile,
          scopeDecision({
            selected_range: `${headSha}..HEAD`,
            is_followup_narrow: false,
            escalation_reasons: [],
          }),
        );
        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
            ...validateFollowupEnv,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("scope decision schema mismatch"),
        });

        await writeJson(
          cwd,
          scopeDecisionFile,
          scopeDecision({
            semantic_decision: {
              checked: false,
              ambiguous: true,
              notes: "Unclear.",
            },
          }),
        );
        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
            ...validateFollowupEnv,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("scope decision schema mismatch"),
        });

        await writeJson(
          cwd,
          scopeDecisionFile,
          scopeDecision({
            full_range: "main...feature",
          }),
        );
        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
            ...validateFollowupEnv,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("scope decision schema mismatch"),
        });

        await writeJson(
          cwd,
          scopeDecisionFile,
          scopeDecision({
            mode: "initial",
            selected_range: "HEAD...HEAD",
            full_range: "HEAD...HEAD",
            candidate_narrow_range: "HEAD...HEAD",
            is_followup_narrow: false,
            selection_reason: "initial review",
            escalation_reasons: ["not-followup"],
            last_reviewed_sha: null,
            prior_context: { kind: "none", path: null },
            mechanical_facts: {
              changed_file_count: 1,
              followup_sha_usable: false,
              mechanical_escalate_full: true,
              mechanical_escalation_reason: "not-followup",
            },
          }),
        );
        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("scope decision schema mismatch"),
        });

        await writeJson(
          cwd,
          scopeDecisionFile,
          scopeDecision({
            full_range: "main..HEAD",
          }),
        );
        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
            ...validateFollowupEnv,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("scope decision schema mismatch"),
        });

        await writeJson(
          cwd,
          scopeDecisionFile,
          scopeDecision({
            selected_range: "main....HEAD",
          }),
        );
        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
            ...validateFollowupEnv,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("scope decision schema mismatch"),
        });

        await writeJson(
          cwd,
          scopeDecisionFile,
          scopeDecision({
            selected_range: "main HEAD",
          }),
        );
        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
            ...validateFollowupEnv,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("scope decision schema mismatch"),
        });

        await writeJson(
          cwd,
          scopeDecisionFile,
          scopeDecision({
            full_range: "foo@{bar}...HEAD",
          }),
        );
        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
            ...validateFollowupEnv,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("scope decision schema mismatch"),
        });

        for (const full_range of ["main...@{-1}", "main...@"]) {
          await writeJson(
            cwd,
            scopeDecisionFile,
            scopeDecision({ full_range }),
          );
          await expect(
            runHelper(cwd, "validate-scope-decision", {
              SCOPE_DECISION_FILE: scopeDecisionFile,
              ...validateFollowupEnv,
            }),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining("scope decision schema mismatch"),
          });
        }

        await writeJson(
          cwd,
          scopeDecisionFile,
          scopeDecision({
            candidate_narrow_range: "main HEAD",
            selected_range: "main HEAD",
          }),
        );
        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
            ...validateFollowupEnv,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("scope decision schema mismatch"),
        });

        await writeJson(
          cwd,
          scopeDecisionFile,
          scopeDecision({
            selected_range: "main...HEAD",
            is_followup_narrow: true,
            escalation_reasons: ["file-count"],
            changed_files: [
              "skills/branch-review/SKILL.md",
              "skills/play-review/SKILL.md",
              "skills/pr-review/SKILL.md",
              "skills/play-review/scripts/review-artifacts.sh",
              "skills/pr-review/scripts/prior-thread-artifacts.sh",
              "src/skill-contracts/phase-artifact-source-contracts.test.ts",
              "src/render/phase-artifact-contracts.integration.test.ts",
            ],
            mechanical_facts: {
              changed_file_count: 7,
              followup_sha_usable: true,
              mechanical_escalate_full: true,
              mechanical_escalation_reason: "file-count",
            },
          }),
        );
        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
            ...validateFollowupEnv,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("scope decision schema mismatch"),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects GitHub prior-thread context for branch-review decisions", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeJson(
          cwd,
          scopeDecisionFile,
          scopeDecision({
            prior_context: {
              kind: "github-prior-threads",
              path: ".ephemeral/topic-prior-threads.json",
            },
          }),
        );

        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
            ...validateFollowupEnv,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("scope decision schema mismatch"),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects unsafe paths and invalid initial narrow decisions", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeJson(
          cwd,
          scopeDecisionFile,
          scopeDecision({
            mode: "initial",
            is_followup_narrow: true,
            last_reviewed_sha: null,
          }),
        );
        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("scope decision schema mismatch"),
        });

        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: ".ephemeral/nested/scope-decision.json",
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "nested scope decision path rejected",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it.skipIf(!symlinkAvailable)(
      "rejects symlinked scope-decision artifacts",
      async () => {
        const cwd = await makeGitWorkspace();
        try {
          const target = path.join(cwd, ".ephemeral", "target.json");
          await writeFile(target, JSON.stringify(scopeDecision()));
          await rm(path.join(cwd, scopeDecisionFile), { force: true });
          await symlink(target, path.join(cwd, scopeDecisionFile));

          await expect(
            runHelper(cwd, "validate-scope-decision", {
              SCOPE_DECISION_FILE: scopeDecisionFile,
            }),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining(
              "scope decision must not be a symlink",
            ),
          });
        } finally {
          await cleanupTempDir(cwd);
        }
      },
    );
  },
);
