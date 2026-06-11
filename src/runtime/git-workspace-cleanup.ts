import {
  CleanupUsageError,
  type WorktreeRecord,
  collectWorktrees,
  countStatusLines,
  git,
  isBareRepository,
  isInsideWorktree,
  lineOutput,
  localBranches,
  resolveDefaultBranch,
  revParse,
  showRefExists,
  showTopLevel,
  worktreeStatus,
} from "./cleanup-git.js";
import type { RuntimeCommandOutcome } from "./command.js";

type CleanupMode = "dry-run" | "execute";

const usage =
  "usage: git-workspace-cleanup.sh [--repo <path>] [--dry-run|--execute] [--force-branches] [--force-dirty-worktrees]";

class HelpRequested extends Error {
  constructor() {
    super(usage);
  }
}

interface Args {
  mode: CleanupMode;
  forceBranches: boolean;
  forceDirtyWorktrees: boolean;
  targetRepo: string;
}

interface DirtyWorktree {
  path: string;
  files: number;
  primary: boolean;
}

interface BranchFact {
  branch: string;
  ref: string;
  classification: "ancestor" | "squash" | "unique";
  commits: number;
}

interface WorkspaceFacts {
  mode: CleanupMode;
  status: "ok" | "blocked";
  defaultBranch: string;
  primaryWorktree: string;
  worktrees: WorktreeRecord[];
  prunableWorktrees: WorktreeRecord[];
  dirtyWorktrees: DirtyWorktree[];
  lockedWorktrees: WorktreeRecord[];
  branches: BranchFact[];
  defaultBranchAheadCommits: number;
}

export async function runGitWorkspaceCleanupCommand(
  args: readonly string[],
): Promise<RuntimeCommandOutcome> {
  try {
    const parsed = parseArgs(args);
    const facts = await collectFacts(parsed);
    const stdout = formatReport(facts);
    if (parsed.mode === "dry-run") {
      return { exitCode: 0, stdout, stderr: "" };
    }
    if (facts.status !== "ok") {
      return { exitCode: 1, stdout, stderr: "" };
    }
    try {
      await executeCleanup(parsed, facts);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { exitCode: 1, stdout, stderr: `ERROR=${message}\n` };
    }
    return { exitCode: 0, stdout, stderr: "" };
  } catch (err) {
    if (err instanceof HelpRequested) {
      return { exitCode: 0, stdout: "", stderr: `${usage}\n` };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      exitCode: 2,
      stdout: "",
      stderr: `ERROR=${message}\n`,
    };
  }
}

export function reduceWorkspaceStatus(input: {
  mode: CleanupMode;
  forceBranches: boolean;
  forceDirtyWorktrees: boolean;
  dirtyPrimaryCount: number;
  dirtyLinkedCount: number;
  lockedWorktreeCount: number;
  uniqueBranchCount: number;
  defaultBranchAheadCommits: number;
}): "ok" | "blocked" {
  if (input.dirtyPrimaryCount > 0) return "blocked";
  if (input.defaultBranchAheadCommits > 0) return "blocked";
  if (
    input.dirtyLinkedCount > 0 &&
    (input.mode === "dry-run" || !input.forceDirtyWorktrees)
  ) {
    return "blocked";
  }
  if (input.lockedWorktreeCount > 0) return "blocked";
  if (
    input.uniqueBranchCount > 0 &&
    (input.mode === "dry-run" || !input.forceBranches)
  ) {
    return "blocked";
  }
  return "ok";
}

function parseArgs(args: readonly string[]): Args {
  let mode: CleanupMode = "dry-run";
  let forceBranches = false;
  let forceDirtyWorktrees = false;
  let targetRepo = "";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--dry-run":
        mode = "dry-run";
        break;
      case "--execute":
        mode = "execute";
        break;
      case "--force-branches":
        forceBranches = true;
        break;
      case "--force-dirty-worktrees":
        forceDirtyWorktrees = true;
        break;
      case "--repo":
        index += 1;
        if (index >= args.length) {
          throw new CleanupUsageError("--repo requires a path");
        }
        targetRepo = args[index];
        break;
      case "-h":
      case "--help":
        throw new HelpRequested();
      default:
        throw new CleanupUsageError(`unknown argument: ${arg}`);
    }
  }

  return {
    mode,
    forceBranches,
    forceDirtyWorktrees,
    targetRepo: targetRepo.length === 0 ? process.cwd() : targetRepo,
  };
}

