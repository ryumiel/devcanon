import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { cleanupTempDir } from "../__test-helpers__/fixtures.js";

const execFileAsync = promisify(execFile);
const jqAvailable = await commandAvailable("jq");
const validatorScript = path.join(
  process.cwd(),
  "skills/play-validate-review-artifacts/scripts/review-artifacts.sh",
);

type JsonObject = Record<string, unknown>;

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync("bash", ["-c", `command -v ${command}`]);
    return true;
  } catch {
    return false;
  }
}

async function makeGitWorkspace(): Promise<{
  cwd: string;
  baseSha: string;
  firstSha: string;
  headSha: string;
}> {
  const cwd = await mkdtemp(
    path.join(os.tmpdir(), "devcanon-review-artifacts-"),
  );
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd,
  });
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await writeFile(path.join(cwd, "README.md"), "baseline\n");
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync("git", ["commit", "-m", "chore: baseline"], { cwd });
  const baseSha = await git(cwd, "rev-parse", "HEAD");

  await writeFile(path.join(cwd, "src/app.ts"), "export const value = 1;\n");
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync("git", ["commit", "-m", "feat: add app"], { cwd });
  const firstSha = await git(cwd, "rev-parse", "HEAD");

  await writeFile(
    path.join(cwd, "src/app.ts"),
    "export const value = 2;\nexport const next = 3;\n",
  );
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync("git", ["commit", "-m", "fix: update app"], { cwd });
  const headSha = await git(cwd, "rev-parse", "HEAD");

  await mkdir(path.join(cwd, ".ephemeral"));
  return { cwd, baseSha, firstSha, headSha };
}

async function makeLaterCheckoutWorkspace(): Promise<{
  cwd: string;
  baseSha: string;
  reviewHeadSha: string;
  laterHeadSha: string;
}> {
  const { cwd, baseSha, headSha: reviewHeadSha } = await makeGitWorkspace();
  await writeFile(path.join(cwd, "src/later.py"), "value = 1\n");
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync("git", ["commit", "-m", "test: later checkout"], {
    cwd,
  });
  const laterHeadSha = await git(cwd, "rev-parse", "HEAD");
  return { cwd, baseSha, reviewHeadSha, laterHeadSha };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function writeJson(cwd: string, relPath: string, value: unknown) {
  await mkdir(path.dirname(path.join(cwd, relPath)), { recursive: true });
  await writeFile(path.join(cwd, relPath), JSON.stringify(value, null, 2));
}

async function runValidator(cwd: string, command: string, args: string[] = []) {
  return execFileAsync("bash", [validatorScript, command, ...args], {
    cwd,
    env: process.env,
    maxBuffer: 1024 * 1024,
  });
}

function scopeArgs(
  headSha: string,
  _baseRef: string,
  scopeDecision = ".ephemeral/topic-scope-decision.json",
  surface = "branch-review",
  expectedPriorContextKind = "none",
  expectedPriorContextPath = "null",
) {
  return [
    "--surface",
    surface,
    "--head-sha",
    headSha,
    "--scope-decision-file",
    scopeDecision,
    "--expected-schema",
    `${surface}/scope-decision/v1`,
    "--expected-prior-context-kind",
    expectedPriorContextKind,
    "--expected-prior-context-path",
    expectedPriorContextPath,
    "--governed-path-pattern",
    "^(docs/(adr|arch|product-requirements|specs|guidelines)/|MAP\\.md$|AGENTS\\.md$|CONTRIBUTING\\.md$)",
    "--max-narrow-changed-files",
    "5",
  ];
}

function scopeArgsWithBaseRef(
  headSha: string,
  baseRef: string,
  scopeDecision = ".ephemeral/topic-scope-decision.json",
  surface = "branch-review",
  expectedPriorContextKind = "none",
  expectedPriorContextPath = "null",
) {
  return [
    ...scopeArgs(
      headSha,
      baseRef,
      scopeDecision,
      surface,
      expectedPriorContextKind,
      expectedPriorContextPath,
    ),
    "--base-ref",
    baseRef,
  ];
}

function branchFollowupScopeArgs(
  headSha: string,
  baseRef: string,
  scopeDecision = ".ephemeral/topic-scope-decision.json",
) {
  return scopeArgs(
    headSha,
    baseRef,
    scopeDecision,
    "branch-review",
    "branch-findings",
    ".ephemeral/topic-findings.json",
  );
}

function initialScope(
  baseSha: string,
  headSha: string,
  surface = "branch-review",
  priorContext: JsonObject = { kind: "none", path: null },
): JsonObject {
  return {
    schema: `${surface}/scope-decision/v1`,
    surface,
    mode: "initial",
    head_sha: headSha,
    full_range: `${baseSha}...HEAD`,
    selected_range: `${baseSha}...HEAD`,
    candidate_narrow_range: `${baseSha}...HEAD`,
    last_reviewed_sha: null,
    is_followup_narrow: false,
    selection_reason: "Initial review uses the full review range.",
    changed_files: ["src/app.ts"],
    language_hints: ["ts"],
    escalation_reasons: ["not-followup"],
    prior_context: priorContext,
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
  };
}

function narrowScope(
  baseSha: string,
  firstSha: string,
  headSha: string,
): JsonObject {
  return {
    ...initialScope(baseSha, headSha),
    mode: "follow-up",
    full_range: `${baseSha}...HEAD`,
    selected_range: `${firstSha}..HEAD`,
    candidate_narrow_range: `${firstSha}..HEAD`,
    last_reviewed_sha: firstSha,
    is_followup_narrow: true,
    selection_reason: "Follow-up review uses the last-reviewed SHA range.",
    escalation_reasons: [],
    prior_context: {
      kind: "branch-findings",
      path: ".ephemeral/topic-findings.json",
    },
    mechanical_facts: {
      changed_file_count: 1,
      followup_sha_usable: true,
      mechanical_escalate_full: false,
      mechanical_escalation_reason: "",
    },
  };
}

function finding(overrides: JsonObject = {}): JsonObject {
  return {
    path: "src/app.ts",
    line: 2,
    start_line: null,
    severity: "Blocking",
    category: "Logic",
    critic: "VALID",
    anchor: "natural",
    why: "The new export needs review.",
    recommendation: "Check the value before posting.",
    body: "Blocking: The new export needs review.",
    ...overrides,
  };
}

function findingsEnvelope(): JsonObject {
  return {
    schema: "play-review/findings/v1",
    findings: [finding()],
    carry_forward: [],
  };
}

function priorThread(overrides: JsonObject = {}): JsonObject {
  return {
    thread_id: "PRRT_kwDOExample",
    is_resolved: false,
    is_outdated: false,
    path: "src/app.ts",
    line: 2,
    original_line: 2,
    start_line: 1,
    original_start_line: 1,
    classification: "actionable",
    model_context: "include",
    staleness_reason: "",
    comments: [
      {
        author: "reviewer",
        author_association: "MEMBER",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:01Z",
        body: "Please check this.",
        is_bot: false,
        minimized_reason: null,
      },
    ],
    summary: "",
    ...overrides,
  };
}

function priorThreadsEnvelope(headSha: string, overrides: JsonObject = {}) {
  return {
    schema: "pr-review/prior-threads/v1",
    provider: "github",
    pr_number: 390,
    head_sha: headSha,
    threads: [priorThread()],
    dropped: [
      {
        thread_id: "PRRT_kwDODropped",
        classification: "resolved",
        reason: "Thread is resolved.",
      },
    ],
    ...overrides,
  };
}

async function expectRejectsWith(
  promise: Promise<unknown>,
  stderrFragment: string,
) {
  await expect(promise).rejects.toMatchObject({
    stderr: expect.stringContaining(stderrFragment),
  });
}

async function writeFixtureConsumerAdapter(adapter: string) {
  await mkdir(path.dirname(adapter), { recursive: true });
  await writeFile(
    adapter,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'validator="${PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT:-}"',
      'if [ -z "$validator" ]; then',
      '  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"',
      '  validator="$(cd "$script_dir/../.." && pwd -P)/play-validate-review-artifacts/scripts/review-artifacts.sh"',
      "fi",
      '[ -x "$validator" ] || { echo "play-validate-review-artifacts validator missing" >&2; exit 1; }',
      'bash "$validator" "$@"',
      "",
    ].join("\n"),
  );
  await chmod(adapter, 0o755);
}

async function writeMarkerValidator(
  root: string,
  marker: string,
  validatorRelPath = "skills/play-validate-review-artifacts/scripts/review-artifacts.sh",
) {
  const validator = path.join(root, validatorRelPath);
  await mkdir(path.dirname(validator), { recursive: true });
  await writeFile(
    validator,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `printf '%s\\n' ${JSON.stringify(marker)}`,
      "",
    ].join("\n"),
  );
  await chmod(validator, 0o755);
  return validator;
}

