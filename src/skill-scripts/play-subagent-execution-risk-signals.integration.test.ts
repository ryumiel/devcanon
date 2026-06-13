import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
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
  "skills/play-subagent-execution/scripts/write-risk-signals.sh",
);
const validatorScript = path.join(
  process.cwd(),
  "skills/play-validate-review-artifacts/scripts/review-artifacts.sh",
);
const symlinkAvailable = await canCreateSymlinks();

type Workspace = {
  cwd: string;
  baseSha: string;
  headSha: string;
  branchName: string;
};

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function makeGitWorkspace(
  branchName = "topic/feature",
): Promise<Workspace> {
  const cwd = await mkdtemp(
    path.join(os.tmpdir(), "devcanon-executor-risk-signals-"),
  );
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd,
  });
  await writeFile(path.join(cwd, "README.md"), "baseline\n");
  await execFileAsync("git", ["add", "README.md"], { cwd });
  await execFileAsync("git", ["commit", "-m", "chore: baseline"], { cwd });
  const baseSha = await git(cwd, "rev-parse", "HEAD");

  await execFileAsync("git", ["switch", "-c", branchName], { cwd });
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await writeFile(path.join(cwd, "src/app.ts"), "export const value = 1;\n");
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync("git", ["commit", "-m", "feat: add app"], { cwd });
  const headSha = await git(cwd, "rev-parse", "HEAD");
  await mkdir(path.join(cwd, ".ephemeral"));
  return { cwd, baseSha, headSha, branchName };
}

function signalValues(overrides: Record<string, string> = {}): string {
  return JSON.stringify({
    user_facing_behavior: "none",
    documentation_examples: "unknown",
    diagnostics: "none",
    contract: "present",
    generated_output: "none",
    governance_path: "present",
    ...overrides,
  });
}

function envFor(
  workspace: Workspace,
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    RISK_SIGNALS_REVIEWED_BASE_REF: "main",
    RISK_SIGNALS_REVIEWED_BASE_SHA: workspace.baseSha,
    RISK_SIGNALS_REVIEWED_HEAD_SHA: workspace.headSha,
    RISK_SIGNALS_REVIEWED_RANGE: "main...HEAD",
    RISK_SIGNALS_CHANGED_FILES_JSON: JSON.stringify(["src/app.ts"]),
    RISK_SIGNALS_VALUES_JSON: signalValues(),
    RISK_SIGNALS_CANONICAL_DOCS_MAY_BE_AFFECTED: "true",
    RISK_SIGNALS_END_USER_DIAGNOSTICS_MAY_BE_AFFECTED: "false",
    RISK_SIGNALS_EVIDENCE_SOURCE_PATH: ".ephemeral/example-plan.md",
    RISK_SIGNALS_EVIDENCE_SOURCE_SUMMARY:
      "Derived from executor terminal handoff state.",
    ...overrides,
  };
}

function omitKey(
  value: Record<string, string>,
  omittedKey: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== omittedKey),
  );
}

function sanitizeSlug(branchName: string): string {
  const slug = branchName.replaceAll(/[^A-Za-z0-9._-]/g, "-");
  if (
    slug.length === 0 ||
    slug === "." ||
    slug === ".." ||
    slug.includes("..") ||
    slug.startsWith("-") ||
    slug.startsWith(".")
  ) {
    return "unnamed";
  }
  return slug;
}

function riskSignalsPath(
  workspace: Workspace,
  slug = sanitizeSlug(workspace.branchName),
) {
  return `.ephemeral/${slug}-${workspace.headSha}-risk-signals.json`;
}

async function runHelper(
  workspace: Workspace,
  env: Record<string, string> = envFor(workspace),
) {
  return execFileAsync("bash", [helperScript], {
    cwd: workspace.cwd,
    env: { ...process.env, ...env },
    maxBuffer: 1024 * 1024,
  });
}

async function runValidator(workspace: Workspace, riskSignalsFile: string) {
  return execFileAsync(
    "bash",
    [
      validatorScript,
      "validate-risk-signals",
      "--surface",
      "branch-review",
      "--head-sha",
      workspace.headSha,
      "--risk-signals-file",
      riskSignalsFile,
      "--expected-schema",
      "branch-review/risk-signals/v1",
      "--expected-reviewed-range",
      "main...HEAD",
    ],
    {
      cwd: workspace.cwd,
      env: process.env,
      maxBuffer: 1024 * 1024,
    },
  );
}

async function readJson(cwd: string, relPath: string) {
  return JSON.parse(await readFile(path.join(cwd, relPath), "utf8"));
}

