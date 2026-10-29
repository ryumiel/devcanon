import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalPath,
  collectWorktrees,
  git,
  revParse,
  showRefExists,
} from "./cleanup-git.js";
import { runGitWorkspaceCleanupCommand } from "./git-workspace-cleanup.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "target-cleanup-"));
  roots.push(root);
  const repo = path.join(root, "primary");
  await mkdir(repo);
  await git(["init", "--initial-branch=main"], repo);
  await git(["config", "user.name", "Test"], repo);
  await git(["config", "user.email", "test@example.com"], repo);
  await writeFile(path.join(repo, "file"), "delivered\n");
  await git(["add", "."], repo);
  await git(["commit", "-m", "initial"], repo);
  const head = await revParse(repo, "HEAD");
  await git(["update-ref", "refs/remotes/origin/main", head], repo);
  const target = path.join(root, "selected worktree");
  await git(["worktree", "add", "-b", "feature/selected", target], repo);
  const args = [
    "--repo",
    repo,
    "--worktree",
    target,
    "--branch",
    "feature/selected",
    "--expected-head",
    head,
  ];
  return { root, repo, target, head, args };
}

describe("targeted local cleanup", () => {
  it("rejects incomplete target selection and broad force overrides before any cleanup", async () => {
    const { repo, target, args } = await fixture();
    for (const invalid of [
      args.slice(0, -2),
      args.slice(2),
      [...args, "--force-branches"],
      [...args, "--force-dirty-worktrees"],
      [...args, "--branch", "other"],
      [...args.slice(0, -1), "HEAD"],
    ]) {
      expect(
        (await runGitWorkspaceCleanupCommand([...invalid, "--execute"]))
          .exitCode,
      ).toBe(2);
      expect(await canonicalPath(target)).not.toBeNull();
      expect(await showRefExists(repo, "refs/heads/feature/selected")).toBe(
        true,
      );
    }
  });

  it("previews without index, refs or registration writes and removes only selected local resources", async () => {
    const { root, repo, target, head, args } = await fixture();
    const other = path.join(root, "active");
    await git(["worktree", "add", "-b", "other", other], repo);
    await writeFile(path.join(other, "untracked"), "keep");
    await git(
      ["update-ref", "refs/remotes/origin/feature/selected", head],
      repo,
    );
    // A missing origin makes accidental fetch fail; stale registrations must not be pruned.
    const stale = path.join(root, "stale");
    await git(["worktree", "add", "-b", "stale", stale], repo);
    await rm(stale, { recursive: true });
    const index = (
      await git(["rev-parse", "--git-path", "index"], target)
    ).stdout.trim();
    const before = await readFile(index);
    const refs = (await git(["show-ref"], repo)).stdout;
    const registrations = (await git(["worktree", "list", "--porcelain"], repo))
      .stdout;
    const preview = await runGitWorkspaceCleanupCommand(args);
    expect(preview.exitCode).toBe(0);
    expect(preview.stdout).toContain("WORKTREE_STATUS=eligible");
    expect(await readFile(index)).toEqual(before);
    expect((await git(["show-ref"], repo)).stdout).toBe(refs);
    expect((await git(["worktree", "list", "--porcelain"], repo)).stdout).toBe(
      registrations,
    );
    const result = await runGitWorkspaceCleanupCommand([...args, "--execute"]);
    expect(result.stdout).toContain("WORKTREE_STATUS=removed");
    expect(result.stdout).toContain("BRANCH_STATUS=removed");
    expect(result.exitCode).toBe(0);
    expect(await canonicalPath(target)).toBeNull();
    expect(await revParse(repo, "HEAD")).toBe(head);
    expect(await revParse(repo, "refs/remotes/origin/feature/selected")).toBe(
      head,
    );
    expect(await readFile(path.join(other, "untracked"), "utf8")).toBe("keep");
    expect(
      (await collectWorktrees(repo, true)).map((entry) => entry.branch),
    ).toEqual(["main", "other", "stale"]);
    expect(
      (await runGitWorkspaceCleanupCommand([...args, "--execute"])).stdout,
    ).toContain("BRANCH_STATUS=already-absent");
  });

  it.each([
    "dirty",
    "locked",
    "primary",
    "wrong-branch",
    "wrong-head",
    "missing-locked",
    "missing",
    "unregistered",
    "default",
  ])("retains %s targets", async (kind) => {
    const { repo, target, head, args } = await fixture();
    if (kind === "dirty")
      await writeFile(path.join(target, "untracked"), "keep");
    if (kind === "locked" || kind === "missing-locked")
      await git(["worktree", "lock", target], repo);
    if (kind === "primary") {
      args[3] = repo;
      args[5] = "main";
    }
    if (kind === "wrong-branch") args[5] = "other";
    if (kind === "wrong-head") {
      await writeFile(path.join(target, "file"), "new");
      await git(["commit", "-am", "new"], target);
    }
    if (kind === "missing" || kind === "missing-locked")
      await rm(target, { recursive: true });
    if (kind === "unregistered") {
      await git(["worktree", "remove", target], repo);
      await mkdir(target);
    }
    if (kind === "default")
      await git(
        [
          "symbolic-ref",
          "refs/remotes/origin/HEAD",
          "refs/remotes/origin/feature/selected",
        ],
        repo,
      );
    const result = await runGitWorkspaceCleanupCommand([...args, "--execute"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("STATUS=blocked");
    expect(await showRefExists(repo, "refs/heads/feature/selected")).toBe(true);
    expect(await revParse(repo, "HEAD")).toBe(head);
  });

  it("reports branch failure after verified removal and retries only that ref", async () => {
    const { repo, target, args } = await fixture();
    const lock = path.join(
      repo,
      ".git",
      "refs",
      "heads",
      "feature",
      "selected.lock",
    );
    await writeFile(lock, "locked");
    const first = await runGitWorkspaceCleanupCommand([...args, "--execute"]);
    expect(first.exitCode).toBe(1);
    expect(first.stdout).toContain("WORKTREE_STATUS=removed");
    expect(first.stdout).toContain("BRANCH_STATUS=failed");
    expect(await canonicalPath(target)).toBeNull();
    await rm(lock);
    const retry = await runGitWorkspaceCleanupCommand([...args, "--execute"]);
    expect(retry.exitCode).toBe(0);
    expect(retry.stdout).toContain("WORKTREE_STATUS=already-absent");
    expect(retry.stdout).toContain("BRANCH_STATUS=removed");
  });

  it("does not dereference a symbolic branch during an absent-target retry", async () => {
    const { repo, target, head, args } = await fixture();
    await git(["worktree", "remove", target], repo);
    await git(
      ["symbolic-ref", "refs/heads/feature/selected", "refs/heads/main"],
      repo,
    );
    const result = await runGitWorkspaceCleanupCommand([...args, "--execute"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("BRANCH_REASON=symbolic-branch");
    expect(await revParse(repo, "refs/heads/main")).toBe(head);
  });

  it.each(["changed-tip", "used-elsewhere", "replacement"])(
    "retains %s during absent-target retry",
    async (kind) => {
      const { root, repo, target, args } = await fixture();
      await git(["worktree", "remove", target], repo);
      const replacement =
        kind === "replacement" ? target : path.join(root, "elsewhere");
      await git(["worktree", "add", replacement, "feature/selected"], repo);
      if (kind !== "used-elsewhere") {
        await writeFile(path.join(replacement, "file"), "changed");
        await git(["commit", "-am", "changed"], replacement);
        if (kind === "changed-tip")
          await git(["worktree", "remove", replacement], repo);
      }
      const result = await runGitWorkspaceCleanupCommand([
        ...args,
        "--execute",
      ]);
      expect(result.exitCode).toBe(1);
      expect(await showRefExists(repo, "refs/heads/feature/selected")).toBe(
        true,
      );
    },
  );
});