describe.skipIf(!jqAvailable)(
  "play-validate-review-artifacts validator",
  () => {
    it("accepts a valid initial full scope decision", async () => {
      const { cwd, baseSha, headSha } = await makeGitWorkspace();
      try {
        await writeJson(
          cwd,
          ".ephemeral/topic-scope-decision.json",
          initialScope(baseSha, headSha),
        );

        await expect(
          runValidator(
            cwd,
            "validate-scope-decision",
            scopeArgs(headSha, baseSha),
          ),
        ).resolves.toMatchObject({ stdout: "" });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("derives initial scope facts from the review head sha when checkout has advanced", async () => {
      const { cwd, baseSha, reviewHeadSha, laterHeadSha } =
        await makeLaterCheckoutWorkspace();
      try {
        await writeJson(
          cwd,
          ".ephemeral/topic-scope-decision.json",
          initialScope(baseSha, reviewHeadSha),
        );

        await expect(
          runValidator(
            cwd,
            "validate-scope-decision",
            scopeArgs(reviewHeadSha, baseSha),
          ),
        ).resolves.toMatchObject({ stdout: "" });

        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
          ...initialScope(baseSha, reviewHeadSha),
          changed_files: ["src/app.ts", "src/later.py"],
          language_hints: ["py", "ts"],
          mechanical_facts: {
            changed_file_count: 2,
            followup_sha_usable: false,
            mechanical_escalate_full: true,
            mechanical_escalation_reason: "not-followup",
          },
        });

        await expectRejectsWith(
          runValidator(
            cwd,
            "validate-scope-decision",
            scopeArgs(reviewHeadSha, baseSha),
          ),
          "changed files do not match selected range",
        );
        expect(laterHeadSha).not.toBe(reviewHeadSha);
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("accepts a valid narrow follow-up scope decision", async () => {
      const { cwd, baseSha, firstSha, headSha } = await makeGitWorkspace();
      try {
        await writeJson(
          cwd,
          ".ephemeral/topic-scope-decision.json",
          narrowScope(baseSha, firstSha, headSha),
        );

        await expect(
          runValidator(
            cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(headSha, baseSha),
          ),
        ).resolves.toMatchObject({ stdout: "" });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects self-consistent ranges that do not match the caller-derived full review range", async () => {
      const { cwd, baseSha, headSha } = await makeGitWorkspace();
      try {
        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
          ...initialScope(baseSha, headSha),
          full_range: `${headSha}...HEAD`,
          selected_range: `${headSha}...HEAD`,
          candidate_narrow_range: `${headSha}...HEAD`,
          changed_files: [],
          language_hints: [],
          mechanical_facts: {
            changed_file_count: 0,
            followup_sha_usable: false,
            mechanical_escalate_full: true,
            mechanical_escalation_reason: "not-followup",
          },
        });

        await expectRejectsWith(
          runValidator(
            cwd,
            "validate-scope-decision",
            scopeArgsWithBaseRef(
              headSha,
              baseSha,
              ".ephemeral/topic-scope-decision.json",
              "branch-review",
              "none",
              "null",
            ),
          ),
          "full range does not match caller base ref",
        );

        await writeFile(
          path.join(cwd, ".ephemeral/topic-scope-decision.json"),
          `${JSON.stringify(initialScope(baseSha, headSha))}\n${JSON.stringify(
            initialScope(baseSha, headSha),
          )}\n`,
        );
        await expectRejectsWith(
          runValidator(
            cwd,
            "validate-scope-decision",
            scopeArgs(headSha, baseSha),
          ),
          "scope decision JSON validation failed",
        );

        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
          ...initialScope(baseSha, headSha),
          candidate_narrow_range: "HEAD..HEAD",
        });
        await expectRejectsWith(
          runValidator(
            cwd,
            "validate-scope-decision",
            scopeArgs(headSha, baseSha),
          ),
          "initial candidate_narrow_range must equal full_range",
        );
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("accepts full escalation by file count", async () => {
      const { cwd, baseSha, firstSha, headSha } = await makeGitWorkspace();
      try {
        for (let index = 0; index < 6; index += 1) {
          await writeFile(
            path.join(cwd, `src/file-${index}.ts`),
            `v${index}\n`,
          );
        }
        await execFileAsync("git", ["add", "."], { cwd });
        await execFileAsync("git", ["commit", "-m", "test: many files"], {
          cwd,
        });
        const newHead = await git(cwd, "rev-parse", "HEAD");
        const scope = {
          ...initialScope(baseSha, newHead),
          changed_files: [
            "src/app.ts",
            ...Array.from({ length: 6 }, (_, index) => `src/file-${index}.ts`),
          ],
          language_hints: ["ts"],
          mode: "follow-up",
          selection_reason:
            "File count escalates the follow-up to full review.",
          escalation_reasons: ["file-count"],
          last_reviewed_sha: firstSha,
          candidate_narrow_range: `${firstSha}..HEAD`,
          prior_context: {
            kind: "branch-findings",
            path: ".ephemeral/topic-findings.json",
          },
          mechanical_facts: {
            changed_file_count: 7,
            followup_sha_usable: true,
            mechanical_escalate_full: true,
            mechanical_escalation_reason: "file-count",
          },
        };
        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", scope);

        await expect(
          runValidator(
            cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(newHead, baseSha),
          ),
        ).resolves.toMatchObject({ stdout: "" });
        expect(headSha).not.toBe(newHead);
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("accepts comma-joined mechanical reasons when multiple mechanical triggers fire", async () => {
      const { cwd, baseSha, firstSha } = await makeGitWorkspace();
      try {
        await mkdir(path.join(cwd, "docs/adr"), { recursive: true });
        await writeFile(path.join(cwd, "docs/adr/adr-9999.md"), "ADR\n");
        for (let index = 0; index < 6; index += 1) {
          await writeFile(path.join(cwd, `src/multi-${index}.ts`), "x\n");
        }
        await execFileAsync("git", ["add", "."], { cwd });
        await execFileAsync("git", ["commit", "-m", "test: multi trigger"], {
          cwd,
        });
        const headSha = await git(cwd, "rev-parse", "HEAD");
        const scope = {
          ...initialScope(baseSha, headSha),
          changed_files: [
            "docs/adr/adr-9999.md",
            "src/app.ts",
            ...Array.from({ length: 6 }, (_, index) => `src/multi-${index}.ts`),
          ],
          language_hints: ["md", "ts"],
          mode: "follow-up",
          selection_reason:
            "File count and governance paths escalate the follow-up to full review.",
          escalation_reasons: ["file-count", "governance-path"],
          last_reviewed_sha: firstSha,
          candidate_narrow_range: `${firstSha}..HEAD`,
          prior_context: {
            kind: "branch-findings",
            path: ".ephemeral/topic-findings.json",
          },
          mechanical_facts: {
            changed_file_count: 8,
            followup_sha_usable: true,
            mechanical_escalate_full: true,
            mechanical_escalation_reason: "file-count,governance-path",
          },
        };
        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", scope);
        await expect(
          runValidator(
            cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(headSha, baseSha),
          ),
        ).resolves.toMatchObject({ stdout: "" });

        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
          ...scope,
          mechanical_facts: {
            changed_file_count: 8,
            followup_sha_usable: true,
            mechanical_escalate_full: true,
            mechanical_escalation_reason: "file-count",
          },
        });
        await expectRejectsWith(
          runValidator(
            cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(headSha, baseSha),
          ),
          "mechanical escalation reason does not match git",
        );
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("derives follow-up mechanical counts from the candidate range while selected artifacts use the full range", async () => {
      const { cwd, baseSha, headSha } = await makeGitWorkspace();
      try {
        const lastReviewedSha = headSha;
        await writeFile(
          path.join(cwd, "src/extra.TS"),
          "export const x = 1;\n",
        );
        await execFileAsync("git", ["add", "."], { cwd });
        await execFileAsync("git", ["commit", "-m", "feat: extra"], { cwd });
        const newHead = await git(cwd, "rev-parse", "HEAD");
        const scope = {
          ...initialScope(baseSha, newHead),
          changed_files: ["src/app.ts", "src/extra.TS"],
          language_hints: ["ts"],
          mode: "follow-up",
          selection_reason:
            "Public API changes require the full follow-up review range.",
          escalation_reasons: ["public-api"],
          last_reviewed_sha: lastReviewedSha,
          candidate_narrow_range: `${lastReviewedSha}..HEAD`,
          prior_context: {
            kind: "branch-findings",
            path: ".ephemeral/topic-findings.json",
          },
          mechanical_facts: {
            changed_file_count: 1,
            followup_sha_usable: true,
            mechanical_escalate_full: false,
            mechanical_escalation_reason: "",
          },
        };
        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", scope);
        await expect(
          runValidator(
            cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(newHead, baseSha),
          ),
        ).resolves.toMatchObject({ stdout: "" });

        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
          ...scope,
          mechanical_facts: {
            changed_file_count: 2,
            followup_sha_usable: true,
            mechanical_escalate_full: false,
            mechanical_escalation_reason: "",
          },
        });
        await expectRejectsWith(
          runValidator(
            cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(newHead, baseSha),
          ),
          "changed file count does not match candidate range",
        );
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("accepts governed and configured path full escalation", async () => {
      const governed = await makeGitWorkspace();
      try {
        await mkdir(path.join(governed.cwd, "docs/adr"), { recursive: true });
        await writeFile(
          path.join(governed.cwd, "docs/adr/adr-9999.md"),
          "ADR\n",
        );
        await execFileAsync("git", ["add", "."], { cwd: governed.cwd });
        await execFileAsync("git", ["commit", "-m", "docs: adr"], {
          cwd: governed.cwd,
        });
        const headSha = await git(governed.cwd, "rev-parse", "HEAD");
        await writeJson(governed.cwd, ".ephemeral/topic-scope-decision.json", {
          ...initialScope(governed.baseSha, headSha),
          last_reviewed_sha: governed.firstSha,
          candidate_narrow_range: `${governed.firstSha}..HEAD`,
          changed_files: ["docs/adr/adr-9999.md", "src/app.ts"],
          language_hints: ["md", "ts"],
          mode: "follow-up",
          selection_reason:
            "Governance path escalates the follow-up to full review.",
          escalation_reasons: ["governance-path"],
          prior_context: {
            kind: "branch-findings",
            path: ".ephemeral/topic-findings.json",
          },
          mechanical_facts: {
            changed_file_count: 2,
            followup_sha_usable: true,
            mechanical_escalate_full: true,
            mechanical_escalation_reason: "governance-path",
          },
        });
        await expect(
          runValidator(
            governed.cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(headSha, governed.baseSha),
          ),
        ).resolves.toMatchObject({ stdout: "" });
      } finally {
        await cleanupTempDir(governed.cwd);
      }

      const configured = await makeGitWorkspace();
      try {
        await writeFile(path.join(configured.cwd, "src/generated.ts"), "gen\n");
        await execFileAsync("git", ["add", "."], { cwd: configured.cwd });
        await execFileAsync("git", ["commit", "-m", "chore: generated"], {
          cwd: configured.cwd,
        });
        const headSha = await git(configured.cwd, "rev-parse", "HEAD");
        await writeJson(
          configured.cwd,
          ".ephemeral/topic-scope-decision.json",
          {
            ...initialScope(configured.baseSha, headSha),
            last_reviewed_sha: configured.firstSha,
            candidate_narrow_range: `${configured.firstSha}..HEAD`,
            changed_files: ["src/app.ts", "src/generated.ts"],
            language_hints: ["ts"],
            mode: "follow-up",
            selection_reason:
              "Configured path escalates the follow-up to full review.",
            escalation_reasons: ["configured-path"],
            prior_context: {
              kind: "branch-findings",
              path: ".ephemeral/topic-findings.json",
            },
            mechanical_facts: {
              changed_file_count: 2,
              followup_sha_usable: true,
              mechanical_escalate_full: true,
              mechanical_escalation_reason: "configured-path",
            },
          },
        );
        await expect(
          runValidator(configured.cwd, "validate-scope-decision", [
            ...branchFollowupScopeArgs(headSha, configured.baseSha),
            "--configured-path-pattern",
            "\\<generated\\>",
          ]),
        ).resolves.toMatchObject({ stdout: "" });
      } finally {
        await cleanupTempDir(configured.cwd);
      }
    });

    it("rejects narrow artifacts that should escalate for file count, governed paths, or configured paths", async () => {
      const fileCount = await makeGitWorkspace();
      try {
        for (let index = 0; index < 6; index += 1) {
          await writeFile(
            path.join(fileCount.cwd, `src/file-${index}.ts`),
            `v${index}\n`,
          );
        }
        await execFileAsync("git", ["add", "."], { cwd: fileCount.cwd });
        await execFileAsync("git", ["commit", "-m", "test: many files"], {
          cwd: fileCount.cwd,
        });
        const headSha = await git(fileCount.cwd, "rev-parse", "HEAD");
        await writeJson(fileCount.cwd, ".ephemeral/topic-scope-decision.json", {
          ...narrowScope(fileCount.baseSha, fileCount.firstSha, headSha),
          changed_files: [
            "src/app.ts",
            ...Array.from({ length: 6 }, (_, index) => `src/file-${index}.ts`),
          ],
          mechanical_facts: {
            changed_file_count: 7,
            followup_sha_usable: true,
            mechanical_escalate_full: false,
            mechanical_escalation_reason: "",
          },
        });

        await expectRejectsWith(
          runValidator(
            fileCount.cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(headSha, fileCount.baseSha),
          ),
          "file count requires full review",
        );
      } finally {
        await cleanupTempDir(fileCount.cwd);
      }

      const governed = await makeGitWorkspace();
      try {
        await mkdir(path.join(governed.cwd, "docs/adr"), { recursive: true });
        await writeFile(
          path.join(governed.cwd, "docs/adr/adr-9999.md"),
          "ADR\n",
        );
        await execFileAsync("git", ["add", "."], { cwd: governed.cwd });
        await execFileAsync("git", ["commit", "-m", "docs: adr"], {
          cwd: governed.cwd,
        });
        const headSha = await git(governed.cwd, "rev-parse", "HEAD");
        await writeJson(governed.cwd, ".ephemeral/topic-scope-decision.json", {
          ...narrowScope(governed.baseSha, governed.firstSha, headSha),
          changed_files: ["docs/adr/adr-9999.md", "src/app.ts"],
          language_hints: ["md", "ts"],
          mechanical_facts: {
            changed_file_count: 2,
            followup_sha_usable: true,
            mechanical_escalate_full: false,
            mechanical_escalation_reason: "",
          },
        });

        await expectRejectsWith(
          runValidator(
            governed.cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(headSha, governed.baseSha),
          ),
          "governed path requires full review",
        );
      } finally {
        await cleanupTempDir(governed.cwd);
      }

      const configured = await makeGitWorkspace();
      try {
        await writeFile(path.join(configured.cwd, "src/generated.ts"), "gen\n");
        await execFileAsync("git", ["add", "."], { cwd: configured.cwd });
        await execFileAsync("git", ["commit", "-m", "chore: generated"], {
          cwd: configured.cwd,
        });
        const headSha = await git(configured.cwd, "rev-parse", "HEAD");
        await writeJson(
          configured.cwd,
          ".ephemeral/topic-scope-decision.json",
          {
            ...narrowScope(configured.baseSha, configured.firstSha, headSha),
            changed_files: ["src/app.ts", "src/generated.ts"],
            mechanical_facts: {
              changed_file_count: 2,
              followup_sha_usable: true,
              mechanical_escalate_full: false,
              mechanical_escalation_reason: "",
            },
          },
        );

        await expectRejectsWith(
          runValidator(configured.cwd, "validate-scope-decision", [
            ...branchFollowupScopeArgs(headSha, configured.baseSha),
            "--configured-path-pattern",
            "generated",
          ]),
          "configured path requires full review",
        );
      } finally {
        await cleanupTempDir(configured.cwd);
      }
    });

    it.skipIf(process.platform === "win32")(
      "uses byte-safe changed-file identity for governed paths with newlines",
      async () => {
        const { cwd, baseSha, firstSha } = await makeGitWorkspace();
        try {
          const governedPath = "docs/adr/a\nb.md";
          await mkdir(path.join(cwd, "docs/adr"), { recursive: true });
          await writeFile(path.join(cwd, governedPath), "ADR\n");
          await execFileAsync("git", ["add", "."], { cwd });
          await execFileAsync("git", ["commit", "-m", "docs: newline adr"], {
            cwd,
          });
          const headSha = await git(cwd, "rev-parse", "HEAD");

          await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
            ...narrowScope(baseSha, firstSha, headSha),
            changed_files: [governedPath, "src/app.ts"],
            language_hints: ["md", "ts"],
            mechanical_facts: {
              changed_file_count: 2,
              followup_sha_usable: true,
              mechanical_escalate_full: false,
              mechanical_escalation_reason: "",
            },
          });
          await expectRejectsWith(
            runValidator(
              cwd,
              "validate-scope-decision",
              branchFollowupScopeArgs(headSha, baseSha),
            ),
            "governed path requires full review",
          );

          await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
            ...initialScope(baseSha, headSha),
            changed_files: ['"docs/adr/a\\nb.md"', "src/app.ts"],
            language_hints: ["md", "ts"],
            mode: "follow-up",
            selection_reason:
              "Governance path escalates the follow-up to full review.",
            escalation_reasons: ["governance-path"],
            last_reviewed_sha: firstSha,
            candidate_narrow_range: `${firstSha}..HEAD`,
            prior_context: {
              kind: "branch-findings",
              path: ".ephemeral/topic-findings.json",
            },
            mechanical_facts: {
              changed_file_count: 2,
              followup_sha_usable: true,
              mechanical_escalate_full: true,
              mechanical_escalation_reason: "governance-path",
            },
          });
          await expectRejectsWith(
            runValidator(
              cwd,
              "validate-scope-decision",
              branchFollowupScopeArgs(headSha, baseSha),
            ),
            "changed files do not match selected range",
          );
        } finally {
          await cleanupTempDir(cwd);
        }
      },
    );

    it("rejects full follow-up artifacts without explicit justified escalation", async () => {
      const { cwd, baseSha, firstSha, headSha } = await makeGitWorkspace();
      try {
        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
          ...initialScope(baseSha, headSha),
          mode: "follow-up",
          last_reviewed_sha: firstSha,
          candidate_narrow_range: `${firstSha}..HEAD`,
          selection_reason: "Public API changes require full follow-up review.",
          escalation_reasons: ["public-api"],
          prior_context: {
            kind: "branch-findings",
            path: ".ephemeral/topic-findings.json",
          },
          mechanical_facts: {
            changed_file_count: 1,
            followup_sha_usable: true,
            mechanical_escalate_full: false,
            mechanical_escalation_reason: "",
          },
        });
        await expect(
          runValidator(
            cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(headSha, baseSha),
          ),
        ).resolves.toMatchObject({ stdout: "" });

        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
          ...initialScope(baseSha, headSha),
          mode: "follow-up",
          last_reviewed_sha: firstSha,
          candidate_narrow_range: `${firstSha}..HEAD`,
          selection_reason: "Follow-up full review lacks explicit escalation.",
          escalation_reasons: [],
          prior_context: {
            kind: "branch-findings",
            path: ".ephemeral/topic-findings.json",
          },
          mechanical_facts: {
            changed_file_count: 1,
            followup_sha_usable: true,
            mechanical_escalate_full: false,
            mechanical_escalation_reason: "",
          },
        });
        await expectRejectsWith(
          runValidator(
            cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(headSha, baseSha),
          ),
          "full follow-up requires escalation reason",
        );

        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
          ...initialScope(baseSha, headSha),
          mode: "follow-up",
          last_reviewed_sha: firstSha,
          candidate_narrow_range: `${firstSha}..HEAD`,
          selection_reason: "Follow-up full review lacks explicit escalation.",
          escalation_reasons: [],
          prior_context: {
            kind: "branch-findings",
            path: ".ephemeral/topic-findings.json",
          },
          mechanical_facts: {
            changed_file_count: 1,
            followup_sha_usable: true,
            mechanical_escalate_full: false,
            mechanical_escalation_reason: "",
          },
        });
        await expectRejectsWith(
          runValidator(
            cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(headSha, baseSha),
          ),
          "full follow-up requires escalation reason",
        );

        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
          ...initialScope(baseSha, headSha),
          mode: "follow-up",
          last_reviewed_sha: firstSha,
          candidate_narrow_range: `${firstSha}..HEAD`,
          selection_reason: "Unknown reason is invalid.",
          escalation_reasons: ["surprising-reason"],
          prior_context: {
            kind: "branch-findings",
            path: ".ephemeral/topic-findings.json",
          },
          mechanical_facts: {
            changed_file_count: 1,
            followup_sha_usable: true,
            mechanical_escalate_full: false,
            mechanical_escalation_reason: "",
          },
        });
        await expectRejectsWith(
          runValidator(
            cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(headSha, baseSha),
          ),
          "unknown escalation reason",
        );

        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
          ...initialScope(baseSha, headSha),
          mode: "follow-up",
          last_reviewed_sha: firstSha,
          candidate_narrow_range: `${firstSha}..HEAD`,
          selection_reason:
            "File-count reason lacks a matching file-count trigger.",
          escalation_reasons: ["file-count"],
          prior_context: {
            kind: "branch-findings",
            path: ".ephemeral/topic-findings.json",
          },
          mechanical_facts: {
            changed_file_count: 1,
            followup_sha_usable: true,
            mechanical_escalate_full: false,
            mechanical_escalation_reason: "",
          },
        });
        await expectRejectsWith(
          runValidator(
            cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(headSha, baseSha),
          ),
          "file-count escalation reason missing",
        );
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects invalid prior-context kind, surface, and path combinations", async () => {
      const { cwd, baseSha, firstSha, headSha } = await makeGitWorkspace();
      try {
        await writeJson(
          cwd,
          ".ephemeral/topic-scope-decision.json",
          initialScope(baseSha, headSha),
        );
        await expectRejectsWith(
          runValidator(cwd, "validate-scope-decision", [
            ...branchFollowupScopeArgs(headSha, baseSha),
            "--expected-schema",
            "play-review/scope-decision/v1",
          ]),
          "--expected-schema is invalid",
        );

        await expectRejectsWith(
          runValidator(cwd, "validate-scope-decision", [
            ...scopeArgs(
              headSha,
              baseSha,
              ".ephemeral/topic-scope-decision.json",
              "branch-review",
              "mystery-context",
              "null",
            ),
          ]),
          "--expected-prior-context-kind is invalid",
        );

        await writeJson(
          cwd,
          ".ephemeral/topic-scope-decision.json",
          initialScope(baseSha, headSha, "pr-review", {
            kind: "branch-findings",
            path: ".ephemeral/topic-findings.json",
          }),
        );
        await expectRejectsWith(
          runValidator(cwd, "validate-scope-decision", [
            ...scopeArgs(
              headSha,
              baseSha,
              ".ephemeral/topic-scope-decision.json",
              "pr-review",
              "branch-findings",
              ".ephemeral/topic-findings.json",
            ),
          ]),
          "branch-findings prior context is branch-review only",
        );

        await writeJson(
          cwd,
          ".ephemeral/topic-scope-decision.json",
          initialScope(baseSha, headSha, "branch-review", {
            kind: "github-prior-threads",
            path: ".ephemeral/topic-prior-threads.json",
          }),
        );
        await expectRejectsWith(
          runValidator(cwd, "validate-scope-decision", [
            ...scopeArgs(
              headSha,
              baseSha,
              ".ephemeral/topic-scope-decision.json",
              "branch-review",
              "github-prior-threads",
              ".ephemeral/topic-prior-threads.json",
            ),
          ]),
          "github-prior-threads prior context is pr-review only",
        );

        for (const invalidInitialPriorContext of [
          {
            surface: "pr-review",
            kind: "github-prior-threads",
            path: ".ephemeral/topic-prior-threads.json",
          },
          {
            surface: "branch-review",
            kind: "branch-findings",
            path: ".ephemeral/topic-findings.json",
          },
        ]) {
          await writeJson(
            cwd,
            ".ephemeral/topic-scope-decision.json",
            initialScope(baseSha, headSha, invalidInitialPriorContext.surface, {
              kind: invalidInitialPriorContext.kind,
              path: invalidInitialPriorContext.path,
            }),
          );
          await expectRejectsWith(
            runValidator(cwd, "validate-scope-decision", [
              ...scopeArgs(
                headSha,
                baseSha,
                ".ephemeral/topic-scope-decision.json",
                invalidInitialPriorContext.surface,
                invalidInitialPriorContext.kind,
                invalidInitialPriorContext.path,
              ),
            ]),
            "initial scope requires no prior context",
          );
        }

        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
          ...narrowScope(baseSha, firstSha, headSha),
          prior_context: {
            kind: "none",
            path: ".ephemeral/unexpected.json",
          },
        });
        await expectRejectsWith(
          runValidator(cwd, "validate-scope-decision", [
            ...scopeArgs(
              headSha,
              baseSha,
              ".ephemeral/topic-scope-decision.json",
              "branch-review",
              "none",
              "null",
            ),
          ]),
          "none prior context requires null path",
        );

        await writeJson(
          cwd,
          ".ephemeral/topic-scope-decision.json",
          initialScope(baseSha, headSha, "branch-review", {
            kind: "none",
            path: null,
          }),
        );
        await expectRejectsWith(
          runValidator(cwd, "validate-scope-decision", [
            ...scopeArgs(
              headSha,
              baseSha,
              ".ephemeral/topic-scope-decision.json",
              "branch-review",
              "none",
              ".ephemeral/unexpected.json",
            ),
          ]),
          "none prior context requires null path",
        );
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("requires ambiguous semantic scope to be full escalation unless explicitly allowed", async () => {
      const { cwd, baseSha, firstSha, headSha } = await makeGitWorkspace();
      try {
        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
          ...narrowScope(baseSha, firstSha, headSha),
          semantic_decision: {
            checked: true,
            ambiguous: true,
            notes: "Ambiguous candidate scope.",
          },
        });

        await expectRejectsWith(
          runValidator(
            cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(headSha, baseSha),
          ),
          "ambiguous semantic scope requires full review",
        );

        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
          ...initialScope(baseSha, headSha),
          mode: "follow-up",
          last_reviewed_sha: firstSha,
          candidate_narrow_range: `${firstSha}..HEAD`,
          selection_reason:
            "Ambiguous semantic scope escalates to full review.",
          escalation_reasons: ["ambiguous-classification"],
          prior_context: {
            kind: "branch-findings",
            path: ".ephemeral/topic-findings.json",
          },
          mechanical_facts: {
            changed_file_count: 1,
            followup_sha_usable: true,
            mechanical_escalate_full: false,
            mechanical_escalation_reason: "",
          },
          semantic_decision: {
            checked: true,
            ambiguous: true,
            notes: "Ambiguous candidate scope.",
          },
        });
        await expect(
          runValidator(
            cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(headSha, baseSha),
          ),
        ).resolves.toMatchObject({ stdout: "" });

        await expectRejectsWith(
          runValidator(cwd, "validate-scope-decision", [
            ...branchFollowupScopeArgs(headSha, baseSha),
            "--allow-ambiguous-full-escalation",
            "false",
          ]),
          "ambiguous semantic scope requires explicit allowance",
        );

        await expectRejectsWith(
          runValidator(cwd, "validate-scope-decision", [
            ...branchFollowupScopeArgs(headSha, baseSha),
            "--allow-ambiguous-full-escalation",
            "maybe",
          ]),
          "--allow-ambiguous-full-escalation must be true or false",
        );
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects stale refs and contradictory changed-file, count, and language claims", async () => {
      const { cwd, baseSha, firstSha, headSha } = await makeGitWorkspace();
      try {
        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
          ...narrowScope(baseSha, firstSha, headSha),
          head_sha: firstSha,
        });
        await expectRejectsWith(
          runValidator(
            cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(headSha, baseSha),
          ),
          "scope decision head mismatch",
        );

        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
          ...narrowScope(baseSha, firstSha, headSha),
          changed_files: ["src/other.ts"],
        });
        await expectRejectsWith(
          runValidator(
            cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(headSha, baseSha),
          ),
          "changed files do not match selected range",
        );

        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
          ...narrowScope(baseSha, firstSha, headSha),
          mechanical_facts: {
            changed_file_count: 99,
            followup_sha_usable: true,
            mechanical_escalate_full: false,
            mechanical_escalation_reason: "",
          },
        });
        await expectRejectsWith(
          runValidator(
            cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(headSha, baseSha),
          ),
          "changed file count does not match candidate range",
        );

        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
          ...narrowScope(baseSha, firstSha, headSha),
          mechanical_facts: {
            changed_file_count: 1,
            followup_sha_usable: false,
            mechanical_escalate_full: false,
            mechanical_escalation_reason: "",
          },
        });
        await expectRejectsWith(
          runValidator(
            cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(headSha, baseSha),
          ),
          "follow-up usability does not match git",
        );

        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
          ...initialScope(baseSha, headSha),
          mode: "follow-up",
          last_reviewed_sha: firstSha,
          candidate_narrow_range: `${firstSha}..HEAD`,
          selection_reason: "Public API changes require full follow-up review.",
          escalation_reasons: ["public-api"],
          prior_context: {
            kind: "branch-findings",
            path: ".ephemeral/topic-findings.json",
          },
          mechanical_facts: {
            changed_file_count: 1,
            followup_sha_usable: true,
            mechanical_escalate_full: true,
            mechanical_escalation_reason: "file-count",
          },
        });
        await expectRejectsWith(
          runValidator(
            cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(headSha, baseSha),
          ),
          "mechanical escalation does not match git",
        );

        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
          ...narrowScope(baseSha, firstSha, headSha),
          escalation_reasons: ["public-api"],
        });
        await expectRejectsWith(
          runValidator(
            cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(headSha, baseSha),
          ),
          "narrow scope cannot contain escalation reasons",
        );

        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
          ...narrowScope(baseSha, firstSha, headSha),
          semantic_decision: {
            checked: false,
            ambiguous: false,
            notes: "",
          },
        });
        await expectRejectsWith(
          runValidator(
            cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(headSha, baseSha),
          ),
          "semantic decision must be checked",
        );

        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
          ...narrowScope(baseSha, firstSha, headSha),
          language_hints: ["rs"],
        });
        await expectRejectsWith(
          runValidator(
            cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(headSha, baseSha),
          ),
          "language hints do not match selected range",
        );
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects unusable follow-up SHA and wrong narrow range", async () => {
      const { cwd, baseSha, firstSha, headSha } = await makeGitWorkspace();
      try {
        const badSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
          ...initialScope(baseSha, headSha),
          mode: "follow-up",
          selection_reason:
            "Unusable last-reviewed SHA escalates to the full review range.",
          escalation_reasons: ["last-reviewed-unusable"],
          last_reviewed_sha: badSha,
          candidate_narrow_range: `${baseSha}...HEAD`,
          prior_context: {
            kind: "branch-findings",
            path: ".ephemeral/topic-findings.json",
          },
          mechanical_facts: {
            changed_file_count: 1,
            followup_sha_usable: false,
            mechanical_escalate_full: true,
            mechanical_escalation_reason: "last-reviewed-unusable",
          },
        });
        await expect(
          runValidator(
            cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(headSha, baseSha),
          ),
        ).resolves.toMatchObject({ stdout: "" });

        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
          ...initialScope(baseSha, headSha),
          mode: "follow-up",
          selection_reason:
            "Unusable last-reviewed SHA escalates to the full review range.",
          escalation_reasons: ["last-reviewed-unusable"],
          last_reviewed_sha: badSha,
          candidate_narrow_range: `${badSha}..HEAD`,
          prior_context: {
            kind: "branch-findings",
            path: ".ephemeral/topic-findings.json",
          },
          mechanical_facts: {
            changed_file_count: 1,
            followup_sha_usable: false,
            mechanical_escalate_full: true,
            mechanical_escalation_reason: "last-reviewed-unusable",
          },
        });
        await expectRejectsWith(
          runValidator(
            cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(headSha, baseSha),
          ),
          "unusable follow-up scope must use full range",
        );

        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
          ...narrowScope(baseSha, firstSha, headSha),
          last_reviewed_sha: badSha,
          selected_range: `${badSha}..HEAD`,
          candidate_narrow_range: `${badSha}..HEAD`,
          mechanical_facts: {
            changed_file_count: 1,
            followup_sha_usable: false,
            mechanical_escalate_full: false,
            mechanical_escalation_reason: "",
          },
        });
        await expectRejectsWith(
          runValidator(
            cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(headSha, baseSha),
          ),
          "narrow scope requires usable follow-up sha",
        );

        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
          ...narrowScope(baseSha, firstSha, headSha),
          selected_range: `${baseSha}..HEAD`,
        });
        await expectRejectsWith(
          runValidator(
            cwd,
            "validate-scope-decision",
            branchFollowupScopeArgs(headSha, baseSha),
          ),
          "narrow scope must use last-reviewed-sha..HEAD",
        );
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("validates prior-thread timestamps, model eligibility, dropped shape, and ranges", async () => {
      const { cwd, headSha } = await makeGitWorkspace();
      const threadsPath = ".ephemeral/topic-prior-threads.json";
      const priorThreadArgs = [
        "--surface",
        "pr-review",
        "--head-sha",
        headSha,
        "--prior-threads-file",
        threadsPath,
        "--expected-schema",
        "pr-review/prior-threads/v1",
        "--provider",
        "github",
      ];
      try {
        await writeJson(cwd, threadsPath, priorThreadsEnvelope(headSha));
        await expect(
          runValidator(cwd, "validate-prior-threads", priorThreadArgs),
        ).resolves.toMatchObject({ stdout: "" });

        await writeFile(
          path.join(cwd, threadsPath),
          `${JSON.stringify(priorThreadsEnvelope(headSha))}\n${JSON.stringify(
            priorThreadsEnvelope(headSha, { threads: [] }),
          )}\n`,
        );
        await expectRejectsWith(
          runValidator(cwd, "validate-prior-threads", priorThreadArgs),
          "prior-thread shape validation failed",
        );

        await writeJson(
          cwd,
          threadsPath,
          priorThreadsEnvelope(headSha, {
            threads: [
              priorThread({
                comments: [
                  {
                    author: "reviewer",
                    created_at: "not-a-time",
                    updated_at: "2026-01-01T00:00:01Z",
                    body: "Please check this.",
                    is_bot: false,
                  },
                ],
              }),
            ],
          }),
        );
        await expectRejectsWith(
          runValidator(cwd, "validate-prior-threads", priorThreadArgs),
          "prior-thread timestamp validation failed",
        );

        await writeJson(
          cwd,
          threadsPath,
          priorThreadsEnvelope(headSha, {
            threads: [
              priorThread({
                comments: [
                  {
                    author: "reviewer",
                    created_at: "2026-13-01T00:00:00Z",
                    updated_at: "2026-02-30T00:00:01Z",
                    body: "Please check this.",
                    is_bot: false,
                  },
                ],
              }),
            ],
          }),
        );
        await expectRejectsWith(
          runValidator(cwd, "validate-prior-threads", priorThreadArgs),
          "prior-thread timestamp validation failed",
        );

        await writeJson(
          cwd,
          threadsPath,
          priorThreadsEnvelope(headSha, {
            threads: [
              priorThread({
                classification: "conversation",
                model_context: "include",
              }),
            ],
          }),
        );
        await expectRejectsWith(
          runValidator(cwd, "validate-prior-threads", priorThreadArgs),
          "prior-thread model-context eligibility validation failed",
        );

        await writeJson(
          cwd,
          threadsPath,
          priorThreadsEnvelope(headSha, {
            dropped: [
              {
                thread_id: "PRRT_kwDOActionable",
                classification: "actionable",
                reason: "Actionable threads must remain model-eligible.",
              },
            ],
          }),
        );
        await expectRejectsWith(
          runValidator(cwd, "validate-prior-threads", priorThreadArgs),
          "dropped-thread shape validation failed",
        );

        await writeJson(
          cwd,
          threadsPath,
          priorThreadsEnvelope(headSha, {
            dropped: [{ thread_id: "PRRT_kwDODropped", reason: 1 }],
          }),
        );
        await expectRejectsWith(
          runValidator(cwd, "validate-prior-threads", priorThreadArgs),
          "dropped-thread shape validation failed",
        );

        await writeJson(
          cwd,
          threadsPath,
          priorThreadsEnvelope(headSha, {
            threads: [priorThread({ line: 1, start_line: 2 })],
          }),
        );
        await expectRejectsWith(
          runValidator(cwd, "validate-prior-threads", priorThreadArgs),
          "prior-thread line range is inverted",
        );
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("validates diff anchors from findings against the bound scope decision", async () => {
      const { cwd, baseSha, headSha } = await makeGitWorkspace();
      try {
        await writeJson(
          cwd,
          ".ephemeral/topic-scope-decision.json",
          initialScope(baseSha, headSha, "pr-review"),
        );
        await writeJson(cwd, ".ephemeral/topic-findings.json", {
          ...findingsEnvelope(),
          carry_forward: [
            {
              path: "README.md",
              line: 1,
              start_line: null,
              severity: "Blocking",
              category: "Logic",
              critic: "VALID",
              anchor: "natural",
              why: "Carry forward still applies.",
              recommendation: "Keep the comment.",
              body: "Carry-forward body.",
            },
          ],
        });
        await expect(
          runValidator(cwd, "validate-diff-anchors", [
            ...scopeArgs(
              headSha,
              baseSha,
              ".ephemeral/topic-scope-decision.json",
              "pr-review",
            ),
            "--findings-file",
            ".ephemeral/topic-findings.json",
          ]),
        ).resolves.toMatchObject({ stdout: "" });

        await writeJson(cwd, ".ephemeral/topic-findings.json", {
          ...findingsEnvelope(),
          findings: [
            {
              path: "README.md",
              line: 1,
              start_line: null,
              severity: "Blocking",
              category: "Logic",
              critic: "VALID",
              anchor: "natural",
              why: "README was not in the review diff.",
              recommendation: "Do not anchor there.",
              body: "Bad anchor.",
            },
          ],
        });
        await expectRejectsWith(
          runValidator(cwd, "validate-diff-anchors", [
            ...scopeArgs(
              headSha,
              baseSha,
              ".ephemeral/topic-scope-decision.json",
              "pr-review",
            ),
            "--findings-file",
            ".ephemeral/topic-findings.json",
          ]),
          "inline anchor is outside selected review diff",
        );
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("does not validate carry-forward anchors against a narrow follow-up diff", async () => {
      const { cwd, baseSha, firstSha, headSha } = await makeGitWorkspace();
      try {
        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
          ...narrowScope(baseSha, firstSha, headSha),
          schema: "pr-review/scope-decision/v1",
          surface: "pr-review",
          prior_context: {
            kind: "github-prior-threads",
            path: ".ephemeral/topic-prior-threads.json",
          },
        });
        await writeJson(cwd, ".ephemeral/topic-findings.json", {
          ...findingsEnvelope(),
          carry_forward: [
            {
              path: "README.md",
              line: 1,
              start_line: null,
              severity: "Blocking",
              category: "Logic",
              critic: "VALID",
              anchor: "natural",
              why: "Carry forward still applies.",
              recommendation: "Keep the comment.",
              body: "Carry-forward body.",
            },
          ],
        });
        await writeFile(path.join(cwd, ".ephemeral/review-body.md"), "Body\n");
        await writeJson(cwd, ".ephemeral/topic-review-payload.json", {
          commit_id: headSha,
          event: "COMMENT",
          body: "Body",
          comments: [
            {
              path: "src/app.ts",
              line: 2,
              side: "RIGHT",
              body: "Blocking: The new export needs review.",
            },
          ],
        });

        await expect(
          runValidator(cwd, "compare-approved-payload", [
            ...scopeArgs(
              headSha,
              baseSha,
              ".ephemeral/topic-scope-decision.json",
              "pr-review",
              "github-prior-threads",
              ".ephemeral/topic-prior-threads.json",
            ),
            "--findings-file",
            ".ephemeral/topic-findings.json",
            "--review-body-file",
            ".ephemeral/review-body.md",
            "--review-payload-file",
            ".ephemeral/topic-review-payload.json",
            "--review-event",
            "COMMENT",
          ]),
        ).resolves.toMatchObject({
          stdout: expect.stringContaining('"commit_id"'),
        });

        await writeJson(cwd, ".ephemeral/topic-findings.json", {
          ...findingsEnvelope(),
          findings: [
            {
              path: "README.md",
              line: 1,
              start_line: null,
              severity: "Blocking",
              category: "Logic",
              critic: "VALID",
              anchor: "natural",
              why: "README was not in the narrow review diff.",
              recommendation: "Do not anchor there.",
              body: "Bad current anchor.",
            },
          ],
          carry_forward: [],
        });
        await writeJson(cwd, ".ephemeral/topic-review-payload.json", {
          commit_id: headSha,
          event: "COMMENT",
          body: "Body",
          comments: [
            {
              path: "README.md",
              line: 1,
              side: "RIGHT",
              body: "Bad current anchor.",
            },
          ],
        });

        await expectRejectsWith(
          runValidator(cwd, "compare-approved-payload", [
            ...scopeArgs(
              headSha,
              baseSha,
              ".ephemeral/topic-scope-decision.json",
              "pr-review",
              "github-prior-threads",
              ".ephemeral/topic-prior-threads.json",
            ),
            "--findings-file",
            ".ephemeral/topic-findings.json",
            "--review-body-file",
            ".ephemeral/review-body.md",
            "--review-payload-file",
            ".ephemeral/topic-review-payload.json",
            "--review-event",
            "COMMENT",
          ]),
          "inline anchor is outside selected review diff",
        );
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("validates diff anchors against the review head sha when checkout has advanced", async () => {
      const { cwd, baseSha, headSha: reviewHeadSha } = await makeGitWorkspace();
      try {
        await writeFile(
          path.join(cwd, "src/app.ts"),
          "export const value = 9;\n",
        );
        await execFileAsync("git", ["add", "."], { cwd });
        await execFileAsync("git", ["commit", "-m", "test: rewrite app"], {
          cwd,
        });
        const laterHeadSha = await git(cwd, "rev-parse", "HEAD");

        await writeJson(
          cwd,
          ".ephemeral/topic-scope-decision.json",
          initialScope(baseSha, reviewHeadSha, "pr-review"),
        );
        await writeJson(cwd, ".ephemeral/topic-findings.json", {
          ...findingsEnvelope(),
          findings: [finding()],
        });

        await expect(
          runValidator(cwd, "validate-diff-anchors", [
            ...scopeArgs(
              reviewHeadSha,
              baseSha,
              ".ephemeral/topic-scope-decision.json",
              "pr-review",
            ),
            "--findings-file",
            ".ephemeral/topic-findings.json",
          ]),
        ).resolves.toMatchObject({ stdout: "" });
        expect(laterHeadSha).not.toBe(reviewHeadSha);
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects multiline diff anchors that cross selected diff hunks", async () => {
      const { cwd, baseSha, headSha } = await makeGitWorkspace();
      try {
        const lastReviewedSha = headSha;
        await writeFile(
          path.join(cwd, "src/multihunk.ts"),
          `${Array.from(
            { length: 24 },
            (_, index) => `export const v${index} = ${index};`,
          ).join("\n")}\n`,
        );
        await execFileAsync("git", ["add", "."], { cwd });
        await execFileAsync("git", ["commit", "-m", "test: add multihunk"], {
          cwd,
        });
        const beforeMultihunkChange = await git(cwd, "rev-parse", "HEAD");
        await writeFile(
          path.join(cwd, "src/multihunk.ts"),
          `${Array.from({ length: 24 }, (_, index) => {
            if (index === 1) {
              return "export const v1 = 101;";
            }
            if (index === 17) {
              return "export const v17 = 117;";
            }
            return `export const v${index} = ${index};`;
          }).join("\n")}\n`,
        );
        await execFileAsync("git", ["add", "."], { cwd });
        await execFileAsync("git", ["commit", "-m", "test: split hunks"], {
          cwd,
        });
        const newHead = await git(cwd, "rev-parse", "HEAD");
        await writeJson(cwd, ".ephemeral/topic-scope-decision.json", {
          ...narrowScope(baseSha, beforeMultihunkChange, newHead),
          schema: "pr-review/scope-decision/v1",
          surface: "pr-review",
          changed_files: ["src/multihunk.ts"],
          selected_range: `${beforeMultihunkChange}..HEAD`,
          candidate_narrow_range: `${beforeMultihunkChange}..HEAD`,
          prior_context: {
            kind: "github-prior-threads",
            path: ".ephemeral/topic-prior-threads.json",
          },
        });
        await writeJson(cwd, ".ephemeral/topic-findings.json", {
          ...findingsEnvelope(),
          findings: [
            finding({
              path: "src/multihunk.ts",
              line: 3,
              start_line: null,
            }),
          ],
        });
        await expect(
          runValidator(cwd, "validate-diff-anchors", [
            ...scopeArgs(
              newHead,
              baseSha,
              ".ephemeral/topic-scope-decision.json",
              "pr-review",
              "github-prior-threads",
              ".ephemeral/topic-prior-threads.json",
            ),
            "--findings-file",
            ".ephemeral/topic-findings.json",
          ]),
        ).resolves.toMatchObject({ stdout: "" });

        await writeJson(cwd, ".ephemeral/topic-findings.json", {
          ...findingsEnvelope(),
          findings: [
            finding({
              path: "src/multihunk.ts",
              start_line: 2,
              line: 18,
            }),
          ],
        });

        await expectRejectsWith(
          runValidator(cwd, "validate-diff-anchors", [
            ...scopeArgs(
              newHead,
              baseSha,
              ".ephemeral/topic-scope-decision.json",
              "pr-review",
              "github-prior-threads",
              ".ephemeral/topic-prior-threads.json",
            ),
            "--findings-file",
            ".ephemeral/topic-findings.json",
          ]),
          "inline anchor range crosses selected review diff hunks",
        );
        expect(lastReviewedSha).not.toBe(beforeMultihunkChange);
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("compares approved payloads against findings and review body inputs", async () => {
      const { cwd, baseSha, headSha } = await makeGitWorkspace();
      try {
        await writeJson(
          cwd,
          ".ephemeral/topic-scope-decision.json",
          initialScope(baseSha, headSha, "pr-review"),
        );
        await writeJson(cwd, ".ephemeral/topic-findings.json", {
          ...findingsEnvelope(),
          carry_forward: [
            {
              path: "src/app.ts",
              line: 2,
              start_line: null,
              severity: "Blocking",
              category: "Logic",
              critic: "VALID",
              anchor: "missing-file",
              why: "Carry forward still applies.",
              recommendation: "Keep the comment.",
              body: "Carry-forward body.",
            },
          ],
        });
        await writeFile(path.join(cwd, ".ephemeral/review-body.md"), "Body\n");
        await writeFile(path.join(cwd, "review-body.md"), "Body\n");
        await writeJson(cwd, ".ephemeral/topic-review-payload.json", {
          commit_id: headSha,
          event: "COMMENT",
          body: "Body",
          comments: [
            {
              path: "src/app.ts",
              line: 2,
              side: "RIGHT",
              body: "Blocking: The new export needs review.",
            },
          ],
        });

        await expect(
          runValidator(cwd, "compare-approved-payload", [
            ...scopeArgs(
              headSha,
              baseSha,
              ".ephemeral/topic-scope-decision.json",
              "pr-review",
            ),
            "--findings-file",
            ".ephemeral/topic-findings.json",
            "--review-body-file",
            ".ephemeral/review-body.md",
            "--review-payload-file",
            ".ephemeral/topic-review-payload.json",
            "--review-event",
            "COMMENT",
          ]),
        ).resolves.toMatchObject({
          stdout: expect.stringContaining('"commit_id"'),
        });

        await writeJson(cwd, ".ephemeral/topic-review-payload.json", {
          commit_id: headSha,
          event: "COMMENT",
          body: "Body",
          comments: [
            {
              path: "src/app.ts",
              line: 2,
              side: "RIGHT",
              body: "Blocking: The new export needs review.",
            },
            {
              path: "src/app.ts",
              line: 2,
              side: "RIGHT",
              body: "Missing-file finding (no natural anchor - see body):\n\nCarry-forward body.",
            },
          ],
        });
        await expectRejectsWith(
          runValidator(cwd, "compare-approved-payload", [
            ...scopeArgs(
              headSha,
              baseSha,
              ".ephemeral/topic-scope-decision.json",
              "pr-review",
            ),
            "--findings-file",
            ".ephemeral/topic-findings.json",
            "--review-body-file",
            ".ephemeral/review-body.md",
            "--review-payload-file",
            ".ephemeral/topic-review-payload.json",
            "--review-event",
            "COMMENT",
          ]),
          "approved review payload does not match generated payload",
        );

        await writeJson(cwd, ".ephemeral/topic-review-payload.json", {
          commit_id: headSha,
          event: "COMMENT",
          body: "Body",
          comments: [
            {
              path: "src/app.ts",
              line: 2,
              side: "RIGHT",
              body: "Blocking: The new export needs review.",
            },
          ],
        });

        await expect(
          runValidator(cwd, "compare-approved-payload", [
            ...scopeArgs(
              headSha,
              baseSha,
              ".ephemeral/topic-scope-decision.json",
              "pr-review",
            ),
            "--findings-file",
            ".ephemeral/topic-findings.json",
            "--review-body-file",
            "review-body.md",
            "--review-payload-file",
            ".ephemeral/topic-review-payload.json",
            "--review-event",
            "COMMENT",
          ]),
        ).resolves.toMatchObject({
          stdout: expect.stringContaining('"commit_id"'),
        });

        for (const unsafeReviewBody of [
          "../review-body.md",
          path.join(cwd, "review-body.md"),
        ]) {
          await expectRejectsWith(
            runValidator(cwd, "compare-approved-payload", [
              ...scopeArgs(
                headSha,
                baseSha,
                ".ephemeral/topic-scope-decision.json",
                "pr-review",
              ),
              "--findings-file",
              ".ephemeral/topic-findings.json",
              "--review-body-file",
              unsafeReviewBody,
              "--review-payload-file",
              ".ephemeral/topic-review-payload.json",
              "--review-event",
              "COMMENT",
            ]),
            "review body path validation failed",
          );
        }

        await writeJson(cwd, ".ephemeral/topic-findings.json", {
          schema: "play-review/findings/v1",
          findings: [
            {
              path: "src/app.ts",
              line: 2,
              severity: "Blocking",
              category: "Logic",
              anchor: "natural",
              why: "",
              recommendation: "",
              body: "",
            },
            {
              path: "src/app.ts",
              line: 2,
              severity: "Nit",
              category: "Documentation",
              critic: null,
              anchor: "natural",
              why: "",
              recommendation: "",
              body: "",
            },
          ],
          carry_forward: [],
        });
        await writeJson(cwd, ".ephemeral/topic-review-payload.json", {
          commit_id: headSha,
          event: "COMMENT",
          body: "Body",
          comments: [
            {
              path: "src/app.ts",
              line: 2,
              side: "RIGHT",
              body: "",
            },
            {
              path: "src/app.ts",
              line: 2,
              side: "RIGHT",
              body: "",
            },
          ],
        });
        await expect(
          runValidator(cwd, "compare-approved-payload", [
            ...scopeArgs(
              headSha,
              baseSha,
              ".ephemeral/topic-scope-decision.json",
              "pr-review",
            ),
            "--findings-file",
            ".ephemeral/topic-findings.json",
            "--review-body-file",
            ".ephemeral/review-body.md",
            "--review-payload-file",
            ".ephemeral/topic-review-payload.json",
            "--review-event",
            "COMMENT",
          ]),
        ).resolves.toMatchObject({
          stdout: expect.stringContaining('"comments"'),
        });

        await writeJson(cwd, ".ephemeral/topic-findings.json", {
          ...findingsEnvelope(),
          findings: [
            {
              path: "README.md",
              line: 1,
              start_line: null,
              severity: "Blocking",
              category: "Logic",
              critic: "VALID",
              anchor: "natural",
              why: "README was not in the review diff.",
              recommendation: "Do not anchor there.",
              body: "Bad anchor.",
            },
          ],
          carry_forward: [],
        });
        await writeJson(cwd, ".ephemeral/topic-review-payload.json", {
          commit_id: headSha,
          event: "COMMENT",
          body: "Body",
          comments: [
            {
              path: "README.md",
              line: 1,
              side: "RIGHT",
              body: "Bad anchor.",
            },
          ],
        });
        await expectRejectsWith(
          runValidator(cwd, "compare-approved-payload", [
            ...scopeArgs(
              headSha,
              baseSha,
              ".ephemeral/topic-scope-decision.json",
              "pr-review",
            ),
            "--findings-file",
            ".ephemeral/topic-findings.json",
            "--review-body-file",
            ".ephemeral/review-body.md",
            "--review-payload-file",
            ".ephemeral/topic-review-payload.json",
            "--review-event",
            "COMMENT",
          ]),
          "inline anchor is outside selected review diff",
        );

        await writeJson(cwd, ".ephemeral/topic-findings.json", {
          ...findingsEnvelope(),
          carry_forward: [
            {
              path: "src/app.ts",
              line: 2,
              start_line: null,
              severity: "Blocking",
              category: "Logic",
              critic: "VALID",
              anchor: "missing-file",
              why: "Carry forward still applies.",
              recommendation: "Keep the comment.",
              body: "Carry-forward body.",
            },
          ],
        });

        await writeJson(cwd, ".ephemeral/topic-review-payload.json", {
          commit_id: headSha,
          event: "COMMENT",
          body: "Edited\n",
          comments: [],
        });
        await expectRejectsWith(
          runValidator(cwd, "compare-approved-payload", [
            ...scopeArgs(
              headSha,
              baseSha,
              ".ephemeral/topic-scope-decision.json",
              "pr-review",
            ),
            "--findings-file",
            ".ephemeral/topic-findings.json",
            "--review-body-file",
            ".ephemeral/review-body.md",
            "--review-payload-file",
            ".ephemeral/topic-review-payload.json",
            "--review-event",
            "COMMENT",
          ]),
          "approved review payload does not match generated payload",
        );

        await writeFile(
          path.join(cwd, ".ephemeral/topic-review-payload.json"),
          `${JSON.stringify({
            commit_id: headSha,
            event: "COMMENT",
            body: "Body",
            comments: [],
          })}\n${JSON.stringify({ extra: true })}\n`,
        );
        await expectRejectsWith(
          runValidator(cwd, "compare-approved-payload", [
            ...scopeArgs(
              headSha,
              baseSha,
              ".ephemeral/topic-scope-decision.json",
              "pr-review",
            ),
            "--findings-file",
            ".ephemeral/topic-findings.json",
            "--review-body-file",
            ".ephemeral/review-body.md",
            "--review-payload-file",
            ".ephemeral/topic-review-payload.json",
            "--review-event",
            "COMMENT",
          ]),
          "review payload JSON validation failed",
        );

        await writeJson(cwd, ".ephemeral/topic-review-payload.json", [
          {
            commit_id: headSha,
            event: "COMMENT",
            body: "Body",
            comments: [],
          },
        ]);
        await expectRejectsWith(
          runValidator(cwd, "compare-approved-payload", [
            ...scopeArgs(
              headSha,
              baseSha,
              ".ephemeral/topic-scope-decision.json",
              "pr-review",
            ),
            "--findings-file",
            ".ephemeral/topic-findings.json",
            "--review-body-file",
            ".ephemeral/review-body.md",
            "--review-payload-file",
            ".ephemeral/topic-review-payload.json",
            "--review-event",
            "COMMENT",
          ]),
          "review payload JSON validation failed",
        );

        await writeJson(cwd, ".ephemeral/topic-review-payload.json", {
          commit_id: headSha,
          event: "COMMENT",
          body: "Body",
          comments: [
            {
              path: "src/app.ts",
              line: 2,
              side: "RIGHT",
              body: "Blocking: The new export needs review.",
            },
          ],
        });

        await writeFile(
          path.join(cwd, ".ephemeral/topic-findings.json"),
          `${JSON.stringify(findingsEnvelope())}\n${JSON.stringify(
            findingsEnvelope(),
          )}\n`,
        );
        await expectRejectsWith(
          runValidator(cwd, "compare-approved-payload", [
            ...scopeArgs(
              headSha,
              baseSha,
              ".ephemeral/topic-scope-decision.json",
              "pr-review",
            ),
            "--findings-file",
            ".ephemeral/topic-findings.json",
            "--review-body-file",
            ".ephemeral/review-body.md",
            "--review-payload-file",
            ".ephemeral/topic-review-payload.json",
            "--review-event",
            "COMMENT",
          ]),
          "findings envelope JSON validation failed",
        );
        await writeJson(cwd, ".ephemeral/topic-findings.json", {
          ...findingsEnvelope(),
          carry_forward: [
            {
              path: "src/app.ts",
              line: 2,
              start_line: null,
              severity: "Blocking",
              category: "Logic",
              critic: "VALID",
              anchor: "missing-file",
              why: "Carry forward still applies.",
              recommendation: "Keep the comment.",
              body: "Carry-forward body.",
            },
          ],
        });

        for (const malformedFindings of [
          {
            ...findingsEnvelope(),
            findings: [finding({ anchor: "bogus" })],
          },
          {
            ...findingsEnvelope(),
            findings: [finding({ category: "Bogus" })],
          },
          {
            ...findingsEnvelope(),
            findings: [
              Object.fromEntries(
                Object.entries(finding()).filter(([key]) => key !== "why"),
              ),
            ],
          },
          {
            ...findingsEnvelope(),
            findings: [finding({ start_line: 3 })],
          },
          {
            ...findingsEnvelope(),
            findings: [],
            carry_forward: [finding({ anchor: "bogus" })],
          },
        ]) {
          await writeJson(
            cwd,
            ".ephemeral/topic-findings.json",
            malformedFindings,
          );
          await expectRejectsWith(
            runValidator(cwd, "compare-approved-payload", [
              ...scopeArgs(
                headSha,
                baseSha,
                ".ephemeral/topic-scope-decision.json",
                "pr-review",
              ),
              "--findings-file",
              ".ephemeral/topic-findings.json",
              "--review-body-file",
              ".ephemeral/review-body.md",
              "--review-payload-file",
              ".ephemeral/topic-review-payload.json",
              "--review-event",
              "COMMENT",
            ]),
            "findings envelope validation failed",
          );
        }
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects unsafe paths and missing explicit flags", async () => {
      const { cwd, baseSha, headSha } = await makeGitWorkspace();
      try {
        await expectRejectsWith(
          runValidator(cwd, "validate-scope-decision", [
            ...scopeArgs(headSha, baseSha, "../scope.json"),
          ]),
          "path traversal",
        );
        await expectRejectsWith(
          runValidator(cwd, "validate-scope-decision", ["--head-sha", headSha]),
          "--scope-decision-file is required",
        );
        await expectRejectsWith(
          runValidator(cwd, "validate-scope-decision", [
            "--surface",
            "branch-review",
            "--head-sha",
            headSha,
            "--base-ref",
            baseSha,
            "--scope-decision-file",
            ".ephemeral/topic-scope-decision.json",
            "--expected-schema",
            "branch-review/scope-decision/v1",
            "--expected-prior-context-kind",
            "none",
            "--governed-path-pattern",
            "^(docs/adr/)",
            "--max-narrow-changed-files",
            "5",
          ]),
          "--expected-prior-context-path is required",
        );
        await expectRejectsWith(
          runValidator(cwd, "validate-scope-decision", [
            "--surface",
            "branch-review",
            "--head-sha",
            headSha,
            "--scope-decision",
            ".ephemeral/topic-scope-decision.json",
          ]),
          "unknown review-artifacts argument: --scope-decision",
        );
      } finally {
        await cleanupTempDir(cwd);
      }
    });
  },
);

describe("play-validate-review-artifacts validator packaging diagnostics", () => {
  it("fixture adapter resolves source-layout sibling support validator", async () => {
    const cwd = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-validator-source-layout-"),
    );
    try {
      const adapter = path.join(cwd, "skills/branch-review/scripts/adapter.sh");
      await writeFixtureConsumerAdapter(adapter);
      await writeMarkerValidator(cwd, "source-layout");

      await expect(
        execFileAsync("bash", [adapter], { cwd }),
      ).resolves.toMatchObject({ stdout: "source-layout\n" });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("fixture adapter resolves generated-layout sibling support validator", async () => {
    const cwd = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-validator-generated-layout-"),
    );
    try {
      const adapter = path.join(
        cwd,
        "generated/codex/skills/branch-review/scripts/adapter.sh",
      );
      await writeFixtureConsumerAdapter(adapter);
      await writeMarkerValidator(
        cwd,
        "generated-layout",
        "generated/codex/skills/play-validate-review-artifacts/scripts/review-artifacts.sh",
      );

      await expect(
        execFileAsync("bash", [adapter], { cwd }),
      ).resolves.toMatchObject({ stdout: "generated-layout\n" });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("fixture adapter resolves installed-style sibling support validator", async () => {
    const cwd = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-validator-installed-layout-"),
    );
    try {
      const adapter = path.join(
        cwd,
        ".codex/skills/branch-review/scripts/adapter.sh",
      );
      await writeFixtureConsumerAdapter(adapter);
      await writeMarkerValidator(
        cwd,
        "installed-layout",
        ".codex/skills/play-validate-review-artifacts/scripts/review-artifacts.sh",
      );

      await expect(
        execFileAsync("bash", [adapter], { cwd }),
      ).resolves.toMatchObject({ stdout: "installed-layout\n" });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("fixture adapter resolves explicit support validator override", async () => {
    const cwd = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-validator-override-"),
    );
    try {
      const adapter = path.join(cwd, "skills/branch-review/scripts/adapter.sh");
      await writeFixtureConsumerAdapter(adapter);
      const override = await writeMarkerValidator(
        cwd,
        "override-layout",
        ".ephemeral/custom-review-artifacts.sh",
      );

      await expect(
        execFileAsync("bash", [adapter], {
          cwd,
          env: {
            ...process.env,
            PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: override,
          },
        }),
      ).resolves.toMatchObject({ stdout: "override-layout\n" });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("fixture adapter fails loudly when the support validator is missing", async () => {
    const cwd = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-validator-missing-"),
    );
    try {
      const adapter = path.join(cwd, "skills/branch-review/scripts/adapter.sh");
      await writeFixtureConsumerAdapter(adapter);

      await expectRejectsWith(
        execFileAsync("bash", [adapter, "validate-scope-decision"], { cwd }),
        "play-validate-review-artifacts validator missing",
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
