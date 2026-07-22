import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringify as yamlStringify } from "yaml";
import type { ManifestBoundary, ResolvedConfig } from "../config/schema.js";
import type { LoadedAgent } from "../models/types.js";

type CodexSource = NonNullable<LoadedAgent["source"]["codex"]>;

export const CANONICAL_CAPABILITY_PROFILES = {
  efficient: {
    claude: "claude-haiku-4-5-20251001",
    codex: "gpt-5.6-luna",
  },
  balanced: {
    claude: "claude-sonnet-5",
    codex: "gpt-5.6-terra",
  },
  frontier: {
    claude: "claude-opus-4-8",
    codex: "gpt-5.6-sol",
  },
};

export function makeConfigYaml(
  overrides: Record<string, unknown> = {},
): string {
  return yamlStringify({
    version: 2,
    capabilityProfiles: CANONICAL_CAPABILITY_PROFILES,
    ...overrides,
  });
}

// Widens enum-typed fields to plain strings so renderer tests can supply
// payloads that would not pass Zod validation (the single downcast at
// makeCodexSource preserves type-safety for non-enum fields).
type CodexSourceOverrides = {
  model?: CodexSource["model"];
  model_reasoning_effort?: string;
  sandbox_mode?: string;
  nickname_candidates?: CodexSource["nickname_candidates"];
  approval_policy?:
    | string
    | Extract<CodexSource["approval_policy"], { granular: unknown }>;
};

export async function createTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "am-test-"));
}

const cleanupRetries = process.platform === "win32" ? 5 : 0;
const cleanupRetryDelayMs = 100;

export async function cleanupTempDir(dir: string): Promise<void> {
  await rm(dir, {
    recursive: true,
    force: true,
    maxRetries: cleanupRetries,
    retryDelay: cleanupRetryDelayMs,
  });
}

export async function createSkillFixture(
  skillsDir: string,
  name: string,
  content = `---\nname: ${name}\ndescription: A test skill.\n---\n\n# ${name}\n\nA test skill.\n`,
  subdirs: string[] = [],
): Promise<string> {
  const skillDir = path.join(skillsDir, name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, "SKILL.md"), content, "utf-8");
  for (const sub of subdirs) {
    await mkdir(path.join(skillDir, sub), { recursive: true });
  }
  return skillDir;
}

export async function createAgentFixture(
  agentsDir: string,
  name: string,
  yamlContent: string,
): Promise<string> {
  await mkdir(agentsDir, { recursive: true });
  const filePath = path.join(agentsDir, `${name}.yaml`);
  await writeFile(filePath, yamlContent, "utf-8");
  return filePath;
}

export function makeAgentYaml(
  name: string,
  overrides: Record<string, unknown> = {},
): string {
  const fields: Record<string, unknown> = {
    name,
    description: `Test agent ${name}`,
    instructions: `Instructions for ${name}`,
    skills: [],
    ...overrides,
  };
  return yamlStringify(fields);
}

export function makeCodexSource(
  overrides: CodexSourceOverrides = {},
): CodexSource {
  return { sandbox_mode: "read-only", ...overrides } as CodexSource;
}

export async function createConfigFile(
  dir: string,
  yamlContent?: string,
): Promise<string> {
  const content =
    yamlContent ??
    makeConfigYaml({
      library: {
        skillsDir: "./skills",
        agentsDir: "./agents",
        generatedDir: "./generated",
      },
    });
  const configPath = path.join(dir, "devcanon.config.yaml");
  await writeFile(configPath, content, "utf-8");
  return configPath;
}

export function makeResolvedConfig(
  tempDir: string,
  overrides: Partial<{
    claude: Partial<ResolvedConfig["targets"]["claude"]>;
    codex: Partial<ResolvedConfig["targets"]["codex"]>;
    defaults: Partial<ResolvedConfig["defaults"]>;
    platform: Partial<ResolvedConfig["platform"]>;
    library: Partial<ResolvedConfig["library"]>;
    manifest: Partial<ResolvedConfig["manifest"]>;
    configDir: string;
  }> = {},
): ResolvedConfig {
  // Defaults to "copy" installMode for test safety — avoids symlink permission
  // issues on Windows CI. Tests that need symlink behavior override explicitly.
  return {
    configDir: overrides.configDir ?? tempDir,
    library: {
      skillsDir: path.join(tempDir, "skills"),
      agentsDir: path.join(tempDir, "agents"),
      generatedDir: path.join(tempDir, "generated"),
      ...overrides.library,
    },
    targets: {
      claude: {
        enabled: true,
        skillsHome: path.join(tempDir, "home", "claude", "skills"),
        agentsHome: path.join(tempDir, "home", "claude", "agents"),
        installMode: "copy",
        ...overrides.claude,
      },
      codex: {
        enabled: true,
        skillsHome: path.join(tempDir, "home", "codex", "skills"),
        agentsHome: path.join(tempDir, "home", "codex", "agents"),
        installMode: "copy",
        ...overrides.codex,
      },
    },
    defaults: {
      installMode: "copy",
      overwritePolicy: "overwrite-managed",
      cleanManagedOutputs: true,
      ...overrides.defaults,
    },
    platform: {
      windowsSymlinkFallback: "copy",
      ...overrides.platform,
    },
    manifest: {
      path: path.join(tempDir, "manifest.json"),
      ...overrides.manifest,
    },
    capabilityProfiles: {
      efficient: { ...CANONICAL_CAPABILITY_PROFILES.efficient },
      balanced: { ...CANONICAL_CAPABILITY_PROFILES.balanced },
      frontier: { ...CANONICAL_CAPABILITY_PROFILES.frontier },
    },
  };
}

