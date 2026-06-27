import { execFile } from "node:child_process";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ManagedWorktreeDiagnostics {
  status: "ok" | "warn";
  message: string;
  findings: string[];
}

interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function diagnoseManagedWorktrees(
  libraryRoot: string,
): Promise<ManagedWorktreeDiagnostics> {
  const worktreesDir = path.join(libraryRoot, ".worktrees");
  const worktreesStat = await lstat(worktreesDir).catch(() => null);
  if (worktreesStat === null) {
    return ok("No managed .worktrees directory found.");
  }
  if (worktreesStat.isSymbolicLink()) {
    return warn([
      ".worktrees is a symlink; inspect it manually before cleanup.",
    ]);
  }
  if (!worktreesStat.isDirectory()) {
    return warn([".worktrees exists but is not a directory."]);
  }

  const gitContext = await loadGitContext(libraryRoot);
  if (gitContext.status === "warn") {
    return warn([gitContext.message]);
  }

  let entries: string[];
  try {
    entries = await readdir(worktreesDir);
  } catch (err) {
    return warn([`.worktrees could not be read: ${(err as Error).message}`]);
  }

  const findings: string[] = [];
  for (const entry of entries.sort()) {
    findings.push(
      ...(await inspectWorktreeEntry({
        entry,
        entryPath: path.join(worktreesDir, entry),
        metadataNamespaces: gitContext.metadataNamespaces,
        registeredWorktrees: gitContext.registeredWorktrees,
      })),
    );
  }

  if (findings.length === 0) {
    return ok(`Managed worktrees healthy: ${entries.length} checked.`);
  }
  return warn(findings);
}

async function inspectWorktreeEntry(input: {
  entry: string;
  entryPath: string;
  metadataNamespaces: string[];
  registeredWorktrees: Map<string, string | null>;
}): Promise<string[]> {
  const findings: string[] = [];
  const entryLabel = `.worktrees/${input.entry}`;
  const entryStat = await lstat(input.entryPath).catch((err) => err as Error);
  if (entryStat instanceof Error) {
    return [`${entryLabel} could not be inspected: ${entryStat.message}`];
  }
  if (entryStat.isSymbolicLink()) {
    return [`${entryLabel} is a symlink; inspect it manually before cleanup.`];
  }
  if (!entryStat.isDirectory()) {
    return [`${entryLabel} is not a directory.`];
  }

  const canonicalEntry = await realpath(input.entryPath).catch(() => null);
  const registeredGitdir =
    canonicalEntry === null
      ? undefined
      : input.registeredWorktrees.get(toComparablePath(canonicalEntry));
  if (registeredGitdir === undefined) {
    findings.push(`${entryLabel} is not registered in git worktree metadata.`);
  }

  const dotGit = path.join(input.entryPath, ".git");
  const dotGitStat = await lstat(dotGit).catch((err) => err as Error);
  if (dotGitStat instanceof Error) {
    findings.push(`${entryLabel}/.git is missing or unreadable.`);
    return findings;
  }
  if (dotGitStat.isSymbolicLink()) {
    findings.push(`${entryLabel}/.git is a symlink; not following it.`);
    return findings;
  }
  if (!dotGitStat.isFile()) {
    findings.push(`${entryLabel}/.git is not a regular file.`);
    return findings;
  }

  let dotGitContent: string;
  try {
    dotGitContent = await readFile(dotGit, "utf-8");
  } catch (err) {
    findings.push(
      `${entryLabel}/.git could not be read: ${(err as Error).message}`,
    );
    return findings;
  }

  const gitdir = parseGitdir(dotGitContent);
  if (gitdir === null) {
    findings.push(`${entryLabel}/.git does not contain a gitdir pointer.`);
    return findings;
  }

  const resolvedGitdir = path.isAbsolute(gitdir)
    ? path.normalize(gitdir)
    : path.resolve(input.entryPath, gitdir);
  const comparableGitdir = await realpath(resolvedGitdir).catch(
    () => resolvedGitdir,
  );
  if (
    !input.metadataNamespaces.some((metadataNamespace) =>
      isInsidePath(metadataNamespace, comparableGitdir),
    )
  ) {
    findings.push(
      `${entryLabel}/.git points outside this repository's .git/worktrees metadata.`,
    );
    return findings;
  }
  if (
    registeredGitdir !== undefined &&
    registeredGitdir !== null &&
    toComparablePath(comparableGitdir) !== registeredGitdir
  ) {
    findings.push(
      `${entryLabel}/.git points to different registered worktree metadata.`,
    );
  }
  const gitdirStat = await lstat(resolvedGitdir).catch(() => null);
  if (gitdirStat === null) {
    findings.push(`${entryLabel}/.git points to missing Git metadata.`);
  } else if (!gitdirStat.isDirectory()) {
    findings.push(`${entryLabel}/.git points to non-directory Git metadata.`);
  }

  return findings;
}

