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

function scopeArgs(headSha: string, scopeDecision = ".ephemeral/scope.json") {
  return [
    "--surface",
    "branch-review",
    "--head-sha",
    headSha,
    "--scope-decision",
    scopeDecision,
    "--expected-schema",
    "play-review/scope-decision/v1",
    "--prior-context-kind",
    "none",
    "--governed-path-pattern",
    "^(docs/(adr|arch|product-requirements|specs|guidelines)/|MAP\\.md$|AGENTS\\.md$|CONTRIBUTING\\.md$)",
    "--max-narrow-changed-files",
    "5",
  ];
}

function initialScope(baseSha: string, headSha: string): JsonObject {
  return {
    schema: "play-review/scope-decision/v1",
    surface: "branch-review",
    head_sha: headSha,
    base_ref: baseSha,
    full_diff_range: `${baseSha}...HEAD`,
    active_diff_range: `${baseSha}...HEAD`,
    last_reviewed_sha: null,
    is_followup_narrow: false,
    changed_files: ["src/app.ts"],
    changed_file_count: 1,
    language_hints: ["ts"],
    escalation: {
      escalate_full: true,
      reasons: ["not-followup"],
      semantic_scope: "clear",
    },
    prior_context: { kind: "none", path: null },
  };
}

function narrowScope(
  baseSha: string,
  firstSha: string,
  headSha: string,
): JsonObject {
  return {
    ...initialScope(baseSha, headSha),
    full_diff_range: `${baseSha}...HEAD`,
    active_diff_range: `${firstSha}..HEAD`,
    last_reviewed_sha: firstSha,
    is_followup_narrow: true,
    escalation: {
      escalate_full: false,
      reasons: [],
      semantic_scope: "clear",
    },
  };
}

