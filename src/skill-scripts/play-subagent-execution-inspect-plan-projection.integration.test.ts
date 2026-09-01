import { execFile } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  canCreateSymlinks,
  cleanupTempDir,
  createTempDir,
} from "../__test-helpers__/fixtures.js";

const execFileAsync = promisify(execFile);
const helperRelativePath =
  "skills/play-subagent-execution/scripts/inspect-plan-projection.sh";
const usageRelativePath =
  "skills/play-subagent-execution/references/inspect-plan-projection-usage.md";
const symlinkAvailable = await canCreateSymlinks();

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

async function runHelper(
  helperPath: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "bash",
      [helperPath, ...args],
      {
        env: { ...process.env, ...env },
      },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const commandError = error as NodeJS.ErrnoException & {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: typeof commandError.code === "number" ? commandError.code : 1,
      stdout: commandError.stdout ?? "",
      stderr: commandError.stderr ?? "",
    };
  }
}

async function createRuntimeFixture(skillsRoot: string): Promise<void> {
  const runtimeScript = path.join(
    skillsRoot,
    "devcanon-runtime/scripts/devcanon-runtime.sh",
  );
  await mkdir(path.dirname(runtimeScript), { recursive: true });
  await writeFile(
    runtimeScript,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'if [ "${1:-}" = "resolve-entrypoint" ]; then',
      '  printf "%s\\n" "$(cd "$(dirname "$0")" && pwd -P)/devcanon-runtime.sh"',
      "  exit 0",
      "fi",
      'printf "%s\\n" "$*" >> "$RUNTIME_CALL_LOG"',
      'printf "%s" "${RUNTIME_STDOUT:-}"',
      'printf "%s" "${RUNTIME_STDERR:-}" >&2',
      'exit "${RUNTIME_EXIT_CODE:-0}"',
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(runtimeScript, 0o755);
}

async function createSourceLayout(root: string): Promise<string> {
  const skillsRoot = path.join(root, "skills");
  const helperPath = path.join(root, helperRelativePath);
  const usagePath = path.join(root, usageRelativePath);
  await mkdir(path.dirname(helperPath), { recursive: true });
  await mkdir(path.dirname(usagePath), { recursive: true });
  await cp(path.resolve(helperRelativePath), helperPath);
  await cp(path.resolve(usageRelativePath), usagePath);
  await chmod(helperPath, 0o755);
  await createRuntimeFixture(skillsRoot);
  return helperPath;
}

describe("play-subagent-execution inspect-plan-projection helper", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((directory) => cleanupTempDir(directory)));
    tempDirs.length = 0;
  });

  it("forwards the exact runtime operation and its channels from source and copied sibling layouts", async () => {
    const tempDir = await createTempDir();
    tempDirs.push(tempDir);
    const sourceRoot = path.join(tempDir, "source");
    const sourceHelper = await createSourceLayout(sourceRoot);
    const copiedRoot = path.join(tempDir, "copied");
    await cp(sourceRoot, copiedRoot, { recursive: true });
    const expectedStdout =
      '{"schema":"planning-projection/v1","plan_path":".ephemeral/651-plan.md","projection":{"start":0,"end":0,"entries":[]},"tasks":[]}\n';
    const expectedStderr =
      '{"ok":false,"code":"execution-projection-missing","message":"missing"}\n';

    for (const helperPath of [
      sourceHelper,
      path.join(copiedRoot, helperRelativePath),
    ]) {
      const callLog = path.join(
        path.dirname(path.dirname(helperPath)),
        "calls.log",
      );
      const success = await runHelper(
        helperPath,
        ["--path", ".ephemeral/651-plan.md"],
        {
          RUNTIME_CALL_LOG: callLog,
          RUNTIME_STDOUT: expectedStdout,
        },
      );
      expect(success).toEqual({
        code: 0,
        stdout: expectedStdout,
        stderr: "",
      });
      expect(await readFile(callLog, "utf8")).toBe(
        "runtime planning-projection inspect --path .ephemeral/651-plan.md\n",
      );

      const failure = await runHelper(
        helperPath,
        ["--path", ".ephemeral/651-plan.md"],
        {
          RUNTIME_CALL_LOG: callLog,
          RUNTIME_STDERR: expectedStderr,
          RUNTIME_EXIT_CODE: "23",
        },
      );
      expect(failure).toEqual({
        code: 23,
        stdout: "",
        stderr: expectedStderr,
      });
    }
  });

  it.skipIf(!symlinkAvailable)(
    "uses the physical sibling runtime when the helper skill is symlinked",
    async () => {
      const tempDir = await createTempDir();
      tempDirs.push(tempDir);
      const sourceRoot = path.join(tempDir, "source");
      const sourceHelper = await createSourceLayout(sourceRoot);
      const linkedSkillsRoot = path.join(tempDir, "linked", "skills");
      await mkdir(linkedSkillsRoot, { recursive: true });
      await symlink(
        path.join(sourceRoot, "skills/play-subagent-execution"),
        path.join(linkedSkillsRoot, "play-subagent-execution"),
        "dir",
      );
      const callLog = path.join(tempDir, "symlink-calls.log");
      const linkedHelper = path.join(
        linkedSkillsRoot,
        "play-subagent-execution/scripts/inspect-plan-projection.sh",
      );

      const result = await runHelper(
        linkedHelper,
        ["--path", ".ephemeral/651-plan.md"],
        {
          RUNTIME_CALL_LOG: callLog,
          RUNTIME_STDOUT: '{"schema":"planning-projection/v1"}\n',
        },
      );

      expect(result).toEqual({
        code: 0,
        stdout: '{"schema":"planning-projection/v1"}\n',
        stderr: "",
      });
      expect(await readFile(callLog, "utf8")).toBe(
        "runtime planning-projection inspect --path .ephemeral/651-plan.md\n",
      );
      expect(sourceHelper).toContain("source");
    },
  );

  it("honors an override-only runtime layout and preserves its channels", async () => {
    const tempDir = await createTempDir();
    tempDirs.push(tempDir);
    const helperRoot = path.join(tempDir, "isolated");
    const helperPath = path.join(helperRoot, helperRelativePath);
    const usagePath = path.join(helperRoot, usageRelativePath);
    await mkdir(path.dirname(helperPath), { recursive: true });
    await mkdir(path.dirname(usagePath), { recursive: true });
    await cp(path.resolve(helperRelativePath), helperPath);
    await cp(path.resolve(usageRelativePath), usagePath);
    await chmod(helperPath, 0o755);

    const overrideSkillsRoot = path.join(tempDir, "override-skills");
    await createRuntimeFixture(overrideSkillsRoot);
    const runtimeOverride = path.join(overrideSkillsRoot, "devcanon-runtime");
    const callLog = path.join(tempDir, "override-calls.log");
    const stderr =
      '{"ok":false,"code":"execution-projection-missing","message":"missing"}\n';

    const result = await runHelper(
      helperPath,
      ["--path", ".ephemeral/651-plan.md"],
      {
        DEVCANON_RUNTIME_DIR: runtimeOverride,
        RUNTIME_CALL_LOG: callLog,
        RUNTIME_STDERR: stderr,
        RUNTIME_EXIT_CODE: "23",
      },
    );

    expect(result).toEqual({ code: 23, stdout: "", stderr });
    expect(await readFile(callLog, "utf8")).toBe(
      "runtime planning-projection inspect --path .ephemeral/651-plan.md\n",
    );
  });

  it("lets an invalid override shadow a valid sibling with the stable refusal", async () => {
    const tempDir = await createTempDir();
    tempDirs.push(tempDir);
    const helperPath = await createSourceLayout(path.join(tempDir, "source"));
    const invalidOverride = path.join(tempDir, "invalid-runtime");

    const result = await runHelper(
      helperPath,
      ["--path", ".ephemeral/651-plan.md"],
      { DEVCANON_RUNTIME_DIR: invalidOverride },
    );

    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr:
        "devcanon-runtime resolver missing for play-subagent-execution projection inspection\n",
    });
  });

  it("refuses every argument form except one nonempty --path and derives help from the adjacent usage document", async () => {
    const tempDir = await createTempDir();
    tempDirs.push(tempDir);
    const helperPath = await createSourceLayout(path.join(tempDir, "source"));
    const usagePath = path.join(tempDir, "source", usageRelativePath);

    for (const args of [
      [],
      ["--path"],
      ["--path", ""],
      [".ephemeral/651-plan.md"],
      ["--path", ".ephemeral/651-plan.md", "extra"],
    ]) {
      const result = await runHelper(helperPath, args);
      expect(result.code).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toBe("");
    }

    const help = await runHelper(helperPath, ["--help"]);
    expect(help).toEqual({
      code: 0,
      stdout: await readFile(usagePath, "utf8"),
      stderr: "",
    });
    const extraHelp = await runHelper(helperPath, ["--help", "extra"]);
    expect(extraHelp.code).not.toBe(0);
    expect(extraHelp.stdout).toBe("");
  });
});
