import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CANONICAL_CAPABILITY_PROFILES,
  canCreateSymlinks,
  cleanupTempDir,
  createAgentFixture,
  createConfigFile,
  createSkillFixture,
  createTempDir,
  makeAgentYaml,
  makeConfigYaml,
  makeManifestJson,
} from "../../__test-helpers__/fixtures.js";
import {
  type TestLoggerResult,
  installTestLogger,
} from "../../__test-helpers__/logger.js";
import { loadConfig } from "../../config/load.js";
import { withManifestPersistenceFaultsForTesting } from "../../install/manifest.js";
import { runGit } from "../../runtime/git.js";
import { doctorAction } from "./doctor.js";

const execFileAsync = promisify(execFile);
const symlinkAvailable = await canCreateSymlinks();

async function canCreateFifo(): Promise<boolean> {
  if (process.platform === "win32") return false;
  const dir = await createTempDir();
  try {
    await execFileAsync("mkfifo", [path.join(dir, "probe")]);
    return true;
  } catch {
    return false;
  } finally {
    await cleanupTempDir(dir);
  }
}

const fifoAvailable = await canCreateFifo();

type TreeInventoryEntry = {
  path: string;
  kind: "directory" | "file" | "symlink" | "fifo" | "other";
  mode: number;
  size: number;
  bytes?: string;
  unreadable?: true;
  target?: string;
};

