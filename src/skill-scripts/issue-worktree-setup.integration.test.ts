import { execFile } from "node:child_process";
import { access, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  canCreateSymlinks,
  cleanupTempDir,
  createTempDir,
} from "../__test-helpers__/fixtures.js";

const execFileAsync = promisify(execFile);
const helperScript = path.join(
  process.cwd(),
  "skills",
  "issue-worktree-setup",
  "scripts",
  "setup-worktree.sh",
);
const nodeHelperScript = path.join(
  process.cwd(),
  "skills",
  "issue-worktree-setup",
  "scripts",
  "setup-worktree.mjs",
);

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
  });

  return stdout.trim();
}

async function runGit(args: string[], cwd: string): Promise<string> {
  return runCommand("git", args, cwd);
}

async function runBashPwdP(cwd: string): Promise<string> {
  return runCommand("bash", ["-lc", "pwd -P"], cwd);
}

function normalizeFsPath(value: string): string {
  return path.normalize(value).replaceAll("\\", "/");
}

async function createOriginRepo(
  rootDir: string,
  defaultBranch = "main",
): Promise<{
  primaryDir: string;
}> {
  const originDir = path.join(rootDir, "origin.git");
  const primaryDir = path.join(rootDir, "Primary Repo With Spaces");

  await mkdir(rootDir, { recursive: true });
  await runGit(
    ["init", "--bare", `--initial-branch=${defaultBranch}`, originDir],
    rootDir,
  );
  await runGit(["clone", originDir, primaryDir], rootDir);
  await runGit(["config", "user.name", "Test User"], primaryDir);
  await runGit(["config", "user.email", "test@example.com"], primaryDir);
  await writeFile(path.join(primaryDir, "README.md"), "# temp repo\n", "utf-8");
  await writeFile(
    path.join(primaryDir, ".gitignore"),
    "/.worktrees/\n",
    "utf-8",
  );
  await runGit(["add", "README.md", ".gitignore"], primaryDir);
  await runGit(["commit", "-m", "chore: initial commit"], primaryDir);
  await runGit(["branch", "-M", defaultBranch], primaryDir);
  await runGit(["push", "-u", "origin", defaultBranch], primaryDir);
  await runGit(["remote", "set-head", "origin", "--auto"], primaryDir);

  return { primaryDir };
}

function parseKeyValueOutput(stdout: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of stdout.trim().split(/\r?\n/u)) {
    if (!line) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    result[key] = value;
  }

  return result;
}

