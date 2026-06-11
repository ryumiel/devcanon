import { execFile, spawnSync } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface WorktreeRecord {
  path: string;
  realPath: string;
  branch: string;
  locked: boolean;
  lockedReason: string;
  prunable: boolean;
}

export async function git(
  args: readonly string[],
  cwd: string,
  allowExitCodes: readonly number[] = [0],
): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "git",
      ["-C", cwd, ...args],
      {
        cwd,
        encoding: "utf8",
        shell: false,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
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

export async function canonicalPath(
  targetPath: string,
): Promise<string | null> {
  if (targetPath.length === 0) {
    return null;
  }
  try {
    const stat = await lstat(targetPath);
    if (!stat.isDirectory()) {
      return null;
    }
    return await realpath(targetPath);
  } catch {
    return null;
  }
}

export async function requireCanonicalDirectory(
  targetPath: string,
  label: string,
): Promise<string> {
  const resolved = await canonicalPath(targetPath);
  if (resolved === null) {
    throw new CleanupUsageError(
      `${label} does not resolve to a directory: ${targetPath}`,
    );
  }
  return resolved;
}

export async function isInsideWorktree(cwd: string): Promise<boolean> {
  const result = await git(
    ["rev-parse", "--is-inside-work-tree"],
    cwd,
    [0, 128],
  );
  return result.exitCode === 0 && result.stdout.trim() === "true";
}

export async function isBareRepository(cwd: string): Promise<boolean> {
  const result = await git(
    ["rev-parse", "--is-bare-repository"],
    cwd,
    [0, 128],
  );
  return result.exitCode !== 0 || result.stdout.trim() === "true";
}

export async function showTopLevel(cwd: string): Promise<string> {
  return stripGitLineEnding(
    (await git(["rev-parse", "--show-toplevel"], cwd)).stdout,
  );
}

export async function currentBranch(cwd: string): Promise<string> {
  const result = await git(
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    cwd,
    [0, 1],
  );
  return result.exitCode === 0 ? result.stdout.trim() : "";
}

export async function collectWorktrees(cwd: string): Promise<WorktreeRecord[]> {
  const result = await git(["worktree", "list", "--porcelain", "-z"], cwd);
  const records: WorktreeRecord[] = [];
  let current: WorktreeRecord | null = null;

  async function append(): Promise<void> {
    if (current === null) {
      return;
    }
    if (current.prunable) {
      records.push(current);
    } else {
      const real = await canonicalPath(current.path);
      if (real !== null) {
        records.push({ ...current, realPath: real });
      }
    }
    current = null;
  }

  for (const field of result.stdout.split("\0")) {
    if (field.length === 0) {
      continue;
    }
    if (field.startsWith("worktree ")) {
      await append();
      const worktreePath = field.slice("worktree ".length);
      current = {
        path: worktreePath,
        realPath: worktreePath,
        branch: "",
        locked: false,
        lockedReason: "",
        prunable: false,
      };
    } else if (current !== null && field.startsWith("branch refs/heads/")) {
      current.branch = field.slice("branch refs/heads/".length);
    } else if (current !== null && field.startsWith("locked")) {
      current.locked = true;
      current.lockedReason = field.slice("locked".length).trimStart();
    } else if (current !== null && field.startsWith("prunable")) {
      current.prunable = true;
    }
  }
  await append();
  return records;
}

export async function worktreeStatus(worktreePath: string): Promise<string> {
  return (
    await git(
      ["status", "--porcelain=v1", "--untracked-files=normal"],
      worktreePath,
    )
  ).stdout.trim();
}

export async function resolveDefaultBranch(
  cwd: string,
): Promise<string | null> {
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
  return null;
}

export async function localBranches(cwd: string): Promise<string[]> {
  const result = await git(
    ["for-each-ref", "--format=%(refname)", "refs/heads"],
    cwd,
  );
  return result.stdout.split(/\r?\n/u).filter(Boolean);
}

export async function showRefExists(
  cwd: string,
  ref: string,
): Promise<boolean> {
  return (
    (await git(["show-ref", "--verify", "--quiet", ref], cwd, [0, 1]))
      .exitCode === 0
  );
}

export async function revParse(cwd: string, rev: string): Promise<string> {
  return (await git(["rev-parse", rev], cwd)).stdout.trim();
}

export async function validateBranchName(value: string): Promise<boolean> {
  if (
    value.length === 0 ||
    value.startsWith("-") ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return false;
  }
  return (
    execFileSyncStatus("git", ["check-ref-format", "--branch", value]) === 0
  );
}

export function validateSha(value: string): boolean {
  return /^[0-9a-f]{40}$/u.test(value);
}

export async function normalizeRemoteUrl(value: string): Promise<string> {
  let remoteUrl = value;
  if (remoteUrl.startsWith("git@github.com:")) {
    remoteUrl = `https://github.com/${remoteUrl.slice("git@github.com:".length)}`;
  } else if (remoteUrl.startsWith("ssh://git@github.com/")) {
    remoteUrl = `https://github.com/${remoteUrl.slice("ssh://git@github.com/".length)}`;
  } else if (remoteUrl.startsWith("file://")) {
    remoteUrl = remoteUrl.slice("file://".length);
  }

  if (path.isAbsolute(remoteUrl)) {
    const resolved = await canonicalPath(remoteUrl);
    if (resolved !== null) {
      return resolved;
    }
  }

  return remoteUrl.replace(/\/$/u, "").replace(/\.git$/u, "");
}

export function countStatusLines(status: string): number {
  return status.length === 0 ? 0 : status.split(/\r?\n/u).length;
}

export function stripGitLineEnding(value: string): string {
  return value.replace(/\r?\n$/u, "");
}

export function lineOutput(
  fields: Array<[string, string | number | boolean]>,
): string {
  return `${fields.map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
}

export class CleanupUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CleanupUsageError";
  }
}

function execFileSyncStatus(command: string, args: readonly string[]): number {
  const child = spawnSync(command, [...args], {
    shell: false,
    windowsHide: true,
  });
  return child.status ?? 1;
}
