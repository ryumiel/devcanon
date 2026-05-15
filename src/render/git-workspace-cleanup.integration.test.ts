import { execFile } from "node:child_process";
import { access, mkdir, realpath, rm, writeFile } from "node:fs/promises";
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
  env: NodeJS.ProcessEnv = {},
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(command, args, {
    cwd,
    env: {
      ...process.env,
      ...env,
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
  env: NodeJS.ProcessEnv = {},
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
      env,
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

function normalizeGitPath(value: string): string {
  return value.replace(/\\/gu, "/");
}

function expectNormalizedOutputToContain(
  stdout: string,
  expected: string,
): void {
  expect(normalizeGitPath(stdout)).toContain(normalizeGitPath(expected));
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

async function listBranches(cwd: string): Promise<string[]> {
  const branches = await runGit(["branch", "--format=%(refname:short)"], cwd);
  return branches.split(/\r?\n/u).filter(Boolean);
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

    const result = await runScript(
      ["--repo", primaryDir, "--dry-run"],
      linkedDir,
    );
    const output = parseKeyValueOutput(result.stdout);
    const canonicalLinkedDir = await realpath(linkedDir);

    expect(result.code).toBe(0);
    expect(output.MODE).toBe("dry-run");
    expect(output.STATUS).toBe("blocked");
    expect(output.DEFAULT_BRANCH).toBe("main");
    expect(output.DIRTY_WORKTREES).toBe("1");
    expect(output.LOCAL_BRANCHES_WITH_UNIQUE_COMMITS).toBe("1");
    expectNormalizedOutputToContain(
      result.stdout,
      `DIRTY_WORKTREE=${canonicalLinkedDir}|FILES=1|PRIMARY=false`,
    );
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

    const result = await runScript(
      ["--repo", primaryDir, "--execute"],
      rootDir,
    );
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

    const result = await runScript(
      ["--repo", primaryDir, "--execute"],
      rootDir,
    );
    const output = parseKeyValueOutput(result.stdout);

    expect(result.code).toBe(0);
    expect(output.STATUS).toBe("ok");
    expect(output.LOCAL_BRANCHES_TO_DELETE).toBe("1");
    expect(output.LOCAL_BRANCHES_WITH_UNIQUE_COMMITS).toBe("0");
    expect(await listBranches(primaryDir)).toEqual(["main"]);
  });

  it("deletes squash-merged local branches without force", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);

    await runGit(["checkout", "-b", "feature/squash"], primaryDir);
    await writeFile(path.join(primaryDir, "squash.txt"), "squash\n", "utf-8");
    await runGit(["add", "squash.txt"], primaryDir);
    await runGit(["commit", "-m", "feat: squash"], primaryDir);
    await runGit(["checkout", "main"], primaryDir);
    await runGit(["merge", "--squash", "feature/squash"], primaryDir);
    await runGit(["commit", "-m", "feat: squash merged"], primaryDir);
    await runGit(["push", "origin", "main"], primaryDir);

    const dryRun = await runScript(
      ["--repo", primaryDir, "--dry-run"],
      rootDir,
    );
    const dryRunOutput = parseKeyValueOutput(dryRun.stdout);

    expect(dryRun.code).toBe(0);
    expect(dryRunOutput.STATUS).toBe("ok");
    expect(dryRunOutput.LOCAL_BRANCHES_TO_DELETE).toBe("1");
    expect(dryRunOutput.LOCAL_BRANCHES_WITH_UNIQUE_COMMITS).toBe("0");
    expect(dryRun.stdout).toContain(
      "MERGED_BRANCH=feature/squash|REASON=squash",
    );

    const result = await runScript(
      ["--repo", primaryDir, "--execute"],
      rootDir,
    );
    const output = parseKeyValueOutput(result.stdout);

    expect(result.code).toBe(0);
    expect(output.STATUS).toBe("ok");
    expect(await listBranches(primaryDir)).toEqual(["main"]);
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

    const dryRun = await runScript(
      ["--repo", primaryDir, "--dry-run"],
      rootDir,
    );
    expect(dryRun.code).toBe(0);

    const result = await runScript(
      ["--repo", primaryDir, "--execute", "--force-branches"],
      rootDir,
    );
    const output = parseKeyValueOutput(result.stdout);

    expect(result.code).toBe(0);
    expect(output.STATUS).toBe("ok");
    expect(output.MODE).toBe("execute");
    expect(await pathExists(linkedDir)).toBe(false);
    expect(await runGit(["rev-parse", "HEAD"], primaryDir)).toBe(remoteHead);
    expect(await listBranches(primaryDir)).toEqual(["main"]);
  });

  it("uses the explicit repo target instead of the current working directory", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);

    const result = await runScript(
      ["--repo", primaryDir, "--dry-run"],
      rootDir,
    );
    const output = parseKeyValueOutput(result.stdout);

    expect(result.code).toBe(0);
    expect(normalizeGitPath(output.PRIMARY_WORKTREE)).toBe(
      normalizeGitPath(await realpath(primaryDir)),
    );
  });

  it("removes a linked default-branch worktree before checking out the primary default branch", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    const linkedMainDir = path.join(rootDir, "linked main");

    await runGit(["checkout", "-b", "feature/local-only"], primaryDir);
    await writeFile(path.join(primaryDir, "local.txt"), "local\n", "utf-8");
    await runGit(["add", "local.txt"], primaryDir);
    await runGit(["commit", "-m", "feat: local only"], primaryDir);
    await runGit(["worktree", "add", linkedMainDir, "main"], primaryDir);

    const result = await runScript(
      ["--repo", primaryDir, "--execute", "--force-branches"],
      rootDir,
    );
    const output = parseKeyValueOutput(result.stdout);

    expect(result.code).toBe(0);
    expect(output.STATUS).toBe("ok");
    expect(await pathExists(linkedMainDir)).toBe(false);
    expect(await runGit(["branch", "--show-current"], primaryDir)).toBe("main");
    expect(await listBranches(primaryDir)).toEqual(["main"]);
  });

  it("reports prunable worktrees without aborting dry-run", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    const staleDir = path.join(rootDir, "stale linked");

    await runGit(
      ["worktree", "add", "-b", "feature/stale", staleDir],
      primaryDir,
    );
    await rm(staleDir, { recursive: true, force: true });

    const result = await runScript(
      ["--repo", primaryDir, "--dry-run"],
      rootDir,
    );
    const output = parseKeyValueOutput(result.stdout);
    const canonicalStaleDir = path.join(
      await realpath(rootDir),
      "stale linked",
    );

    expect(result.code).toBe(0);
    expect(output.STATUS).toBe("ok");
    expect(output.PRUNABLE_WORKTREES).toBe("1");
    expectNormalizedOutputToContain(
      result.stdout,
      `PRUNABLE_WORKTREE=${canonicalStaleDir}`,
    );
  });

  it("prunes stale worktree metadata before deleting local branches", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    const staleDir = path.join(rootDir, "stale branch");

    await runGit(
      ["worktree", "add", "-b", "feature/stale", staleDir],
      primaryDir,
    );
    await rm(staleDir, { recursive: true, force: true });

    const result = await runScript(
      ["--repo", primaryDir, "--execute"],
      rootDir,
    );
    const output = parseKeyValueOutput(result.stdout);
    const worktrees = await runGit(
      ["worktree", "list", "--porcelain"],
      primaryDir,
    );

    expect(result.code).toBe(0);
    expect(output.STATUS).toBe("ok");
    expect(output.PRUNABLE_WORKTREES).toBe("1");
    expect(await listBranches(primaryDir)).toEqual(["main"]);
    expect(worktrees).not.toContain("feature/stale");
  });

  it("removes dirty linked worktrees only with the dirty-worktree force flag", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    const linkedDir = path.join(rootDir, "dirty linked");

    await runGit(
      ["worktree", "add", "-b", "feature/dirty", linkedDir],
      primaryDir,
    );
    await writeFile(path.join(linkedDir, "dirty.txt"), "dirty\n", "utf-8");

    const blocked = await runScript(
      ["--repo", primaryDir, "--execute"],
      rootDir,
    );
    expect(blocked.code).toBe(1);
    expect(parseKeyValueOutput(blocked.stdout).STATUS).toBe("blocked");
    expect(await pathExists(linkedDir)).toBe(true);

    const forced = await runScript(
      ["--repo", primaryDir, "--execute", "--force-dirty-worktrees"],
      rootDir,
    );
    const output = parseKeyValueOutput(forced.stdout);

    expect(forced.code).toBe(0);
    expect(output.STATUS).toBe("ok");
    expect(await pathExists(linkedDir)).toBe(false);
  });

  it("does not force a dirty primary worktree", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);

    await writeFile(path.join(primaryDir, "dirty.txt"), "dirty\n", "utf-8");

    const result = await runScript(
      ["--repo", primaryDir, "--execute", "--force-dirty-worktrees"],
      rootDir,
    );
    const output = parseKeyValueOutput(result.stdout);

    expect(result.code).toBe(1);
    expect(output.STATUS).toBe("blocked");
    expect(result.stdout).toContain("DIRTY_WORKTREE=");
    expect(result.stdout).toContain("|PRIMARY=true");
    expect(await pathExists(path.join(primaryDir, "dirty.txt"))).toBe(true);
  });

  it("aborts if a linked worktree becomes dirty after status collection without force approval", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    const linkedDir = path.join(rootDir, "drift linked");
    const envDir = path.join(rootDir, "env");
    const { stdout: gitPathOutput } = await runCommand(
      "sh",
      ["-c", "command -v git"],
      rootDir,
    );
    const gitPath = gitPathOutput.trim();

    await runGit(
      ["worktree", "add", "-b", "feature/drift", linkedDir],
      primaryDir,
    );
    const canonicalLinkedDir = normalizeGitPath(await realpath(linkedDir));
    await mkdir(envDir, { recursive: true });
    const wrapperPath = path.join(envDir, "git-wrapper-env.sh");
    await writeFile(
      wrapperPath,
      [
        "#!/usr/bin/env bash",
        `REAL_GIT=${JSON.stringify(normalizeGitPath(gitPath))}`,
        `LINKED_DIR=${JSON.stringify(canonicalLinkedDir)}`,
        `MARKER=${JSON.stringify(
          normalizeGitPath(path.join(rootDir, "status-count")),
        )}`,
        "git() {",
        'if [ "$#" -ge 4 ] && [ "$1" = "-C" ] && [ "$2" = "$LINKED_DIR" ] && [ "$3" = "status" ]; then',
        "  count=0",
        '  [ -f "$MARKER" ] && count=$(cat "$MARKER")',
        "  count=$((count + 1))",
        '  printf "%s" "$count" > "$MARKER"',
        '  if [ "$count" -ge 2 ]; then',
        '    printf "dirty\\n" > "$LINKED_DIR/drift.txt"',
        "  fi",
        "fi",
        '  "$REAL_GIT" "$@"',
        "}",
        "",
      ].join("\n"),
      "utf-8",
    );

    const result = await runScript(
      ["--repo", primaryDir, "--execute"],
      rootDir,
      {
        BASH_ENV: wrapperPath,
      },
    );
    const output = parseKeyValueOutput(result.stdout);

    expect(result.code).toBe(1);
    expect(output.STATUS).toBe("ok");
    expect(result.stderr).toContain("became dirty");
    expect(await pathExists(linkedDir)).toBe(true);
    expect(await pathExists(path.join(linkedDir, "drift.txt"))).toBe(true);
  });
});
