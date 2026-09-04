import { constants } from "node:fs";
import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stringify as yamlStringify } from "yaml";
import type { ManifestBoundary, ResolvedConfig } from "../config/schema.js";
import type { LoadedAgent } from "../models/types.js";
import { sha256, verifyProvider } from "../runtime-build/provider.js";
import type {
  AcceptedProvider,
  RuntimeManifest,
} from "../runtime-build/provider.js";
import type { ValidatedDevcanonRuntime } from "../validate/devcanon-runtime.js";

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
const DEV_CANON_RUNTIME_SOURCE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../skills/devcanon-runtime",
);

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

export async function copyDevcanonRuntimeFixture(
  skillsDir: string,
): Promise<void> {
  const { validateDevcanonRuntime } = await import(
    "../validate/devcanon-runtime.js"
  );
  const runtimeDir = path.join(skillsDir, "devcanon-runtime");
  await mkdir(path.join(runtimeDir, "config"), { recursive: true });
  await mkdir(path.join(runtimeDir, "scripts"), { recursive: true });
  await Promise.all([
    cp(
      path.join(DEV_CANON_RUNTIME_SOURCE_DIR, "config", "runtime-config.json"),
      path.join(runtimeDir, "config", "runtime-config.json"),
    ),
    cp(
      path.join(DEV_CANON_RUNTIME_SOURCE_DIR, "scripts", "devcanon-runtime.sh"),
      path.join(runtimeDir, "scripts", "devcanon-runtime.sh"),
    ),
    cp(
      path.join(DEV_CANON_RUNTIME_SOURCE_DIR, "scripts", "resolve-bash.mjs"),
      path.join(runtimeDir, "scripts", "resolve-bash.mjs"),
    ),
  ]);
  const provider = await createDevcanonRuntimeProviderFixture(
    path.dirname(skillsDir),
  );
  const runtimeScriptsDir = path.join(runtimeDir, "scripts", "runtime");
  await mkdir(runtimeScriptsDir, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(runtimeScriptsDir, "devcanon-runtime.mjs"),
      provider.bundle.copy(),
    ),
    writeFile(
      path.join(runtimeScriptsDir, "runtime-manifest.json"),
      provider.manifestBytes.copy(),
    ),
    writeFile(
      path.join(runtimeScriptsDir, "THIRD_PARTY_LICENSES"),
      provider.licenses.copy(),
    ),
  ]);
  await validateDevcanonRuntime(runtimeDir, {
    adapterSourceDir: DEV_CANON_RUNTIME_SOURCE_DIR,
    provider,
  });
}

export async function createDevcanonRuntimeProviderFixture(
  parentDir: string,
): Promise<AcceptedProvider> {
  const providerRoot = path.join(
    parentDir,
    ".devcanon-runtime-fixture-provider",
  );
  await mkdir(providerRoot, { recursive: true });
  const bundle = Buffer.from(
    'if (process.argv[2] === "runtime" && process.argv[3] === "contract") process.stdout.write("{\\"command_group\\":\\"devcanon-runtime\\",\\"major_version\\":1}\\n"); else if (process.argv[2] === "runtime" && process.argv[3] === "resolve-bash") process.stdout.write("/bin/bash\\n");\n',
    "utf8",
  );
  const licenses = Buffer.from("fixture license\n", "utf8");
  const manifest = Buffer.from(
    `${JSON.stringify({
      schema: "devcanon-runtime-build/v1",
      devcanon_version: "2.0.0",
      artifact_origin: "package",
      input_sha256: "0".repeat(64),
      bundle_sha256: sha256(bundle),
      licenses_sha256: sha256(licenses),
      node_target: "node24",
    })}\n`,
    "utf8",
  );
  await Promise.all([
    writeFile(path.join(providerRoot, "devcanon-runtime.mjs"), bundle),
    writeFile(path.join(providerRoot, "runtime-manifest.json"), manifest),
    writeFile(path.join(providerRoot, "THIRD_PARTY_LICENSES"), licenses),
  ]);
  const provider = await verifyProvider({
    root: providerRoot,
    origin: "package",
    devcanonVersion: "2.0.0",
  });
  await rm(providerRoot, { recursive: true, force: true });
  return provider;
}

