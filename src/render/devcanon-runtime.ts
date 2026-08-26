import { createHash } from "node:crypto";
import { cp, lstat, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { RUNTIME_CONFIG_SCHEMA } from "../config/runtime-config.js";
import type { ResolvedConfig } from "../config/schema.js";
import type { RenderedSkill } from "../models/types.js";
import { ensureDir } from "../utils/fs.js";
import { DEVCANON_RUNTIME_SKILL_NAME } from "../validate/skills.js";
import {
  normalizePackagedShellBytes,
  normalizePackagedShellTree,
} from "./packaged-shell.js";

export async function renderDevcanonRuntimeForTarget(
  runtimeDir: string,
  target: "claude" | "codex",
  config: ResolvedConfig,
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
    contentHash: await hashRuntimePayload(
      runtimeDir,
      renderedRuntimeCatalog(config),
    ),
  };
}

export async function writeRenderedDevcanonRuntime(
  runtimeDir: string,
  generatedPath: string,
  config: ResolvedConfig,
): Promise<void> {
  await rm(generatedPath, { recursive: true, force: true });
  await ensureDir(generatedPath);
  await cp(
    path.join(runtimeDir, "config"),
    path.join(generatedPath, "config"),
    { recursive: true, verbatimSymlinks: true },
  );
  await writeFile(
    path.join(generatedPath, "config", "runtime-config.json"),
    renderedRuntimeCatalog(config),
    "utf-8",
  );
  await cp(
    path.join(runtimeDir, "scripts"),
    path.join(generatedPath, "scripts"),
    { recursive: true, verbatimSymlinks: true },
  );
  await normalizePackagedShellTree(path.join(generatedPath, "scripts"));
}

async function hashRuntimePayload(
  runtimeDir: string,
  catalogBytes: Buffer,
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
  await hashRuntimeTree(path.join(runtimeDir, "scripts"), "scripts", hash);
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
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
  for (const entry of entries) {
    const sourcePath = path.join(directory, entry.name);
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    const stat = await lstat(sourcePath);
    if (stat.isDirectory()) {
      hashRuntimeField(hash, "directory", relativePath, String(stat.mode));
      await hashRuntimeTree(sourcePath, relativePath, hash);
    } else if (stat.isFile()) {
      hashRuntimeField(hash, "file", relativePath, String(stat.mode));
      hashRuntimeField(
        hash,
        "bytes",
        relativePath,
        normalizePackagedShellBytes(relativePath, await readFile(sourcePath)),
      );
    } else {
      throw new Error(
        `Unsupported devcanon-runtime payload entry: ${sourcePath}`,
      );
    }
  }
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
