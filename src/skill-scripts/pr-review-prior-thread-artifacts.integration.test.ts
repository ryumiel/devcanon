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
  "skills/pr-review/scripts/prior-thread-artifacts.sh",
);
const headSha = "0123456789abcdef0123456789abcdef01234567";
const priorThreadsFile = `.ephemeral/topic-${headSha}-prior-threads.json`;
const scopeDecisionFile = `.ephemeral/topic-${headSha}-scope-decision.json`;
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
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devcanon-pr-threads-"));
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

async function commitFile(cwd: string, relPath: string, contents: string) {
  await mkdir(path.dirname(path.join(cwd, relPath)), { recursive: true });
  await writeFile(path.join(cwd, relPath), contents);
  await execFileAsync("git", ["add", relPath], { cwd });
  await execFileAsync("git", ["commit", "-m", `test: update ${relPath}`], {
    cwd,
  });
  return (
    await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })
  ).stdout.trim();
}

async function commitFiles(cwd: string, relPaths: string[]) {
  for (const relPath of relPaths) {
    await mkdir(path.dirname(path.join(cwd, relPath)), { recursive: true });
    await writeFile(path.join(cwd, relPath), `${relPath}\n`);
  }
  await execFileAsync("git", ["add", "--", ...relPaths], { cwd });
  await execFileAsync("git", ["commit", "-m", "test: update multiple files"], {
    cwd,
  });
  return (
    await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })
  ).stdout.trim();
}

async function makeNarrowScope(cwd: string) {
  const lastReviewedSha = (
    await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })
  ).stdout.trim();
  await commitFile(cwd, "src/example.ts", "narrow\n");
  return {
    selected_range: `${lastReviewedSha}..HEAD`,
    candidate_narrow_range: `${lastReviewedSha}..HEAD`,
    last_reviewed_sha: lastReviewedSha,
    changed_files: ["src/example.ts"],
    mechanical_facts: {
      ...scopeDecision().mechanical_facts,
      changed_file_count: 1,
    },
  };
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

function priorThreads(overrides: Record<string, unknown> = {}) {
  return {
    schema: "pr-review/prior-threads/v1",
    provider: "github",
    pr_number: 380,
    head_sha: headSha,
    threads: [
      {
        thread_id: "PRRT_actionable",
        is_resolved: false,
        is_outdated: false,
        path: "src/example.ts",
        line: 12,
        original_line: 10,
        start_line: null,
        original_start_line: null,
        classification: "actionable",
        model_context: "include",
        staleness_reason: "current-anchor",
        comments: [
          {
            author: "reviewer",
            author_association: "MEMBER",
            created_at: "2026-05-26T12:34:56Z",
            updated_at: "2026-05-26T12:34:56Z",
            body: "Still actionable.",
            is_bot: false,
            minimized_reason: null,
          },
        ],
        summary: "Unresolved actionable thread.",
      },
      {
        thread_id: "PRRT_bot",
        is_resolved: false,
        is_outdated: false,
        path: "src/example.ts",
        line: 14,
        original_line: 14,
        start_line: null,
        original_start_line: null,
        classification: "bot-boilerplate",
        model_context: "drop",
        staleness_reason: "current-anchor",
        comments: [],
        summary: "Bot boilerplate excluded.",
      },
    ],
    dropped: [
      {
        thread_id: "PRRT_resolved",
        classification: "resolved",
        reason: "resolved thread excluded from model context",
      },
    ],
    ...overrides,
  };
}