/** Verifies accepted-provider authority from an already-composed test runtime. */
export async function providerFromRuntimeFixture(
  runtimeDir: string,
): Promise<AcceptedProvider> {
  const root = path.join(runtimeDir, "scripts", "runtime");
  const manifest = JSON.parse(
    await readFile(path.join(root, "runtime-manifest.json"), "utf8"),
  ) as RuntimeManifest;
  if (manifest.artifact_origin === "package") {
    return verifyProvider({
      root,
      origin: manifest.artifact_origin,
      devcanonVersion: manifest.devcanon_version,
    });
  }
  const { verifySourceProvider } = await import("../runtime-build/producer.js");
  return verifySourceProvider({
    repositoryRoot: process.cwd(),
    root,
    devcanonVersion: manifest.devcanon_version,
  });
}

const LIGHTWEIGHT_RUNTIME_MARKER =
  "devcanon-test-only-lightweight-runtime/v1\n";
const LIGHTWEIGHT_RUNTIME_BUNDLE =
  'if (process.argv[2] === "runtime" && process.argv[3] === "contract") process.stdout.write(\'{"command_group":"devcanon-runtime","major_version":1}\\n\');\n';
const LIGHTWEIGHT_RUNTIME_MANIFEST = "{}\n";
const LIGHTWEIGHT_RUNTIME_LICENSES = "fixture license\n";
const LIGHTWEIGHT_RUNTIME_WRAPPER =
  "#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n";
const LIGHTWEIGHT_RUNTIME_RESOLVER = "export {};\n";
const LIGHTWEIGHT_RUNTIME_CATALOG = `${JSON.stringify(
  {
    schema: "devcanon/runtime-config/v1",
    capabilityProfiles: CANONICAL_CAPABILITY_PROFILES,
  },
  null,
  2,
)}\n`;

/** Test-only passive runtime for policy tests that do not own package fidelity. */
export async function createLightweightDevcanonRuntimeFixture(
  skillsDir: string,
): Promise<void> {
  const runtimeDir = path.join(skillsDir, "devcanon-runtime");
  const configDir = path.join(runtimeDir, "config");
  const scriptsDir = path.join(runtimeDir, "scripts");
  const runtimeScriptsDir = path.join(scriptsDir, "runtime");
  await mkdir(configDir, { recursive: true });
  await mkdir(runtimeScriptsDir, { recursive: true });
  await writeFile(
    path.join(configDir, "runtime-config.json"),
    LIGHTWEIGHT_RUNTIME_CATALOG,
    "utf-8",
  );
  const wrapper = path.join(scriptsDir, "devcanon-runtime.sh");
  await writeFile(wrapper, LIGHTWEIGHT_RUNTIME_WRAPPER, "utf-8");
  await chmod(wrapper, 0o755);
  await writeFile(
    path.join(scriptsDir, "resolve-bash.mjs"),
    LIGHTWEIGHT_RUNTIME_RESOLVER,
    "utf-8",
  );
  await writeFile(
    path.join(runtimeScriptsDir, ".lightweight-runtime-fixture"),
    LIGHTWEIGHT_RUNTIME_MARKER,
    "utf-8",
  );
  await writeFile(
    path.join(runtimeScriptsDir, "devcanon-runtime.mjs"),
    LIGHTWEIGHT_RUNTIME_BUNDLE,
    "utf-8",
  );
  await writeFile(
    path.join(runtimeScriptsDir, "runtime-manifest.json"),
    LIGHTWEIGHT_RUNTIME_MANIFEST,
    "utf-8",
  );
  await writeFile(
    path.join(runtimeScriptsDir, "THIRD_PARTY_LICENSES"),
    LIGHTWEIGHT_RUNTIME_LICENSES,
    "utf-8",
  );
}

