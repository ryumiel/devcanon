import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { makeResolvedConfig } from "../__test-helpers__/fixtures.js";
import { renderAll } from "./pipeline.js";

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

function normalizeFsPath(value: string): string {
  return path.normalize(value).replaceAll("\\", "/");
}

async function createOriginRepo(
  rootDir: string,
  defaultBranch: string = "main",
): Promise<{
  primaryDir: string;
}> {
  const originDir = path.join(rootDir, "origin.git");
  const primaryDir = path.join(rootDir, "Primary Repo With Spaces");

  await mkdir(rootDir, { recursive: true });
  await runGit(["init", "--bare", `--initial-branch=${defaultBranch}`, originDir], rootDir);
  await runGit(["clone", originDir, primaryDir], rootDir);
  await runGit(["config", "user.name", "Test User"], primaryDir);
  await runGit(["config", "user.email", "test@example.com"], primaryDir);
  await writeFile(path.join(primaryDir, "README.md"), "# temp repo\n", "utf-8");
  await runGit(["add", "README.md"], primaryDir);
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

async function renderGeneratedHelperScript(rootDir: string): Promise<string> {
  const repoRoot = process.cwd();
  const skillDir = path.join(rootDir, "skills", "issue-worktree-setup");
  const scriptsDir = path.join(skillDir, "scripts");
  const sourceSkillDir = path.join(repoRoot, "skills", "issue-worktree-setup");

  await mkdir(scriptsDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    await readFile(path.join(sourceSkillDir, "SKILL.md"), "utf-8"),
    "utf-8",
  );
  await writeFile(
    path.join(scriptsDir, "setup-worktree.sh"),
    await readFile(
      path.join(sourceSkillDir, "scripts", "setup-worktree.sh"),
      "utf-8",
    ),
    "utf-8",
  );

  const config = makeResolvedConfig(rootDir, {
    library: {
      skillsDir: path.join(rootDir, "skills"),
      agentsDir: path.join(rootDir, "agents"),
      generatedDir: path.join(rootDir, "generated"),
    },
  });
  await mkdir(config.library.agentsDir, { recursive: true });

  const result = await renderAll(config, true, false, "claude");
  const renderedSkill = result.outputs.find(
    (output) =>
      output.type === "skill" && output.name === "issue-worktree-setup",
  );

  expect(renderedSkill).toBeTruthy();
  if (!renderedSkill || renderedSkill.type !== "skill") {
    throw new Error("Rendered helper skill was not produced.");
  }
  return realpath(
    path.join(renderedSkill.generatedPath, "scripts", "setup-worktree.sh"),
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

  it("creates a new worktree from a repo subdirectory via the generated skill bundle and honors BASE_REF", async () => {
    const rootDir = path.join(os.tmpdir(), `am-worktree-space-${Date.now()}`);
    await mkdir(rootDir, { recursive: true });
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    const helperScript = await renderGeneratedHelperScript(rootDir);
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

  it("reuses a clean managed main worktree and fast-forwards to BASE_REF", async () => {
    const rootDir = path.join(os.tmpdir(), `am-worktree-reuse-${Date.now()}`);
    await mkdir(rootDir, { recursive: true });
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    const helperScript = await renderGeneratedHelperScript(rootDir);
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
    expect(await runGit(["rev-parse", "HEAD"], managedRealPath)).toBe(baseSha);
  });

  it("stops when a managed main worktree is ahead of BASE_REF", async () => {
    const rootDir = path.join(os.tmpdir(), `am-worktree-ahead-${Date.now()}`);
    await mkdir(rootDir, { recursive: true });
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    const helperScript = await renderGeneratedHelperScript(rootDir);

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
    expect(result.MESSAGE).toMatch(/ahead of BASE_REF/i);
    expect(await runGit(["branch", "--show-current"], managedPath)).toBe(
      "main",
    );
    await expect(
      runGit(["rev-parse", "--verify", "feat/should-not-branch"], managedPath),
    ).rejects.toThrow();
  });

  it("refuses to create a nested worktree from a managed feature worktree", async () => {
    const rootDir = path.join(os.tmpdir(), `am-worktree-stop-${Date.now()}`);
    await mkdir(rootDir, { recursive: true });
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    const helperScript = await renderGeneratedHelperScript(rootDir);

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

    expect(normalizeFsPath(result.WORKTREE_PATH)).toBe(
      normalizeFsPath(managedRealPath),
    );
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
    const helperScript = await renderGeneratedHelperScript(rootDir);

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
    const rootDir = path.join(os.tmpdir(), `am-worktree-baseref-${Date.now()}`);
    await mkdir(rootDir, { recursive: true });
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    const helperScript = await renderGeneratedHelperScript(rootDir);

    await expect(
      runCommand("bash", [helperScript], primaryDir, {
        BRANCH_NAME: "feat/bad-base-ref",
        WORKTREE_LEAF: "bad-base-ref",
        BASE_REF: "--help",
      }),
    ).rejects.toThrow(/Unsafe BASE_REF/u);
  });

  it("rejects invalid branch names", async () => {
    const rootDir = path.join(os.tmpdir(), `am-worktree-branch-${Date.now()}`);
    await mkdir(rootDir, { recursive: true });
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    const helperScript = await renderGeneratedHelperScript(rootDir);

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

  it("rejects a symlinked managed worktree root outside the primary checkout", async () => {
    const rootDir = path.join(os.tmpdir(), `am-worktree-symlink-${Date.now()}`);
    await mkdir(rootDir, { recursive: true });
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    const helperScript = await renderGeneratedHelperScript(rootDir);
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
  });

  it("derives BASE_REF default from origin/HEAD when unset on a non-main repo", async () => {
    const rootDir = path.join(os.tmpdir(), `am-worktree-derive-${Date.now()}`);
    await mkdir(rootDir, { recursive: true });
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir, "develop");
    const helperScript = await renderGeneratedHelperScript(rootDir);
    const developSha = await runGit(["rev-parse", "HEAD"], primaryDir);

    const result = await runSetup(helperScript, primaryDir, {
      BRANCH_NAME: "feat/derive-base",
      WORKTREE_LEAF: "derive-base",
      // BASE_REF intentionally unset — exercises derivation path.
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
    expect(await runGit(["rev-parse", "HEAD"], expectedPath)).toBe(developSha);
  });

  it("rejects a symlinked managed worktree leaf outside the primary checkout", async () => {
    const rootDir = path.join(
      os.tmpdir(),
      `am-worktree-leaf-symlink-${Date.now()}`,
    );
    await mkdir(rootDir, { recursive: true });
    tempDirs.push(rootDir);
    const { primaryDir } = await createOriginRepo(rootDir);
    const helperScript = await renderGeneratedHelperScript(rootDir);
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
  });
});
