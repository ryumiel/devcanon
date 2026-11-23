import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { RUNTIME_CONFIG_SCHEMA } from "../src/config/runtime-config.ts";
import { ConfigSchema } from "../src/config/schema.ts";
import { atomicWriteFile } from "../src/utils/fs.ts";

const configPath = new URL("../devcanon.config.yaml", import.meta.url);
const catalogDirectory = new URL(
  "../skills/devcanon-runtime/config/",
  import.meta.url,
);
const catalogPath = new URL("runtime-config.json", catalogDirectory);

const { modelProfiles } = ConfigSchema.pick({
  version: true,
  modelProfiles: true,
}).parse(parse(await readFile(configPath, "utf8")));

await atomicWriteFile(
  fileURLToPath(catalogPath),
  `${JSON.stringify({ schema: RUNTIME_CONFIG_SCHEMA, modelProfiles }, null, 2)}\n`,
);
