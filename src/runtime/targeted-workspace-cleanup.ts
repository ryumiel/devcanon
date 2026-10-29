import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import {
  CleanupUsageError,
  collectWorktrees,
  git,
  inspectNestedRepositories,
  isBareRepository,
  lineOutput,
  nestedRepositoryBlocker,
  removeLinkedWorktree,
  requireCanonicalDirectory,
  resolveDefaultBranch,
  revParse,
  showRefExists,
  showTopLevel,
  withoutLazyFetch,
  worktreeStatus,
} from "./cleanup-git.js";
import type { RuntimeCommandOutcome } from "./command.js";

interface Target {
  worktree: string;
  branch: string;
  expectedHead: string;
}
interface ResourceOutcome {
  status: "eligible" | "already-absent" | "removed" | "retained" | "failed";
  reason: string;
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Local Git effects only; the caller owns disposal and host lifecycle authority. */
export function runTargetedCleanup(
  repo: string,
  mode: "dry-run" | "execute",
  target: Target,
): Promise<RuntimeCommandOutcome> {
  return withoutLazyFetch(() => inspectAndCleanTarget(repo, mode, target));
}

async function inspectAndCleanTarget(
  repo: string,
  mode: "dry-run" | "execute",
  target: Target,
): Promise<RuntimeCommandOutcome> {
  const repoDirectory = await requireCanonicalDirectory(repo, "repository");
  const root = await requireCanonicalDirectory(
    await showTopLevel(repoDirectory),
    "repository root",
  );
  if (await isBareRepository(root))
    throw new CleanupUsageError("bare repositories are unsupported");
  if (
    !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(target.expectedHead) ||
    (
      await git(
        ["check-ref-format", `refs/heads/${target.branch}`],
        root,
        [0, 1],
      )
    ).exitCode !== 0 ||
    target.branch.startsWith("-") ||
    target.branch.startsWith("refs/")
  ) {
    throw new CleanupUsageError(
      "target requires a local branch name and full expected commit SHA",
    );
  }
  if (
    (
      await git(["cat-file", "-t", target.expectedHead], root, [0, 128])
    ).stdout.trim() !== "commit"
  ) {
    throw new CleanupUsageError(
      "expected HEAD is not a commit in this repository",
    );
  }

  // Resolve missing parents through an existing ancestor, without following a
  // replacement leaf or treating a dangling ancestor symlink as absent.
  const requested = path.resolve(target.worktree);
  let ancestor = path.dirname(requested);
  const missingParts = [path.basename(requested)];
  while (!(await exists(ancestor))) {
    missingParts.unshift(path.basename(ancestor));
    ancestor = path.dirname(ancestor);
  }
  const selected = path.join(await realpath(ancestor), ...missingParts);
  const ref = `refs/heads/${target.branch}`;
  let worktree: ResourceOutcome = {
    status: "retained",
    reason: "not-inspected",
  };
  let branch: ResourceOutcome = {
    status: "retained",
    reason: "worktree-not-removed",
  };

  async function branchBlocker(): Promise<string> {
    const records = await collectWorktrees(root, true);
    const defaultBranch = await resolveDefaultBranch(root);
    if (!defaultBranch) return "default-branch-unknown";
    if (target.branch === defaultBranch || target.branch === records[0]?.branch)
      return "protected-branch";
    if (
      (await git(["symbolic-ref", "--quiet", ref], root, [0, 1])).exitCode === 0
    )
      return "symbolic-branch";
    if (await showRefExists(root, ref)) {
      if ((await revParse(root, ref)) !== target.expectedHead)
        return "branch-tip-mismatch";
    }
    if (
      records.some(
        (entry) =>
          entry.branch === target.branch && entry.realPath !== selected,
      )
    )
      return "branch-in-use";
    return "";
  }

  async function inspect(): Promise<ResourceOutcome> {
    const records = await collectWorktrees(root, true);
    const present = await exists(selected);
    const record = records.find(
      (entry) =>
        entry.realPath === selected || path.resolve(entry.path) === selected,
    );
    if (!present && !record)
      return {
        status: "already-absent",
        reason: "directory-and-registration-absent",
      };
    if (!present || !record)
      return { status: "retained", reason: "directory-registration-mismatch" };
    if (record === records[0])
      return { status: "retained", reason: "primary-worktree" };
    if (root === selected)
      return { status: "retained", reason: "repository-checkout-is-target" };
    if (record.locked) return { status: "retained", reason: "locked-worktree" };
    if (
      (await requireCanonicalDirectory(selected, "target worktree")) !==
        selected ||
      record.branch !== target.branch ||
      (await revParse(selected, "HEAD")) !== target.expectedHead
    ) {
      return { status: "retained", reason: "worktree-identity-mismatch" };
    }
    const blocker = await branchBlocker();
    if (blocker) return { status: "retained", reason: blocker };
    const nested = nestedRepositoryBlocker(
      await inspectNestedRepositories(selected),
    );
    if (nested) return { status: "retained", reason: nested };
    if (await worktreeStatus(selected))
      return { status: "retained", reason: "dirty-worktree" };
    return { status: "eligible", reason: "verified-target" };
  }

  try {
    worktree = await inspect();
    if (worktree.status === "eligible" && mode === "execute") {
      // Reinspect identity immediately before the shared primitive repeats preservation guards.
      worktree = await inspect();
      if (worktree.status === "eligible") {
        try {
          const records = await collectWorktrees(root, true);
          await removeLinkedWorktree(records[0].realPath, selected);
          worktree = {
            status: "removed",
            reason: "directory-and-registration-removal-verified",
          };
        } catch (error) {
          worktree = {
            status: "failed",
            reason: error instanceof Error ? error.message : String(error),
          };
        }
      }
    }
    if (["eligible", "removed", "already-absent"].includes(worktree.status)) {
      const blocker = await branchBlocker();
      if (blocker) branch = { status: "retained", reason: blocker };
      else if (!(await showRefExists(root, ref)))
        branch = { status: "already-absent", reason: "local-ref-absent" };
      else if (mode === "dry-run")
        branch = { status: "eligible", reason: "expected-tip-verified" };
      else if (
        (await exists(selected)) ||
        (await collectWorktrees(root, true)).some(
          (entry) =>
            entry.realPath === selected || entry.branch === target.branch,
        )
      ) {
        branch = {
          status: "retained",
          reason: "worktree-absence-not-verified",
        };
      } else {
        try {
          // Compare-and-delete prevents a changed branch tip from being removed.
          await git(
            ["update-ref", "--no-deref", "-d", ref, target.expectedHead],
            root,
          );
          branch = (await showRefExists(root, ref))
            ? { status: "failed", reason: "branch-removal-not-verified" }
            : { status: "removed", reason: "expected-local-ref-deleted" };
        } catch (error) {
          branch = {
            status: "failed",
            reason: error instanceof Error ? error.message : String(error),
          };
        }
      }
    }
  } catch (error) {
    const failure: ResourceOutcome = {
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
    if (worktree.status === "removed" || worktree.status === "already-absent")
      branch = failure;
    else worktree = failure;
  }
  const blocked = [worktree, branch].some(
    (entry) => entry.status === "retained" || entry.status === "failed",
  );
  const oneLine = (value: string) => value.replace(/[\r\n]+/gu, " ");
  return {
    exitCode: mode === "execute" && blocked ? 1 : 0,
    stdout: lineOutput([
      ["MODE", mode],
      ["SCOPE", "targeted"],
      ["STATUS", blocked ? "blocked" : "ok"],
      ["WORKTREE", selected],
      ["BRANCH", target.branch],
      ["EXPECTED_HEAD", target.expectedHead],
      ["WORKTREE_STATUS", worktree.status],
      ["WORKTREE_REASON", oneLine(worktree.reason)],
      ["BRANCH_STATUS", branch.status],
      ["BRANCH_REASON", oneLine(branch.reason)],
    ]),
    stderr: "",
  };
}
