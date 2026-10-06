import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempDir } from "../__test-helpers__/fixtures.js";
import { currentReviewEnvelope } from "../__test-helpers__/review-evidence.js";

const execFileAsync = promisify(execFile);
const helperScript = path.join(
  process.cwd(),
  "skills/pr-review/scripts/review-manifests.sh",
);
const leaseHelperScript = path.join(
  process.cwd(),
  "skills/pr-review/scripts/review-leases.sh",
);
const wrapperTimeoutMs = 10_000;
const createdRoots: string[] = [];

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map(cleanupTempDir));
});

async function createInstalledWrapper(
  sourceScript: string,
  relativeScript: string,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "devcanon-pr-wrapper-"));
  createdRoots.push(root);
  const runtime = path.join(
    root,
    "devcanon-runtime/scripts/devcanon-runtime.sh",
  );
  const script = path.join(root, relativeScript);
  await mkdir(path.dirname(runtime), { recursive: true });
  await mkdir(path.dirname(script), { recursive: true });
  await copyFile(sourceScript, script);
  await chmod(script, 0o755);
  return { root, runtime, script };
}

async function writeRuntime(runtime: string, body: readonly string[]) {
  await writeFile(
    runtime,
    ["#!/usr/bin/env bash", "set -euo pipefail", ...body, ""].join("\n"),
  );
  await chmod(runtime, 0o755);
}

function wrapperEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PR_NUMBER: "390",
    REPOSITORY: "owner/repo",
    ...overrides,
  };
}

async function runWrapper(
  root: string,
  script: string,
  command: string,
  args: readonly string[] = [],
  env: NodeJS.ProcessEnv = {},
) {
  return execFileAsync("bash", [script, command, ...args], {
    cwd: root,
    env: wrapperEnv(env),
    maxBuffer: 1024 * 1024,
    timeout: wrapperTimeoutMs,
    killSignal: "SIGTERM",
  });
}

function runWrapperWithStdin(
  root: string,
  script: string,
  command: string,
  input: string,
  env: NodeJS.ProcessEnv = {},
) {
  const child = spawn("bash", [script, command], {
    cwd: root,
    env: wrapperEnv(env),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const outcome = new Promise<{ stdout: string; stderr: string }>(
    (resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 250).unref();
      }, wrapperTimeoutMs);
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (code, signal) => {
        clearTimeout(timeout);
        if (code === 0 && !timedOut) {
          resolve({ stdout, stderr });
          return;
        }
        reject(
          Object.assign(
            new Error(
              timedOut
                ? `wrapper timed out after ${wrapperTimeoutMs}ms`
                : `wrapper exited with ${code ?? signal}`,
            ),
            { stdout, stderr },
          ),
        );
      });
    },
  );
  child.stdin.end(input);
  return outcome;
}

