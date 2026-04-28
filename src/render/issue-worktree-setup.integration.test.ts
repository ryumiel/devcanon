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
  scriptPath: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<Record<string, string>> {
  const stdout = await runCommand("bash", [scriptPath], cwd, env);
  return parseKeyValueOutput(stdout);
}

async function resolveHelperScript(): Promise<string> {
  const repoRoot = process.cwd();
  return realpath(
    path.join(
      repoRoot,
      "skills",
      "issue-worktree-setup",
      "scripts",
      "setup-worktree.sh",
    ),
  );
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
): Promise<string> {
  await runGit(["checkout", "-b", branchName, "origin/main"], publisherDir);
  await writeFile(path.join(publisherDir, fileName), contents, "utf-8");
  await runGit(["add", fileName], publisherDir);
  await runGit(["commit", "-m", `chore: add ${branchName}`], publisherDir);
  await runGit(["push", "-u", "origin", branchName], publisherDir);
  return runGit(["rev-parse", "HEAD"], publisherDir);
}

describe("issue-worktree-setup helper", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    tempDirs.length = 0;
  });

  it("creates a new worktree from a repo subdirectory and honors BASE_REF", async () => {
    const rootDir = path.join(os.tmpdir(), `am-worktree-space-${Date.now()}`);
    await mkdir(rootDir, { recursive: true });
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    const helperScript = await resolveHelperScript();
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
    expect(result.WORKTREE_PATH).toBe(expectedPath);
    expect(await pathExists(expectedPath)).toBe(true);
    expect(await runGit(["branch", "--show-current"], expectedPath)).toBe(
      "feat/test-worktree-helper",
    );
    expect(await runGit(["rev-parse", "HEAD"], expectedPath)).toBe(baseSha);
  });

  it("reuses a clean managed main worktree and fast-forwards to BASE_REF", async () => {
    const rootDir = path.join(os.tmpdir(), `am-worktree-reuse-${Date.now()}`);
    await mkdir(rootDir, { recursive: true });
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    const helperScript = await resolveHelperScript();
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

    expect(result.WORKTREE_PATH).toBe(managedRealPath);
    expect(await runGit(["branch", "--show-current"], managedRealPath)).toBe(
      "feat/reused-worktree",
    );
    expect(await runGit(["rev-parse", "HEAD"], managedRealPath)).toBe(baseSha);
  });

  it("refuses to create a nested worktree from a managed feature worktree", async () => {
    const rootDir = path.join(os.tmpdir(), `am-worktree-stop-${Date.now()}`);
    await mkdir(rootDir, { recursive: true });
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    const helperScript = await resolveHelperScript();

    const managedPath = path.join(primaryDir, ".worktrees", "feature-branch");
    await runGit(
      ["worktree", "add", "-b", "feat/existing", managedPath, "origin/main"],
      primaryDir,
    );

    const result = await runSetup(helperScript, managedPath, {
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

  it("rejects unsafe worktree leaf values", async () => {
    const rootDir = path.join(os.tmpdir(), `am-worktree-unsafe-${Date.now()}`);
    await mkdir(rootDir, { recursive: true });
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    const helperScript = await resolveHelperScript();

    await expect(
      runCommand("bash", [helperScript], primaryDir, {
        BRANCH_NAME: "feat/unsafe-leaf",
        WORKTREE_LEAF: "../escape",
      }),
    ).rejects.toThrow(/Unsafe WORKTREE_LEAF/u);
    expect(await pathExists(path.join(primaryDir, "escape"))).toBe(false);
  });
});
