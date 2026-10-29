import { AsyncLocalStorage } from "node:async_hooks";
import { execFile, spawnSync } from "node:child_process";
import type { Dirent } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const localInspection = new AsyncLocalStorage<boolean>();

/** Scope implicit-fetch suppression to one cleanup invocation and its shared helpers. */
export function withoutLazyFetch<T>(operation: () => Promise<T>): Promise<T> {
  return localInspection.run(true, operation);
}

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
      [
        ...(localInspection.getStore() ? ["--no-lazy-fetch"] : []),
        "-C",
        cwd,
        ...args,
      ],
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

export async function collectWorktrees(
  cwd: string,
  includeUnavailable = false,
): Promise<WorktreeRecord[]> {
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
      } else if (includeUnavailable) {
        records.push(current);
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
      [
        "--no-optional-locks",
        "status",
        "--porcelain=v1",
        "--untracked-files=normal",
        "--ignore-submodules=none",
      ],
      worktreePath,
    )
  ).stdout.trim();
}

export async function resolveDefaultBranch(
  cwd: string,
): Promise<string | null> {
  const symbolicRef = await git(
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
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

/** Nested repositories need their own custody checks; superproject status can ignore them. */
export interface NestedRepositoryFact {
  path: string;
  kind: "submodule" | "embedded";
  gitDir: string;
  commonDir: string;
  reason: string;
}

export async function inspectNestedRepositories(
  worktree: string,
): Promise<NestedRepositoryFact[]> {
  const facts: NestedRepositoryFact[] = [];
  const worktreeGitDir = await realpath(
    (await git(["rev-parse", "--absolute-git-dir"], worktree)).stdout.trim(),
  );
  const privateModules = path.join(worktreeGitDir, "modules");

  async function gitlinks(repo: string): Promise<Set<string>> {
    const entries = (await git(["ls-files", "--stage", "-z"], repo)).stdout;
    return new Set(
      entries
        .split("\0")
        .filter((entry) => entry.startsWith("160000 "))
        .map((entry) =>
          path.resolve(repo, entry.slice(entry.indexOf("\t") + 1)),
        ),
    );
  }

  async function visit(directory: string, links: Set<string>): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".git" || !entry.isDirectory()) continue;
      const child = path.join(directory, entry.name);
      let markerExists = false;
      try {
        await lstat(path.join(child, ".git"));
        markerExists = true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      if (!markerExists) {
        // Bare embedded repositories have no .git marker but still carry local Git custody.
        try {
          await lstat(path.join(child, "HEAD"));
          markerExists =
            (await canonicalPath(path.join(child, "objects"))) !== null;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
      }
      if (!markerExists) {
        await visit(child, links);
        continue;
      }
      const kind = links.has(child) ? "submodule" : "embedded";
      let gitDir = "";
      let commonDir = "";
      let reason = "embedded-repository";
      try {
        gitDir = await realpath(
          (await git(["rev-parse", "--absolute-git-dir"], child)).stdout.trim(),
        );
        commonDir = await realpath(
          path.resolve(
            child,
            (await git(["rev-parse", "--git-common-dir"], child)).stdout.trim(),
          ),
        );
        if (kind === "submodule") {
          const relative = path.relative(privateModules, gitDir);
          // Only checkout-private administration may be removed. Never deinit: config is shared.
          if (
            relative.startsWith(`..${path.sep}`) ||
            relative === ".." ||
            path.isAbsolute(relative) ||
            commonDir !== gitDir
          ) {
            reason = "shared-or-external-submodule-git-dir";
          } else if ((await collectWorktrees(child)).length !== 1) {
            reason = "shared-submodule-worktrees";
          } else if (
            (
              await git(
                [
                  "--no-optional-locks",
                  "status",
                  "--porcelain=v1",
                  "--untracked-files=all",
                  "--ignored",
                  "--ignore-submodules=none",
                ],
                child,
              )
            ).stdout.trim()
          ) {
            reason = "dirty-or-untracked-submodule";
          } else {
            // Include refs, detached HEAD and reflogs, so a clean checkout cannot hide unpublished work.
            const localOnly = (
              await git(
                ["rev-list", "--all", "--reflog", "HEAD", "--not", "--remotes"],
                child,
              )
            ).stdout.trim();
            reason = localOnly
              ? "submodule-local-only-work"
              : "clean-initialized-submodule";
          }
        }
      } catch {
        reason = "nested-repository-inspection-failed";
      }
      facts.push({ path: child, kind, gitDir, commonDir, reason });
      // Do not follow an embedded repository's policy; it remains an unconditional blocker.
      if (kind === "submodule" && gitDir)
        await visit(child, await gitlinks(child));
    }
  }
  await visit(worktree, await gitlinks(worktree));
  // Deinitialized checkouts can still own cached refs/reflogs beneath their administration.
  // No working-tree marker means their custody cannot be established by the checks above.
  async function inspectCached(directory: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    const names = new Set(entries.map((entry) => entry.name));
    if (names.has("HEAD") && names.has("config")) {
      const actual = await realpath(directory);
      if (!facts.some((fact) => fact.gitDir === actual)) {
        facts.push({
          path: actual,
          kind: "submodule",
          gitDir: actual,
          commonDir: actual,
          reason: "uninitialized-submodule-administration",
        });
      }
      await inspectCached(path.join(directory, "modules"));
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory())
        await inspectCached(path.join(directory, entry.name));
    }
  }
  await inspectCached(privateModules);
  return facts;
}

export function nestedRepositoryBlocker(facts: NestedRepositoryFact[]): string {
  const blocked = facts.find(
    (fact) => fact.reason !== "clean-initialized-submodule",
  );
  return blocked ? `${blocked.reason}:${blocked.path}` : "";
}

