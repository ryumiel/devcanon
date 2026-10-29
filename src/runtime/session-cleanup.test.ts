import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as cleanupGit from "./cleanup-git.js";
import {
  canonicalPath,
  collectWorktrees,
  git,
  revParse,
  showRefExists,
} from "./cleanup-git.js";
import { runGitWorkspaceCleanupCommand as cleanup } from "./git-workspace-cleanup.js";
import { runPrReviewLeasesCommand as review } from "./pr-review-leases.js";

const roots: string[] = [];
const cwd = process.cwd();
afterEach(async () => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "session-cleanup-")),
  );
  roots.push(root);
  const repo = path.join(root, "primary");
  await mkdir(repo);
  await git(["init", "--initial-branch=main"], repo);
  await git(["config", "user.name", "Test"], repo);
  await git(["config", "user.email", "test@example.com"], repo);
  await writeFile(path.join(repo, ".gitignore"), ".ephemeral/\n.env\ncache/\n");
  await writeFile(path.join(repo, "source"), "base\n");
  await git(["add", "."], repo);
  await git(["commit", "-m", "initial"], repo);
  const origin = path.join(root, "origin.git");
  await git(["init", "--bare", "--initial-branch=main", origin], root);
  await git(["remote", "add", "origin", origin], repo);
  await git(["push", "origin", "main"], repo);
  const head = await revParse(repo, "HEAD");
  async function detached(name: string) {
    const target = path.join(root, name);
    await git(["worktree", "add", "--detach", target, head], repo);
    await mkdir(path.join(target, ".ephemeral"));
    await writeFile(
      path.join(target, ".ephemeral", "session-data.json"),
      "obsolete session data",
    );
    return target;
  }
  return { root, repo, head, detached };
}

