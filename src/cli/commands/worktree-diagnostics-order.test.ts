import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canCreateSymlinks,
  cleanupTempDir,
  createTempDir,
} from "../../__test-helpers__/fixtures.js";
import { runGit } from "../../runtime/git.js";

const { realpathCalls } = vi.hoisted(() => ({
  realpathCalls: [] as string[],
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    realpath: vi.fn(async (target: Parameters<typeof actual.realpath>[0]) => {
      realpathCalls.push(String(target));
      return actual.realpath(target);
    }),
  };
});

const { diagnoseManagedWorktrees } = await import("./worktree-diagnostics.js");

describe("managed worktree diagnostic filesystem ordering", () => {
  let tempDir: string;

  beforeEach(async () => {
    realpathCalls.length = 0;
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("does not realpath through a symlinked managed worktree root", async () => {
    if (!(await canCreateSymlinks())) {
      return;
    }
    await initRepo(tempDir);
    await runGit(
      ["worktree", "add", "-b", "symlinked", ".worktrees/symlinked", "HEAD"],
      { cwd: tempDir },
    );
    await rm(path.join(tempDir, ".worktrees"), {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
    await mkdir(path.join(tempDir, "linked-root", "symlinked"), {
      recursive: true,
    });
    await symlink(
      path.join(tempDir, "linked-root"),
      path.join(tempDir, ".worktrees"),
      "dir",
    );
    realpathCalls.length = 0;

    const result = await diagnoseManagedWorktrees(tempDir);

    expect(result.status).toBe("warn");
    expect(result.findings).toEqual([
      ".worktrees is a symlink; inspect it manually before cleanup.",
    ]);
    const managedRoot = path.join(tempDir, ".worktrees");
    const managedRootPrefix = `${managedRoot}${path.sep}`;
    expect(
      realpathCalls.filter(
        (call) => call === managedRoot || call.startsWith(managedRootPrefix),
      ),
    ).toEqual([]);
  });
});

async function initRepo(repoDir: string): Promise<void> {
  await runGit(["init", "--initial-branch=main"], { cwd: repoDir });
  await runGit(["config", "user.name", "Test User"], { cwd: repoDir });
  await runGit(["config", "user.email", "test@example.com"], { cwd: repoDir });
  await writeFile(path.join(repoDir, "README.md"), "test\n");
  await runGit(["add", "README.md"], { cwd: repoDir });
  await runGit(["commit", "-m", "test: initial"], { cwd: repoDir });
}
