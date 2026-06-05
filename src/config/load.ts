import path from "node:path";
import { parse as parseYaml } from "yaml";
import { UserError } from "../utils/errors.js";
import { pathExists, readTextFile } from "../utils/fs.js";
import { getLogger } from "../utils/output.js";
import { expandHome, resolveFromBase } from "../utils/paths.js";
import { CLI_COMMAND, CONFIG_ENV_VAR, CONFIG_FILE_NAME } from "./identity.js";
import {
  CLAUDE_MODEL_TIER_PROFILE_KEYS,
  CODEX_CONFIG_TARGET_FIELDS,
  CODEX_MODEL_TIER_PROFILE_KEYS,
  CONFIG_TARGET_FIELDS,
  CONFIG_TOP_LEVEL_KEYS,
  type Config,
  ConfigSchema,
  type InstallMode,
  MODEL_TIER_PROFILE_TARGET_KEYS,
  type ResolvedConfig,
} from "./schema.js";

const KNOWN_CONFIG_KEYS = new Set<string>(CONFIG_TOP_LEVEL_KEYS);
const KNOWN_TARGET_KEYS = new Set<string>(CONFIG_TARGET_FIELDS);
const KNOWN_CODEX_TARGET_KEYS = new Set<string>(CODEX_CONFIG_TARGET_FIELDS);
const KNOWN_MODEL_TIER_TARGET_KEYS = new Set<string>(
  MODEL_TIER_PROFILE_TARGET_KEYS,
);
const KNOWN_CLAUDE_MODEL_TIER_PROFILE_KEYS = new Set<string>(
  CLAUDE_MODEL_TIER_PROFILE_KEYS,
);
const KNOWN_CODEX_MODEL_TIER_PROFILE_KEYS = new Set<string>(
  CODEX_MODEL_TIER_PROFILE_KEYS,
);

export async function findConfigPath(explicitPath?: string): Promise<string> {
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    if (await pathExists(resolved)) return resolved;
    throw new UserError(
      `Config file not found: ${explicitPath}`,
      explicitPath,
      "Check the path and try again.",
    );
  }

  const envPath = process.env[CONFIG_ENV_VAR];
  if (envPath) {
    const resolved = path.resolve(envPath);
    if (await pathExists(resolved)) return resolved;
    throw new UserError(
      `Config file from ${CONFIG_ENV_VAR} not found: ${envPath}`,
      envPath,
      "Check the environment variable value.",
    );
  }

  const cwdPath = path.resolve(CONFIG_FILE_NAME);
  if (await pathExists(cwdPath)) return cwdPath;

  throw new UserError(
    `No ${CONFIG_FILE_NAME} found in current directory.`,
    undefined,
    `Run "${CLI_COMMAND} init" to create one.`,
  );
}

export async function loadConfig(
  explicitPath?: string,
  strict = false,
): Promise<ResolvedConfig> {
  const configPath = await findConfigPath(explicitPath);
  const raw = await readTextFile(configPath);
  let parsed: unknown;

  try {
    parsed = parseYaml(raw);
  } catch (error) {
    throw new UserError(
      `Invalid config YAML: ${(error as Error).message}`,
      configPath,
    );
  }

  if (strict) {
    const result = ConfigSchema.safeParse(parsed);
    const unknownFields = collectUnknownConfigFields(parsed);
    if (!result.success) {
      throw new UserError(
        `Invalid config: ${[
          ...result.error.issues.map((issue) => issue.message),
          ...unknownFields.map((field) => `unknown config field "${field}"`),
        ].join(", ")}`,
        configPath,
      );
    }
    if (unknownFields.length > 0) {
      throw new UserError(
        `Invalid config: ${unknownFields
          .map((field) => `unknown config field "${field}"`)
          .join(", ")}`,
        configPath,
      );
    }
    return resolveConfig(result.data, configPath);
  }

  // In normal mode, validate and warn about unknown fields
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new UserError(
      `Invalid config: ${result.error.issues.map((i) => i.message).join(", ")}`,
      configPath,
    );
  }

  for (const field of collectUnknownConfigFields(parsed)) {
    getLogger().warn(
      `Warning: unknown config field "${field}" in ${configPath}`,
    );
  }

  return resolveConfig(result.data, configPath);
}

