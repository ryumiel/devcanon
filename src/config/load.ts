import path from "node:path";
import { parse as parseYaml } from "yaml";
import { UserError } from "../utils/errors.js";
import { pathExists, readTextFile } from "../utils/fs.js";
import { getLogger } from "../utils/output.js";
import { expandHome, resolveFromBase } from "../utils/paths.js";
import {
  type Config,
  ConfigSchema,
  type InstallMode,
  type ResolvedConfig,
} from "./schema.js";

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

  const envPath = process.env.AGENTS_MANAGER_CONFIG;
  if (envPath) {
    const resolved = path.resolve(envPath);
    if (await pathExists(resolved)) return resolved;
    throw new UserError(
      `Config file from AGENTS_MANAGER_CONFIG not found: ${envPath}`,
      envPath,
      "Check the environment variable value.",
    );
  }

  const cwdPath = path.resolve("agents-manager.config.yaml");
  if (await pathExists(cwdPath)) return cwdPath;

  throw new UserError(
    "No agents-manager.config.yaml found in current directory.",
    undefined,
    'Run "agents-manager init" to create one.',
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
    // In strict mode, unknown fields cause errors
    const result = ConfigSchema.strict().safeParse(parsed);
    if (!result.success) {
      throw new UserError(
        `Invalid config: ${result.error.issues.map((i) => i.message).join(", ")}`,
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

  // Detect unknown top-level keys
  if (parsed && typeof parsed === "object") {
    const knownKeys = new Set([
      "version",
      "library",
      "targets",
      "defaults",
      "platform",
      "manifest",
      "modelTiers",
      "toolNames",
      "fileArtifacts",
    ]);
    for (const key of Object.keys(parsed)) {
      if (!knownKeys.has(key)) {
        getLogger().warn(
          `Warning: unknown config field "${key}" in ${configPath}`,
        );
      }
    }
  }

  return resolveConfig(result.data, configPath);
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