async function captureTreeInventory(
  root: string,
): Promise<TreeInventoryEntry[]> {
  const entries: TreeInventoryEntry[] = [];
  async function visit(current: string, relative: string): Promise<void> {
    let stat: Awaited<ReturnType<typeof lstat>>;
    try {
      stat = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const kind = stat.isDirectory()
      ? "directory"
      : stat.isFile()
        ? "file"
        : stat.isSymbolicLink()
          ? "symlink"
          : stat.isFIFO()
            ? "fifo"
            : "other";
    const fileEvidence =
      kind === "file"
        ? await readFile(current).then(
            (bytes) => ({ bytes: bytes.toString("base64") }),
            () => ({ unreadable: true as const }),
          )
        : {};
    entries.push({
      path: relative || ".",
      kind,
      mode: stat.mode & 0o777,
      size: stat.size,
      ...fileEvidence,
      ...(kind === "symlink" ? { target: await readlink(current) } : {}),
    });
    if (kind !== "directory") return;
    for (const child of (await readdir(current)).sort()) {
      await visit(path.join(current, child), path.join(relative, child));
    }
  }
  await visit(root, "");
  return entries;
}

async function canEnforceUnreadableFile(): Promise<boolean> {
  if (process.platform === "win32" || process.getuid?.() === 0) return false;
  const dir = await createTempDir();
  const file = path.join(dir, "unreadable");
  try {
    await writeFile(file, "probe", "utf-8");
    await chmod(file, 0o000);
    try {
      await readFile(file);
      return false;
    } catch {
      return true;
    }
  } finally {
    await chmod(file, 0o600).catch(() => {});
    await cleanupTempDir(dir);
  }
}

const unreadableFileEnforced = await canEnforceUnreadableFile();

describe("doctorAction", () => {
  let tempDir: string;
  let configPath: string;
  let manifestPath: string;
  let agentsDir: string;
  let skillsDir: string;
  let infos: string[];
  let testLogger: TestLoggerResult;
  let restore: () => void;
  let priorExitCode: typeof process.exitCode;

  beforeEach(async () => {
    tempDir = await createTempDir();
    agentsDir = path.join(tempDir, "agents");
    skillsDir = path.join(tempDir, "skills");
    manifestPath = path.join(tempDir, "manifest.json");
    await mkdir(skillsDir, { recursive: true });
    await mkdir(agentsDir, { recursive: true });
    configPath = await createConfigFile(
      tempDir,
      makeConfigYaml({
        library: {
          skillsDir: "./skills",
          agentsDir: "./agents",
          generatedDir: "./generated",
        },
        manifest: { path: manifestPath },
        targets: {
          claude: {
            skillsHome: path.join(tempDir, "home", "claude", "skills"),
            agentsHome: path.join(tempDir, "home", "claude", "agents"),
          },
          codex: {
            skillsHome: path.join(tempDir, "home", "codex", "skills"),
            agentsHome: path.join(tempDir, "home", "codex", "agents"),
          },
        },
      }),
    );
    const installed = installTestLogger();
    testLogger = installed.testLogger;
    infos = testLogger.infos;
    restore = installed.restore;
    priorExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(async () => {
    process.exitCode = priorExitCode;
    restore();
    await cleanupTempDir(tempDir);
  });

  async function runDoctor(json: boolean): Promise<void> {
    await doctorAction(
      {},
      {
        parent: {
          opts: () => ({ config: configPath, json }),
        },
      },
    );
  }

  function jsonManifestResult(): {
    name: string;
    status: string;
    message: string;
  } {
    const results = testLogger.jsons.at(-1) as Array<{
      name: string;
      status: string;
      message: string;
    }>;
    const result = results.find((entry) => entry.name === "manifest");
    if (!result) throw new Error("expected Doctor manifest result");
    return result;
  }

  async function createDoctorSentinels() {
    const generatedPath = path.join(
      tempDir,
      "generated",
      "claude",
      "agents",
      "sentinel.md",
    );
    const installedPath = path.join(
      tempDir,
      "home",
      "claude",
      "agents",
      "sentinel.md",
    );
    await mkdir(path.dirname(generatedPath), { recursive: true });
    await mkdir(path.dirname(installedPath), { recursive: true });
    await writeFile(generatedPath, "generated sentinel", "utf-8");
    await writeFile(installedPath, "installed sentinel", "utf-8");
    const generatedSecondaryPath = path.join(
      tempDir,
      "generated",
      "codex",
      "skills",
      "secondary.txt",
    );
    const installedSecondaryPath = path.join(
      tempDir,
      "home",
      "codex",
      "skills",
      "secondary.txt",
    );
    await mkdir(path.dirname(generatedSecondaryPath), { recursive: true });
    await mkdir(path.dirname(installedSecondaryPath), { recursive: true });
    await writeFile(generatedSecondaryPath, "generated secondary", "utf-8");
    await writeFile(installedSecondaryPath, "installed secondary", "utf-8");
    return {
      generatedPath,
      installedPath,
      generatedRoot: path.join(tempDir, "generated"),
      installedRoot: path.join(tempDir, "home"),
      generatedTree: await captureTreeInventory(
        path.join(tempDir, "generated"),
      ),
      installedTree: await captureTreeInventory(path.join(tempDir, "home")),
    };
  }

  async function manifestSiblingInventory(): Promise<string[]> {
    const basename = path.basename(manifestPath);
    return (await readdir(path.dirname(manifestPath)))
      .filter((entry) => entry.startsWith(basename))
      .sort();
  }

  async function manifestArtifactTree(): Promise<TreeInventoryEntry[]> {
    const parent = path.dirname(manifestPath);
    const basename = path.basename(manifestPath);
    const entries: TreeInventoryEntry[] = [];
    for (const entry of (await readdir(parent))
      .filter((name) => name.startsWith(basename))
      .sort()) {
      for (const item of await captureTreeInventory(path.join(parent, entry))) {
        entries.push({
          ...item,
          path: item.path === "." ? entry : path.join(entry, item.path),
        });
      }
    }
    return entries;
  }

  async function expectDoctorTreesUnchanged(
    sentinels: Awaited<ReturnType<typeof createDoctorSentinels>>,
  ): Promise<void> {
    expect(await captureTreeInventory(sentinels.generatedRoot)).toEqual(
      sentinels.generatedTree,
    );
    expect(await captureTreeInventory(sentinels.installedRoot)).toEqual(
      sentinels.installedTree,
    );
  }

  function expectManifestWarning(): void {
    expect(
      infos.some((entry) =>
        entry.includes("manifest: Manifest not accessible"),
      ),
    ).toBe(true);
    expect(
      infos.some((entry) => entry.includes("manifest: Manifest: 0 records")),
    ).toBe(false);
  }

  it("reports agents-valid ok for agents using a neutral capability", async () => {
    await createAgentFixture(
      agentsDir,
      "reviewer",
      makeAgentYaml("reviewer", {
        capability: "balanced",
        claude: { tools: ["Read"] },
        codex: { sandbox_mode: "read-only" },
      }),
    );

    await doctorAction(
      {},
      {
        parent: {
          opts: () => ({ config: configPath, json: false }),
        },
      },
    );

    expect(
      infos.some((entry) => entry.includes("agents-valid: 1 agent(s) valid")),
    ).toBe(true);
  });

  it.each(["fast", " balanced"])(
    "reports skills-valid error for active model token key %s even with advisory diagnostics disabled",
    async (modelKey) => {
      await createSkillFixture(
        skillsDir,
        "invalid-model-token",
        [
          "---",
          "name: invalid-model-token",
          "description: A skill with an invalid active model token.",
          "---",
          "",
          `Use {{model:${modelKey}}} for synthesis.`,
          "",
        ].join("\n"),
      );

      await doctorAction(
        {},
        {
          parent: {
            opts: () => ({ config: configPath, json: true }),
          },
        },
      );

      expect(process.exitCode).toBe(1);
      const results = testLogger.jsons[0] as Array<{
        name: string;
        status: string;
        message: string;
      }>;
      expect(results).toContainEqual(
        expect.objectContaining({
          name: "skills-valid",
          status: "error",
          message: expect.stringContaining(`{{model:${modelKey}}}`),
        }),
      );
    },
  );

  it("reports managed-worktrees ok when no worktree directory exists", async () => {
    await doctorAction(
      {},
      {
        parent: {
          opts: () => ({ config: configPath, json: false }),
        },
      },
    );

    expect(
      infos.some((entry) =>
        entry.includes(
          "managed-worktrees: No managed .worktrees directory found.",
        ),
      ),
    ).toBe(true);
  });

  it("reports managed-worktrees warnings for orphaned entries", async () => {
    await initRepo(tempDir);
    const orphan = path.join(tempDir, ".worktrees", "orphan");
    await mkdir(orphan, { recursive: true });
    await writeFile(
      path.join(orphan, ".git"),
      "gitdir: ../../.git/worktrees/orphan\n",
      "utf-8",
    );

    await doctorAction(
      {},
      {
        parent: {
          opts: () => ({ config: configPath, json: false }),
        },
      },
    );

    expect(
      infos.some(
        (entry) =>
          entry.includes(
            "managed-worktrees: Managed worktree drift detected",
          ) &&
          entry.includes(
            ".worktrees/orphan is not registered in git worktree metadata.",
          ) &&
          entry.includes("separate cleanup workflow"),
      ),
    ).toBe(true);
  });

  it("reports primary checkout managed-worktree drift when invoked from a managed worktree", async () => {
    await initRepo(tempDir);
    const linkedWorktree = path.join(tempDir, ".worktrees", "linked");
    await runGit(["worktree", "add", "-b", "linked", linkedWorktree, "HEAD"], {
      cwd: tempDir,
    });
    await mkdir(path.join(linkedWorktree, "skills"), { recursive: true });
    await mkdir(path.join(linkedWorktree, "agents"), { recursive: true });
    const linkedConfigPath = await createConfigFile(
      linkedWorktree,
      makeConfigYaml({
        library: {
          skillsDir: "./skills",
          agentsDir: "./agents",
          generatedDir: "./generated",
        },
      }),
    );
    const orphan = path.join(tempDir, ".worktrees", "orphan");
    await mkdir(orphan, { recursive: true });
    await writeFile(
      path.join(orphan, ".git"),
      "gitdir: ../../.git/worktrees/orphan\n",
      "utf-8",
    );

    await doctorAction(
      {},
      {
        parent: {
          opts: () => ({ config: linkedConfigPath, json: false }),
        },
      },
    );

    expect(
      infos.some(
        (entry) =>
          entry.includes(
            "managed-worktrees: Managed worktree drift detected",
          ) &&
          entry.includes(
            ".worktrees/orphan is not registered in git worktree metadata.",
          ),
      ),
    ).toBe(true);
  });

  it.each([
    ["json", false],
    ["json", true],
    ["schema", false],
    ["schema", true],
  ] as const)(
    "reports %s-invalid manifest through the existing warning path without recovery",
    async (invalidKind, json) => {
      const config = await loadConfig(configPath);
      const validBytes = makeManifestJson([], { config });
      const invalidBytes =
        invalidKind === "json"
          ? validBytes.slice(0, -1)
          : JSON.stringify(
              { ...JSON.parse(validBytes), version: 999 },
              null,
              2,
            );
      const sentinels = await createDoctorSentinels();
      await writeFile(manifestPath, invalidBytes, "utf-8");
      const manifestTreeBefore = await manifestArtifactTree();
      const faultStages: string[] = [];

      await withManifestPersistenceFaultsForTesting(
        (stage) => {
          faultStages.push(stage);
        },
        () => runDoctor(json),
      );

      expect(faultStages).toEqual([]);
      expect(process.exitCode).toBeUndefined();
      if (json) {
        expect(jsonManifestResult()).toEqual({
          name: "manifest",
          status: "warn",
          message: "Manifest not accessible",
        });
      }
      expectManifestWarning();
      expect(await readFile(manifestPath, "utf-8")).toBe(invalidBytes);
      expect(await manifestSiblingInventory()).toEqual([
        path.basename(manifestPath),
      ]);
      expect(await manifestArtifactTree()).toEqual(manifestTreeBefore);
      await expectDoctorTreesUnchanged(sentinels);
    },
  );

  it.each(["regular", "directory"] as const)(
    "warns instead of reporting healthy zero for an absent manifest with a %s lock",
    async (lockKind) => {
      const sentinels = await createDoctorSentinels();
      const lockPath = `${manifestPath}.lock`;
      if (lockKind === "regular") {
        await writeFile(lockPath, "lock sentinel", "utf-8");
      } else {
        await mkdir(lockPath);
      }
      const manifestTreeBefore = await manifestArtifactTree();
      const faultStages: string[] = [];

      await withManifestPersistenceFaultsForTesting(
        (stage) => {
          faultStages.push(stage);
        },
        () => runDoctor(true),
      );

      expect(faultStages).toEqual([]);
      expect(process.exitCode).toBeUndefined();
      expect(jsonManifestResult()).toEqual({
        name: "manifest",
        status: "warn",
        message: "Manifest not accessible",
      });
      expectManifestWarning();
      expect(await manifestSiblingInventory()).toEqual([
        path.basename(lockPath),
      ]);
      if (lockKind === "regular") {
        expect(await readFile(lockPath, "utf-8")).toBe("lock sentinel");
      } else {
        expect((await lstat(lockPath)).isDirectory()).toBe(true);
      }
      expect(await manifestArtifactTree()).toEqual(manifestTreeBefore);
      await expectDoctorTreesUnchanged(sentinels);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "warns for a symlink sibling lock without touching the link or target",
    async () => {
      const sentinels = await createDoctorSentinels();
      const lockPath = `${manifestPath}.lock`;
      const targetPath = path.join(tempDir, "doctor-lock-target");
      await writeFile(targetPath, "lock target sentinel", "utf-8");
      await symlink(targetPath, lockPath, "file");
      const manifestTreeBefore = await manifestArtifactTree();
      const faultStages: string[] = [];

      await withManifestPersistenceFaultsForTesting(
        (stage) => {
          faultStages.push(stage);
        },
        () => runDoctor(true),
      );

      expect(faultStages).toEqual([]);
      expect(process.exitCode).toBeUndefined();
      expect(jsonManifestResult()).toEqual({
        name: "manifest",
        status: "warn",
        message: "Manifest not accessible",
      });
      expectManifestWarning();
      expect((await lstat(lockPath)).isSymbolicLink()).toBe(true);
      expect(await readlink(lockPath)).toBe(targetPath);
      expect(await readFile(targetPath, "utf-8")).toBe("lock target sentinel");
      expect(await manifestSiblingInventory()).toEqual([
        path.basename(lockPath),
      ]);
      expect(await manifestArtifactTree()).toEqual(manifestTreeBefore);
      await expectDoctorTreesUnchanged(sentinels);
    },
  );

  it.skipIf(!fifoAvailable)(
    "warns for a FIFO sibling lock without blocking or entering recovery",
    async () => {
      const sentinels = await createDoctorSentinels();
      const lockPath = `${manifestPath}.lock`;
      await execFileAsync("mkfifo", [lockPath]);
      const manifestTreeBefore = await manifestArtifactTree();
      const faultStages: string[] = [];

      await withManifestPersistenceFaultsForTesting(
        (stage) => {
          faultStages.push(stage);
        },
        () => runDoctor(true),
      );

      expect(faultStages).toEqual([]);
      expect(process.exitCode).toBeUndefined();
      expect(jsonManifestResult()).toEqual({
        name: "manifest",
        status: "warn",
        message: "Manifest not accessible",
      });
      expectManifestWarning();
      expect((await lstat(lockPath)).isFIFO()).toBe(true);
      expect(await manifestSiblingInventory()).toEqual([
        path.basename(lockPath),
      ]);
      expect(await manifestArtifactTree()).toEqual(manifestTreeBefore);
      await expectDoctorTreesUnchanged(sentinels);
    },
  );

  it.skipIf(!unreadableFileEnforced)(
    "warns for an unreadable sibling lock without recovery and restores permissions",
    async () => {
      const sentinels = await createDoctorSentinels();
      const lockPath = `${manifestPath}.lock`;
      await writeFile(lockPath, "unreadable lock sentinel", "utf-8");
      await chmod(lockPath, 0o000);
      await expect(readFile(lockPath)).rejects.toBeDefined();
      const manifestTreeBefore = await manifestArtifactTree();
      const faultStages: string[] = [];

      try {
        await withManifestPersistenceFaultsForTesting(
          (stage) => {
            faultStages.push(stage);
          },
          () => runDoctor(true),
        );

        expect(faultStages).toEqual([]);
        expect(process.exitCode).toBeUndefined();
        expect(jsonManifestResult()).toEqual({
          name: "manifest",
          status: "warn",
          message: "Manifest not accessible",
        });
        expectManifestWarning();
        expect((await lstat(lockPath)).mode & 0o777).toBe(0);
        expect(await manifestSiblingInventory()).toEqual([
          path.basename(lockPath),
        ]);
        expect(await manifestArtifactTree()).toEqual(manifestTreeBefore);
        await expectDoctorTreesUnchanged(sentinels);
      } finally {
        await chmod(lockPath, 0o600);
      }
      expect(await readFile(lockPath, "utf-8")).toBe(
        "unreadable lock sentinel",
      );
    },
  );

  it.each([
    ["absent", false],
    ["valid", true],
  ] as const)(
    "keeps %s manifest control healthy and distinct from invalid state",
    async (state, json) => {
      const faultStages: string[] = [];
      if (state === "valid") {
        const config = await loadConfig(configPath);
        await writeFile(
          manifestPath,
          makeManifestJson([], { config }),
          "utf-8",
        );
      }

      await withManifestPersistenceFaultsForTesting(
        (stage) => {
          faultStages.push(stage);
        },
        () => runDoctor(json),
      );

      expect(faultStages).toEqual([]);
      expect(process.exitCode).toBeUndefined();
      if (json) {
        expect(jsonManifestResult()).toEqual({
          name: "manifest",
          status: "ok",
          message: "Manifest: 0 records",
        });
      }
      expect(
        infos.some((entry) => entry.includes("manifest: Manifest: 0 records")),
      ).toBe(true);
      expect(await manifestSiblingInventory()).toEqual(
        state === "valid" ? [path.basename(manifestPath)] : [],
      );
    },
  );

  it.each([
    [
      "legacy v1",
      "version: 1\n",
      "Config invalid: Config version 1 is no longer supported.",
    ],
    [
      "v2 missing frontier Codex model",
      makeConfigYaml({
        capabilityProfiles: {
          efficient: CANONICAL_CAPABILITY_PROFILES.efficient,
          balanced: CANONICAL_CAPABILITY_PROFILES.balanced,
          frontier: {
            claude: CANONICAL_CAPABILITY_PROFILES.frontier.claude,
          },
        },
      }),
      "Config invalid: Invalid config: Required",
    ],
  ])(
    "records %s config failure and skips every config-dependent check",
    async (_label, invalidConfig, expectedMessage) => {
      await writeFile(configPath, invalidConfig, "utf-8");

      await expect(
        doctorAction(
          {},
          {
            parent: {
              opts: () => ({ config: configPath, json: true }),
            },
          },
        ),
      ).resolves.toBeUndefined();

      expect(process.exitCode).toBe(1);
      expect(testLogger.jsons).toHaveLength(1);
      const results = testLogger.jsons[0] as Array<{
        name: string;
        status: string;
        message: string;
      }>;
      expect(results).toEqual([
        {
          name: "node-version",
          status: "ok",
          message: `Node ${process.versions.node}`,
        },
        {
          name: "config-found",
          status: "ok",
          message: "Config file found",
        },
        {
          name: "config-valid",
          status: "error",
          message: expectedMessage,
        },
      ]);
      expect(infos).toHaveLength(3);
      expect(infos[0]).toContain("node-version:");
      expect(infos[1]).toContain("config-found:");
      expect(infos[2]).toContain("config-valid:");
    },
  );
});

async function initRepo(repoDir: string): Promise<void> {
  await runGit(["init", "--initial-branch=main"], { cwd: repoDir });
  await runGit(["config", "user.name", "Test User"], { cwd: repoDir });
  await runGit(["config", "user.email", "test@example.com"], { cwd: repoDir });
  await writeFile(path.join(repoDir, "README.md"), "test\n");
  await runGit(["add", "README.md"], { cwd: repoDir });
  await runGit(["commit", "-m", "test: initial"], { cwd: repoDir });
}