/** Accepts only the exact lightweight fixture or its rendered projection. */
export async function validateLightweightDevcanonRuntimeFixture(
  runtimeDir: string,
  validateReal: (runtimeDir: string) => Promise<ValidatedDevcanonRuntime>,
): Promise<ValidatedDevcanonRuntime> {
  if (!(await isExactLightweightRuntimeFixture(runtimeDir))) {
    return validateReal(runtimeDir);
  }
  return Object.freeze({
    runtimeDir,
    closureRecords: [],
  }) as unknown as ValidatedDevcanonRuntime;
}

async function isExactLightweightRuntimeFixture(
  runtimeDir: string,
): Promise<boolean> {
  try {
    const configDir = path.join(runtimeDir, "config");
    const scriptsDir = path.join(runtimeDir, "scripts");
    const runtimeScriptsDir = path.join(scriptsDir, "runtime");
    if (!(await hasExactEntries(runtimeDir, ["config", "scripts"]))) {
      return false;
    }
    if (!(await hasExactEntries(configDir, ["runtime-config.json"]))) {
      return false;
    }
    if (
      !(await hasExactEntries(scriptsDir, [
        "devcanon-runtime.sh",
        "resolve-bash.mjs",
        "runtime",
      ]))
    ) {
      return false;
    }
    const marker = path.join(runtimeScriptsDir, ".lightweight-runtime-fixture");
    const hasMarker = await access(marker).then(
      () => true,
      () => false,
    );
    const expectedRuntimeEntries = [
      ...(hasMarker ? [".lightweight-runtime-fixture"] : []),
      "THIRD_PARTY_LICENSES",
      "devcanon-runtime.mjs",
      "runtime-manifest.json",
    ];
    if (!(await hasExactEntries(runtimeScriptsDir, expectedRuntimeEntries))) {
      return false;
    }
    const wrapper = path.join(scriptsDir, "devcanon-runtime.sh");
    await access(wrapper, constants.X_OK);
    return (
      (await readFile(wrapper, "utf-8")) === LIGHTWEIGHT_RUNTIME_WRAPPER &&
      (await readFile(path.join(scriptsDir, "resolve-bash.mjs"), "utf-8")) ===
        LIGHTWEIGHT_RUNTIME_RESOLVER &&
      (!hasMarker ||
        (await readFile(marker, "utf-8")) === LIGHTWEIGHT_RUNTIME_MARKER) &&
      (await readFile(
        path.join(runtimeScriptsDir, "devcanon-runtime.mjs"),
        "utf-8",
      )) === LIGHTWEIGHT_RUNTIME_BUNDLE &&
      (await readFile(
        path.join(runtimeScriptsDir, "runtime-manifest.json"),
        "utf-8",
      )) === LIGHTWEIGHT_RUNTIME_MANIFEST &&
      (await readFile(
        path.join(runtimeScriptsDir, "THIRD_PARTY_LICENSES"),
        "utf-8",
      )) === LIGHTWEIGHT_RUNTIME_LICENSES &&
      (await readFile(path.join(configDir, "runtime-config.json"), "utf-8")) ===
        LIGHTWEIGHT_RUNTIME_CATALOG
    );
  } catch {
    return false;
  }
}

async function hasExactEntries(
  directory: string,
  expected: readonly string[],
): Promise<boolean> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    entries.length === expected.length &&
    entries.every(
      (entry) => !entry.isSymbolicLink() && expected.includes(entry.name),
    )
  );
}

/** Creates an isolated deterministic runtime fixture for symlink-mode tests. */
export async function linkDevcanonRuntimeFixture(
  skillsDir: string,
): Promise<void> {
  await copyDevcanonRuntimeFixture(skillsDir);
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
  const config: ResolvedConfig = {
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
  return config;
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