describe("independent completed-session cleanup", () => {
  it("continues from the primary checkout after removing the selected linked repository", async () => {
    const { repo, detached } = await fixture();
    const selected = await detached("a-selected");
    const other = await detached("b-other");
    await git(["branch", "delivered"], repo);
    const result = await cleanup(["--repo", selected, "--execute"]);
    expect(result.exitCode).toBe(0);
    expect(await canonicalPath(selected)).toBeNull();
    expect(await canonicalPath(other)).toBeNull();
    expect(await showRefExists(repo, "refs/heads/delivered")).toBe(false);
  });

  it("retains the current checkout while removing completed detached reviews and unused merged branches", async () => {
    const { repo, detached } = await fixture();
    const current = await detached("current");
    const first = await detached("review-one");
    const second = await detached("review-two");
    await git(["branch", "delivered"], repo);
    const args = ["--repo", repo, "--retain-worktree", current];
    const preview = await cleanup([...args, "--dry-run"]);
    expect(preview.exitCode).toBe(0);
    expect(preview.stdout).toContain("CANDIDATE_WORKTREES=3");
    expect(preview.stdout).toContain("REMOVABLE_WORKTREES=2");
    expect(preview.stdout).toContain(
      `${current}|STATUS=retained|REASON=caller-retained`,
    );
    const result = await cleanup([...args, "--execute"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(`${first}|STATUS=removed`);
    expect(result.stdout).toContain(`${second}|STATUS=removed`);
    expect(await canonicalPath(first)).toBeNull();
    expect(await canonicalPath(second)).toBeNull();
    expect(await canonicalPath(current)).not.toBeNull();
    expect(await showRefExists(repo, "refs/heads/delivered")).toBe(false);
    const retry = await cleanup([...args, "--execute"]);
    expect(retry.stdout).toContain("CANDIDATE_WORKTREES=1");
    expect((await collectWorktrees(repo)).length).toBe(2);
  });

  // CLEANUP-04, runtime layer: linked retention did not cover an excluded primary.
  it("preserves an explicitly retained primary while completing independent cleanup", async () => {
    const { repo, head, detached } = await fixture();
    await git(["checkout", "-b", "active"], repo);
    const completed = await detached("completed");
    await git(["branch", "delivered"], repo);
    const result = await cleanup([
      "--repo",
      repo,
      "--retain-worktree",
      repo,
      "--execute",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("BASE_UPDATE=retained");
    expect(result.stdout).toContain("BASE_UPDATE_REASON=caller-retained");
    expect(result.stdout).toContain(
      "active|STATUS=retained|REASON=branch-in-retained-worktree",
    );
    expect(await revParse(repo, "HEAD")).toBe(head);
    expect((await git(["branch", "--show-current"], repo)).stdout.trim()).toBe(
      "active",
    );
    expect(await showRefExists(repo, "refs/heads/active")).toBe(true);
    expect(await canonicalPath(completed)).toBeNull();
    expect(
      (await collectWorktrees(repo)).map((record) => record.realPath),
    ).toEqual([repo]);
    expect(await showRefExists(repo, "refs/heads/delivered")).toBe(false);
  });

  it("continues after a branch deletion failure and protects dirty and locked worktrees", async () => {
    const { repo, detached } = await fixture();
    const locked = await detached("locked");
    await git(["worktree", "lock", locked], repo);
    const dirty = await detached("dirty");
    await writeFile(path.join(dirty, "source"), "preserve changes");
    const done = await detached("done");
    await git(["branch", "a-locked-ref"], repo);
    await git(["branch", "z-delivered"], repo);
    const lock = path.join(repo, ".git", "refs", "heads", "a-locked-ref.lock");
    await writeFile(lock, "lock");
    const result = await cleanup(["--repo", repo, "--execute"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("a-locked-ref|STATUS=failed");
    expect(result.stdout).toContain("z-delivered|STATUS=removed");
    expect(result.stdout).toContain(`${done}|STATUS=removed`);
    expect(await readFile(path.join(dirty, "source"), "utf8")).toBe(
      "preserve changes",
    );
    expect(await canonicalPath(locked)).not.toBeNull();
    await rm(lock);
    expect((await cleanup(["--repo", repo, "--execute"])).stdout).toContain(
      "a-locked-ref|STATUS=removed",
    );
  });

  // EVID-004-CLEANUP, runtime layer: current registrations miss failed dependencies after detachment.
  it("retains a failed checkout's original branch after detachment and removes independent branches", async () => {
    const { root, repo, head } = await fixture();
    const target = path.join(root, "completed");
    await git(["worktree", "add", "-b", "dependent", target], repo);
    await git(["branch", "unrelated"], repo);
    const collect = cleanupGit.collectWorktrees;
    const spy = vi
      .spyOn(cleanupGit, "collectWorktrees")
      .mockImplementationOnce(collect)
      .mockImplementationOnce(async (...args) => {
        await git(["checkout", "--detach"], target);
        return collect(...args);
      });
    try {
      const result = await cleanup(["--repo", repo, "--execute"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("STATUS=blocked");
      expect(result.stdout).toContain(
        `${target}|STATUS=failed|REASON=worktree registration changed`,
      );
      expect(await showRefExists(repo, "refs/heads/dependent")).toBe(true);
      expect(await revParse(repo, "refs/heads/dependent")).toBe(head);
      expect(result.stdout).toContain(
        "dependent|STATUS=retained|REASON=branch-in-retained-worktree",
      );
      expect(await canonicalPath(target)).not.toBeNull();
      expect(
        (await collect(repo)).find((record) => record.realPath === target)
          ?.branch,
      ).toBe("");
      expect(await showRefExists(repo, "refs/heads/unrelated")).toBe(false);
      expect(result.stdout).toContain("unrelated|STATUS=removed");
    } finally {
      spy.mockRestore();
    }
  });

  it("protects arbitrary ignored files and permits explicit disposable directories", async () => {
    const { repo, head, detached } = await fixture();
    const target = await detached("review");
    const args = [
      "--repo",
      repo,
      "--detached",
      "--worktree",
      target,
      "--expected-head",
      head,
    ];
    await writeFile(path.join(target, ".env"), "private user config");
    expect((await cleanup([...args, "--execute"])).stdout).toContain(
      "ignored-content:.env",
    );
    await rm(path.join(target, ".env"));
    await mkdir(path.join(target, "cache"));
    await writeFile(path.join(target, "cache", "generated"), "cache");
    expect((await cleanup([...args, "--dry-run"])).stdout).toContain(
      "ignored-content:cache/",
    );
    const result = await cleanup([
      ...args,
      "--disposable-dir",
      "cache",
      "--execute",
    ]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("BRANCH_STATUS=skipped");
    expect((await cleanup([...args, "--execute"])).stdout).toContain(
      "WORKTREE_STATUS=already-absent",
    );
  });

  it("guards branch-only identity, unique commits, and branches used by retained worktrees", async () => {
    const { root, repo, head } = await fixture();
    const target = path.join(root, "active");
    await git(["worktree", "add", "-b", "feature", target], repo);
    const args = [
      "--repo",
      repo,
      "--branch-only",
      "--branch",
      "feature",
      "--expected-head",
      head,
    ];
    expect((await cleanup([...args, "--execute"])).stdout).toContain(
      "branch-in-use",
    );
    await writeFile(path.join(target, "source"), "local only");
    await git(["commit", "-am", "local work"], target);
    const changed = await revParse(target, "HEAD");
    await git(["worktree", "remove", target], repo);
    expect((await cleanup([...args, "--execute"])).stdout).toContain(
      "branch-tip-mismatch",
    );
    expect(
      (await cleanup([...args.slice(0, -1), changed, "--execute"])).stdout,
    ).toContain("unique-commits");
    await git(["branch", "-f", "feature", head], repo);
    expect((await cleanup([...args, "--execute"])).exitCode).toBe(0);
    expect((await cleanup([...args, "--execute"])).stdout).toContain(
      "BRANCH_STATUS=already-absent",
    );
  });

  it("protects a changed detached HEAD and detached local-only commits", async () => {
    const { repo, head, detached } = await fixture();
    const target = await detached("review");
    const args = [
      "--repo",
      repo,
      "--detached",
      "--worktree",
      target,
      "--expected-head",
      head,
    ];
    await writeFile(path.join(target, "source"), "local only");
    await git(["commit", "-am", "local work"], target);
    expect((await cleanup([...args, "--execute"])).stdout).toContain(
      "worktree-identity-mismatch",
    );
    const changed = await revParse(target, "HEAD");
    expect(
      (await cleanup([...args.slice(0, -1), changed, "--execute"])).stdout,
    ).toContain("unique-commits");
    expect(
      (await cleanup(["--repo", repo, "--execute", "--force-branches"])).stdout,
    ).toContain(`${target}|STATUS=retained|REASON=unique-commits`);
  });

  it("accepts squash-merged detached work without writing synthetic commit objects", async () => {
    const { repo, detached } = await fixture();
    const target = await detached("review");
    await writeFile(path.join(target, "source"), "delivered\n");
    await git(["commit", "-am", "feature"], target);
    const head = await revParse(target, "HEAD");
    await git(["merge", "--squash", head], repo);
    await git(["commit", "-m", "squash delivery"], repo);
    await git(["push", "origin", "main"], repo);
    const args = [
      "--repo",
      repo,
      "--detached",
      "--worktree",
      target,
      "--expected-head",
      head,
    ];
    const before = (await git(["count-objects", "-v"], repo)).stdout;
    expect((await cleanup([...args, "--dry-run"])).stdout).toContain(
      "WORKTREE_STATUS=eligible",
    );
    expect((await git(["count-objects", "-v"], repo)).stdout).toBe(before);
    expect((await cleanup([...args, "--execute"])).exitCode).toBe(0);
  });

  it.each(["missing", "invalid"])(
    "disposes completed review data with %s lifecycle records and honors explicit retention",
    async (kind) => {
      const { repo, head, detached } = await fixture();
      const target = await detached("review");
      process.chdir(repo);
      for (const [key, value] of Object.entries({
        REPOSITORY: "owner/repo",
        PR_NUMBER: "432",
        PRIMARY_REPOSITORY_ROOT: repo,
        WORKTREE_PATH: target,
        HEAD_SHA: head,
        SESSION_COMPLETED: "yes",
      }))
        vi.stubEnv(key, value);
      const lease = `.ephemeral/pr-432-${createHash("sha256").update(target).digest("hex")}-lease.json`;
      vi.stubEnv("LEASE_FILE", lease);
      if (kind === "invalid") {
        await mkdir(path.join(repo, ".ephemeral"));
        await writeFile(path.join(repo, lease), "invalid historical record");
      }
      for (const reason of [
        "explicit user retention",
        "active consumer",
        "unresolved posting operation",
      ]) {
        vi.stubEnv("RETAIN_SESSION_REASON", reason);
        const result = await review(["cleanup-worktree"]);
        expect(result.stdout).toContain("REFUSAL_REASON=session-retained");
        expect(result.stdout).toContain(reason);
        expect(await canonicalPath(target)).not.toBeNull();
      }
      vi.stubEnv("RETAIN_SESSION_REASON", "");
      const preview = await review(["inspect-worktree"]);
      expect(preview.stdout, preview.stderr).toContain(
        "WORKTREE_STATUS=eligible",
      );
      const result = await review(["cleanup-worktree"]);
      expect(result.stdout, result.stderr).toContain("WORKTREE_STATUS=removed");
      if (kind === "invalid")
        expect(await readFile(path.join(repo, lease), "utf8")).toBe(
          "invalid historical record",
        );
      else
        expect(
          await readFile(path.join(repo, lease)).catch(() => null),
        ).toBeNull();
    },
  );
});