function collectUnknownConfigFields(parsed: unknown): string[] {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }

  const parsedRecord = parsed as Record<string, unknown>;
  const unknownFields = Object.keys(parsedRecord)
    .filter((key) => !KNOWN_CONFIG_KEYS.has(key))
    .map((key) => key);

  collectUnknownTargetFields(parsedRecord, unknownFields);

  const modelTiers = parsedRecord.modelTiers;
  if (
    !modelTiers ||
    typeof modelTiers !== "object" ||
    Array.isArray(modelTiers)
  ) {
    return unknownFields;
  }

  for (const [tierKey, tierValue] of Object.entries(modelTiers)) {
    if (
      !tierValue ||
      typeof tierValue !== "object" ||
      Array.isArray(tierValue)
    ) {
      continue;
    }

    const tierRecord = tierValue as Record<string, unknown>;
    for (const key of Object.keys(tierRecord)) {
      if (!KNOWN_MODEL_TIER_TARGET_KEYS.has(key)) {
        unknownFields.push(`modelTiers.${tierKey}.${key}`);
      }
    }

    const claudeProfile = tierRecord.claude;
    if (
      claudeProfile &&
      typeof claudeProfile === "object" &&
      !Array.isArray(claudeProfile)
    ) {
      for (const key of Object.keys(claudeProfile)) {
        if (!KNOWN_CLAUDE_MODEL_TIER_PROFILE_KEYS.has(key)) {
          unknownFields.push(`modelTiers.${tierKey}.claude.${key}`);
        }
      }
    }

    const codexProfile = tierRecord.codex;
    if (
      codexProfile &&
      typeof codexProfile === "object" &&
      !Array.isArray(codexProfile)
    ) {
      for (const key of Object.keys(codexProfile)) {
        if (!KNOWN_CODEX_MODEL_TIER_PROFILE_KEYS.has(key)) {
          unknownFields.push(`modelTiers.${tierKey}.codex.${key}`);
        }
      }
    }
  }

  return unknownFields;
}

function collectUnknownTargetFields(
  parsedRecord: Record<string, unknown>,
  unknownFields: string[],
): void {
  const targets = parsedRecord.targets;
  if (!targets || typeof targets !== "object" || Array.isArray(targets)) {
    return;
  }

  const targetRecord = targets as Record<string, unknown>;
  for (const [targetName, targetValue] of Object.entries(targetRecord)) {
    if (
      !targetValue ||
      typeof targetValue !== "object" ||
      Array.isArray(targetValue)
    ) {
      continue;
    }

    const knownKeys =
      targetName === "codex" ? KNOWN_CODEX_TARGET_KEYS : KNOWN_TARGET_KEYS;
    for (const key of Object.keys(targetValue)) {
      if (!knownKeys.has(key)) {
        unknownFields.push(`targets.${targetName}.${key}`);
      }
    }
  }
}

function resolveConfig(config: Config, configPath: string): ResolvedConfig {
  const configDir = path.dirname(path.resolve(configPath));
  const defaultMode = config.defaults.installMode;

  function resolveTargetInstallMode(
    targetMode: InstallMode | undefined,
  ): InstallMode {
    return targetMode ?? defaultMode;
  }

  return {
    configDir,
    library: {
      skillsDir: resolveFromBase(config.library.skillsDir, configDir),
      agentsDir: resolveFromBase(config.library.agentsDir, configDir),
      generatedDir: resolveFromBase(config.library.generatedDir, configDir),
    },
    targets: {
      claude: {
        enabled: config.targets.claude.enabled,
        skillsHome: expandHome(config.targets.claude.skillsHome),
        agentsHome: expandHome(config.targets.claude.agentsHome),
        installMode: resolveTargetInstallMode(
          config.targets.claude.installMode,
        ),
      },
      codex: {
        enabled: config.targets.codex.enabled,
        skillsHome: expandHome(config.targets.codex.skillsHome),
        agentsHome: expandHome(config.targets.codex.agentsHome),
        installMode: resolveTargetInstallMode(config.targets.codex.installMode),
        ...(config.targets.codex.displayNameSuffix
          ? { displayNameSuffix: config.targets.codex.displayNameSuffix }
          : {}),
      },
    },
    defaults: {
      installMode: config.defaults.installMode,
      overwritePolicy: config.defaults.overwritePolicy,
      cleanManagedOutputs: config.defaults.cleanManagedOutputs,
    },
    platform: {
      windowsSymlinkFallback: config.platform.windowsSymlinkFallback,
    },
    manifest: {
      path: expandHome(config.manifest.path),
    },
    modelTiers: config.modelTiers,
    toolNames: config.toolNames,
    fileArtifacts: config.fileArtifacts,
  };
}