/** Designation is explicit; ignoring a file does not make it disposable. */
export function validateDisposableDirectories(
  values: readonly string[],
): string[] {
  for (const value of values) {
    if (
      !value ||
      value.includes("\\") ||
      /[\r\n\0]/u.test(value) ||
      path.posix.isAbsolute(value) ||
      value
        .split("/")
        .some(
          (part) => !part || part === "." || part === ".." || part === ".git",
        )
    ) {
      throw new CleanupUsageError(
        "disposable directory must be a safe relative directory",
      );
    }
  }
  return [...new Set([".ephemeral", ...values])];
}

export async function ignoredContentBlocker(
  worktree: string,
  disposableDirectories: readonly string[] = [],
): Promise<string> {
  const directories = validateDisposableDirectories(disposableDirectories);
  // Enumerate leaves so a broad ignore rule cannot conceal unrelated user files.
  const ignored = (
    await git(
      ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"],
      worktree,
    )
  ).stdout
    .split("\0")
    .filter(Boolean);
  for (const file of ignored) {
    const directory = directories.find((candidate) =>
      file.startsWith(`${candidate}/`),
    );
    if (!directory) return `ignored-content:${file}`;
    // A designated directory must be a physical directory within this checkout.
    let current = worktree;
    for (const part of directory.split("/")) {
      current = path.join(current, part);
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        return `unsafe-disposable-directory:${directory}`;
    }
  }
  return "";
}

/** Read-only ancestry or squash-patch equivalence; never writes synthetic objects. */
export async function commitIsMerged(
  repo: string,
  commit: string,
  base: string,
): Promise<boolean> {
  if (
    (await git(["merge-base", "--is-ancestor", commit, base], repo, [0, 1]))
      .exitCode === 0
  )
    return true;
  const mergeBase = (
    await git(["merge-base", base, commit], repo, [0, 1])
  ).stdout.trim();
  if (!mergeBase) return false;
  const rawPatchOptions = [
    "--binary",
    "--no-textconv",
    "--no-ext-diff",
    "--ignore-submodules=none",
    "--submodule=short",
  ];
  const patch = (
    await git(["diff", ...rawPatchOptions, mergeBase, commit], repo)
  ).stdout;
  if (!patch.trim()) return false;
  const patchId = (input: string) => {
    const result = spawnSync("git", ["patch-id", "--stable"], {
      cwd: repo,
      input,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      shell: false,
      windowsHide: true,
    });
    if (result.status !== 0 || result.error)
      throw new Error("patch equivalence inspection failed");
    return result.stdout;
  };
  const expected = patchId(patch).split(/\s/u)[0];
  const history = (
    await git(
      [
        "log",
        "--no-merges",
        "--format=%H",
        ...rawPatchOptions,
        "-p",
        `${mergeBase}..${base}`,
      ],
      repo,
    )
  ).stdout;
  return (
    Boolean(expected) &&
    patchId(history)
      .split(/\r?\n/u)
      .some((line) => line.startsWith(`${expected} `))
  );
}

/** Called only for an authorized ordinary linked checkout, never a host lifecycle bypass. */
export async function removeLinkedWorktree(
  primary: string,
  target: string,
  allowDirty = false,
  disposableDirectories: readonly string[] = [],
  expected?: { head: string; branch: string },
): Promise<void> {
  const records = await collectWorktrees(primary);
  const canonicalTarget = await requireCanonicalDirectory(
    target,
    "cleanup target",
  );
  const record = records.find((entry) => entry.realPath === canonicalTarget);
  if (!record || record === records[0] || record.locked) {
    throw new Error(`protected or unregistered worktree: ${target}`);
  }
  if (
    expected &&
    (record.branch !== expected.branch ||
      (await revParse(canonicalTarget, "HEAD")) !== expected.head)
  ) {
    throw new Error("worktree identity changed before removal");
  }
  const nested = await inspectNestedRepositories(canonicalTarget);
  const blocker = nestedRepositoryBlocker(nested);
  if (blocker) throw new Error(blocker);
  const ignoredBlocker = await ignoredContentBlocker(
    canonicalTarget,
    disposableDirectories,
  );
  if (ignoredBlocker) throw new Error(ignoredBlocker);
  // Force is needed by Git for initialized submodules even when all nested work is clean.
  // It must not bypass the ordinary dirty-worktree authorization.
  if ((await worktreeStatus(canonicalTarget)) && !allowDirty) {
    throw new Error(`linked worktree became dirty before removal: ${target}`);
  }
  const removal = await git(
    [
      "worktree",
      "remove",
      ...(allowDirty || nested.length ? ["--force"] : []),
      canonicalTarget,
    ],
    primary,
    [0, 1, 2, 128, 255],
  );
  if (removal.exitCode !== 0) {
    throw new Error(
      `(exit code ${removal.exitCode})\n${removal.stderr.trimEnd()}`,
    );
  }
  let targetExists = false;
  try {
    await lstat(target);
    targetExists = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const remaining = await collectWorktrees(primary);
  if (targetExists || remaining.some((entry) => entry.path === record.path)) {
    throw new Error(`worktree removal not verified: ${target}`);
  }
  for (const unrelated of records.filter(
    (entry) => entry !== record && !entry.prunable,
  )) {
    if (
      !remaining.some(
        (entry) =>
          entry.realPath === unrelated.realPath &&
          entry.branch === unrelated.branch &&
          entry.locked === unrelated.locked,
      ) ||
      !(await canonicalPath(unrelated.realPath))
    ) {
      throw new Error(
        `unrelated worktree changed during removal: ${unrelated.path}`,
      );
    }
  }
}
