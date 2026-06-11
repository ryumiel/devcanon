import {
  CleanupUsageError,
  canonicalPath,
  collectWorktrees,
  currentBranch,
  git,
  isInsideWorktree,
  lineOutput,
  normalizeRemoteUrl,
  requireCanonicalDirectory,
  revParse,
  showRefExists,
  showTopLevel,
  validateBranchName,
  validateSha,
  worktreeStatus,
} from "./cleanup-git.js";
import type { RuntimeCommandOutcome } from "./command.js";

interface PreflightResult {
  mode: "safe-direct" | "remote-only" | "cd-primary" | "stop";
  reasonCode: string;
  currentWorktree: string;
  currentBranch: string;
  currentDetached: boolean;
  primaryWorktree: string;
  headWorktree: string;
  baseWorktree: string;
  reason: string;
}

type CleanupOutcome = "removed" | "retained" | "skipped" | "failed";
type BaseOutcome = "updated" | "skipped" | "failed";
type BranchOutcome = "deleted" | "retained" | "skipped" | "failed";

interface CleanupReport {
  worktreeCleanup: CleanupOutcome;
  worktreeCleanupReason: string;
  baseUpdate: BaseOutcome;
  baseUpdateReason: string;
  localBranchCleanup: BranchOutcome;
  localBranchCleanupReason: string;
  remoteBranchCleanup: BranchOutcome;
  remoteBranchCleanupReason: string;
  manualActions: string[];
}

interface CleanupEnv {
  prState: string;
  prHeadBranch: string;
  prBaseBranch: string;
  prHeadSha: string;
  prHeadRepo: string;
  prBaseRepo: string;
  prBaseDefaultBranch: string;
  prBaseRemoteUrl: string;
  primaryWorktree: string;
  headWorktree: string;
  currentWorktree: string;
}