function findingsEnvelope(): JsonObject {
  return {
    schema: "play-review/findings/v1",
    findings: [
      {
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
      },
    ],
    carry_forward: [],
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

describe.skipIf(!jqAvailable)(
  "play-validate-review-artifacts validator",
  () => {
    it("accepts a valid initial full scope decision", async () => {
      const { cwd, baseSha, headSha } = await makeGitWorkspace();
      try {
        await writeJson(
          cwd,
          ".ephemeral/scope.json",
          initialScope(baseSha, headSha),
        );

        await expect(
          runValidator(cwd, "validate-scope-decision", scopeArgs(headSha)),
        ).resolves.toMatchObject({ stdout: "" });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("accepts a valid narrow follow-up scope decision", async () => {
      const { cwd, baseSha, firstSha, headSha } = await makeGitWorkspace();
      try {
        await writeJson(
          cwd,
          ".ephemeral/scope.json",
          narrowScope(baseSha, firstSha, headSha),
        );

        await expect(
          runValidator(cwd, "validate-scope-decision", scopeArgs(headSha)),
        ).resolves.toMatchObject({ stdout: "" });
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
          last_reviewed_sha: firstSha,
          changed_files: [
            "src/app.ts",
            ...Array.from({ length: 6 }, (_, index) => `src/file-${index}.ts`),
          ],
          changed_file_count: 7,
          language_hints: ["ts"],
          escalation: {
            escalate_full: true,
            reasons: ["file-count"],
            semantic_scope: "clear",
          },
        };
        await writeJson(cwd, ".ephemeral/scope.json", scope);

        await expect(
          runValidator(cwd, "validate-scope-decision", scopeArgs(newHead)),
        ).resolves.toMatchObject({ stdout: "" });
        expect(headSha).not.toBe(newHead);
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
        await writeJson(governed.cwd, ".ephemeral/scope.json", {
          ...initialScope(governed.baseSha, headSha),
          last_reviewed_sha: governed.firstSha,
          changed_files: ["docs/adr/adr-9999.md", "src/app.ts"],
          changed_file_count: 2,
          language_hints: ["md", "ts"],
          escalation: {
            escalate_full: true,
            reasons: ["governance-path"],
            semantic_scope: "clear",
          },
        });
        await expect(
          runValidator(
            governed.cwd,
            "validate-scope-decision",
            scopeArgs(headSha),
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
        await writeJson(configured.cwd, ".ephemeral/scope.json", {
          ...initialScope(configured.baseSha, headSha),
          last_reviewed_sha: configured.firstSha,
          changed_files: ["src/app.ts", "src/generated.ts"],
          changed_file_count: 2,
          language_hints: ["ts"],
          escalation: {
            escalate_full: true,
            reasons: ["configured-path"],
            semantic_scope: "clear",
          },
        });
        await expect(
          runValidator(configured.cwd, "validate-scope-decision", [
            ...scopeArgs(headSha),
            "--configured-path-pattern",
            "generated",
          ]),
        ).resolves.toMatchObject({ stdout: "" });
      } finally {
        await cleanupTempDir(configured.cwd);
      }
    });

    it("requires ambiguous semantic scope to be full escalation unless explicitly allowed", async () => {
      const { cwd, baseSha, firstSha, headSha } = await makeGitWorkspace();
      try {
        await writeJson(cwd, ".ephemeral/scope.json", {
          ...narrowScope(baseSha, firstSha, headSha),
          escalation: {
            escalate_full: false,
            reasons: [],
            semantic_scope: "ambiguous",
          },
        });

        await expectRejectsWith(
          runValidator(cwd, "validate-scope-decision", scopeArgs(headSha)),
          "ambiguous semantic scope requires full escalation",
        );

        await writeJson(cwd, ".ephemeral/scope.json", {
          ...initialScope(baseSha, headSha),
          last_reviewed_sha: firstSha,
          escalation: {
            escalate_full: true,
            reasons: ["ambiguous-semantic-scope"],
            semantic_scope: "ambiguous",
          },
        });
        await expect(
          runValidator(cwd, "validate-scope-decision", [
            ...scopeArgs(headSha),
            "--allow-ambiguous-full",
            "true",
          ]),
        ).resolves.toMatchObject({ stdout: "" });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects stale refs and contradictory changed-file, count, and language claims", async () => {
      const { cwd, baseSha, firstSha, headSha } = await makeGitWorkspace();
      try {
        await writeJson(cwd, ".ephemeral/scope.json", {
          ...narrowScope(baseSha, firstSha, headSha),
          head_sha: firstSha,
        });
        await expectRejectsWith(
          runValidator(cwd, "validate-scope-decision", scopeArgs(headSha)),
          "scope decision head_sha mismatch",
        );

        await writeJson(cwd, ".ephemeral/scope.json", {
          ...narrowScope(baseSha, firstSha, headSha),
          changed_files: ["src/other.ts"],
        });
        await expectRejectsWith(
          runValidator(cwd, "validate-scope-decision", scopeArgs(headSha)),
          "changed files mismatch",
        );

        await writeJson(cwd, ".ephemeral/scope.json", {
          ...narrowScope(baseSha, firstSha, headSha),
          changed_file_count: 99,
        });
        await expectRejectsWith(
          runValidator(cwd, "validate-scope-decision", scopeArgs(headSha)),
          "changed file count mismatch",
        );

        await writeJson(cwd, ".ephemeral/scope.json", {
          ...narrowScope(baseSha, firstSha, headSha),
          language_hints: ["rs"],
        });
        await expectRejectsWith(
          runValidator(cwd, "validate-scope-decision", scopeArgs(headSha)),
          "language hints mismatch",
        );
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects unusable follow-up SHA and wrong narrow range", async () => {
      const { cwd, baseSha, firstSha, headSha } = await makeGitWorkspace();
      try {
        const badSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        await writeJson(cwd, ".ephemeral/scope.json", {
          ...narrowScope(baseSha, firstSha, headSha),
          last_reviewed_sha: badSha,
          active_diff_range: `${badSha}..HEAD`,
        });
        await expectRejectsWith(
          runValidator(cwd, "validate-scope-decision", scopeArgs(headSha)),
          "last_reviewed_sha is not a usable ancestor",
        );

        await writeJson(cwd, ".ephemeral/scope.json", {
          ...narrowScope(baseSha, firstSha, headSha),
          active_diff_range: `${baseSha}..HEAD`,
        });
        await expectRejectsWith(
          runValidator(cwd, "validate-scope-decision", scopeArgs(headSha)),
          "narrow active_diff_range must be last_reviewed_sha..HEAD",
        );
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("validates prior-thread timestamps, model eligibility, dropped shape, and ranges", async () => {
      const { cwd, headSha } = await makeGitWorkspace();
      const threadsPath = ".ephemeral/prior-threads.json";
      try {
        await writeJson(cwd, threadsPath, {
          schema: "pr-review/prior-threads/v1",
          head_sha: headSha,
          threads: [
            {
              id: "T1",
              path: "src/app.ts",
              line: 2,
              start_line: 1,
              side: "RIGHT",
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:01Z",
              model_context_eligible: true,
              dropped: null,
            },
          ],
        });
        await expect(
          runValidator(cwd, "validate-prior-threads", [
            "--head-sha",
            headSha,
            "--prior-threads",
            threadsPath,
          ]),
        ).resolves.toMatchObject({ stdout: "" });

        await writeJson(cwd, threadsPath, {
          schema: "pr-review/prior-threads/v1",
          head_sha: headSha,
          threads: [
            {
              id: "T1",
              path: "src/app.ts",
              line: 2,
              side: "RIGHT",
              created_at: "not-a-time",
              updated_at: "2026-01-01T00:00:01Z",
              model_context_eligible: true,
              dropped: null,
            },
          ],
        });
        await expectRejectsWith(
          runValidator(cwd, "validate-prior-threads", [
            "--head-sha",
            headSha,
            "--prior-threads",
            threadsPath,
          ]),
          "prior-thread timestamp validation failed",
        );

        await writeJson(cwd, threadsPath, {
          schema: "pr-review/prior-threads/v1",
          head_sha: headSha,
          threads: [
            {
              id: "T1",
              path: "src/app.ts",
              line: 2,
              side: "RIGHT",
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:01Z",
              model_context_eligible: "yes",
              dropped: null,
            },
          ],
        });
        await expectRejectsWith(
          runValidator(cwd, "validate-prior-threads", [
            "--head-sha",
            headSha,
            "--prior-threads",
            threadsPath,
          ]),
          "prior-thread model-context eligibility validation failed",
        );

        await writeJson(cwd, threadsPath, {
          schema: "pr-review/prior-threads/v1",
          head_sha: headSha,
          threads: [
            {
              id: "T1",
              path: "src/app.ts",
              line: 2,
              side: "RIGHT",
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:01Z",
              model_context_eligible: true,
              dropped: { reason: 1 },
            },
          ],
        });
        await expectRejectsWith(
          runValidator(cwd, "validate-prior-threads", [
            "--head-sha",
            headSha,
            "--prior-threads",
            threadsPath,
          ]),
          "dropped-thread shape validation failed",
        );

        await writeJson(cwd, threadsPath, {
          schema: "pr-review/prior-threads/v1",
          head_sha: headSha,
          threads: [
            {
              id: "T1",
              path: "src/app.ts",
              line: 1,
              start_line: 2,
              side: "RIGHT",
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:01Z",
              model_context_eligible: true,
              dropped: null,
            },
          ],
        });
        await expectRejectsWith(
          runValidator(cwd, "validate-prior-threads", [
            "--head-sha",
            headSha,
            "--prior-threads",
            threadsPath,
          ]),
          "prior-thread line range is inverted",
        );
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects out-of-diff anchors", async () => {
      const { cwd, baseSha, headSha } = await makeGitWorkspace();
      try {
        const anchorsPath = ".ephemeral/anchors.json";
        await writeJson(cwd, anchorsPath, {
          schema: "pr-review/diff-anchors/v1",
          anchors: [
            {
              path: "src/app.ts",
              line: 2,
              side: "RIGHT",
              body: "ok",
            },
          ],
        });
        await expect(
          runValidator(cwd, "validate-diff-anchors", [
            "--head-sha",
            headSha,
            "--diff-range",
            `${baseSha}...HEAD`,
            "--anchors",
            anchorsPath,
          ]),
        ).resolves.toMatchObject({ stdout: "" });

        await writeJson(cwd, anchorsPath, {
          schema: "pr-review/diff-anchors/v1",
          anchors: [
            {
              path: "README.md",
              line: 1,
              side: "RIGHT",
              body: "bad",
            },
          ],
        });
        await expectRejectsWith(
          runValidator(cwd, "validate-diff-anchors", [
            "--head-sha",
            headSha,
            "--diff-range",
            `${baseSha}...HEAD`,
            "--anchors",
            anchorsPath,
          ]),
          "diff anchor outside selected diff",
        );
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("compares approved payloads against findings and review body inputs", async () => {
      const { cwd, baseSha, headSha } = await makeGitWorkspace();
      try {
        await writeJson(
          cwd,
          ".ephemeral/scope.json",
          initialScope(baseSha, headSha),
        );
        await writeJson(cwd, ".ephemeral/findings.json", findingsEnvelope());
        await writeFile(path.join(cwd, ".ephemeral/review-body.md"), "Body\n");
        await writeJson(cwd, ".ephemeral/payload.json", {
          commit_id: headSha,
          event: "COMMENT",
          body: "Body\n",
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
            ...scopeArgs(headSha),
            "--findings-file",
            ".ephemeral/findings.json",
            "--review-body-file",
            ".ephemeral/review-body.md",
            "--review-event",
            "COMMENT",
            "--approved-payload",
            ".ephemeral/payload.json",
          ]),
        ).resolves.toMatchObject({
          stdout: expect.stringContaining('"commit_id"'),
        });

        await writeJson(cwd, ".ephemeral/payload.json", {
          commit_id: headSha,
          event: "COMMENT",
          body: "Edited\n",
          comments: [],
        });
        await expectRejectsWith(
          runValidator(cwd, "compare-approved-payload", [
            ...scopeArgs(headSha),
            "--findings-file",
            ".ephemeral/findings.json",
            "--review-body-file",
            ".ephemeral/review-body.md",
            "--review-event",
            "COMMENT",
            "--approved-payload",
            ".ephemeral/payload.json",
          ]),
          "approved payload mismatch",
        );
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects unsafe paths and missing explicit flags", async () => {
      const { cwd, headSha } = await makeGitWorkspace();
      try {
        await expectRejectsWith(
          runValidator(cwd, "validate-scope-decision", [
            ...scopeArgs(headSha, "../scope.json"),
          ]),
          "path traversal",
        );
        await expectRejectsWith(
          runValidator(cwd, "validate-scope-decision", ["--head-sha", headSha]),
          "--scope-decision is required",
        );
      } finally {
        await cleanupTempDir(cwd);
      }
    });
  },
);

describe("play-validate-review-artifacts validator packaging diagnostics", () => {
  it("fixture adapter fails loudly when the support validator is missing", async () => {
    const cwd = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-validator-missing-"),
    );
    try {
      const adapter = path.join(cwd, "skills/branch-review/scripts/adapter.sh");
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

      await expectRejectsWith(
        execFileAsync("bash", [adapter, "validate-scope-decision"], { cwd }),
        "play-validate-review-artifacts validator missing",
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
