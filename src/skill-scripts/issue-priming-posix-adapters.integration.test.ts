import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
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

async function resolveVerifiedBash(): Promise<string> {
  if (process.platform !== "win32") {
    await execFileAsync("bash", ["-lc", "command -v bash >/dev/null 2>&1"]);
    return "bash";
  }

  const { stdout } = await execFileAsync("where.exe", ["git.exe"]);
  const candidates = new Set<string>();
  for (const gitExecutable of stdout
    .split(/\r?\n/gu)
    .filter((entry) => path.win32.isAbsolute(entry))) {
    const gitDirectory = path.win32.dirname(gitExecutable);
    candidates.add(path.win32.resolve(gitDirectory, "..", "bin", "bash.exe"));
    candidates.add(
      path.win32.resolve(gitDirectory, "..", "usr", "bin", "bash.exe"),
    );
  }
  for (const candidate of candidates) {
    try {
      if (!(await lstat(candidate)).isFile()) continue;
      await execFileAsync(candidate, [
        "-lc",
        "builtin pwd -W >/dev/null 2>&1 && command -v cygpath >/dev/null 2>&1",
      ]);
      return await realpath(candidate);
    } catch {}
  }
  throw new Error(
    "Git-for-Windows Bash is unavailable; POSIX adapter parity cannot be verified",
  );
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execFileAsync("git", args, { cwd })).stdout.trim();
}

async function workspace(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devcanon adapter parity "));
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

async function runNode(
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

async function runAdapter(
  bash: string,
  helper: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
) {
  return execFileAsync(bash, [path.join(helperRoot, `${helper}.sh`), ...args], {
    cwd,
    env: { ...process.env, ...env },
  });
}

describe("issue-priming POSIX adapters", () => {
  it("preserves canonical behavior and output contracts through verified Bash", async () => {
    const bash = await resolveVerifiedBash();
    const cwd = await workspace();
    const issueBody = ".ephemeral/2026-08-25-eng-123-issue-body.md";
    const plan = ".ephemeral/2026-08-25-eng-123-plan.md";
    await writeFile(path.join(cwd, ...issueBody.split("/")), "# Issue\n");
    await writeFile(path.join(cwd, ...plan.split("/")), "# Plan\n");

    const cases = [
      ["phase-artifacts", ["validate-read", "issue-body", issueBody], {}],
      [
        "write-research-brief",
        [],
        { ISSUE_IDENTIFIER: "ENG-123", ISSUE_PRIMING_TODAY: "2026-08-25" },
      ],
      ["write-auto-handoff", [], { PLAN_PATH: plan }],
      ["write-assumptions-comment", [], { ISSUE_IDENTIFIER: "ENG-123" }],
    ] as const;
    for (const [helper, args, env] of cases) {
      const canonical = await runNode(helper, args, cwd, env);
      const adapted = await runAdapter(bash, helper, args, cwd, env);
      expect(adapted, helper).toEqual(canonical);
    }

    const captured = await runNode("source-immutability", ["capture"], cwd);
    const baseline = captured.stdout.trim();
    await expect(
      runAdapter(
        bash,
        "source-immutability",
        ["verify", "--baseline", baseline],
        cwd,
      ),
    ).resolves.toMatchObject({ stdout: "unchanged\n", stderr: "" });
    await expect(
      runAdapter(
        bash,
        "source-immutability",
        ["cleanup", "--baseline", baseline],
        cwd,
      ),
    ).resolves.toMatchObject({ stdout: "cleaned\n", stderr: "" });
  });
});