export async function runPrMergeWorktreeCommand(
  args: readonly string[],
): Promise<RuntimeCommandOutcome> {
  const [subcommand, ...rest] = args;
  try {
    switch (subcommand) {
      case "preflight":
        if (rest.length > 0) {
          throw new CleanupUsageError("preflight does not accept arguments");
        }
        return {
          exitCode: 0,
          stdout: formatPreflight(await preflight()),
          stderr: "",
        };
      case "cleanup":
        if (rest.length > 0) {
          throw new CleanupUsageError("cleanup does not accept arguments");
        }
        return {
          exitCode: 0,
          stdout: formatCleanup(await cleanup(readCleanupEnv())),
          stderr: "",
        };
      default:
        throw new CleanupUsageError(
          "usage: pr-merge-worktree preflight|cleanup",
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 2, stdout: "", stderr: `ERROR=${message}\n` };
  }
}

export function reducePreflight(input: {
  metadataValid: boolean;
  metadataReason?: string;
  outsideWorktree: boolean;
  currentWorktree: string;
  currentBranch: string;
  currentDetached: boolean;
  primaryWorktree: string;
  headWorktree: string;
  baseWorktree: string;
  knownCurrent: boolean;
}): PreflightResult {
  const base = {
    currentWorktree: input.currentWorktree,
    currentBranch: input.currentBranch,
    currentDetached: input.currentDetached,
    primaryWorktree: input.primaryWorktree,
    headWorktree: input.headWorktree,
    baseWorktree: input.baseWorktree,
  };
  if (input.outsideWorktree) {
    return stop(
      base,
      "outside-worktree",
      "Current directory is outside a Git worktree; re-run from a repository worktree.",
    );
  }
  if (!input.metadataValid) {
    return stop(
      base,
      "missing-pr-metadata",
      input.metadataReason ??
        "Missing or unsafe PR metadata; re-run after collecting PR branch metadata.",
    );
  }
  if (input.currentWorktree.length === 0) {
    return stop(
      base,
      "unclassifiable",
      "Unable to canonicalize the current worktree; re-run from a normal repository path.",
    );
  }
  if (input.primaryWorktree.length === 0) {
    return stop(
      base,
      "missing-primary",
      "Unable to determine the primary worktree; run git worktree list and retry from a valid checkout.",
    );
  }
  if (!input.knownCurrent) {
    return stop(
      base,
      "unclassifiable",
      "Current checkout is not present in git worktree metadata; run git worktree repair or retry from a known worktree.",
    );
  }
  if (input.currentDetached) {
    return stop(
      base,
      "detached-current",
      "Current worktree is detached; re-run from a named branch worktree.",
    );
  }
  if (
    input.headWorktree.length > 0 &&
    input.currentWorktree === input.headWorktree
  ) {
    return result(
      base,
      "remote-only",
      "current-head-worktree",
      "Current worktree holds the PR head branch; merge without delegated branch cleanup, then run explicit cleanup.",
    );
  }
  if (
    input.baseWorktree.length > 0 &&
    input.currentWorktree === input.baseWorktree
  ) {
    if (
      input.headWorktree.length > 0 &&
      input.headWorktree !== input.currentWorktree
    ) {
      return result(
        base,
        "remote-only",
        "base-with-head-worktree",
        "Base worktree is current and another worktree holds the PR head; avoid GitHub CLI local cleanup.",
      );
    }
    return result(
      base,
      "safe-direct",
      "base-no-head-worktree",
      "Current worktree holds the base branch and no local worktree holds the PR head branch.",
    );
  }
  if (
    input.primaryWorktree.length > 0 &&
    input.primaryWorktree === input.baseWorktree &&
    input.headWorktree.length === 0
  ) {
    return result(
      base,
      "cd-primary",
      "unrelated-cd-primary",
      "Current worktree is unrelated; change to the primary base worktree before merge.",
    );
  }
  return result(
    base,
    "remote-only",
    "unrelated-remote-only",
    "Current worktree is unrelated to the PR head/base collision state; use merge-only behavior and explicit cleanup.",
  );
}

export function reduceCleanup(input: {
  prState: string;
  headWorktreeReal: string;
  primaryWorktreeReal: string;
  headWorktreeDirty: boolean;
  primaryWorktreeDirty: boolean;
  headWorktreeLockedReason: string | null;
  prHeadBranch: string;
  prBaseBranch: string;
  prBaseDefaultBranch: string;
  localBranchExists: boolean;
  localTipMatches: boolean;
  branchCheckedOut: boolean;
  headBranchProtected: boolean;
  headBranchProtectedReason: string;
  prHeadRepo: string;
  prBaseRepo: string;
  originMatchesBase: boolean;
  remoteLookupFailed: boolean;
  remoteSha: string;
  remoteTipMatches: boolean;
  worktreeRemoveFailed?: boolean;
  baseUpdateFailed?: boolean;
  localDeleteFailed?: boolean;
  remoteDeleteFailed?: boolean;
}): CleanupReport {
  const report = emptyCleanupReport();
  let headBranchProtected = input.headBranchProtected;
  let headBranchProtectedReason = input.headBranchProtectedReason;

  const manual = (action: string) => report.manualActions.push(action);

  if (input.prState !== "MERGED") {
    report.worktreeCleanupReason = "pr-not-merged";
    report.baseUpdateReason = "pr-not-merged";
    report.localBranchCleanupReason = "pr-not-merged";
    report.remoteBranchCleanupReason = "pr-not-merged";
    manual("verify PR state before cleanup");
    return report;
  }

  if (input.headWorktreeReal.length === 0) {
    report.worktreeCleanupReason = "no-head-worktree";
  } else if (input.headWorktreeReal === input.primaryWorktreeReal) {
    report.worktreeCleanup = "retained";
    if (input.primaryWorktreeDirty) {
      report.worktreeCleanupReason = "dirty-or-untracked-primary-head-worktree";
      report.baseUpdate = "skipped";
      report.baseUpdateReason = "dirty-or-untracked-primary-head-worktree";
      headBranchProtected = true;
      headBranchProtectedReason = "dirty-or-untracked-head-worktree";
      manual(
        `inspect dirty primary worktree manually: ${input.primaryWorktreeReal}`,
      );
    } else {
      report.worktreeCleanupReason = "head-worktree-is-primary";
    }
    manual("review primary worktree before manual cleanup");
  } else if (input.headWorktreeLockedReason !== null) {
    report.worktreeCleanup = "retained";
    report.worktreeCleanupReason = `locked-worktree${input.headWorktreeLockedReason ? `:${input.headWorktreeLockedReason}` : ""}`;
    headBranchProtected = true;
    headBranchProtectedReason = report.worktreeCleanupReason;
    manual(`unlock or remove worktree manually: ${input.headWorktreeReal}`);
  } else if (input.headWorktreeDirty) {
    report.worktreeCleanup = "retained";
    report.worktreeCleanupReason = "dirty-or-untracked-worktree";
    headBranchProtected = true;
    headBranchProtectedReason = "dirty-or-untracked-head-worktree";
    manual(`inspect dirty worktree manually: ${input.headWorktreeReal}`);
  } else if (input.worktreeRemoveFailed) {
    report.worktreeCleanup = "failed";
    report.worktreeCleanupReason = "git-worktree-remove-failed";
    headBranchProtected = true;
    headBranchProtectedReason = "worktree-cleanup-failed";
    manual(`remove worktree manually: ${input.headWorktreeReal}`);
  } else {
    report.worktreeCleanup = "removed";
    report.worktreeCleanupReason = input.headWorktreeReal;
  }

  if (
    report.baseUpdate === "skipped" &&
    report.baseUpdateReason === "not-attempted"
  ) {
    if (input.baseUpdateFailed) {
      report.baseUpdate = "failed";
      report.baseUpdateReason = "checkout-or-pull-failed";
      manual(`update base branch manually: ${input.prBaseBranch}`);
    } else {
      report.baseUpdate = "updated";
      report.baseUpdateReason = input.prBaseBranch;
    }
  }

  if (
    input.prHeadBranch === input.prBaseBranch ||
    input.prHeadBranch === input.prBaseDefaultBranch
  ) {
    report.localBranchCleanup = "retained";
    report.localBranchCleanupReason = "head-is-base-or-default";
    manual(`do not delete protected branch: ${input.prHeadBranch}`);
  } else if (!input.localBranchExists) {
    report.localBranchCleanup = "skipped";
    report.localBranchCleanupReason = "local-branch-missing";
  } else if (!input.localTipMatches) {
    report.localBranchCleanup = "retained";
    report.localBranchCleanupReason = "local-tip-mismatch";
    manual(`inspect local branch before deletion: ${input.prHeadBranch}`);
  } else if (headBranchProtected) {
    report.localBranchCleanup = "retained";
    report.localBranchCleanupReason =
      headBranchProtectedReason || "head-worktree-protected";
    manual(
      `preserve local branch until head worktree cleanup is resolved: ${input.prHeadBranch}`,
    );
  } else if (input.branchCheckedOut) {
    report.localBranchCleanup = "retained";
    report.localBranchCleanupReason = "branch-still-checked-out";
    manual(`remove or switch worktree holding branch: ${input.prHeadBranch}`);
  } else if (input.localDeleteFailed) {
    report.localBranchCleanup = "failed";
    report.localBranchCleanupReason = "git-branch-delete-failed";
    manual(
      `delete local branch manually after inspection: ${input.prHeadBranch}`,
    );
  } else {
    report.localBranchCleanup = "deleted";
    report.localBranchCleanupReason = input.prHeadBranch;
  }

  if (input.prHeadRepo !== input.prBaseRepo) {
    report.remoteBranchCleanup = "retained";
    report.remoteBranchCleanupReason = "fork-head-repo";
  } else if (
    input.prHeadBranch === input.prBaseBranch ||
    input.prHeadBranch === input.prBaseDefaultBranch
  ) {
    report.remoteBranchCleanup = "retained";
    report.remoteBranchCleanupReason = "head-is-base-or-default";
  } else if (!input.originMatchesBase) {
    report.remoteBranchCleanup = "retained";
    report.remoteBranchCleanupReason = "origin-not-base-remote";
    manual(
      `delete remote branch manually from verified base repository: ${input.prHeadBranch}`,
    );
  } else if (input.remoteLookupFailed) {
    report.remoteBranchCleanup = "failed";
    report.remoteBranchCleanupReason = "git-ls-remote-failed";
    manual(
      `inspect remote branch after origin lookup succeeds: ${input.prHeadBranch}`,
    );
  } else if (input.remoteSha.length === 0) {
    report.remoteBranchCleanup = "skipped";
    report.remoteBranchCleanupReason = "remote-branch-missing";
  } else if (!input.remoteTipMatches) {
    report.remoteBranchCleanup = "retained";
    report.remoteBranchCleanupReason = "remote-tip-mismatch";
    manual(`inspect remote branch before deletion: ${input.prHeadBranch}`);
  } else if (input.remoteDeleteFailed) {
    report.remoteBranchCleanup = "failed";
    report.remoteBranchCleanupReason = "git-push-delete-failed";
    manual(
      `delete remote branch manually after inspection: ${input.prHeadBranch}`,
    );
  } else {
    report.remoteBranchCleanup = "deleted";
    report.remoteBranchCleanupReason = input.prHeadBranch;
  }

  return report;
}

async function preflight(): Promise<PreflightResult> {
  const headBranch = process.env.PR_HEAD_BRANCH ?? "";
  const baseBranch = process.env.PR_BASE_BRANCH ?? "";
  if (!(await isInsideWorktree(process.cwd()))) {
    return reducePreflight({
      metadataValid: true,
      outsideWorktree: true,
      currentWorktree: "",
      currentBranch: "",
      currentDetached: false,
      primaryWorktree: "",
      headWorktree: "",
      baseWorktree: "",
      knownCurrent: false,
    });
  }

  const metadata = await validatePreflightMetadata(headBranch, baseBranch);
  const currentWorktree = await showTopLevel(process.cwd());
  const currentWorktreeReal = (await canonicalPath(currentWorktree)) ?? "";
  const branch = await currentBranch(currentWorktree);
  const worktrees = await collectWorktrees(currentWorktree);
  const activeWorktrees = worktrees.filter((worktree) => !worktree.prunable);
  const primaryWorktreeReal = activeWorktrees[0]?.realPath ?? "";
  const headWorktreeReal =
    activeWorktrees.find((worktree) => worktree.branch === headBranch)
      ?.realPath ?? "";
  const baseWorktreeReal =
    activeWorktrees.find((worktree) => worktree.branch === baseBranch)
      ?.realPath ?? "";
  const knownCurrent = activeWorktrees.some(
    (worktree) => worktree.realPath === currentWorktreeReal,
  );

  return reducePreflight({
    metadataValid: metadata.valid,
    metadataReason: metadata.valid ? undefined : metadata.reason,
    outsideWorktree: false,
    currentWorktree: currentWorktreeReal,
    currentBranch: branch,
    currentDetached: branch.length === 0,
    primaryWorktree: primaryWorktreeReal,
    headWorktree: headWorktreeReal,
    baseWorktree: baseWorktreeReal,
    knownCurrent,
  });
}

async function validatePreflightMetadata(
  headBranch: string,
  baseBranch: string,
): Promise<{ valid: true } | { valid: false; reason: string }> {
  for (const [name, value] of [
    ["PR_HEAD_BRANCH", headBranch],
    ["PR_BASE_BRANCH", baseBranch],
  ] as const) {
    if (
      value.length === 0 ||
      value.startsWith("-") ||
      value.includes("\n") ||
      value.includes("\r")
    ) {
      return {
        valid: false,
        reason: `Missing or unsafe ${name}; re-run after collecting PR head and base branch metadata.`,
      };
    }
    if (!(await validateBranchName(value))) {
      return {
        valid: false,
        reason: `Invalid ${name}; re-run after collecting valid PR branch metadata.`,
      };
    }
  }
  return { valid: true };
}

async function cleanup(env: CleanupEnv): Promise<CleanupReport> {
  for (const [name, value] of [
    ["PR_HEAD_BRANCH", env.prHeadBranch],
    ["PR_BASE_BRANCH", env.prBaseBranch],
    ["PR_BASE_DEFAULT_BRANCH", env.prBaseDefaultBranch],
  ] as const) {
    if (!(await validateBranchName(value))) {
      throw new CleanupUsageError(`Invalid ${name}: ${value}`);
    }
  }

  const primaryWorktreeReal = await requireCanonicalDirectory(
    env.primaryWorktree,
    "PRIMARY_WORKTREE",
  );
  const headWorktreeReal =
    env.headWorktree.length > 0
      ? ((await canonicalPath(env.headWorktree)) ?? "")
      : "";
  if (env.currentWorktree.length > 0) {
    await canonicalPath(env.currentWorktree);
  }

  let headBranchProtected = false;
  let headBranchProtectedReason = "";
  let worktreeRemoveFailed = false;
  let baseUpdateFailed = false;
  let localDeleteFailed = false;
  let remoteDeleteFailed = false;
  const headWorktreeLockedReason =
    headWorktreeReal.length > 0
      ? await lockedReason(primaryWorktreeReal, headWorktreeReal)
      : null;
  const primaryWorktreeDirty =
    (await worktreeStatus(primaryWorktreeReal)).length > 0;
  const headWorktreeDirty =
    headWorktreeReal.length > 0 && headWorktreeReal !== primaryWorktreeReal
      ? (await worktreeStatus(headWorktreeReal)).length > 0
      : false;
  if (env.prState === "MERGED") {
    if (headWorktreeReal === primaryWorktreeReal && primaryWorktreeDirty) {
      headBranchProtected = true;
      headBranchProtectedReason = "dirty-or-untracked-head-worktree";
    } else if (headWorktreeLockedReason !== null) {
      headBranchProtected = true;
      headBranchProtectedReason = `locked-worktree${headWorktreeLockedReason ? `:${headWorktreeLockedReason}` : ""}`;
    } else if (headWorktreeDirty) {
      headBranchProtected = true;
      headBranchProtectedReason = "dirty-or-untracked-head-worktree";
    }
  }

  if (
    env.prState === "MERGED" &&
    headWorktreeReal.length > 0 &&
    headWorktreeReal !== primaryWorktreeReal &&
    headWorktreeLockedReason === null &&
    !headWorktreeDirty
  ) {
    const removeResult = await git(
      ["worktree", "remove", headWorktreeReal],
      primaryWorktreeReal,
      [0, 1, 128],
    );
    worktreeRemoveFailed = removeResult.exitCode !== 0;
    if (worktreeRemoveFailed) {
      headBranchProtected = true;
      headBranchProtectedReason = "worktree-cleanup-failed";
    }
  }

  if (
    env.prState === "MERGED" &&
    !(headWorktreeReal === primaryWorktreeReal && primaryWorktreeDirty)
  ) {
    const checkout = await git(
      ["checkout", env.prBaseBranch],
      primaryWorktreeReal,
      [0, 1],
    );
    const pull =
      checkout.exitCode === 0
        ? await git(["pull", "--ff-only"], primaryWorktreeReal, [0, 1])
        : { exitCode: 1 };
    baseUpdateFailed = checkout.exitCode !== 0 || pull.exitCode !== 0;
  }

  const localBranchExists = await showRefExists(
    primaryWorktreeReal,
    `refs/heads/${env.prHeadBranch}`,
  );
  const localTip = localBranchExists
    ? await revParse(primaryWorktreeReal, `refs/heads/${env.prHeadBranch}`)
    : "";
  const branchStillCheckedOut = await branchCheckedOut(
    primaryWorktreeReal,
    env.prHeadBranch,
  );
  const canDeleteLocal =
    env.prState === "MERGED" &&
    env.prHeadBranch !== env.prBaseBranch &&
    env.prHeadBranch !== env.prBaseDefaultBranch &&
    localBranchExists &&
    localTip === env.prHeadSha &&
    !headBranchProtected &&
    !branchStillCheckedOut;
  if (canDeleteLocal) {
    localDeleteFailed =
      (
        await git(
          ["branch", "-D", env.prHeadBranch],
          primaryWorktreeReal,
          [0, 1],
        )
      ).exitCode !== 0;
  }

  let originMatchesBase = true;
  let remoteLookupFailed = false;
  let remoteSha = "";
  if (
    env.prState === "MERGED" &&
    env.prHeadRepo === env.prBaseRepo &&
    env.prHeadBranch !== env.prBaseBranch &&
    env.prHeadBranch !== env.prBaseDefaultBranch
  ) {
    const originUrl = (
      await git(["remote", "get-url", "origin"], primaryWorktreeReal, [0, 1])
    ).stdout.trim();
    originMatchesBase =
      originUrl.length > 0 &&
      (await normalizeRemoteUrl(originUrl)) ===
        (await normalizeRemoteUrl(env.prBaseRemoteUrl));
    if (originMatchesBase) {
      const listing = await git(
        ["ls-remote", "--heads", "origin"],
        primaryWorktreeReal,
        [0, 1, 2, 128],
      );
      remoteLookupFailed = listing.exitCode !== 0;
      if (!remoteLookupFailed) {
        const remoteRef = `refs/heads/${env.prHeadBranch}`;
        remoteSha =
          listing.stdout
            .split(/\r?\n/u)
            .map((line) => line.split(/\s+/u))
            .find((parts) => parts[1] === remoteRef)?.[0] ?? "";
        if (remoteSha === env.prHeadSha) {
          remoteDeleteFailed =
            (
              await git(
                ["push", "origin", `:refs/heads/${env.prHeadBranch}`],
                primaryWorktreeReal,
                [0, 1],
              )
            ).exitCode !== 0;
        }
      }
    }
  }

  return reduceCleanup({
    prState: env.prState,
    headWorktreeReal,
    primaryWorktreeReal,
    headWorktreeDirty,
    primaryWorktreeDirty,
    headWorktreeLockedReason,
    prHeadBranch: env.prHeadBranch,
    prBaseBranch: env.prBaseBranch,
    prBaseDefaultBranch: env.prBaseDefaultBranch,
    localBranchExists,
    localTipMatches: localTip === env.prHeadSha,
    branchCheckedOut: branchStillCheckedOut,
    headBranchProtected,
    headBranchProtectedReason,
    prHeadRepo: env.prHeadRepo,
    prBaseRepo: env.prBaseRepo,
    originMatchesBase,
    remoteLookupFailed,
    remoteSha,
    remoteTipMatches: remoteSha === env.prHeadSha,
    worktreeRemoveFailed,
    baseUpdateFailed,
    localDeleteFailed,
    remoteDeleteFailed,
  });
}

function readCleanupEnv(): CleanupEnv {
  const env = {
    prState: requireEnv("PR_STATE"),
    prHeadBranch: requireEnv("PR_HEAD_BRANCH"),
    prBaseBranch: requireEnv("PR_BASE_BRANCH"),
    prHeadSha: requireEnv("PR_HEAD_SHA"),
    prHeadRepo: requireEnv("PR_HEAD_REPO"),
    prBaseRepo: requireEnv("PR_BASE_REPO"),
    prBaseDefaultBranch: requireEnv("PR_BASE_DEFAULT_BRANCH"),
    prBaseRemoteUrl: requireEnv("PR_BASE_REMOTE_URL"),
    primaryWorktree: requireEnv("PRIMARY_WORKTREE"),
    headWorktree: process.env.HEAD_WORKTREE ?? "",
    currentWorktree: process.env.CURRENT_WORKTREE ?? "",
  };
  for (const [name, value] of [
    ["PR_HEAD_BRANCH", env.prHeadBranch],
    ["PR_BASE_BRANCH", env.prBaseBranch],
    ["PR_BASE_DEFAULT_BRANCH", env.prBaseDefaultBranch],
  ] as const) {
    if (
      value.length === 0 ||
      value.startsWith("-") ||
      value.includes("\n") ||
      value.includes("\r")
    ) {
      throw new CleanupUsageError(`Unsafe ${name}: ${value}`);
    }
  }
  return env;
}

async function branchCheckedOut(
  primaryWorktree: string,
  branch: string,
): Promise<boolean> {
  return (await collectWorktrees(primaryWorktree)).some(
    (worktree) => worktree.branch === branch,
  );
}

async function lockedReason(
  primaryWorktree: string,
  targetReal: string,
): Promise<string | null> {
  for (const worktree of await collectWorktrees(primaryWorktree)) {
    if (worktree.realPath === targetReal && worktree.locked) {
      return worktree.lockedReason;
    }
  }
  return null;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new CleanupUsageError(
      `Missing required environment variable: ${name}`,
    );
  }
  if (name.endsWith("BRANCH") && !validateBranchNameSync(value)) {
    throw new CleanupUsageError(`Invalid ${name}: ${value}`);
  }
  if (name === "PR_HEAD_SHA" && !validateSha(value)) {
    throw new CleanupUsageError(
      "PR_HEAD_SHA must be a 40-character lowercase hex SHA",
    );
  }
  return value;
}

