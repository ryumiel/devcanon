import { lstat, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { RUNTIME_CONFIG_SCHEMA } from "../dist/config/runtime-config.js";
import { ConfigSchema } from "../dist/config/schema.js";
import { atomicWriteFile } from "../dist/utils/fs.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const configPath = path.join(root, "devcanon.config.yaml");
const skills = path.join(root, "skills");
const runtime = path.join(skills, "devcanon-runtime");
const catalogDirectory = path.join(runtime, "config");
const catalogPath = path.join(catalogDirectory, "runtime-config.json");

const { modelProfiles } = ConfigSchema.pick({
  version: true,
  modelProfiles: true,
}).parse(parse(await readFile(configPath, "utf8")));

for (const directory of [skills, runtime, catalogDirectory]) {
  if (directory === catalogDirectory) {
    try {
      await mkdir(directory);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Model catalog requires a real directory: ${directory}`);
  }
}

await atomicWriteFile(
  catalogPath,
  `${JSON.stringify({ schema: RUNTIME_CONFIG_SCHEMA, modelProfiles }, null, 2)}\n`,
);