async function collectFacts(parsed: Args): Promise<WorkspaceFacts> {
  if (!(await isInsideWorktree(parsed.targetRepo))) {
    throw new CleanupUsageError(
      `not inside a git worktree: ${parsed.targetRepo}`,
    );
  }
  if (await isBareRepository(parsed.targetRepo)) {
    throw new CleanupUsageError("bare repositories are unsupported");
  }

  const repoRoot = await showTopLevel(parsed.targetRepo);
  if (parsed.mode === "dry-run") {
    await git(["fetch", "origin", "--prune"], repoRoot);
  }

  const defaultBranch = await resolveDefaultBranch(repoRoot);
  if (defaultBranch === null) {
    throw new CleanupUsageError("could not resolve origin default branch");
  }
  const remoteDefaultRef = `refs/remotes/origin/${defaultBranch}`;
  if (!(await showRefExists(repoRoot, remoteDefaultRef))) {
    throw new CleanupUsageError(`origin/${defaultBranch} does not exist`);
  }

  const allWorktrees = await collectWorktrees(repoRoot);
  const worktrees = allWorktrees.filter((worktree) => !worktree.prunable);
  const prunableWorktrees = allWorktrees.filter(
    (worktree) => worktree.prunable,
  );
  if (worktrees.length === 0) {
    throw new CleanupUsageError("no worktrees found");
  }

  const dirtyWorktrees: DirtyWorktree[] = [];
  for (const [index, worktree] of worktrees.entries()) {
    const status = await worktreeStatus(worktree.realPath);
    if (status.length > 0) {
      dirtyWorktrees.push({
        path: worktree.realPath,
        files: countStatusLines(status),
        primary: index === 0,
      });
    }
  }

  const branches = await collectBranches(
    repoRoot,
    defaultBranch,
    remoteDefaultRef,
  );
  const defaultBranchAheadCommits = await defaultAheadCount(
    repoRoot,
    defaultBranch,
    remoteDefaultRef,
  );

  const dirtyPrimaryCount = dirtyWorktrees.filter(
    (entry) => entry.primary,
  ).length;
  const dirtyLinkedCount = dirtyWorktrees.length - dirtyPrimaryCount;
  const lockedWorktrees = worktrees
    .slice(1)
    .filter((worktree) => worktree.locked);
  const uniqueBranchCount = branches.filter(
    (branch) => branch.classification === "unique",
  ).length;
  const status = reduceWorkspaceStatus({
    mode: parsed.mode,
    forceBranches: parsed.forceBranches,
    forceDirtyWorktrees: parsed.forceDirtyWorktrees,
    dirtyPrimaryCount,
    dirtyLinkedCount,
    lockedWorktreeCount: lockedWorktrees.length,
    uniqueBranchCount,
    defaultBranchAheadCommits,
  });

  return {
    mode: parsed.mode,
    status,
    defaultBranch,
    primaryWorktree: worktrees[0].realPath,
    worktrees,
    prunableWorktrees,
    dirtyWorktrees,
    lockedWorktrees,
    branches,
    defaultBranchAheadCommits,
  };
}

async function collectBranches(
  repoRoot: string,
  defaultBranch: string,
  remoteDefaultRef: string,
): Promise<BranchFact[]> {
  const facts: BranchFact[] = [];
  for (const branchRef of await localBranches(repoRoot)) {
    const branch = branchRef.slice("refs/heads/".length);
    if (branchRef === `refs/heads/${defaultBranch}`) {
      continue;
    }
    if (
      (
        await git(
          ["merge-base", "--is-ancestor", branchRef, remoteDefaultRef],
          repoRoot,
          [0, 1],
        )
      ).exitCode === 0
    ) {
      facts.push({
        branch,
        ref: branchRef,
        classification: "ancestor",
        commits: 0,
      });
    } else if (
      await branchIsSquashMerged(repoRoot, branchRef, remoteDefaultRef)
    ) {
      facts.push({
        branch,
        ref: branchRef,
        classification: "squash",
        commits: 0,
      });
    } else {
      const commits = Number(
        (
          await git(
            ["rev-list", "--count", `${remoteDefaultRef}..${branchRef}`],
            repoRoot,
            [0, 1],
          )
        ).stdout.trim() || "1",
      );
      facts.push({
        branch,
        ref: branchRef,
        classification: "unique",
        commits: Number.isFinite(commits) ? commits : 1,
      });
    }
  }
  return facts;
}

async function branchIsSquashMerged(
  repoRoot: string,
  branchRef: string,
  remoteDefaultRef: string,
): Promise<boolean> {
  const mergeBase = (
    await git(["merge-base", remoteDefaultRef, branchRef], repoRoot, [0, 1])
  ).stdout.trim();
  if (mergeBase.length === 0) return false;
  const tree = (
    await git(["rev-parse", `${branchRef}^{tree}`], repoRoot, [0, 1])
  ).stdout.trim();
  if (tree.length === 0) return false;
  const dummyCommit = (
    await git(
      ["commit-tree", tree, "-p", mergeBase, "-m", "_"],
      repoRoot,
      [0, 1],
    )
  ).stdout.trim();
  if (dummyCommit.length === 0) return false;
  const cherry = (
    await git(["cherry", remoteDefaultRef, dummyCommit], repoRoot, [0, 1])
  ).stdout.trim();
  return cherry.startsWith("-");
}