function parseGitdir(content: string): string | null {
  const firstLine = content.split(/\r?\n/u)[0]?.trim() ?? "";
  const match = /^gitdir:\s*(.+)$/u.exec(firstLine);
  const gitdir = match?.[1]?.trim();
  return gitdir && gitdir.length > 0 ? gitdir : null;
}

async function loadGitContext(libraryRoot: string): Promise<
  | {
      status: "ok";
      metadataNamespaces: string[];
      registeredWorktrees: Map<string, string | null>;
    }
  | { status: "warn"; message: string }
> {
  const commonDir = await git(
    ["rev-parse", "--git-common-dir"],
    libraryRoot,
    [0, 128],
  ).catch((err) => ({
    exitCode: 1,
    stdout: "",
    stderr: (err as Error).message,
  }));
  if (commonDir.exitCode !== 0 || commonDir.stdout.trim().length === 0) {
    return {
      status: "warn",
      message:
        ".worktrees exists, but current repository Git metadata could not be read.",
    };
  }

  const commonDirPath = path.isAbsolute(commonDir.stdout.trim())
    ? path.normalize(commonDir.stdout.trim())
    : path.resolve(libraryRoot, commonDir.stdout.trim());
  const commonDirReal = await realpath(commonDirPath).catch(() => null);
  if (commonDirReal === null) {
    return {
      status: "warn",
      message:
        ".worktrees exists, but current repository Git metadata could not be resolved.",
    };
  }
  const metadataNamespaces = [
    path.join(commonDirReal, "worktrees"),
    path.join(commonDirPath, "worktrees"),
  ];

  const worktreeList = await git(
    ["worktree", "list", "--porcelain", "-z"],
    libraryRoot,
    [0, 128],
  ).catch((err) => ({
    exitCode: 1,
    stdout: "",
    stderr: (err as Error).message,
  }));
  if (worktreeList.exitCode !== 0) {
    return {
      status: "warn",
      message:
        ".worktrees exists, but registered Git worktrees could not be listed.",
    };
  }

  return {
    status: "ok",
    metadataNamespaces,
    registeredWorktrees: await parseRegisteredWorktrees(
      worktreeList.stdout,
      metadataNamespaces[0],
    ),
  };
}

async function parseRegisteredWorktrees(
  output: string,
  metadataNamespace: string,
): Promise<Map<string, string | null>> {
  const worktrees = new Map<string, string | null>();
  for (const field of output.split("\0")) {
    if (field.startsWith("worktree ")) {
      const worktreePath = field.slice("worktree ".length);
      const canonicalWorktree = await realpath(worktreePath).catch(
        () => worktreePath,
      );
      worktrees.set(toComparablePath(canonicalWorktree), null);
    }
  }
  for (const [worktreePath, metadataPath] of await readWorktreeMetadataMap(
    metadataNamespace,
  )) {
    if (worktrees.has(worktreePath)) {
      worktrees.set(worktreePath, metadataPath);
    }
  }
  return worktrees;
}

async function readWorktreeMetadataMap(
  metadataNamespace: string,
): Promise<Map<string, string>> {
  const mapped = new Map<string, string>();
  const entries = await readdir(metadataNamespace).catch(() => []);
  for (const entry of entries) {
    const metadataDir = path.join(metadataNamespace, entry);
    const gitdirFile = path.join(metadataDir, "gitdir");
    const gitdirStat = await lstat(gitdirFile).catch(() => null);
    if (gitdirStat === null || !gitdirStat.isFile()) {
      continue;
    }
    const gitdirContent = await readFile(gitdirFile, "utf-8").catch(() => "");
    const dotGitPath = gitdirContent.split(/\r?\n/u)[0]?.trim() ?? "";
    if (dotGitPath.length === 0) {
      continue;
    }
    const worktreePath = path.dirname(dotGitPath);
    const canonicalWorktree = await realpath(worktreePath).catch(
      () => worktreePath,
    );
    const canonicalMetadata = await realpath(metadataDir).catch(
      () => metadataDir,
    );
    mapped.set(
      toComparablePath(canonicalWorktree),
      toComparablePath(canonicalMetadata),
    );
  }
  return mapped;
}

async function git(
  args: readonly string[],
  cwd: string,
  allowExitCodes: readonly number[],
): Promise<GitResult> {
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

function warn(findings: string[]): ManagedWorktreeDiagnostics {
  return {
    status: "warn",
    findings,
    message: `Managed worktree drift detected: ${findings.join(" ")} Review manually or use a separate cleanup workflow.`,
  };
}

function ok(message: string): ManagedWorktreeDiagnostics {
  return { status: "ok", findings: [], message };
}

function isInsidePath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function toComparablePath(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