function scopeDecision(overrides: Record<string, unknown> = {}) {
  return {
    schema: "pr-review/scope-decision/v1",
    surface: "pr-review",
    mode: "follow-up",
    selected_range: `${headSha}..HEAD`,
    full_range: "origin/main...HEAD",
    candidate_narrow_range: `${headSha}..HEAD`,
    is_followup_narrow: true,
    selection_reason: "mechanical and semantic checks passed",
    escalation_reasons: [],
    last_reviewed_sha: headSha,
    head_sha: headSha,
    changed_files: ["src/example.ts"],
    language_hints: ["ts"],
    prior_context: {
      kind: "github-prior-threads",
      path: priorThreadsFile,
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

describe.skipIf(!jqAvailable)("pr-review prior thread artifact helper", () => {
  it("derives guarded write paths from the checked-out branch", async () => {
    const cwd = await makeGitWorkspace();
    try {
      await expect(
        runHelper(cwd, "prepare-prior-threads-write"),
      ).resolves.toMatchObject({ stdout: `${priorThreadsFile}\n` });
      await expect(
        runHelper(cwd, "prepare-scope-decision-write"),
      ).resolves.toMatchObject({ stdout: `${scopeDecisionFile}\n` });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("validates prior-thread and scope-decision artifacts", async () => {
    const cwd = await makeGitWorkspace();
    try {
      const narrowScope = await makeNarrowScope(cwd);
      await writeJson(cwd, priorThreadsFile, priorThreads());
      await writeJson(cwd, scopeDecisionFile, scopeDecision(narrowScope));

      await expect(
        runHelper(cwd, "validate-prior-threads", {
          PRIOR_THREADS_FILE: priorThreadsFile,
        }),
      ).resolves.toMatchObject({ stdout: "" });

      await writeJson(
        cwd,
        priorThreadsFile,
        priorThreads({
          threads: [
            {
              ...priorThreads().threads[0],
              comments: [
                {
                  ...priorThreads().threads[0].comments[0],
                  created_at: "2026-05-26T12:34:56.789Z",
                  updated_at: "2024-02-29T12:34:56Z",
                },
              ],
            },
          ],
        }),
      );
      await expect(
        runHelper(cwd, "validate-prior-threads", {
          PRIOR_THREADS_FILE: priorThreadsFile,
        }),
      ).resolves.toMatchObject({ stdout: "" });
      await expect(
        runHelper(cwd, "validate-scope-decision", {
          SCOPE_DECISION_FILE: scopeDecisionFile,
        }),
      ).resolves.toMatchObject({ stdout: "" });

      await writeJson(
        cwd,
        scopeDecisionFile,
        scopeDecision({
          mode: "initial",
          selected_range: "origin/main...HEAD",
          candidate_narrow_range: "origin/main...HEAD",
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
      ).resolves.toMatchObject({ stdout: "" });

      await writeJson(
        cwd,
        scopeDecisionFile,
        scopeDecision({
          selected_range: "origin/main...HEAD",
          is_followup_narrow: false,
          selection_reason: "file-count escalation",
          escalation_reasons: ["file-count"],
          changed_files: [
            "src/example-a.ts",
            "src/example-b.ts",
            "src/example-c.ts",
            "src/example-d.ts",
            "src/example-e.ts",
            "src/example-f.ts",
          ],
          mechanical_facts: {
            changed_file_count: 6,
            followup_sha_usable: true,
            mechanical_escalate_full: true,
            mechanical_escalation_reason: "file-count",
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
          selected_range: "origin/main...HEAD",
          candidate_narrow_range: "origin/main...HEAD",
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
        }),
      ).resolves.toMatchObject({ stdout: "" });

      await writeJson(
        cwd,
        priorThreadsFile,
        priorThreads({
          threads: [
            {
              ...priorThreads().threads[0],
              comments: [
                {
                  author: "reviewer",
                  created_at: "2026-05-26T12:34:56Z",
                  updated_at: "2026-05-26T12:34:56Z",
                  body: "Still actionable.",
                  is_bot: false,
                },
              ],
            },
          ],
        }),
      );
      await expect(
        runHelper(cwd, "validate-prior-threads", {
          PRIOR_THREADS_FILE: priorThreadsFile,
        }),
      ).resolves.toMatchObject({ stdout: "" });

      await writeJson(
        cwd,
        priorThreadsFile,
        priorThreads({
          threads: [
            {
              ...priorThreads().threads[0],
              comments: [
                {
                  ...priorThreads().threads[0].comments[0],
                  author_association: null,
                  minimized_reason: null,
                },
              ],
            },
          ],
        }),
      );
      await expect(
        runHelper(cwd, "validate-prior-threads", {
          PRIOR_THREADS_FILE: priorThreadsFile,
        }),
      ).resolves.toMatchObject({ stdout: "" });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects multi-document artifacts and raw provider fields", async () => {
    const cwd = await makeGitWorkspace();
    try {
      await writeFile(
        path.join(cwd, priorThreadsFile),
        `${JSON.stringify({ raw_graphql_response: true })}\n${JSON.stringify(priorThreads())}`,
      );
      await expect(
        runHelper(cwd, "validate-prior-threads", {
          PRIOR_THREADS_FILE: priorThreadsFile,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("prior threads schema mismatch"),
      });

      await writeJson(
        cwd,
        priorThreadsFile,
        priorThreads({
          threads: [
            {
              ...priorThreads().threads[0],
              thread_id: 'PRRT_bad"} mutation',
            },
          ],
        }),
      );
      await expect(
        runHelper(cwd, "validate-prior-threads", {
          PRIOR_THREADS_FILE: priorThreadsFile,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("prior threads schema mismatch"),
      });

      await writeJson(
        cwd,
        priorThreadsFile,
        priorThreads({
          threads: [
            {
              ...priorThreads().threads[1],
              comments: [priorThreads().threads[0].comments[0]],
            },
          ],
        }),
      );
      await expect(
        runHelper(cwd, "validate-prior-threads", {
          PRIOR_THREADS_FILE: priorThreadsFile,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("prior threads schema mismatch"),
      });

      await writeJson(
        cwd,
        priorThreadsFile,
        priorThreads({
          dropped: [
            {
              thread_id: "PRRT_actionable_dropped",
              classification: "actionable",
              reason: "dropped from model context",
            },
          ],
        }),
      );
      await expect(
        runHelper(cwd, "validate-prior-threads", {
          PRIOR_THREADS_FILE: priorThreadsFile,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("prior threads schema mismatch"),
      });

      await writeJson(
        cwd,
        priorThreadsFile,
        priorThreads({
          threads: [
            {
              ...priorThreads().threads[0],
              model_context: "drop",
            },
          ],
        }),
      );
      await expect(
        runHelper(cwd, "validate-prior-threads", {
          PRIOR_THREADS_FILE: priorThreadsFile,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("prior threads schema mismatch"),
      });

      await writeJson(
        cwd,
        priorThreadsFile,
        priorThreads({
          raw_rest_reviews: [],
          threads: [
            {
              ...priorThreads().threads[0],
              raw_graphql_thread: {},
              comments: [
                {
                  ...priorThreads().threads[0].comments[0],
                  raw_graphql_comment: {},
                },
              ],
            },
          ],
        }),
      );
      await expect(
        runHelper(cwd, "validate-prior-threads", {
          PRIOR_THREADS_FILE: priorThreadsFile,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("prior threads schema mismatch"),
      });

      for (const created_at of [
        "2026-02-31T12:00:00Z",
        "2026-02-29T12:00:00Z",
        "2026-04-31T12:00:00Z",
        "2026-02-31T12:00:00.123Z",
      ]) {
        await writeJson(
          cwd,
          priorThreadsFile,
          priorThreads({
            threads: [
              {
                ...priorThreads().threads[0],
                comments: [
                  {
                    ...priorThreads().threads[0].comments[0],
                    created_at,
                  },
                ],
              },
            ],
          }),
        );
        await expect(
          runHelper(cwd, "validate-prior-threads", {
            PRIOR_THREADS_FILE: priorThreadsFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("prior threads schema mismatch"),
        });
      }
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects summarized prior threads without model-facing summaries", async () => {
    const cwd = await makeGitWorkspace();
    try {
      for (const summary of ["", "   "]) {
        await writeJson(
          cwd,
          priorThreadsFile,
          priorThreads({
            threads: [
              {
                ...priorThreads().threads[1],
                model_context: "summarize",
                summary,
              },
            ],
          }),
        );

        await expect(
          runHelper(cwd, "validate-prior-threads", {
            PRIOR_THREADS_FILE: priorThreadsFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("prior threads schema mismatch"),
        });
      }

      await writeJson(
        cwd,
        priorThreadsFile,
        priorThreads({
          threads: [
            {
              ...priorThreads().threads[1],
              model_context: "summarize",
              summary: "Compact resolved context.",
            },
          ],
        }),
      );
      await expect(
        runHelper(cwd, "validate-prior-threads", {
          PRIOR_THREADS_FILE: priorThreadsFile,
        }),
      ).resolves.toMatchObject({ stdout: "" });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects included prior threads without comments", async () => {
    const cwd = await makeGitWorkspace();
    try {
      await writeJson(
        cwd,
        priorThreadsFile,
        priorThreads({
          threads: [
            {
              ...priorThreads().threads[0],
              comments: [],
            },
          ],
        }),
      );

      await expect(
        runHelper(cwd, "validate-prior-threads", {
          PRIOR_THREADS_FILE: priorThreadsFile,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("prior threads schema mismatch"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects noisy included threads and malformed timestamps", async () => {
    const cwd = await makeGitWorkspace();
    try {
      await writeJson(
        cwd,
        priorThreadsFile,
        priorThreads({
          threads: [
            {
              ...priorThreads().threads[0],
              classification: "resolved",
              model_context: "include",
              is_resolved: true,
            },
          ],
        }),
      );
      await expect(
        runHelper(cwd, "validate-prior-threads", {
          PRIOR_THREADS_FILE: priorThreadsFile,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("prior threads schema mismatch"),
      });

      await writeJson(
        cwd,
        priorThreadsFile,
        priorThreads({
          threads: [
            {
              ...priorThreads().threads[0],
              comments: [
                {
                  ...priorThreads().threads[0].comments[0],
                  created_at: "2026-99-99T99:99:99Z",
                },
              ],
            },
          ],
        }),
      );
      await expect(
        runHelper(cwd, "validate-prior-threads", {
          PRIOR_THREADS_FILE: priorThreadsFile,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("prior threads schema mismatch"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects branch-findings prior context for pr-review scope decisions", async () => {
    const cwd = await makeGitWorkspace();
    try {
      await writeJson(
        cwd,
        scopeDecisionFile,
        scopeDecision({
          prior_context: {
            kind: "branch-findings",
            path: ".ephemeral/topic-findings.json",
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
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects malformed and contradictory pr-review scope decisions", async () => {
    const cwd = await makeGitWorkspace();
    try {
      const narrowScope = await makeNarrowScope(cwd);
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
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("scope decision schema mismatch"),
      });

      await writeJson(
        cwd,
        scopeDecisionFile,
        scopeDecision({
          prior_context: {
            kind: "github-prior-threads",
            path: `.ephemeral/stale-${headSha}-prior-threads.json`,
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
          candidate_narrow_range: "origin/main..HEAD",
          selected_range: "origin/main..HEAD",
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
          full_range: "origin/main...feature",
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
          full_range: "origin/main..HEAD",
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
          selected_range: "origin/main...HEAD",
          candidate_narrow_range: `${headSha}..HEAD`,
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
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("scope decision schema mismatch"),
      });

      await writeJson(
        cwd,
        scopeDecisionFile,
        scopeDecision({
          ...narrowScope,
          full_range: "origin/release+1...HEAD",
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
          selected_range: "origin/main....HEAD",
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
          selected_range: "origin/main HEAD",
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
          full_range: "foo@{bar}...HEAD",
        }),
      );
      await expect(
        runHelper(cwd, "validate-scope-decision", {
          SCOPE_DECISION_FILE: scopeDecisionFile,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("scope decision schema mismatch"),
      });

      for (const full_range of ["origin/main...@{-1}", "origin/main...@"]) {
        await writeJson(cwd, scopeDecisionFile, scopeDecision({ full_range }));
        await expect(
          runHelper(cwd, "validate-scope-decision", {
            SCOPE_DECISION_FILE: scopeDecisionFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("scope decision schema mismatch"),
        });
      }

      await writeJson(
        cwd,
        scopeDecisionFile,
        scopeDecision({
          candidate_narrow_range: "origin/main HEAD",
          selected_range: "origin/main HEAD",
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
          selected_range: "origin/main...HEAD",
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
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("scope decision schema mismatch"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects narrow pr-review scope when the selected diff changes more than five files", async () => {
    const cwd = await makeGitWorkspace();
    try {
      const lastReviewedSha = (
        await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })
      ).stdout.trim();
      const changedFiles = [
        "src/file-1.ts",
        "src/file-2.ts",
        "src/file-3.ts",
        "src/file-4.ts",
        "src/file-5.ts",
        "src/file-6.ts",
      ];
      await commitFiles(cwd, changedFiles);
      const selectedRange = `${lastReviewedSha}..HEAD`;

      await writeJson(
        cwd,
        scopeDecisionFile,
        scopeDecision({
          selected_range: selectedRange,
          candidate_narrow_range: selectedRange,
          last_reviewed_sha: lastReviewedSha,
          changed_files: changedFiles,
          mechanical_facts: {
            ...scopeDecision().mechanical_facts,
            changed_file_count: changedFiles.length,
            mechanical_escalate_full: false,
            mechanical_escalation_reason: "",
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
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects narrow pr-review changed_files that do not match the selected diff", async () => {
    const cwd = await makeGitWorkspace();
    try {
      const lastReviewedSha = (
        await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })
      ).stdout.trim();
      await commitFile(cwd, "src/example.ts", "narrow\n");
      await commitFile(cwd, "src/extra.ts", "extra\n");
      const selectedRange = `${lastReviewedSha}..HEAD`;
      const validScope = {
        selected_range: selectedRange,
        candidate_narrow_range: selectedRange,
        last_reviewed_sha: lastReviewedSha,
        changed_files: ["src/example.ts", "src/extra.ts"],
        mechanical_facts: {
          ...scopeDecision().mechanical_facts,
          changed_file_count: 2,
        },
      };

      await writeJson(cwd, scopeDecisionFile, scopeDecision(validScope));
      await expect(
        runHelper(cwd, "validate-scope-decision", {
          SCOPE_DECISION_FILE: scopeDecisionFile,
        }),
      ).resolves.toMatchObject({ stdout: "" });

      for (const changed_files of [
        ["src/example.ts"],
        ["src/example.ts", "src/extra.ts", "src/untracked.ts"],
        ["src/example.ts", "src/example.ts"],
        ["src/example.ts\nsrc/extra.ts"],
        ["src/example.ts\0src/extra.ts"],
      ]) {
        await writeJson(
          cwd,
          scopeDecisionFile,
          scopeDecision({
            ...validScope,
            changed_files,
            mechanical_facts: {
              ...validScope.mechanical_facts,
              changed_file_count: changed_files.length,
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
      }

      const missingSha = "fedcba9876543210fedcba9876543210fedcba98";
      await writeJson(
        cwd,
        scopeDecisionFile,
        scopeDecision({
          selected_range: `${missingSha}..HEAD`,
          candidate_narrow_range: `${missingSha}..HEAD`,
          last_reviewed_sha: missingSha,
          changed_files: ["src/example.ts", "src/extra.ts"],
          mechanical_facts: {
            ...validScope.mechanical_facts,
            changed_file_count: 2,
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
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it.skipIf(!symlinkAvailable)(
    "rejects symlinked normalized artifacts",
    async () => {
      const cwd = await makeGitWorkspace();
      try {
        const target = path.join(cwd, ".ephemeral", "target.json");
        await writeFile(target, JSON.stringify(priorThreads()));
        await rm(path.join(cwd, priorThreadsFile), { force: true });
        await symlink(target, path.join(cwd, priorThreadsFile));

        await expect(
          runHelper(cwd, "validate-prior-threads", {
            PRIOR_THREADS_FILE: priorThreadsFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "prior threads must not be a symlink",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    },
  );
});
