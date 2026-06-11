import { execFile } from "node:child_process";
import { access, mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../__test-helpers__/fixtures.js";

const execFileAsync = promisify(execFile);
const nodeHelperScript = path.join(
  process.cwd(),
  "skills",
  "issue-worktree-setup",
  "scripts",
  "setup-worktree.mjs",
);

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
    windowsHide: true,
  });

  return stdout.trim();
}

async function runGit(args: string[], cwd: string): Promise<string> {
  return runCommand("git", args, cwd);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function normalizeFsPath(value: string): string {
  return path.normalize(value).replaceAll("\\", "/");
}

function parseKeyValueOutput(stdout: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of stdout.trim().split(/\r?\n/u)) {
    if (!line) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    result[line.slice(0, separator)] = line.slice(separator + 1);
  }

  return result;
}

async function createOriginRepo(rootDir: string): Promise<string> {
  const originDir = path.join(rootDir, "origin.git");
  const primaryDir = path.join(rootDir, "Primary Repo With Spaces");

  await mkdir(rootDir, { recursive: true });
  await runGit(["init", "--bare", "--initial-branch=main", originDir], rootDir);
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
  await runGit(["push", "-u", "origin", "main"], primaryDir);
  await runGit(["remote", "set-head", "origin", "--auto"], primaryDir);

  return primaryDir;
}

describe("issue-worktree-setup native helper", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => cleanupTempDir(dir)));
    tempDirs.length = 0;
  });

  it("creates a managed worktree without invoking the Bash adapter", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const primaryDir = await createOriginRepo(rootDir);

    const stdout = await runCommand(
      process.execPath,
      [nodeHelperScript],
      primaryDir,
      {
        BRANCH_NAME: "feat/native-node-worktree",
        WORKTREE_LEAF: "native-node-worktree",
      },
    );
    const result = parseKeyValueOutput(stdout);
    const expectedPath = await realpath(
      path.join(primaryDir, ".worktrees", "native-node-worktree"),
    );

    expect(result.MODE).toBe("new");
    expect(normalizeFsPath(result.WORKTREE_PATH)).toBe(
      normalizeFsPath(expectedPath),
    );
    expect(await pathExists(expectedPath)).toBe(true);
    expect(await runGit(["branch", "--show-current"], expectedPath)).toBe(
      "feat/native-node-worktree",
    );
  });
});
