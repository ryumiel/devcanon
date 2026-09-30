import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect } from "vitest";
import type { ResolvedConfig } from "../config/schema.js";
import { diffAll } from "../diff/diff.js";
import { resolveEffectiveInstallMode } from "../install/mode.js";
import { sync } from "../install/sync.js";
import type { RenderedOutput, SyncOptions } from "../models/types.js";
import { renderDevcanonRuntimeForTarget } from "../render/devcanon-runtime.js";
import { renderAll, renderLoaded } from "../render/pipeline.js";
import type { AcceptedProvider } from "../runtime-build/provider.js";
import { pathExists } from "../utils/fs.js";
import { loadAndValidateAgents } from "../validate/agents.js";
import { loadAndValidateSkills } from "../validate/skills.js";
import {
  cleanupTempDir,
  copyDevcanonRuntimeFixture,
  createTempDir,
  makeManifestJson,
  makeResolvedConfig,
} from "./fixtures.js";
import { type TestLoggerResult, installTestLogger } from "./logger.js";

// Each calling file owns this context and its immutable template. Vitest's
// ordinary file isolation keeps logger, cwd and persistence faults independent.
export function useSyncFixture() {
  let templateRoot: string;
  let runtimeTemplate: string;
  let provider: AcceptedProvider;
  let runtimeOutput: RenderedOutput;
  let sourceSnapshot: Awaited<ReturnType<typeof snapshotTree>>;
  let templateConfig: ResolvedConfig;
  let tempDir: string;
  let testLogger: TestLoggerResult;
  let restoreLogger: (() => void) | undefined;

  beforeAll(async () => {
    templateRoot = await createTempDir();
    templateConfig = makeResolvedConfig(templateRoot);
    runtimeTemplate = path.join(
      templateConfig.library.skillsDir,
      "devcanon-runtime",
    );
    provider = await copyDevcanonRuntimeFixture(
      templateConfig.library.skillsDir,
    );
    const rendered = await renderAll(
      templateConfig,
      provider,
      true,
      false,
      "claude",
    );
    const output = rendered.outputs.find(
      (item) => item.target === "claude" && item.name === "devcanon-runtime",
    );
    if (!output) throw new Error("Runtime template output missing");
    runtimeOutput = output;
    sourceSnapshot = await snapshotTree(runtimeTemplate);
  });

  async function seedPassiveRuntime(config: ResolvedConfig) {
    const destination = path.join(config.library.skillsDir, "devcanon-runtime");
    if (!(await pathExists(destination))) {
      await cp(runtimeTemplate, destination, {
        recursive: true,
        verbatimSymlinks: true,
      });
    }
  }

  beforeEach(async () => {
    tempDir = await createTempDir();
    await seedPassiveRuntime(makeResolvedConfig(tempDir));
    const installed = installTestLogger();
    restoreLogger = installed.restore;
    testLogger = installed.testLogger;
  });

  afterEach(async () => {
    restoreLogger?.();
    await cleanupTempDir(tempDir);
  });

  afterAll(async () => {
    await cleanupTempDir(templateRoot);
  });

  // Arrange an initial installed state only. Tests still call the complete sync
  // operation for the mutation under examination. Immutable runtime bytes come
  // from the real renderer; ordinary skills/agents use their owning renderer.
  async function seedInstalled(config: ResolvedConfig, options: SyncOptions) {
    if (options.dryRun || options.force || options.reconcileManifest) {
      throw new Error("Installed fixtures require ordinary initial setup");
    }
    await assertInitialPathAbsent(config.manifest.path);
    expect(config.capabilityProfiles).toEqual(
      templateConfig.capabilityProfiles,
    );
    expect(
      await snapshotTree(
        path.join(config.library.skillsDir, "devcanon-runtime"),
      ),
    ).toEqual(sourceSnapshot);

    const skills = await loadAndValidateSkills(config.library.skillsDir);
    const agents = await loadAndValidateAgents(
      config.library.agentsDir,
      skills,
      {
        strict: options.strict,
        codexEnabled: config.targets.codex.enabled,
      },
    );
    const { outputs } = await renderLoaded({
      config,
      skills,
      agents,
      targetFilter: options.target,
    });
    const ordered: RenderedOutput[] = [];
    for (const target of ["claude", "codex"] as const) {
      if (
        !config.targets[target].enabled ||
        (options.target && options.target !== target)
      )
        continue;
      ordered.push(...outputs.filter((output) => output.target === target));
      ordered.push(
        await renderDevcanonRuntimeForTarget(
          path.join(config.library.skillsDir, "devcanon-runtime"),
          target,
          config,
          runtimeOutput.contentHash,
        ),
      );
    }
    for (const output of ordered) {
      await assertInitialPathAbsent(output.installedPath);
      await assertInitialPathAbsent(output.generatedPath);
    }
    await renderLoaded({
      config,
      skills,
      agents,
      targetFilter: options.target,
      writeToGenerated: true,
    });
    const records = [];
    for (const output of ordered) {
      if (output.name === "devcanon-runtime") {
        await mkdir(path.dirname(output.generatedPath), { recursive: true });
        await cp(runtimeOutput.generatedPath, output.generatedPath, {
          recursive: true,
          verbatimSymlinks: true,
        });
      }
      const installMode = resolveEffectiveInstallMode(
        output.target,
        output.type,
        options.mode ?? config.targets[output.target].installMode,
      );
      await mkdir(path.dirname(output.installedPath), { recursive: true });
      if (installMode === "symlink") {
        await symlink(
          output.generatedPath,
          output.installedPath,
          output.type === "skill" ? "dir" : "file",
        );
      } else {
        await cp(output.generatedPath, output.installedPath, {
          recursive: output.type === "skill",
          verbatimSymlinks: true,
        });
      }
      records.push({
        name: output.name,
        target: output.target,
        type: output.type,
        sourcePath: output.sourcePath,
        generatedPath: output.generatedPath,
        installedPath: output.installedPath,
        installMode,
        contentHash: output.contentHash,
        timestamp: new Date().toISOString(),
      });
    }
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(records, { config }),
    );
  }

  async function installedSnapshot(config: ResolvedConfig) {
    const manifest = JSON.parse(await readFile(config.manifest.path, "utf8"));
    manifest.lastSync = undefined;
    for (const record of manifest.records) record.timestamp = undefined;
    const roots = [
      config.library.generatedDir,
      ...["claude", "codex"].flatMap((target) => {
        const homes = config.targets[target as "claude" | "codex"];
        return homes.enabled ? [homes.agentsHome, homes.skillsHome] : [];
      }),
    ];
    return { manifest, trees: await Promise.all(roots.map(snapshotTree)) };
  }

  // Existing fresh-copy and fresh-symlink cases prove this arrangement against
  // a real installation at the exact same paths, including every runtime leaf,
  // mode, link destination, content hash and manifest boundary.
  async function expectSeedMatches(
    config: ResolvedConfig,
    options: SyncOptions,
  ) {
    const actual = await installedSnapshot(config);
    await rm(config.library.generatedDir, { recursive: true, force: true });
    for (const target of ["claude", "codex"] as const) {
      if (!config.targets[target].enabled) continue;
      await rm(config.targets[target].agentsHome, {
        recursive: true,
        force: true,
      });
      await rm(config.targets[target].skillsHome, {
        recursive: true,
        force: true,
      });
    }
    await rm(config.manifest.path);
    await seedInstalled(config, options);
    expect(await installedSnapshot(config)).toEqual(actual);
  }

  return {
    get tempDir() {
      return tempDir;
    },
    get testLogger() {
      return testLogger;
    },
    seedPassiveRuntime,
    seedInstalled,
    expectSeedMatches,
    sync: (
      config: ResolvedConfig,
      options: SyncOptions,
      acceptedProvider: Parameters<typeof sync>[2] = provider,
    ) => sync(config, options, acceptedProvider),
    renderAll: (
      config: ResolvedConfig,
      writeToGenerated = true,
      strict = false,
      targetFilter?: "claude" | "codex",
    ) => renderAll(config, provider, writeToGenerated, strict, targetFilter),
    diffAll: (
      config: ResolvedConfig,
      targetFilter?: "claude" | "codex",
      strict = false,
    ) => diffAll(config, targetFilter, strict, provider),
  };
}

async function snapshotTree(root: string): Promise<unknown[]> {
  const entries: unknown[] = [];
  async function visit(current: string) {
    const info = await lstat(current);
    const relative = path.relative(root, current);
    if (info.isSymbolicLink()) {
      entries.push({
        relative,
        kind: "symlink",
        target: await readlink(current),
      });
    } else if (info.isDirectory()) {
      entries.push({
        relative,
        kind: "directory",
        mode: process.platform === "win32" ? 0 : info.mode & 0o777,
      });
      for (const name of (await readdir(current)).sort())
        await visit(path.join(current, name));
    } else if (info.isFile()) {
      entries.push({
        relative,
        kind: "file",
        bytes: (await readFile(current)).toString("base64"),
        mode: process.platform === "win32" ? 0 : info.mode & 0o777,
      });
    } else {
      throw new Error("Unsupported installed fixture entry");
    }
  }
  const present = await lstat(root).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return false;
    },
  );
  if (present) await visit(root);
  return entries;
}

async function assertInitialPathAbsent(candidate: string): Promise<void> {
  try {
    await lstat(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Installed fixture path already exists: ${candidate}`);
}