function validateBranchNameSync(value: string): boolean {
  return value.length > 0;
}

function emptyCleanupReport(): CleanupReport {
  return {
    worktreeCleanup: "skipped",
    worktreeCleanupReason: "not-attempted",
    baseUpdate: "skipped",
    baseUpdateReason: "not-attempted",
    localBranchCleanup: "skipped",
    localBranchCleanupReason: "not-attempted",
    remoteBranchCleanup: "skipped",
    remoteBranchCleanupReason: "not-attempted",
    manualActions: [],
  };
}

function stop(
  base: Omit<PreflightResult, "mode" | "reasonCode" | "reason">,
  reasonCode: string,
  reason: string,
): PreflightResult {
  return result(base, "stop", reasonCode, reason);
}

function result(
  base: Omit<PreflightResult, "mode" | "reasonCode" | "reason">,
  mode: PreflightResult["mode"],
  reasonCode: string,
  reason: string,
): PreflightResult {
  return { ...base, mode, reasonCode, reason };
}

function formatPreflight(report: PreflightResult): string {
  return lineOutput([
    ["MODE", report.mode],
    ["REASON_CODE", report.reasonCode],
    ["CURRENT_WORKTREE", report.currentWorktree],
    ["CURRENT_BRANCH", report.currentBranch],
    ["CURRENT_DETACHED", report.currentDetached ? "true" : "false"],
    ["PRIMARY_WORKTREE", report.primaryWorktree],
    ["HEAD_WORKTREE", report.headWorktree],
    ["BASE_WORKTREE", report.baseWorktree],
    ["REASON", report.reason],
  ]);
}

function formatCleanup(report: CleanupReport): string {
  return lineOutput([
    ["WORKTREE_CLEANUP", report.worktreeCleanup],
    ["WORKTREE_CLEANUP_REASON", report.worktreeCleanupReason],
    ["BASE_UPDATE", report.baseUpdate],
    ["BASE_UPDATE_REASON", report.baseUpdateReason],
    ["LOCAL_BRANCH_CLEANUP", report.localBranchCleanup],
    ["LOCAL_BRANCH_CLEANUP_REASON", report.localBranchCleanupReason],
    ["REMOTE_BRANCH_CLEANUP", report.remoteBranchCleanup],
    ["REMOTE_BRANCH_CLEANUP_REASON", report.remoteBranchCleanupReason],
    [
      "MANUAL_ACTION",
      report.manualActions.length > 0 ? report.manualActions.join(";") : "none",
    ],
  ]);
}
