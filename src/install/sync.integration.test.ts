import { execFile } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canCreateSymlinks,
  cleanupTempDir,
  createAgentFixture,
  createConfigFile,
  createSkillFixture,
  createTempDir,
  makeAgentYaml,
  makeConfigYaml,
  makeManifestJson,
  makeResolvedConfig,
} from "../__test-helpers__/fixtures.js";
import {
  type TestLoggerResult,
  installTestLogger,
} from "../__test-helpers__/logger.js";
import { loadConfig } from "../config/load.js";
import { diffAll } from "../diff/diff.js";
import { buildSkillContentHash } from "../render/skill.js";
import { pathExists, readTextFile } from "../utils/fs.js";
import { sync } from "./sync.js";
import { uninstall } from "./uninstall.js";

const symlinkFailure = vi.hoisted(() => ({ enabled: false }));
vi.mock("./symlink.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./symlink.js")>();
  return {
    ...actual,
    createSymlink: async (...args: Parameters<typeof actual.createSymlink>) => {
      if (symlinkFailure.enabled) {
        const error = new Error(
          "forced symlink failure",
        ) as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }

      return actual.createSymlink(...args);
    },
  };
});

const symlinkAvailable = await canCreateSymlinks();
const execFileAsync = promisify(execFile);

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

async function expectRelativeSymlinkTarget(
  linkPath: string,
  expectedTarget: string,
): Promise<void> {
  const actualTarget = await readlink(linkPath);
  expect(actualTarget.replaceAll("\\", "/")).toBe(
    expectedTarget.replaceAll("\\", "/"),
  );
}

