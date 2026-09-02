import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { RUNTIME_CONFIG_SCHEMA } from "../config/runtime-config.js";
import type { ResolvedConfig } from "../config/schema.js";
import type { RenderedSkill } from "../models/types.js";
import type { AcceptedProvider } from "../runtime-build/provider.js";
import {
  RUNTIME_BASH_RESOLVER,
  RUNTIME_ENTRYPOINT,
  RUNTIME_JS_DIR,
  type RuntimeAdapterPair,
  type ValidatedDevcanonRuntime,
} from "../validate/devcanon-runtime.js";
import { DEVCANON_RUNTIME_SKILL_NAME } from "../validate/skills.js";
import { normalizePackagedShellBytes } from "./packaged-shell.js";

const PROVIDER_LEAVES = [
  "devcanon-runtime.mjs",
  "runtime-manifest.json",
  "THIRD_PARTY_LICENSES",
] as const;

export interface RuntimeCompositionOptions {
  readonly provider?: AcceptedProvider;
  readonly adapterPair?: RuntimeAdapterPair;
}

export async function renderDevcanonRuntimeForTarget(
  runtimeDir: string,
  target: "claude" | "codex",
  config: ResolvedConfig,
  contentHash?: string,
  validatedRuntime?: ValidatedDevcanonRuntime,
): Promise<RenderedSkill> {
  const generatedPath = path.join(
    config.library.generatedDir,
    target,
    "skills",
    DEVCANON_RUNTIME_SKILL_NAME,
  );
  return {
    target,
    type: "skill",
    name: DEVCANON_RUNTIME_SKILL_NAME,
    sourcePath: runtimeDir,
    generatedPath,
    installedPath: path.join(
      config.targets[target].skillsHome,
      DEVCANON_RUNTIME_SKILL_NAME,
    ),
    content: "",
    contentHash:
      contentHash ??
      (await hashDevcanonRuntimePayload(runtimeDir, config, validatedRuntime)),
  };
}

/** Hashes the exact captured composition inputs, never reopening provider leaves. */
export async function hashDevcanonRuntimePayload(
  runtimeDir: string,
  config: ResolvedConfig,
  validatedRuntime?: ValidatedDevcanonRuntime,
): Promise<string> {
  const validated = validatedRuntime;
  const hash = createHash("sha256");
  const adapterPair =
    validated?.adapterPair ?? (await readAdapterPair(runtimeDir));
  const leaves =
    validated?.providerLeaves ?? (await readProviderLeaves(runtimeDir));
  const shellMode =
    validated?.adapterPair?.shellMode ??
    (await lstat(path.join(runtimeDir, RUNTIME_ENTRYPOINT))).mode;
  const catalogMode = (
    await lstat(path.join(runtimeDir, "config", "runtime-config.json"))
  ).mode;
  hashField(hash, "file", RUNTIME_ENTRYPOINT, String(shellMode));
  hashField(
    hash,
    "bytes",
    RUNTIME_ENTRYPOINT,
    normalizePackagedShellBytes(RUNTIME_ENTRYPOINT, adapterPair.shell),
  );
  hashField(
    hash,
    "file",
    RUNTIME_BASH_RESOLVER,
    String(
      validated?.adapterPair?.resolverMode ??
        (await lstat(path.join(runtimeDir, RUNTIME_BASH_RESOLVER))).mode,
    ),
  );
  hashField(hash, "bytes", RUNTIME_BASH_RESOLVER, adapterPair.resolver);
  const catalog = renderedRuntimeCatalog(config);
  hashField(hash, "file", "config/runtime-config.json", String(catalogMode));
  hashField(hash, "bytes", "config/runtime-config.json", catalog);
  for (const leaf of PROVIDER_LEAVES) {
    hashField(hash, "file", path.posix.join(RUNTIME_JS_DIR, leaf), "0");
    hashField(
      hash,
      "bytes",
      path.posix.join(RUNTIME_JS_DIR, leaf),
      leaves.get(leaf) ?? Buffer.alloc(0),
    );
  }
  return hash.digest("hex");
}

