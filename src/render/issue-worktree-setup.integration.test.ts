import { execFile } from "node:child_process";
import { access, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

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

async function createOriginRepo(rootDir: string): Promise<{
  primaryDir: string;
}> {
  const originDir = path.join(rootDir, "origin.git");
  const primaryDir = path.join(rootDir, "Primary Repo With Spaces");

  await mkdir(rootDir, { recursive: true });
  await runGit(["init", "--bare", originDir], rootDir);
  await runGit(["clone", originDir, primaryDir], rootDir);
  await runGit(["config", "user.name", "Test User"], primaryDir);
  await runGit(["config", "user.email", "test@example.com"], primaryDir);
  await writeFile(path.join(primaryDir, "README.md"), "# temp repo\n", "utf-8");
  await runGit(["add", "README.md"], primaryDir);
  await runGit(["commit", "-m", "chore: initial commit"], primaryDir);
  await runGit(["branch", "-M", "main"], primaryDir);
  await runGit(["push", "-u", "origin", "main"], primaryDir);

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
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<Record<string, string>> {
  const repoRoot = process.cwd();
  const scriptPath = path.join(
    repoRoot,
    "skills",
    "issue-worktree-setup",
    "scripts",
    "setup-worktree.sh",
  );

  const stdout = await runCommand("bash", [scriptPath], cwd, env);
  return parseKeyValueOutput(stdout);
}

describe("issue-worktree-setup helper", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    tempDirs.length = 0;
  });

  it("creates a new worktree from the primary checkout and preserves spaces in the returned path", async () => {
    const rootDir = path.join(os.tmpdir(), `am-worktree-space-${Date.now()}`);
    await mkdir(rootDir, { recursive: true });
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);

    const result = await runSetup(primaryDir, {
      BRANCH_NAME: "feat/test-worktree-helper",
      WORKTREE_LEAF: "63-worktree helper",
    });

    const expectedPath = await realpath(
      path.join(primaryDir, ".worktrees", "63-worktree helper"),
    );

    expect(result.MODE).toBe("new");
    expect(result.WORKTREE_PATH).toBe(expectedPath);
    expect(await pathExists(expectedPath)).toBe(true);
    expect(await runGit(["branch", "--show-current"], expectedPath)).toBe(
      "feat/test-worktree-helper",
    );
  });

  it("reuses a clean managed main worktree by branching in place", async () => {
    const rootDir = path.join(os.tmpdir(), `am-worktree-reuse-${Date.now()}`);
    await mkdir(rootDir, { recursive: true });
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);

    await runGit(["checkout", "-b", "chore/holder"], primaryDir);
    const managedPath = path.join(primaryDir, ".worktrees", "reusable");
    await runGit(["worktree", "add", managedPath, "main"], primaryDir);

    const result = await runSetup(managedPath, {
      BRANCH_NAME: "feat/reused-worktree",
      WORKTREE_LEAF: "ignored-for-reuse",
    });

    expect(result.MODE).toBe("reuse");
    const managedRealPath = await realpath(managedPath);

    expect(result.WORKTREE_PATH).toBe(managedRealPath);
    expect(await runGit(["branch", "--show-current"], managedRealPath)).toBe(
      "feat/reused-worktree",
    );
  });

  it("refuses to create a nested worktree from a managed feature worktree", async () => {
    const rootDir = path.join(os.tmpdir(), `am-worktree-stop-${Date.now()}`);
    await mkdir(rootDir, { recursive: true });
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);

    const managedPath = path.join(primaryDir, ".worktrees", "feature-branch");
    await runGit(
      ["worktree", "add", "-b", "feat/existing", managedPath, "origin/main"],
      primaryDir,
    );

    const result = await runSetup(managedPath, {
      BRANCH_NAME: "feat/nested-should-not-happen",
      WORKTREE_LEAF: "nested-should-not-happen",
    });

    expect(result.MODE).toBe("stop");
    const managedRealPath = await realpath(managedPath);

    expect(result.WORKTREE_PATH).toBe(managedRealPath);
    expect(result.MESSAGE).toMatch(/primary checkout/i);
    expect(
      await pathExists(
        path.join(primaryDir, ".worktrees", "nested-should-not-happen"),
      ),
    ).toBe(false);
  });
});
