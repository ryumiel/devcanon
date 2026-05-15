import { execFile } from "node:child_process";
import { access, mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../__test-helpers__/fixtures.js";

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
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(command, args, {
    cwd,
    env: {
      ...process.env,
    },
  });
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await runCommand("git", args, cwd);
  return stdout.trim();
}

async function runScript(
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const scriptPath = path.join(
    process.cwd(),
    "skills",
    "git-workspace-cleanup",
    "scripts",
    "git-workspace-cleanup.sh",
  );

  try {
    const { stdout, stderr } = await runCommand(
      "bash",
      [scriptPath, ...args],
      cwd,
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: typeof execError.code === "number" ? execError.code : 1,
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
    };
  }
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

async function createOriginRepo(rootDir: string): Promise<{
  primaryDir: string;
  publisherDir: string;
}> {
  const originDir = path.join(rootDir, "origin.git");
  const primaryDir = path.join(rootDir, "Primary Repo With Spaces");
  const publisherDir = path.join(rootDir, "publisher");

  await mkdir(rootDir, { recursive: true });
  await runGit(["init", "--bare", "--initial-branch=main", originDir], rootDir);
  await runGit(["clone", originDir, primaryDir], rootDir);
  await runGit(["config", "user.name", "Test User"], primaryDir);
  await runGit(["config", "user.email", "test@example.com"], primaryDir);
  await writeFile(path.join(primaryDir, "README.md"), "# temp repo\n", "utf-8");
  await runGit(["add", "README.md"], primaryDir);
  await runGit(["commit", "-m", "chore: initial commit"], primaryDir);
  await runGit(["push", "-u", "origin", "main"], primaryDir);
  await runGit(["remote", "set-head", "origin", "--auto"], primaryDir);

  await runGit(["clone", originDir, publisherDir], rootDir);
  await runGit(["config", "user.name", "Publisher"], publisherDir);
  await runGit(["config", "user.email", "publisher@example.com"], publisherDir);

  return { primaryDir, publisherDir };
}

async function publishDefaultCommit(
  publisherDir: string,
  fileName: string,
): Promise<string> {
  await writeFile(path.join(publisherDir, fileName), `${fileName}\n`, "utf-8");
  await runGit(["add", fileName], publisherDir);
  await runGit(["commit", "-m", `chore: add ${fileName}`], publisherDir);
  await runGit(["push", "origin", "main"], publisherDir);
  return runGit(["rev-parse", "HEAD"], publisherDir);
}

describe("git-workspace-cleanup skill helper", { timeout: 10_000 }, () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => cleanupTempDir(dir)));
    tempDirs.length = 0;
  });

  it("reports dirty linked worktrees and local-only branch commits during dry-run", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    const linkedDir = path.join(rootDir, "linked feature");

    await runGit(["checkout", "-b", "feature/local-only"], primaryDir);
    await writeFile(path.join(primaryDir, "local.txt"), "local\n", "utf-8");
    await runGit(["add", "local.txt"], primaryDir);
    await runGit(["commit", "-m", "feat: local only"], primaryDir);
    await runGit(["checkout", "main"], primaryDir);
    await runGit(
      ["worktree", "add", linkedDir, "feature/local-only"],
      primaryDir,
    );
    await writeFile(path.join(linkedDir, "dirty.txt"), "dirty\n", "utf-8");

    const result = await runScript(["--dry-run"], linkedDir);
    const output = parseKeyValueOutput(result.stdout);
    const canonicalLinkedDir = await realpath(linkedDir);

    expect(result.code).toBe(0);
    expect(output.MODE).toBe("dry-run");
    expect(output.STATUS).toBe("blocked");
    expect(output.DEFAULT_BRANCH).toBe("main");
    expect(output.DIRTY_WORKTREES).toBe("1");
    expect(output.LOCAL_BRANCHES_WITH_UNIQUE_COMMITS).toBe("1");
    expect(result.stdout).toContain(`DIRTY_WORKTREE=${canonicalLinkedDir}`);
    expect(result.stdout).toContain("UNIQUE_BRANCH=feature/local-only");
  });

  it("refuses execute when a non-default branch has commits outside origin default without force", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);

    await runGit(["checkout", "-b", "feature/local-only"], primaryDir);
    await writeFile(path.join(primaryDir, "local.txt"), "local\n", "utf-8");
    await runGit(["add", "local.txt"], primaryDir);
    await runGit(["commit", "-m", "feat: local only"], primaryDir);
    await runGit(["checkout", "main"], primaryDir);

    const result = await runScript(["--execute"], primaryDir);
    const output = parseKeyValueOutput(result.stdout);

    expect(result.code).toBe(1);
    expect(output.STATUS).toBe("blocked");
    expect(output.LOCAL_BRANCHES_WITH_UNIQUE_COMMITS).toBe("1");
    expect(
      await runGit(
        ["show-ref", "--verify", "refs/heads/feature/local-only"],
        primaryDir,
      ),
    ).toContain("refs/heads/feature/local-only");
  });

  it("deletes local branches that are already reachable from origin default without force", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);

    await runGit(["branch", "feature/already-merged", "main"], primaryDir);

    const result = await runScript(["--execute"], primaryDir);
    const output = parseKeyValueOutput(result.stdout);

    expect(result.code).toBe(0);
    expect(output.STATUS).toBe("ok");
    expect(output.LOCAL_BRANCHES_TO_DELETE).toBe("1");
    expect(output.LOCAL_BRANCHES_WITH_UNIQUE_COMMITS).toBe("0");
    const branches = await runGit(
      ["branch", "--format=%(refname:short)"],
      primaryDir,
    );
    expect(branches.split(/\r?\n/u)).toEqual(["main"]);
  });

  it("fast-forwards the primary default branch and removes clean linked worktrees and local branches when forced", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { primaryDir, publisherDir } = await createOriginRepo(rootDir);
    const linkedDir = path.join(rootDir, "clean linked");
    const remoteHead = await publishDefaultCommit(publisherDir, "remote.txt");

    await runGit(["checkout", "-b", "feature/local-only"], primaryDir);
    await writeFile(path.join(primaryDir, "local.txt"), "local\n", "utf-8");
    await runGit(["add", "local.txt"], primaryDir);
    await runGit(["commit", "-m", "feat: local only"], primaryDir);
    await runGit(["checkout", "main"], primaryDir);
    await runGit(
      ["worktree", "add", "--detach", linkedDir, "main"],
      primaryDir,
    );

    const result = await runScript(
      ["--execute", "--force-branches"],
      linkedDir,
    );
    const output = parseKeyValueOutput(result.stdout);

    expect(result.code).toBe(0);
    expect(output.STATUS).toBe("ok");
    expect(output.MODE).toBe("execute");
    expect(await pathExists(linkedDir)).toBe(false);
    expect(await runGit(["rev-parse", "HEAD"], primaryDir)).toBe(remoteHead);
    const branches = await runGit(
      ["branch", "--format=%(refname:short)"],
      primaryDir,
    );
    expect(branches.split(/\r?\n/u)).toEqual(["main"]);
  });
});
