import { realpath } from "node:fs/promises";
import path from "node:path";
import {
  CleanupUsageError,
  type WorktreeRecord,
  canonicalPath,
  collectWorktrees,
  commitIsMerged,
  countStatusLines,
  git,
  ignoredContentBlocker,
  inspectNestedRepositories,
  isBareRepository,
  isInsideWorktree,
  lineOutput,
  localBranches,
  nestedRepositoryBlocker,
  removeLinkedWorktree,
  resolveDefaultBranch,
  revParse,
  showRefExists,
  showTopLevel,
  validateDisposableDirectories,
  worktreeStatus,
} from "./cleanup-git.js";
import type { RuntimeCommandOutcome } from "./command.js";
import {
  type CleanupTarget,
  runTargetedCleanup,
} from "./targeted-workspace-cleanup.js";

type CleanupMode = "dry-run" | "execute";
const usage =
  "usage: git-workspace-cleanup.sh [--repo <path>] [--dry-run|--execute] [--retain-worktree <path>] [--retain-branch <name>] [--disposable-dir <relative-directory>] [--force-branches] [--force-dirty-worktrees] [--worktree <path> --branch <name> --expected-head <sha> | --detached --worktree <path> --expected-head <sha> | --branch-only --branch <name> --expected-head <sha>]";
class HelpRequested extends Error {}
interface Args {
  mode: CleanupMode;
  forceBranches: boolean;
  forceDirtyWorktrees: boolean;
  targetRepo: string;
  retainedWorktrees: string[];
  retainedBranches: string[];
  disposableDirectories: string[];
  target?: CleanupTarget;
}
interface Outcome {
  status:
    | "eligible"
    | "retained"
    | "failed"
    | "removed"
    | "already-absent"
    | "updated";
  reason: string;
}
interface WorktreeFact extends Outcome {
  record: WorktreeRecord;
  head: string;
  dirtyFiles: number;
}
interface BranchFact extends Outcome {
  branch: string;
  head: string;
  classification: "ancestor" | "squash" | "unique";
}

export async function runGitWorkspaceCleanupCommand(
  args: readonly string[],
): Promise<RuntimeCommandOutcome> {
  try {
    const parsed = parseArgs(args);
    if (parsed.target)
      return await runTargetedCleanup(
        parsed.targetRepo,
        parsed.mode,
        parsed.target,
      );
    return await workspaceCleanup(parsed);
  } catch (err) {
    if (err instanceof HelpRequested)
      return { exitCode: 0, stdout: "", stderr: `${usage}\n` };
    return {
      exitCode: 2,
      stdout: "",
      stderr: `ERROR=${err instanceof Error ? err.message : String(err)}\n`,
    };
  }
}

function parseArgs(args: readonly string[]): Args {
  const parsed: Args = {
    mode: "dry-run",
    forceBranches: false,
    forceDirtyWorktrees: false,
    targetRepo: "",
    retainedWorktrees: [],
    retainedBranches: [],
    disposableDirectories: [],
  };
  const target = new Map<string, string>();
  let kind: "paired" | "detached" | "branch-only" = "paired";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => {
      const next = args[++i];
      if (!next || next.startsWith("--") || /[\r\n\0]/u.test(next))
        throw new CleanupUsageError(`${arg} requires one value`);
      return next;
    };
    switch (arg) {
      case "--dry-run":
        parsed.mode = "dry-run";
        break;
      case "--execute":
        parsed.mode = "execute";
        break;
      case "--force-branches":
        parsed.forceBranches = true;
        break;
      case "--force-dirty-worktrees":
        parsed.forceDirtyWorktrees = true;
        break;
      case "--repo":
        parsed.targetRepo = value();
        break;
      case "--retain-worktree":
        parsed.retainedWorktrees.push(value());
        break;
      case "--retain-branch":
        parsed.retainedBranches.push(value());
        break;
      case "--disposable-dir":
        parsed.disposableDirectories.push(value());
        break;
      case "--detached":
      case "--branch-only":
        if (kind !== "paired")
          throw new CleanupUsageError(
            "target selectors are mutually exclusive",
          );
        kind = arg === "--detached" ? "detached" : "branch-only";
        break;
      case "--worktree":
      case "--branch":
      case "--expected-head":
        if (target.has(arg))
          throw new CleanupUsageError(`${arg} requires one value`);
        target.set(arg, value());
        break;
      case "--help":
      case "-h":
        throw new HelpRequested();
      default:
        throw new CleanupUsageError(`unknown argument: ${arg}`);
    }
  }
  parsed.disposableDirectories = validateDisposableDirectories(
    parsed.disposableDirectories,
  );
  if (target.size || kind !== "paired") {
    const valid =
      target.has("--expected-head") &&
      (kind === "paired"
        ? target.size === 3 &&
          target.has("--worktree") &&
          target.has("--branch")
        : kind === "detached"
          ? target.size === 2 && target.has("--worktree")
          : target.size === 2 && target.has("--branch"));
    if (
      !valid ||
      !parsed.targetRepo ||
      parsed.forceBranches ||
      parsed.forceDirtyWorktrees ||
      parsed.retainedWorktrees.length ||
      parsed.retainedBranches.length
    ) {
      throw new CleanupUsageError(
        "targeted cleanup requires --repo and complete explicit target inputs, without force or retention overrides",
      );
    }
    parsed.target = {
      kind,
      worktree: target.get("--worktree") ?? "",
      branch: target.get("--branch") ?? "",
      expectedHead: target.get("--expected-head") ?? "",
      disposableDirectories: parsed.disposableDirectories,
    };
  }
  parsed.targetRepo ||= process.cwd();
  return parsed;
}

