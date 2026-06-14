import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  symlink,
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
  "skills/play-branch-finish/scripts/branch-review-approval-gate.sh",
);

async function makeGitWorkspace() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devcanon-branch-gate-"));
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd,
  });
  await mkdir(path.join(cwd, ".ephemeral"));
  await writeFile(path.join(cwd, "README.md"), "baseline\n");
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync("git", ["commit", "-m", "chore: baseline"], { cwd });
  const headSha = await git(cwd, "rev-parse", "HEAD");
  return { cwd, headSha };
}

async function git(cwd: string, ...args: string[]) {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function writeApprovalSummary(cwd: string) {
  const file = ".ephemeral/topic-approval-summary.json";
  await writeFile(path.join(cwd, file), "{}\n");
  return file;
}

async function writeValidator(
  cwd: string,
  body: string[],
  filename = "validator.sh",
) {
  const script = path.join(cwd, filename);
  await writeFile(
    script,
    ["#!/usr/bin/env bash", "set -euo pipefail", ...body, ""].join("\n"),
  );
  await chmod(script, 0o755);
  return script;
}

async function writeMarkerValidator(cwd: string) {
  const markerFile = path.join(cwd, "validator-called");
  const validator = await writeValidator(cwd, [
    `touch ${JSON.stringify(markerFile)}`,
    'printf \'{"terminal_state":"approved","gate_result":"passing"}\\n\'',
  ]);
  return { markerFile, validator };
}

async function runHelper(
  cwd: string,
  env: Record<string, string | undefined> = {},
) {
  return execFileAsync("bash", [helperScript], {
    cwd,
    env: { ...process.env, ...env },
    maxBuffer: 1024 * 1024,
  });
}

function parseKeyValues(stdout: string) {
  const values: Record<string, string> = {};
  for (const line of stdout.trim().split("\n")) {
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

describe("play-branch-finish branch-review approval gate adapter", () => {
  it("succeeds as disabled when BRANCH_REVIEW_REQUIRED is absent", async () => {
    const { cwd } = await makeGitWorkspace();
    try {
      await expect(runHelper(cwd)).resolves.toMatchObject({
        stdout: "GATE_REQUIRED=false\n",
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("succeeds as disabled when BRANCH_REVIEW_REQUIRED is false", async () => {
    const { cwd } = await makeGitWorkspace();
    try {
      await expect(
        runHelper(cwd, { BRANCH_REVIEW_REQUIRED: "false" }),
      ).resolves.toMatchObject({
        stdout: "GATE_REQUIRED=false\n",
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("fails closed on invalid BRANCH_REVIEW_REQUIRED values", async () => {
    const { cwd } = await makeGitWorkspace();
    try {
      await expect(
        runHelper(cwd, { BRANCH_REVIEW_REQUIRED: "yes" }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "BRANCH_REVIEW_REQUIRED must be true or false",
        ),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("requires APPROVAL_SUMMARY_FILE before invoking the validator", async () => {
    const { cwd } = await makeGitWorkspace();
    const { markerFile, validator } = await writeMarkerValidator(cwd);
    try {
      await expect(
        runHelper(cwd, {
          BRANCH_REVIEW_REQUIRED: "true",
          PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: validator,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("APPROVAL_SUMMARY_FILE is required"),
      });
      await expect(readFile(markerFile, "utf8")).rejects.toThrow();
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects nested approval summary paths before invoking the validator", async () => {
    const { cwd } = await makeGitWorkspace();
    const { markerFile, validator } = await writeMarkerValidator(cwd);
    await mkdir(path.join(cwd, ".ephemeral", "nested"));
    await writeFile(
      path.join(cwd, ".ephemeral", "nested", "topic-approval-summary.json"),
      "{}\n",
    );
    try {
      await expect(
        runHelper(cwd, {
          BRANCH_REVIEW_REQUIRED: "true",
          APPROVAL_SUMMARY_FILE:
            ".ephemeral/nested/topic-approval-summary.json",
          PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: validator,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "nested approval summary path rejected",
        ),
      });
      await expect(readFile(markerFile, "utf8")).rejects.toThrow();
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects traversal approval summary paths before invoking the validator", async () => {
    const { cwd } = await makeGitWorkspace();
    const { markerFile, validator } = await writeMarkerValidator(cwd);
    await writeFile(
      path.join(cwd, ".ephemeral", "topic..-approval-summary.json"),
      "{}\n",
    );
    try {
      await expect(
        runHelper(cwd, {
          BRANCH_REVIEW_REQUIRED: "true",
          APPROVAL_SUMMARY_FILE: ".ephemeral/topic..-approval-summary.json",
          PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: validator,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("path traversal"),
      });
      await expect(readFile(markerFile, "utf8")).rejects.toThrow();
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects symlink approval summary paths before invoking the validator", async () => {
    const { cwd } = await makeGitWorkspace();
    const { markerFile, validator } = await writeMarkerValidator(cwd);
    await writeFile(path.join(cwd, "summary-target.json"), "{}\n");
    await symlink(
      path.join(cwd, "summary-target.json"),
      path.join(cwd, ".ephemeral", "topic-approval-summary.json"),
    );
    try {
      await expect(
        runHelper(cwd, {
          BRANCH_REVIEW_REQUIRED: "true",
          APPROVAL_SUMMARY_FILE: ".ephemeral/topic-approval-summary.json",
          PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: validator,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "approval summary must not be a symlink",
        ),
      });
      await expect(readFile(markerFile, "utf8")).rejects.toThrow();
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("invokes the validator and rejects blocking gate results", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    const approvalSummaryFile = await writeApprovalSummary(cwd);
    const argsFile = path.join(cwd, "validator-args.txt");
    const validator = await writeValidator(cwd, [
      `printf '%s\\n' "$@" > ${JSON.stringify(argsFile)}`,
      'printf \'{"terminal_state":"blocked","gate_result":"blocking"}\\n\'',
    ]);
    try {
      await expect(
        runHelper(cwd, {
          BRANCH_REVIEW_REQUIRED: "true",
          APPROVAL_SUMMARY_FILE: approvalSummaryFile,
          PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: validator,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("branch-review approval gate blocking"),
      });

      await expect(readFile(argsFile, "utf8")).resolves.toBe(
        [
          "validate-approval-summary",
          "--surface",
          "branch-review",
          "--head-sha",
          headSha,
          "--approval-summary-file",
          approvalSummaryFile,
          "--emit-gate-result",
          "",
        ].join("\n"),
      );
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("forwards configured path pattern to the approval summary validator when set", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    const approvalSummaryFile = await writeApprovalSummary(cwd);
    const argsFile = path.join(cwd, "validator-args.txt");
    const validator = await writeValidator(cwd, [
      `printf '%s\\n' "$@" > ${JSON.stringify(argsFile)}`,
      'printf \'{"terminal_state":"approved","gate_result":"passing"}\\n\'',
    ]);
    try {
      await expect(
        runHelper(cwd, {
          BRANCH_REVIEW_REQUIRED: "true",
          APPROVAL_SUMMARY_FILE: approvalSummaryFile,
          BRANCH_REVIEW_FULL_REVIEW_PATH_PATTERN: "docs/specs/**",
          PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: validator,
        }),
      ).resolves.toMatchObject({
        stdout: expect.stringContaining("GATE_RESULT=passing"),
      });

      await expect(readFile(argsFile, "utf8")).resolves.toBe(
        [
          "validate-approval-summary",
          "--surface",
          "branch-review",
          "--head-sha",
          headSha,
          "--approval-summary-file",
          approvalSummaryFile,
          "--emit-gate-result",
          "--configured-path-pattern",
          "docs/specs/**",
          "",
        ].join("\n"),
      );
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("fails closed on malformed validator output", async () => {
    const { cwd } = await makeGitWorkspace();
    const approvalSummaryFile = await writeApprovalSummary(cwd);
    const validator = await writeValidator(cwd, ["printf 'not-json\\n'"]);
    try {
      await expect(
        runHelper(cwd, {
          BRANCH_REVIEW_REQUIRED: "true",
          APPROVAL_SUMMARY_FILE: approvalSummaryFile,
          PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: validator,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("validator output malformed"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("emits passing gate facts only when the validator approves current HEAD", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    const approvalSummaryFile = await writeApprovalSummary(cwd);
    const validator = await writeValidator(cwd, [
      'printf \'{"terminal_state":"approved","gate_result":"passing"}\\n\'',
    ]);
    try {
      const result = await runHelper(cwd, {
        BRANCH_REVIEW_REQUIRED: "true",
        APPROVAL_SUMMARY_FILE: approvalSummaryFile,
        PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: validator,
      });
      const values = parseKeyValues(result.stdout);

      expect(values.GATE_REQUIRED).toBe("true");
      expect(values.GATE_RESULT).toBe("passing");
      expect(values.APPROVED_HEAD_SHA).toBe(headSha);
      expect(result.stdout.trim().split("\n")).toHaveLength(3);
    } finally {
      await cleanupTempDir(cwd);
    }
  });
});
