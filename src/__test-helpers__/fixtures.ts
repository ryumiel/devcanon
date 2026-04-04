import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringify as yamlStringify } from "yaml";
import type { ResolvedConfig } from "../config/schema.js";

export async function createTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "am-test-"));
}

export async function cleanupTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export async function createSkillFixture(
  skillsDir: string,
  name: string,
  content = `# ${name}\n\nA test skill.\n`,
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

export async function createConfigFile(
  dir: string,
  yamlContent?: string,
): Promise<string> {
  const content =
    yamlContent ??
    "version: 1\nlibrary:\n  skillsDir: ./skills\n  agentsDir: ./agents\n  generatedDir: ./generated\n";
  const configPath = path.join(dir, "agents-manager.config.yaml");
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
  };
}

export function makeManifestJson(
  records: Array<Record<string, unknown>> = [],
): string {
  return JSON.stringify(
    {
      version: 1,
      managedBy: "agents-manager",
      lastSync: new Date().toISOString(),
      records,
    },
    null,
    2,
  );
}

let _symlinkSupport: boolean | null = null;

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