describe("pr-review manifest helpers", () => {
  it("routes public manifest commands through the installed sibling runtime", async () => {
    const { root, runtime, script } = await createInstalledWrapper(
      helperScript,
      "pr-review/scripts/review-manifests.sh",
    );
    await writeRuntime(runtime, ['printf "runtime %s\\n" "$*"']);

    await expect(
      runWrapper(root, script, "render-phase5-audit-summary"),
    ).resolves.toMatchObject({
      stdout:
        "runtime runtime pr-review-manifests render-phase5-audit-summary\n",
    });
    await expect(
      runWrapper(root, script, "read-result-for-preview"),
    ).resolves.toMatchObject({
      stdout: "runtime runtime pr-review-manifests read-result-for-preview\n",
    });
  });

  it("consumes a historical result through the real adapter after a Git documentation repair", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-baseline-adapter-"),
    );
    createdRoots.push(root);
    const git = (...args: string[]) =>
      execFileAsync("git", args, { cwd: root });
    await git("init", "--initial-branch=main");
    await git("config", "user.name", "Test User");
    await git("config", "user.email", "test@example.com");
    await writeFile(path.join(root, "README.md"), "Original documentation\n");
    await git("add", "README.md");
    await git("commit", "-m", "base documentation");
    const base = (await git("rev-parse", "HEAD")).stdout.trim();
    await writeFile(path.join(root, "README.md"), "Before repair\n");
    await git("add", "README.md");
    await git("commit", "-m", "reviewed documentation");
    const head = (await git("rev-parse", "HEAD")).stdout.trim();
    await mkdir(path.join(root, ".ephemeral"));
    const findingsFile = ".ephemeral/retained-findings.json";
    const scopeFile = ".ephemeral/retained-scope.json";
    const resultFile = ".ephemeral/relocated.json";
    const findings = currentReviewEnvelope(head);
    const scope = {
      head_sha: head,
      selected_range: `${base}..${head}`,
      full_range: `${base}..${head}`,
      is_followup_narrow: false,
      selection_reason: "Established coverage",
    };
    const findingsBytes = JSON.stringify(findings);
    const scopeBytes = JSON.stringify(scope);
    const digest = (bytes: string) =>
      createHash("sha256").update(bytes).digest("hex");
    await writeFile(path.join(root, findingsFile), findingsBytes);
    await writeFile(path.join(root, scopeFile), scopeBytes);
    await writeFile(
      path.join(root, resultFile),
      JSON.stringify({
        schema: "pr-review/result/v1",
        repository: "owner/repo",
        pr_number: 390,
        review_head_sha: head,
        findings_file: findingsFile,
        artifacts: { scope_decision_file: scopeFile },
        digests: {
          findings_sha256: digest(findingsBytes),
          scope_decision_sha256: digest(scopeBytes),
        },
        scope_decision: {
          selected_range: scope.selected_range,
          full_range: scope.full_range,
          is_followup_narrow: false,
          summary: scope.selection_reason,
        },
      }),
    );
    await writeFile(path.join(root, "README.md"), "Repaired documentation\n");
    await git("add", "README.md");
    await git("commit", "-m", "repair documentation");
    const outcome = await runWrapper(
      root,
      helperScript,
      "read-result-for-baseline",
      [],
      { RESULT_FILE: resultFile, HEAD_SHA: "" },
    );
    expect(JSON.parse(outcome.stdout)).toMatchObject({
      review_head_sha: head,
      findings,
    });
    expect(outcome.stderr).toBe("");
    expect(
      (await git("diff", "--name-only", `${head}..HEAD`)).stdout.trim(),
    ).toBe("README.md");
  });

  it("routes historical reads without requiring current HEAD and propagates refusal", async () => {
    const { root, runtime, script } = await createInstalledWrapper(
      helperScript,
      "pr-review/scripts/review-manifests.sh",
    );
    await writeRuntime(runtime, [
      '[ "$*" = "runtime pr-review-manifests read-result-for-baseline" ]',
      '[ "$REPOSITORY" = "owner/repo" ]',
      '[ "$PR_NUMBER" = "390" ]',
      '[ "$RESULT_FILE" = ".ephemeral/retained.json" ]',
      '[ -z "${HEAD_SHA:-}" ]',
      'echo "consumed integrity conflict" >&2',
      "exit 1",
    ]);
    await expect(
      runWrapper(root, script, "read-result-for-baseline", [], {
        RESULT_FILE: ".ephemeral/retained.json",
        HEAD_SHA: "",
      }),
    ).rejects.toMatchObject({ stderr: "consumed integrity conflict\n" });
  });

  it("forwards replace-findings stdin and its public environment", async () => {
    const { root, runtime, script } = await createInstalledWrapper(
      helperScript,
      "pr-review/scripts/review-manifests.sh",
    );
    await writeRuntime(runtime, [
      '[ "$1" = "runtime" ]',
      '[ "$2" = "pr-review-manifests" ]',
      '[ "$3" = "replace-findings" ]',
      '[ "$PLAY_REVIEW_HELPER" = "/tmp/public-play-review-helper" ]',
      "cat",
    ]);

    await expect(
      runWrapperWithStdin(
        root,
        script,
        "replace-findings",
        '{"schema":"play-review/findings/v3"}',
        { PLAY_REVIEW_HELPER: "/tmp/public-play-review-helper" },
      ),
    ).resolves.toEqual({
      stdout: '{"schema":"play-review/findings/v3"}',
      stderr: "",
    });
  });

  it("preserves a runtime refusal for invalid public arguments", async () => {
    const { root, runtime, script } = await createInstalledWrapper(
      helperScript,
      "pr-review/scripts/review-manifests.sh",
    );
    await writeRuntime(runtime, [
      '[ "$1" = "runtime" ]',
      '[ "$2" = "pr-review-manifests" ]',
      '[ "$3" = "replace-findings" ]',
      '[ "$4" = "unexpected" ]',
      'echo "replace-findings does not accept arguments" >&2',
      "exit 1",
    ]);

    await expect(
      runWrapper(root, script, "replace-findings", ["unexpected"]),
    ).rejects.toMatchObject({
      stderr: "replace-findings does not accept arguments\n",
    });
  });

  it("routes lease status and audit failure through the installed sibling runtime", async () => {
    const { root, runtime, script } = await createInstalledWrapper(
      leaseHelperScript,
      "pr-review/scripts/review-leases.sh",
    );
    await writeRuntime(runtime, ['printf "runtime %s\\n" "$*"']);

    await expect(
      runWrapper(root, script, "read-status"),
    ).resolves.toMatchObject({
      stdout: "runtime runtime pr-review-leases read-status\n",
    });
    await expect(
      runWrapper(root, script, "record-audit-failure"),
    ).resolves.toMatchObject({
      stdout: "runtime runtime pr-review-leases record-audit-failure\n",
    });
  });
});
