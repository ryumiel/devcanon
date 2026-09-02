import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = process.cwd();
const helperRoot = path.join(
  repositoryRoot,
  "skills/issue-priming-workflow/scripts",
);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execFileAsync("git", args, { cwd })).stdout.trim();
}

async function initializeRepository(prefix: string): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(cwd);
  await git(cwd, "init", "--initial-branch=main");
  await git(cwd, "config", "user.name", "Test User");
  await git(cwd, "config", "user.email", "test@example.com");
  await writeFile(path.join(cwd, ".gitignore"), ".ephemeral/\n");
  await writeFile(path.join(cwd, "README.md"), "baseline\n");
  await git(cwd, "add", ".gitignore", "README.md");
  await git(cwd, "commit", "-m", "chore: baseline");
  await mkdir(path.join(cwd, ".ephemeral"));
  return cwd;
}

async function poisonBash(directoryName: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "devcanon-bash-poison-"));
  tempDirs.push(root);
  const directory = path.join(root, directoryName);
  await mkdir(directory, { recursive: true });
  const executable = path.join(
    directory,
    process.platform === "win32" ? "bash.exe" : "bash",
  );
  await writeFile(executable, "inert launcher\n");
  if (process.platform !== "win32") await chmod(executable, 0o755);
  return directory;
}

async function runHelper(
  helper: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
) {
  return execFileAsync(
    process.execPath,
    [path.join(helperRoot, `${helper}.mjs`), ...args],
    { cwd, env: { ...process.env, ...env } },
  );
}