async function defaultAheadCount(
  repoRoot: string,
  defaultBranch: string,
  remoteDefaultRef: string,
): Promise<number> {
  const defaultRef = `refs/heads/${defaultBranch}`;
  if (!(await showRefExists(repoRoot, remoteDefaultRef))) {
    return 0;
  }
  if (!(await showRefExists(repoRoot, defaultRef))) {
    return 0;
  }
  const value = (
    await git(
      ["rev-list", "--count", `${remoteDefaultRef}..${defaultRef}`],
      repoRoot,
      [0, 1],
    )
  ).stdout.trim();
  const parsed = Number(value || "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatReport(facts: WorkspaceFacts): string {
  const mergedBranches = facts.branches.filter(
    (branch) => branch.classification !== "unique",
  );
  const uniqueBranches = facts.branches.filter(
    (branch) => branch.classification === "unique",
  );
  const lines: Array<[string, string | number | boolean]> = [
    ["MODE", facts.mode],
    ["STATUS", facts.status],
    ["DEFAULT_BRANCH", facts.defaultBranch],
    ["PRIMARY_WORKTREE", facts.primaryWorktree],
    ["REMOVABLE_WORKTREES", Math.max(0, facts.worktrees.length - 1)],
    ["PRUNABLE_WORKTREES", facts.prunableWorktrees.length],
    ["LOCKED_WORKTREES", facts.lockedWorktrees.length],
    ["DIRTY_WORKTREES", facts.dirtyWorktrees.length],
    ["LOCAL_BRANCHES_TO_DELETE", facts.branches.length],
    ["LOCAL_BRANCHES_WITH_UNIQUE_COMMITS", uniqueBranches.length],
    ["DEFAULT_BRANCH_AHEAD_COMMITS", facts.defaultBranchAheadCommits],
  ];
  for (const worktree of facts.worktrees.slice(1)) {
    lines.push(["REMOVABLE_WORKTREE", worktree.realPath]);
  }
  for (const worktree of facts.prunableWorktrees) {
    lines.push(["PRUNABLE_WORKTREE", worktree.path]);
  }
  for (const dirty of facts.dirtyWorktrees) {
    lines.push([
      "DIRTY_WORKTREE",
      `${dirty.path}|FILES=${dirty.files}|PRIMARY=${dirty.primary}`,
    ]);
  }
  for (const locked of facts.lockedWorktrees) {
    lines.push([
      "LOCKED_WORKTREE",
      `${locked.realPath}${locked.lockedReason ? `|REASON=${locked.lockedReason}` : ""}`,
    ]);
  }
  for (const branch of facts.branches) {
    lines.push(["DELETE_BRANCH", branch.branch]);
  }
  for (const branch of mergedBranches) {
    lines.push([
      "MERGED_BRANCH",
      `${branch.branch}|REASON=${branch.classification}`,
    ]);
  }
  for (const branch of uniqueBranches) {
    lines.push(["UNIQUE_BRANCH", `${branch.branch}|COMMITS=${branch.commits}`]);
  }
  return lineOutput(lines);
}

async function executeCleanup(
  parsed: Args,
  facts: WorkspaceFacts,
): Promise<void> {
  for (const worktree of facts.worktrees.slice(1)) {
    const status = await worktreeStatus(worktree.realPath);
    if (status.length > 0) {
      if (!parsed.forceDirtyWorktrees) {
        throw new Error(
          `linked worktree became dirty before removal: ${worktree.realPath}`,
        );
      }
      await git(
        ["worktree", "remove", "--force", worktree.realPath],
        facts.primaryWorktree,
      );
    } else {
      await git(
        ["worktree", "remove", worktree.realPath],
        facts.primaryWorktree,
      );
    }
  }

  await git(["worktree", "prune"], facts.primaryWorktree);
  if (
    await showRefExists(
      facts.primaryWorktree,
      `refs/heads/${facts.defaultBranch}`,
    )
  ) {
    await git(["checkout", facts.defaultBranch], facts.primaryWorktree);
  } else {
    await git(
      ["checkout", "-b", facts.defaultBranch, `origin/${facts.defaultBranch}`],
      facts.primaryWorktree,
    );
  }
  await git(
    ["merge", "--ff-only", `origin/${facts.defaultBranch}`],
    facts.primaryWorktree,
  );
  for (const branch of facts.branches) {
    await git(["branch", "-D", branch.branch], facts.primaryWorktree);
  }
  await git(["worktree", "prune"], facts.primaryWorktree);
  await revParse(facts.primaryWorktree, "HEAD");
}
