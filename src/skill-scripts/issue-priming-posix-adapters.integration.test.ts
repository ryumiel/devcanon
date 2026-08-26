import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = process.cwd();
const bashResolver = path.join(
  repositoryRoot,
  "skills/devcanon-runtime/scripts/resolve-bash.mjs",
);
const { stdout: resolvedBash } = await execFileAsync(process.execPath, [
  bashResolver,
]);
const bashExecutable = resolvedBash.trim();
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
      const adapted = await runAdapter(bashExecutable, helper, args, cwd, env);
      expect(adapted, helper).toEqual(canonical);
    }

    const captured = await runNode("source-immutability", ["capture"], cwd);
    const baseline = captured.stdout.trim();
    await expect(
      runAdapter(
        bashExecutable,
        "source-immutability",
        ["verify", "--baseline", baseline],
        cwd,
      ),
    ).resolves.toMatchObject({ stdout: "unchanged\n", stderr: "" });
    await expect(
      runAdapter(
        bashExecutable,
        "source-immutability",
        ["cleanup", "--baseline", baseline],
        cwd,
      ),
    ).resolves.toMatchObject({ stdout: "cleaned\n", stderr: "" });
  });
});
