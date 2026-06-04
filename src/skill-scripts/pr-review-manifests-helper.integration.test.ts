import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
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
const helperScript = path.join(
  process.cwd(),
  "skills/pr-review/scripts/review-manifests.sh",
);
const priorHelperScript = path.join(
  process.cwd(),
  "skills/pr-review/scripts/prior-thread-artifacts.sh",
);
const playReviewHelperScript = path.join(
  process.cwd(),
  "skills/play-review/scripts/review-artifacts.sh",
);
const supportValidatorScript = path.join(
  process.cwd(),
  "skills/play-validate-review-artifacts/scripts/review-artifacts.sh",
);
const jqAvailable = await commandAvailable("jq");
const symlinkAvailable = await canCreateSymlinks();
const prNumber = "390";

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync("bash", ["-c", `command -v ${command}`]);
    return true;
  } catch {
    return false;
  }
}

async function makeGitWorkspace() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devcanon-pr-manifest-"));
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

function priorThreadsPath(headSha: string) {
  return `.ephemeral/topic-${headSha}-prior-threads.json`;
}

function findingsPath(headSha: string) {
  return `.ephemeral/topic-${headSha}-findings.json`;
}

function handoffPath(headSha: string) {
  return `.ephemeral/pr-${prNumber}-${headSha}-handoff.json`;
}

function resultPath(headSha: string) {
  return `.ephemeral/pr-${prNumber}-${headSha}-result.json`;
}