describe("issue-priming native Node helpers", () => {
  it.each(["fake-first", "WindowsApps"])(
    "runs without consulting an inert Bash in %s on PATH",
    async (directoryName) => {
      const cwd = await initializeRepository("devcanon native helpers ");
      const poisonedPath = await poisonBash(directoryName);
      const artifact = ".ephemeral/2026-08-25-eng-123-issue-body.md";
      await writeFile(path.join(cwd, ...artifact.split("/")), "# Issue\n");
      const env = {
        PATH: `${poisonedPath}${path.delimiter}${process.env.PATH ?? ""}`,
      };

      await expect(
        runHelper(
          "phase-artifacts",
          ["validate-read", "issue-body", artifact],
          cwd,
          env,
        ),
      ).resolves.toMatchObject({ stdout: "", stderr: "" });
      await expect(
        runHelper("write-research-brief", [], cwd, {
          ...env,
          ISSUE_IDENTIFIER: "ENG-123",
          ISSUE_PRIMING_TODAY: "2026-08-25",
        }),
      ).resolves.toMatchObject({
        stdout: ".ephemeral/2026-08-25-eng-123-research.md\n",
        stderr: "",
      });
    },
  );

  it("rejects zero-exit empty, malformed, and multiline path output", async () => {
    const cwd = await initializeRepository("devcanon output contract ");
    const runtime = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-fake-runtime-"),
    );
    tempDirs.push(runtime);
    const cli = path.join(runtime, "scripts/runtime/devcanon-runtime.mjs");
    await mkdir(path.dirname(cli), { recursive: true });

    for (const output of [
      "",
      "../outside\n",
      ".ephemeral/ok-research.md\nextra\n",
    ]) {
      await writeFile(
        cli,
        `process.stdout.write(${JSON.stringify(output)});\n`,
      );
      await expect(
        runHelper("write-research-brief", [], cwd, {
          DEVCANON_RUNTIME_DIR: runtime,
          ISSUE_IDENTIFIER: "ENG-123",
          ISSUE_PRIMING_TODAY: "2026-08-25",
        }),
      ).rejects.toMatchObject({
        code: 1,
        stdout: "",
        stderr: expect.stringContaining("missing or malformed path stdout"),
      });
    }

    await writeFile(
      cli,
      'process.stdout.write(".ephemeral/2026-08-25-eng-123-research.md\\n"); process.stderr.write("contradictory warning\\n");\n',
    );
    await expect(
      runHelper("write-research-brief", [], cwd, {
        DEVCANON_RUNTIME_DIR: runtime,
        ISSUE_IDENTIFIER: "ENG-123",
        ISSUE_PRIMING_TODAY: "2026-08-25",
      }),
    ).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: expect.stringContaining("returned unexpected stderr"),
    });
  });

  it("rejects zero-exit empty, malformed, and multiline source baselines", async () => {
    const cwd = await initializeRepository("devcanon baseline contract ");
    const runtime = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-fake-guard-runtime-"),
    );
    tempDirs.push(runtime);
    const cli = path.join(runtime, "scripts/runtime/devcanon-runtime.mjs");
    await mkdir(path.dirname(cli), { recursive: true });

    for (const output of [
      "",
      ".ephemeral/baseline.json\n",
      ".ephemeral/.devcanon-source-immutability-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json\nextra\n",
    ]) {
      await writeFile(
        cli,
        `process.stdout.write(${JSON.stringify(output)});\n`,
      );
      await expect(
        runHelper("source-immutability", ["capture"], cwd, {
          DEVCANON_RUNTIME_DIR: runtime,
        }),
      ).rejects.toMatchObject({
        code: 1,
        stdout: "",
        stderr: expect.stringContaining("missing or malformed path stdout"),
      });
    }
  });

  it("enforces the phase-artifact silent-success contract", async () => {
    const cwd = await initializeRepository("devcanon silent contract ");
    const runtime = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-fake-silent-runtime-"),
    );
    tempDirs.push(runtime);
    const cli = path.join(runtime, "scripts/runtime/devcanon-runtime.mjs");
    await mkdir(path.dirname(cli), { recursive: true });
    await writeFile(cli, 'process.stdout.write("unexpected\\n");\n');

    await expect(
      runHelper(
        "phase-artifacts",
        ["validate-read", "issue-body", ".ephemeral/unused-issue-body.md"],
        cwd,
        { DEVCANON_RUNTIME_DIR: runtime },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: expect.stringContaining("returned unexpected stdout"),
    });
  });

  it("handles a path with spaces and native managed-worktree .git metadata", async () => {
    const primary = await initializeRepository("devcanon primary repo ");
    const managedRoot = await mkdtemp(
      path.join(os.tmpdir(), "devcanon worktrees "),
    );
    tempDirs.push(managedRoot);
    const managed = path.join(managedRoot, "managed issue 123");
    await git(primary, "worktree", "add", "-b", "issue-123", managed);
    await mkdir(path.join(managed, ".ephemeral"));
    const artifact = ".ephemeral/2026-08-25-eng-123-issue-body.md";
    await writeFile(path.join(managed, ...artifact.split("/")), "# Issue\n");

    await expect(
      runHelper(
        "phase-artifacts",
        ["validate-read", "issue-body", artifact],
        managed,
      ),
    ).resolves.toMatchObject({ stdout: "", stderr: "" });

    const captured = await runHelper(
      "source-immutability",
      ["capture"],
      managed,
    );
    expect(captured.stdout).toMatch(
      /^\.ephemeral\/\.devcanon-source-immutability-[0-9a-f]{32}\.json\n$/u,
    );
    const baseline = captured.stdout.trim();
    await expect(
      runHelper(
        "source-immutability",
        ["verify", "--baseline", baseline],
        managed,
      ),
    ).resolves.toMatchObject({ stdout: "unchanged\n", stderr: "" });
    await expect(
      runHelper(
        "source-immutability",
        ["cleanup", "--baseline", baseline],
        managed,
      ),
    ).resolves.toMatchObject({ stdout: "cleaned\n", stderr: "" });
  });

  it.skipIf(process.platform !== "win32")(
    "resolves usable Git Bash without trusting fake or WindowsApps PATH shims and fails when Git Bash is absent",
    async () => {
      const resolver = path.join(
        repositoryRoot,
        "skills/devcanon-runtime/scripts/resolve-bash.mjs",
      );
      const fakeFirst = await poisonBash("fake-first");
      const windowsApps = await poisonBash("WindowsApps");

      for (const poison of [fakeFirst, windowsApps]) {
        const resolved = await execFileAsync(process.execPath, [resolver], {
          env: {
            ...process.env,
            PATH: `${poison}${path.delimiter}${process.env.PATH ?? ""}`,
          },
        });
        expect(path.win32.isAbsolute(resolved.stdout.trim())).toBe(true);
        expect(resolved.stdout.toLowerCase()).not.toContain("windowsapps");
      }

      const valid = (
        await execFileAsync(process.execPath, [resolver], {
          env: process.env,
        })
      ).stdout.trim();
      await expect(
        execFileAsync(process.execPath, [resolver], {
          env: {
            ...process.env,
            DEVCANON_GIT_BASH: valid,
            PATH: fakeFirst,
          },
        }),
      ).resolves.toMatchObject({ stdout: `${valid}\n`, stderr: "" });

      await expect(
        execFileAsync(process.execPath, [resolver], {
          env: {
            SystemRoot: process.env.SystemRoot,
            PATH: windowsApps,
          },
        }),
      ).rejects.toMatchObject({
        code: 1,
        stdout: "",
        stderr: expect.stringContaining(
          "Git-for-Windows Bash is unavailable or unusable",
        ),
      });
    },
  );
});