/** Renderer-owned, whole-subtree materialization from an accepted snapshot. */
export async function reconcileDevcanonRuntimeSubtree(
  runtimeDir: string,
  provider: AcceptedProvider,
): Promise<void> {
  const destination = path.join(runtimeDir, RUNTIME_JS_DIR);
  const stage = await mkdtemp(
    path.join(path.dirname(destination), ".runtime-stage-"),
  );
  try {
    await writeProviderLeaves(stage, providerLeaves(provider));
    await assertStagedBundle(stage);
    await replaceDirectory(stage, destination);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Bounded PR-ADAPT publication. Staging validates a coherent pair plus
 * subtree, and publication touches only the owned pair and runtime directory.
 */
export async function reconcileDevcanonRuntimeSource(
  runtimeDir: string,
  provider: AcceptedProvider,
  validatedRuntime: ValidatedDevcanonRuntime,
): Promise<void> {
  await assertSnapshotRuntimeDir(runtimeDir, validatedRuntime);
  const adapterPair = validatedRuntime.adapterPair;
  if (!sameAdapterPair(adapterPair, validatedRuntime.authoritativeAdapterPair))
    throw new Error(
      "source reconciliation adapter pair does not match the authoritative validated snapshot",
    );
  const destination = path.join(runtimeDir, "scripts");
  const stage = await mkdtemp(
    path.join(path.dirname(destination), ".runtime-source-stage-"),
  );
  try {
    await writeFile(
      path.join(stage, "devcanon-runtime.sh"),
      normalizePackagedShellBytes(RUNTIME_ENTRYPOINT, adapterPair.shell),
    );
    if (process.platform !== "win32")
      await chmod(
        path.join(stage, "devcanon-runtime.sh"),
        adapterPair.shellMode,
      );
    await writeFile(path.join(stage, "resolve-bash.mjs"), adapterPair.resolver);
    if (process.platform !== "win32")
      await chmod(
        path.join(stage, "resolve-bash.mjs"),
        adapterPair.resolverMode,
      );
    await writeProviderLeaves(
      path.join(stage, "runtime"),
      providerLeaves(provider),
    );
    await assertStagedRuntime(stage);
    await publishStagedSourceParts(stage, destination);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

async function publishStagedSourceParts(
  stage: string,
  destination: string,
): Promise<void> {
  const owned = ["devcanon-runtime.sh", "resolve-bash.mjs", "runtime"] as const;
  const backups = new Map<string, string>();
  const backupRoot = await mkdtemp(
    path.join(destination, ".devcanon-runtime-operation-"),
  );
  let published = false;
  try {
    for (const leaf of owned) {
      const target = path.join(destination, leaf);
      const backup = path.join(backupRoot, leaf);
      await rename(target, backup).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      backups.set(target, backup);
    }
    for (const leaf of owned)
      await rename(path.join(stage, leaf), path.join(destination, leaf));
    published = true;
    // Publication is now a complete validated new composition. Cleanup owns
    // only its unique paths and must not turn that success into a partial
    // rollback when a best-effort removal is unavailable.
    await rm(backupRoot, { recursive: true, force: true }).catch(
      () => undefined,
    );
    await rm(stage, { recursive: true, force: true }).catch(() => undefined);
  } catch (error) {
    if (!published) {
      const restored = await restoreOwnedSourceParts(
        owned,
        destination,
        backups,
        backupRoot,
      );
      if (!restored) {
        // The old composition remains in this operation-owned root for
        // diagnosis/recovery. Never erase it after a failed restoration.
        throw new Error(
          `runtime source publication failed and retained its operation backup: ${(error as Error).message}`,
        );
      }
    }
    await rm(backupRoot, { recursive: true, force: true }).catch(
      () => undefined,
    );
    throw error;
  }
}

async function restoreOwnedSourceParts(
  owned: readonly string[],
  destination: string,
  backups: ReadonlyMap<string, string>,
  backupRoot: string,
): Promise<boolean> {
  const displacedRoot = path.join(backupRoot, "new");
  await mkdir(displacedRoot, { recursive: true });
  let restored = true;
  for (const leaf of owned) {
    const target = path.join(destination, leaf);
    const backup = backups.get(target);
    if (backup === undefined) continue;
    const displaced = path.join(displacedRoot, leaf);
    const targetExists = await lstat(target).then(
      () => true,
      () => false,
    );
    try {
      // Preserve any newly published leaf before attempting restoration; a
      // failed old->live rename can put that complete leaf back in place.
      if (targetExists) await rename(target, displaced);
      await rename(backup, target);
    } catch {
      const liveMissing = await lstat(target).then(
        () => false,
        () => true,
      );
      if (liveMissing) {
        // A bounded retry covers the handled publication seam where the
        // first restoration rename fails transiently. The old leaf remains
        // in our backup until this succeeds.
        const retried = await rename(backup, target).then(
          () => true,
          () => false,
        );
        if (retried) continue;
        await rename(displaced, target).catch(() => undefined);
      }
      restored = false;
    }
  }
  return restored;
}

/** Writes precisely the rendered six-file composition through a complete staged tree. */
export async function writeRenderedDevcanonRuntime(
  runtimeDir: string,
  generatedPath: string,
  config: ResolvedConfig,
  validatedRuntime?: ValidatedDevcanonRuntime,
): Promise<void> {
  const validated = validatedRuntime;
  const pair = validated?.adapterPair ?? (await readAdapterPair(runtimeDir));
  const leaves =
    validated?.providerLeaves ?? (await readProviderLeaves(runtimeDir));
  const shellMode =
    validated?.adapterPair?.shellMode ??
    (await lstat(path.join(runtimeDir, RUNTIME_ENTRYPOINT))).mode & 0o777;
  await mkdir(path.dirname(generatedPath), { recursive: true });
  const stage = await mkdtemp(
    path.join(path.dirname(generatedPath), ".runtime-render-stage-"),
  );
  try {
    await mkdir(path.join(stage, "config"), { recursive: true });
    await mkdir(path.join(stage, "scripts", "runtime"), { recursive: true });
    await writeFile(
      path.join(stage, "config", "runtime-config.json"),
      renderedRuntimeCatalog(config),
    );
    await writeFile(
      path.join(stage, RUNTIME_ENTRYPOINT),
      normalizePackagedShellBytes(RUNTIME_ENTRYPOINT, pair.shell),
    );
    if (process.platform !== "win32")
      await chmod(path.join(stage, RUNTIME_ENTRYPOINT), shellMode);
    await writeFile(path.join(stage, RUNTIME_BASH_RESOLVER), pair.resolver);
    if (process.platform !== "win32")
      await chmod(path.join(stage, RUNTIME_BASH_RESOLVER), pair.resolverMode);
    await writeProviderLeaves(path.join(stage, RUNTIME_JS_DIR), leaves);
    if (validated?.adapterPair !== undefined) {
      await assertStagedRuntime(path.join(stage, "scripts"));
    }
    await replaceDirectory(stage, generatedPath);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

function providerLeaves(
  provider: AcceptedProvider,
): ReadonlyMap<string, Buffer> {
  return new Map([
    ["devcanon-runtime.mjs", provider.bundle.copy()],
    ["runtime-manifest.json", provider.manifestBytes.copy()],
    ["THIRD_PARTY_LICENSES", provider.licenses.copy()],
  ]);
}

function sameAdapterPair(
  left: RuntimeAdapterPair,
  right: RuntimeAdapterPair,
): boolean {
  return (
    left.shell.equals(right.shell) &&
    left.resolver.equals(right.resolver) &&
    left.shellMode === right.shellMode &&
    left.resolverMode === right.resolverMode
  );
}

async function assertSnapshotRuntimeDir(
  runtimeDir: string,
  snapshot: ValidatedDevcanonRuntime,
): Promise<void> {
  const physicalRuntimeDir = await realpath(runtimeDir);
  if (physicalRuntimeDir !== snapshot.runtimeIdentity) {
    throw new Error(
      "source reconciliation snapshot was validated for a different runtime directory",
    );
  }
}

async function readAdapterPair(
  runtimeDir: string,
): Promise<RuntimeAdapterPair> {
  const { readFile } = await import("node:fs/promises");
  const shellPath = path.join(runtimeDir, RUNTIME_ENTRYPOINT);
  const resolverPath = path.join(runtimeDir, RUNTIME_BASH_RESOLVER);
  const [shell, resolver, shellStat, resolverStat] = await Promise.all([
    readFile(shellPath),
    readFile(resolverPath),
    lstat(shellPath),
    lstat(resolverPath),
  ]);
  return {
    shell,
    resolver,
    shellMode: shellStat.mode & 0o777,
    resolverMode: resolverStat.mode & 0o777,
  };
}

async function readProviderLeaves(
  runtimeDir: string,
): Promise<ReadonlyMap<string, Buffer>> {
  const { readFile } = await import("node:fs/promises");
  return new Map(
    await Promise.all(
      PROVIDER_LEAVES.map(
        async (leaf) =>
          [
            leaf,
            await readFile(path.join(runtimeDir, RUNTIME_JS_DIR, leaf)),
          ] as const,
      ),
    ),
  );
}

async function writeProviderLeaves(
  directory: string,
  leaves: ReadonlyMap<string, Buffer>,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  for (const leaf of PROVIDER_LEAVES)
    await writeFile(
      path.join(directory, leaf),
      leaves.get(leaf) ?? Buffer.alloc(0),
    );
}

async function replaceDirectory(
  stage: string,
  destination: string,
): Promise<void> {
  const backupRoot = await mkdtemp(
    path.join(path.dirname(destination), ".devcanon-runtime-operation-"),
  );
  const backup = path.join(backupRoot, "previous");
  let priorMoved = false;
  let published = false;
  try {
    await rename(destination, backup).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    priorMoved = true;
    await rename(stage, destination);
    published = true;
    await rm(backupRoot, { recursive: true, force: true }).catch(
      () => undefined,
    );
  } catch (error) {
    if (!published && priorMoved) {
      const displaced = path.join(backupRoot, "new");
      const destinationExists = await lstat(destination).then(
        () => true,
        () => false,
      );
      try {
        if (destinationExists) await rename(destination, displaced);
        await rename(backup, destination);
      } catch {
        const liveMissing = await lstat(destination).then(
          () => false,
          () => true,
        );
        if (liveMissing) {
          const retried = await rename(backup, destination).then(
            () => true,
            () => false,
          );
          if (retried) {
            await rm(backupRoot, { recursive: true, force: true }).catch(
              () => undefined,
            );
            throw error;
          }
          await rename(displaced, destination).catch(() => undefined);
        }
        throw new Error(
          `runtime directory publication failed and retained its operation backup: ${(error as Error).message}`,
        );
      }
    }
    await rm(backupRoot, { recursive: true, force: true }).catch(
      () => undefined,
    );
    throw error;
  }
}

async function assertStagedBundle(runtimeDirectory: string): Promise<void> {
  const { stdout } = await promisify(execFile)(process.execPath, [
    path.join(runtimeDirectory, "devcanon-runtime.mjs"),
    "runtime",
    "contract",
  ]);
  assertRuntimeContract(stdout);
}

async function assertStagedRuntime(scriptsDirectory: string): Promise<void> {
  await assertStagedBundle(path.join(scriptsDirectory, "runtime"));
  const { stdout } = await promisify(execFile)("bash", [
    path.join(scriptsDirectory, "devcanon-runtime.sh"),
    "runtime",
    "resolve-bash",
  ]);
  await assertBashExecutable(stdout, "staged shell");
  const { stdout: resolverStdout } = await promisify(execFile)(
    process.execPath,
    [path.join(scriptsDirectory, "resolve-bash.mjs")],
  );
  await assertBashExecutable(resolverStdout, "staged resolver");
}

async function assertBashExecutable(
  stdout: string,
  source: string,
): Promise<void> {
  const executable = stdout.trim();
  if (!path.isAbsolute(executable) || executable.includes("\n"))
    throw new Error(`${source} did not emit an absolute bash path`);
  const stat = await lstat(executable).catch(() => undefined);
  if (stat === undefined || !stat.isFile() || stat.isSymbolicLink())
    throw new Error(`${source} emitted a missing bash path`);
  await access(executable, constants.X_OK).catch(() => {
    throw new Error(`${source} emitted a non-executable bash path`);
  });
}

function assertRuntimeContract(stdout: string): void {
  const value = JSON.parse(stdout) as {
    command_group?: unknown;
    major_version?: unknown;
  };
  if (value.command_group !== "devcanon-runtime" || value.major_version !== 1) {
    throw new Error(
      "staged runtime contract did not match devcanon-runtime/v1",
    );
  }
}

function renderedRuntimeCatalog(config: ResolvedConfig): Buffer {
  return Buffer.from(
    `${JSON.stringify({ schema: RUNTIME_CONFIG_SCHEMA, capabilityProfiles: config.capabilityProfiles }, null, 2)}\n`,
    "utf-8",
  );
}

function hashField(
  hash: ReturnType<typeof createHash>,
  ...fields: Array<string | Buffer>
): void {
  for (const field of fields) {
    const bytes = Buffer.isBuffer(field) ? field : Buffer.from(field, "utf-8");
    hash.update(String(bytes.length));
    hash.update(":");
    hash.update(bytes);
  }
}