function initialScope(
  baseSha: string,
  headSha: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    schema: "pr-review/scope-decision/v1",
    surface: "pr-review",
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

function priorThreadsEnvelope(headSha: string) {
  return {
    schema: "pr-review/prior-threads/v1",
    provider: "github",
    pr_number: Number(prNumber),
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
    dropped: [],
  };
}

function findingsEnvelope() {
  return {
    schema: "play-review/findings/v1",
    findings: [],
    carry_forward: [],
  };
}

async function writeJson(cwd: string, relPath: string, value: unknown) {
  await mkdir(path.dirname(path.join(cwd, relPath)), { recursive: true });
  await writeFile(path.join(cwd, relPath), JSON.stringify(value, null, 2));
}

async function readJson(cwd: string, relPath: string) {
  return JSON.parse(await readFile(path.join(cwd, relPath), "utf8"));
}

async function writeValidInputs(cwd: string, baseSha: string, headSha: string) {
  await writeJson(cwd, scopePath(headSha), initialScope(baseSha, headSha));
  await writeJson(cwd, findingsPath(headSha), findingsEnvelope());
}

function handoffEnv(cwd: string, baseSha: string, headSha: string) {
  return {
    PR_NUMBER: prNumber,
    HEAD_SHA: headSha,
    REPOSITORY: "owner/repo",
    EXECUTION_WORKING_DIRECTORY: cwd,
    BASE_REF: "main",
    HEAD_REF: "topic",
    REVIEW_SCOPE_BASE_REF: baseSha,
    ACTIVE_DIFF_RANGE: `${baseSha}...HEAD`,
    FULL_PR_DIFF_RANGE: `${baseSha}...HEAD`,
    MODE: "github-post",
    LANGUAGE_HINTS_JSON: '["ts"]',
    FOLLOW_UP_STATE: "initial",
    IS_FOLLOWUP_NARROW: "false",
    SCOPE_DECISION_FILE: scopePath(headSha),
  };
}

function resultEnv(headSha: string) {
  return {
    PR_NUMBER: prNumber,
    HEAD_SHA: headSha,
    REPOSITORY: "owner/repo",
    FINDINGS_FILE: findingsPath(headSha),
    SCOPE_DECISION_FILE: scopePath(headSha),
    PRESENTATION_STATUS: "not-presented",
  };
}

async function runHelper(
  cwd: string,
  command: string,
  env: NodeJS.ProcessEnv = {},
  script = helperScript,
) {
  return execFileAsync("bash", [script, command], {
    cwd,
    env: { ...process.env, ...env },
    maxBuffer: 1024 * 1024,
  });
}

async function copyInstalledPrManifestHelper(root: string) {
  const script = path.join(root, "pr-review/scripts/review-manifests.sh");
  await mkdir(path.dirname(script), { recursive: true });
  await copyFile(helperScript, script);
  await chmod(script, 0o755);
  return script;
}

async function copyInstalledPrPriorHelper(root: string) {
  const script = path.join(root, "pr-review/scripts/prior-thread-artifacts.sh");
  await mkdir(path.dirname(script), { recursive: true });
  await copyFile(priorHelperScript, script);
  await chmod(script, 0o755);
  return script;
}

async function copyInstalledPlayHelper(root: string) {
  const script = path.join(root, "play-review/scripts/review-artifacts.sh");
  await mkdir(path.dirname(script), { recursive: true });
  await copyFile(playReviewHelperScript, script);
  await chmod(script, 0o755);
  return script;
}

async function copyInstalledSupportValidator(root: string) {
  const script = path.join(
    root,
    "play-validate-review-artifacts/scripts/review-artifacts.sh",
  );
  await mkdir(path.dirname(script), { recursive: true });
  await copyFile(supportValidatorScript, script);
  await chmod(script, 0o755);
  return script;
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

describe.skipIf(!jqAvailable)("pr-review manifest helper", () => {
  it("derives deterministic handoff/result paths and separates different heads", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    try {
      await expect(
        runHelper(cwd, "prepare-handoff-write", {
          PR_NUMBER: prNumber,
          HEAD_SHA: headSha,
        }),
      ).resolves.toMatchObject({ stdout: `${handoffPath(headSha)}\n` });
      await expect(
        runHelper(cwd, "prepare-result-write", {
          PR_NUMBER: prNumber,
          HEAD_SHA: headSha,
        }),
      ).resolves.toMatchObject({ stdout: `${resultPath(headSha)}\n` });

      const nextHead = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      expect(handoffPath(nextHead)).not.toBe(handoffPath(headSha));
      expect(resultPath(nextHead)).not.toBe(resultPath(headSha));
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("writes and validates minimal valid handoff and result manifests", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      await writeValidInputs(cwd, baseSha, headSha);

      await expect(
        runHelper(cwd, "write-handoff", handoffEnv(cwd, baseSha, headSha)),
      ).resolves.toMatchObject({ stdout: `${handoffPath(headSha)}\n` });
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).resolves.toMatchObject({ stdout: "" });

      await expect(
        runHelper(cwd, "write-result", resultEnv(headSha)),
      ).resolves.toMatchObject({ stdout: `${resultPath(headSha)}\n` });
      await expect(
        runHelper(cwd, "validate-result", {
          HEAD_SHA: headSha,
          RESULT_FILE: resultPath(headSha),
        }),
      ).resolves.toMatchObject({ stdout: "" });

      await expect(readJson(cwd, resultPath(headSha))).resolves.toMatchObject({
        schema: "pr-review/result/v1",
        validation: {
          status: "valid",
          findings_validated: true,
          scope_decision_validated: true,
        },
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects unknown and forbidden top-level or nested fields", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      await writeValidInputs(cwd, baseSha, headSha);
      await runHelper(cwd, "write-handoff", handoffEnv(cwd, baseSha, headSha));
      await runHelper(cwd, "write-result", resultEnv(headSha));

      const handoff = await readJson(cwd, handoffPath(headSha));
      await writeJson(cwd, handoffPath(headSha), {
        ...handoff,
        unexpected: "extra",
      });
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("handoff schema mismatch"),
      });

      await writeJson(cwd, handoffPath(headSha), {
        ...handoff,
        approval_state: "approved",
      });
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("handoff schema mismatch"),
      });

      await writeJson(cwd, handoffPath(headSha), {
        ...handoff,
        execution: { ...handoff.execution, extra: true },
      });
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("handoff schema mismatch"),
      });

      await writeJson(cwd, handoffPath(headSha), {
        ...handoff,
        follow_up: { ...handoff.follow_up, approval: true },
      });
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("handoff schema mismatch"),
      });

      const result = await readJson(cwd, resultPath(headSha));
      await writeJson(cwd, resultPath(headSha), {
        ...result,
        unexpected: "extra",
      });
      await expect(
        runHelper(cwd, "validate-result", {
          HEAD_SHA: headSha,
          RESULT_FILE: resultPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("result schema mismatch"),
      });

      await writeJson(cwd, resultPath(headSha), {
        ...result,
        artifacts: {
          ...result.artifacts,
          lease_file: ".ephemeral/lease.json",
        },
      });
      await expect(
        runHelper(cwd, "validate-result", {
          HEAD_SHA: headSha,
          RESULT_FILE: resultPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("result schema mismatch"),
      });

      await writeJson(cwd, resultPath(headSha), {
        ...result,
        review_payload_file: ".ephemeral/payload.json",
      });
      await expect(
        runHelper(cwd, "validate-result", {
          HEAD_SHA: headSha,
          RESULT_FILE: resultPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("result schema mismatch"),
      });

      await writeJson(cwd, resultPath(headSha), {
        ...result,
        presentation: { ...result.presentation, payload: {} },
      });
      await expect(
        runHelper(cwd, "validate-result", {
          HEAD_SHA: headSha,
          RESULT_FILE: resultPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("result schema mismatch"),
      });

      await writeJson(cwd, resultPath(headSha), {
        ...result,
        validation: { ...result.validation, lease: "active" },
      });
      await expect(
        runHelper(cwd, "validate-result", {
          HEAD_SHA: headSha,
          RESULT_FILE: resultPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("result schema mismatch"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects missing required fields, invalid identities, nested paths, and relative execution roots", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      await writeValidInputs(cwd, baseSha, headSha);
      await runHelper(cwd, "write-handoff", handoffEnv(cwd, baseSha, headSha));
      await runHelper(cwd, "write-result", resultEnv(headSha));

      await expect(
        runHelper(cwd, "prepare-handoff-write", {
          PR_NUMBER: prNumber,
          HEAD_SHA: "not-a-sha",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "HEAD_SHA must be a 40-character lowercase hex SHA",
        ),
      });
      await expect(
        runHelper(cwd, "prepare-result-write", {
          PR_NUMBER: "0",
          HEAD_SHA: headSha,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("PR_NUMBER must be a positive integer"),
      });

      const handoff = await readJson(cwd, handoffPath(headSha));
      const { repository: _handoffRepository, ...handoffMissingRepository } =
        handoff;
      await writeJson(cwd, handoffPath(headSha), handoffMissingRepository);
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("handoff schema mismatch"),
      });

      await writeJson(cwd, handoffPath(headSha), {
        ...handoff,
        execution: { ...handoff.execution, working_directory: "." },
      });
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("handoff schema mismatch"),
      });

      await writeJson(cwd, handoffPath(headSha), handoff);
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: ".ephemeral/nested/bad-handoff.json",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("nested handoff path rejected"),
      });

      const result = await readJson(cwd, resultPath(headSha));
      const { repository: _resultRepository, ...resultMissingRepository } =
        result;
      await writeJson(cwd, resultPath(headSha), resultMissingRepository);
      await expect(
        runHelper(cwd, "validate-result", {
          HEAD_SHA: headSha,
          RESULT_FILE: resultPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("result schema mismatch"),
      });

      await writeJson(cwd, resultPath(headSha), result);
      await expect(
        runHelper(cwd, "validate-result", {
          HEAD_SHA: headSha,
          RESULT_FILE: ".ephemeral/nested/bad-result.json",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("nested result path rejected"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects invalid path identity, optional suffixes, physical roots, and stale worktree HEAD", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    const other = await makeGitWorkspace();
    const sameHeadOther = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-pr-same-head-"),
    );
    try {
      await writeValidInputs(cwd, baseSha, headSha);
      await runHelper(cwd, "write-handoff", handoffEnv(cwd, baseSha, headSha));
      await runHelper(cwd, "write-result", resultEnv(headSha));
      await execFileAsync("git", ["clone", cwd, sameHeadOther]);
      await execFileAsync("git", ["checkout", "--detach", headSha], {
        cwd: sameHeadOther,
      });

      const handoff = await readJson(cwd, handoffPath(headSha));
      await writeJson(cwd, handoffPath(headSha), {
        ...handoff,
        pr_number: 999,
      });
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("handoff path mismatch"),
      });

      const result = await readJson(cwd, resultPath(headSha));
      await writeJson(cwd, resultPath(headSha), {
        ...result,
        pr_number: 999,
      });
      await expect(
        runHelper(cwd, "validate-result", {
          HEAD_SHA: headSha,
          RESULT_FILE: resultPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("result path mismatch"),
      });

      await writeJson(cwd, resultPath(headSha), {
        ...result,
        review_head_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      });
      await expect(
        runHelper(cwd, "validate-result", {
          HEAD_SHA: headSha,
          RESULT_FILE: resultPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("review head mismatch"),
      });

      await writeJson(cwd, handoffPath(headSha), {
        ...handoff,
        execution: { ...handoff.execution, working_directory: sameHeadOther },
      });
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "execution working_directory git root mismatch",
        ),
      });

      await writeJson(cwd, handoffPath(headSha), {
        ...handoff,
        execution: { ...handoff.execution, working_directory: other.cwd },
      });
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "execution working_directory git root mismatch",
        ),
      });

      await writeFile(
        path.join(cwd, "src/app.ts"),
        "export const value = 2;\n",
      );
      await execFileAsync("git", ["add", "src/app.ts"], { cwd });
      await execFileAsync("git", ["commit", "-m", "feat: advance head"], {
        cwd,
      });
      await writeJson(cwd, handoffPath(headSha), handoff);
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("execution worktree HEAD mismatch"),
      });

      await execFileAsync("git", ["checkout", "--detach", headSha], { cwd });
      await writeJson(cwd, resultPath(headSha), {
        ...result,
        context_file: ".ephemeral/current.txt",
      });
      await expect(
        runHelper(cwd, "validate-result", {
          HEAD_SHA: headSha,
          RESULT_FILE: resultPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("result schema mismatch"),
      });
    } finally {
      await cleanupTempDir(cwd);
      await cleanupTempDir(other.cwd);
      await cleanupTempDir(sameHeadOther);
    }
  });

  it("rejects handoff and result mismatches against scope and prior-thread authority", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      await writeValidInputs(cwd, baseSha, headSha);
      await runHelper(cwd, "write-handoff", handoffEnv(cwd, baseSha, headSha));
      await runHelper(cwd, "write-result", resultEnv(headSha));

      const handoff = await readJson(cwd, handoffPath(headSha));
      await writeJson(cwd, handoffPath(headSha), {
        ...handoff,
        active_diff_range: "HEAD^..HEAD",
      });
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("handoff active diff range mismatch"),
      });

      await writeJson(cwd, handoffPath(headSha), {
        ...handoff,
        full_pr_diff_range: "HEAD^..HEAD",
      });
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("handoff full diff range mismatch"),
      });

      await writeJson(cwd, handoffPath(headSha), {
        ...handoff,
        language_hints: ["ts", "ts"],
      });
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("handoff language hints mismatch"),
      });

      await writeJson(cwd, handoffPath(headSha), {
        ...handoff,
        follow_up: {
          state: "follow-up-full",
          last_reviewed_sha: baseSha,
          is_followup_narrow: false,
        },
      });
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("handoff follow-up state mismatch"),
      });

      await writeJson(cwd, scopePath(headSha), {
        ...initialScope(baseSha, headSha),
        head_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      });
      await writeJson(cwd, handoffPath(headSha), handoff);
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("scope decision head mismatch"),
      });
      await writeJson(cwd, scopePath(headSha), initialScope(baseSha, headSha));

      const result = await readJson(cwd, resultPath(headSha));
      await writeJson(cwd, resultPath(headSha), {
        ...result,
        artifacts: {
          ...result.artifacts,
          prior_threads_file: priorThreadsPath(headSha),
        },
      });
      await expect(
        runHelper(cwd, "validate-result", {
          HEAD_SHA: headSha,
          RESULT_FILE: resultPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("prior threads path mismatch"),
      });

      await writeJson(
        cwd,
        priorThreadsPath(headSha),
        priorThreadsEnvelope(headSha),
      );
      await writeJson(
        cwd,
        scopePath(headSha),
        initialScope(baseSha, headSha, {
          mode: "follow-up",
          last_reviewed_sha: baseSha,
          is_followup_narrow: true,
          selected_range: `${baseSha}..HEAD`,
          candidate_narrow_range: `${baseSha}..HEAD`,
          escalation_reasons: [],
          prior_context: {
            kind: "github-prior-threads",
            path: priorThreadsPath(headSha),
          },
          mechanical_facts: {
            changed_file_count: 1,
            followup_sha_usable: true,
            mechanical_escalate_full: false,
            mechanical_escalation_reason: "",
          },
        }),
      );
      await writeJson(cwd, handoffPath(headSha), {
        ...handoff,
        artifacts: {
          ...handoff.artifacts,
          prior_threads_file: `.ephemeral/topic-${headSha}-stale-prior-threads.json`,
        },
      });
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("prior threads path mismatch"),
      });

      await writeJson(cwd, resultPath(headSha), result);
      await expect(
        runHelper(cwd, "validate-result", {
          HEAD_SHA: headSha,
          RESULT_FILE: resultPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("prior threads path mismatch"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("delegates findings validation to explicit and sibling-discovered play-review helpers", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    const installed = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-installed-"),
    );
    try {
      await writeValidInputs(cwd, baseSha, headSha);
      await copyInstalledPrManifestHelper(installed);
      await copyInstalledPrPriorHelper(installed);
      await copyInstalledPlayHelper(installed);
      await copyInstalledSupportValidator(installed);

      const recordingPlayHelper = path.join(cwd, ".ephemeral/play-helper.sh");
      await writeFile(
        recordingPlayHelper,
        [
          "#!/usr/bin/env bash",
          "set -euo pipefail",
          'printf "%s\\n" "$@" > ".ephemeral/play-helper-args.txt"',
          "exit 0",
          "",
        ].join("\n"),
      );
      await chmod(recordingPlayHelper, 0o755);

      await runHelper(cwd, "write-result", {
        ...resultEnv(headSha),
        PLAY_REVIEW_HELPER: recordingPlayHelper,
      });
      await expect(
        readFile(path.join(cwd, ".ephemeral/play-helper-args.txt"), "utf8"),
      ).resolves.toContain("validate-findings");

      await expect(
        runHelper(
          cwd,
          "validate-result",
          {
            HEAD_SHA: headSha,
            RESULT_FILE: resultPath(headSha),
          },
          path.join(installed, "pr-review/scripts/review-manifests.sh"),
        ),
      ).resolves.toMatchObject({ stdout: "" });

      await writeJson(cwd, findingsPath(headSha), {
        schema: "play-review/findings/v1",
        findings: [{ invalid: true }],
        carry_forward: [],
      });
      await expect(
        runHelper(cwd, "validate-result", {
          HEAD_SHA: headSha,
          RESULT_FILE: resultPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("envelope shape mismatch"),
      });

      const invalidFindingsFile = `.ephemeral/topic-${headSha}-bad-findings.json`;
      await writeJson(cwd, invalidFindingsFile, {
        schema: "play-review/findings/v1",
        findings: [{ invalid: true }],
        carry_forward: [],
      });
      await writeJson(cwd, resultPath(headSha), {
        ...(await readJson(cwd, resultPath(headSha))),
        findings_file: invalidFindingsFile,
      });
      await expect(
        runHelper(cwd, "validate-result", {
          HEAD_SHA: headSha,
          RESULT_FILE: resultPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("findings path mismatch"),
      });
    } finally {
      await cleanupTempDir(cwd);
      await cleanupTempDir(installed);
    }
  });

  it("fails closed for missing or non-executable helper authorities before continuing", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    const installed = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-missing-"),
    );
    try {
      await writeValidInputs(cwd, baseSha, headSha);
      await runHelper(cwd, "write-handoff", handoffEnv(cwd, baseSha, headSha));
      await runHelper(cwd, "write-result", resultEnv(headSha));
      const installedScript = await copyInstalledPrManifestHelper(installed);

      await expect(
        runHelper(
          cwd,
          "validate-result",
          {
            HEAD_SHA: headSha,
            RESULT_FILE: resultPath(headSha),
          },
          installedScript,
        ),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "play-review findings helper missing or not executable",
        ),
      });

      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
          PR_REVIEW_DIR: path.join(installed, "missing-pr-review"),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "pr-review prior-thread artifact helper missing or not executable",
        ),
      });

      const nonExecutablePlayHelper = path.join(
        cwd,
        ".ephemeral/non-exec-play.sh",
      );
      await writeFile(nonExecutablePlayHelper, "#!/usr/bin/env bash\nexit 0\n");
      await chmod(nonExecutablePlayHelper, 0o644);
      await expect(
        runHelper(cwd, "validate-result", {
          HEAD_SHA: headSha,
          RESULT_FILE: resultPath(headSha),
          PLAY_REVIEW_HELPER: nonExecutablePlayHelper,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "play-review findings helper missing or not executable",
        ),
      });
    } finally {
      await cleanupTempDir(cwd);
      await cleanupTempDir(installed);
    }
  });

  it("preserves final manifests and removes temp files when temp validation fails", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      await writeValidInputs(cwd, baseSha, headSha);
      await runHelper(cwd, "write-result", resultEnv(headSha));
      const before = await readFile(
        path.join(cwd, resultPath(headSha)),
        "utf8",
      );

      await expect(
        runHelper(cwd, "write-result", {
          ...resultEnv(headSha),
          PRESENTATION_STATUS: "approved",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("result schema mismatch"),
      });
      await expect(
        readFile(path.join(cwd, resultPath(headSha)), "utf8"),
      ).resolves.toBe(before);
      await expect(
        readFile(
          path.join(
            cwd,
            `.ephemeral/.pr-${prNumber}-${headSha}-result.json.tmp`,
          ),
          "utf8",
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it.skipIf(!symlinkAvailable)(
    "guards direct-child write targets and symlinked .ephemeral",
    async () => {
      const { cwd, headSha } = await makeGitWorkspace();
      try {
        await rm(path.join(cwd, ".ephemeral"), {
          recursive: true,
          force: true,
        });
        await symlink(os.tmpdir(), path.join(cwd, ".ephemeral"));
        await expect(
          runHelper(cwd, "prepare-handoff-write", {
            PR_NUMBER: prNumber,
            HEAD_SHA: headSha,
          }),
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

  it("keeps approval payload and GitHub mutation authority out of the manifest helper", async () => {
    const manifestHelper = await readFile(helperScript, "utf8");
    const approvedHelper = await readFile(
      path.join(
        process.cwd(),
        "skills/pr-review/scripts/approved-review-artifacts.sh",
      ),
      "utf8",
    );

    expect(manifestHelper).not.toContain("freeze-approved-review");
    expect(manifestHelper).not.toContain("build-github-review-payload");
    expect(manifestHelper).not.toMatch(/\bgh\s+api\b/);
    expect(manifestHelper).not.toContain("pr-review/approved-review/v1");
    expect(approvedHelper).toContain("freeze_approved_review");
    expect(approvedHelper).toContain("pr-review/approved-review/v1");
  });
});