const message = (err: unknown) =>
  err instanceof Error ? err.message : String(err);
const oneLine = (value: string) => value.replace(/[\r\n]/gu, " ");
const incomplete = (outcome: Outcome) =>
  outcome.status === "retained" || outcome.status === "failed";

async function workspaceCleanup(parsed: Args): Promise<RuntimeCommandOutcome> {
  if (
    !(await isInsideWorktree(parsed.targetRepo)) ||
    (await isBareRepository(parsed.targetRepo))
  )
    throw new CleanupUsageError("repository must be a non-bare Git worktree");
  const root = await showTopLevel(parsed.targetRepo);
  if (parsed.mode === "dry-run")
    await git(["fetch", "origin", "--prune"], root);
  const defaultBranch = await resolveDefaultBranch(root);
  if (
    !defaultBranch ||
    !(await showRefExists(root, `refs/remotes/origin/${defaultBranch}`))
  )
    throw new CleanupUsageError("could not resolve origin default branch");
  const remoteDefault = `refs/remotes/origin/${defaultBranch}`;
  const records = await collectWorktrees(root, true);
  if (!records.length) throw new CleanupUsageError("no worktrees found");
  const primary = records[0].realPath;
  const retained = new Set(
    await Promise.all(
      parsed.retainedWorktrees.map(async (entry) => {
        try {
          return await realpath(path.resolve(entry));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          return path.resolve(entry);
        }
      }),
    ),
  );
  const worktrees: WorktreeFact[] = [];
  const branches: BranchFact[] = [];
  const forceBranches = parsed.mode === "execute" && parsed.forceBranches;
  const forceDirty = parsed.mode === "execute" && parsed.forceDirtyWorktrees;

  async function classifyWorktree(
    record: WorktreeRecord,
    expected?: string,
  ): Promise<WorktreeFact> {
    const fact: WorktreeFact = {
      record,
      head: "",
      dirtyFiles: 0,
      status: "retained",
      reason: "",
    };
    try {
      if (
        retained.has(record.realPath) ||
        parsed.retainedBranches.includes(record.branch)
      )
        fact.reason = "caller-retained";
      else if (record.locked) fact.reason = "locked-worktree";
      else if (record.prunable || !(await canonicalPath(record.realPath)))
        fact.reason = "unavailable-registration";
      else {
        fact.head = await revParse(record.realPath, "HEAD");
        fact.dirtyFiles = countStatusLines(
          await worktreeStatus(record.realPath),
        );
        if (expected && fact.head !== expected)
          fact.reason = "worktree-identity-mismatch";
        else if (fact.dirtyFiles > 0 && !forceDirty)
          fact.reason = "dirty-worktree";
        else if (
          !(await commitIsMerged(primary, fact.head, remoteDefault)) &&
          (!forceBranches || !record.branch)
        )
          fact.reason = "unique-commits";
        else
          fact.reason =
            nestedRepositoryBlocker(
              await inspectNestedRepositories(record.realPath),
            ) ||
            (await ignoredContentBlocker(
              record.realPath,
              parsed.disposableDirectories,
            ));
      }
      if (!fact.reason) {
        fact.status = "eligible";
        fact.reason = "verified-target";
      }
    } catch (err) {
      fact.status = "failed";
      fact.reason = message(err);
    }
    return fact;
  }
  for (const record of records.slice(1))
    worktrees.push(await classifyWorktree(record));
  for (const ref of await localBranches(primary)) {
    const branch = ref.slice("refs/heads/".length);
    if (branch === defaultBranch) continue;
    const fact: BranchFact = {
      branch,
      head: "",
      status: "retained",
      reason: "",
      classification: "unique",
    };
    try {
      fact.head = await revParse(primary, ref);
      const ancestor =
        (
          await git(
            ["merge-base", "--is-ancestor", ref, remoteDefault],
            primary,
            [0, 1],
          )
        ).exitCode === 0;
      fact.classification = ancestor
        ? "ancestor"
        : (await commitIsMerged(primary, fact.head, remoteDefault))
          ? "squash"
          : "unique";
      if (parsed.retainedBranches.includes(branch))
        fact.reason = "caller-retained";
      else if (
        (await git(["symbolic-ref", "--quiet", ref], primary, [0, 1]))
          .exitCode === 0
      )
        fact.reason = "symbolic-branch";
      else if (
        worktrees.some(
          (entry) => entry.record.branch === branch && incomplete(entry),
        )
      )
        fact.reason = "branch-in-retained-worktree";
      else if (fact.classification === "unique" && !forceBranches)
        fact.reason = "unique-commits";
      else {
        fact.status = "eligible";
        fact.reason = "verified-tip";
      }
    } catch (err) {
      fact.status = "failed";
      fact.reason = message(err);
    }
    branches.push(fact);
  }
  let base: Outcome = { status: "eligible", reason: "verified-base" };
  let ahead = 0;
  let primaryDirtyFiles = 0;
  try {
    if (await showRefExists(primary, `refs/heads/${defaultBranch}`))
      ahead = Number(
        (
          await git(
            [
              "rev-list",
              "--count",
              `${remoteDefault}..refs/heads/${defaultBranch}`,
            ],
            primary,
          )
        ).stdout.trim(),
      );
    primaryDirtyFiles = countStatusLines(await worktreeStatus(primary));
    if (retained.has(primary))
      base = { status: "retained", reason: "caller-retained" };
    else if (primaryDirtyFiles)
      base = { status: "retained", reason: "dirty-primary-worktree" };
    else if (ahead)
      base = {
        status: "retained",
        reason: "default-branch-local-only-commits",
      };
    else if (
      worktrees.some(
        (fact) => fact.record.branch === defaultBranch && incomplete(fact),
      )
    )
      base = {
        status: "retained",
        reason: "default-branch-in-linked-worktree",
      };
  } catch (err) {
    base = { status: "failed", reason: message(err) };
  }

  if (incomplete(base)) {
    for (const fact of branches) {
      if (fact.status === "eligible" && fact.branch === records[0].branch) {
        fact.status = "retained";
        fact.reason = "branch-in-retained-worktree";
      }
    }
  }
  const eligibleWorktrees = worktrees.filter(
    (entry) => entry.status === "eligible",
  ).length;
  const eligibleBranches = branches.filter(
    (entry) => entry.status === "eligible",
  ).length;
  if (parsed.mode === "execute") {
    for (const fact of worktrees) {
      if (fact.status !== "eligible") continue;
      try {
        const current = (await collectWorktrees(primary, true)).find(
          (entry) => entry.realPath === fact.record.realPath,
        );
        if (!current || current.branch !== fact.record.branch)
          throw new Error("worktree registration changed");
        const fresh = await classifyWorktree(current, fact.head);
        if (fresh.status !== "eligible") {
          Object.assign(fact, fresh);
          continue;
        }
        await removeLinkedWorktree(
          primary,
          current.realPath,
          forceDirty,
          parsed.disposableDirectories,
          { head: fact.head, branch: fact.record.branch },
        );
        fact.status = "removed";
        fact.reason = "directory-and-registration-removal-verified";
      } catch (err) {
        fact.status = "failed";
        fact.reason = message(err);
      }
    }
    if (base.status === "eligible") {
      try {
        if (await worktreeStatus(primary))
          throw new Error("primary became dirty");
        if (await showRefExists(primary, `refs/heads/${defaultBranch}`))
          await git(["checkout", defaultBranch], primary);
        else
          await git(["checkout", "-b", defaultBranch, remoteDefault], primary);
        await git(["merge", "--ff-only", remoteDefault], primary);
        base = { status: "updated", reason: "default-checkout-fast-forwarded" };
      } catch (err) {
        base = { status: "failed", reason: message(err) };
      }
    }
    for (const fact of branches) {
      if (fact.status !== "eligible") continue;
      try {
        const ref = `refs/heads/${fact.branch}`;
        if (
          (await collectWorktrees(primary, true)).some(
            (entry) => entry.branch === fact.branch,
          )
        ) {
          fact.status = "retained";
          fact.reason = "branch-in-use";
          continue;
        }
        if (!(await showRefExists(primary, ref))) {
          fact.status = "already-absent";
          fact.reason = "local-ref-absent";
          continue;
        }
        if (
          (await git(["symbolic-ref", "--quiet", ref], primary, [0, 1]))
            .exitCode === 0 ||
          (await revParse(primary, ref)) !== fact.head
        ) {
          fact.status = "retained";
          fact.reason = "branch-tip-mismatch";
          continue;
        }
        await git(["update-ref", "--no-deref", "-d", ref, fact.head], primary);
        if (await showRefExists(primary, ref))
          throw new Error("branch removal not verified");
        fact.status = "removed";
        fact.reason = "expected-local-ref-deleted";
      } catch (err) {
        fact.status = "failed";
        fact.reason = message(err);
      }
    }
  }
  const blocked = [base, ...worktrees, ...branches].some(incomplete);
  const fields: Array<[string, string | number | boolean]> = [
    ["MODE", parsed.mode],
    ["STATUS", blocked ? "blocked" : "ok"],
    ["DEFAULT_BRANCH", defaultBranch],
    ["PRIMARY_WORKTREE", primary],
    ["CANDIDATE_WORKTREES", worktrees.length],
    ["REMOVABLE_WORKTREES", eligibleWorktrees],
    ["PRUNABLE_WORKTREES", records.filter((entry) => entry.prunable).length],
    ["LOCKED_WORKTREES", records.filter((entry) => entry.locked).length],
    [
      "DIRTY_WORKTREES",
      worktrees.filter((entry) => entry.reason === "dirty-worktree").length +
        Number(base.reason === "dirty-primary-worktree"),
    ],
    ["LOCAL_BRANCHES_TO_DELETE", eligibleBranches],
    [
      "LOCAL_BRANCHES_WITH_UNIQUE_COMMITS",
      branches.filter((entry) => entry.classification === "unique").length,
    ],
    ["DEFAULT_BRANCH_AHEAD_COMMITS", ahead],
    ["BASE_UPDATE", base.status],
    ["BASE_UPDATE_REASON", oneLine(base.reason)],
  ];
  if (primaryDirtyFiles)
    fields.push([
      "DIRTY_WORKTREE",
      `${primary}|FILES=${primaryDirtyFiles}|PRIMARY=true`,
    ]);
  for (const fact of worktrees) {
    if (fact.dirtyFiles)
      fields.push([
        "DIRTY_WORKTREE",
        `${fact.record.realPath}|FILES=${fact.dirtyFiles}|PRIMARY=false`,
      ]);
    if (fact.record.locked)
      fields.push([
        "LOCKED_WORKTREE",
        `${fact.record.realPath}|REASON=${fact.record.lockedReason}`,
      ]);
    if (fact.record.prunable)
      fields.push(["PRUNABLE_WORKTREE", fact.record.path]);
    fields.push([
      "WORKTREE_RESULT",
      `${fact.record.realPath}|STATUS=${fact.status}|REASON=${oneLine(fact.reason)}`,
    ]);
    if (fact.status === "eligible")
      fields.push(["REMOVABLE_WORKTREE", fact.record.realPath]);
  }
  for (const fact of branches) {
    fields.push([
      "BRANCH_RESULT",
      `${fact.branch}|STATUS=${fact.status}|REASON=${oneLine(fact.reason)}`,
    ]);
    if (fact.status === "eligible") fields.push(["DELETE_BRANCH", fact.branch]);
    if (fact.classification !== "unique")
      fields.push([
        "MERGED_BRANCH",
        `${fact.branch}|REASON=${fact.classification}`,
      ]);
    else fields.push(["UNIQUE_BRANCH", fact.branch]);
  }
  return {
    exitCode: parsed.mode === "execute" && blocked ? 1 : 0,
    stdout: lineOutput(fields),
    stderr: "",
  };
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
