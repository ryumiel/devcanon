import { execFile, spawnSync } from "node:child_process";
import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { RuntimeCommandOutcome } from "./command.js";

const execFileAsync = promisify(execFile);

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runIssueWorktreeSetupCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<RuntimeCommandOutcome> {
  try {
    return await runIssueWorktreeSetup(args, env);
  } catch (err) {
    return plainFail((err as Error).message);
  }
}

async function runIssueWorktreeSetup(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<RuntimeCommandOutcome> {
  if (args.length > 0) {
    return plainFail("issue-worktree-setup does not accept arguments");
  }
  const branchName = requireEnv(env, "BRANCH_NAME");
  const worktreeLeaf = requireEnv(env, "WORKTREE_LEAF");

  validateBranchName(branchName);
  validateWorktreeLeaf(worktreeLeaf);

  const cwd = process.cwd();
  const currentWorktree = stripGitLineEnding(
    (await git(["rev-parse", "--show-toplevel"], cwd)).stdout,
  );
  const currentWorktreeReal = await realpath(currentWorktree);
  const gitCommonDir = stripGitLineEnding(
    (await git(["rev-parse", "--git-common-dir"], currentWorktree)).stdout,
  );
  if (isUnsupportedWindowsGitMetadata(gitCommonDir)) {
    return plainFail(
      `issue-worktree-setup cannot run POSIX/WSL Git against Windows Git metadata (${gitCommonDir}). Re-run from native Windows Codex/worktree tooling or from a native Windows shell with node setup-worktree.mjs.`,
    );
  }
  const currentStatus = (
    await git(["status", "--short"], currentWorktree)
  ).stdout.trim();

  const baseRef =
    env.BASE_REF ?? `origin/${await defaultBranch(currentWorktree)}`;
  validateBaseRef(baseRef);

  const superproject = stripGitLineEnding(
    (
      await git(
        ["rev-parse", "--show-superproject-working-tree"],
        currentWorktree,
        [0, 128],
      )
    ).stdout,
  );
  if (superproject.length > 0) {
    const superprojectReal = await realpath(superproject);
    return lineOk({
      MODE: "stop",
      WORKTREE_PATH: currentWorktree,
      MESSAGE: `Running issue-worktree-setup from inside submodule ${currentWorktreeReal} is unsupported; re-run from superproject ${superprojectReal}.`,
    });
  }

  const mainWorktree = await primaryWorktree(currentWorktree);
  const mainWorktreeReal = await realpath(mainWorktree);

  await git(["fetch", "origin"], currentWorktree);

  const resolvedBaseResult = await git(
    ["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`],
    cwd,
    [0, 1],
  );
  const resolvedBase = resolvedBaseResult.stdout.trim();
  if (resolvedBaseResult.exitCode !== 0 || resolvedBase.length === 0) {
    return plainFail(`Unable to resolve BASE_REF to a commit: ${baseRef}`);
  }

  if (
    (
      await git(
        ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
        currentWorktree,
        [0, 1],
      )
    ).exitCode === 0
  ) {
    return plainFail(`Branch already exists: ${branchName}`);
  }

  if (currentWorktreeReal !== mainWorktreeReal) {
    if (currentStatus.length === 0) {
      const ancestorResult = await git(
        ["merge-base", "--is-ancestor", "HEAD", resolvedBase],
        currentWorktree,
        [0, 1],
      );
      if (ancestorResult.exitCode === 0) {
        await git(
          ["checkout", "-b", branchName, resolvedBase],
          currentWorktree,
        );
        return lineOk({
          MODE: "reuse",
          WORKTREE_PATH: currentWorktree,
          MESSAGE: "Reused clean managed worktree.",
        });
      }
      if (ancestorResult.exitCode !== 1) {
        return plainFail(
          `git merge-base --is-ancestor failed unexpectedly (exit ${ancestorResult.exitCode})`,
        );
      }
    }

    return lineOk({
      MODE: "stop",
      WORKTREE_PATH: currentWorktree,
      MESSAGE:
        currentStatus.length > 0
          ? "Managed worktree has uncommitted changes; return to the primary checkout."
          : "Managed worktree has commits not in BASE_REF; return to the primary checkout.",
    });
  }

  const worktreesDir = path.join(currentWorktree, ".worktrees");
  const ignoreProbe = ".worktrees/.devcanon-ignore-probe";
  const ignoreResult = await git(
    ["-C", currentWorktree, "check-ignore", "-q", ignoreProbe],
    currentWorktree,
    [0, 1],
  );
  if (ignoreResult.exitCode !== 0) {
    return plainFail(
      "'.worktrees/' is not ignored in this repo.\nAdd '.worktrees/' to .gitignore and commit before re-running.",
    );
  }

  if (await isSymlink(worktreesDir)) {
    return plainFail(
      ".worktrees must be a normal directory inside the primary checkout.",
    );
  }

  await mkdir(worktreesDir, { recursive: true });
  const worktreesDirReal = await realpath(worktreesDir);
  const expectedWorktreesDirReal = path.join(currentWorktreeReal, ".worktrees");
  if (worktreesDirReal !== expectedWorktreesDirReal) {
    return plainFail(".worktrees resolved outside the primary checkout.");
  }

  const newWorktreePath = path.join(worktreesDir, worktreeLeaf);
  if (await pathExists(newWorktreePath)) {
    return plainFail(`Target worktree path already exists: ${newWorktreePath}`);
  }

  await git(
    ["worktree", "add", "-b", branchName, newWorktreePath, resolvedBase],
    currentWorktree,
  );

  return lineOk({
    MODE: "new",
    WORKTREE_PATH: newWorktreePath,
    MESSAGE: "Created new managed worktree.",
  });
}

async function defaultBranch(cwd: string): Promise<string> {
  const symbolicRef = await git(
    ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    cwd,
    [0, 1],
  );
  const symbolicBranch = symbolicRef.stdout.trim();
  if (symbolicBranch.length > 0) {
    return symbolicBranch.replace(/^origin\//u, "");
  }

  for (const fallback of ["main", "master"]) {
    const result = await git(
      ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${fallback}`],
      cwd,
      [0, 1],
    );
    if (result.exitCode === 0) {
      return fallback;
    }
  }

  return "main";
}

async function primaryWorktree(cwd: string): Promise<string> {
  const result = await git(["worktree", "list", "--porcelain", "-z"], cwd);
  for (const field of result.stdout.split("\0")) {
    if (field.startsWith("worktree ")) {
      return field.slice("worktree ".length);
    }
  }
  throw new Error("Unable to determine the primary worktree.");
}

async function git(
  args: readonly string[],
  cwd: string,
  allowExitCodes: readonly number[] = [0],
): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync("git", [...args], {
      cwd,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (err) {
    const error = err as NodeJS.ErrnoException & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    const exitCode =
      typeof error.code === "number" ? error.code : Number(error.code ?? 1);
    const result = {
      exitCode: Number.isFinite(exitCode) ? exitCode : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message,
    };
    if (allowExitCodes.includes(result.exitCode)) {
      return result;
    }
    throw new Error(result.stderr.trim() || error.message);
  }
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function validateBranchName(branchName: string) {
  validateNoLeadingDashOrLineBreak("BRANCH_NAME", branchName);
  const result = execFileSyncStatus("git", [
    "check-ref-format",
    "--branch",
    branchName,
  ]);
  if (result !== 0) {
    throw new Error(`Invalid BRANCH_NAME: ${branchName}`);
  }
}

function validateWorktreeLeaf(worktreeLeaf: string) {
  if (
    worktreeLeaf.length === 0 ||
    worktreeLeaf === "." ||
    path.isAbsolute(worktreeLeaf) ||
    worktreeLeaf.startsWith("-") ||
    worktreeLeaf.includes("/") ||
    worktreeLeaf.includes("\\") ||
    worktreeLeaf.includes("..") ||
    worktreeLeaf.includes("\n") ||
    worktreeLeaf.includes("\r")
  ) {
    throw new Error(`Unsafe WORKTREE_LEAF: ${worktreeLeaf}`);
  }
}

function validateBaseRef(baseRef: string) {
  validateNoLeadingDashOrLineBreak("BASE_REF", baseRef);
}

function validateNoLeadingDashOrLineBreak(name: string, value: string) {
  if (
    value.length === 0 ||
    value.startsWith("-") ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    throw new Error(`Unsafe ${name}: ${value}`);
  }
}

function execFileSyncStatus(command: string, args: readonly string[]): number {
  const child = spawnSync(command, [...args], {
    shell: false,
    windowsHide: true,
  });
  return child.status ?? 1;
}

function stripGitLineEnding(value: string): string {
  return value.replace(/\r?\n$/u, "");
}

export function isUnsupportedWindowsGitMetadata(
  gitCommonDir: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform === "win32") return false;
  return /^[A-Za-z]:[\\/]/u.test(gitCommonDir);
}

async function isSymlink(targetPath: string): Promise<boolean> {
  try {
    return (await lstat(targetPath)).isSymbolicLink();
  } catch {
    return false;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function lineOk(fields: Record<"MODE" | "WORKTREE_PATH" | "MESSAGE", string>) {
  return {
    exitCode: 0,
    stdout: `MODE=${fields.MODE}\nWORKTREE_PATH=${fields.WORKTREE_PATH}\nMESSAGE=${fields.MESSAGE}\n`,
    stderr: "",
  } as const;
}

function plainFail(message: string) {
  return {
    exitCode: 1,
    stdout: "",
    stderr: `${message}\n`,
  } as const;
}