async function runSetup(
  scriptPath: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<Record<string, string>> {
  const stdout = await runCommand("bash", [scriptPath], cwd, env);
  return parseKeyValueOutput(stdout);
}

async function runNodeSetup(
  scriptPath: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<Record<string, string>> {
  const stdout = await runCommand(process.execPath, [scriptPath], cwd, env);
  return parseKeyValueOutput(stdout);
}

async function createPublisherClone(rootDir: string): Promise<string> {
  const publisherDir = path.join(rootDir, "publisher");
  await runGit(
    ["clone", path.join(rootDir, "origin.git"), publisherDir],
    rootDir,
  );
  await runGit(["config", "user.name", "Publisher"], publisherDir);
  await runGit(["config", "user.email", "publisher@example.com"], publisherDir);
  return publisherDir;
}

async function createRemoteBaseRef(
  publisherDir: string,
  branchName: string,
  fileName: string,
  contents: string,
  baseBranch = "main",
): Promise<string> {
  await runGit(
    ["checkout", "-b", branchName, `origin/${baseBranch}`],
    publisherDir,
  );
  await writeFile(path.join(publisherDir, fileName), contents, "utf-8");
  await runGit(["add", fileName], publisherDir);
  await runGit(["commit", "-m", `chore: add ${branchName}`], publisherDir);
  await runGit(["push", "-u", "origin", branchName], publisherDir);
  return runGit(["rev-parse", "HEAD"], publisherDir);
}

async function createTrackedTempDir(tempDirs: string[]): Promise<string> {
  const rootDir = await createTempDir();
  tempDirs.push(rootDir);
  return rootDir;
}

const issueWorktreeSetupTimeoutMs =
  process.platform === "win32" ? 30_000 : 5_000;
const symlinkAvailable = await canCreateSymlinks();

describe(
  "issue-worktree-setup helper",
  { timeout: issueWorktreeSetupTimeoutMs },
  () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
      await Promise.all(tempDirs.map((dir) => cleanupTempDir(dir)));
      tempDirs.length = 0;
    });

    it("creates a new worktree from a repo subdirectory and honors BASE_REF", async () => {
      const rootDir = await createTrackedTempDir(tempDirs);
      const { primaryDir } = await createOriginRepo(rootDir);
      const publisherDir = await createPublisherClone(rootDir);
      const baseSha = await createRemoteBaseRef(
        publisherDir,
        "review-base",
        "review-base.txt",
        "review base\n",
      );
      const nestedDir = path.join(primaryDir, "nested", "deeper");
      await mkdir(nestedDir, { recursive: true });

      const result = await runSetup(helperScript, nestedDir, {
        BRANCH_NAME: "feat/test-worktree-helper",
        WORKTREE_LEAF: "63-worktree helper",
        BASE_REF: "origin/review-base",
      });

      const expectedPath = await realpath(
        path.join(primaryDir, ".worktrees", "63-worktree helper"),
      );

      expect(result.MODE).toBe("new");
      expect(normalizeFsPath(result.WORKTREE_PATH)).toBe(
        normalizeFsPath(expectedPath),
      );
      expect(await pathExists(expectedPath)).toBe(true);
      expect(await runGit(["branch", "--show-current"], expectedPath)).toBe(
        "feat/test-worktree-helper",
      );
      expect(await runGit(["rev-parse", "HEAD"], expectedPath)).toBe(baseSha);
    });

    it("creates a new worktree through the native Node helper", async () => {
      const rootDir = await createTrackedTempDir(tempDirs);
      const { primaryDir } = await createOriginRepo(rootDir);

      const result = await runNodeSetup(nodeHelperScript, primaryDir, {
        BRANCH_NAME: "feat/node-worktree-helper",
        WORKTREE_LEAF: "node-worktree-helper",
      });

      const expectedPath = await realpath(
        path.join(primaryDir, ".worktrees", "node-worktree-helper"),
      );

      expect(result.MODE).toBe("new");
      expect(normalizeFsPath(result.WORKTREE_PATH)).toBe(
        normalizeFsPath(expectedPath),
      );
      expect(await runGit(["branch", "--show-current"], expectedPath)).toBe(
        "feat/node-worktree-helper",
      );
    });

    it("forwards Bash adapter arguments to the typed runtime", async () => {
      const rootDir = await createTrackedTempDir(tempDirs);
      const { primaryDir } = await createOriginRepo(rootDir);

      await expect(
        runCommand("bash", [helperScript, "--help"], primaryDir, {
          BRANCH_NAME: "feat/adapter-args",
          WORKTREE_LEAF: "adapter-args",
        }),
      ).rejects.toThrow(/does not accept arguments/u);
      await expect(
        runGit(["rev-parse", "--verify", "feat/adapter-args"], primaryDir),
      ).rejects.toThrow();
    });

    it("reuses a clean managed main worktree and fast-forwards to BASE_REF", async () => {
      const rootDir = await createTrackedTempDir(tempDirs);
      const { primaryDir } = await createOriginRepo(rootDir);
      const publisherDir = await createPublisherClone(rootDir);

      await runGit(["checkout", "-b", "chore/holder"], primaryDir);
      const managedPath = path.join(primaryDir, ".worktrees", "reusable");
      await runGit(["worktree", "add", managedPath, "main"], primaryDir);
      const baseSha = await createRemoteBaseRef(
        publisherDir,
        "review-reuse-base",
        "review-reuse-base.txt",
        "reuse review base\n",
      );

      const result = await runSetup(helperScript, managedPath, {
        BRANCH_NAME: "feat/reused-worktree",
        WORKTREE_LEAF: "ignored-for-reuse",
        BASE_REF: "origin/review-reuse-base",
      });

      expect(result.MODE).toBe("reuse");
      const managedRealPath = await realpath(managedPath);

      expect(normalizeFsPath(result.WORKTREE_PATH)).toBe(
        normalizeFsPath(managedRealPath),
      );
      expect(await runGit(["branch", "--show-current"], managedRealPath)).toBe(
        "feat/reused-worktree",
      );
      expect(await runGit(["rev-parse", "HEAD"], managedRealPath)).toBe(
        baseSha,
      );
    });

    it("stops when a managed main worktree is ahead of BASE_REF", async () => {
      const rootDir = await createTrackedTempDir(tempDirs);
      const { primaryDir } = await createOriginRepo(rootDir);

      await runGit(["checkout", "-b", "chore/holder"], primaryDir);
      const managedPath = path.join(primaryDir, ".worktrees", "ahead");
      await runGit(["worktree", "add", managedPath, "main"], primaryDir);
      await writeFile(
        path.join(managedPath, "local-only.txt"),
        "local only\n",
        "utf-8",
      );
      await runGit(["add", "local-only.txt"], managedPath);
      await runGit(["commit", "-m", "chore: local only commit"], managedPath);

      const result = await runSetup(helperScript, managedPath, {
        BRANCH_NAME: "feat/should-not-branch",
        WORKTREE_LEAF: "ignored-for-reuse",
      });

      expect(result.MODE).toBe("stop");
      expect(result.MESSAGE).toMatch(/commits not in BASE_REF/i);
      expect(await runGit(["branch", "--show-current"], managedPath)).toBe(
        "main",
      );
      await expect(
        runGit(
          ["rev-parse", "--verify", "feat/should-not-branch"],
          managedPath,
        ),
      ).rejects.toThrow();
    });

    it("reuses a clean managed feature-branch worktree at BASE_REF", async () => {
      const rootDir = await createTrackedTempDir(tempDirs);
      const { primaryDir } = await createOriginRepo(rootDir);

      const managedPath = path.join(primaryDir, ".worktrees", "feature-branch");
      await runGit(
        ["worktree", "add", "-b", "claude/scratch", managedPath, "origin/main"],
        primaryDir,
      );
      const baseSha = await runGit(["rev-parse", "origin/main"], primaryDir);

      const result = await runSetup(helperScript, managedPath, {
        BRANCH_NAME: "feat/reused-from-feature-branch",
        WORKTREE_LEAF: "ignored-for-reuse",
      });

      expect(result.MODE).toBe("reuse");
      const managedRealPath = await realpath(managedPath);

      expect(normalizeFsPath(result.WORKTREE_PATH)).toBe(
        normalizeFsPath(managedRealPath),
      );
      expect(await runGit(["branch", "--show-current"], managedRealPath)).toBe(
        "feat/reused-from-feature-branch",
      );
      expect(await runGit(["rev-parse", "HEAD"], managedRealPath)).toBe(
        baseSha,
      );
      // Previous branch ref is preserved (just no longer checked out).
      expect(
        await runGit(
          ["rev-parse", "--verify", "claude/scratch"],
          managedRealPath,
        ),
      ).toBe(baseSha);
    });

    it("reuses a clean managed feature-branch worktree when HEAD is strictly behind BASE_REF", async () => {
      const rootDir = await createTrackedTempDir(tempDirs);
      const { primaryDir } = await createOriginRepo(rootDir);
      const publisherDir = await createPublisherClone(rootDir);

      const managedPath = path.join(primaryDir, ".worktrees", "feature-ff");
      await runGit(
        ["worktree", "add", "-b", "claude/scratch", managedPath, "origin/main"],
        primaryDir,
      );
      const scratchOrigSha = await runGit(["rev-parse", "HEAD"], managedPath);
      const baseSha = await createRemoteBaseRef(
        publisherDir,
        "review-feature-ff-base",
        "review-feature-ff-base.txt",
        "feature ff base\n",
      );
      expect(baseSha).not.toBe(scratchOrigSha);

      const result = await runSetup(helperScript, managedPath, {
        BRANCH_NAME: "feat/reused-feature-ff",
        WORKTREE_LEAF: "ignored-for-reuse",
        BASE_REF: "origin/review-feature-ff-base",
      });

      expect(result.MODE).toBe("reuse");
      const managedRealPath = await realpath(managedPath);

      expect(normalizeFsPath(result.WORKTREE_PATH)).toBe(
        normalizeFsPath(managedRealPath),
      );
      expect(await runGit(["branch", "--show-current"], managedRealPath)).toBe(
        "feat/reused-feature-ff",
      );
      expect(await runGit(["rev-parse", "HEAD"], managedRealPath)).toBe(
        baseSha,
      );
      // The previously checked-out branch ref is left at its original commit;
      // the helper creates the new branch directly at BASE_REF without
      // mutating the prior ref.
      expect(
        await runGit(
          ["rev-parse", "--verify", "claude/scratch"],
          managedRealPath,
        ),
      ).toBe(scratchOrigSha);
    });

    it("refuses on a D/F namespace collision without mutating the prior branch", async () => {
      const rootDir = await createTrackedTempDir(tempDirs);
      const { primaryDir } = await createOriginRepo(rootDir);
      const publisherDir = await createPublisherClone(rootDir);

      const managedPath = path.join(primaryDir, ".worktrees", "df-collide");
      await runGit(
        ["worktree", "add", "-b", "claude/scratch", managedPath, "origin/main"],
        primaryDir,
      );
      const scratchOrigSha = await runGit(["rev-parse", "HEAD"], managedPath);
      // Pre-existing branch occupies the `feat/` namespace; passing
      // BRANCH_NAME=feat would collide via D/F conflict, not exact match.
      await runGit(["branch", "feat/foo"], primaryDir);
      await createRemoteBaseRef(
        publisherDir,
        "review-df-collide-base",
        "review-df-collide-base.txt",
        "df collide base\n",
      );

      await expect(
        runCommand("bash", [helperScript], managedPath, {
          BRANCH_NAME: "feat",
          WORKTREE_LEAF: "ignored-for-collide",
          BASE_REF: "origin/review-df-collide-base",
        }),
      ).rejects.toThrow();

      // The scratch branch ref must be unchanged — `git checkout -b`'s
      // atomic namespace check refused before any ref mutation.
      expect(
        await runGit(["rev-parse", "--verify", "claude/scratch"], managedPath),
      ).toBe(scratchOrigSha);
    });

    it("refuses up-front when BRANCH_NAME already exists, leaving the worktree untouched", async () => {
      const rootDir = await createTrackedTempDir(tempDirs);
      const { primaryDir } = await createOriginRepo(rootDir);
      const publisherDir = await createPublisherClone(rootDir);

      const managedPath = path.join(primaryDir, ".worktrees", "collide");
      await runGit(
        ["worktree", "add", "-b", "claude/scratch", managedPath, "origin/main"],
        primaryDir,
      );
      const scratchOrigSha = await runGit(["rev-parse", "HEAD"], managedPath);
      await runGit(["branch", "feat/already-exists"], primaryDir);
      // Advance origin so the helper would otherwise need to fast-forward.
      await createRemoteBaseRef(
        publisherDir,
        "review-collide-base",
        "review-collide-base.txt",
        "collide base\n",
      );

      await expect(
        runCommand("bash", [helperScript], managedPath, {
          BRANCH_NAME: "feat/already-exists",
          WORKTREE_LEAF: "ignored-for-collide",
          BASE_REF: "origin/review-collide-base",
        }),
      ).rejects.toThrow(/already exists/i);

      // The scratch branch ref must be unchanged — the destructive merge
      // never ran because the pre-check refused up-front.
      expect(
        await runGit(["rev-parse", "--verify", "claude/scratch"], managedPath),
      ).toBe(scratchOrigSha);
    });

    it("stops when a managed feature-branch worktree is ahead of BASE_REF", async () => {
      const rootDir = await createTrackedTempDir(tempDirs);
      const { primaryDir } = await createOriginRepo(rootDir);

      const managedPath = path.join(primaryDir, ".worktrees", "feature-ahead");
      await runGit(
        ["worktree", "add", "-b", "feat/existing", managedPath, "origin/main"],
        primaryDir,
      );
      await writeFile(
        path.join(managedPath, "feature-work.txt"),
        "in-progress\n",
        "utf-8",
      );
      await runGit(["add", "feature-work.txt"], managedPath);
      await runGit(["commit", "-m", "feat: in-progress work"], managedPath);

      const result = await runSetup(helperScript, managedPath, {
        BRANCH_NAME: "feat/should-not-branch",
        WORKTREE_LEAF: "ignored-for-stop",
      });

      expect(result.MODE).toBe("stop");
      expect(result.MESSAGE).toMatch(/commits not in BASE_REF/i);
      expect(await runGit(["branch", "--show-current"], managedPath)).toBe(
        "feat/existing",
      );
      await expect(
        runGit(
          ["rev-parse", "--verify", "feat/should-not-branch"],
          managedPath,
        ),
      ).rejects.toThrow();
    });

    it("stops when a managed feature-branch worktree has diverged from BASE_REF", async () => {
      const rootDir = await createTrackedTempDir(tempDirs);
      const { primaryDir } = await createOriginRepo(rootDir);
      const publisherDir = await createPublisherClone(rootDir);

      const managedPath = path.join(
        primaryDir,
        ".worktrees",
        "feature-diverged",
      );
      await runGit(
        ["worktree", "add", "-b", "feat/existing", managedPath, "origin/main"],
        primaryDir,
      );
      // Commit on the feature branch — HEAD advances past the fork point.
      await writeFile(
        path.join(managedPath, "feature-work.txt"),
        "feature side\n",
        "utf-8",
      );
      await runGit(["add", "feature-work.txt"], managedPath);
      await runGit(["commit", "-m", "feat: feature side"], managedPath);
      // Advance origin past the fork point too — now neither is an ancestor.
      await createRemoteBaseRef(
        publisherDir,
        "review-diverged-base",
        "review-diverged-base.txt",
        "diverged base\n",
      );

      const result = await runSetup(helperScript, managedPath, {
        BRANCH_NAME: "feat/should-not-branch",
        WORKTREE_LEAF: "ignored-for-stop",
        BASE_REF: "origin/review-diverged-base",
      });

      expect(result.MODE).toBe("stop");
      // The "commits not in BASE_REF" wording must cover this divergence
      // shape — earlier "ahead of" wording was misleading here.
      expect(result.MESSAGE).toMatch(/commits not in BASE_REF/i);
      expect(await runGit(["branch", "--show-current"], managedPath)).toBe(
        "feat/existing",
      );
      await expect(
        runGit(
          ["rev-parse", "--verify", "feat/should-not-branch"],
          managedPath,
        ),
      ).rejects.toThrow();
    });

    it("stops when a managed worktree has untracked files", async () => {
      const rootDir = await createTrackedTempDir(tempDirs);
      const { primaryDir } = await createOriginRepo(rootDir);

      const managedPath = path.join(
        primaryDir,
        ".worktrees",
        "dirty-untracked",
      );
      await runGit(
        ["worktree", "add", "-b", "claude/scratch", managedPath, "origin/main"],
        primaryDir,
      );
      await writeFile(
        path.join(managedPath, "uncommitted.txt"),
        "dirty\n",
        "utf-8",
      );

      const result = await runSetup(helperScript, managedPath, {
        BRANCH_NAME: "feat/should-not-branch",
        WORKTREE_LEAF: "ignored-for-stop",
      });

      expect(result.MODE).toBe("stop");
      expect(result.MESSAGE).toMatch(/uncommitted changes/i);
      await expect(
        runGit(
          ["rev-parse", "--verify", "feat/should-not-branch"],
          managedPath,
        ),
      ).rejects.toThrow();
    });

    it("stops when a managed worktree has modified tracked files", async () => {
      const rootDir = await createTrackedTempDir(tempDirs);
      const { primaryDir } = await createOriginRepo(rootDir);

      const managedPath = path.join(primaryDir, ".worktrees", "dirty-modified");
      await runGit(
        ["worktree", "add", "-b", "claude/scratch", managedPath, "origin/main"],
        primaryDir,
      );
      // Modify the tracked README.md created by createOriginRepo, producing
      // a ` M` entry in `git status --short` rather than an `??` entry.
      await writeFile(
        path.join(managedPath, "README.md"),
        "# modified\n",
        "utf-8",
      );

      const result = await runSetup(helperScript, managedPath, {
        BRANCH_NAME: "feat/should-not-branch",
        WORKTREE_LEAF: "ignored-for-stop",
      });

      expect(result.MODE).toBe("stop");
      expect(result.MESSAGE).toMatch(/uncommitted changes/i);
      await expect(
        runGit(
          ["rev-parse", "--verify", "feat/should-not-branch"],
          managedPath,
        ),
      ).rejects.toThrow();
    });

    it("reuses a clean managed worktree with a detached HEAD at BASE_REF", async () => {
      const rootDir = await createTrackedTempDir(tempDirs);
      const { primaryDir } = await createOriginRepo(rootDir);

      const managedPath = path.join(primaryDir, ".worktrees", "detached");
      // `worktree add --detach` creates a worktree without a branch ref:
      // `git branch --show-current` returns empty, but HEAD is a valid commit.
      await runGit(
        ["worktree", "add", "--detach", managedPath, "origin/main"],
        primaryDir,
      );
      expect(await runGit(["branch", "--show-current"], managedPath)).toBe("");
      const baseSha = await runGit(["rev-parse", "origin/main"], primaryDir);

      const result = await runSetup(helperScript, managedPath, {
        BRANCH_NAME: "feat/from-detached",
        WORKTREE_LEAF: "ignored-for-reuse",
      });

      expect(result.MODE).toBe("reuse");
      const managedRealPath = await realpath(managedPath);

      expect(normalizeFsPath(result.WORKTREE_PATH)).toBe(
        normalizeFsPath(managedRealPath),
      );
      expect(await runGit(["branch", "--show-current"], managedRealPath)).toBe(
        "feat/from-detached",
      );
      expect(await runGit(["rev-parse", "HEAD"], managedRealPath)).toBe(
        baseSha,
      );
    });

    it("rejects unsafe worktree leaf values", async () => {
      const rootDir = await createTrackedTempDir(tempDirs);
      const { primaryDir } = await createOriginRepo(rootDir);

      await expect(
        runCommand("bash", [helperScript], primaryDir, {
          BRANCH_NAME: "feat/unsafe-leaf",
          WORKTREE_LEAF: "../escape",
        }),
      ).rejects.toThrow(/Unsafe WORKTREE_LEAF/u);
      await expect(
        runCommand("bash", [helperScript], primaryDir, {
          BRANCH_NAME: "feat/unsafe-leaf",
          WORKTREE_LEAF: "leaf\nMODE=stop",
        }),
      ).rejects.toThrow(/Unsafe WORKTREE_LEAF/u);
      expect(await pathExists(path.join(primaryDir, "escape"))).toBe(false);
    });

    it("rejects unsafe BASE_REF values", async () => {
      const rootDir = await createTrackedTempDir(tempDirs);
      const { primaryDir } = await createOriginRepo(rootDir);

      await expect(
        runCommand("bash", [helperScript], primaryDir, {
          BRANCH_NAME: "feat/bad-base-ref",
          WORKTREE_LEAF: "bad-base-ref",
          BASE_REF: "--help",
        }),
      ).rejects.toThrow(/Unsafe BASE_REF/u);
    });

    it("rejects invalid branch names", async () => {
      const rootDir = await createTrackedTempDir(tempDirs);
      const { primaryDir } = await createOriginRepo(rootDir);

      await expect(
        runCommand("bash", [helperScript], primaryDir, {
          BRANCH_NAME: "--not-a-branch",
          WORKTREE_LEAF: "bad-branch",
        }),
      ).rejects.toThrow(/Unsafe BRANCH_NAME/u);
      await expect(
        runCommand("bash", [helperScript], primaryDir, {
          BRANCH_NAME: "bad branch name",
          WORKTREE_LEAF: "bad-branch",
        }),
      ).rejects.toThrow(/Invalid BRANCH_NAME/u);
    });

    it.skipIf(!symlinkAvailable)(
      "rejects a symlinked managed worktree root outside the primary checkout",
      async () => {
        const rootDir = await createTrackedTempDir(tempDirs);
        const { primaryDir } = await createOriginRepo(rootDir);
        const escapedRoot = path.join(rootDir, "escaped-worktrees");

        await mkdir(escapedRoot, { recursive: true });
        await symlink(escapedRoot, path.join(primaryDir, ".worktrees"));

        await expect(
          runCommand("bash", [helperScript], primaryDir, {
            BRANCH_NAME: "feat/symlink-escape",
            WORKTREE_LEAF: "symlink-escape",
          }),
        ).rejects.toThrow(/\.worktrees/u);
        expect(await pathExists(path.join(escapedRoot, "symlink-escape"))).toBe(
          false,
        );
      },
    );

    it("stops when run from inside a submodule checkout", async () => {
      const rootDir = await createTrackedTempDir(tempDirs);
      await createOriginRepo(rootDir);
      const parentDir = path.join(rootDir, "parent");

      await runGit(["init", "--initial-branch=main", parentDir], rootDir);
      await runGit(["config", "user.name", "Test User"], parentDir);
      await runGit(["config", "user.email", "test@example.com"], parentDir);
      await runCommand(
        "git",
        [
          "-c",
          "protocol.file.allow=always",
          "submodule",
          "add",
          path.join(rootDir, "origin.git"),
          "nested",
        ],
        parentDir,
      );

      const submodulePath = path.join(parentDir, "nested");
      const expectedSubmodulePath = await runBashPwdP(submodulePath);
      const expectedParentPath = await runBashPwdP(parentDir);
      const result = await runSetup(helperScript, submodulePath, {
        BRANCH_NAME: "feat/from-submodule",
        WORKTREE_LEAF: "from-submodule",
      });

      expect(result.MODE).toBe("stop");
      expect(normalizeFsPath(result.WORKTREE_PATH)).toBe(
        normalizeFsPath(await realpath(submodulePath)),
      );
      expect(result.MESSAGE).toMatch(/submodule/i);
      expect(normalizeFsPath(result.MESSAGE)).toContain(
        normalizeFsPath(expectedSubmodulePath),
      );
      expect(normalizeFsPath(result.MESSAGE)).toContain(
        normalizeFsPath(expectedParentPath),
      );
    });

    it("fails when .worktrees is not ignored in the host repo", async () => {
      const rootDir = await createTrackedTempDir(tempDirs);
      const { primaryDir } = await createOriginRepo(rootDir);

      await writeFile(path.join(primaryDir, ".gitignore"), "", "utf-8");
      await runGit(["add", ".gitignore"], primaryDir);
      await runGit(["commit", "-m", "chore: drop worktree ignore"], primaryDir);

      await expect(
        runCommand("bash", [helperScript], primaryDir, {
          BRANCH_NAME: "feat/missing-ignore",
          WORKTREE_LEAF: "missing-ignore",
        }),
      ).rejects.toThrow(/\.gitignore|\.worktrees\//u);
      expect(
        await pathExists(path.join(primaryDir, ".worktrees", "missing-ignore")),
      ).toBe(false);
    });

    it("derives BASE_REF default from origin/HEAD when unset on a non-main repo", async () => {
      const rootDir = await createTrackedTempDir(tempDirs);
      const { primaryDir } = await createOriginRepo(rootDir, "develop");
      const developSha = await runGit(["rev-parse", "HEAD"], primaryDir);

      // BASE_REF intentionally unset to exercise the origin/HEAD derivation path.
      const result = await runSetup(helperScript, primaryDir, {
        BRANCH_NAME: "feat/derive-base",
        WORKTREE_LEAF: "derive-base",
      });

      const expectedPath = await realpath(
        path.join(primaryDir, ".worktrees", "derive-base"),
      );

      expect(result.MODE).toBe("new");
      expect(normalizeFsPath(result.WORKTREE_PATH)).toBe(
        normalizeFsPath(expectedPath),
      );
      expect(await runGit(["branch", "--show-current"], expectedPath)).toBe(
        "feat/derive-base",
      );
      expect(await runGit(["rev-parse", "HEAD"], expectedPath)).toBe(
        developSha,
      );
    });

    it("reuses a clean managed default-branch worktree on a non-main repo", async () => {
      const rootDir = await createTrackedTempDir(tempDirs);
      const { primaryDir } = await createOriginRepo(rootDir, "develop");
      const publisherDir = await createPublisherClone(rootDir);

      await runGit(["checkout", "-b", "chore/holder"], primaryDir);
      const managedPath = path.join(
        primaryDir,
        ".worktrees",
        "reusable-develop",
      );
      await runGit(["worktree", "add", managedPath, "develop"], primaryDir);
      const baseSha = await createRemoteBaseRef(
        publisherDir,
        "review-reuse-develop",
        "review-reuse-develop.txt",
        "reuse develop base\n",
        "develop",
      );

      const result = await runSetup(helperScript, managedPath, {
        BRANCH_NAME: "feat/reused-develop-worktree",
        WORKTREE_LEAF: "ignored-for-reuse",
        BASE_REF: "origin/review-reuse-develop",
      });

      expect(result.MODE).toBe("reuse");
      const managedRealPath = await realpath(managedPath);

      expect(normalizeFsPath(result.WORKTREE_PATH)).toBe(
        normalizeFsPath(managedRealPath),
      );
      expect(await runGit(["branch", "--show-current"], managedRealPath)).toBe(
        "feat/reused-develop-worktree",
      );
      expect(await runGit(["rev-parse", "HEAD"], managedRealPath)).toBe(
        baseSha,
      );
    });

    it("falls back to origin/main when origin/HEAD is unset", async () => {
      const rootDir = await createTrackedTempDir(tempDirs);
      const { primaryDir } = await createOriginRepo(rootDir);
      await runGit(
        ["update-ref", "-d", "refs/remotes/origin/HEAD"],
        primaryDir,
      );
      const mainSha = await runGit(["rev-parse", "HEAD"], primaryDir);

      // BASE_REF intentionally unset; origin/HEAD removed to force fallback.
      const result = await runSetup(helperScript, primaryDir, {
        BRANCH_NAME: "feat/fallback-main",
        WORKTREE_LEAF: "fallback-main",
      });

      const expectedPath = await realpath(
        path.join(primaryDir, ".worktrees", "fallback-main"),
      );

      expect(result.MODE).toBe("new");
      expect(normalizeFsPath(result.WORKTREE_PATH)).toBe(
        normalizeFsPath(expectedPath),
      );
      expect(await runGit(["rev-parse", "HEAD"], expectedPath)).toBe(mainSha);
    });

    it("falls back to origin/master when origin/HEAD is unset and only master exists", async () => {
      const rootDir = await createTrackedTempDir(tempDirs);
      const { primaryDir } = await createOriginRepo(rootDir, "master");
      await runGit(
        ["update-ref", "-d", "refs/remotes/origin/HEAD"],
        primaryDir,
      );
      const masterSha = await runGit(["rev-parse", "HEAD"], primaryDir);

      // BASE_REF intentionally unset; origin/HEAD removed to force fallback.
      const result = await runSetup(helperScript, primaryDir, {
        BRANCH_NAME: "feat/fallback-master",
        WORKTREE_LEAF: "fallback-master",
      });

      const expectedPath = await realpath(
        path.join(primaryDir, ".worktrees", "fallback-master"),
      );

      expect(result.MODE).toBe("new");
      expect(normalizeFsPath(result.WORKTREE_PATH)).toBe(
        normalizeFsPath(expectedPath),
      );
      expect(await runGit(["rev-parse", "HEAD"], expectedPath)).toBe(masterSha);
    });

    it.skipIf(!symlinkAvailable)(
      "rejects a symlinked managed worktree leaf outside the primary checkout",
      async () => {
        const rootDir = await createTrackedTempDir(tempDirs);
        const { primaryDir } = await createOriginRepo(rootDir);
        const escapedLeaf = path.join(rootDir, "escaped-leaf");
        const worktreesDir = path.join(primaryDir, ".worktrees");
        const symlinkLeaf = path.join(worktreesDir, "leaf-escape");

        await mkdir(escapedLeaf, { recursive: true });
        await mkdir(worktreesDir, { recursive: true });
        await symlink(escapedLeaf, symlinkLeaf);

        await expect(
          runCommand("bash", [helperScript], primaryDir, {
            BRANCH_NAME: "feat/leaf-escape",
            WORKTREE_LEAF: "leaf-escape",
          }),
        ).rejects.toThrow(/Target worktree path already exists/u);
        expect(await pathExists(path.join(escapedLeaf, ".git"))).toBe(false);
      },
    );
  },
);
