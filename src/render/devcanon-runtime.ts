import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  const shellMode = (await lstat(path.join(runtimeDir, RUNTIME_ENTRYPOINT)))
    .mode;
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
    String((await lstat(path.join(runtimeDir, RUNTIME_BASH_RESOLVER))).mode),
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
    await replaceDirectory(stage, destination);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Bounded PR-ADAPT publication. The replacement is a complete scripts tree,
 * so no live adapter or provider leaf is repaired independently.
 */
export async function reconcileDevcanonRuntimeSource(
  runtimeDir: string,
  provider: AcceptedProvider,
  adapterPair: RuntimeAdapterPair,
  shellMode = 0o755,
): Promise<void> {
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
      await chmod(path.join(stage, "devcanon-runtime.sh"), shellMode);
    await writeFile(path.join(stage, "resolve-bash.mjs"), adapterPair.resolver);
    await writeProviderLeaves(
      path.join(stage, "runtime"),
      providerLeaves(provider),
    );
    await replaceDirectory(stage, destination);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
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
    await writeProviderLeaves(path.join(stage, RUNTIME_JS_DIR), leaves);
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

async function readAdapterPair(
  runtimeDir: string,
): Promise<RuntimeAdapterPair> {
  const { readFile } = await import("node:fs/promises");
  return {
    shell: await readFile(path.join(runtimeDir, RUNTIME_ENTRYPOINT)),
    resolver: await readFile(path.join(runtimeDir, RUNTIME_BASH_RESOLVER)),
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
  const backup = `${destination}.prior`;
  await rm(backup, { recursive: true, force: true });
  let priorMoved = false;
  try {
    await rename(destination, backup).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    priorMoved = true;
    await rename(stage, destination);
    await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (priorMoved) await rename(backup, destination).catch(() => undefined);
    throw error;
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
