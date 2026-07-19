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
import { UserError } from "../utils/errors.js";
import { pathExists, readTextFile } from "../utils/fs.js";
import {
  inspectManifest,
  recoverInvalidManifest,
  withManifestPersistenceFaultsForTesting,
} from "./manifest.js";
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

  it("keeps invalid dry sync observationally pure and explicitly recovers a real sync", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    const invalidBytes = "{corrupt manifest";
    const agentName = "renderable";
    const generatedSentinel = path.join(
      config.library.generatedDir,
      "claude",
      "agents",
      `${agentName}.md`,
    );
    await createAgentFixture(
      config.library.agentsDir,
      agentName,
      makeAgentYaml(agentName),
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(path.dirname(generatedSentinel), { recursive: true });
    await writeFile(config.manifest.path, invalidBytes, "utf-8");
    await writeFile(generatedSentinel, "generated sentinel", "utf-8");

    let dryError: unknown;
    try {
      await sync(config, { dryRun: true, force: false, strict: false });
    } catch (error) {
      dryError = error;
    }
    expect(dryError).toBeInstanceOf(UserError);
    expect((dryError as Error).message).toContain(
      "Manifest is invalid: corrupt JSON",
    );
    expect((dryError as UserError).hint).toContain("non-dry sync");
    expect(await readTextFile(config.manifest.path)).toBe(invalidBytes);
    expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
    expect(
      (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
        entry.startsWith(path.basename(config.manifest.path)),
      ),
    ).toEqual([path.basename(config.manifest.path)]);

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
    });

    expect(result.errors).toEqual([]);
    expect(await readTextFile(`${config.manifest.path}.bak`)).toBe(
      invalidBytes,
    );
    expect(testLogger.warnings.join("\n")).toContain(
      `${config.manifest.path}.bak`,
    );
    expect(testLogger.warnings).toEqual([
      `Recovered invalid manifest to verified backup ${config.manifest.path}.bak.`,
    ]);
    expect(
      JSON.parse(await readTextFile(config.manifest.path)).boundary,
    ).toBeDefined();
  });

  it("treats a residual lock as invalid during dry sync without rendering or recovery", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    const lockPath = `${config.manifest.path}.lock`;
    const agentName = "renderable";
    const generatedSentinel = path.join(
      config.library.generatedDir,
      "claude",
      "agents",
      `${agentName}.md`,
    );
    await createAgentFixture(
      config.library.agentsDir,
      agentName,
      makeAgentYaml(agentName),
    );
    await mkdir(path.dirname(lockPath), { recursive: true });
    await mkdir(path.dirname(generatedSentinel), { recursive: true });
    await writeFile(lockPath, "residual lock", "utf-8");
    await writeFile(generatedSentinel, "generated sentinel", "utf-8");

    let dryError: unknown;
    try {
      await sync(config, { dryRun: true, force: false, strict: false });
    } catch (error) {
      dryError = error;
    }
    expect(dryError).toBeInstanceOf(UserError);
    expect((dryError as Error).message).toContain(lockPath);
    expect((dryError as UserError).hint).toContain("manually");
    expect((dryError as UserError).hint).not.toContain("non-dry sync");

    expect(await pathExists(config.manifest.path)).toBe(false);
    expect(await readTextFile(lockPath)).toBe("residual lock");
    expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
    expect(testLogger.infos).toEqual([]);
    expect(testLogger.warnings).toEqual([]);
  });

  it("gives unsafe manifest sources manual dry-run guidance without attempting recovery", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    const agentName = "renderable";
    const generatedSentinel = path.join(
      config.library.generatedDir,
      "claude",
      "agents",
      `${agentName}.md`,
    );
    await createAgentFixture(
      config.library.agentsDir,
      agentName,
      makeAgentYaml(agentName),
    );
    await mkdir(config.manifest.path, { recursive: true });
    await mkdir(path.dirname(generatedSentinel), { recursive: true });
    await writeFile(generatedSentinel, "generated sentinel", "utf-8");

    let dryError: unknown;
    try {
      await sync(config, { dryRun: true, force: false, strict: false });
    } catch (error) {
      dryError = error;
    }

    expect(dryError).toBeInstanceOf(UserError);
    expect((dryError as Error).message).toContain(config.manifest.path);
    expect((dryError as Error).message).toContain("unavailable or unsafe");
    expect((dryError as UserError).hint).toContain("regular file");
    expect((dryError as UserError).hint).not.toContain("non-dry sync");
    expect((await lstat(config.manifest.path)).isDirectory()).toBe(true);
    expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
    expect(await pathExists(`${config.manifest.path}.bak`)).toBe(false);
    expect(await pathExists(`${config.manifest.path}.lock`)).toBe(false);
    expect(testLogger.infos).toEqual([]);
    expect(testLogger.warnings).toEqual([]);
  });

  it("continues from the exact collision-allocated invalid recovery backup", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    const invalidBytes = '{"version":1}';
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(config.manifest.path, invalidBytes, "utf-8");
    await writeFile(`${config.manifest.path}.bak`, "occupied backup", "utf-8");

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
    });

    expect(result.errors).toEqual([]);
    expect(await readTextFile(`${config.manifest.path}.bak`)).toBe(
      "occupied backup",
    );
    expect(await readTextFile(`${config.manifest.path}.bak-1`)).toBe(
      invalidBytes,
    );
    expect(testLogger.warnings.join("\n")).toContain(
      `${config.manifest.path}.bak-1`,
    );
  });

  it.each([
    ["source-changed", "recovery-after-candidate"],
    ["source-unavailable-or-unsafe", "recovery-before-candidate"],
    ["backup-create-or-verify-failed", "recovery-candidate-write"],
    ["source-retirement-failed", "recovery-retirement"],
  ] as const)(
    "stops a real invalid sync on pre-I5 %s without later effects",
    async (category, faultStage) => {
      const scenarioDir = path.join(tempDir, category);
      const config = makeResolvedConfig(scenarioDir, {
        codex: { enabled: false },
      });
      const invalidBytes = `{corrupt ${category}`;
      const agentName = "renderable";
      const generatedSentinel = path.join(
        config.library.generatedDir,
        "claude",
        "agents",
        `${agentName}.md`,
      );
      await createAgentFixture(
        config.library.agentsDir,
        agentName,
        makeAgentYaml(agentName),
      );
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await mkdir(path.dirname(generatedSentinel), { recursive: true });
      await writeFile(config.manifest.path, invalidBytes, "utf-8");
      await writeFile(generatedSentinel, "generated sentinel", "utf-8");

      await expect(
        withManifestPersistenceFaultsForTesting(
          async (stage) => {
            if (stage !== faultStage) return;
            if (category === "source-changed") {
              await writeFile(config.manifest.path, "{replacement", "utf-8");
              return;
            }
            if (category === "source-unavailable-or-unsafe") {
              await rm(config.manifest.path);
              await mkdir(config.manifest.path);
              return;
            }
            throw new Error(`injected ${category}`);
          },
          () => sync(config, { dryRun: false, force: false, strict: false }),
        ),
      ).rejects.toThrow(category);

      expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
      expect(testLogger.infos).toEqual([]);
      expect(testLogger.warnings).toEqual([]);
      expect(await pathExists(`${config.manifest.path}.lock`)).toBe(false);
    },
  );

  it("preserves lock-unavailable as the primary pre-I5 sync failure", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    const invalidBytes = "{corrupt lock contention";
    const lockPath = `${config.manifest.path}.lock`;
    const agentName = "renderable";
    const generatedSentinel = path.join(
      config.library.generatedDir,
      "claude",
      "agents",
      `${agentName}.md`,
    );
    await createAgentFixture(
      config.library.agentsDir,
      agentName,
      makeAgentYaml(agentName),
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(path.dirname(generatedSentinel), { recursive: true });
    await writeFile(config.manifest.path, invalidBytes, "utf-8");
    await writeFile(lockPath, "other writer", "utf-8");
    await writeFile(generatedSentinel, "generated sentinel", "utf-8");

    let thrown: unknown;
    try {
      await sync(config, { dryRun: false, force: false, strict: false });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      message: expect.stringContaining("lock-unavailable"),
      hint: `Confirm no DevCanon manifest operation is active, then manually correct the pre-existing sibling lock at ${lockPath}.`,
    });
    expect((thrown as UserError).hint).not.toContain(".bak");

    expect(await readTextFile(config.manifest.path)).toBe(invalidBytes);
    expect(await readTextFile(lockPath)).toBe("other writer");
    expect(await pathExists(`${config.manifest.path}.bak`)).toBe(false);
    expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
    expect(testLogger.infos).toEqual([]);
    expect(testLogger.warnings).toEqual([]);
  });

  it.each(["EACCES", "EROFS", "ENOSPC", "EMFILE"] as const)(
    "reports an injected %s recovery lock failure without lock-removal guidance",
    async (code) => {
      const scenarioDir = path.join(tempDir, `sync-lock-${code}`);
      const config = makeResolvedConfig(scenarioDir, {
        codex: { enabled: false },
      });
      const primary = Object.assign(new Error(`injected ${code}`), { code });
      const generatedSentinel = path.join(
        config.library.generatedDir,
        "claude",
        "agents",
        "sentinel.md",
      );
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await mkdir(path.dirname(generatedSentinel), { recursive: true });
      await writeFile(config.manifest.path, "{corrupt", "utf-8");
      await writeFile(generatedSentinel, "generated sentinel", "utf-8");

      let thrown: unknown;
      try {
        await withManifestPersistenceFaultsForTesting(
          (stage) => {
            if (stage === ("recovery-lock-open" as typeof stage)) {
              throw primary;
            }
          },
          () => sync(config, { dryRun: false, force: false, strict: false }),
        );
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toMatchObject({
        message: expect.stringContaining("lock-unavailable"),
        cause: primary,
        hint: "Resolve the reported manifest state before retrying sync.",
      });
      expect((thrown as UserError).hint).not.toContain("manually");
      expect(await readTextFile(config.manifest.path)).toBe("{corrupt");
      expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
      expect(await pathExists(`${config.manifest.path}.bak`)).toBe(false);
      expect(await pathExists(`${config.manifest.path}.lock`)).toBe(false);
      expect(testLogger.infos).toEqual([]);
      expect(testLogger.warnings).toEqual([]);
    },
  );

  it("reports an injected pre-open EEXIST recovery lock failure without lock-removal guidance", async () => {
    const scenarioDir = path.join(tempDir, "sync-lock-EEXIST");
    const config = makeResolvedConfig(scenarioDir, {
      codex: { enabled: false },
    });
    const primary = Object.assign(new Error("injected EEXIST"), {
      code: "EEXIST",
    });
    const generatedSentinel = path.join(
      config.library.generatedDir,
      "claude",
      "agents",
      "sentinel.md",
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(path.dirname(generatedSentinel), { recursive: true });
    await writeFile(config.manifest.path, "{corrupt", "utf-8");
    await writeFile(generatedSentinel, "generated sentinel", "utf-8");

    let thrown: unknown;
    try {
      await withManifestPersistenceFaultsForTesting(
        (stage) => {
          if (stage === ("recovery-lock-open" as typeof stage)) {
            throw primary;
          }
        },
        () => sync(config, { dryRun: false, force: false, strict: false }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      message: expect.stringContaining("lock-unavailable"),
      cause: primary,
      hint: "Resolve the reported manifest state before retrying sync.",
    });
    expect((thrown as UserError).hint).not.toContain("manually");
    expect(await readTextFile(config.manifest.path)).toBe("{corrupt");
    expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
    expect(await pathExists(`${config.manifest.path}.bak`)).toBe(false);
    expect(await pathExists(`${config.manifest.path}.lock`)).toBe(false);
    expect((await readdir(path.dirname(config.manifest.path))).sort()).toEqual([
      "generated",
      "manifest.json",
    ]);
    expect(testLogger.infos).toEqual([]);
    expect(testLogger.warnings).toEqual([]);
  });

  it("does not replay a genuine contention cause as pre-existing sync custody", async () => {
    const contentionPath = path.join(tempDir, "genuine-sync-contention.json");
    await writeFile(contentionPath, "{corrupt", "utf-8");
    const contentionInspection = await inspectManifest(contentionPath);
    await writeFile(`${contentionPath}.lock`, "active", "utf-8");
    const contention = await recoverInvalidManifest(contentionInspection);
    if (contention.completed) throw new Error("expected contention result");
    const replayedCause = contention.cause;
    expect((replayedCause as NodeJS.ErrnoException).code).toBe("EEXIST");

    const scenarioDir = path.join(tempDir, "sync-replayed-EEXIST");
    const config = makeResolvedConfig(scenarioDir, {
      codex: { enabled: false },
    });
    const generatedSentinel = path.join(
      config.library.generatedDir,
      "claude",
      "agents",
      "sentinel.md",
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(path.dirname(generatedSentinel), { recursive: true });
    await writeFile(config.manifest.path, "{corrupt", "utf-8");
    await writeFile(generatedSentinel, "generated sentinel", "utf-8");

    let thrown: unknown;
    try {
      await withManifestPersistenceFaultsForTesting(
        (stage) => {
          if (stage === ("recovery-lock-open" as typeof stage)) {
            throw replayedCause;
          }
        },
        () => sync(config, { dryRun: false, force: false, strict: false }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      message: expect.stringContaining("lock-unavailable"),
      cause: replayedCause,
      hint: "Resolve the reported manifest state before retrying sync.",
    });
    expect((thrown as Error & { cause?: unknown }).cause).toBe(replayedCause);
    expect((thrown as UserError).hint).not.toContain("manually");
    expect(await readTextFile(config.manifest.path)).toBe("{corrupt");
    expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
    expect(await pathExists(`${config.manifest.path}.bak`)).toBe(false);
    expect(await pathExists(`${config.manifest.path}.lock`)).toBe(false);
    expect((await readdir(path.dirname(config.manifest.path))).sort()).toEqual([
      "generated",
      "manifest.json",
    ]);
    expect(testLogger.infos).toEqual([]);
    expect(testLogger.warnings).toEqual([]);
  });

  it("reports the exact retained unverifiable candidate before any sync effect", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    const invalidBytes = "{corrupt pre-stat candidate";
    const candidatePath = `${config.manifest.path}.bak`;
    const primary = new Error("candidate stat fault");
    const agentName = "renderable";
    const generatedSentinel = path.join(
      config.library.generatedDir,
      "claude",
      "agents",
      `${agentName}.md`,
    );
    await createAgentFixture(
      config.library.agentsDir,
      agentName,
      makeAgentYaml(agentName),
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(path.dirname(generatedSentinel), { recursive: true });
    await writeFile(config.manifest.path, invalidBytes, "utf-8");
    await writeFile(generatedSentinel, "generated sentinel", "utf-8");

    let thrown: unknown;
    try {
      await withManifestPersistenceFaultsForTesting(
        (stage) => {
          if (stage === "recovery-candidate-stat") throw primary;
        },
        () => sync(config, { dryRun: false, force: false, strict: false }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      message: expect.stringContaining("backup-create-or-verify-failed"),
      cause: primary,
      hint: `Inspect and preserve the unverifiable recovery candidate at ${candidatePath}; do not remove it by pathname alone.`,
    });
    expect((thrown as Error).message).toContain(primary.message);
    expect((thrown as Error & { cause?: unknown }).cause).toBe(primary);
    expect(await readTextFile(config.manifest.path)).toBe(invalidBytes);
    expect(await readTextFile(candidatePath)).toBe("");
    expect(await pathExists(`${config.manifest.path}.lock`)).toBe(false);
    expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
    expect(testLogger.infos).toEqual([]);
    expect(testLogger.warnings).toEqual([]);
    expect((await readdir(path.dirname(config.manifest.path))).sort()).toEqual(
      [
        "agents",
        "generated",
        path.basename(config.manifest.path),
        path.basename(candidatePath),
      ].sort(),
    );
  });

  it("reports an exact candidate replacement without claiming recovery ownership", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    const invalidBytes = "{corrupt candidate replacement";
    const candidatePath = `${config.manifest.path}.bak`;
    const replacementBytes = "unmanaged replacement";
    const agentName = "renderable";
    const generatedSentinel = path.join(
      config.library.generatedDir,
      "claude",
      "agents",
      `${agentName}.md`,
    );
    await createAgentFixture(
      config.library.agentsDir,
      agentName,
      makeAgentYaml(agentName),
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(path.dirname(generatedSentinel), { recursive: true });
    await writeFile(config.manifest.path, invalidBytes, "utf-8");
    await writeFile(generatedSentinel, "generated sentinel", "utf-8");

    let thrown: unknown;
    try {
      await withManifestPersistenceFaultsForTesting(
        async (stage) => {
          if (stage !== "recovery-after-candidate") return;
          await rm(candidatePath);
          await writeFile(candidatePath, replacementBytes, "utf-8");
        },
        () => sync(config, { dryRun: false, force: false, strict: false }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      message: expect.stringContaining("backup-create-or-verify-failed"),
      hint: `Preserve and inspect the unmanaged replacement at ${candidatePath}; it is not owned by recovery and must not be auto-deleted.`,
    });
    expect((thrown as Error & { hint?: string }).hint).not.toContain(
      "owned recovery candidate",
    );
    expect(await readTextFile(config.manifest.path)).toBe(invalidBytes);
    expect(await readTextFile(candidatePath)).toBe(replacementBytes);
    expect(await pathExists(`${config.manifest.path}.lock`)).toBe(false);
    expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
    expect(testLogger.infos).toEqual([]);
    expect(testLogger.warnings).toEqual([]);
  });

  it("does not mask a primary pre-I5 category with cleanup degradation", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    const invalidBytes = "{corrupt combined failure";
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(config.manifest.path, invalidBytes, "utf-8");

    let thrown: unknown;
    try {
      await withManifestPersistenceFaultsForTesting(
        (stage) => {
          if (stage === "recovery-candidate-write") {
            throw new Error("primary candidate write failure");
          }
        },
        () => sync(config, { dryRun: false, force: false, strict: false }),
        {
          injectPostAttemptOutcome: ({ operation }) =>
            operation === "recovery-lock-close"
              ? new Error("secondary close degradation")
              : undefined,
        },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      message: expect.stringContaining("backup-create-or-verify-failed"),
      cause: new Error("primary candidate write failure"),
      hint: "Resolve the reported manifest state before retrying sync.",
    });
    expect((thrown as Error).message).toContain("close-degraded");
    expect((thrown as UserError).hint).not.toContain(config.manifest.path);
    expect(await readTextFile(config.manifest.path)).toBe(invalidBytes);
    expect(await pathExists(`${config.manifest.path}.bak`)).toBe(false);
    expect(await pathExists(`${config.manifest.path}.lock`)).toBe(false);
    expect(testLogger.infos).toEqual([]);
    expect(testLogger.warnings).toEqual([]);
  });

  it.each([
    [true, false, "close-degraded"],
    [false, true, "unlink-degraded"],
    [true, true, "both-degraded"],
  ] as const)(
    "stops after committed recovery with %s/%s cleanup as %s",
    async (failClose, failUnlink, cleanup) => {
      const scenarioDir = path.join(tempDir, cleanup);
      const config = makeResolvedConfig(scenarioDir, {
        codex: { enabled: false },
      });
      const invalidBytes = `{corrupt ${cleanup}`;
      const agentName = "renderable";
      const generatedSentinel = path.join(
        config.library.generatedDir,
        "claude",
        "agents",
        `${agentName}.md`,
      );
      await createAgentFixture(
        config.library.agentsDir,
        agentName,
        makeAgentYaml(agentName),
      );
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await mkdir(path.dirname(generatedSentinel), { recursive: true });
      await writeFile(config.manifest.path, invalidBytes, "utf-8");
      await writeFile(generatedSentinel, "generated sentinel", "utf-8");

      await expect(
        withManifestPersistenceFaultsForTesting(
          () => {},
          () => sync(config, { dryRun: false, force: false, strict: false }),
          {
            injectPostAttemptOutcome: ({ operation }) => {
              if (failClose && operation === "recovery-lock-close") {
                return new Error("injected close degradation");
              }
              if (failUnlink && operation === "recovery-lock-unlink") {
                return new Error("injected unlink degradation");
              }
              return undefined;
            },
          },
        ),
      ).rejects.toThrow(cleanup);

      expect(await pathExists(config.manifest.path)).toBe(false);
      expect(await readTextFile(`${config.manifest.path}.bak`)).toBe(
        invalidBytes,
      );
      expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
      expect(testLogger.warnings.join("\n")).toContain(
        `${config.manifest.path}.bak`,
      );
      expect(testLogger.warnings).toEqual([
        `Manifest recovery committed to verified backup ${config.manifest.path}.bak, but cleanup degraded (${cleanup}).`,
      ]);
      expect(testLogger.warnings.join("\n")).not.toContain(
        "Recovered invalid manifest to verified backup",
      );
      // The deterministic post-attempt seam reports degraded cleanup after
      // the literal unlink effect, so its exact lock state is absent.
      expect(await pathExists(`${config.manifest.path}.lock`)).toBe(false);
    },
  );

  it.each(["skill-ancestor", "agent-ancestor"] as const)(
    "rejects selected-selected component overlap with %s before writes",
    async (direction) => {
      const scenarioDir = path.join(tempDir, direction);
      const root = path.join(scenarioDir, "managed");
      const skillsHome =
        direction === "skill-ancestor" ? root : path.join(root, "parent.md");
      const agentsHome =
        direction === "skill-ancestor" ? path.join(root, "parent") : root;
      const skillName = direction === "skill-ancestor" ? "parent" : "child";
      const agentName = direction === "skill-ancestor" ? "child" : "parent";
      const config = makeResolvedConfig(scenarioDir, {
        claude: { skillsHome, agentsHome },
        codex: { enabled: false },
      });
      const skillPath = path.join(skillsHome, skillName);
      const agentPath = path.join(agentsHome, `${agentName}.md`);
      await createSkillFixture(config.library.skillsDir, skillName);
      await createAgentFixture(
        config.library.agentsDir,
        agentName,
        makeAgentYaml(agentName),
      );
      const generatedSentinel = path.join(
        config.library.generatedDir,
        "claude",
        "agents",
        `${agentName}.md`,
      );
      await mkdir(path.dirname(generatedSentinel), { recursive: true });
      await writeFile(generatedSentinel, "generated sentinel", "utf-8");

      await expect(
        sync(config, { dryRun: false, force: false, strict: false }),
      ).rejects.toThrow("Managed output physical path conflict");

      expect(await pathExists(skillPath)).toBe(false);
      expect(await pathExists(agentPath)).toBe(false);
      expect(await pathExists(config.manifest.path)).toBe(false);
      expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
    },
  );

  it.each([
    ["active-first", "claude"],
    ["passive-first", "claude"],
    ["active-first", undefined],
    ["passive-first", undefined],
  ] as const)(
    "rejects retained-retained component overlap in %s order for target %s",
    async (order, target) => {
      const scenarioDir = path.join(tempDir, order);
      const root = path.join(scenarioDir, "managed");
      const config = makeResolvedConfig(scenarioDir, {
        claude: { skillsHome: root },
        codex: { agentsHome: path.join(root, "parent") },
        defaults: { cleanManagedOutputs: false },
      });
      const activeRecord = {
        target: "claude" as const,
        type: "skill" as const,
        name: "parent",
        sourcePath: path.join(config.library.skillsDir, "parent"),
        generatedPath: null,
        installedPath: path.join(root, "parent"),
        installMode: "copy" as const,
        contentHash: "active",
        timestamp: new Date().toISOString(),
      };
      const passiveRecord = {
        target: "codex" as const,
        type: "agent" as const,
        name: "child",
        sourcePath: path.join(config.library.agentsDir, "child.yaml"),
        generatedPath: null,
        installedPath: path.join(root, "parent", "child.toml"),
        installMode: "copy" as const,
        contentHash: "passive",
        timestamp: new Date().toISOString(),
      };
      const records =
        order === "active-first"
          ? [activeRecord, passiveRecord]
          : [passiveRecord, activeRecord];
      const renderableName = "render-sentinel";
      const generatedSentinel = path.join(
        config.library.generatedDir,
        "claude",
        "agents",
        `${renderableName}.md`,
      );
      await createAgentFixture(
        config.library.agentsDir,
        renderableName,
        makeAgentYaml(renderableName),
      );
      await mkdir(path.dirname(generatedSentinel), { recursive: true });
      await writeFile(generatedSentinel, "generated sentinel", "utf-8");
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await writeFile(
        config.manifest.path,
        makeManifestJson(records, { config }),
        "utf-8",
      );
      const manifestBefore = await readTextFile(config.manifest.path);

      await expect(
        sync(config, {
          dryRun: false,
          force: false,
          strict: false,
          target,
        }),
      ).rejects.toThrow("Managed output physical path conflict");

      expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
      expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
      expect(testLogger.infos).toEqual([]);
    },
  );

  it.each(["active-first", "passive-first"] as const)(
    "rejects passive-ancestor active-descendant retained overlap in %s order",
    async (order) => {
      const scenarioDir = path.join(tempDir, `passive-ancestor-${order}`);
      const root = path.join(scenarioDir, "managed");
      const config = makeResolvedConfig(scenarioDir, {
        claude: { agentsHome: path.join(root, "parent") },
        codex: { skillsHome: root },
        defaults: { cleanManagedOutputs: false },
      });
      const passiveAncestor = {
        target: "codex" as const,
        type: "skill" as const,
        name: "parent",
        sourcePath: path.join(config.library.skillsDir, "parent"),
        generatedPath: null,
        installedPath: path.join(root, "parent"),
        installMode: "copy" as const,
        contentHash: "passive",
        timestamp: new Date().toISOString(),
      };
      const activeDescendant = {
        target: "claude" as const,
        type: "agent" as const,
        name: "child",
        sourcePath: path.join(config.library.agentsDir, "child.yaml"),
        generatedPath: null,
        installedPath: path.join(root, "parent", "child.md"),
        installMode: "copy" as const,
        contentHash: "active",
        timestamp: new Date().toISOString(),
      };
      const records =
        order === "active-first"
          ? [activeDescendant, passiveAncestor]
          : [passiveAncestor, activeDescendant];
      const renderableName = "render-sentinel";
      const generatedSentinel = path.join(
        config.library.generatedDir,
        "claude",
        "skills",
        renderableName,
        "SKILL.md",
      );
      await createSkillFixture(config.library.skillsDir, renderableName);
      await mkdir(path.dirname(generatedSentinel), { recursive: true });
      await writeFile(generatedSentinel, "generated sentinel", "utf-8");
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await writeFile(
        config.manifest.path,
        makeManifestJson(records, { config }),
        "utf-8",
      );
      const manifestBefore = await readTextFile(config.manifest.path);

      let conflict: unknown;
      try {
        await sync(config, {
          dryRun: false,
          force: false,
          strict: false,
          target: "claude",
        });
      } catch (error) {
        conflict = error;
      }
      expect(conflict).toBeInstanceOf(UserError);
      expect((conflict as Error).message).toContain(
        "Managed output physical path conflict",
      );
      expect((conflict as Error).message).toContain(
        passiveAncestor.installedPath,
      );
      expect((conflict as Error).message).toContain(
        activeDescendant.installedPath,
      );

      expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
      expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
      expect(await pathExists(activeDescendant.installedPath)).toBe(false);
      expect(await pathExists(passiveAncestor.installedPath)).toBe(false);
      expect(testLogger.infos).toEqual([]);
    },
  );

  it.each(["skill-first", "agent-first"] as const)(
    "allows passive-passive retained component overlap in %s order",
    async (order) => {
      const scenarioDir = path.join(tempDir, `passive-passive-${order}`);
      const root = path.join(scenarioDir, "managed");
      const config = makeResolvedConfig(scenarioDir, {
        codex: {
          skillsHome: root,
          agentsHome: path.join(root, "parent"),
        },
        defaults: { cleanManagedOutputs: false },
      });
      const skillRecord = {
        target: "codex" as const,
        type: "skill" as const,
        name: "parent",
        sourcePath: path.join(config.library.skillsDir, "parent"),
        generatedPath: null,
        installedPath: path.join(root, "parent"),
        installMode: "copy" as const,
        contentHash: "passive-skill",
        timestamp: new Date().toISOString(),
      };
      const agentRecord = {
        target: "codex" as const,
        type: "agent" as const,
        name: "child",
        sourcePath: path.join(config.library.agentsDir, "child.yaml"),
        generatedPath: null,
        installedPath: path.join(root, "parent", "child.toml"),
        installMode: "copy" as const,
        contentHash: "passive-agent",
        timestamp: new Date().toISOString(),
      };
      const records =
        order === "skill-first"
          ? [skillRecord, agentRecord]
          : [agentRecord, skillRecord];
      const renderableName = "render-sentinel";
      const generatedSentinel = path.join(
        config.library.generatedDir,
        "claude",
        "skills",
        renderableName,
        "SKILL.md",
      );
      await createSkillFixture(config.library.skillsDir, renderableName);
      await mkdir(path.dirname(generatedSentinel), { recursive: true });
      await writeFile(generatedSentinel, "generated sentinel", "utf-8");
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await writeFile(
        config.manifest.path,
        makeManifestJson(records, { config }),
        "utf-8",
      );
      const manifestBefore = await readTextFile(config.manifest.path);

      const result = await sync(config, {
        dryRun: true,
        force: false,
        strict: false,
        target: "claude",
      });

      expect(result).toMatchObject({
        installed: 0,
        updated: 0,
        removed: 0,
        conflicts: 0,
        errors: [],
      });
      expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
      expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
      expect(await pathExists(skillRecord.installedPath)).toBe(false);
      expect(await pathExists(agentRecord.installedPath)).toBe(false);
    },
  );

  it.each(["retained-ancestor", "selected-ancestor"] as const)(
    "rejects a %s retained-selected component overlap before side effects",
    async (direction) => {
      const scenarioDir = path.join(tempDir, direction);
      const root = path.join(scenarioDir, "managed");
      const claudeSkillsHome =
        direction === "selected-ancestor"
          ? root
          : path.join(root, "parent.toml");
      const codexAgentsHome =
        direction === "selected-ancestor" ? path.join(root, "parent") : root;
      const selectedName =
        direction === "selected-ancestor" ? "parent" : "child";
      const retainedName =
        direction === "selected-ancestor" ? "child" : "parent";
      const config = makeResolvedConfig(scenarioDir, {
        claude: { skillsHome: claudeSkillsHome },
        codex: { agentsHome: codexAgentsHome },
      });
      const selectedPath = path.join(claudeSkillsHome, selectedName);
      const retainedPath = path.join(codexAgentsHome, `${retainedName}.toml`);
      const generatedSentinel = path.join(
        config.library.generatedDir,
        "claude",
        "skills",
        selectedName,
        "SKILL.md",
      );
      await createSkillFixture(config.library.skillsDir, selectedName);
      await mkdir(path.dirname(generatedSentinel), { recursive: true });
      await writeFile(generatedSentinel, "generated sentinel", "utf-8");
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await writeFile(
        config.manifest.path,
        makeManifestJson(
          [
            {
              target: "codex",
              type: "agent",
              name: retainedName,
              sourcePath: path.join(
                config.library.agentsDir,
                `${retainedName}.yaml`,
              ),
              generatedPath: null,
              installedPath: retainedPath,
              installMode: "copy",
              contentHash: "retained",
              timestamp: new Date().toISOString(),
            },
          ],
          { config },
        ),
        "utf-8",
      );
      const manifestBefore = await readTextFile(config.manifest.path);

      await expect(
        sync(config, {
          dryRun: false,
          force: false,
          strict: false,
          target: "claude",
        }),
      ).rejects.toThrow("Managed output physical path conflict");

      expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
      expect(await pathExists(selectedPath)).toBe(false);
      expect(await pathExists(retainedPath)).toBe(false);
      expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
      expect(testLogger.infos).toEqual([]);
    },
  );

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

  it.skipIf(!symlinkAvailable)(
    "protects reconciled dangling file and tree symlinks from same-sync installs in requested modes",
    async () => {
      const scenarios = [
        { type: "agent" as const, mode: "copy" as const },
        { type: "agent" as const, mode: "symlink" as const },
        { type: "skill" as const, mode: "copy" as const },
        { type: "skill" as const, mode: "symlink" as const },
      ];

      for (const scenario of scenarios) {
        testLogger.infos.length = 0;
        const scenarioDir = path.join(
          tempDir,
          `${scenario.type}-${scenario.mode}`,
        );
        const config = makeResolvedConfig(scenarioDir, {
          codex: { enabled: false },
          defaults: { cleanManagedOutputs: false },
        });
        const name = "protected";
        const home =
          scenario.type === "agent"
            ? config.targets.claude.agentsHome
            : config.targets.claude.skillsHome;
        const installedPath = path.join(
          home,
          scenario.type === "agent" ? `${name}.md` : name,
        );
        const foreignPath = `${home}${path.sep}.${path.sep}${path.basename(installedPath)}`;
        const missingTarget = path.join(scenarioDir, "missing-target");

        await mkdir(config.library.agentsDir, { recursive: true });
        await mkdir(config.library.skillsDir, { recursive: true });
        await mkdir(path.dirname(config.manifest.path), { recursive: true });
        await mkdir(path.dirname(installedPath), { recursive: true });
        if (scenario.type === "agent") {
          await createAgentFixture(
            config.library.agentsDir,
            name,
            makeAgentYaml(name),
          );
        } else {
          await createSkillFixture(config.library.skillsDir, name);
        }
        await symlink(
          missingTarget,
          installedPath,
          scenario.type === "agent" ? "file" : "dir",
        );
        await writeFile(
          config.manifest.path,
          makeManifestJson(
            [
              {
                target: "claude",
                type: scenario.type,
                sourcePath: path.join(scenarioDir, "foreign"),
                generatedPath: null,
                installedPath: foreignPath,
                installMode: scenario.mode,
                contentHash: "foreign",
                timestamp: new Date().toISOString(),
              },
            ],
            { legacy: true },
          ),
          "utf-8",
        );
        const before = await readTextFile(config.manifest.path);
        const originalLink = await readlink(installedPath);

        const dryRun = await sync(config, {
          dryRun: true,
          force: false,
          strict: false,
          mode: scenario.mode,
          reconcileManifest: true,
        });

        expect(dryRun).toMatchObject({
          installed: 0,
          updated: 0,
          removed: 0,
          skipped: 0,
          conflicts: 0,
          errors: [],
        });
        expect(testLogger.infos.join("\n")).toContain(
          `[skip-conflict] claude/${scenario.type}/${name}`,
        );
        expect(await readTextFile(config.manifest.path)).toBe(before);
        expect((await lstat(installedPath)).isSymbolicLink()).toBe(true);
        expect(await readlink(installedPath)).toBe(originalLink);
        expect(await pathExists(missingTarget)).toBe(false);

        const result = await sync(config, {
          dryRun: false,
          force: false,
          strict: false,
          mode: scenario.mode,
          reconcileManifest: true,
        });

        expect(result).toMatchObject({
          installed: 0,
          updated: 0,
          removed: 0,
          conflicts: 1,
          errors: [],
        });
        expect((await lstat(installedPath)).isSymbolicLink()).toBe(true);
        expect(await readlink(installedPath)).toBe(originalLink);
        expect(await pathExists(missingTarget)).toBe(false);
        const reconciled = JSON.parse(await readTextFile(config.manifest.path));
        expect(reconciled.records).toEqual([]);
      }
    },
  );

  it("protects a reachable canonical update at a reconciled foreign lexical alias", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    await mkdir(config.library.agentsDir, { recursive: true });
    const sourcePath = await createAgentFixture(
      config.library.agentsDir,
      "protected",
      makeAgentYaml("protected"),
    );
    const options = { dryRun: false, force: false, strict: false } as const;
    await sync(config, options);
    testLogger.infos.length = 0;

    const installedPath = path.join(
      config.targets.claude.agentsHome,
      "protected.md",
    );
    const originalInstalled = await readTextFile(installedPath);
    const firstManifest = JSON.parse(await readTextFile(config.manifest.path));
    const [boundCanonicalRecord] = firstManifest.records;
    expect(boundCanonicalRecord).toMatchObject({
      installedPath,
      name: "protected",
    });
    const { name: _canonicalName, ...canonicalRecord } = boundCanonicalRecord;
    const foreignPath = `${config.targets.claude.agentsHome}${path.sep}.${path.sep}protected.md`;
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [canonicalRecord, { ...canonicalRecord, installedPath: foreignPath }],
        { legacy: true },
      ),
      "utf-8",
    );
    await writeFile(
      sourcePath,
      makeAgentYaml("protected", { description: "Updated protected agent" }),
      "utf-8",
    );
    const before = await readTextFile(config.manifest.path);
    const dryRun = await sync(config, {
      dryRun: true,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(dryRun).toMatchObject({
      installed: 0,
      updated: 0,
      removed: 0,
      skipped: 0,
      conflicts: 0,
      errors: [],
    });
    expect(dryRun.reconciliation?.retained).toEqual([
      expect.objectContaining({ installedPath, name: "protected" }),
    ]);
    expect(testLogger.infos.join("\n")).toContain(
      "[skip-conflict] claude/agent/protected",
    );
    expect(await readTextFile(config.manifest.path)).toBe(before);

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(result).toMatchObject({
      installed: 0,
      updated: 0,
      removed: 0,
      conflicts: 1,
      errors: [],
    });
    expect(await readTextFile(installedPath)).toBe(originalInstalled);
    const reconciled = JSON.parse(await readTextFile(config.manifest.path));
    expect(reconciled.records).toEqual([
      expect.objectContaining({ installedPath, name: "protected" }),
    ]);
  });

  it("protects a reachable canonical removal at a reconciled foreign lexical alias", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    await mkdir(config.library.agentsDir, { recursive: true });
    const sourcePath = await createAgentFixture(
      config.library.agentsDir,
      "protected",
      makeAgentYaml("protected"),
    );
    const options = { dryRun: false, force: false, strict: false } as const;
    await sync(config, options);
    testLogger.infos.length = 0;

    const installedPath = path.join(
      config.targets.claude.agentsHome,
      "protected.md",
    );
    const originalInstalled = await readTextFile(installedPath);
    const firstManifest = JSON.parse(await readTextFile(config.manifest.path));
    const [boundCanonicalRecord] = firstManifest.records;
    expect(boundCanonicalRecord).toMatchObject({
      installedPath,
      name: "protected",
    });
    const { name: _canonicalName, ...canonicalRecord } = boundCanonicalRecord;
    const foreignPath = `${config.targets.claude.agentsHome}${path.sep}.${path.sep}protected.md`;
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [canonicalRecord, { ...canonicalRecord, installedPath: foreignPath }],
        { legacy: true },
      ),
      "utf-8",
    );
    await rm(sourcePath);
    const before = await readTextFile(config.manifest.path);
    const dryRun = await sync(config, {
      dryRun: true,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(dryRun).toMatchObject({
      installed: 0,
      updated: 0,
      removed: 0,
      skipped: 0,
      conflicts: 0,
      errors: [],
    });
    expect(dryRun.reconciliation?.retained).toEqual([
      expect.objectContaining({ installedPath, name: "protected" }),
    ]);
    expect(testLogger.infos.join("\n")).toContain(
      "[skip-conflict] claude/agent/protected",
    );
    expect(await readTextFile(config.manifest.path)).toBe(before);

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(result).toMatchObject({
      installed: 0,
      updated: 0,
      removed: 0,
      conflicts: 1,
      errors: [],
    });
    expect(await readTextFile(installedPath)).toBe(originalInstalled);
    const reconciled = JSON.parse(await readTextFile(config.manifest.path));
    expect(reconciled.records).toEqual([
      expect.objectContaining({ installedPath, name: "protected" }),
    ]);
  });

  it("keeps skip-up-to-date when a reconciled foreign lexical alias protects its key", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createAgentFixture(
      config.library.agentsDir,
      "protected",
      makeAgentYaml("protected"),
    );
    const options = { dryRun: false, force: false, strict: false } as const;
    await sync(config, options);
    testLogger.infos.length = 0;

    const installedPath = path.join(
      config.targets.claude.agentsHome,
      "protected.md",
    );
    const firstManifest = JSON.parse(await readTextFile(config.manifest.path));
    const [boundCanonicalRecord] = firstManifest.records;
    const { name: _canonicalName, ...canonicalRecord } = boundCanonicalRecord;
    const foreignPath = `${config.targets.claude.agentsHome}${path.sep}.${path.sep}protected.md`;
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [canonicalRecord, { ...canonicalRecord, installedPath: foreignPath }],
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

    expect(result).toMatchObject({
      installed: 0,
      updated: 0,
      removed: 0,
      skipped: 1,
      conflicts: 0,
      errors: [],
    });
    expect(testLogger.infos.join("\n")).not.toContain(
      "[skip-conflict] claude/agent/protected",
    );
    const reconciled = JSON.parse(await readTextFile(config.manifest.path));
    expect(reconciled.records).toEqual([
      expect.objectContaining({ installedPath, name: "protected" }),
    ]);
  });

  it("keeps an existing skip-conflict when a reconciled foreign record protects its key", async () => {
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
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    const installedPath = path.join(
      config.targets.claude.agentsHome,
      "protected.md",
    );
    const foreignPath = `${config.targets.claude.agentsHome}${path.sep}.${path.sep}protected.md`;
    await mkdir(path.dirname(installedPath), { recursive: true });
    await writeFile(installedPath, "unmanaged protected bytes", "utf-8");
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

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(result).toMatchObject({
      installed: 0,
      updated: 0,
      removed: 0,
      skipped: 0,
      conflicts: 1,
      errors: [],
    });
    expect(await readTextFile(installedPath)).toBe("unmanaged protected bytes");
    expect(testLogger.warnings).toContain(
      "  ! claude/agent/protected: Unmanaged file exists (overwrite-managed policy).",
    );
  });

  it("keeps remove-missing when a reconciled foreign lexical alias protects its key", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    await mkdir(config.library.agentsDir, { recursive: true });
    const sourcePath = await createAgentFixture(
      config.library.agentsDir,
      "protected",
      makeAgentYaml("protected"),
    );
    const options = { dryRun: false, force: false, strict: false } as const;
    await sync(config, options);

    const installedPath = path.join(
      config.targets.claude.agentsHome,
      "protected.md",
    );
    const firstManifest = JSON.parse(await readTextFile(config.manifest.path));
    const [boundCanonicalRecord] = firstManifest.records;
    const { name: _canonicalName, ...canonicalRecord } = boundCanonicalRecord;
    const foreignPath = `${config.targets.claude.agentsHome}${path.sep}.${path.sep}protected.md`;
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [canonicalRecord, { ...canonicalRecord, installedPath: foreignPath }],
        { legacy: true },
      ),
      "utf-8",
    );
    await rm(sourcePath);
    await rm(installedPath);

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(result).toMatchObject({
      installed: 0,
      updated: 0,
      removed: 1,
      skipped: 0,
      conflicts: 0,
      errors: [],
    });
    expect(await pathExists(installedPath)).toBe(false);
    const reconciled = JSON.parse(await readTextFile(config.manifest.path));
    expect(reconciled.records).toEqual([]);
  });

  it("reconciles colliding foreign legacy records after excluding them from retained collision validation", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    const foreignPath = path.join(tempDir, "foreign", "shared.md");
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(path.dirname(foreignPath), { recursive: true });
    await writeFile(foreignPath, "foreign shared bytes", "utf-8");
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "first.yaml"),
            generatedPath: null,
            installedPath: foreignPath,
            installMode: "copy",
            contentHash: "first",
            timestamp: new Date().toISOString(),
          },
          {
            target: "claude",
            type: "skill",
            sourcePath: path.join(config.library.skillsDir, "second"),
            generatedPath: null,
            installedPath: foreignPath,
            installMode: "copy",
            contentHash: "second",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );
    const manifestBefore = await readTextFile(config.manifest.path);

    const dryRun = await sync(config, {
      dryRun: true,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(dryRun.errors).toEqual([]);
    expect(dryRun.reconciliation?.retained).toEqual([]);
    expect(dryRun.reconciliation?.removed).toHaveLength(2);
    expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
    expect(await readTextFile(foreignPath)).toBe("foreign shared bytes");
    expect(
      (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
        entry.includes(".backup-"),
      ),
    ).toHaveLength(0);

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(result.errors).toEqual([]);
    expect(result.reconciliation?.removed).toHaveLength(2);
    expect(await readTextFile(foreignPath)).toBe("foreign shared bytes");
    expect(
      (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
        entry.includes(".backup-"),
      ),
    ).toHaveLength(1);
    expect(
      JSON.parse(await readTextFile(config.manifest.path)).records,
    ).toEqual([]);

    const second = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
    });
    expect(second.errors).toEqual([]);
    expect(second.reconciliation).toBeUndefined();
  });

  it.each([
    ["exact manifest", "manifest", "exact"],
    ["managed descendant of manifest", "manifest", "descendant"],
    ["managed ancestor of manifest", "manifest", "ancestor"],
    ["exact sibling lock", "lock", "exact"],
    ["managed descendant of sibling lock", "lock", "descendant"],
    ["managed ancestor of sibling lock", "lock", "ancestor"],
  ] as const)(
    "refuses a reconciled foreign record at the %s control relation before save or render",
    async (_label, control, relation) => {
      const scenarioDir = path.join(tempDir, `${control}-${relation}`);
      const manifestPath = path.join(scenarioDir, "state", "manifest.json");
      const lockPath = `${manifestPath}.lock`;
      const controlPath = control === "manifest" ? manifestPath : lockPath;
      const foreignPath =
        relation === "exact"
          ? controlPath
          : relation === "descendant"
            ? path.join(controlPath, "foreign")
            : path.dirname(controlPath);
      const config = makeResolvedConfig(scenarioDir, {
        codex: { enabled: false },
        manifest: { path: manifestPath },
      });
      const generatedName = "generated-sentinel";
      const generatedPath = path.join(
        config.library.generatedDir,
        "claude",
        "agents",
        `${generatedName}.md`,
      );
      const installedPath = path.join(
        config.targets.claude.agentsHome,
        `${generatedName}.md`,
      );
      await createAgentFixture(
        config.library.agentsDir,
        generatedName,
        makeAgentYaml(generatedName),
      );
      await mkdir(path.dirname(manifestPath), { recursive: true });
      await mkdir(path.dirname(generatedPath), { recursive: true });
      await writeFile(generatedPath, "generated sentinel", "utf-8");
      const manifestBytes = makeManifestJson(
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
      );
      await writeFile(manifestPath, manifestBytes, "utf-8");

      await expect(
        sync(config, {
          dryRun: false,
          force: false,
          strict: false,
          reconcileManifest: true,
        }),
      ).rejects.toThrow("Managed output physical path conflict");

      expect(await readTextFile(manifestPath)).toBe(manifestBytes);
      expect(await readTextFile(generatedPath)).toBe("generated sentinel");
      expect(await pathExists(installedPath)).toBe(false);
      expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
      expect(await pathExists(lockPath)).toBe(false);
      expect(await readdir(path.dirname(manifestPath))).toEqual([
        "manifest.json",
      ]);
      expect(testLogger.infos).toEqual([]);
    },
  );

  it.each(
    [
      {
        label: "selected agent exact",
        selectedType: "agent",
        domain: "selected",
        relation: "exact",
        dryRun: false,
        shape: "symlink",
      },
      {
        label: "selected agent foreign ancestor",
        selectedType: "agent",
        domain: "selected",
        relation: "foreign-ancestor",
        dryRun: true,
        shape: "directory",
      },
      {
        label: "selected agent foreign descendant",
        selectedType: "agent",
        domain: "selected",
        relation: "foreign-descendant",
        dryRun: false,
        shape: "directory",
      },
      {
        label: "selected skill exact",
        selectedType: "skill",
        domain: "selected",
        relation: "exact",
        dryRun: false,
        shape: "directory",
      },
      {
        label: "selected skill foreign ancestor",
        selectedType: "skill",
        domain: "selected",
        relation: "foreign-ancestor",
        dryRun: true,
        shape: "directory",
      },
      {
        label: "selected skill foreign descendant",
        selectedType: "skill",
        domain: "selected",
        relation: "foreign-descendant",
        dryRun: false,
        shape: "file",
      },
      {
        label: "stale agent exact removal",
        selectedType: "skill",
        domain: "stale-agent",
        relation: "exact",
        dryRun: false,
        shape: "file",
      },
      {
        label: "stale agent foreign ancestor",
        selectedType: "skill",
        domain: "stale-agent",
        relation: "foreign-ancestor",
        dryRun: true,
        shape: "directory",
      },
      {
        label: "stale skill foreign descendant",
        selectedType: "agent",
        domain: "stale-skill",
        relation: "foreign-descendant",
        dryRun: false,
        shape: "symlink",
      },
    ].filter((scenario) => symlinkAvailable || scenario.shape !== "symlink"),
  )(
    "rejects reconciled foreign overlap with the $label generated mutation domain before effects",
    async ({ selectedType, domain, relation, dryRun, shape }) => {
      const scenarioDir = path.join(
        tempDir,
        `${selectedType}-${domain}-${relation}`,
      );
      const config = makeResolvedConfig(scenarioDir, {
        codex: { enabled: false },
      });
      const selectedName = "selected";
      if (selectedType === "agent") {
        await createAgentFixture(
          config.library.agentsDir,
          selectedName,
          makeAgentYaml(selectedName),
        );
      } else {
        await createSkillFixture(config.library.skillsDir, selectedName);
      }
      const selectedGeneratedPath = path.join(
        config.library.generatedDir,
        "claude",
        selectedType === "agent" ? "agents" : "skills",
        selectedType === "agent" ? `${selectedName}.md` : selectedName,
      );
      const mutationPath =
        domain === "selected"
          ? selectedGeneratedPath
          : domain === "stale-agent"
            ? path.join(
                config.library.generatedDir,
                "claude",
                "agents",
                "stale.md",
              )
            : path.join(
                config.library.generatedDir,
                "claude",
                "skills",
                "stale",
              );
      const authoritativeMutationPath =
        domain === "selected"
          ? selectedGeneratedPath
          : path.join(
              config.library.generatedDir,
              "claude",
              domain === "stale-agent" ? "agents" : "skills",
            );
      const authoritativeMutationKind =
        domain === "selected" ? "selected-output" : "stale-cleanup-root";
      const foreignPath =
        relation === "exact"
          ? mutationPath
          : relation === "foreign-ancestor"
            ? path.dirname(mutationPath)
            : path.join(mutationPath, "foreign-child");
      const foreignType = path.basename(foreignPath).endsWith(".md")
        ? "agent"
        : "skill";
      const foreignSentinelPath =
        shape === "directory"
          ? path.join(foreignPath, "foreign-sentinel.txt")
          : foreignPath;
      const externalLinkTarget = path.join(
        scenarioDir,
        "external-link-target.txt",
      );
      await mkdir(path.dirname(foreignPath), { recursive: true });
      if (shape === "directory") {
        await mkdir(foreignPath, { recursive: true });
        await writeFile(
          foreignSentinelPath,
          "foreign directory sentinel",
          "utf-8",
        );
      } else if (shape === "symlink") {
        await writeFile(externalLinkTarget, "external sentinel", "utf-8");
        await symlink(externalLinkTarget, foreignPath, "file");
      } else {
        await writeFile(foreignPath, "foreign file sentinel", "utf-8");
      }

      const installedHome =
        selectedType === "agent"
          ? config.targets.claude.agentsHome
          : config.targets.claude.skillsHome;
      const installedSentinelPath = path.join(
        installedHome,
        "installed-sentinel.txt",
      );
      await mkdir(installedHome, { recursive: true });
      await writeFile(installedSentinelPath, "installed sentinel", "utf-8");
      const generatedSentinelPath = path.join(
        config.library.generatedDir,
        "generated-sentinel.txt",
      );
      await mkdir(config.library.generatedDir, { recursive: true });
      await writeFile(generatedSentinelPath, "generated sentinel", "utf-8");
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      const manifestBytes = makeManifestJson(
        [
          {
            target: "claude",
            type: foreignType,
            sourcePath:
              foreignType === "agent"
                ? path.join(config.library.agentsDir, "foreign.yaml")
                : path.join(config.library.skillsDir, "foreign"),
            generatedPath: null,
            installedPath: foreignPath,
            installMode: "copy",
            contentHash: "foreign",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      );
      await writeFile(config.manifest.path, manifestBytes, "utf-8");
      const manifestStat = await lstat(config.manifest.path);
      const foreignStat = await lstat(foreignPath);
      const foreignLink =
        shape === "symlink" ? await readlink(foreignPath) : undefined;
      const manifestParentInventory = await readdir(
        path.dirname(config.manifest.path),
      );
      const foreignParentInventory = await readdir(path.dirname(foreignPath));
      const installedInventory = await readdir(installedHome);

      let result: Awaited<ReturnType<typeof sync>> | undefined;
      let thrown: unknown;
      try {
        result = await sync(config, {
          dryRun,
          force: false,
          strict: false,
          reconcileManifest: true,
        });
      } catch (error) {
        thrown = error;
      }

      expect(await readTextFile(config.manifest.path)).toBe(manifestBytes);
      expect((await lstat(config.manifest.path)).ino).toBe(manifestStat.ino);
      expect(await readdir(path.dirname(config.manifest.path))).toEqual(
        manifestParentInventory,
      );
      expect(await pathExists(`${config.manifest.path}.lock`)).toBe(false);
      expect(await pathExists(foreignPath)).toBe(true);
      expect((await lstat(foreignPath)).ino).toBe(foreignStat.ino);
      expect((await lstat(foreignPath)).isFile()).toBe(foreignStat.isFile());
      expect((await lstat(foreignPath)).isDirectory()).toBe(
        foreignStat.isDirectory(),
      );
      expect((await lstat(foreignPath)).isSymbolicLink()).toBe(
        foreignStat.isSymbolicLink(),
      );
      expect(await readdir(path.dirname(foreignPath))).toEqual(
        foreignParentInventory,
      );
      if (shape === "directory") {
        expect(await readTextFile(foreignSentinelPath)).toBe(
          "foreign directory sentinel",
        );
      } else if (shape === "symlink") {
        expect(await readlink(foreignPath)).toBe(foreignLink);
        expect(await readTextFile(externalLinkTarget)).toBe(
          "external sentinel",
        );
      } else {
        expect(await readTextFile(foreignPath)).toBe("foreign file sentinel");
      }
      expect(await readTextFile(generatedSentinelPath)).toBe(
        "generated sentinel",
      );
      expect(await readTextFile(installedSentinelPath)).toBe(
        "installed sentinel",
      );
      expect(await readdir(installedHome)).toEqual(installedInventory);
      expect(testLogger.infos).toEqual([]);
      expect(result).toBeUndefined();
      expect(thrown).toBeInstanceOf(UserError);
      expect((thrown as Error).message).toContain(
        "Reconciled foreign path overlaps renderer mutation inventory",
      );
      expect((thrown as Error).message).toContain(path.resolve(foreignPath));
      expect((thrown as Error).message).toContain(
        `${authoritativeMutationKind} ${path.resolve(authoritativeMutationPath)}`,
      );
      expect(
        (await readdir(path.dirname(config.manifest.path))).filter(
          (entry) =>
            entry.includes(".backup-") ||
            entry.includes(".tmp") ||
            entry.endsWith(".lock"),
        ),
      ).toEqual([]);
    },
  );

  it("allows a reconciled foreign path in a passive target generated tree", async () => {
    const config = makeResolvedConfig(tempDir);
    const selectedName = "selected";
    await createAgentFixture(
      config.library.agentsDir,
      selectedName,
      makeAgentYaml(selectedName),
    );
    const foreignPath = path.join(
      config.library.generatedDir,
      "codex",
      "agents",
      "passive.toml",
    );
    await mkdir(path.dirname(foreignPath), { recursive: true });
    await writeFile(foreignPath, "passive foreign sentinel", "utf-8");
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "codex",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "passive.yaml"),
            generatedPath: null,
            installedPath: foreignPath,
            installMode: "copy",
            contentHash: "passive-foreign",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );

    const result = await sync(config, {
      target: "claude",
      dryRun: false,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(result).toMatchObject({
      installed: 1,
      updated: 0,
      removed: 0,
      conflicts: 0,
      errors: [],
      reconciliation: {
        retained: [],
        removed: [expect.objectContaining({ installedPath: foreignPath })],
      },
    });
    expect(await readTextFile(foreignPath)).toBe("passive foreign sentinel");
    expect(
      await pathExists(
        path.join(
          config.library.generatedDir,
          "claude",
          "agents",
          "selected.md",
        ),
      ),
    ).toBe(true);
    expect(
      await pathExists(
        path.join(config.targets.claude.agentsHome, "selected.md"),
      ),
    ).toBe(true);
  });

  it("allows an active selected-tree component sibling without overbroad root containment", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    const selectedName = "selected";
    await createAgentFixture(
      config.library.agentsDir,
      selectedName,
      makeAgentYaml(selectedName),
    );
    const foreignPath = path.join(
      config.library.generatedDir,
      "claude",
      "agents-archive",
      "foreign.md",
    );
    await mkdir(path.dirname(foreignPath), { recursive: true });
    await writeFile(foreignPath, "active sibling sentinel", "utf-8");
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
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

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(result.errors).toEqual([]);
    expect(result.installed).toBe(1);
    expect(await readTextFile(foreignPath)).toBe("active sibling sentinel");
    expect(
      await pathExists(
        path.join(
          config.library.generatedDir,
          "claude",
          "agents",
          `${selectedName}.md`,
        ),
      ),
    ).toBe(true);
  });

  it("rejects differently identified retained records at one literal path before side effects", async () => {
    for (const dryRun of [true, false]) {
      const scenarioDir = path.join(tempDir, dryRun ? "dry" : "real");
      const sharedSkillsHome = path.join(scenarioDir, "home", "skills");
      const config = makeResolvedConfig(scenarioDir, {
        claude: { skillsHome: sharedSkillsHome },
        codex: { skillsHome: sharedSkillsHome },
      });
      const installedPath = path.join(sharedSkillsHome, "shared");
      const generatedSentinel = path.join(
        config.library.generatedDir,
        "sentinel.txt",
      );
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await mkdir(path.dirname(generatedSentinel), { recursive: true });
      await writeFile(generatedSentinel, "generated sentinel", "utf-8");
      await writeFile(
        config.manifest.path,
        makeManifestJson(
          [
            {
              target: "claude",
              type: "skill",
              name: "shared",
              sourcePath: path.join(config.library.skillsDir, "shared"),
              generatedPath: null,
              installedPath,
              installMode: "copy",
              contentHash: "claude-retained",
              timestamp: new Date().toISOString(),
            },
            {
              target: "codex",
              type: "skill",
              name: "shared",
              sourcePath: path.join(config.library.skillsDir, "shared"),
              generatedPath: null,
              installedPath,
              installMode: "copy",
              contentHash: "codex-retained",
              timestamp: new Date().toISOString(),
            },
          ],
          { config },
        ),
        "utf-8",
      );
      const manifestBefore = await readTextFile(config.manifest.path);

      await expect(
        sync(config, { dryRun, force: false, strict: false }),
      ).rejects.toThrow("Managed output physical path conflict");

      expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
      expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
      expect(await pathExists(installedPath)).toBe(false);
      expect(
        (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
          entry.includes(".backup-"),
        ),
      ).toHaveLength(0);
      expect(testLogger.infos).toEqual([]);
    }
  });

  it("reconciles an owned and foreign exact-path legacy pair without replacing the owned output", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    const name = "shared";
    const installedPath = path.join(
      config.targets.claude.agentsHome,
      `${name}.md`,
    );
    await mkdir(config.library.agentsDir, { recursive: true });
    await createAgentFixture(
      config.library.agentsDir,
      name,
      makeAgentYaml(name),
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, `${name}.yaml`),
            generatedPath: null,
            installedPath,
            installMode: "copy",
            contentHash: "owned",
            timestamp: new Date().toISOString(),
          },
          {
            target: "claude",
            type: "skill",
            sourcePath: path.join(config.library.skillsDir, "foreign"),
            generatedPath: null,
            installedPath,
            installMode: "copy",
            contentHash: "foreign",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );
    const manifestBefore = await readTextFile(config.manifest.path);

    const dryRun = await sync(config, {
      dryRun: true,
      force: false,
      strict: false,
      reconcileManifest: true,
    });
    expect(dryRun.reconciliation).toMatchObject({
      retained: [expect.objectContaining({ name, installedPath })],
      removed: [expect.objectContaining({ installedPath })],
    });
    expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
    expect(await pathExists(installedPath)).toBe(false);

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      reconcileManifest: true,
    });
    expect(result).toMatchObject({
      installed: 0,
      updated: 0,
      removed: 0,
      conflicts: 1,
      errors: [],
    });
    const backups = (await readdir(path.dirname(config.manifest.path))).filter(
      (entry) => entry.includes(".backup-"),
    );
    expect(backups).toHaveLength(1);
    expect(await readTextFile(path.join(tempDir, backups[0]))).toBe(
      manifestBefore,
    );
    expect(await pathExists(installedPath)).toBe(false);
    expect(
      JSON.parse(await readTextFile(config.manifest.path)).records,
    ).toEqual([expect.objectContaining({ name, installedPath })]);

    const second = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
    });
    expect(second.errors).toEqual([]);
    expect(second.installed).toBe(1);
    expect(await pathExists(installedPath)).toBe(true);
  });

  it("refuses bound foreign and unreconciled legacy exact-path pairs before writes", async () => {
    for (const scenario of [
      {
        name: "bound",
        fixture: "bound" as const,
        error: "Bound manifest contains foreign records",
      },
      {
        name: "legacy",
        fixture: "legacy" as const,
        error: "Legacy manifest contains foreign records",
      },
    ]) {
      const scenarioDir = path.join(tempDir, `exact-refusal-${scenario.name}`);
      const config = makeResolvedConfig(scenarioDir, {
        codex: { enabled: false },
      });
      const installedPath = path.join(
        config.targets.claude.agentsHome,
        "shared.md",
      );
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      const records = [
        {
          target: "claude",
          type: "agent",
          ...(scenario.fixture === "bound" ? { name: "shared" } : {}),
          sourcePath: path.join(config.library.agentsDir, "shared.yaml"),
          generatedPath: null,
          installedPath,
          installMode: "copy",
          contentHash: "owned",
          timestamp: new Date().toISOString(),
        },
        {
          target: "claude",
          type: "skill",
          ...(scenario.fixture === "bound" ? { name: "foreign" } : {}),
          sourcePath: path.join(config.library.skillsDir, "foreign"),
          generatedPath: null,
          installedPath,
          installMode: "copy",
          contentHash: "foreign",
          timestamp: new Date().toISOString(),
        },
      ];
      await writeFile(
        config.manifest.path,
        makeManifestJson(records, {
          ...(scenario.fixture === "bound" ? { config } : { legacy: true }),
        }),
        "utf-8",
      );
      const manifestBefore = await readTextFile(config.manifest.path);

      await expect(
        sync(config, { dryRun: false, force: false, strict: false }),
      ).rejects.toThrow(scenario.error);
      expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
      expect(await pathExists(installedPath)).toBe(false);
      expect(await pathExists(config.library.generatedDir)).toBe(false);
      expect(
        (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
          entry.includes(".backup-"),
        ),
      ).toHaveLength(0);
    }
  });

  it("blocks component-overlapping managed updates and removals in both directions", async () => {
    const scenarios = [
      { action: "update" as const, direction: "descendant" as const },
      { action: "update" as const, direction: "ancestor" as const },
      { action: "remove" as const, direction: "descendant" as const },
      { action: "remove" as const, direction: "ancestor" as const },
    ];
    for (const scenario of scenarios) {
      const scenarioDir = path.join(
        tempDir,
        `${scenario.action}-${scenario.direction}`,
      );
      const config = makeResolvedConfig(scenarioDir, {
        codex: { enabled: false },
      });
      const type = scenario.direction === "ancestor" ? "skill" : "agent";
      const name = "protected";
      const sourcePath =
        type === "skill"
          ? await createSkillFixture(config.library.skillsDir, name)
          : await createAgentFixture(
              config.library.agentsDir,
              name,
              makeAgentYaml(name),
            );
      await sync(config, { dryRun: false, force: false, strict: false });
      const initial = JSON.parse(await readTextFile(config.manifest.path));
      const record = initial.records.find(
        (candidate: { target: string; type: string; name: string }) =>
          candidate.target === "claude" &&
          candidate.type === type &&
          candidate.name === name,
      );
      const { name: _name, ...legacyRecord } = record;
      const foreignPath =
        scenario.direction === "ancestor"
          ? path.join(record.installedPath, "foreign.md")
          : type === "agent"
            ? config.targets.claude.agentsHome
            : config.targets.claude.skillsHome;
      if (scenario.direction === "ancestor") {
        await writeFile(foreignPath, "foreign child bytes", "utf-8");
      }
      await writeFile(
        config.manifest.path,
        makeManifestJson(
          [
            legacyRecord,
            {
              target: "claude",
              type: scenario.direction === "ancestor" ? "agent" : "skill",
              sourcePath: path.join(scenarioDir, "foreign"),
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
      const installedBefore =
        type === "agent"
          ? await readTextFile(record.installedPath)
          : await readTextFile(path.join(record.installedPath, "SKILL.md"));
      if (scenario.action === "update") {
        if (type === "agent") {
          await writeFile(
            sourcePath,
            makeAgentYaml(name, { description: "updated" }),
            "utf-8",
          );
        } else {
          await writeFile(
            path.join(sourcePath, "SKILL.md"),
            "---\nname: protected\ndescription: updated\n---\n\n# protected\n",
            "utf-8",
          );
        }
      } else {
        await rm(sourcePath, { recursive: true });
      }

      const dryRun = await sync(config, {
        dryRun: true,
        force: false,
        strict: false,
        reconcileManifest: true,
      });
      expect(dryRun).toMatchObject({
        installed: 0,
        updated: 0,
        removed: 0,
        skipped: 0,
        conflicts: 0,
        errors: [],
      });
      const result = await sync(config, {
        dryRun: false,
        force: false,
        strict: false,
        reconcileManifest: true,
      });
      expect(result).toMatchObject({
        installed: 0,
        updated: 0,
        removed: 0,
        conflicts: 1,
        errors: [],
      });
      expect(
        type === "agent"
          ? await readTextFile(record.installedPath)
          : await readTextFile(path.join(record.installedPath, "SKILL.md")),
      ).toBe(installedBefore);
      expect(
        JSON.parse(await readTextFile(config.manifest.path)).records,
      ).toEqual([
        expect.objectContaining({ name, installedPath: record.installedPath }),
      ]);
    }
  });

  it("allows an unrelated component-prefix sibling overwrite while a foreign path is protected", async () => {
    const config = makeResolvedConfig(tempDir, {
      codex: { enabled: false },
      defaults: { cleanManagedOutputs: false },
    });
    const installedPath = path.join(
      config.targets.claude.agentsHome,
      "foobar.md",
    );
    const foreignPath = path.join(config.targets.claude.agentsHome, "foo");
    await createAgentFixture(
      config.library.agentsDir,
      "foobar",
      makeAgentYaml("foobar"),
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(path.dirname(installedPath), { recursive: true });
    await writeFile(installedPath, "unmanaged foobar bytes", "utf-8");
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "skill",
            sourcePath: path.join(config.library.skillsDir, "foo"),
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
      force: true,
      strict: false,
      reconcileManifest: true,
    });
    expect(result).toMatchObject({
      installed: 1,
      conflicts: 0,
      errors: [],
    });
    expect(await readTextFile(installedPath)).not.toBe(
      "unmanaged foobar bytes",
    );
    expect(
      JSON.parse(await readTextFile(config.manifest.path)).records,
    ).toEqual([expect.objectContaining({ name: "foobar", installedPath })]);
  });

  it.skipIf(!symlinkAvailable)(
    "preserves component-overlapping foreign files trees and dangling links across install modes",
    async () => {
      const scenarios = (["file", "tree", "link"] as const).flatMap((kind) =>
        (["copy", "symlink"] as const).flatMap((mode) => [
          { kind, mode, force: true },
          { kind, mode, force: false },
        ]),
      );

      for (const scenario of scenarios) {
        testLogger.infos.length = 0;
        const scenarioDir = path.join(
          tempDir,
          `component-${scenario.kind}-${scenario.mode}-${scenario.force ? "force" : "overwrite-all"}`,
        );
        const config = makeResolvedConfig(scenarioDir, {
          codex: { enabled: false },
          defaults: {
            cleanManagedOutputs: false,
            ...(scenario.force ? {} : { overwritePolicy: "overwrite-all" }),
          },
        });
        const type = scenario.kind === "tree" ? "skill" : "agent";
        const name = "protected";
        const home =
          type === "skill"
            ? config.targets.claude.skillsHome
            : config.targets.claude.agentsHome;
        const installedPath = path.join(
          home,
          type === "skill" ? name : `${name}.md`,
        );
        const foreignPath =
          scenario.kind === "tree"
            ? path.join(installedPath, "foreign.md")
            : home;
        const missingTarget = path.join(scenarioDir, "missing-target");
        const sentinelPath = path.join(installedPath, "sentinel.txt");

        await mkdir(config.library.skillsDir, { recursive: true });
        await mkdir(config.library.agentsDir, { recursive: true });
        await mkdir(path.dirname(config.manifest.path), { recursive: true });
        if (type === "skill") {
          await createSkillFixture(config.library.skillsDir, name);
        } else {
          await createAgentFixture(
            config.library.agentsDir,
            name,
            makeAgentYaml(name),
          );
        }
        await mkdir(path.dirname(installedPath), { recursive: true });
        if (scenario.kind === "file") {
          await writeFile(installedPath, "foreign file bytes", "utf-8");
        } else if (scenario.kind === "tree") {
          await mkdir(installedPath, { recursive: true });
          await writeFile(sentinelPath, "foreign tree bytes", "utf-8");
        } else {
          await symlink(missingTarget, installedPath, "file");
        }
        await writeFile(
          config.manifest.path,
          makeManifestJson(
            [
              {
                target: "claude",
                type: scenario.kind === "tree" ? "agent" : "skill",
                sourcePath: path.join(scenarioDir, "foreign"),
                generatedPath: null,
                installedPath: foreignPath,
                installMode: scenario.mode,
                contentHash: "foreign",
                timestamp: new Date().toISOString(),
              },
            ],
            { legacy: true },
          ),
          "utf-8",
        );
        const manifestBefore = await readTextFile(config.manifest.path);
        const originalLink =
          scenario.kind === "link" ? await readlink(installedPath) : undefined;

        const dryRun = await sync(config, {
          dryRun: true,
          force: scenario.force,
          strict: false,
          mode: scenario.mode,
          reconcileManifest: true,
        });
        expect(dryRun).toMatchObject({
          installed: 0,
          updated: 0,
          removed: 0,
          skipped: 0,
          conflicts: 0,
          errors: [],
        });
        expect(testLogger.infos.join("\n")).toContain(
          `[skip-conflict] claude/${type}/protected`,
        );
        expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
        expect(
          (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
            entry.includes(".backup-"),
          ),
        ).toHaveLength(0);

        const result = await sync(config, {
          dryRun: false,
          force: scenario.force,
          strict: false,
          mode: scenario.mode,
          reconcileManifest: true,
        });
        expect(result).toMatchObject({
          installed: 0,
          updated: 0,
          removed: 0,
          conflicts: 1,
          errors: [],
        });
        if (scenario.kind === "file") {
          expect((await lstat(installedPath)).isFile()).toBe(true);
          expect(await readTextFile(installedPath)).toBe("foreign file bytes");
        } else if (scenario.kind === "tree") {
          expect((await lstat(installedPath)).isDirectory()).toBe(true);
          expect(await readTextFile(sentinelPath)).toBe("foreign tree bytes");
        } else {
          expect((await lstat(installedPath)).isSymbolicLink()).toBe(true);
          expect(await readlink(installedPath)).toBe(originalLink);
          expect(await pathExists(missingTarget)).toBe(false);
        }
        expect(
          JSON.parse(await readTextFile(config.manifest.path)).records,
        ).toEqual([]);
      }
    },
  );

  it("blocks a planned install nested beneath a reconciled foreign directory", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    const name = "nested";
    const installedPath = path.join(
      config.targets.claude.agentsHome,
      `${name}.md`,
    );
    const protectedPath = config.targets.claude.agentsHome;
    const sentinelPath = path.join(protectedPath, "foreign-sentinel.txt");
    await mkdir(config.library.agentsDir, { recursive: true });
    await createAgentFixture(
      config.library.agentsDir,
      name,
      makeAgentYaml(name),
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(protectedPath, { recursive: true });
    await writeFile(sentinelPath, "foreign tree bytes", "utf-8");
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "skill",
            sourcePath: path.join(config.library.skillsDir, "foreign"),
            generatedPath: null,
            installedPath: protectedPath,
            installMode: "copy",
            contentHash: "foreign",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );
    const manifestBefore = await readTextFile(config.manifest.path);

    const dryRun = await sync(config, {
      dryRun: true,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(dryRun).toMatchObject({
      installed: 0,
      updated: 0,
      removed: 0,
      skipped: 0,
      conflicts: 0,
      errors: [],
    });
    expect(testLogger.infos.join("\n")).toContain(
      "[skip-conflict] claude/agent/nested",
    );
    expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
    expect(await pathExists(installedPath)).toBe(false);
    expect(await readTextFile(sentinelPath)).toBe("foreign tree bytes");

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(result).toMatchObject({
      installed: 0,
      updated: 0,
      removed: 0,
      conflicts: 1,
      errors: [],
    });
    expect(await pathExists(installedPath)).toBe(false);
    expect(await readTextFile(sentinelPath)).toBe("foreign tree bytes");
    expect(
      JSON.parse(await readTextFile(config.manifest.path)).records,
    ).toEqual([]);

    const afterProtectionExpires = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
    });
    expect(afterProtectionExpires).toMatchObject({
      installed: 1,
      conflicts: 0,
      errors: [],
    });
    expect(await pathExists(installedPath)).toBe(true);
  });

  it("blocks a planned ancestor install that contains an absent protected descendant", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    const name = "ancestor-install";
    const installedPath = path.join(config.targets.claude.skillsHome, name);
    const protectedPath = path.join(installedPath, "foreign.md");
    await createSkillFixture(config.library.skillsDir, name);
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "foreign.yaml"),
            generatedPath: null,
            installedPath: protectedPath,
            installMode: "copy",
            contentHash: "foreign",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );
    const manifestBefore = await readTextFile(config.manifest.path);

    const dryRun = await sync(config, {
      dryRun: true,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(dryRun).toMatchObject({
      installed: 0,
      updated: 0,
      removed: 0,
      skipped: 0,
      conflicts: 0,
      errors: [],
    });
    expect(testLogger.infos.join("\n")).toContain(
      "[skip-conflict] claude/skill/ancestor-install",
    );
    expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
    expect(await pathExists(installedPath)).toBe(false);
    expect(await pathExists(protectedPath)).toBe(false);
    expect(
      (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
        entry.includes(".backup-"),
      ),
    ).toHaveLength(0);

    testLogger.infos.length = 0;
    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(result).toMatchObject({
      installed: 0,
      updated: 0,
      removed: 0,
      conflicts: 1,
      errors: [],
    });
    expect(await pathExists(installedPath)).toBe(false);
    expect(await pathExists(protectedPath)).toBe(false);
    expect(
      JSON.parse(await readTextFile(config.manifest.path)).records,
    ).toEqual([]);

    const afterProtectionExpires = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
    });
    expect(afterProtectionExpires).toMatchObject({
      installed: 1,
      conflicts: 0,
      errors: [],
    });
    expect(await pathExists(installedPath)).toBe(true);
  });

  it("blocks an explicit force overwrite that contains a reconciled foreign child", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    const name = "protected";
    const installedPath = path.join(config.targets.claude.skillsHome, name);
    const foreignPath = path.join(installedPath, "foreign.md");
    await mkdir(config.library.skillsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, name);
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(installedPath, { recursive: true });
    await writeFile(foreignPath, "foreign child bytes", "utf-8");
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
    const manifestBefore = await readTextFile(config.manifest.path);

    const dryRun = await sync(config, {
      dryRun: true,
      force: true,
      strict: false,
      reconcileManifest: true,
    });

    expect(dryRun).toMatchObject({
      installed: 0,
      updated: 0,
      removed: 0,
      skipped: 0,
      conflicts: 0,
      errors: [],
    });
    expect(testLogger.infos.join("\n")).toContain(
      "[skip-conflict] claude/skill/protected",
    );
    expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
    expect(await readTextFile(foreignPath)).toBe("foreign child bytes");
    expect(
      (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
        entry.includes(".backup-"),
      ),
    ).toHaveLength(0);

    const result = await sync(config, {
      dryRun: false,
      force: true,
      strict: false,
      reconcileManifest: true,
    });

    expect(result).toMatchObject({
      installed: 0,
      updated: 0,
      removed: 0,
      conflicts: 1,
      errors: [],
    });
    expect(await readTextFile(foreignPath)).toBe("foreign child bytes");
    expect(
      JSON.parse(await readTextFile(config.manifest.path)).records,
    ).toEqual([]);
    expect(
      (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
        entry.includes(".backup-"),
      ),
    ).toHaveLength(1);
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

  it.skipIf(!symlinkAvailable)(
    "rejects a selected target output that collides with a retained other-target record before writes",
    async () => {
      const scenarios = ["absent", "existing", "dangling"] as const;

      for (const state of scenarios) {
        const scenarioDir = path.join(tempDir, state);
        const sharedSkillsHome = path.join(
          scenarioDir,
          "home",
          "shared-skills",
        );
        const config = makeResolvedConfig(scenarioDir, {
          claude: { skillsHome: sharedSkillsHome },
          codex: { skillsHome: sharedSkillsHome },
        });
        const name = "shared-skill";
        const installedPath = path.join(sharedSkillsHome, name);
        const generatedSentinel = path.join(
          config.library.generatedDir,
          "claude",
          "skills",
          name,
          "sentinel.txt",
        );

        await mkdir(config.library.skillsDir, { recursive: true });
        await mkdir(config.library.agentsDir, { recursive: true });
        await createSkillFixture(config.library.skillsDir, name);
        await mkdir(path.dirname(config.manifest.path), { recursive: true });
        await mkdir(path.dirname(generatedSentinel), { recursive: true });
        await writeFile(generatedSentinel, "generated sentinel", "utf-8");
        await writeFile(
          config.manifest.path,
          makeManifestJson(
            [
              {
                target: "codex",
                type: "skill",
                name,
                sourcePath: path.join(config.library.skillsDir, name),
                generatedPath: null,
                installedPath,
                installMode: "copy",
                contentHash: "retained",
                timestamp: new Date().toISOString(),
              },
            ],
            { config },
          ),
          "utf-8",
        );
        const manifestBefore = await readTextFile(config.manifest.path);

        if (state === "existing") {
          await mkdir(installedPath, { recursive: true });
          await writeFile(
            path.join(installedPath, "sentinel.txt"),
            "installed sentinel",
            "utf-8",
          );
        }
        if (state === "dangling") {
          await mkdir(path.dirname(installedPath), { recursive: true });
          await symlink(
            path.join(scenarioDir, "missing-target"),
            installedPath,
            "dir",
          );
        }

        await expect(
          sync(config, {
            dryRun: false,
            force: false,
            strict: false,
            target: "claude",
          }),
        ).rejects.toThrow("Managed output physical path conflict");

        expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
        expect(await readTextFile(generatedSentinel)).toBe(
          "generated sentinel",
        );
        if (state === "absent") {
          expect(await pathExists(installedPath)).toBe(false);
        }
        if (state === "existing") {
          expect(
            await readTextFile(path.join(installedPath, "sentinel.txt")),
          ).toBe("installed sentinel");
        }
        if (state === "dangling") {
          expect((await lstat(installedPath)).isSymbolicLink()).toBe(true);
          expect(await readlink(installedPath)).toBe(
            path.join(scenarioDir, "missing-target"),
          );
          expect(
            await pathExists(path.join(scenarioDir, "missing-target")),
          ).toBe(false);
        }
      }
    },
  );

  it("rejects retained output collisions regardless of overwrite or dry-run options", async () => {
    const scenarios = [
      {
        name: "default",
        defaults: {},
        options: { dryRun: false, force: false },
      },
      {
        name: "force",
        defaults: {},
        options: { dryRun: false, force: true },
      },
      {
        name: "configured-overwrite-all",
        defaults: { overwritePolicy: "overwrite-all" as const },
        options: { dryRun: false, force: false },
      },
      {
        name: "dry-run",
        defaults: {},
        options: { dryRun: true, force: false },
      },
    ];

    for (const scenario of scenarios) {
      const scenarioDir = path.join(tempDir, scenario.name);
      const sharedSkillsHome = path.join(scenarioDir, "home", "shared-skills");
      const config = makeResolvedConfig(scenarioDir, {
        claude: { skillsHome: sharedSkillsHome },
        codex: { skillsHome: sharedSkillsHome },
        defaults: scenario.defaults,
      });
      const name = "shared-skill";
      const installedPath = path.join(sharedSkillsHome, name);
      const generatedSentinel = path.join(
        config.library.generatedDir,
        "claude",
        "skills",
        name,
        "sentinel.txt",
      );

      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      await createSkillFixture(config.library.skillsDir, name);
      await mkdir(installedPath, { recursive: true });
      await writeFile(
        path.join(installedPath, "sentinel.txt"),
        "installed sentinel",
        "utf-8",
      );
      await mkdir(path.dirname(generatedSentinel), { recursive: true });
      await writeFile(generatedSentinel, "generated sentinel", "utf-8");
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await writeFile(
        config.manifest.path,
        makeManifestJson(
          [
            {
              target: "codex",
              type: "skill",
              name,
              sourcePath: path.join(config.library.skillsDir, name),
              generatedPath: null,
              installedPath,
              installMode: "copy",
              contentHash: "retained",
              timestamp: new Date().toISOString(),
            },
          ],
          { config },
        ),
        "utf-8",
      );
      const manifestBefore = await readTextFile(config.manifest.path);

      await expect(
        sync(config, {
          ...scenario.options,
          strict: false,
          target: "claude",
        }),
      ).rejects.toThrow("Managed output physical path conflict");

      expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
      expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
      expect(await readTextFile(path.join(installedPath, "sentinel.txt"))).toBe(
        "installed sentinel",
      );
    }
  });

  it.each([
    ["absent dry-run", false, true, false],
    ["existing explicit force", true, false, true],
  ] as const)(
    "reserves an agent destination that is the exact manifest path: %s",
    async (_label, existingManifest, dryRun, force) => {
      const scenarioDir = path.join(tempDir, `manifest-agent-${_label}`);
      const agentsHome = path.join(scenarioDir, "state");
      const manifestPath = path.join(agentsHome, "helper.md");
      const config = makeResolvedConfig(scenarioDir, {
        claude: { agentsHome },
        codex: { enabled: false },
        manifest: { path: manifestPath },
      });
      await mkdir(config.library.skillsDir, { recursive: true });
      await createAgentFixture(
        config.library.agentsDir,
        "helper",
        makeAgentYaml("helper"),
      );
      const manifestBytes = makeManifestJson([], { config });
      if (existingManifest) {
        await mkdir(path.dirname(manifestPath), { recursive: true });
        await writeFile(manifestPath, manifestBytes, "utf-8");
      }
      const generatedPath = path.join(
        config.library.generatedDir,
        "claude",
        "agents",
        "helper.md",
      );

      await expect(
        sync(config, { dryRun, force, strict: false, target: "claude" }),
      ).rejects.toThrow("Managed output physical path conflict");

      expect(await pathExists(generatedPath)).toBe(false);
      expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
      expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
      expect(testLogger.infos).toEqual([]);
      if (existingManifest) {
        expect(await readTextFile(manifestPath)).toBe(manifestBytes);
        expect(await readdir(agentsHome)).toEqual(["helper.md"]);
      } else {
        expect(await pathExists(manifestPath)).toBe(false);
        expect(await pathExists(agentsHome)).toBe(false);
      }
    },
  );

  it.each(["copy", "symlink"] as const)(
    "reserves a manifest nested below a selected skill ancestor in %s mode",
    async (mode) => {
      const scenarioDir = path.join(tempDir, `manifest-skill-ancestor-${mode}`);
      const skillsHome = path.join(scenarioDir, "home", "skills");
      const name = "control-skill";
      const installedPath = path.join(skillsHome, name);
      const manifestPath = path.join(installedPath, "state", "manifest.json");
      const config = makeResolvedConfig(scenarioDir, {
        claude: { skillsHome, installMode: mode },
        codex: { enabled: false },
        defaults: { overwritePolicy: "overwrite-all" },
        manifest: { path: manifestPath },
      });
      await mkdir(config.library.agentsDir, { recursive: true });
      await createSkillFixture(config.library.skillsDir, name);
      await mkdir(path.dirname(manifestPath), { recursive: true });
      const manifestBytes = makeManifestJson([], { config });
      await writeFile(manifestPath, manifestBytes, "utf-8");
      const sentinelPath = path.join(installedPath, "installed-sentinel.txt");
      await writeFile(sentinelPath, "installed sentinel", "utf-8");
      const generatedPath = path.join(
        config.library.generatedDir,
        "claude",
        "skills",
        name,
      );

      await expect(
        sync(config, {
          dryRun: false,
          force: false,
          strict: false,
          target: "claude",
          mode,
        }),
      ).rejects.toThrow("Managed output physical path conflict");

      expect(await readTextFile(manifestPath)).toBe(manifestBytes);
      expect(await readTextFile(sentinelPath)).toBe("installed sentinel");
      expect((await lstat(installedPath)).isDirectory()).toBe(true);
      expect(await pathExists(generatedPath)).toBe(false);
      expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
      expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
    },
  );

  it("rejects a dry selected skill below the manifest control path before preview", async () => {
    const scenarioDir = path.join(tempDir, "control-dry-descendant");
    const manifestPath = path.join(scenarioDir, "state", "manifest.json");
    const skillName = "nested-skill";
    const skillsHome = path.join(manifestPath, "managed");
    const config = makeResolvedConfig(scenarioDir, {
      claude: { skillsHome },
      codex: { enabled: false },
      manifest: { path: manifestPath },
    });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, skillName);
    const installedPath = path.join(skillsHome, skillName);
    expect(path.relative(manifestPath, installedPath)).toBe(
      path.join("managed", skillName),
    );

    await expect(
      sync(config, {
        dryRun: true,
        force: true,
        strict: false,
        target: "claude",
      }),
    ).rejects.toThrow("Managed output physical path conflict");

    expect(testLogger.infos).toEqual([]);
    expect(await pathExists(manifestPath)).toBe(false);
    expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
    expect(await pathExists(installedPath)).toBe(false);
    expect(await pathExists(config.library.generatedDir)).toBe(false);
  });

  it("reserves an active retained control collision but permits the same passive record", async () => {
    for (const control of ["manifest", "manifest-lock"] as const) {
      for (const target of ["claude", "codex"] as const) {
        testLogger.infos.length = 0;
        testLogger.warnings.length = 0;
        const scenarioDir = path.join(
          tempDir,
          `retained-control-${control}-${target}`,
        );
        const controlHome = path.join(scenarioDir, "state");
        const manifestPath =
          control === "manifest"
            ? path.join(controlHome, "helper.md")
            : path.join(controlHome, "manifest.json");
        const installedPath =
          control === "manifest" ? manifestPath : `${manifestPath}.lock`;
        const type = control === "manifest" ? "agent" : "skill";
        const name =
          control === "manifest" ? "helper" : path.basename(installedPath);
        const config = makeResolvedConfig(scenarioDir, {
          claude:
            control === "manifest"
              ? { agentsHome: controlHome }
              : { skillsHome: controlHome },
          manifest: { path: manifestPath },
        });
        await mkdir(config.library.skillsDir, { recursive: true });
        await mkdir(config.library.agentsDir, { recursive: true });
        await mkdir(path.dirname(manifestPath), { recursive: true });
        const manifestBytes = makeManifestJson(
          [
            {
              target: "claude",
              type,
              name,
              sourcePath:
                type === "agent"
                  ? path.join(config.library.agentsDir, "helper.yaml")
                  : path.join(config.library.skillsDir, name),
              generatedPath:
                type === "agent"
                  ? path.join(
                      config.library.generatedDir,
                      "claude",
                      "agents",
                      "helper.md",
                    )
                  : null,
              installedPath,
              installMode: "copy",
              contentHash: "retained",
              timestamp: new Date().toISOString(),
            },
          ],
          { config },
        );
        await writeFile(manifestPath, manifestBytes, "utf-8");

        if (target === "claude") {
          await expect(
            sync(config, {
              dryRun: true,
              force: false,
              strict: false,
              target,
            }),
          ).rejects.toThrow("Managed output physical path conflict");
          expect(testLogger.infos).toEqual([]);
        } else {
          const result = await sync(config, {
            dryRun: true,
            force: false,
            strict: false,
            target,
          });
          expect(result).toMatchObject({
            installed: 0,
            updated: 0,
            removed: 0,
            errors: [],
          });
        }
        expect(await readTextFile(manifestPath)).toBe(manifestBytes);
        expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
        expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
      }
    }
  });

  it("rejects a legacy retained output collision before binding or generated writes", async () => {
    const sharedSkillsHome = path.join(tempDir, "home", "shared-skills");
    const config = makeResolvedConfig(tempDir, {
      claude: { skillsHome: sharedSkillsHome },
      codex: { skillsHome: sharedSkillsHome },
    });
    const name = "shared-skill";
    const installedPath = path.join(sharedSkillsHome, name);
    const generatedSentinel = path.join(
      config.library.generatedDir,
      "claude",
      "skills",
      name,
      "sentinel.txt",
    );
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, name);
    await mkdir(path.dirname(generatedSentinel), { recursive: true });
    await writeFile(generatedSentinel, "generated sentinel", "utf-8");
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "codex",
            type: "skill",
            sourcePath: path.join(config.library.skillsDir, name),
            generatedPath: null,
            installedPath,
            installMode: "copy",
            contentHash: "retained",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );
    const manifestBefore = await readTextFile(config.manifest.path);

    await expect(
      sync(config, {
        dryRun: false,
        force: false,
        strict: false,
        target: "claude",
      }),
    ).rejects.toThrow("Managed output physical path conflict");

    expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
    expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
    expect(await pathExists(installedPath)).toBe(false);
  });

  it("allows an exact retained identity to match its selected target output", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    const name = "shared-skill";
    const installedPath = path.join(config.targets.claude.skillsHome, name);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, name);
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "skill",
            name,
            sourcePath: path.join(config.library.skillsDir, name),
            generatedPath: null,
            installedPath,
            installMode: "copy",
            contentHash: "previous",
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
      target: "claude",
    });

    expect(result.errors).toEqual([]);
    expect(result.installed).toBe(1);
    expect(await pathExists(installedPath)).toBe(true);
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
