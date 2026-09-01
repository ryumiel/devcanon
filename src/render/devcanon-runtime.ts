import { createHash } from "node:crypto";
import { lstat, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { RUNTIME_CONFIG_SCHEMA } from "../config/runtime-config.js";
import type { ResolvedConfig } from "../config/schema.js";
import type { RenderedSkill } from "../models/types.js";
import { cloneTree } from "../utils/clone-tree.js";
import { ensureDir } from "../utils/fs.js";
import type { ValidatedDevcanonRuntime } from "../validate/devcanon-runtime.js";
import { DEVCANON_RUNTIME_SKILL_NAME } from "../validate/skills.js";
import {
  normalizePackagedShellBytes,
  normalizePackagedShellTree,
} from "./packaged-shell.js";

export async function renderDevcanonRuntimeForTarget(
  runtimeDir: string,
  target: "claude" | "codex",
  config: ResolvedConfig,
  contentHash?: string,
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
      (await hashRuntimePayload(runtimeDir, renderedRuntimeCatalog(config))),
  };
}

export async function hashDevcanonRuntimePayload(
  runtimeDir: string,
  config: ResolvedConfig,
  validatedRuntime?: ValidatedDevcanonRuntime,
): Promise<string> {
  return hashRuntimePayload(
    runtimeDir,
    renderedRuntimeCatalog(config),
    validatedRuntime,
  );
}

export async function writeRenderedDevcanonRuntime(
  runtimeDir: string,
  generatedPath: string,
  config: ResolvedConfig,
): Promise<void> {
  await rm(generatedPath, { recursive: true, force: true });
  await ensureDir(generatedPath);
  await cloneTree(
    path.join(runtimeDir, "config"),
    path.join(generatedPath, "config"),
  );
  await writeFile(
    path.join(generatedPath, "config", "runtime-config.json"),
    renderedRuntimeCatalog(config),
    "utf-8",
  );
  await cloneTree(
    path.join(runtimeDir, "scripts"),
    path.join(generatedPath, "scripts"),
  );
  await normalizePackagedShellTree(path.join(generatedPath, "scripts"));
}

async function hashRuntimePayload(
  runtimeDir: string,
  catalogBytes: Buffer,
  validatedRuntime?: ValidatedDevcanonRuntime,
): Promise<string> {
  const hash = createHash("sha256");
  const configDirectory = path.join(runtimeDir, "config");
  const configStat = await lstat(configDirectory);
  const catalogPath = path.join(configDirectory, "runtime-config.json");
  const catalogStat = await lstat(catalogPath);
  hashRuntimeField(hash, "directory", "config", String(configStat.mode));
  hashRuntimeField(
    hash,
    "file",
    "config/runtime-config.json",
    String(catalogStat.mode),
  );
  hashRuntimeField(hash, "bytes", "config/runtime-config.json", catalogBytes);

  const scripts = await lstat(path.join(runtimeDir, "scripts"));
  hashRuntimeField(hash, "directory", "scripts", String(scripts.mode));
  await hashRuntimeTree(
    path.join(runtimeDir, "scripts"),
    "scripts",
    hash,
    validatedRuntime,
  );
  return hash.digest("hex");
}

function renderedRuntimeCatalog(config: ResolvedConfig): Buffer {
  return Buffer.from(
    `${JSON.stringify(
      {
        schema: RUNTIME_CONFIG_SCHEMA,
        capabilityProfiles: config.capabilityProfiles,
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
}

async function hashRuntimeTree(
  directory: string,
  relativeDirectory: string,
  hash: ReturnType<typeof createHash>,
  validatedRuntime?: ValidatedDevcanonRuntime,
): Promise<void> {
  const limit = createRuntimeIoLimit(32);
  for (const record of await collectRuntimeTree(
    directory,
    relativeDirectory,
    limit,
    validatedRuntime,
  )) {
    hashRuntimeField(hash, record.kind, record.relativePath, record.mode);
    if (record.bytes) {
      hashRuntimeField(hash, "bytes", record.relativePath, record.bytes);
    }
  }
}

interface RuntimeTreeRecord {
  readonly kind: "directory" | "file";
  readonly relativePath: string;
  readonly mode: string;
  readonly bytes?: Buffer;
}

async function collectRuntimeTree(
  directory: string,
  relativeDirectory: string,
  limit: RuntimeIoLimit,
  validatedRuntime?: ValidatedDevcanonRuntime,
): Promise<RuntimeTreeRecord[]> {
  const entries = await limit(() =>
    readdir(directory, { withFileTypes: true }),
  );
  entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
  const children = await Promise.all(
    entries.map(async (entry): Promise<RuntimeTreeRecord[]> => {
      const sourcePath = path.join(directory, entry.name);
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      if (
        validatedRuntime &&
        relativeDirectory === "scripts/runtime" &&
        (entry.name === "package.json" || entry.name === "node_modules")
      ) {
        return validatedRuntime.closureRecords
          .filter(
            (record) =>
              record.relativePath === entry.name ||
              record.relativePath.startsWith(`${entry.name}/`),
          )
          .map((record) => ({
            ...record,
            relativePath: path.posix.join(
              relativeDirectory,
              record.relativePath,
            ),
          }));
      }
      const stat = await limit(() => lstat(sourcePath));
      if (stat.isDirectory()) {
        return [
          {
            kind: "directory",
            relativePath,
            mode: String(stat.mode),
          },
          ...(await collectRuntimeTree(
            sourcePath,
            relativePath,
            limit,
            validatedRuntime,
          )),
        ];
      }
      if (stat.isFile()) {
        return [
          {
            kind: "file",
            relativePath,
            mode: String(stat.mode),
            bytes: normalizePackagedShellBytes(
              relativePath,
              await limit(() => readFile(sourcePath)),
            ),
          },
        ];
      }
      throw new Error(
        `Unsupported devcanon-runtime payload entry: ${sourcePath}`,
      );
    }),
  );
  return children.flat();
}

type RuntimeIoLimit = <T>(operation: () => Promise<T>) => Promise<T>;

function createRuntimeIoLimit(concurrency: number): RuntimeIoLimit {
  let active = 0;
  const waiters: Array<() => void> = [];
  return async <T>(operation: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    active += 1;
    try {
      return await operation();
    } finally {
      active -= 1;
      waiters.shift()?.();
    }
  };
}

function hashRuntimeField(
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