describe("sync", () => {
  let tempDir: string;
  let restoreLogger: () => void;
  let testLogger: TestLoggerResult;

  beforeEach(async () => {
    tempDir = await createTempDir();
    const installed = installTestLogger();
    restoreLogger = installed.restore;
    testLogger = installed.testLogger;
  });

  afterEach(async () => {
    symlinkFailure.enabled = false;
    restoreLogger();
    await cleanupTempDir(tempDir);
  });

  it("fresh sync installs skills and agents via copy", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(
      config.library.skillsDir,
      "greet",
      "---\nname: greet\ndescription: A greeting skill.\n---\n\n# greet\n\nHello.\n",
    );
    await createAgentFixture(
      config.library.agentsDir,
      "helper",
      makeAgentYaml("helper", { skills: ["greet"] }),
    );

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
    });

    expect(result.installed).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);

    // Manifest should exist
    expect(await pathExists(config.manifest.path)).toBe(true);

    // Agent file should be installed for claude
    const claudeAgentPath = path.join(
      config.targets.claude.agentsHome,
      "helper.md",
    );
    expect(await pathExists(claudeAgentPath)).toBe(true);

    // Skill directory should be installed for claude
    const claudeSkillPath = path.join(
      config.targets.claude.skillsHome,
      "greet",
    );
    expect(await pathExists(claudeSkillPath)).toBe(true);
  });

  it("reuses a config-relative manifest boundary and records from a second cwd", async () => {
    const configDir = path.join(tempDir, "project", "config");
    const firstCwd = path.join(tempDir, "first-cwd");
    const secondCwd = path.join(tempDir, "second-cwd");
    await mkdir(configDir, { recursive: true });
    await mkdir(firstCwd, { recursive: true });
    await mkdir(secondCwd, { recursive: true });
    const configPath = await createConfigFile(
      configDir,
      makeConfigYaml({
        library: {
          skillsDir: "./library/skills",
          agentsDir: "./library/agents",
          generatedDir: "./generated",
        },
        targets: {
          claude: {
            enabled: true,
            skillsHome: "./homes/claude/skills",
            agentsHome: "./homes/claude/agents",
          },
          codex: {
            enabled: true,
            skillsHome: "./homes/codex/skills",
            agentsHome: "./homes/codex/agents",
          },
        },
        defaults: {
          installMode: "copy",
          overwritePolicy: "overwrite-managed",
          cleanManagedOutputs: true,
        },
        manifest: { path: "./state/manifest.json" },
      }),
    );
    const previousCwd = process.cwd();
    const opts = { dryRun: false, force: false, strict: false } as const;

    try {
      process.chdir(firstCwd);
      const firstConfig = await loadConfig(configPath);
      await createSkillFixture(firstConfig.library.skillsDir, "shared");
      await createAgentFixture(
        firstConfig.library.agentsDir,
        "helper",
        makeAgentYaml("helper"),
      );

      const first = await sync(firstConfig, opts);
      const firstManifest = JSON.parse(
        await readTextFile(firstConfig.manifest.path),
      );

      expect(first.errors).toEqual([]);
      expect(first.installed).toBeGreaterThan(0);
      expect(firstConfig.manifest.path).toBe(
        path.join(configDir, "state", "manifest.json"),
      );
      expect(firstManifest.boundary).toEqual({
        claudeSkillsHome: path.join(configDir, "homes", "claude", "skills"),
        claudeAgentsHome: path.join(configDir, "homes", "claude", "agents"),
        codexSkillsHome: path.join(configDir, "homes", "codex", "skills"),
        codexAgentsHome: path.join(configDir, "homes", "codex", "agents"),
      });
      expect(
        new Set(
          firstManifest.records.map(
            (record: { installedPath: string }) => record.installedPath,
          ),
        ),
      ).toEqual(
        new Set([
          path.join(configDir, "homes", "claude", "skills", "shared"),
          path.join(configDir, "homes", "claude", "agents", "helper.md"),
          path.join(configDir, "homes", "codex", "skills", "shared"),
          path.join(configDir, "homes", "codex", "agents", "helper.toml"),
        ]),
      );

      process.chdir(secondCwd);
      const secondConfig = await loadConfig(configPath);
      const second = await sync(secondConfig, opts);
      const secondManifest = JSON.parse(
        await readTextFile(secondConfig.manifest.path),
      );

      expect(secondConfig.manifest.path).toBe(firstConfig.manifest.path);
      expect(second.errors).toEqual([]);
      expect(second.reconciliation).toBeUndefined();
      expect(second.installed).toBe(0);
      expect(second.updated).toBe(0);
      expect(second.skipped).toBeGreaterThan(0);
      expect(secondManifest.boundary).toEqual(firstManifest.boundary);
      expect(secondManifest.records).toEqual(firstManifest.records);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("backs up an existing empty legacy manifest but not a missing manifest", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson([], { legacy: true }),
      "utf-8",
    );

    await sync(config, { dryRun: false, force: false, strict: false });

    const migrated = JSON.parse(await readTextFile(config.manifest.path));
    expect(migrated.boundary).toBeDefined();
    expect(
      (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
        entry.includes(".backup-"),
      ),
    ).toHaveLength(1);

    const missingConfig = {
      ...config,
      manifest: { path: path.join(tempDir, "missing", "manifest.json") },
    };
    await sync(missingConfig, { dryRun: false, force: false, strict: false });
    expect(
      (await readdir(path.dirname(missingConfig.manifest.path))).filter(
        (entry) => entry.includes(".backup-"),
      ),
    ).toHaveLength(0);
  });

  it("previews mixed legacy reconciliation without mutating the manifest", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    const ownedPath = path.join(config.targets.claude.agentsHome, "helper.md");
    const foreignPath = path.join(tempDir, "foreign", "helper.md");
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "helper.yaml"),
            generatedPath: null,
            installedPath: ownedPath,
            installMode: "copy",
            contentHash: "owned",
            timestamp: new Date().toISOString(),
          },
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "foreign.yaml"),
            generatedPath: null,
            installedPath: foreignPath,
            installMode: "copy",
            contentHash: "foreign",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );
    const before = await readTextFile(config.manifest.path);

    const result = await sync(config, {
      dryRun: true,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(result.reconciliation).toEqual({
      retained: [
        {
          target: "claude",
          type: "agent",
          name: "helper",
          installedPath: ownedPath,
        },
      ],
      removed: [
        {
          target: "claude",
          type: "agent",
          name: "helper",
          installedPath: foreignPath,
        },
      ],
    });
    expect(await readTextFile(config.manifest.path)).toBe(before);
    expect(
      (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
        entry.includes(".backup-"),
      ),
    ).toHaveLength(0);
  });

  it("reconciles mixed legacy records while preserving production tuples and foreign bytes", async () => {
    const config = makeResolvedConfig(tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await cp(
      path.resolve("skills/devcanon-runtime"),
      path.join(config.library.skillsDir, "devcanon-runtime"),
      { recursive: true },
    );
    await createSkillFixture(config.library.skillsDir, "ordinary-skill");
    const keepSource = await createAgentFixture(
      config.library.agentsDir,
      "keep",
      makeAgentYaml("keep"),
    );
    const staleSource = await createAgentFixture(
      config.library.agentsDir,
      "stale",
      makeAgentYaml("stale"),
    );
    await sync(config, { dryRun: false, force: false, strict: false });

    const current = JSON.parse(await readTextFile(config.manifest.path));
    const foreignPathOne = path.join(tempDir, "foreign-one", "sentinel.md");
    const foreignPathTwo = path.join(tempDir, "foreign-two", "sentinel");
    await mkdir(path.dirname(foreignPathOne), { recursive: true });
    await mkdir(path.dirname(foreignPathTwo), { recursive: true });
    await writeFile(foreignPathOne, "foreign sentinel one bytes", "utf-8");
    await writeFile(foreignPathTwo, "foreign sentinel two bytes", "utf-8");
    const legacy = {
      ...current,
      boundary: undefined,
      records: [
        ...current.records.map(
          ({ name: _name, ...record }: { name: string }) => record,
        ),
        {
          target: "claude",
          type: "agent",
          sourcePath: path.join(config.library.agentsDir, "foreign.yaml"),
          generatedPath: null,
          installedPath: foreignPathOne,
          installMode: "copy",
          contentHash: "foreign",
          timestamp: new Date().toISOString(),
        },
        {
          target: "codex",
          type: "skill",
          sourcePath: path.join(config.library.skillsDir, "foreign"),
          generatedPath: null,
          installedPath: foreignPathTwo,
          installMode: "copy",
          contentHash: "foreign",
          timestamp: new Date().toISOString(),
        },
      ],
    };
    await writeFile(
      config.manifest.path,
      `${JSON.stringify(legacy, null, 2)}\n`,
      "utf-8",
    );
    const originalManifest = await readTextFile(config.manifest.path);
    await rm(staleSource);
    await writeFile(
      keepSource,
      makeAgentYaml("keep", { instructions: "updated after migration" }),
      "utf-8",
    );

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(result.errors).toEqual([]);
    expect(result.updated).toBe(2);
    expect(result.removed).toBe(2);
    expect(result.reconciliation?.removed).toEqual([
      {
        target: "claude",
        type: "agent",
        name: "sentinel",
        installedPath: foreignPathOne,
      },
      {
        target: "codex",
        type: "skill",
        name: "sentinel",
        installedPath: foreignPathTwo,
      },
    ]);
    expect(await readTextFile(foreignPathOne)).toBe(
      "foreign sentinel one bytes",
    );
    expect(await readTextFile(foreignPathTwo)).toBe(
      "foreign sentinel two bytes",
    );
    const backups = (await readdir(path.dirname(config.manifest.path))).filter(
      (entry) => entry.includes(".backup-"),
    );
    expect(backups).toHaveLength(1);
    expect(await readTextFile(path.join(tempDir, backups[0]))).toBe(
      originalManifest,
    );
    const migrated = JSON.parse(await readTextFile(config.manifest.path));
    expect(migrated.boundary).toBeDefined();
    expect(migrated.records).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ installedPath: foreignPathOne }),
        expect.objectContaining({ installedPath: foreignPathTwo }),
      ]),
    );
    expect(migrated.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "claude",
          type: "agent",
          name: "keep",
        }),
        expect.objectContaining({
          target: "codex",
          type: "agent",
          name: "keep",
        }),
        expect.objectContaining({
          target: "claude",
          type: "skill",
          name: "ordinary-skill",
        }),
        expect.objectContaining({
          target: "codex",
          type: "skill",
          name: "ordinary-skill",
        }),
        expect.objectContaining({
          target: "claude",
          type: "skill",
          name: "devcanon-runtime",
        }),
        expect.objectContaining({
          target: "codex",
          type: "skill",
          name: "devcanon-runtime",
        }),
      ]),
    );
    expect(
      await pathExists(path.join(config.targets.claude.agentsHome, "keep.md")),
    ).toBe(true);
    expect(
      await pathExists(path.join(config.targets.codex.agentsHome, "keep.toml")),
    ).toBe(true);
    expect(
      await pathExists(
        path.join(config.targets.claude.skillsHome, "ordinary-skill"),
      ),
    ).toBe(true);
    expect(
      await pathExists(
        path.join(config.targets.codex.skillsHome, "ordinary-skill"),
      ),
    ).toBe(true);
    expect(
      await pathExists(
        path.join(
          config.targets.claude.skillsHome,
          "devcanon-runtime",
          "scripts",
          "devcanon-runtime.sh",
        ),
      ),
    ).toBe(true);
    expect(
      await pathExists(
        path.join(
          config.targets.codex.skillsHome,
          "devcanon-runtime",
          "scripts",
          "devcanon-runtime.sh",
        ),
      ),
    ).toBe(true);

    const second = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      reconcileManifest: true,
    });
    expect(second.reconciliation).toBeUndefined();
    expect(second.removed).toBe(0);
    expect(
      (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
        entry.includes(".backup-"),
      ),
    ).toHaveLength(1);
    const diffs = await diffAll(config);
    expect(diffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "claude",
          type: "agent",
          name: "keep",
          status: "up-to-date",
        }),
        expect.objectContaining({
          target: "codex",
          type: "agent",
          name: "keep",
          status: "up-to-date",
        }),
        expect.objectContaining({
          target: "claude",
          type: "skill",
          name: "ordinary-skill",
          status: "up-to-date",
        }),
        expect.objectContaining({
          target: "claude",
          type: "skill",
          name: "devcanon-runtime",
          status: "up-to-date",
        }),
        expect.objectContaining({
          target: "codex",
          type: "skill",
          name: "ordinary-skill",
          status: "up-to-date",
        }),
        expect.objectContaining({
          target: "codex",
          type: "skill",
          name: "devcanon-runtime",
          status: "up-to-date",
        }),
      ]),
    );
    expect(diffs).not.toHaveLength(0);
    expect(diffs.every((entry) => entry.status === "up-to-date")).toBe(true);
    expect(diffs).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ installedPath: foreignPathOne }),
        expect.objectContaining({ installedPath: foreignPathTwo }),
      ]),
    );
  });

  it("dry-runs a mixed legacy reconciliation without ordinary foreign removal logs", async () => {
    const config = makeResolvedConfig(tempDir, {
      codex: { enabled: false },
      defaults: { cleanManagedOutputs: false },
    });
    const ownedPath = path.join(config.targets.claude.agentsHome, "owned.md");
    const foreignPath = path.join(tempDir, "foreign", "sentinel.md");
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(path.dirname(foreignPath), { recursive: true });
    await writeFile(foreignPath, "foreign sentinel bytes", "utf-8");
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "owned.yaml"),
            generatedPath: null,
            installedPath: ownedPath,
            installMode: "copy",
            contentHash: "owned",
            timestamp: new Date().toISOString(),
          },
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "foreign.yaml"),
            generatedPath: null,
            installedPath: foreignPath,
            installMode: "copy",
            contentHash: "foreign",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );
    const before = await readTextFile(config.manifest.path);

    await sync(config, {
      dryRun: true,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    const foreignLines = testLogger.infos.filter((line) =>
      line.includes(foreignPath),
    );
    expect(foreignLines).toEqual([expect.stringContaining("[remove-record]")]);
    expect(testLogger.infos.join("\n")).not.toContain(
      "[remove] claude/agent/foreign",
    );
    expect(await readTextFile(foreignPath)).toBe("foreign sentinel bytes");
    expect(await readTextFile(config.manifest.path)).toBe(before);
  });

  it("protects a reconciled foreign file path from same-sync explicit force overwrite", async () => {
    const config = makeResolvedConfig(tempDir, {
      codex: { enabled: false },
      defaults: { cleanManagedOutputs: false },
    });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createAgentFixture(
      config.library.agentsDir,
      "protected",
      makeAgentYaml("protected"),
    );
    await createAgentFixture(
      config.library.agentsDir,
      "unrelated",
      makeAgentYaml("unrelated"),
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    const installedPath = path.join(
      config.targets.claude.agentsHome,
      "protected.md",
    );
    const foreignPath = `${config.targets.claude.agentsHome}${path.sep}.${path.sep}protected.md`;
    const unrelatedInstalledPath = path.join(
      config.targets.claude.agentsHome,
      "unrelated.md",
    );
    await mkdir(path.dirname(installedPath), { recursive: true });
    await writeFile(installedPath, "foreign sentinel bytes", "utf-8");
    await writeFile(
      unrelatedInstalledPath,
      "unrelated sentinel bytes",
      "utf-8",
    );
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "foreign.yaml"),
            generatedPath: null,
            installedPath: foreignPath,
            installMode: "copy",
            contentHash: "foreign",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );
    const originalManifest = await readTextFile(config.manifest.path);

    const dryRun = await sync(config, {
      dryRun: true,
      force: true,
      strict: false,
      reconcileManifest: true,
    });

    expect(dryRun.reconciliation?.removed).toEqual([
      {
        target: "claude",
        type: "agent",
        name: "protected",
        installedPath: foreignPath,
      },
    ]);
    expect(testLogger.infos.join("\n")).toContain(
      "[skip-conflict] claude/agent/protected",
    );
    expect(testLogger.infos.join("\n")).toContain(
      "[force-overwrite] claude/agent/unrelated",
    );
    expect(await readTextFile(installedPath)).toBe("foreign sentinel bytes");
    expect(await readTextFile(unrelatedInstalledPath)).toBe(
      "unrelated sentinel bytes",
    );
    expect(await readTextFile(config.manifest.path)).toBe(originalManifest);

    const result = await sync(config, {
      dryRun: false,
      force: true,
      strict: false,
      reconcileManifest: true,
    });

    expect(result.errors).toEqual([]);
    expect(result.installed).toBe(1);
    expect(result.conflicts).toBe(1);
    expect(await readTextFile(installedPath)).toBe("foreign sentinel bytes");
    expect(await readTextFile(unrelatedInstalledPath)).not.toBe(
      "unrelated sentinel bytes",
    );
    const migrated = JSON.parse(await readTextFile(config.manifest.path));
    expect(migrated.records).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ installedPath }),
        expect.objectContaining({ installedPath: foreignPath }),
      ]),
    );
    expect(migrated.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "unrelated",
          installedPath: unrelatedInstalledPath,
        }),
      ]),
    );

    const afterProtectionExpires = await sync(config, {
      dryRun: false,
      force: true,
      strict: false,
      reconcileManifest: true,
    });

    expect(afterProtectionExpires.errors).toEqual([]);
    expect(afterProtectionExpires.installed).toBe(1);
    expect(afterProtectionExpires.conflicts).toBe(0);
    expect(await readTextFile(installedPath)).not.toBe(
      "foreign sentinel bytes",
    );
    const afterExpiration = JSON.parse(
      await readTextFile(config.manifest.path),
    );
    expect(afterExpiration.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "protected", installedPath }),
      ]),
    );
  });

  it("protects a reconciled foreign tree path from configured overwrite-all", async () => {
    const config = makeResolvedConfig(tempDir, {
      codex: { enabled: false },
      defaults: {
        cleanManagedOutputs: false,
        overwritePolicy: "overwrite-all",
      },
    });
    await mkdir(config.library.skillsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, "protected");
    await createSkillFixture(config.library.skillsDir, "unrelated");
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    const installedPath = path.join(
      config.targets.claude.skillsHome,
      "protected",
    );
    const foreignPath = `${config.targets.claude.skillsHome}${path.sep}.${path.sep}protected`;
    const sentinelPath = path.join(installedPath, "sentinel.txt");
    const unrelatedInstalledPath = path.join(
      config.targets.claude.skillsHome,
      "unrelated",
    );
    const unrelatedSentinelPath = path.join(
      unrelatedInstalledPath,
      "sentinel.txt",
    );
    await mkdir(installedPath, { recursive: true });
    await mkdir(unrelatedInstalledPath, { recursive: true });
    await writeFile(sentinelPath, "foreign tree sentinel bytes", "utf-8");
    await writeFile(
      unrelatedSentinelPath,
      "unrelated tree sentinel bytes",
      "utf-8",
    );
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "skill",
            sourcePath: path.join(config.library.skillsDir, "foreign"),
            generatedPath: null,
            installedPath: foreignPath,
            installMode: "copy",
            contentHash: "foreign",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(result.errors).toEqual([]);
    expect(result.installed).toBe(1);
    expect(result.conflicts).toBe(1);
    expect(await readTextFile(sentinelPath)).toBe(
      "foreign tree sentinel bytes",
    );
    expect(await readdir(installedPath)).toEqual(["sentinel.txt"]);
    expect(await pathExists(unrelatedSentinelPath)).toBe(false);
    const migrated = JSON.parse(await readTextFile(config.manifest.path));
    expect(migrated.records).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ installedPath }),
        expect.objectContaining({ installedPath: foreignPath }),
      ]),
    );
    expect(migrated.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "unrelated",
          installedPath: unrelatedInstalledPath,
        }),
      ]),
    );
  });

  it("uses the next collision-safe backup sibling through the sync consumer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T01:02:03.456Z"));
    try {
      const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await writeFile(
        config.manifest.path,
        makeManifestJson([], { legacy: true }),
        "utf-8",
      );
      const base = `${config.manifest.path}.backup-2026-07-17T01-02-03.456Z`;
      await writeFile(base, "base collision", "utf-8");
      await writeFile(`${base}-1`, "first collision", "utf-8");

      await sync(config, { dryRun: false, force: false, strict: false });

      expect(await readTextFile(base)).toBe("base collision");
      expect(await readTextFile(`${base}-1`)).toBe("first collision");
      expect(await readTextFile(`${base}-2`)).toContain('"version": 1');
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases backup authority after a successful consumer operation", async () => {
    const config = makeResolvedConfig(tempDir, {
      codex: { enabled: false },
      defaults: { cleanManagedOutputs: false },
    });
    const installedPath = path.join(
      config.targets.claude.agentsHome,
      "gone.md",
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "gone.yaml"),
            generatedPath: null,
            installedPath,
            installMode: "copy",
            contentHash: "gone",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );

    await sync(config, { dryRun: false, force: false, strict: false });
    const later = await uninstall(config, { dryRun: false });

    expect(later.errors).toEqual([]);
    expect(later.removed).toBe(1);
  });

  it("releases backup authority after a thrown consumer operation", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    const installedPath = path.join(
      config.targets.claude.agentsHome,
      "broken.md",
    );
    await mkdir(config.library.agentsDir, { recursive: true });
    await writeFile(
      path.join(config.library.agentsDir, "broken.yaml"),
      "not: [valid",
      "utf-8",
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "broken.yaml"),
            generatedPath: null,
            installedPath,
            installMode: "copy",
            contentHash: "broken",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );

    await expect(
      sync(config, { dryRun: false, force: false, strict: false }),
    ).rejects.toThrow();
    const later = await uninstall(config, { dryRun: false });

    expect(later.errors).toEqual([]);
    expect(later.removed).toBe(1);
  });

  it("reports malformed legacy identity validation without calling it a boundary mismatch", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            sourcePath: "/source.yaml",
            generatedPath: null,
            installedPath: path.join(
              config.targets.claude.agentsHome,
              "nested",
              "bad.md",
            ),
            installMode: "copy",
            contentHash: "bad",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );

    await expect(
      sync(config, { dryRun: false, force: false, strict: false }),
    ).rejects.toThrow("Manifest identity is invalid");
  });

  it.skipIf(!symlinkAvailable)(
    "reaches configured-home symlink verification from a bound matching manifest",
    async () => {
      const realHome = path.join(tempDir, "real-home");
      const linkedHome = path.join(tempDir, "linked-home");
      const config = makeResolvedConfig(tempDir, {
        claude: { agentsHome: linkedHome },
        codex: { enabled: false },
      });
      const installedPath = path.join(linkedHome, "sentinel.md");
      await mkdir(realHome, { recursive: true });
      await symlink(realHome, linkedHome, "dir");
      await writeFile(path.join(realHome, "sentinel.md"), "sentinel", "utf-8");
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await writeFile(
        config.manifest.path,
        makeManifestJson(
          [
            {
              target: "claude",
              type: "agent",
              name: "sentinel",
              sourcePath: "/source/sentinel.yaml",
              generatedPath: null,
              installedPath,
              installMode: "copy",
              contentHash: "sentinel",
              timestamp: new Date().toISOString(),
            },
          ],
          { config },
        ),
        "utf-8",
      );

      const result = await sync(config, {
        dryRun: false,
        force: false,
        strict: false,
      });

      expect(result.errors).toEqual([
        expect.stringContaining("configured claude agent home is a symlink"),
      ]);
      expect(await readTextFile(path.join(realHome, "sentinel.md"))).toBe(
        "sentinel",
      );
    },
  );

  it("fails closed before installing cross-target outputs at one physical path", async () => {
    const sharedSkillsHome = path.join(tempDir, "home", "shared-skills");
    const config = makeResolvedConfig(tempDir, {
      claude: { skillsHome: sharedSkillsHome },
      codex: { skillsHome: sharedSkillsHome },
    });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, "shared-skill");

    await expect(
      sync(config, { dryRun: false, force: false, strict: false }),
    ).rejects.toThrow("physical path conflict");
    expect(await pathExists(path.join(sharedSkillsHome, "shared-skill"))).toBe(
      false,
    );
  });

  it("idempotent re-sync skips when nothing changed", async () => {
    const config = makeResolvedConfig(tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, "alpha");
    await createAgentFixture(
      config.library.agentsDir,
      "bot",
      makeAgentYaml("bot"),
    );

    const opts = { dryRun: false, force: false, strict: false } as const;
    await sync(config, opts);
    const second = await sync(config, opts);

    expect(second.skipped).toBeGreaterThan(0);
    expect(second.installed).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.errors).toEqual([]);
  });

  it("re-sync detects updated source and reports updated count", async () => {
    const config = makeResolvedConfig(tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, "s1");
    const agentPath = await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    const opts = { dryRun: false, force: false, strict: false } as const;
    await sync(config, opts);

    // Modify agent instructions
    await writeFile(
      agentPath,
      makeAgentYaml("a1", { instructions: "Updated instructions v2" }),
      "utf-8",
    );

    const second = await sync(config, opts);

    expect(second.updated).toBeGreaterThan(0);
    expect(second.errors).toEqual([]);

    // Verify at least one installed agent file has the new content
    const claudeAgentPath = path.join(
      config.targets.claude.agentsHome,
      "a1.md",
    );
    const content = await readTextFile(claudeAgentPath);
    expect(content).toContain("Updated instructions v2");
  });

  it("skips copy-mode update when installed agent content no longer matches the manifest", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    const agentPath = await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    const opts = { dryRun: false, force: false, strict: false } as const;
    await sync(config, opts);

    const claudeAgentPath = path.join(
      config.targets.claude.agentsHome,
      "a1.md",
    );
    await writeFile(claudeAgentPath, "tampered installed content", "utf-8");
    const manifestBefore = JSON.parse(await readTextFile(config.manifest.path));

    await writeFile(
      agentPath,
      makeAgentYaml("a1", { instructions: "Updated instructions v2" }),
      "utf-8",
    );

    const result = await sync(config, { ...opts, force: true });

    expect(result.updated).toBe(0);
    expect(result.errors).toEqual([
      expect.stringContaining("Managed output identity failure"),
    ]);
    expect(await readTextFile(claudeAgentPath)).toBe(
      "tampered installed content",
    );
    const manifestAfter = JSON.parse(await readTextFile(config.manifest.path));
    expect(manifestAfter.records).toEqual(manifestBefore.records);
  });

  it("reports copy identity failure when installed agent kind changes before update", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    const agentPath = await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    const opts = { dryRun: false, force: false, strict: false } as const;
    await sync(config, opts);

    const claudeAgentPath = path.join(
      config.targets.claude.agentsHome,
      "a1.md",
    );
    await rm(claudeAgentPath);
    await mkdir(claudeAgentPath, { recursive: true });
    await writeFile(path.join(claudeAgentPath, "sentinel"), "keep me", "utf-8");
    const manifestBefore = JSON.parse(await readTextFile(config.manifest.path));

    await writeFile(
      agentPath,
      makeAgentYaml("a1", { instructions: "Updated instructions v2" }),
      "utf-8",
    );

    const result = await sync(config, opts);

    expect(result.updated).toBe(0);
    expect(result.errors).toEqual([
      expect.stringContaining("Managed output identity failure"),
    ]);
    expect(result.errors[0]).toContain("installed agent is not a file");
    expect(await readTextFile(path.join(claudeAgentPath, "sentinel"))).toBe(
      "keep me",
    );
    const manifestAfter = JSON.parse(await readTextFile(config.manifest.path));
    expect(manifestAfter.records).toEqual(manifestBefore.records);
  });

  it("skips copy-mode update when installed skill directory content no longer matches the manifest", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    const skillDir = await createSkillFixture(
      config.library.skillsDir,
      "skill-a",
      "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n",
      ["scripts"],
    );
    await writeFile(
      path.join(skillDir, "scripts", "helper.sh"),
      "#!/bin/sh\necho helper\n",
      "utf-8",
    );

    const opts = { dryRun: false, force: false, strict: false } as const;
    await sync(config, opts);

    const claudeSkillPath = path.join(
      config.targets.claude.skillsHome,
      "skill-a",
    );
    await writeFile(
      path.join(claudeSkillPath, "scripts", "helper.sh"),
      "tampered helper\n",
      "utf-8",
    );
    const manifestBefore = JSON.parse(await readTextFile(config.manifest.path));

    await writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n\nUpdated.\n",
      "utf-8",
    );

    const result = await sync(config, opts);

    expect(result.updated).toBe(0);
    expect(result.errors).toEqual([
      expect.stringContaining("installed copy content hash mismatch"),
    ]);
    expect(
      await readTextFile(path.join(claudeSkillPath, "scripts", "helper.sh")),
    ).toBe("tampered helper\n");
    const manifestAfter = JSON.parse(await readTextFile(config.manifest.path));
    expect(manifestAfter.records).toEqual(manifestBefore.records);
  });

  it("skips copy-mode update when installed skill has unexpected top-level entries", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    const skillDir = await createSkillFixture(
      config.library.skillsDir,
      "skill-a",
      "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n",
    );

    const opts = { dryRun: false, force: false, strict: false } as const;
    await sync(config, opts);

    const claudeSkillPath = path.join(
      config.targets.claude.skillsHome,
      "skill-a",
    );
    const sentinelPath = path.join(claudeSkillPath, "local-note.txt");
    await writeFile(sentinelPath, "keep me", "utf-8");
    const manifestBefore = JSON.parse(await readTextFile(config.manifest.path));

    await writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n\nUpdated.\n",
      "utf-8",
    );

    const result = await sync(config, opts);

    expect(result.updated).toBe(0);
    expect(result.errors).toEqual([
      expect.stringContaining("unexpected top-level entries"),
    ]);
    expect(await readTextFile(sentinelPath)).toBe("keep me");
    const manifestAfter = JSON.parse(await readTextFile(config.manifest.path));
    expect(manifestAfter.records).toEqual(manifestBefore.records);
  });

  it.skipIf(!symlinkAvailable)(
    "updates copy-installed skills when a mirrored symlink target changes",
    async () => {
      const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      const skillDir = await createSkillFixture(
        config.library.skillsDir,
        "skill-a",
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n",
        ["scripts"],
      );
      const sourceLink = path.join(skillDir, "scripts", "link.txt");
      await symlink("../target-a/payload.txt", sourceLink);

      const opts = { dryRun: false, force: false, strict: false } as const;
      await sync(config, opts);

      await rm(sourceLink);
      await symlink("../target-b/payload.txt", sourceLink);

      const result = await sync(config, opts);

      const installedLink = path.join(
        config.targets.claude.skillsHome,
        "skill-a",
        "scripts",
        "link.txt",
      );
      expect(result.errors).toEqual([]);
      expect(result.updated).toBe(1);
      await expectRelativeSymlinkTarget(
        installedLink,
        "../target-b/payload.txt",
      );
    },
  );

  it.skipIf(!symlinkAvailable)(
    "updates copy-installed skills with absolute mirrored symlinks",
    async () => {
      const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      const skillDir = await createSkillFixture(
        config.library.skillsDir,
        "skill-a",
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n",
        ["scripts"],
      );
      const absoluteTarget = path.join(
        tempDir,
        "absolute-target",
        "payload.txt",
      );
      await mkdir(path.dirname(absoluteTarget), { recursive: true });
      await writeFile(absoluteTarget, "payload", "utf-8");
      await symlink(absoluteTarget, path.join(skillDir, "scripts", "link.txt"));

      const opts = { dryRun: false, force: false, strict: false } as const;
      await sync(config, opts);

      await writeFile(
        path.join(skillDir, "SKILL.md"),
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n\nUpdated.\n",
        "utf-8",
      );

      const result = await sync(config, opts);

      const installedLink = path.join(
        config.targets.claude.skillsHome,
        "skill-a",
        "scripts",
        "link.txt",
      );
      expect(result.updated).toBe(1);
      expect(result.errors).toEqual([]);
      expect(await readlink(installedLink)).toBe(absoluteTarget);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "updates copy-installed skills when rewritten absolute symlinks came from dot-relative links",
    async () => {
      const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      const skillDir = await createSkillFixture(
        config.library.skillsDir,
        "skill-a",
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n",
        ["scripts"],
      );
      await writeFile(
        path.join(skillDir, "scripts", "payload.txt"),
        "payload",
        "utf-8",
      );
      const sourceLink = path.join(skillDir, "scripts", "link.txt");
      await symlink("./payload.txt", sourceLink);

      const opts = { dryRun: false, force: false, strict: false } as const;
      await sync(config, opts);

      const installedLink = path.join(
        config.targets.claude.skillsHome,
        "skill-a",
        "scripts",
        "link.txt",
      );
      const rewrittenTarget = path.join(
        config.library.generatedDir,
        "claude",
        "skills",
        "skill-a",
        "scripts",
        "payload.txt",
      );
      await rm(installedLink);
      await symlink(rewrittenTarget, installedLink, "file");
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n\nUpdated.\n",
        "utf-8",
      );

      const result = await sync(config, opts);

      expect(result.updated).toBe(1);
      expect(result.errors).toEqual([]);
      await expectRelativeSymlinkTarget(installedLink, "./payload.txt");
    },
  );

  it.skipIf(!symlinkAvailable)(
    "updates copy-installed skills when legacy dot and current no-dot symlink spellings resolve to the same target",
    async () => {
      const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      const skillDir = await createSkillFixture(
        config.library.skillsDir,
        "skill-a",
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n",
        ["scripts"],
      );
      await writeFile(
        path.join(skillDir, "scripts", "payload.txt"),
        "payload",
        "utf-8",
      );
      const sourceLink = path.join(skillDir, "scripts", "link.txt");
      await symlink("./payload.txt", sourceLink);

      const opts = { dryRun: false, force: false, strict: false } as const;
      await sync(config, opts);

      const installedLink = path.join(
        config.targets.claude.skillsHome,
        "skill-a",
        "scripts",
        "link.txt",
      );
      const rewrittenTarget = path.join(
        config.library.generatedDir,
        "claude",
        "skills",
        "skill-a",
        "scripts",
        "payload.txt",
      );
      await rm(installedLink);
      await symlink(rewrittenTarget, installedLink, "file");
      await rm(sourceLink);
      await symlink("payload.txt", sourceLink);
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n\nUpdated.\n",
        "utf-8",
      );

      const result = await sync(config, opts);

      expect(result.updated).toBe(1);
      expect(result.errors).toEqual([]);
      await expectRelativeSymlinkTarget(installedLink, "payload.txt");
    },
  );

  it.skipIf(!symlinkAvailable)(
    "updates copy-installed skills when legacy no-dot and current dot symlink spellings resolve to the same target",
    async () => {
      const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      const skillDir = await createSkillFixture(
        config.library.skillsDir,
        "skill-a",
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n",
        ["scripts"],
      );
      await writeFile(
        path.join(skillDir, "scripts", "payload.txt"),
        "payload",
        "utf-8",
      );
      const sourceLink = path.join(skillDir, "scripts", "link.txt");
      await symlink("payload.txt", sourceLink);

      const opts = { dryRun: false, force: false, strict: false } as const;
      await sync(config, opts);

      const installedLink = path.join(
        config.targets.claude.skillsHome,
        "skill-a",
        "scripts",
        "link.txt",
      );
      const rewrittenTarget = path.join(
        config.library.generatedDir,
        "claude",
        "skills",
        "skill-a",
        "scripts",
        "payload.txt",
      );
      await rm(installedLink);
      await symlink(rewrittenTarget, installedLink, "file");
      await rm(sourceLink);
      await symlink("./payload.txt", sourceLink);
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n\nUpdated.\n",
        "utf-8",
      );

      const result = await sync(config, opts);

      expect(result.updated).toBe(1);
      expect(result.errors).toEqual([]);
      await expectRelativeSymlinkTarget(installedLink, "./payload.txt");
    },
  );

  it.skipIf(!symlinkAvailable)(
    "updates copy-installed skills when the manifest hash used native separators for a contained symlink target",
    async () => {
      const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      const skillDir = await createSkillFixture(
        config.library.skillsDir,
        "skill-a",
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n",
        ["scripts"],
      );
      await mkdir(path.join(skillDir, "scripts", "nested"), {
        recursive: true,
      });
      await writeFile(
        path.join(skillDir, "scripts", "nested", "payload.txt"),
        "payload",
        "utf-8",
      );
      await symlink(
        "nested/payload.txt",
        path.join(skillDir, "scripts", "link.txt"),
      );

      const opts = { dryRun: false, force: false, strict: false } as const;
      await sync(config, opts);

      const installedLink = path.join(
        config.targets.claude.skillsHome,
        "skill-a",
        "scripts",
        "link.txt",
      );
      const generatedSkillDir = path.join(
        config.library.generatedDir,
        "claude",
        "skills",
        "skill-a",
      );
      const rewrittenTarget = path.join(
        generatedSkillDir,
        "scripts",
        "nested",
        "payload.txt",
      );
      await rm(installedLink);
      await symlink(rewrittenTarget, installedLink, "file");

      const manifest = JSON.parse(await readTextFile(config.manifest.path));
      const installedSkillContent = await readTextFile(
        path.join(config.targets.claude.skillsHome, "skill-a", "SKILL.md"),
      );
      const claudeRecord = manifest.records.find(
        (record: { installedPath: string }) =>
          record.installedPath ===
          path.join(config.targets.claude.skillsHome, "skill-a"),
      );
      claudeRecord.contentHash = buildSkillContentHash(
        installedSkillContent,
        new Map([
          [
            path.join(generatedSkillDir, "scripts", "nested", "payload.txt"),
            `file:${Buffer.from("payload").toString("base64")}`,
          ],
          [
            path.join(generatedSkillDir, "scripts", "link.txt"),
            "symlink:nested\\payload.txt",
          ],
        ]),
        generatedSkillDir,
      );
      await writeFile(
        config.manifest.path,
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf-8",
      );
      const sourceLink = path.join(skillDir, "scripts", "link.txt");
      await rm(sourceLink);
      await symlink("./nested/payload.txt", sourceLink);
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n\nUpdated.\n",
        "utf-8",
      );

      const result = await sync(config, opts);

      expect(result.errors).toEqual([]);
      expect(result.updated).toBe(1);
      await expectRelativeSymlinkTarget(installedLink, "./nested/payload.txt");
    },
  );

  it("dry run makes no changes and returns zero counts", async () => {
    const config = makeResolvedConfig(tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, "s1");
    await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    const result = await sync(config, {
      dryRun: true,
      force: false,
      strict: false,
    });

    expect(result.installed).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.conflicts).toBe(0);

    // No manifest should have been written
    expect(await pathExists(config.manifest.path)).toBe(false);

    // No installed files
    const claudeAgentPath = path.join(
      config.targets.claude.agentsHome,
      "a1.md",
    );
    expect(await pathExists(claudeAgentPath)).toBe(false);
  });

  it("force mode overwrites unmanaged file at installed path", async () => {
    const config = makeResolvedConfig(tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    // Pre-create an unmanaged file at the agent's installed path
    const claudeAgentPath = path.join(
      config.targets.claude.agentsHome,
      "a1.md",
    );
    await mkdir(path.dirname(claudeAgentPath), { recursive: true });
    await writeFile(claudeAgentPath, "unmanaged content", "utf-8");

    const result = await sync(config, {
      dryRun: false,
      force: true,
      strict: false,
    });

    expect(result.installed).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);

    const content = await readTextFile(claudeAgentPath);
    expect(content).not.toBe("unmanaged content");
  });

  it("cleans removed outputs when source is deleted", async () => {
    const config = makeResolvedConfig(tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, "s1");
    const agentPath = await createAgentFixture(
      config.library.agentsDir,
      "removeme",
      makeAgentYaml("removeme"),
    );

    const opts = { dryRun: false, force: false, strict: false } as const;
    const first = await sync(config, opts);
    expect(first.installed).toBeGreaterThan(0);

    // Verify agent is installed
    const claudeAgentPath = path.join(
      config.targets.claude.agentsHome,
      "removeme.md",
    );
    expect(await pathExists(claudeAgentPath)).toBe(true);

    // Delete the agent source YAML
    await rm(agentPath);

    const second = await sync(config, opts);

    expect(second.removed).toBeGreaterThan(0);
    expect(second.errors).toEqual([]);

    // Installed agent file should be gone
    expect(await pathExists(claudeAgentPath)).toBe(false);

    // Manifest should not contain removed path
    const manifestContent = await readTextFile(config.manifest.path);
    expect(manifestContent).not.toContain("removeme");
  });

  it.skipIf(!symlinkAvailable)(
    "removes broken skill symlinks when source directory is deleted",
    async () => {
      const config = makeResolvedConfig(tempDir);
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      await createSkillFixture(config.library.skillsDir, "ephemeral-skill");
      await createAgentFixture(
        config.library.agentsDir,
        "a1",
        makeAgentYaml("a1"),
      );

      const opts = {
        mode: "symlink" as const,
        dryRun: false,
        force: false,
        strict: false,
      };
      const first = await sync(config, opts);
      expect(first.installed).toBeGreaterThan(0);
      expect(first.errors).toEqual([]);

      // Verify skill symlink exists
      const claudeSkillPath = path.join(
        config.targets.claude.skillsHome,
        "ephemeral-skill",
      );
      const stat = await lstat(claudeSkillPath);
      expect(stat.isSymbolicLink()).toBe(true);

      // Delete the skill source directory
      await rm(path.join(config.library.skillsDir, "ephemeral-skill"), {
        recursive: true,
      });

      // Re-sync — broken symlink should be removed
      const second = await sync(config, opts);
      expect(second.removed).toBeGreaterThan(0);
      expect(second.errors).toEqual([]);

      // Broken symlink should be gone
      let symlinkGone = false;
      try {
        await lstat(claudeSkillPath);
      } catch {
        symlinkGone = true;
      }
      expect(symlinkGone).toBe(true);

      // Manifest should not contain the removed skill
      const manifestContent = await readTextFile(config.manifest.path);
      expect(manifestContent).not.toContain("ephemeral-skill");
    },
  );

  it.skipIf(!symlinkAvailable)(
    "removes stale copy-installed skills when a copied relative symlink was rewritten absolute",
    async () => {
      const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      const skillDir = await createSkillFixture(
        config.library.skillsDir,
        "skill-a",
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n",
        ["scripts"],
      );
      await mkdir(path.join(skillDir, "target-a"), { recursive: true });
      await writeFile(
        path.join(skillDir, "target-a", "payload.txt"),
        "payload",
        "utf-8",
      );
      await symlink(
        "../target-a/payload.txt",
        path.join(skillDir, "scripts", "link.txt"),
      );

      const opts = { dryRun: false, force: false, strict: false } as const;
      await sync(config, opts);

      const installedLink = path.join(
        config.targets.claude.skillsHome,
        "skill-a",
        "scripts",
        "link.txt",
      );
      const rewrittenTarget = path.join(
        config.library.generatedDir,
        "claude",
        "skills",
        "skill-a",
        "target-a",
        "payload.txt",
      );
      await rm(installedLink);
      await symlink(rewrittenTarget, installedLink, "file");
      await rm(skillDir, { recursive: true });

      const result = await sync(config, opts);

      expect(result.removed).toBe(1);
      expect(result.errors).toEqual([]);
      expect(
        await pathExists(
          path.join(config.targets.claude.skillsHome, "skill-a"),
        ),
      ).toBe(false);
      const manifest = JSON.parse(await readTextFile(config.manifest.path));
      expect(manifest.records).toEqual([]);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "removes stale copy-installed skills when a copied dot-relative symlink was rewritten absolute",
    async () => {
      const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      const skillDir = await createSkillFixture(
        config.library.skillsDir,
        "skill-a",
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n",
        ["scripts"],
      );
      await writeFile(
        path.join(skillDir, "scripts", "payload.txt"),
        "payload",
        "utf-8",
      );
      await symlink(
        "./payload.txt",
        path.join(skillDir, "scripts", "link.txt"),
      );

      const opts = { dryRun: false, force: false, strict: false } as const;
      await sync(config, opts);

      const installedLink = path.join(
        config.targets.claude.skillsHome,
        "skill-a",
        "scripts",
        "link.txt",
      );
      const rewrittenTarget = path.join(
        config.library.generatedDir,
        "claude",
        "skills",
        "skill-a",
        "scripts",
        "payload.txt",
      );
      await rm(installedLink);
      await symlink(rewrittenTarget, installedLink, "file");
      await rm(skillDir, { recursive: true });

      const result = await sync(config, opts);

      expect(result.removed).toBe(1);
      expect(result.errors).toEqual([]);
      expect(
        await pathExists(
          path.join(config.targets.claude.skillsHome, "skill-a"),
        ),
      ).toBe(false);
      const manifest = JSON.parse(await readTextFile(config.manifest.path));
      expect(manifest.records).toEqual([]);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "removes stale copy-installed skills when many copied dot-relative symlinks were rewritten absolute",
    async () => {
      const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      const skillDir = await createSkillFixture(
        config.library.skillsDir,
        "skill-a",
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n",
        ["scripts"],
      );
      for (let i = 0; i < 20; i += 1) {
        await writeFile(
          path.join(skillDir, "scripts", `payload-${i}.txt`),
          `payload ${i}`,
          "utf-8",
        );
        await symlink(
          `./payload-${i}.txt`,
          path.join(skillDir, "scripts", `link-${i}.txt`),
        );
      }

      const opts = { dryRun: false, force: false, strict: false } as const;
      await sync(config, opts);

      for (let i = 0; i < 20; i += 1) {
        const installedLink = path.join(
          config.targets.claude.skillsHome,
          "skill-a",
          "scripts",
          `link-${i}.txt`,
        );
        const rewrittenTarget = path.join(
          config.library.generatedDir,
          "claude",
          "skills",
          "skill-a",
          "scripts",
          `payload-${i}.txt`,
        );
        await rm(installedLink);
        await symlink(rewrittenTarget, installedLink, "file");
      }
      await rm(skillDir, { recursive: true });

      const result = await sync(config, opts);

      expect(result.removed).toBe(1);
      expect(result.errors).toEqual([]);
      expect(
        await pathExists(
          path.join(config.targets.claude.skillsHome, "skill-a"),
        ),
      ).toBe(false);
      const manifest = JSON.parse(await readTextFile(config.manifest.path));
      expect(manifest.records).toEqual([]);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "keeps stale copy-installed skills when many rewritten symlink spellings cannot be reconstructed",
    async () => {
      const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      const skillDir = await createSkillFixture(
        config.library.skillsDir,
        "skill-a",
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n",
        ["scripts"],
      );
      for (let i = 0; i < 20; i += 1) {
        await writeFile(
          path.join(skillDir, "scripts", `payload-${i}.txt`),
          `payload ${i}`,
          "utf-8",
        );
        await symlink(
          i < 2 ? `./payload-${i}.txt` : `payload-${i}.txt`,
          path.join(skillDir, "scripts", `link-${i}.txt`),
        );
      }

      const opts = { dryRun: false, force: false, strict: false } as const;
      await sync(config, opts);

      for (let i = 0; i < 20; i += 1) {
        const installedLink = path.join(
          config.targets.claude.skillsHome,
          "skill-a",
          "scripts",
          `link-${i}.txt`,
        );
        const rewrittenTarget = path.join(
          config.library.generatedDir,
          "claude",
          "skills",
          "skill-a",
          "scripts",
          `payload-${i}.txt`,
        );
        await rm(installedLink);
        await symlink(rewrittenTarget, installedLink, "file");
      }
      await rm(skillDir, { recursive: true });
      const manifestBefore = await readTextFile(config.manifest.path);

      const result = await sync(config, opts);

      expect(result.removed).toBe(0);
      expect(result.errors).toEqual([
        expect.stringContaining("installed copy content hash mismatch"),
      ]);
      expect(
        await pathExists(
          path.join(config.targets.claude.skillsHome, "skill-a"),
        ),
      ).toBe(true);
      expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "skips symlink-mode update when the installed symlink points elsewhere",
    async () => {
      const config = makeResolvedConfig(tempDir, {
        claude: { installMode: "symlink" },
        codex: { enabled: false },
        defaults: { installMode: "symlink" },
      });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      const agentPath = await createAgentFixture(
        config.library.agentsDir,
        "a1",
        makeAgentYaml("a1"),
      );

      const opts = { dryRun: false, force: false, strict: false } as const;
      await sync(config, opts);

      const claudeAgentPath = path.join(
        config.targets.claude.agentsHome,
        "a1.md",
      );
      await rm(claudeAgentPath);
      const foreignTarget = path.join(tempDir, "outside", "foreign.md");
      await mkdir(path.dirname(foreignTarget), { recursive: true });
      await writeFile(foreignTarget, "foreign", "utf-8");
      await symlink(foreignTarget, claudeAgentPath, "file");
      const manifestBefore = JSON.parse(
        await readTextFile(config.manifest.path),
      );

      await writeFile(
        agentPath,
        makeAgentYaml("a1", { instructions: "Updated instructions v2" }),
        "utf-8",
      );

      const result = await sync(config, opts);

      expect(result.updated).toBe(0);
      expect(result.errors).toEqual([
        expect.stringContaining("symlink target mismatch"),
      ]);
      expect(await readlink(claudeAgentPath)).toBe(foreignTarget);
      const manifestAfter = JSON.parse(
        await readTextFile(config.manifest.path),
      );
      expect(manifestAfter.records).toEqual(manifestBefore.records);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "updates symlink-mode output after manifest source and generated path drift",
    async () => {
      const sharedManifestPath = path.join(tempDir, "manifest.json");
      const sharedAgentsHome = path.join(tempDir, "home", "claude", "agents");
      const oldConfig = makeResolvedConfig(tempDir, {
        claude: {
          agentsHome: sharedAgentsHome,
          installMode: "symlink",
        },
        codex: { enabled: false },
        defaults: { installMode: "symlink" },
        manifest: { path: sharedManifestPath },
      });
      await mkdir(oldConfig.library.skillsDir, { recursive: true });
      await mkdir(oldConfig.library.agentsDir, { recursive: true });
      await createAgentFixture(
        oldConfig.library.agentsDir,
        "a1",
        makeAgentYaml("a1"),
      );

      const opts = { dryRun: false, force: false, strict: false } as const;
      const first = await sync(oldConfig, opts);
      expect(first.errors).toEqual([]);

      const claudeAgentPath = path.join(sharedAgentsHome, "a1.md");
      const oldGeneratedPath = path.join(
        oldConfig.library.generatedDir,
        "claude",
        "agents",
        "a1.md",
      );
      expect(await readlink(claudeAgentPath)).toBe(oldGeneratedPath);

      const movedRoot = path.join(tempDir, "moved-library");
      const newConfig = makeResolvedConfig(tempDir, {
        claude: {
          agentsHome: sharedAgentsHome,
          installMode: "symlink",
        },
        codex: { enabled: false },
        defaults: { installMode: "symlink" },
        library: {
          skillsDir: path.join(movedRoot, "skills"),
          agentsDir: path.join(movedRoot, "agents"),
          generatedDir: path.join(movedRoot, "generated"),
        },
        manifest: { path: sharedManifestPath },
      });
      await mkdir(newConfig.library.skillsDir, { recursive: true });
      await mkdir(newConfig.library.agentsDir, { recursive: true });
      const newAgentPath = await createAgentFixture(
        newConfig.library.agentsDir,
        "a1",
        makeAgentYaml("a1", { instructions: "Updated instructions v2" }),
      );

      const result = await sync(newConfig, opts);

      expect(result.updated).toBe(1);
      expect(result.errors).toEqual([]);
      const newGeneratedPath = path.join(
        newConfig.library.generatedDir,
        "claude",
        "agents",
        "a1.md",
      );
      expect(await readlink(claudeAgentPath)).toBe(newGeneratedPath);
      const manifestAfter = JSON.parse(await readTextFile(sharedManifestPath));
      const updatedRecord = manifestAfter.records.find(
        (record: { installedPath: string }) =>
          record.installedPath === claudeAgentPath,
      );
      expect(updatedRecord.sourcePath).toBe(newAgentPath);
      expect(updatedRecord.generatedPath).toBe(newGeneratedPath);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "skips symlink-mode update when the managed path is a broken symlink to another target",
    async () => {
      const config = makeResolvedConfig(tempDir, {
        claude: { installMode: "symlink" },
        codex: { enabled: false },
        defaults: { installMode: "symlink" },
      });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      const agentPath = await createAgentFixture(
        config.library.agentsDir,
        "a1",
        makeAgentYaml("a1"),
      );

      const opts = { dryRun: false, force: false, strict: false } as const;
      await sync(config, opts);

      const claudeAgentPath = path.join(
        config.targets.claude.agentsHome,
        "a1.md",
      );
      await rm(claudeAgentPath);
      const foreignTarget = path.join(tempDir, "outside", "missing.md");
      await mkdir(path.dirname(foreignTarget), { recursive: true });
      await symlink(foreignTarget, claudeAgentPath, "file");
      const manifestBefore = JSON.parse(
        await readTextFile(config.manifest.path),
      );

      await writeFile(
        agentPath,
        makeAgentYaml("a1", { instructions: "Updated instructions v2" }),
        "utf-8",
      );

      const result = await sync(config, opts);

      expect(result.updated).toBe(0);
      expect(result.errors).toEqual([
        expect.stringContaining("symlink target mismatch"),
      ]);
      expect(await readlink(claudeAgentPath)).toBe(foreignTarget);
      const manifestAfter = JSON.parse(
        await readTextFile(config.manifest.path),
      );
      expect(manifestAfter.records).toEqual(manifestBefore.records);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "skips up-to-date symlink-mode output when the managed path is a broken symlink to another target",
    async () => {
      const config = makeResolvedConfig(tempDir, {
        claude: { installMode: "symlink" },
        codex: { enabled: false },
        defaults: { installMode: "symlink" },
      });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      await createAgentFixture(
        config.library.agentsDir,
        "a1",
        makeAgentYaml("a1"),
      );

      const opts = { dryRun: false, force: false, strict: false } as const;
      await sync(config, opts);

      const claudeAgentPath = path.join(
        config.targets.claude.agentsHome,
        "a1.md",
      );
      await rm(claudeAgentPath);
      const foreignTarget = path.join(tempDir, "outside", "missing.md");
      await mkdir(path.dirname(foreignTarget), { recursive: true });
      await symlink(foreignTarget, claudeAgentPath, "file");
      const manifestBefore = JSON.parse(
        await readTextFile(config.manifest.path),
      );

      const result = await sync(config, opts);

      expect(result.skipped).toBe(0);
      expect(result.errors).toEqual([
        expect.stringContaining("symlink target mismatch"),
      ]);
      expect(await readlink(claudeAgentPath)).toBe(foreignTarget);
      const manifestAfter = JSON.parse(
        await readTextFile(config.manifest.path),
      );
      expect(manifestAfter.records).toEqual(manifestBefore.records);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "skips reinstalling a missing managed output when the target home became a symlink",
    async () => {
      const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      await createAgentFixture(
        config.library.agentsDir,
        "a1",
        makeAgentYaml("a1"),
      );

      const opts = { dryRun: false, force: false, strict: false } as const;
      await sync(config, opts);

      const claudeAgentPath = path.join(
        config.targets.claude.agentsHome,
        "a1.md",
      );
      const manifestBefore = await readTextFile(config.manifest.path);
      await rm(config.targets.claude.agentsHome, { recursive: true });
      const outsideHome = path.join(tempDir, "outside-agents");
      await mkdir(outsideHome, { recursive: true });
      await symlink(outsideHome, config.targets.claude.agentsHome, "dir");

      const result = await sync(config, opts);

      expect(result.installed).toBe(0);
      expect(result.errors).toEqual([
        expect.stringContaining("configured claude agent home is a symlink"),
      ]);
      expect(await pathExists(claudeAgentPath)).toBe(false);
      expect(await pathExists(path.join(outsideHome, "a1.md"))).toBe(false);
      expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
    },
  );

  it("skips stale copy removal when installed content no longer matches the manifest", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    const agentPath = await createAgentFixture(
      config.library.agentsDir,
      "stale",
      makeAgentYaml("stale"),
    );

    const opts = { dryRun: false, force: false, strict: false } as const;
    await sync(config, opts);

    const claudeAgentPath = path.join(
      config.targets.claude.agentsHome,
      "stale.md",
    );
    await writeFile(claudeAgentPath, "tampered stale content", "utf-8");
    const manifestBefore = JSON.parse(await readTextFile(config.manifest.path));
    await rm(agentPath);

    const result = await sync(config, opts);

    expect(result.removed).toBe(0);
    expect(result.errors).toEqual([
      expect.stringContaining("installed copy content hash mismatch"),
    ]);
    expect(await readTextFile(claudeAgentPath)).toBe("tampered stale content");
    const manifestAfter = JSON.parse(await readTextFile(config.manifest.path));
    expect(manifestAfter.records).toEqual(manifestBefore.records);
  });

  it.skipIf(!fifoAvailable)(
    "skips stale copy removal when an installed copied skill contains an unsupported entry",
    async () => {
      const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      const skillDir = await createSkillFixture(
        config.library.skillsDir,
        "stale-skill",
        "---\nname: stale-skill\ndescription: A skill.\n---\n\n# Stale Skill\n",
        ["scripts"],
      );

      const opts = { dryRun: false, force: false, strict: false } as const;
      await sync(config, opts);

      const installedSkillPath = path.join(
        config.targets.claude.skillsHome,
        "stale-skill",
      );
      const fifoPath = path.join(installedSkillPath, "scripts", "probe.fifo");
      await execFileAsync("mkfifo", [fifoPath]);
      const manifestBefore = JSON.parse(
        await readTextFile(config.manifest.path),
      );
      await rm(skillDir, { recursive: true });

      const result = await sync(config, opts);

      expect(result.removed).toBe(0);
      expect(result.errors).toEqual([
        expect.stringContaining("installed skill contains unsupported entry"),
      ]);
      expect((await lstat(fifoPath)).isFIFO()).toBe(true);
      const manifestAfter = JSON.parse(
        await readTextFile(config.manifest.path),
      );
      expect(manifestAfter.records).toEqual(manifestBefore.records);
    },
  );

  it.skipIf(!fifoAvailable)(
    "skips stale copy removal when an installed copied skill SKILL.md is unsupported",
    async () => {
      const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      const skillDir = await createSkillFixture(
        config.library.skillsDir,
        "stale-skill",
        "---\nname: stale-skill\ndescription: A skill.\n---\n\n# Stale Skill\n",
      );

      const opts = { dryRun: false, force: false, strict: false } as const;
      await sync(config, opts);

      const installedSkillPath = path.join(
        config.targets.claude.skillsHome,
        "stale-skill",
      );
      const skillMdPath = path.join(installedSkillPath, "SKILL.md");
      await rm(skillMdPath);
      await execFileAsync("mkfifo", [skillMdPath]);
      const manifestBefore = JSON.parse(
        await readTextFile(config.manifest.path),
      );
      await rm(skillDir, { recursive: true });

      const result = await sync(config, opts);

      expect(result.removed).toBe(0);
      expect(result.errors).toEqual([
        expect.stringContaining("installed skill SKILL.md is not a file"),
      ]);
      expect((await lstat(skillMdPath)).isFIFO()).toBe(true);
      const manifestAfter = JSON.parse(
        await readTextFile(config.manifest.path),
      );
      expect(manifestAfter.records).toEqual(manifestBefore.records);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "skips stale symlink removal when the installed symlink points elsewhere",
    async () => {
      const config = makeResolvedConfig(tempDir, {
        claude: { installMode: "symlink" },
        codex: { enabled: false },
        defaults: { installMode: "symlink" },
      });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      const agentPath = await createAgentFixture(
        config.library.agentsDir,
        "stale",
        makeAgentYaml("stale"),
      );

      const opts = { dryRun: false, force: false, strict: false } as const;
      await sync(config, opts);

      const claudeAgentPath = path.join(
        config.targets.claude.agentsHome,
        "stale.md",
      );
      await rm(claudeAgentPath);
      const foreignTarget = path.join(tempDir, "outside", "foreign.md");
      await mkdir(path.dirname(foreignTarget), { recursive: true });
      await writeFile(foreignTarget, "foreign", "utf-8");
      await symlink(foreignTarget, claudeAgentPath, "file");
      const manifestBefore = JSON.parse(
        await readTextFile(config.manifest.path),
      );
      await rm(agentPath);

      const result = await sync(config, opts);

      expect(result.removed).toBe(0);
      expect(result.errors).toEqual([
        expect.stringContaining("symlink target mismatch"),
      ]);
      expect(await readlink(claudeAgentPath)).toBe(foreignTarget);
      const manifestAfter = JSON.parse(
        await readTextFile(config.manifest.path),
      );
      expect(manifestAfter.records).toEqual(manifestBefore.records);
    },
  );

  it("updates managed output after manifest source and generated path drift", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    const agentPath = await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    const opts = { dryRun: false, force: false, strict: false } as const;
    await sync(config, opts);
    const manifest = JSON.parse(await readTextFile(config.manifest.path));
    const claudeRecord = manifest.records.find(
      (record: { installedPath: string }) =>
        record.installedPath ===
        path.join(config.targets.claude.agentsHome, "a1.md"),
    );
    claudeRecord.sourcePath = path.join(
      tempDir,
      "old-library",
      "agents",
      "a1.yaml",
    );
    claudeRecord.generatedPath = path.join(
      tempDir,
      "old-library",
      "generated",
      "claude",
      "agents",
      "a1.md",
    );
    await writeFile(
      config.manifest.path,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf-8",
    );

    await writeFile(
      agentPath,
      makeAgentYaml("a1", { instructions: "Updated instructions v2" }),
      "utf-8",
    );

    const result = await sync(config, opts);

    expect(result.updated).toBe(1);
    expect(result.errors).toEqual([]);
    const manifestAfter = JSON.parse(await readTextFile(config.manifest.path));
    const updatedRecord = manifestAfter.records.find(
      (record: { installedPath: string }) =>
        record.installedPath ===
        path.join(config.targets.claude.agentsHome, "a1.md"),
    );
    expect(updatedRecord.sourcePath).toBe(agentPath);
    expect(updatedRecord.generatedPath).toBe(
      path.join(config.library.generatedDir, "claude", "agents", "a1.md"),
    );
  });

  it("skips stale removal when the manifest installed path is outside the target home", async () => {
    const config = makeResolvedConfig(tempDir);
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    const outsidePath = path.join(tempDir, "outside", "sentinel.md");
    await mkdir(path.dirname(outsidePath), { recursive: true });
    await writeFile(outsidePath, "sentinel", "utf-8");
    await writeFile(
      config.manifest.path,
      makeManifestJson([
        {
          target: "claude",
          type: "agent",
          sourcePath: path.join(config.library.agentsDir, "sentinel.yaml"),
          generatedPath: path.join(
            config.library.generatedDir,
            "claude",
            "agents",
            "sentinel.md",
          ),
          installedPath: outsidePath,
          installMode: "copy",
          contentHash: "wrong-hash",
          timestamp: new Date().toISOString(),
        },
      ]),
      "utf-8",
    );
    const manifestBefore = JSON.parse(await readTextFile(config.manifest.path));

    await expect(
      sync(config, { dryRun: false, force: false, strict: false }),
    ).rejects.toThrow("Manifest boundary mismatch");
    expect(await readTextFile(outsidePath)).toBe("sentinel");
    const manifestAfter = JSON.parse(await readTextFile(config.manifest.path));
    expect(manifestAfter.records).toEqual(manifestBefore.records);
  });

  it.skipIf(!symlinkAvailable)(
    "skips stale removal when an installed path crosses a symlinked parent",
    async () => {
      const config = makeResolvedConfig(tempDir);
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      const outsideDir = path.join(tempDir, "outside");
      const linkParent = path.join(config.targets.claude.agentsHome, "alias");
      const installedPath = path.join(linkParent, "sentinel.md");
      await mkdir(config.targets.claude.agentsHome, { recursive: true });
      await mkdir(outsideDir, { recursive: true });
      await symlink(outsideDir, linkParent, "dir");
      await writeFile(
        path.join(outsideDir, "sentinel.md"),
        "sentinel",
        "utf-8",
      );
      await writeFile(
        config.manifest.path,
        makeManifestJson([
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "sentinel.yaml"),
            generatedPath: path.join(
              config.library.generatedDir,
              "claude",
              "agents",
              "sentinel.md",
            ),
            installedPath,
            installMode: "copy",
            contentHash: "wrong-hash",
            timestamp: new Date().toISOString(),
          },
        ]),
        "utf-8",
      );
      const manifestBefore = JSON.parse(
        await readTextFile(config.manifest.path),
      );

      await expect(
        sync(config, { dryRun: false, force: false, strict: false }),
      ).rejects.toThrow("Manifest boundary mismatch");
      expect(await readTextFile(path.join(outsideDir, "sentinel.md"))).toBe(
        "sentinel",
      );
      const manifestAfter = JSON.parse(
        await readTextFile(config.manifest.path),
      );
      expect(manifestAfter.records).toEqual(manifestBefore.records);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "skips stale removal when the configured target home is a symlink",
    async () => {
      const realHome = path.join(tempDir, "outside-home");
      const linkedHome = path.join(tempDir, "linked-home");
      const config = makeResolvedConfig(tempDir, {
        claude: { agentsHome: linkedHome },
      });
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await mkdir(realHome, { recursive: true });
      await symlink(realHome, linkedHome, "dir");
      const installedPath = path.join(linkedHome, "sentinel.md");
      const realInstalledPath = path.join(realHome, "sentinel.md");
      await writeFile(realInstalledPath, "sentinel", "utf-8");
      await writeFile(
        config.manifest.path,
        makeManifestJson([
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "sentinel.yaml"),
            generatedPath: path.join(
              config.library.generatedDir,
              "claude",
              "agents",
              "sentinel.md",
            ),
            installedPath,
            installMode: "copy",
            contentHash: "wrong-hash",
            timestamp: new Date().toISOString(),
          },
        ]),
        "utf-8",
      );
      const manifestBefore = JSON.parse(
        await readTextFile(config.manifest.path),
      );

      await expect(
        sync(config, { dryRun: false, force: false, strict: false }),
      ).rejects.toThrow("Manifest boundary mismatch");
      expect(await readTextFile(realInstalledPath)).toBe("sentinel");
      const manifestAfter = JSON.parse(
        await readTextFile(config.manifest.path),
      );
      expect(manifestAfter.records).toEqual(manifestBefore.records);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "skips stale removal when the configured target home crosses a symlinked ancestor",
    async () => {
      const realParent = path.join(tempDir, "outside-parent");
      const linkedParent = path.join(tempDir, "linked-parent");
      const agentsHome = path.join(linkedParent, "agents");
      const config = makeResolvedConfig(tempDir, {
        claude: { agentsHome },
      });
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await mkdir(path.join(realParent, "agents"), { recursive: true });
      await symlink(realParent, linkedParent, "dir");
      const installedPath = path.join(agentsHome, "sentinel.md");
      const realInstalledPath = path.join(realParent, "agents", "sentinel.md");
      await writeFile(realInstalledPath, "sentinel", "utf-8");
      await writeFile(
        config.manifest.path,
        makeManifestJson([
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "sentinel.yaml"),
            generatedPath: path.join(
              config.library.generatedDir,
              "claude",
              "agents",
              "sentinel.md",
            ),
            installedPath,
            installMode: "copy",
            contentHash: "wrong-hash",
            timestamp: new Date().toISOString(),
          },
        ]),
        "utf-8",
      );
      const manifestBefore = JSON.parse(
        await readTextFile(config.manifest.path),
      );

      await expect(
        sync(config, { dryRun: false, force: false, strict: false }),
      ).rejects.toThrow("Manifest boundary mismatch");
      expect(await readTextFile(realInstalledPath)).toBe("sentinel");
      const manifestAfter = JSON.parse(
        await readTextFile(config.manifest.path),
      );
      expect(manifestAfter.records).toEqual(manifestBefore.records);
    },
  );

  it("target filter installs only for the specified target", async () => {
    const config = makeResolvedConfig(tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, "s1");
    await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    const result = await sync(config, {
      target: "claude",
      dryRun: false,
      force: false,
      strict: false,
    });

    expect(result.installed).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);

    // Claude agent should exist
    const claudeAgentPath = path.join(
      config.targets.claude.agentsHome,
      "a1.md",
    );
    expect(await pathExists(claudeAgentPath)).toBe(true);

    // Codex agent should NOT exist
    const codexAgentPath = path.join(
      config.targets.codex.agentsHome,
      "a1.toml",
    );
    expect(await pathExists(codexAgentPath)).toBe(false);
  });

  it.skipIf(!symlinkAvailable)(
    "symlink mode creates symlinks for installed outputs",
    async () => {
      const config = makeResolvedConfig(tempDir);
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      await createSkillFixture(config.library.skillsDir, "s1");
      await createAgentFixture(
        config.library.agentsDir,
        "a1",
        makeAgentYaml("a1"),
      );

      const result = await sync(config, {
        mode: "symlink",
        dryRun: false,
        force: false,
        strict: false,
      });

      expect(result.installed).toBeGreaterThan(0);
      expect(result.errors).toEqual([]);

      // Agent installed path should be a symlink
      const claudeAgentPath = path.join(
        config.targets.claude.agentsHome,
        "a1.md",
      );
      const agentStat = await lstat(claudeAgentPath);
      expect(agentStat.isSymbolicLink()).toBe(true);

      // Skill installed path should be a symlink
      const claudeSkillPath = path.join(config.targets.claude.skillsHome, "s1");
      const skillStat = await lstat(claudeSkillPath);
      expect(skillStat.isSymbolicLink()).toBe(true);
    },
  );

  it("windows symlink fallback copies when symlinks fail", async () => {
    symlinkFailure.enabled = true;

    const config = makeResolvedConfig(tempDir, {
      claude: { installMode: "symlink" },
      codex: { enabled: false },
      platform: { windowsSymlinkFallback: "copy" },
    });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
    });

    expect(result.installed).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);

    // Files should exist (installed via copy fallback) but not be symlinks
    const claudeAgentPath = path.join(
      config.targets.claude.agentsHome,
      "a1.md",
    );
    expect(await pathExists(claudeAgentPath)).toBe(true);
    const stat = await lstat(claudeAgentPath);
    expect(stat.isSymbolicLink()).toBe(false);

    const manifest = JSON.parse(await readTextFile(config.manifest.path));
    const claudeAgentRecord = manifest.records.find(
      (record: { installedPath: string }) =>
        record.installedPath === claudeAgentPath,
    );
    expect(claudeAgentRecord.installMode).toBe("copy");

    await writeFile(
      path.join(config.library.agentsDir, "a1.yaml"),
      makeAgentYaml("a1", { instructions: "Updated instructions v2" }),
      "utf-8",
    );

    const second = await sync(config, {
      target: "claude",
      dryRun: false,
      force: false,
      strict: false,
    });

    expect(second.updated).toBe(1);
    expect(second.errors).toEqual([]);
    expect(await readTextFile(claudeAgentPath)).toContain(
      "Updated instructions v2",
    );
    let manifestAfter = JSON.parse(await readTextFile(config.manifest.path));
    const updatedRecord = manifestAfter.records.find(
      (record: { installedPath: string }) =>
        record.installedPath === claudeAgentPath,
    );
    expect(updatedRecord.installMode).toBe("copy");

    await writeFile(claudeAgentPath, "tampered fallback copy", "utf-8");
    symlinkFailure.enabled = false;
    const manifestBeforeTamperedUpdate = JSON.parse(
      await readTextFile(config.manifest.path),
    );
    await writeFile(
      path.join(config.library.agentsDir, "a1.yaml"),
      makeAgentYaml("a1", { instructions: "Updated instructions v3" }),
      "utf-8",
    );

    const third = await sync(config, {
      target: "claude",
      dryRun: false,
      force: false,
      strict: false,
    });

    expect(third.updated).toBe(0);
    expect(third.errors).toEqual([
      expect.stringContaining("installed copy content hash mismatch"),
    ]);
    expect(await readTextFile(claudeAgentPath)).toBe("tampered fallback copy");
    manifestAfter = JSON.parse(await readTextFile(config.manifest.path));
    expect(manifestAfter.records).toEqual(manifestBeforeTamperedUpdate.records);

    const uninstallResult = await uninstall(config, {
      target: "claude",
      dryRun: false,
    });

    expect(uninstallResult.removed).toBe(0);
    expect(uninstallResult.errors).toEqual([
      expect.stringContaining("installed copy content hash mismatch"),
    ]);
    expect(await readTextFile(claudeAgentPath)).toBe("tampered fallback copy");
  });

  it("collects errors without throwing when an action fails", async () => {
    const config = makeResolvedConfig(tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, "s1");
    await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    // Make the claude agents home a file instead of a directory so mkdir fails
    await mkdir(path.dirname(config.targets.claude.agentsHome), {
      recursive: true,
    });
    await writeFile(config.targets.claude.agentsHome, "blocker", "utf-8");

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
    });

    expect(result.errors.length).toBeGreaterThan(0);
  });
});
