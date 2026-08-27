import { lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { UserError } from "../utils/errors.js";
import { pathExists, readTextFile } from "../utils/fs.js";
import { CONFIG_ENV_VAR, CONFIG_FILE_NAME } from "./identity.js";
import { loadConfigAtPath } from "./load.js";
import { CapabilityProfilesSchema } from "./schema.js";

export const RUNTIME_CONFIG_SCHEMA = "devcanon/runtime-config/v1";
export const RUNTIME_CONFIG_RELATIVE_PATH = path.join(
  "config",
  "runtime-config.json",
);

const RuntimeConfigSchema = z
  .object({
    schema: z.literal(RUNTIME_CONFIG_SCHEMA),
    capabilityProfiles: CapabilityProfilesSchema,
  })
  .strict();

type RuntimeCatalog = z.infer<typeof RuntimeConfigSchema>;
export type RuntimeConfigSource =
  | "explicit"
  | "environment"
  | "cwd"
  | "bundled";
export type RuntimeConfigScalar = string | number | boolean;

export interface SelectedRuntimeConfig {
  path: string;
  source: RuntimeConfigSource;
  value: Record<string, unknown>;
}

export function bundledRuntimeConfigPath(): string {
  return fileURLToPath(
    new URL(
      "../../skills/devcanon-runtime/config/runtime-config.json",
      import.meta.url,
    ),
  );
}

export async function selectRuntimeConfig(
  explicitPath?: string,
  strict = false,
): Promise<SelectedRuntimeConfig> {
  if (explicitPath !== undefined) {
    if (explicitPath.length === 0) {
      throw new UserError("Config path must not be empty.");
    }
    const selectedPath = await requireSourceConfig(explicitPath, "explicit");
    return selectSourceConfig(selectedPath, "explicit", strict);
  }

  const environmentPath = process.env[CONFIG_ENV_VAR];
  if (environmentPath) {
    const selectedPath = await requireSourceConfig(
      environmentPath,
      "environment",
    );
    return selectSourceConfig(selectedPath, "environment", strict);
  }

  const cwdPath = path.resolve(CONFIG_FILE_NAME);
  if (await pathExists(cwdPath)) {
    return selectSourceConfig(cwdPath, "cwd", strict);
  }

  return {
    path: bundledRuntimeConfigPath(),
    source: "bundled",
    value: await loadRuntimeConfigCatalog(bundledRuntimeConfigPath()),
  };
}

export async function loadRuntimeConfigCatalog(
  catalogPath: string,
): Promise<RuntimeCatalog> {
  const absolutePath = path.resolve(catalogPath);
  try {
    if (!(await lstat(absolutePath)).isFile()) {
      throw new Error("not a regular file");
    }
  } catch {
    throw invalidRuntimeCatalogError(absolutePath);
  }

  let raw: string;
  let parsed: unknown;
  try {
    raw = await readTextFile(absolutePath);
    parsed = JSON.parse(raw) as unknown;
    assertNoDuplicateJsonObjectKeys(raw);
  } catch (error) {
    throw invalidRuntimeCatalogError(absolutePath, (error as Error).message);
  }

  const result = RuntimeConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw invalidRuntimeCatalogError(
      absolutePath,
      result.error.issues.map((issue) => issue.message).join(", "),
    );
  }
  return result.data;
}

export function getRuntimeConfigScalar(
  value: Record<string, unknown>,
  key: string,
): RuntimeConfigScalar {
  if (!isSafeRuntimeConfigKey(key)) {
    throw new UserError(`Invalid configuration key: ${key}`);
  }

  let current: unknown = value;
  for (const segment of key.split(".")) {
    if (
      !current ||
      typeof current !== "object" ||
      Array.isArray(current) ||
      !Object.hasOwn(current, segment)
    ) {
      throw new UserError(`Configuration key not found: ${key}`);
    }
    current = (current as Record<string, unknown>)[segment];
  }

  if (
    typeof current !== "string" &&
    typeof current !== "number" &&
    typeof current !== "boolean"
  ) {
    throw new UserError(`Configuration key is not a scalar value: ${key}`);
  }
  return current;
}

export function formatRuntimeConfigScalar(value: RuntimeConfigScalar): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

async function requireSourceConfig(
  candidatePath: string,
  source: "explicit" | "environment",
): Promise<string> {
  const resolved = path.resolve(candidatePath);
  if (await pathExists(resolved)) return resolved;

  if (source === "explicit") {
    throw new UserError(
      `Config file not found: ${candidatePath}`,
      candidatePath,
      "Check the path and try again.",
    );
  }
  throw new UserError(
    `Config file from ${CONFIG_ENV_VAR} not found: ${candidatePath}`,
    candidatePath,
    "Check the environment variable value.",
  );
}

async function selectSourceConfig(
  selectedPath: string,
  source: Exclude<RuntimeConfigSource, "bundled">,
  strict: boolean,
): Promise<SelectedRuntimeConfig> {
  const { configDir: _configDir, ...resolvedConfig } = await loadConfigAtPath(
    selectedPath,
    strict,
  );
  return {
    path: path.resolve(selectedPath),
    source,
    value: { version: 2, ...resolvedConfig },
  };
}

function invalidRuntimeCatalogError(
  catalogPath: string,
  detail?: string,
): UserError {
  return new UserError(
    `Invalid runtime configuration catalog${detail ? `: ${detail}` : "."}`,
    catalogPath,
    "Reinstall DevCanon or restore the bundled runtime catalog.",
  );
}

function isSafeRuntimeConfigKey(key: string): boolean {
  const segments = key.split(".");
  return (
    key.length > 0 &&
    segments.every(
      (segment) =>
        /^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(segment) &&
        !["__proto__", "constructor", "prototype"].includes(segment),
    )
  );
}

function assertNoDuplicateJsonObjectKeys(raw: string): void {
  let offset = 0;

  function skipWhitespace(): void {
    while (/\s/u.test(raw[offset] ?? "")) offset += 1;
  }

  function parseString(): string {
    const start = offset;
    offset += 1;
    while (offset < raw.length) {
      if (raw[offset] === "\\") offset += 2;
      else if (raw[offset] === '"') {
        offset += 1;
        return JSON.parse(raw.slice(start, offset)) as string;
      } else offset += 1;
    }
    throw new Error("unterminated JSON string");
  }

  function parseValue(): void {
    skipWhitespace();
    if (raw[offset] === "{") {
      parseObject();
      return;
    }
    if (raw[offset] === "[") {
      parseArray();
      return;
    }
    if (raw[offset] === '"') {
      parseString();
      return;
    }
    while (offset < raw.length && !/[\s,\]}]/u.test(raw[offset] ?? "")) {
      offset += 1;
    }
  }

  function parseObject(): void {
    const keys = new Set<string>();
    offset += 1;
    skipWhitespace();
    if (raw[offset] === "}") {
      offset += 1;
      return;
    }
    while (true) {
      skipWhitespace();
      const key = parseString();
      if (keys.has(key)) throw new Error(`duplicate JSON key "${key}"`);
      keys.add(key);
      skipWhitespace();
      offset += 1;
      parseValue();
      skipWhitespace();
      if (raw[offset] === "}") {
        offset += 1;
        return;
      }
      offset += 1;
    }
  }

  function parseArray(): void {
    offset += 1;
    skipWhitespace();
    if (raw[offset] === "]") {
      offset += 1;
      return;
    }
    while (true) {
      parseValue();
      skipWhitespace();
      if (raw[offset] === "]") {
        offset += 1;
        return;
      }
      offset += 1;
    }
  }

  parseValue();
}