describe("play-subagent-execution risk-signals producer", () => {
  it("writes a valid artifact on a normal branch slug and prints the exact notice", async () => {
    const workspace = await makeGitWorkspace();
    try {
      const relPath = riskSignalsPath(workspace);
      await expect(runHelper(workspace)).resolves.toMatchObject({
        stdout: `Risk signals written to ${relPath}.\n`,
        stderr: "",
      });
      await expect(runValidator(workspace, relPath)).resolves.toMatchObject({
        stdout: "",
        stderr: "",
      });
      await expect(readJson(workspace.cwd, relPath)).resolves.toMatchObject({
        schema: "branch-review/risk-signals/v1",
        producer: "play-subagent-execution",
        evidence_source: {
          kind: "executor-terminal-handoff",
          path: ".ephemeral/example-plan.md",
          summary: "Derived from executor terminal handoff state.",
        },
        canonical_docs_may_be_affected: true,
        end_user_diagnostics_may_be_affected: false,
      });
    } finally {
      await cleanupTempDir(workspace.cwd);
    }
  });

  it("uses detached as the slug for detached HEAD", async () => {
    const workspace = await makeGitWorkspace("topic");
    try {
      await execFileAsync("git", ["checkout", "--detach", workspace.headSha], {
        cwd: workspace.cwd,
      });
      const relPath = riskSignalsPath(workspace, "detached");
      await expect(runHelper(workspace)).resolves.toMatchObject({
        stdout: `Risk signals written to ${relPath}.\n`,
      });
      await expect(
        stat(path.join(workspace.cwd, relPath)),
      ).resolves.toMatchObject({
        isFile: expect.any(Function),
      });
    } finally {
      await cleanupTempDir(workspace.cwd);
    }
  });

  it("falls back to unnamed when the sanitized branch slug is invalid", async () => {
    const workspace = await makeGitWorkspace("!!!");
    try {
      const relPath = riskSignalsPath(workspace, "unnamed");
      await expect(runHelper(workspace)).resolves.toMatchObject({
        stdout: `Risk signals written to ${relPath}.\n`,
      });
      await expect(
        stat(path.join(workspace.cwd, relPath)),
      ).resolves.toBeTruthy();
    } finally {
      await cleanupTempDir(workspace.cwd);
    }
  });

  it("replaces unsupported characters between dots so the emitted path validates", async () => {
    const workspace = await makeGitWorkspace("a.@.b");
    try {
      const relPath = riskSignalsPath(workspace, "a.-.b");
      await expect(runHelper(workspace)).resolves.toMatchObject({
        stdout: `Risk signals written to ${relPath}.\n`,
        stderr: "",
      });
      expect(relPath).toMatch(/^\.ephemeral\/[^/]+-risk-signals\.json$/u);
      expect(relPath).toContain(workspace.headSha);
      expect(relPath).not.toContain("..");
      await expect(runValidator(workspace, relPath)).resolves.toMatchObject({
        stdout: "",
        stderr: "",
      });
      await expect(readJson(workspace.cwd, relPath)).resolves.toMatchObject({
        reviewed_head_sha: workspace.headSha,
        reviewed_range: "main...HEAD",
      });
    } finally {
      await cleanupTempDir(workspace.cwd);
    }
  });

  it("atomically overwrites an existing regular target only after validation succeeds", async () => {
    const workspace = await makeGitWorkspace();
    try {
      const relPath = riskSignalsPath(workspace);
      await writeFile(path.join(workspace.cwd, relPath), "old\n");
      await expect(runHelper(workspace)).resolves.toMatchObject({
        stdout: `Risk signals written to ${relPath}.\n`,
      });
      await expect(runValidator(workspace, relPath)).resolves.toMatchObject({
        stdout: "",
        stderr: "",
      });
      await expect(
        readFile(path.join(workspace.cwd, relPath), "utf8"),
      ).resolves.not.toBe("old\n");
    } finally {
      await cleanupTempDir(workspace.cwd);
    }
  });

  it("preserves an existing regular target when runtime validation fails", async () => {
    const workspace = await makeGitWorkspace();
    try {
      const relPath = riskSignalsPath(workspace);
      await writeFile(path.join(workspace.cwd, relPath), "old\n");
      await expect(
        runHelper(workspace, {
          ...envFor(workspace),
          RISK_SIGNALS_CHANGED_FILES_JSON: JSON.stringify(["README.md"]),
        }),
      ).rejects.toMatchObject({
        stdout: "",
        stderr: expect.not.stringContaining(
          `Risk signals written to ${relPath}.`,
        ),
      });
      await expect(
        readFile(path.join(workspace.cwd, relPath), "utf8"),
      ).resolves.toBe("old\n");
    } finally {
      await cleanupTempDir(workspace.cwd);
    }
  });

  it.skipIf(!symlinkAvailable)("rejects symlinked .ephemeral", async () => {
    const workspace = await makeGitWorkspace();
    const replacement = `${workspace.cwd}-ephemeral-target`;
    try {
      await rm(path.join(workspace.cwd, ".ephemeral"), { recursive: true });
      await mkdir(replacement);
      await symlink(replacement, path.join(workspace.cwd, ".ephemeral"));
      await expect(runHelper(workspace)).rejects.toMatchObject({
        stderr: expect.stringContaining(".ephemeral must be a directory"),
      });
    } finally {
      await cleanupTempDir(workspace.cwd);
      await cleanupTempDir(replacement);
    }
  });

  it.skipIf(!symlinkAvailable)(
    "rejects an existing symlink leaf target",
    async () => {
      const workspace = await makeGitWorkspace();
      try {
        const relPath = riskSignalsPath(workspace);
        await symlink("README.md", path.join(workspace.cwd, relPath));
        await expect(runHelper(workspace)).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "risk-signals target must be a regular file",
          ),
        });
      } finally {
        await cleanupTempDir(workspace.cwd);
      }
    },
  );

  it("rejects an existing directory leaf target", async () => {
    const workspace = await makeGitWorkspace();
    try {
      await mkdir(path.join(workspace.cwd, riskSignalsPath(workspace)));
      await expect(runHelper(workspace)).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "risk-signals target must be a regular file",
        ),
      });
    } finally {
      await cleanupTempDir(workspace.cwd);
    }
  });

  it("fails before write when a required environment input is missing", async () => {
    const workspace = await makeGitWorkspace();
    try {
      await expect(
        runHelper(
          workspace,
          omitKey(envFor(workspace), "RISK_SIGNALS_REVIEWED_BASE_SHA"),
        ),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "RISK_SIGNALS_REVIEWED_BASE_SHA is required",
        ),
      });
      await expect(
        stat(path.join(workspace.cwd, riskSignalsPath(workspace))),
      ).rejects.toBeTruthy();
    } finally {
      await cleanupTempDir(workspace.cwd);
    }
  });

  it("rejects missing signal keys", async () => {
    const workspace = await makeGitWorkspace();
    try {
      await expect(
        runHelper(workspace, {
          ...envFor(workspace),
          RISK_SIGNALS_VALUES_JSON: JSON.stringify(
            omitKey(JSON.parse(signalValues()), "contract"),
          ),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("RISK_SIGNALS_VALUES_JSON"),
      });
    } finally {
      await cleanupTempDir(workspace.cwd);
    }
  });

  it("rejects invalid signal values", async () => {
    const workspace = await makeGitWorkspace();
    try {
      await expect(
        runHelper(workspace, {
          ...envFor(workspace),
          RISK_SIGNALS_VALUES_JSON: signalValues({ diagnostics: "maybe" }),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("RISK_SIGNALS_VALUES_JSON"),
      });
    } finally {
      await cleanupTempDir(workspace.cwd);
    }
  });

  it("rejects invalid boolean environment values", async () => {
    const workspace = await makeGitWorkspace();
    try {
      await expect(
        runHelper(workspace, {
          ...envFor(workspace),
          RISK_SIGNALS_CANONICAL_DOCS_MAY_BE_AFFECTED: "yes",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "RISK_SIGNALS_CANONICAL_DOCS_MAY_BE_AFFECTED must be true or false",
        ),
      });
    } finally {
      await cleanupTempDir(workspace.cwd);
    }
  });

  it("prevents notice and leaves no accepted target when runtime validation fails", async () => {
    const workspace = await makeGitWorkspace();
    try {
      const relPath = riskSignalsPath(workspace);
      await expect(
        runHelper(workspace, {
          ...envFor(workspace),
          RISK_SIGNALS_CHANGED_FILES_JSON: JSON.stringify(["README.md"]),
        }),
      ).rejects.toMatchObject({
        stdout: "",
        stderr: expect.not.stringContaining(
          `Risk signals written to ${relPath}.`,
        ),
      });
      await expect(
        stat(path.join(workspace.cwd, relPath)),
      ).rejects.toBeTruthy();
    } finally {
      await cleanupTempDir(workspace.cwd);
    }
  });
});
