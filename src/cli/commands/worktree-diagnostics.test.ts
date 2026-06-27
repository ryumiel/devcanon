import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canCreateSymlinks,
  cleanupTempDir,
  createTempDir,
} from "../../__test-helpers__/fixtures.js";
import { runGit } from "../../runtime/git.js";
import { diagnoseManagedWorktrees } from "./worktree-diagnostics.js";

describe("managed worktree diagnostics", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("reports ok when no managed worktree directory exists", async () => {
    await initRepo(tempDir);

    await expect(diagnoseManagedWorktrees(tempDir)).resolves.toMatchObject({
      status: "ok",
      findings: [],
    });
  });

  it("reports ok for a healthy registered managed worktree", async () => {
    await initRepo(tempDir);
    await runGit(
      ["worktree", "add", "-b", "feature", ".worktrees/feature", "HEAD"],
      { cwd: tempDir },
    );

    await expect(diagnoseManagedWorktrees(tempDir)).resolves.toMatchObject({
      status: "ok",
      findings: [],
    });
  });

  it("reports orphaned entries with missing metadata", async () => {
    await initRepo(tempDir);
    const orphan = path.join(tempDir, ".worktrees", "orphan");
    await mkdir(orphan, { recursive: true });
    await writeFile(
      path.join(orphan, ".git"),
      "gitdir: ../../.git/worktrees/orphan\n",
      "utf-8",
    );

    const result = await diagnoseManagedWorktrees(tempDir);

    expect(result.status).toBe("warn");
    expect(result.findings).toContain(
      ".worktrees/orphan is not registered in git worktree metadata.",
    );
    expect(result.findings).toContain(
      ".worktrees/orphan/.git points to missing Git metadata.",
    );
  });

  it("reports cross-repo gitdir pointers", async () => {
    await initRepo(tempDir);
    const otherRepo = path.join(tempDir, "other");
    await initRepo(otherRepo);
    const externalMetadata = path.join(
      otherRepo,
      ".git",
      "worktrees",
      "external",
    );
    await mkdir(externalMetadata, { recursive: true });
    const entry = path.join(tempDir, ".worktrees", "external");
    await mkdir(entry, { recursive: true });
    await writeFile(
      path.join(entry, ".git"),
      `gitdir: ${externalMetadata}\n`,
      "utf-8",
    );

    const result = await diagnoseManagedWorktrees(tempDir);

    expect(result.status).toBe("warn");
    expect(result.findings).toContain(
      ".worktrees/external/.git points outside this repository's .git/worktrees metadata.",
    );
  });

  it("reports absolute gitdir pointers outside the worktrees metadata namespace", async () => {
    await initRepo(tempDir);
    const entry = path.join(tempDir, ".worktrees", "objects");
    await mkdir(entry, { recursive: true });
    await writeFile(
      path.join(entry, ".git"),
      `gitdir: ${path.join(tempDir, ".git", "objects")}\n`,
      "utf-8",
    );

    const result = await diagnoseManagedWorktrees(tempDir);

    expect(result.status).toBe("warn");
    expect(result.findings).toContain(
      ".worktrees/objects/.git points outside this repository's .git/worktrees metadata.",
    );
  });

  it("reports registered entries that point to another registered worktree metadata directory", async () => {
    await initRepo(tempDir);
    await runGit(["worktree", "add", "-b", "a", ".worktrees/a", "HEAD"], {
      cwd: tempDir,
    });
    await runGit(["worktree", "add", "-b", "b", ".worktrees/b", "HEAD"], {
      cwd: tempDir,
    });
    // Recreate the fixture directory instead of overwriting Git's .git file,
    // which can be protected by Windows filesystem semantics.
    await rm(path.join(tempDir, ".worktrees", "a"), {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
    await mkdir(path.join(tempDir, ".worktrees", "a"), { recursive: true });
    await writeFile(
      path.join(tempDir, ".worktrees", "a", ".git"),
      "gitdir: ../../.git/worktrees/b\n",
      "utf-8",
    );

    const result = await diagnoseManagedWorktrees(tempDir);

    expect(result.status).toBe("warn");
    expect(result.findings).toContain(
      ".worktrees/a/.git points to different registered worktree metadata.",
    );
  });

  it("reports registered managed worktrees whose directory is missing", async () => {
    await initRepo(tempDir);
    await runGit(
      ["worktree", "add", "-b", "missing", ".worktrees/missing", "HEAD"],
      { cwd: tempDir },
    );
    await rm(path.join(tempDir, ".worktrees", "missing"), {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });

    const result = await diagnoseManagedWorktrees(tempDir);

    expect(result.status).toBe("warn");
    expect(result.findings).toContain(
      ".worktrees/missing is registered in git worktree metadata but the directory is missing.",
    );
  });

  it("reports stale registered managed worktrees when the root is absent", async () => {
    await initRepo(tempDir);
    await runGit(
      ["worktree", "add", "-b", "feature", ".worktrees/feature", "HEAD"],
      { cwd: tempDir },
    );
    await rm(path.join(tempDir, ".worktrees"), {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });

    const result = await diagnoseManagedWorktrees(tempDir);

    expect(result.status).toBe("warn");
    expect(result.findings).toContain(
      ".worktrees/feature is registered in git worktree metadata but the directory is missing.",
    );
  });

  it("ignores ambient Git environment variables when inspecting the intended checkout", async () => {
    await initRepo(tempDir);
    const poisonRepo = path.join(tempDir, "poison");
    await initRepo(poisonRepo);
    const orphan = path.join(tempDir, ".worktrees", "orphan");
    await mkdir(orphan, { recursive: true });
    await writeFile(
      path.join(orphan, ".git"),
      "gitdir: ../../.git/worktrees/orphan\n",
      "utf-8",
    );

    const result = await withEnv(
      {
        GIT_DIR: path.join(poisonRepo, ".git"),
        GIT_WORK_TREE: poisonRepo,
        GIT_CEILING_DIRECTORIES: poisonRepo,
        GIT_DISCOVERY_ACROSS_FILESYSTEM: "false",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "core.bare",
        GIT_CONFIG_VALUE_0: "true",
      },
      () => diagnoseManagedWorktrees(tempDir),
    );

    expect(result.status).toBe("warn");
    expect(result.findings).toContain(
      ".worktrees/orphan is not registered in git worktree metadata.",
    );
  });

  it("reports non-directory managed worktree roots", async () => {
    await initRepo(tempDir);
    await writeFile(path.join(tempDir, ".worktrees"), "not a directory\n");

    await expect(diagnoseManagedWorktrees(tempDir)).resolves.toMatchObject({
      status: "warn",
      findings: [".worktrees exists but is not a directory."],
    });
  });

  it("warns instead of throwing when Git metadata cannot be inspected", async () => {
    await mkdir(path.join(tempDir, ".worktrees"), { recursive: true });

    await expect(diagnoseManagedWorktrees(tempDir)).resolves.toMatchObject({
      status: "warn",
      findings: [
        ".worktrees exists, but current repository Git metadata could not be read.",
      ],
    });
  });

  it("reports malformed and missing gitdir metadata", async () => {
    await initRepo(tempDir);
    const missing = path.join(tempDir, ".worktrees", "missing");
    const malformed = path.join(tempDir, ".worktrees", "malformed");
    await mkdir(missing, { recursive: true });
    await mkdir(malformed, { recursive: true });
    await writeFile(path.join(malformed, ".git"), "not a git pointer\n");

    const result = await diagnoseManagedWorktrees(tempDir);

    expect(result.status).toBe("warn");
    expect(result.findings).toContain(
      ".worktrees/missing/.git is missing or unreadable.",
    );
    expect(result.findings).toContain(
      ".worktrees/malformed/.git does not contain a gitdir pointer.",
    );
  });

  it("reports non-directory child entries and non-regular .git paths", async () => {
    await initRepo(tempDir);
    await mkdir(path.join(tempDir, ".worktrees"), { recursive: true });
    await writeFile(path.join(tempDir, ".worktrees", "not-dir"), "file\n");
    await mkdir(path.join(tempDir, ".worktrees", "bad-git", ".git"), {
      recursive: true,
    });

    const result = await diagnoseManagedWorktrees(tempDir);

    expect(result.status).toBe("warn");
    expect(result.findings).toContain(".worktrees/not-dir is not a directory.");
    expect(result.findings).toContain(
      ".worktrees/bad-git/.git is not a regular file.",
    );
  });

  it("reports relative gitdir pointers that escape the metadata namespace", async () => {
    await initRepo(tempDir);
    const entry = path.join(tempDir, ".worktrees", "escape");
    await mkdir(entry, { recursive: true });
    await writeFile(path.join(entry, ".git"), "gitdir: ../../outside\n");

    const result = await diagnoseManagedWorktrees(tempDir);

    expect(result.status).toBe("warn");
    expect(result.findings).toContain(
      ".worktrees/escape/.git points outside this repository's .git/worktrees metadata.",
    );
  });

  it("reports symlinked managed worktree roots and entries without following them", async () => {
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
    const linkedRoot = path.join(tempDir, "linked-root");
    await mkdir(path.join(linkedRoot, "symlinked"), { recursive: true });
    const targetOnlyDrift = path.join(linkedRoot, "target-only");
    await mkdir(targetOnlyDrift, { recursive: true });
    await writeFile(
      path.join(targetOnlyDrift, ".git"),
      "gitdir: ../../.git/worktrees/target-only\n",
      "utf-8",
    );
    await symlink(linkedRoot, path.join(tempDir, ".worktrees"), "dir");

    const result = await diagnoseManagedWorktrees(tempDir);

    expect(result.status).toBe("warn");
    expect(result.findings).toEqual([
      ".worktrees is a symlink; inspect it manually before cleanup.",
    ]);
  });

  it("reports symlinked child entries and .git paths without following them", async () => {
    if (!(await canCreateSymlinks())) {
      return;
    }
    await initRepo(tempDir);
    const target = path.join(tempDir, "target");
    const entry = path.join(tempDir, ".worktrees", "entry");
    const dotGitTarget = path.join(tempDir, "dotgit-target");
    const dotGitEntry = path.join(tempDir, ".worktrees", "dotgit");
    await mkdir(target);
    await mkdir(dotGitTarget);
    await mkdir(path.join(tempDir, ".worktrees"), { recursive: true });
    await symlink(target, entry, "dir");
    await mkdir(dotGitEntry);
    await symlink(dotGitTarget, path.join(dotGitEntry, ".git"), "dir");

    const result = await diagnoseManagedWorktrees(tempDir);

    expect(result.status).toBe("warn");
    expect(result.findings).toContain(
      ".worktrees/entry is a symlink; inspect it manually before cleanup.",
    );
    expect(result.findings).toContain(
      ".worktrees/dotgit/.git is a symlink; not following it.",
    );
  });
});

async function initRepo(repoDir: string): Promise<void> {
  await mkdir(repoDir, { recursive: true });
  await runGit(["init", "--initial-branch=main"], { cwd: repoDir });
  await runGit(["config", "user.name", "Test User"], { cwd: repoDir });
  await runGit(["config", "user.email", "test@example.com"], { cwd: repoDir });
  await writeFile(path.join(repoDir, "README.md"), "test\n");
  await runGit(["add", "README.md"], { cwd: repoDir });
  await runGit(["commit", "-m", "test: initial"], { cwd: repoDir });
}

async function withEnv<T>(
  values: Record<string, string>,
  callback: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    return await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    }
  }
}
