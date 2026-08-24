import { createHash } from "node:crypto";
import { cp, lstat, readFile, readdir, readlink, rm } from "node:fs/promises";
import path from "node:path";
import type { ResolvedConfig } from "../config/schema.js";
import type { RenderedSkill } from "../models/types.js";
import { ensureDir } from "../utils/fs.js";
import { DEVCANON_RUNTIME_SKILL_NAME } from "../validate/skills.js";

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
    contentHash: await hashRuntimePayload(runtimeDir),
  };
}

export async function writeRenderedDevcanonRuntime(
  runtimeDir: string,
  generatedPath: string,
): Promise<void> {
  await rm(generatedPath, { recursive: true, force: true });
  await ensureDir(generatedPath);
  await cp(
    path.join(runtimeDir, "scripts"),
    path.join(generatedPath, "scripts"),
    { recursive: true, verbatimSymlinks: true },
  );
}

async function hashRuntimePayload(runtimeDir: string): Promise<string> {
  const hash = createHash("sha256");
  await hashRuntimeTree(path.join(runtimeDir, "scripts"), "scripts", hash);
  return hash.digest("hex");
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
      hash.update(`directory\0${relativePath}\0${stat.mode}\0`);
      await hashRuntimeTree(sourcePath, relativePath, hash);
    } else if (stat.isFile()) {
      hash.update(`file\0${relativePath}\0${stat.mode}\0`);
      hash.update(await readFile(sourcePath));
    } else if (stat.isSymbolicLink()) {
      hash.update(`symlink\0${relativePath}\0${stat.mode}\0`);
      hash.update(await readlink(sourcePath));
    }
  }
}
