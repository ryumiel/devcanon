import { execFile } from "node:child_process";
import { access, cp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupTempDir,
  createTempDir,
  makeResolvedConfig,
} from "../__test-helpers__/fixtures.js";
import { toBashPath } from "../__test-helpers__/runtime-conformance.js";
import { renderAll } from "../render/pipeline.js";

const execFileAsync = promisify(execFile);
const TEST_TIMEOUT = process.platform === "win32" ? 30_000 : 10_000;
const TEST_OPTIONS = { timeout: TEST_TIMEOUT };

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
    const bashArgs = await toBashScriptArgs(args);
    const { stdout, stderr } = await runCommand(
      "bash",
      [await toBashPath(scriptPath), ...bashArgs],
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

async function toBashScriptArgs(args: string[]): Promise<string[]> {
  const bashArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    bashArgs.push(arg);

    if (arg === "--repo" && index + 1 < args.length) {
      index += 1;
      bashArgs.push(await toBashPath(args[index]));
    }
  }

  return bashArgs;
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

describe("git-workspace-cleanup skill helper", TEST_OPTIONS, () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => cleanupTempDir(dir)));
    tempDirs.length = 0;
  });

  it("prints help successfully", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);

    const result = await runScript(["--help"], rootDir);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("usage: git-workspace-cleanup.sh");
  });

  it("prints help from the generated Codex skill layout with sibling runtime", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const config = makeResolvedConfig(rootDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await cp(
      path.resolve("skills/devcanon-runtime"),
      path.join(config.library.skillsDir, "devcanon-runtime"),
      { recursive: true },
    );
    await cp(
      path.resolve("skills/git-workspace-cleanup"),
      path.join(config.library.skillsDir, "git-workspace-cleanup"),
      { recursive: true },
    );

    await renderAll(config, true, false, "codex");

    const generatedScript = path.join(
      config.library.generatedDir,
      "codex",
      "skills",
      "git-workspace-cleanup",
      "scripts",
      "git-workspace-cleanup.sh",
    );
    const { stdout, stderr } = await runCommand(
      "bash",
      [await toBashPath(generatedScript), "--help"],
      rootDir,
      { DEVCANON_RUNTIME_DIR: "" },
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("usage: git-workspace-cleanup.sh");
  });

  it("reports actionable setup guidance when the support runtime is missing", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const skillsRoot = path.join(rootDir, "skills");
    await cp(
      path.resolve("skills/git-workspace-cleanup"),
      path.join(skillsRoot, "git-workspace-cleanup"),
      { recursive: true },
    );

    const scriptPath = path.join(
      skillsRoot,
      "git-workspace-cleanup",
      "scripts",
      "git-workspace-cleanup.sh",
    );
    const result = await runCommand(
      "bash",
      [await toBashPath(scriptPath), "--help"],
      rootDir,
      { DEVCANON_RUNTIME_DIR: "" },
    )
      .then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }))
      .catch(
        (
          error: NodeJS.ErrnoException & { stdout?: string; stderr?: string },
        ) => ({
          code: typeof error.code === "number" ? error.code : 1,
          stdout: error.stdout ?? "",
          stderr: error.stderr ?? "",
        }),
      );

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("devcanon-runtime support skill missing");
    expect(result.stderr).toContain("sibling devcanon-runtime");
    expect(result.stderr).toContain("devcanon render/sync");
    expect(result.stderr).toContain("DEVCANON_RUNTIME_DIR");
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

  it("recreates a missing local default branch from origin during execute", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);

    await runGit(["checkout", "-b", "feature/already-merged"], primaryDir);
    await runGit(["branch", "-D", "main"], primaryDir);

    const result = await runScript(
      ["--repo", primaryDir, "--execute"],
      rootDir,
    );
    const output = parseKeyValueOutput(result.stdout);

    expect(result.code).toBe(0);
    expect(output.STATUS).toBe("ok");
    expect(output.DEFAULT_BRANCH_AHEAD_COMMITS).toBe("0");
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

  it("removes linked worktrees with only ignored files without dirty-worktree force", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    const linkedDir = path.join(rootDir, "ignored linked");

    await writeFile(path.join(primaryDir, ".gitignore"), "*.cache\n", "utf-8");
    await runGit(["add", ".gitignore"], primaryDir);
    await runGit(["commit", "-m", "chore: ignore cache files"], primaryDir);
    await runGit(["push", "origin", "main"], primaryDir);
    await runGit(
      ["worktree", "add", "-b", "feature/ignored", linkedDir],
      primaryDir,
    );
    await writeFile(path.join(linkedDir, "local.cache"), "cache\n", "utf-8");

    const dryRun = await runScript(
      ["--repo", primaryDir, "--dry-run"],
      rootDir,
    );
    const dryRunOutput = parseKeyValueOutput(dryRun.stdout);

    expect(dryRun.code).toBe(0);
    expect(dryRunOutput.STATUS).toBe("ok");
    expect(dryRunOutput.DIRTY_WORKTREES).toBe("0");
    expect(await pathExists(linkedDir)).toBe(true);

    const result = await runScript(
      ["--repo", primaryDir, "--execute"],
      rootDir,
    );

    expect(result.code).toBe(0);
    expect(parseKeyValueOutput(result.stdout).STATUS).toBe("ok");
    expect(await pathExists(linkedDir)).toBe(false);
  });

  it("does not block cleanup when the primary worktree has only ignored files", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);

    await writeFile(path.join(primaryDir, ".gitignore"), "*.cache\n", "utf-8");
    await runGit(["add", ".gitignore"], primaryDir);
    await runGit(["commit", "-m", "chore: ignore cache files"], primaryDir);
    await runGit(["push", "origin", "main"], primaryDir);
    await writeFile(path.join(primaryDir, "local.cache"), "cache\n", "utf-8");

    const result = await runScript(
      ["--repo", primaryDir, "--dry-run"],
      rootDir,
    );
    const output = parseKeyValueOutput(result.stdout);

    expect(result.code).toBe(0);
    expect(output.STATUS).toBe("ok");
    expect(output.DIRTY_WORKTREES).toBe("0");
    expect(result.stdout).not.toContain("DIRTY_WORKTREE=");
  });

  it("reports and blocks locked linked worktrees during dry-run and execute", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    const linkedDir = path.join(rootDir, "locked linked");

    await runGit(
      ["worktree", "add", "-b", "feature/locked", linkedDir],
      primaryDir,
    );
    await runGit(
      ["worktree", "lock", "--reason", "manual review", linkedDir],
      primaryDir,
    );

    const dryRun = await runScript(
      ["--repo", primaryDir, "--dry-run"],
      rootDir,
    );
    const dryRunOutput = parseKeyValueOutput(dryRun.stdout);

    expect(dryRun.code).toBe(0);
    expect(dryRunOutput.STATUS).toBe("blocked");
    expect(dryRunOutput.LOCKED_WORKTREES).toBe("1");
    expectNormalizedOutputToContain(
      dryRun.stdout,
      `LOCKED_WORKTREE=${await realpath(linkedDir)}|REASON=manual review`,
    );

    const result = await runScript(
      ["--repo", primaryDir, "--execute", "--force-dirty-worktrees"],
      rootDir,
    );

    expect(result.code).toBe(1);
    expect(parseKeyValueOutput(result.stdout).STATUS).toBe("blocked");
    expect(await pathExists(linkedDir)).toBe(true);
  });

  it("force-deletes branches after classifying them as merged against the remote default", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    const envDir = path.join(rootDir, "env");
    const { stdout: gitPathOutput } = await runCommand(
      "sh",
      ["-c", "command -v git"],
      rootDir,
    );

    await runGit(["branch", "feature/already-merged", "main"], primaryDir);
    await mkdir(envDir, { recursive: true });
    const wrapperPath = path.join(envDir, "git");
    const canonicalPrimaryDir = normalizeGitPath(await realpath(primaryDir));
    await writeFile(
      wrapperPath,
      [
        "#!/usr/bin/env bash",
        `REAL_GIT=${JSON.stringify(normalizeGitPath(gitPathOutput.trim()))}`,
        `PRIMARY_DIR=${JSON.stringify(canonicalPrimaryDir)}`,
        "git() {",
        '  if [ "$#" -ge 5 ] && [ "$1" = "-C" ] && [ "$2" = "$PRIMARY_DIR" ] && [ "$3" = "branch" ] && [ "$4" = "-d" ] && [ "$5" = "feature/already-merged" ]; then',
        '    printf "refusing implicit delete\\n" >&2',
        "    return 1",
        "  fi",
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

    expect(result.code).toBe(0);
    expect(parseKeyValueOutput(result.stdout).STATUS).toBe("ok");
    expect(await listBranches(primaryDir)).toEqual(["main"]);
  });

  it("does not treat an ambiguous default branch short ref as removable", async () => {
    const rootDir = await createTempDir();
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);

    await runGit(["branch", "feature/already-merged", "main"], primaryDir);
    await runGit(["tag", "main"], primaryDir);

    const result = await runScript(
      ["--repo", primaryDir, "--dry-run"],
      rootDir,
    );
    const output = parseKeyValueOutput(result.stdout);

    expect(result.code).toBe(0);
    expect(output.STATUS).toBe("ok");
    expect(output.DEFAULT_BRANCH_AHEAD_COMMITS).toBe("0");
    expect(output.LOCAL_BRANCHES_TO_DELETE).toBe("1");
    expect(result.stdout).not.toContain("DELETE_BRANCH=heads/main");
    expect(result.stdout).toContain("DELETE_BRANCH=feature/already-merged");
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
    const wrapperPath = path.join(envDir, "git");
    await writeFile(
      wrapperPath,
      [
        "#!/usr/bin/env bash",
        `REAL_GIT=${JSON.stringify(normalizeGitPath(gitPath))}`,
        `LINKED_DIR=${JSON.stringify(canonicalLinkedDir)}`,
        `MARKER=${JSON.stringify(
          normalizeGitPath(path.join(rootDir, "status-count")),
        )}`,
        'if [ "$#" -ge 4 ] && [ "$1" = "-C" ] && [ "$2" = "$LINKED_DIR" ] && [ "$3" = "status" ]; then',
        "  count=0",
        '  [ -f "$MARKER" ] && count=$(cat "$MARKER")',
        "  count=$((count + 1))",
        '  printf "%s" "$count" > "$MARKER"',
        '  if [ "$count" -ge 2 ]; then',
        '    printf "dirty\\n" > "$LINKED_DIR/drift.txt"',
        "  fi",
        "fi",
        'exec "$REAL_GIT" "$@"',
        "",
      ].join("\n"),
      "utf-8",
    );
    await runCommand("chmod", ["+x", wrapperPath], rootDir);

    const result = await runScript(
      ["--repo", primaryDir, "--execute"],
      rootDir,
      {
        PATH: `${envDir}${path.delimiter}${process.env.PATH ?? ""}`,
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
