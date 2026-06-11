import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  realpath,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../__test-helpers__/fixtures.js";

const execFileAsync = promisify(execFile);
const isWindows = process.platform === "win32";
const TEST_TIMEOUT = isWindows ? 30_000 : 10_000;
const preflightScript = path.join(
  process.cwd(),
  "skills",
  "pr-merge",
  "scripts",
  "preflight-worktree-context.sh",
);
const cleanupScript = path.join(
  process.cwd(),
  "skills",
  "pr-merge",
  "scripts",
  "post-merge-cleanup.sh",
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

async function addWindowsGitShim(envDir: string): Promise<void> {
  if (!isWindows) {
    return;
  }
  await writeFile(
    path.join(envDir, "git.cmd"),
    '@echo off\r\nbash "%~dp0git" %*\r\n',
    "utf-8",
  );
}

function prependPathEnv(envDir: string): NodeJS.ProcessEnv {
  const currentPath = process.env.Path ?? process.env.PATH ?? "";
  const nextPath = `${envDir}${path.delimiter}${currentPath}`;
  return {
    PATH: nextPath,
    Path: nextPath,
  };
}

async function runScript(
  scriptPath: string,
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await runCommand("bash", [scriptPath], cwd, env);
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

function normalizePath(value: string): string {
  const normalized = path.normalize(value).replaceAll("\\", "/");
  return normalized.replace(/^\/([a-zA-Z])\//u, (_, drive: string) => {
    return `${drive.toUpperCase()}:/`;
  });
}

async function createOriginRepo(rootDir: string): Promise<{
  originDir: string;
  primaryDir: string;
}> {
  const originDir = path.join(rootDir, "origin.git");
  const primaryDir = path.join(rootDir, "Primary Repo With Spaces");

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

  return { originDir, primaryDir };
}

async function createFeatureBranch(
  primaryDir: string,
  branchName = "feature/pr-merge-helper",
): Promise<string> {
  await runGit(["checkout", "-b", branchName, "main"], primaryDir);
  await writeFile(
    path.join(primaryDir, "feature.txt"),
    `${branchName}\n`,
    "utf-8",
  );
  await runGit(["add", "feature.txt"], primaryDir);
  await runGit(["commit", "-m", `feat: add ${branchName}`], primaryDir);
  const headSha = await runGit(["rev-parse", "HEAD"], primaryDir);
  await runGit(["push", "-u", "origin", branchName], primaryDir);
  await runGit(["checkout", "main"], primaryDir);
  return headSha;
}

async function createFeatureWorktree(
  primaryDir: string,
  rootDir: string,
  branchName = "feature/pr-merge-helper",
): Promise<string> {
  const featureDir = path.join(rootDir, "Feature Worktree With Spaces");
  await runGit(["worktree", "add", featureDir, branchName], primaryDir);
  return featureDir;
}

async function createUnrelatedWorktree(
  primaryDir: string,
  rootDir: string,
): Promise<string> {
  const unrelatedDir = path.join(rootDir, "unrelated worktree");
  await runGit(
    ["worktree", "add", "-b", "chore/unrelated", unrelatedDir, "main"],
    primaryDir,
  );
  return unrelatedDir;
}

function cleanupEnv(params: {
  primaryDir: string;
  featureDir?: string;
  headSha: string;
  headBranch?: string;
  headRepo?: string;
  baseRepo?: string;
  baseRemoteUrl?: string;
}): NodeJS.ProcessEnv {
  return {
    PR_STATE: "MERGED",
    PR_HEAD_BRANCH: params.headBranch ?? "feature/pr-merge-helper",
    PR_BASE_BRANCH: "main",
    PR_HEAD_SHA: params.headSha,
    PR_HEAD_REPO: params.headRepo ?? "owner/repo",
    PR_BASE_REPO: params.baseRepo ?? "owner/repo",
    PR_BASE_DEFAULT_BRANCH: "main",
    PR_BASE_REMOTE_URL: params.baseRemoteUrl ?? "https://github.com/owner/repo",
    PRIMARY_WORKTREE: params.primaryDir,
    HEAD_WORKTREE: params.featureDir ?? "",
    CURRENT_WORKTREE: params.featureDir ?? params.primaryDir,
  };
}

describe("pr-merge worktree helper scripts", { timeout: TEST_TIMEOUT }, () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => cleanupTempDir(dir)));
    tempDirs.length = 0;
  });

  it("routes a feature worktree with base checked out elsewhere to remote-only", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    await createFeatureBranch(primaryDir);
    const featureDir = await createFeatureWorktree(primaryDir, rootDir);

    const result = await runScript(preflightScript, featureDir, {
      PR_HEAD_BRANCH: "feature/pr-merge-helper",
      PR_BASE_BRANCH: "main",
    });
    const output = parseKeyValueOutput(result.stdout);

    expect(result.code).toBe(0);
    expect(output.MODE).toBe("remote-only");
    expect(output.REASON_CODE).toBe("current-head-worktree");
    expect(normalizePath(output.CURRENT_WORKTREE)).toBe(
      normalizePath(await realpath(featureDir)),
    );
    expect(normalizePath(output.HEAD_WORKTREE)).toBe(
      normalizePath(await realpath(featureDir)),
    );
    expect(normalizePath(output.BASE_WORKTREE)).toBe(
      normalizePath(await realpath(primaryDir)),
    );
  });

  it("routes a base worktree with a feature worktree to remote-only", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    await createFeatureBranch(primaryDir);
    await createFeatureWorktree(primaryDir, rootDir);

    const result = await runScript(preflightScript, primaryDir, {
      PR_HEAD_BRANCH: "feature/pr-merge-helper",
      PR_BASE_BRANCH: "main",
    });
    const output = parseKeyValueOutput(result.stdout);

    expect(result.code).toBe(0);
    expect(output.MODE).toBe("remote-only");
    expect(output.REASON_CODE).toBe("base-with-head-worktree");
  });

  it("routes unrelated worktree without a feature worktree to cd-primary", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    await createFeatureBranch(primaryDir);
    const unrelatedDir = await createUnrelatedWorktree(primaryDir, rootDir);

    const result = await runScript(preflightScript, unrelatedDir, {
      PR_HEAD_BRANCH: "feature/pr-merge-helper",
      PR_BASE_BRANCH: "main",
    });
    const output = parseKeyValueOutput(result.stdout);

    expect(result.code).toBe(0);
    expect(output.MODE).toBe("cd-primary");
    expect(output.REASON_CODE).toBe("unrelated-cd-primary");
    expect(output.HEAD_WORKTREE).toBe("");
  });

  it("routes base worktree without a feature worktree to safe-direct", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    await createFeatureBranch(primaryDir);

    const result = await runScript(preflightScript, primaryDir, {
      PR_HEAD_BRANCH: "feature/pr-merge-helper",
      PR_BASE_BRANCH: "main",
    });
    const output = parseKeyValueOutput(result.stdout);

    expect(result.code).toBe(0);
    expect(output.MODE).toBe("safe-direct");
    expect(output.REASON_CODE).toBe("base-no-head-worktree");
  });

  it("stops for detached and outside-worktree local states", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    await runGit(["checkout", "--detach"], primaryDir);

    const detached = await runScript(preflightScript, primaryDir, {
      PR_HEAD_BRANCH: "feature/pr-merge-helper",
      PR_BASE_BRANCH: "main",
    });
    expect(parseKeyValueOutput(detached.stdout).MODE).toBe("stop");
    expect(parseKeyValueOutput(detached.stdout).REASON_CODE).toBe(
      "detached-current",
    );

    const outside = await runScript(preflightScript, rootDir, {
      PR_HEAD_BRANCH: "feature/pr-merge-helper",
      PR_BASE_BRANCH: "main",
    });
    expect(parseKeyValueOutput(outside.stdout).MODE).toBe("stop");
    expect(parseKeyValueOutput(outside.stdout).REASON_CODE).toBe(
      "outside-worktree",
    );
  });

  it("stops for missing metadata, missing-primary, and unclassifiable worktree metadata", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);

    const missingMetadata = await runScript(preflightScript, primaryDir, {
      PR_HEAD_BRANCH: "",
      PR_BASE_BRANCH: "main",
    });
    expect(parseKeyValueOutput(missingMetadata.stdout).MODE).toBe("stop");
    expect(parseKeyValueOutput(missingMetadata.stdout).REASON_CODE).toBe(
      "missing-pr-metadata",
    );

    const { stdout: gitPathOutput } = await runCommand(
      "sh",
      ["-c", "command -v git"],
      rootDir,
    );
    const envDir = path.join(rootDir, "env");
    await mkdir(envDir, { recursive: true });
    const emptyWorktreeWrapper = path.join(envDir, "git");
    await writeFile(
      emptyWorktreeWrapper,
      [
        "#!/usr/bin/env bash",
        `REAL_GIT=${JSON.stringify(gitPathOutput.trim())}`,
        '  case " $* " in',
        '    *" worktree list --porcelain "*) exit 0 ;;',
        "  esac",
        '  exec "$REAL_GIT" "$@"',
        "",
      ].join("\n"),
      "utf-8",
    );
    await runCommand("chmod", ["+x", emptyWorktreeWrapper], rootDir);
    await addWindowsGitShim(envDir);

    const missingPrimary = await runScript(preflightScript, primaryDir, {
      PR_HEAD_BRANCH: "feature/pr-merge-helper",
      PR_BASE_BRANCH: "main",
      ...prependPathEnv(envDir),
    });
    expect(parseKeyValueOutput(missingPrimary.stdout).MODE).toBe("stop");
    expect(parseKeyValueOutput(missingPrimary.stdout).REASON_CODE).toBe(
      "missing-primary",
    );

    const otherDir = path.join(rootDir, "other worktree metadata");
    await mkdir(otherDir, { recursive: true });
    const unrelatedMetadataWrapper = path.join(envDir, "git");
    await writeFile(
      unrelatedMetadataWrapper,
      [
        "#!/usr/bin/env bash",
        `REAL_GIT=${JSON.stringify(gitPathOutput.trim())}`,
        `OTHER_DIR=${JSON.stringify(otherDir)}`,
        '  case " $* " in',
        '    *" worktree list --porcelain "*)',
        '    printf "worktree %s\\0branch refs/heads/main\\0" "$OTHER_DIR"',
        "    exit 0",
        "      ;;",
        "  esac",
        '  exec "$REAL_GIT" "$@"',
        "",
      ].join("\n"),
      "utf-8",
    );
    await runCommand("chmod", ["+x", unrelatedMetadataWrapper], rootDir);
    await addWindowsGitShim(envDir);

    const unclassifiable = await runScript(preflightScript, primaryDir, {
      PR_HEAD_BRANCH: "feature/pr-merge-helper",
      PR_BASE_BRANCH: "main",
      ...prependPathEnv(envDir),
    });
    expect(parseKeyValueOutput(unclassifiable.stdout).MODE).toBe("stop");
    expect(parseKeyValueOutput(unclassifiable.stdout).REASON_CODE).toBe(
      "unclassifiable",
    );
  });

  it.skipIf(isWindows)(
    "canonicalizes symlinked worktree paths before classification",
    async () => {
      const rootDir = await createTempDir();
      tempDirs.push(rootDir);
      const { primaryDir } = await createOriginRepo(rootDir);
      await createFeatureBranch(primaryDir);
      const featureDir = await createFeatureWorktree(primaryDir, rootDir);
      const symlinkDir = path.join(rootDir, "feature symlink");
      await symlink(featureDir, symlinkDir, "dir");

      const result = await runScript(preflightScript, symlinkDir, {
        PR_HEAD_BRANCH: "feature/pr-merge-helper",
        PR_BASE_BRANCH: "main",
      });
      const output = parseKeyValueOutput(result.stdout);

      expect(result.code).toBe(0);
      expect(output.MODE).toBe("remote-only");
      expect(normalizePath(output.CURRENT_WORKTREE)).toBe(
        normalizePath(await realpath(featureDir)),
      );
    },
  );

  it("removes a clean feature worktree from inside that worktree and deletes matching local and remote branches", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { originDir, primaryDir } = await createOriginRepo(rootDir);
    const headSha = await createFeatureBranch(primaryDir);
    const featureDir = await createFeatureWorktree(primaryDir, rootDir);

    const result = await runScript(
      cleanupScript,
      featureDir,
      cleanupEnv({ primaryDir, featureDir, headSha, baseRemoteUrl: originDir }),
    );
    const output = parseKeyValueOutput(result.stdout);

    expect(result.code).toBe(0);
    if (isWindows) {
      expect(output.WORKTREE_CLEANUP).toBe("failed");
      expect(output.WORKTREE_CLEANUP_REASON).toBe("git-worktree-remove-failed");
      expect(output.LOCAL_BRANCH_CLEANUP).toBe("retained");
      expect(output.LOCAL_BRANCH_CLEANUP_REASON).toBe(
        "worktree-cleanup-failed",
      );
      expect(output.MANUAL_ACTION).toMatch(/remove worktree manually/i);
      expect(await pathExists(featureDir)).toBe(true);
    } else {
      expect(output.WORKTREE_CLEANUP).toBe("removed");
      expect(output.BASE_UPDATE).toBe("updated");
      expect(output.LOCAL_BRANCH_CLEANUP).toBe("deleted");
      expect(output.REMOTE_BRANCH_CLEANUP).toBe("deleted");
      expect(output.MANUAL_ACTION).toBe("none");
      expect(await pathExists(featureDir)).toBe(false);
      await expect(
        runGit(
          ["show-ref", "--verify", "refs/heads/feature/pr-merge-helper"],
          primaryDir,
        ),
      ).rejects.toThrow();
      await expect(
        runGit(
          [
            "ls-remote",
            "--exit-code",
            "--heads",
            "origin",
            "feature/pr-merge-helper",
          ],
          primaryDir,
        ),
      ).rejects.toThrow();
    }
  });

  it("retains dirty and locked feature worktrees for manual cleanup", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { originDir, primaryDir } = await createOriginRepo(rootDir);
    const headSha = await createFeatureBranch(primaryDir);
    const dirtyDir = await createFeatureWorktree(primaryDir, rootDir);
    await writeFile(path.join(dirtyDir, "dirty.txt"), "dirty\n", "utf-8");

    const dirty = await runScript(
      cleanupScript,
      primaryDir,
      cleanupEnv({
        primaryDir,
        featureDir: dirtyDir,
        headSha,
        baseRemoteUrl: originDir,
      }),
    );
    const dirtyOutput = parseKeyValueOutput(dirty.stdout);
    expect(dirtyOutput.WORKTREE_CLEANUP).toBe("retained");
    expect(dirtyOutput.WORKTREE_CLEANUP_REASON).toBe(
      "dirty-or-untracked-worktree",
    );
    expect(dirtyOutput.LOCAL_BRANCH_CLEANUP).toBe("retained");
    expect(dirtyOutput.MANUAL_ACTION).toMatch(/dirty worktree/i);
    expect(await pathExists(dirtyDir)).toBe(true);

    await runGit(["worktree", "remove", "--force", dirtyDir], primaryDir);
    const lockedHeadSha = await createFeatureBranch(
      primaryDir,
      "feature/locked-helper",
    );
    const lockedDir = await createFeatureWorktree(
      primaryDir,
      rootDir,
      "feature/locked-helper",
    );
    await runGit(
      ["worktree", "lock", "--reason", "manual review", lockedDir],
      primaryDir,
    );

    const locked = await runScript(
      cleanupScript,
      primaryDir,
      cleanupEnv({
        primaryDir,
        featureDir: lockedDir,
        headSha: lockedHeadSha,
        headBranch: "feature/locked-helper",
        baseRemoteUrl: originDir,
      }),
    );
    const lockedOutput = parseKeyValueOutput(locked.stdout);
    expect(lockedOutput.WORKTREE_CLEANUP).toBe("retained");
    expect(lockedOutput.WORKTREE_CLEANUP_REASON).toMatch(/^locked-worktree/);
    expect(await pathExists(lockedDir)).toBe(true);
  });

  it("retains local branches for dirty recorded head worktrees even when detached", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { originDir, primaryDir } = await createOriginRepo(rootDir);
    const headSha = await createFeatureBranch(primaryDir);
    const featureDir = await createFeatureWorktree(primaryDir, rootDir);
    await runGit(["checkout", "--detach"], featureDir);
    await writeFile(path.join(featureDir, "dirty.txt"), "dirty\n", "utf-8");

    const result = await runScript(
      cleanupScript,
      primaryDir,
      cleanupEnv({
        primaryDir,
        featureDir,
        headSha,
        baseRemoteUrl: originDir,
      }),
    );
    const output = parseKeyValueOutput(result.stdout);

    expect(output.WORKTREE_CLEANUP).toBe("retained");
    expect(output.WORKTREE_CLEANUP_REASON).toBe("dirty-or-untracked-worktree");
    expect(output.LOCAL_BRANCH_CLEANUP).toBe("retained");
    expect(output.LOCAL_BRANCH_CLEANUP_REASON).toBe(
      "dirty-or-untracked-head-worktree",
    );
    expect(await pathExists(featureDir)).toBe(true);
    expect(
      await runGit(
        ["show-ref", "--verify", "refs/heads/feature/pr-merge-helper"],
        primaryDir,
      ),
    ).toContain("refs/heads/feature/pr-merge-helper");
  });

  it("retains a dirty primary head worktree and local branch", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { originDir, primaryDir } = await createOriginRepo(rootDir);
    const headSha = await createFeatureBranch(primaryDir);
    await runGit(["checkout", "feature/pr-merge-helper"], primaryDir);
    await writeFile(path.join(primaryDir, "untracked.txt"), "local\n", "utf-8");

    const result = await runScript(
      cleanupScript,
      primaryDir,
      cleanupEnv({
        primaryDir,
        featureDir: primaryDir,
        headSha,
        baseRemoteUrl: originDir,
      }),
    );
    const output = parseKeyValueOutput(result.stdout);

    expect(output.WORKTREE_CLEANUP).toBe("retained");
    expect(output.WORKTREE_CLEANUP_REASON).toBe(
      "dirty-or-untracked-primary-head-worktree",
    );
    expect(output.BASE_UPDATE).toBe("skipped");
    expect(output.LOCAL_BRANCH_CLEANUP).toBe("retained");
    expect(output.LOCAL_BRANCH_CLEANUP_REASON).toBe(
      "dirty-or-untracked-head-worktree",
    );
    expect(await runGit(["branch", "--show-current"], primaryDir)).toBe(
      "feature/pr-merge-helper",
    );
  });

  it("retains local and remote branches when SHA or repository gates fail", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { originDir, primaryDir } = await createOriginRepo(rootDir);
    const headSha = await createFeatureBranch(primaryDir);
    const featureDir = await createFeatureWorktree(primaryDir, rootDir);

    await writeFile(path.join(featureDir, "extra.txt"), "extra\n", "utf-8");
    await runGit(["add", "extra.txt"], featureDir);
    await runGit(["commit", "-m", "feat: local extra"], featureDir);

    const localMismatch = await runScript(
      cleanupScript,
      primaryDir,
      cleanupEnv({
        primaryDir,
        featureDir: "",
        headSha,
        baseRemoteUrl: originDir,
      }),
    );
    const localMismatchOutput = parseKeyValueOutput(localMismatch.stdout);
    expect(localMismatchOutput.LOCAL_BRANCH_CLEANUP).toBe("retained");
    expect(localMismatchOutput.LOCAL_BRANCH_CLEANUP_REASON).toBe(
      "local-tip-mismatch",
    );
    expect(localMismatchOutput.REMOTE_BRANCH_CLEANUP).toBe("deleted");

    const secondHeadSha = await createFeatureBranch(
      primaryDir,
      "feature/fork-retained",
    );
    const forkResult = await runScript(
      cleanupScript,
      primaryDir,
      cleanupEnv({
        primaryDir,
        headSha: secondHeadSha,
        headBranch: "feature/fork-retained",
        headRepo: "fork/repo",
        baseRepo: "owner/repo",
        baseRemoteUrl: originDir,
      }),
    );
    const forkOutput = parseKeyValueOutput(forkResult.stdout);
    expect(forkOutput.REMOTE_BRANCH_CLEANUP).toBe("retained");
    expect(forkOutput.REMOTE_BRANCH_CLEANUP_REASON).toBe("fork-head-repo");
  });

  it("retains remote branches when the remote tip changed or the head is the base/default branch", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { originDir, primaryDir } = await createOriginRepo(rootDir);
    const headSha = await createFeatureBranch(primaryDir);
    await runGit(["checkout", "feature/pr-merge-helper"], primaryDir);
    await writeFile(path.join(primaryDir, "remote-new.txt"), "new\n", "utf-8");
    await runGit(["add", "remote-new.txt"], primaryDir);
    await runGit(["commit", "-m", "feat: advance remote"], primaryDir);
    await runGit(["push", "origin", "feature/pr-merge-helper"], primaryDir);
    await runGit(["checkout", "main"], primaryDir);

    const changed = await runScript(
      cleanupScript,
      primaryDir,
      cleanupEnv({ primaryDir, headSha, baseRemoteUrl: originDir }),
    );
    const changedOutput = parseKeyValueOutput(changed.stdout);
    expect(changedOutput.REMOTE_BRANCH_CLEANUP).toBe("retained");
    expect(changedOutput.REMOTE_BRANCH_CLEANUP_REASON).toBe(
      "remote-tip-mismatch",
    );

    const mainSha = await runGit(["rev-parse", "main"], primaryDir);
    const base = await runScript(
      cleanupScript,
      primaryDir,
      cleanupEnv({
        primaryDir,
        headSha: mainSha,
        headBranch: "main",
        baseRemoteUrl: originDir,
      }),
    );
    const baseOutput = parseKeyValueOutput(base.stdout);
    expect(baseOutput.LOCAL_BRANCH_CLEANUP).toBe("retained");
    expect(baseOutput.REMOTE_BRANCH_CLEANUP).toBe("retained");
    expect(baseOutput.REMOTE_BRANCH_CLEANUP_REASON).toBe(
      "head-is-base-or-default",
    );
  });

  it("fails remote branch cleanup when the verified origin cannot be queried", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { originDir, primaryDir } = await createOriginRepo(rootDir);
    const headSha = await createFeatureBranch(primaryDir);
    const unavailableOriginDir = path.join(rootDir, "origin-unavailable.git");
    await rename(originDir, unavailableOriginDir);

    const result = await runScript(
      cleanupScript,
      primaryDir,
      cleanupEnv({ primaryDir, headSha, baseRemoteUrl: originDir }),
    );
    const output = parseKeyValueOutput(result.stdout);

    expect(output.REMOTE_BRANCH_CLEANUP).toBe("failed");
    expect(output.REMOTE_BRANCH_CLEANUP_REASON).toBe("git-ls-remote-failed");
    expect(output.MANUAL_ACTION).toMatch(/origin lookup succeeds/i);
  });

  it("matches remote branch refs exactly before deleting", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { originDir, primaryDir } = await createOriginRepo(rootDir);
    const originalTargetSha = await createFeatureBranch(
      primaryDir,
      "b/feature/x",
    );
    await runGit(["branch", "a/b/feature/x", originalTargetSha], primaryDir);
    await runGit(["push", "-u", "origin", "a/b/feature/x"], primaryDir);
    await runGit(["checkout", "b/feature/x"], primaryDir);
    await writeFile(
      path.join(primaryDir, "advanced.txt"),
      "advanced\n",
      "utf-8",
    );
    await runGit(["add", "advanced.txt"], primaryDir);
    await runGit(["commit", "-m", "feat: advance exact target"], primaryDir);
    await runGit(["push", "origin", "b/feature/x"], primaryDir);
    await runGit(["checkout", "main"], primaryDir);

    const result = await runScript(
      cleanupScript,
      primaryDir,
      cleanupEnv({
        primaryDir,
        headSha: originalTargetSha,
        headBranch: "b/feature/x",
        baseRemoteUrl: originDir,
      }),
    );
    const output = parseKeyValueOutput(result.stdout);

    expect(output.REMOTE_BRANCH_CLEANUP).toBe("retained");
    expect(output.REMOTE_BRANCH_CLEANUP_REASON).toBe("remote-tip-mismatch");
    expect(
      await runGit(
        ["ls-remote", "--heads", "origin", "b/feature/x"],
        primaryDir,
      ),
    ).toContain("refs/heads/b/feature/x");
  });

  it("retains remote branches when origin is not the verified base remote", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    const otherOriginDir = path.join(rootDir, "other-origin.git");
    await runGit(
      ["init", "--bare", "--initial-branch=main", otherOriginDir],
      rootDir,
    );
    const headSha = await createFeatureBranch(primaryDir);

    const result = await runScript(
      cleanupScript,
      primaryDir,
      cleanupEnv({
        primaryDir,
        headSha,
        baseRemoteUrl: otherOriginDir,
      }),
    );
    const output = parseKeyValueOutput(result.stdout);

    expect(output.REMOTE_BRANCH_CLEANUP).toBe("retained");
    expect(output.REMOTE_BRANCH_CLEANUP_REASON).toBe("origin-not-base-remote");
    expect(
      await runGit(
        ["ls-remote", "--heads", "origin", "feature/pr-merge-helper"],
        primaryDir,
      ),
    ).toContain("refs/heads/feature/pr-merge-helper");
  });

  it("rejects unsafe cleanup branch inputs before forming deletion commands", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    const headSha = await createFeatureBranch(primaryDir);

    const result = await runScript(
      cleanupScript,
      primaryDir,
      cleanupEnv({
        primaryDir,
        headSha,
        headBranch: "-unsafe",
      }),
    );

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Unsafe PR_HEAD_BRANCH");
    expect(
      await runGit(
        ["ls-remote", "--heads", "origin", "feature/pr-merge-helper"],
        primaryDir,
      ),
    ).toContain("refs/heads/feature/pr-merge-helper");
  });
});
