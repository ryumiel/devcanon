import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
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
const helperScript = path.join(
  process.cwd(),
  "skills/pr-review/scripts/prior-thread-artifacts.sh",
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
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devcanon-pr-prior-"));
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

async function gitRaw(cwd: string, ...args: string[]) {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}

function scopePath(headSha: string) {
  return `.ephemeral/topic-${headSha}-scope-decision.json`;
}

function providerScopePath(headSha: string) {
  return `.ephemeral/topic-${headSha}-provider-scope-evidence.json`;
}

function priorThreadsPath(headSha: string) {
  return `.ephemeral/topic-${headSha}-prior-threads.json`;
}

function initialScope(baseSha: string, headSha: string, overrides = {}) {
  return {
    schema: "pr-review/scope-decision/v1",
    surface: "pr-review",
    mode: "initial",
    head_sha: headSha,
    full_range: `${baseSha}..${headSha}`,
    selected_range: `${baseSha}..${headSha}`,
    candidate_narrow_range: `${baseSha}..${headSha}`,
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function providerScopeEvidence(
  cwd: string,
  baseSha: string,
  headSha: string,
) {
  const patch = await gitRaw(
    cwd,
    "diff",
    `${baseSha}..${headSha}`,
    "--",
    "src/app.ts",
  );
  const fullDiff = await gitRaw(cwd, "diff", `${baseSha}..${headSha}`);
  const entry = {
    path: "src/app.ts",
    status: "added",
    previous_path: null,
    additions: 1,
    deletions: 0,
    changes: 1,
    patch_sha256: sha256(patch),
    patch_available: true,
  };
  return {
    schema: "pr-review/provider-scope-evidence/v1",
    provider: "github",
    repository: "owner/repo",
    pr_number: 390,
    baseRefOid: baseSha,
    headRefOid: headSha,
    provider_pr_diff_base_sha: baseSha,
    local_review_head_sha: headSha,
    full_pr_diff_range: `${baseSha}..${headSha}`,
    evidence_complete: true,
    provider_files: [entry],
    local_files: [entry],
    provider_diff_sha256: sha256(fullDiff),
    local_diff_sha256: sha256(fullDiff),
  };
}

async function writeInitialScope(
  cwd: string,
  baseSha: string,
  headSha: string,
  overrides = {},
) {
  const evidencePath = providerScopePath(headSha);
  const evidenceText = JSON.stringify(
    await providerScopeEvidence(cwd, baseSha, headSha),
    null,
    2,
  );
  await writeFile(path.join(cwd, evidencePath), evidenceText);
  await writeJson(cwd, scopePath(headSha), {
    ...initialScope(baseSha, headSha, overrides),
    artifacts: {
      provider_scope_evidence_file: evidencePath,
      provider_scope_evidence_sha256: sha256(evidenceText),
    },
  });
}

function priorThreadsEnvelope(headSha: string, overrides = {}) {
  return {
    schema: "pr-review/prior-threads/v1",
    provider: "github",
    pr_number: 390,
    head_sha: headSha,
    threads: [
      {
        thread_id: "PRRT_kwDOExample",
        is_resolved: false,
        is_outdated: false,
        path: "src/app.ts",
        line: 1,
        original_line: 1,
        start_line: null,
        original_start_line: null,
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
      },
    ],
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

async function copyInstalledPrAdapter(root: string) {
  const script = path.join(root, "pr-review/scripts/prior-thread-artifacts.sh");
  await mkdir(path.dirname(script), { recursive: true });
  await copyFile(helperScript, script);
  await chmod(script, 0o755);
  return script;
}

describe.skipIf(!jqAvailable)("pr-review prior-thread adapter", () => {
  it("preserves prepare and validate commands in the source skill layout", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      const decisionPath = scopePath(headSha);
      const threadsPath = priorThreadsPath(headSha);
      await writeInitialScope(cwd, baseSha, headSha);

      await expect(
        runHelper(cwd, helperScript, "prepare-prior-threads-write", {
          HEAD_SHA: headSha,
        }),
      ).resolves.toMatchObject({ stdout: `${threadsPath}\n` });
      await expect(
        runHelper(cwd, helperScript, "prepare-scope-decision-write", {
          HEAD_SHA: headSha,
        }),
      ).resolves.toMatchObject({ stdout: `${decisionPath}\n` });
      await expect(
        runHelper(cwd, helperScript, "prepare-provider-scope-evidence-write", {
          HEAD_SHA: headSha,
        }),
      ).resolves.toMatchObject({
        stdout: `${providerScopePath(headSha)}\n`,
      });
      await expect(
        runHelper(cwd, helperScript, "validate-scope-decision", {
          HEAD_SHA: headSha,
          BASE_REF: baseSha,
          SCOPE_DECISION_FILE: decisionPath,
          PROVIDER_SCOPE_EVIDENCE_FILE: providerScopePath(headSha),
        }),
      ).resolves.toMatchObject({ stdout: "" });
      await writeJson(cwd, threadsPath, priorThreadsEnvelope(headSha));
      await expect(
        runHelper(cwd, helperScript, "validate-prior-threads", {
          HEAD_SHA: headSha,
          PRIOR_THREADS_FILE: threadsPath,
        }),
      ).resolves.toMatchObject({ stdout: "" });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("guards provider evidence write targets before producer output", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    try {
      const evidencePath = providerScopePath(headSha);

      await expect(
        runHelper(cwd, helperScript, "prepare-provider-scope-evidence-write", {
          HEAD_SHA: headSha,
        }),
      ).resolves.toMatchObject({ stdout: `${evidencePath}\n` });

      await writeFile(path.join(cwd, evidencePath), "existing\n");
      await expect(
        runHelper(cwd, helperScript, "prepare-provider-scope-evidence-write", {
          HEAD_SHA: headSha,
        }),
      ).resolves.toMatchObject({ stdout: `${evidencePath}\n` });

      await rm(path.join(cwd, evidencePath));
      await mkdir(path.join(cwd, evidencePath), { recursive: true });
      await expect(
        runHelper(cwd, helperScript, "prepare-provider-scope-evidence-write", {
          HEAD_SHA: headSha,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "provider scope evidence path is a directory",
        ),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("uses an explicit support-validator override and forwards PR scope policy flags", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    const temp = await mkdtemp(path.join(os.tmpdir(), "devcanon-pr-marker-"));
    try {
      const markerArgs = path.join(temp, "args.txt");
      const validator = await writeMarkerValidator(temp, "override-validator");

      await expect(
        runHelper(cwd, helperScript, "validate-scope-decision", {
          HEAD_SHA: headSha,
          BASE_REF: baseSha,
          SCOPE_DECISION_FILE: scopePath(headSha),
          PROVIDER_SCOPE_EVIDENCE_FILE: providerScopePath(headSha),
          PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: validator,
          MARKER_ARGS_FILE: markerArgs,
        }),
      ).resolves.toMatchObject({ stdout: "override-validator\n" });
      const args = await readFile(markerArgs, "utf8");
      expect(args).toContain("validate-scope-decision");
      expect(args).toContain("pr-review/scope-decision/v1");
      expect(args).toContain("--base-ref");
      expect(args).toContain(baseSha);
      expect(args).toContain("--provider-scope-evidence-file");
      expect(args).toContain(providerScopePath(headSha));
      expect(args).toContain("--governed-path-pattern");
    } finally {
      await cleanupTempDir(cwd);
      await cleanupTempDir(temp);
    }
  });

  it("resolves an installed-style sibling support validator", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    const root = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-pr-installed-"),
    );
    try {
      const script = await copyInstalledPrAdapter(root);
      await writeMarkerValidator(root, "installed-validator");

      await expect(
        runHelper(cwd, script, "validate-prior-threads", {
          HEAD_SHA: headSha,
          PRIOR_THREADS_FILE: priorThreadsPath(headSha),
        }),
      ).resolves.toMatchObject({ stdout: "installed-validator\n" });
    } finally {
      await cleanupTempDir(cwd);
      await cleanupTempDir(root);
    }
  });

  it("fails before invoking an override validator when BASE_REF is missing", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    const temp = await mkdtemp(path.join(os.tmpdir(), "devcanon-pr-marker-"));
    try {
      const markerArgs = path.join(temp, "args.txt");
      const validator = await writeMarkerValidator(temp, "override-validator");

      await expect(
        runHelper(cwd, helperScript, "validate-scope-decision", {
          HEAD_SHA: headSha,
          SCOPE_DECISION_FILE: scopePath(headSha),
          PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: validator,
          MARKER_ARGS_FILE: markerArgs,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("BASE_REF is required"),
      });
      await expect(readFile(markerArgs, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await cleanupTempDir(cwd);
      await cleanupTempDir(temp);
    }
  });

  it("rejects a self-consistent scope artifact with the wrong full-range base", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      const baseTree = await git(cwd, "rev-parse", `${baseSha}^{tree}`);
      const wrongBaseSha = await git(
        cwd,
        "commit-tree",
        baseTree,
        "-p",
        baseSha,
        "-m",
        "wrong base",
      );
      const decisionPath = scopePath(headSha);
      await writeInitialScope(cwd, baseSha, headSha, {
        full_range: `${wrongBaseSha}..${headSha}`,
        selected_range: `${wrongBaseSha}..${headSha}`,
        candidate_narrow_range: `${wrongBaseSha}..${headSha}`,
      });

      await expect(
        runHelper(cwd, helperScript, "validate-scope-decision", {
          HEAD_SHA: headSha,
          BASE_REF: baseSha,
          SCOPE_DECISION_FILE: decisionPath,
          PROVIDER_SCOPE_EVIDENCE_FILE: providerScopePath(headSha),
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

  it("fails loud when the support validator is unavailable", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    const root = await mkdtemp(path.join(os.tmpdir(), "devcanon-pr-missing-"));
    try {
      const script = await copyInstalledPrAdapter(root);
      await expect(
        runHelper(cwd, script, "validate-scope-decision", {
          HEAD_SHA: headSha,
          BASE_REF: "HEAD^",
          SCOPE_DECISION_FILE: scopePath(headSha),
          PROVIDER_SCOPE_EVIDENCE_FILE: providerScopePath(headSha),
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

  it("surfaces delegated support-validator failures", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    try {
      const threadsPath = priorThreadsPath(headSha);
      await writeJson(
        cwd,
        threadsPath,
        priorThreadsEnvelope(headSha, {
          threads: [
            {
              ...priorThreadsEnvelope(headSha).threads[0],
              comments: [
                {
                  author: "reviewer",
                  created_at: "2026-13-01T00:00:00Z",
                  updated_at: "2026-01-01T00:00:01Z",
                  body: "Bad timestamp.",
                  is_bot: false,
                  minimized_reason: null,
                },
              ],
            },
          ],
        }),
      );

      await expect(
        runHelper(cwd, helperScript, "validate-prior-threads", {
          HEAD_SHA: headSha,
          PRIOR_THREADS_FILE: threadsPath,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "prior-thread timestamp validation failed",
        ),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });
});