const DEFAULT_MANIFEST_BOUNDARY: ManifestBoundary = {
  claudeSkillsHome: "/home/claude/skills",
  claudeAgentsHome: "/home/claude/agents",
  codexSkillsHome: "/home/codex/skills",
  codexAgentsHome: "/home/codex/agents",
};

export interface ManifestFixtureOptions {
  /** Omit identity fields only when a test specifically exercises v1 input. */
  legacy?: boolean;
  boundary?: ManifestBoundary;
  config?: ResolvedConfig;
}

export function makeManifestJson(
  records: Array<Record<string, unknown>> = [],
  options: ManifestFixtureOptions = {},
): string {
  return JSON.stringify(
    {
      version: 1,
      managedBy: "devcanon",
      lastSync: new Date().toISOString(),
      ...(options.legacy
        ? {}
        : {
            boundary:
              options.boundary ??
              (options.config
                ? manifestBoundaryForConfig(options.config)
                : DEFAULT_MANIFEST_BOUNDARY),
          }),
      records: options.legacy ? records : records.map(withFixtureRecordName),
    },
    null,
    2,
  );
}

function manifestBoundaryForConfig(config: ResolvedConfig): ManifestBoundary {
  return {
    claudeSkillsHome: path.resolve(config.targets.claude.skillsHome),
    claudeAgentsHome: path.resolve(config.targets.claude.agentsHome),
    codexSkillsHome: path.resolve(config.targets.codex.skillsHome),
    codexAgentsHome: path.resolve(config.targets.codex.agentsHome),
  };
}

function withFixtureRecordName(record: Record<string, unknown>) {
  if (typeof record.name === "string") return record;
  const target = record.target;
  const type = record.type;
  const installedPath = record.installedPath;
  if (
    (target !== "claude" && target !== "codex") ||
    (type !== "skill" && type !== "agent") ||
    typeof installedPath !== "string"
  ) {
    return record;
  }
  const basename = path.basename(installedPath);
  const suffix = target === "claude" ? ".md" : ".toml";
  const name =
    type === "agent" && basename.endsWith(suffix)
      ? basename.slice(0, -suffix.length)
      : basename;
  return { ...record, ...(name ? { name } : {}) };
}

let _symlinkSupport: boolean | null = null;
let _executableModeMutationSupport: boolean | null = null;

export async function canCreateSymlinks(): Promise<boolean> {
  if (_symlinkSupport !== null) return _symlinkSupport;
  const tmpDir = await createTempDir();
  try {
    const target = path.join(tmpDir, "target.txt");
    const link = path.join(tmpDir, "link.txt");
    await writeFile(target, "probe", "utf-8");
    await symlink(target, link, "file");
    _symlinkSupport = true;
  } catch {
    _symlinkSupport = false;
  } finally {
    await cleanupTempDir(tmpDir);
  }
  return _symlinkSupport;
}

export async function canMutateExecutableMode(): Promise<boolean> {
  if (_executableModeMutationSupport !== null) {
    return _executableModeMutationSupport;
  }

  const tmpDir = await createTempDir();
  try {
    const target = path.join(tmpDir, "script.sh");
    await writeFile(target, "#!/bin/sh\n", "utf-8");
    await chmod(target, 0o755);
    const executableModeSet = ((await stat(target)).mode & 0o111) !== 0;
    await chmod(target, 0o644);
    const executableModeCleared = ((await stat(target)).mode & 0o111) === 0;
    _executableModeMutationSupport = executableModeSet && executableModeCleared;
  } catch {
    _executableModeMutationSupport = false;
  } finally {
    await cleanupTempDir(tmpDir);
  }

  return _executableModeMutationSupport;
}
