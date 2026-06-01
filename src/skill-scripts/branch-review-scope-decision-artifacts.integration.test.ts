import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
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
  "skills/branch-review/scripts/scope-decision-artifacts.sh",
);
const jqAvailable = await commandAvailable("jq");

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync("bash", ["-c", `command -v ${command}`]);
    return true;
  } catch {
    return false;
  }
}

async function makeGitWorkspace() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devcanon-branch-scope-"));
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
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await writeFile(path.join(cwd, "src/app.ts"), "export const value = 1;\n");
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync("git", ["commit", "-m", "feat: add app"], { cwd });
  const headSha = await git(cwd, "rev-parse", "HEAD");
  await mkdir(path.join(cwd, ".ephemeral"));
  return { cwd, baseSha, headSha };
}

async function git(cwd: string, ...args: string[]) {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

function scopePath(headSha: string) {
  return `.ephemeral/topic-${headSha}-scope-decision.json`;
}

function initialScope(baseSha: string, headSha: string, overrides = {}) {
  return {
    schema: "branch-review/scope-decision/v1",
    surface: "branch-review",
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
    prior_context: { kind: "none", path: null },
    mechanical_facts: {
      changed_file_count: 1,
      followup_sha_usable: false,
      mechanical_escalate_full: true,
      mechanical_escalation_reason: "not-followup",
    },
    semantic_decision: { checked: true, ambiguous: false, notes: "" },
    ...overrides,
  };
}

async function writeJson(cwd: string, relPath: string, value: unknown) {
  await mkdir(path.dirname(path.join(cwd, relPath)), { recursive: true });
  await writeFile(path.join(cwd, relPath), JSON.stringify(value, null, 2));
}

async function runHelper(
  cwd: string,
  script: string,
  command: string,
  env: Record<string, string> = {},
) {
  return execFileAsync("bash", [script, command], {
    cwd,
    env: { ...process.env, ...env },
    maxBuffer: 1024 * 1024,
  });
}

async function writeMarkerValidator(root: string, marker: string) {
  const script = path.join(
    root,
    "play-validate-review-artifacts/scripts/review-artifacts.sh",
  );
  await mkdir(path.dirname(script), { recursive: true });
  await writeFile(
    script,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      '[ -z "${MARKER_ARGS_FILE:-}" ] || printf "%s\\n" "$@" > "$MARKER_ARGS_FILE"',
      `printf '%s\\n' ${JSON.stringify(marker)}`,
      "",
    ].join("\n"),
  );
  await chmod(script, 0o755);
  return script;
}

async function copyInstalledBranchAdapter(root: string) {
  const script = path.join(
    root,
    "branch-review/scripts/scope-decision-artifacts.sh",
  );
  await mkdir(path.dirname(script), { recursive: true });
  await copyFile(helperScript, script);
  await chmod(script, 0o755);
  return script;
}

describe.skipIf(!jqAvailable)("branch-review scope-decision adapter", () => {
  it("preserves prepare and validate commands in the source skill layout", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      const decisionPath = scopePath(headSha);
      await writeJson(cwd, decisionPath, initialScope(baseSha, headSha));

      await expect(
        runHelper(cwd, helperScript, "prepare-scope-decision-write", {
          HEAD_SHA: headSha,
        }),
      ).resolves.toMatchObject({ stdout: `${decisionPath}\n` });
      await expect(
        runHelper(cwd, helperScript, "validate-scope-decision", {
          HEAD_SHA: headSha,
          SCOPE_DECISION_FILE: decisionPath,
        }),
      ).resolves.toMatchObject({ stdout: "" });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("uses an explicit support-validator override and forwards branch scope policy flags", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    const temp = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-branch-marker-"),
    );
    try {
      const decisionPath = scopePath(headSha);
      const markerArgs = path.join(temp, "args.txt");
      const validator = await writeMarkerValidator(temp, "override-validator");

      await expect(
        runHelper(cwd, helperScript, "validate-scope-decision", {
          HEAD_SHA: headSha,
          SCOPE_DECISION_FILE: decisionPath,
          PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: validator,
          BRANCH_REVIEW_FULL_REVIEW_PATH_PATTERN: "^app/",
          MARKER_ARGS_FILE: markerArgs,
        }),
      ).resolves.toMatchObject({ stdout: "override-validator\n" });
      await expect(readFile(markerArgs, "utf8")).resolves.toContain(
        "--configured-path-pattern",
      );
      await expect(readFile(markerArgs, "utf8")).resolves.toContain(
        "branch-review/scope-decision/v1",
      );
    } finally {
      await cleanupTempDir(cwd);
      await cleanupTempDir(temp);
    }
  });

  it("resolves an installed-style sibling support validator", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    const root = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-branch-installed-"),
    );
    try {
      const script = await copyInstalledBranchAdapter(root);
      await writeMarkerValidator(root, "installed-validator");

      await expect(
        runHelper(cwd, script, "validate-scope-decision", {
          HEAD_SHA: headSha,
          SCOPE_DECISION_FILE: scopePath(headSha),
        }),
      ).resolves.toMatchObject({ stdout: "installed-validator\n" });
    } finally {
      await cleanupTempDir(cwd);
      await cleanupTempDir(root);
    }
  });

  it("fails loud when the support validator is unavailable", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    const root = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-branch-missing-"),
    );
    try {
      const script = await copyInstalledBranchAdapter(root);
      await expect(
        runHelper(cwd, script, "validate-scope-decision", {
          HEAD_SHA: headSha,
          SCOPE_DECISION_FILE: scopePath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "play-validate-review-artifacts validator missing",
        ),
      });
    } finally {
      await cleanupTempDir(cwd);
      await cleanupTempDir(root);
    }
  });

  it("surfaces delegated support-validator policy failures", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      const decisionPath = scopePath(headSha);
      await writeJson(
        cwd,
        decisionPath,
        initialScope(baseSha, headSha, {
          mechanical_facts: {
            changed_file_count: 2,
            followup_sha_usable: false,
            mechanical_escalate_full: true,
            mechanical_escalation_reason: "not-followup",
          },
        }),
      );

      await expect(
        runHelper(cwd, helperScript, "validate-scope-decision", {
          HEAD_SHA: headSha,
          SCOPE_DECISION_FILE: decisionPath,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "changed file count does not match selected range",
        ),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });
});
