import {
  chmod,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  canCreateSymlinks,
  createAgentFixture,
  createConfigFile,
  createDevcanonRuntimeProviderFixture,
  createSkillFixture,
  makeAgentYaml,
  makeConfigYaml,
  makeManifestJson,
  makeResolvedConfig,
} from "../__test-helpers__/fixtures.js";
import { useSyncFixture } from "../__test-helpers__/sync-fixture.js";
import { loadConfig } from "../config/load.js";
import { UserError } from "../utils/errors.js";
import { pathExists, readTextFile } from "../utils/fs.js";
import {
  inspectManifest,
  recoverInvalidManifest,
  withManifestPersistenceFaultsForTesting,
} from "./manifest.js";
import { uninstall } from "./uninstall.js";

const symlinkAvailable = await canCreateSymlinks();

function normalizePackagedShellBytes(bytes: Buffer): Buffer {
  const normalized: number[] = [];
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 13 && bytes[index + 1] === 10) {
      normalized.push(10);
      index += 1;
    } else {
      normalized.push(bytes[index]);
    }
  }
  return Buffer.from(normalized);
}

type PublicHelperCatalogRow = {
  id: string;
  skill: string;
  executable: string;
  usageDocument: string;
};

function parsePublicHelperCatalog(markdown: string): PublicHelperCatalogRow[] {
  const rows: PublicHelperCatalogRow[] = [];
  for (const line of markdown.split("\n")) {
    const links = [...line.matchAll(/\]\(\.\.\/([^)]*)\)/gu)].map(
      (match) => match[1],
    );
    if (links.length !== 2 || !links[0].includes("/scripts/")) continue;
    const executable = path.posix.normalize(links[0]);
    rows.push({
      id: line.split("|")[1].trim(),
      skill: executable.split("/")[1],
      executable,
      usageDocument: path.posix.normalize(links[1]),
    });
  }
  return rows;
}

function legacyShellAdapter(current: string): string {
  return current
    .replace(
      [
        '  local js_entrypoint="$script_dir/runtime/devcanon-runtime.mjs"',
        '  [ -f "$js_entrypoint" ] || runtime_error "devcanon-runtime bundle missing: $js_entrypoint"',
        '  command -v node >/dev/null 2>&1 || runtime_error "node is required for devcanon-runtime typed helpers"',
        "  unset DEBUG NODE_OPTIONS",
        '  exec node "$js_entrypoint" runtime "$@"',
      ].join("\n"),
      [
        '  local js_entrypoint="$script_dir/runtime/cli.js"',
        '  [ -f "$js_entrypoint" ] || runtime_error "devcanon-runtime JS entrypoint missing: $js_entrypoint"',
        '  command -v node >/dev/null 2>&1 || runtime_error "node is required for devcanon-runtime typed helpers"',
        "  unset DEBUG NODE_OPTIONS",
        '  exec node "$js_entrypoint" "$@"',
      ].join("\n"),
    )
    .replace(
      [
        '  local js_entrypoint="$script_dir/runtime/devcanon-runtime.mjs"',
        '  [ -f "$js_entrypoint" ] || runtime_error "devcanon-runtime bundle missing: $js_entrypoint"',
        '  command -v node >/dev/null 2>&1 || runtime_error "node is required for devcanon-runtime bootstrap"',
        '  exec node "$js_entrypoint" bootstrap "$@"',
      ].join("\n"),
      [
        '  local js_entrypoint="$script_dir/runtime/bootstrap-cli.js"',
        '  [ -f "$js_entrypoint" ] || runtime_error "devcanon-runtime bootstrap entrypoint missing: $js_entrypoint"',
        '  command -v node >/dev/null 2>&1 || runtime_error "node is required for devcanon-runtime bootstrap"',
        '  exec node "$js_entrypoint" "$@"',
      ].join("\n"),
    );
}

function legacyResolverAdapter(current: string): string {
  return current
    .replace(
      'const cliPath = path.join(scriptDir, "runtime", "devcanon-runtime.mjs");',
      'const cliPath = path.join(scriptDir, "runtime", "cli.js");',
    )
    .replaceAll(
      "devcanon-runtime bundle missing",
      "devcanon-runtime JS entrypoint missing",
    )
    .replace(
      [
        "const child = spawnSync(",
        "  process.execPath,",
        '  [cliPath, "runtime", "resolve-bash"],',
        "  {",
        '    encoding: "utf8",',
        "    env: process.env,",
        '    input: "",',
        "    windowsHide: true,",
        "  },",
        ");",
      ].join("\n"),
      [
        'const child = spawnSync(process.execPath, [cliPath, "resolve-bash"], {',
        '  encoding: "utf8",',
        "  env: process.env,",
        '  input: "",',
        "  windowsHide: true,",
        "});",
      ].join("\n"),
    );
}

describe("sync", () => {
  const suite = useSyncFixture();
  const { sync, renderAll, seedPassiveRuntime, expectSeedMatches } = suite;

  it("fresh sync installs skills and agents via copy", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(
      config.library.skillsDir,
      "greet",
      "---\nname: greet\ndescription: A greeting skill.\n---\n\n# greet\n\nHello.\n",
    );
    await createAgentFixture(
      config.library.agentsDir,
      "helper",
      makeAgentYaml("helper", { skills: ["greet"] }),
    );

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
    });

    expect(result.installed).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);

    // Manifest should exist
    expect(await pathExists(config.manifest.path)).toBe(true);

    // Agent file should be installed for claude
    const claudeAgentPath = path.join(
      config.targets.claude.agentsHome,
      "helper.md",
    );
    expect(await pathExists(claudeAgentPath)).toBe(true);

    // Skill directory should be installed for claude
    const claudeSkillPath = path.join(
      config.targets.claude.skillsHome,
      "greet",
    );
    expect(await pathExists(claudeSkillPath)).toBe(true);
  });

  it("copy-installs a skill examples/ subdirectory to both targets", async () => {
    const config = makeResolvedConfig(suite.tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    const skillDir = await createSkillFixture(
      config.library.skillsDir,
      "worked-skill",
      "---\nname: worked-skill\ndescription: A skill with worked examples.\n---\n\n# worked-skill\n",
      ["examples"],
    );
    await writeFile(
      path.join(skillDir, "examples", "walkthrough.md"),
      "worked example\n",
      "utf-8",
    );

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
    });

    expect(result.errors).toEqual([]);
    const manifest = JSON.parse(await readTextFile(config.manifest.path));
    for (const target of ["claude", "codex"] as const) {
      const installedExample = path.join(
        config.targets[target].skillsHome,
        "worked-skill",
        "examples",
        "walkthrough.md",
      );
      expect((await lstat(installedExample)).isFile()).toBe(true);
      expect((await lstat(installedExample)).isSymbolicLink()).toBe(false);
      expect(await readTextFile(installedExample)).toBe("worked example\n");
      expect(
        manifest.records.find(
          (record: { target: string; type: string; name: string }) =>
            record.target === target &&
            record.type === "skill" &&
            record.name === "worked-skill",
        ),
      ).toMatchObject({ installMode: "copy" });
    }
    await expectSeedMatches(config, {
      dryRun: false,
      force: false,
      strict: false,
    });
  });

  it("installs Codex agents as copies while configured symlink mode remains in effect for Codex skills", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      claude: { enabled: false },
      codex: { installMode: "symlink" },
    });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, "greet");
    await createAgentFixture(
      config.library.agentsDir,
      "helper",
      makeAgentYaml("helper"),
    );

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
    });
    const agentPath = path.join(config.targets.codex.agentsHome, "helper.toml");
    const skillPath = path.join(config.targets.codex.skillsHome, "greet");
    const manifest = JSON.parse(await readTextFile(config.manifest.path));

    expect(result.errors).toEqual([]);
    expect((await lstat(agentPath)).isFile()).toBe(true);
    expect((await lstat(agentPath)).isSymbolicLink()).toBe(false);
    expect(
      manifest.records.find(
        (record: { target: string; type: string; name: string }) =>
          record.target === "codex" &&
          record.type === "agent" &&
          record.name === "helper",
      ),
    ).toMatchObject({ installMode: "copy" });
    if (symlinkAvailable) {
      expect((await lstat(skillPath)).isSymbolicLink()).toBe(true);
    }
  });

  it("applies an explicit symlink mode only to non-agent Codex outputs", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      claude: { enabled: false },
      codex: { installMode: "copy" },
    });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, "greet");
    await createAgentFixture(
      config.library.agentsDir,
      "helper",
      makeAgentYaml("helper"),
    );

    const result = await sync(config, {
      mode: "symlink",
      dryRun: false,
      force: false,
      strict: false,
    });

    expect(result.errors).toEqual([]);
    expect(
      (
        await lstat(path.join(config.targets.codex.agentsHome, "helper.toml"))
      ).isSymbolicLink(),
    ).toBe(false);
    if (symlinkAvailable) {
      expect(
        (
          await lstat(path.join(config.targets.codex.skillsHome, "greet"))
        ).isSymbolicLink(),
      ).toBe(true);
    }
  });

  it.skipIf(!symlinkAvailable)(
    "migrates a verified managed Codex-agent symlink to a copy without changing its old target",
    async () => {
      const config = makeResolvedConfig(suite.tempDir, {
        claude: { enabled: false },
        codex: { installMode: "symlink" },
      });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      await createAgentFixture(
        config.library.agentsDir,
        "helper",
        makeAgentYaml("helper"),
      );
      const { outputs } = await renderAll(config, true, false);
      const output = outputs.find(
        (candidate) =>
          candidate.target === "codex" && candidate.type === "agent",
      );
      if (!output) throw new Error("Codex agent output missing from fixture");
      await mkdir(path.dirname(output.installedPath), { recursive: true });
      await symlink(output.generatedPath, output.installedPath);
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await writeFile(
        config.manifest.path,
        makeManifestJson(
          [
            {
              name: output.name,
              target: output.target,
              type: output.type,
              sourcePath: output.sourcePath,
              generatedPath: output.generatedPath,
              installedPath: output.installedPath,
              installMode: "symlink",
              contentHash: output.contentHash,
              timestamp: new Date().toISOString(),
            },
          ],
          { config },
        ),
        "utf-8",
      );
      const manifestBeforeDryRun = await readTextFile(config.manifest.path);

      const dryRun = await sync(config, {
        dryRun: true,
        force: false,
        strict: false,
      });

      expect(dryRun).toMatchObject({ updated: 0, errors: [] });
      expect((await lstat(output.installedPath)).isSymbolicLink()).toBe(true);
      expect(await readTextFile(config.manifest.path)).toBe(
        manifestBeforeDryRun,
      );

      const result = await sync(config, {
        dryRun: false,
        force: false,
        strict: false,
      });
      const manifest = JSON.parse(await readTextFile(config.manifest.path));

      expect(result).toMatchObject({ updated: 1, errors: [] });
      expect((await lstat(output.installedPath)).isSymbolicLink()).toBe(false);
      expect(await readTextFile(output.installedPath)).toBe(output.content);
      expect(await readTextFile(output.generatedPath)).toBe(output.content);
      expect(
        manifest.records.find(
          (record: { target: string; type: string; name: string }) =>
            record.target === "codex" &&
            record.type === "agent" &&
            record.name === "helper",
        ),
      ).toMatchObject({ installMode: "copy" });
    },
  );

  it("updates a copied Codex agent while retaining copy mode", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      claude: { enabled: false },
      codex: { installMode: "symlink" },
    });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    const agentSourcePath = await createAgentFixture(
      config.library.agentsDir,
      "helper",
      makeAgentYaml("helper"),
    );
    await sync(config, { dryRun: false, force: false, strict: false });

    await writeFile(
      agentSourcePath,
      makeAgentYaml("helper", { instructions: "Updated instructions" }),
      "utf-8",
    );
    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
    });
    const agentPath = path.join(config.targets.codex.agentsHome, "helper.toml");
    const manifest = JSON.parse(await readTextFile(config.manifest.path));

    expect(result).toMatchObject({ updated: 1, errors: [] });
    expect((await lstat(agentPath)).isSymbolicLink()).toBe(false);
    expect(await readTextFile(agentPath)).toContain("Updated instructions");
    expect(
      manifest.records.find(
        (record: { target: string; type: string; name: string }) =>
          record.target === "codex" &&
          record.type === "agent" &&
          record.name === "helper",
      ),
    ).toMatchObject({ installMode: "copy" });
  });

  it.skipIf(!symlinkAvailable)(
    "refuses to migrate a managed Codex-agent symlink with the wrong target",
    async () => {
      const config = makeResolvedConfig(suite.tempDir, {
        claude: { enabled: false },
        codex: { installMode: "symlink" },
      });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      await createAgentFixture(
        config.library.agentsDir,
        "helper",
        makeAgentYaml("helper"),
      );
      const { outputs } = await renderAll(config, true, false);
      const output = outputs.find(
        (candidate) =>
          candidate.target === "codex" && candidate.type === "agent",
      );
      if (!output) throw new Error("Codex agent output missing from fixture");
      const foreignPath = path.join(suite.tempDir, "foreign.toml");
      await writeFile(foreignPath, "foreign content", "utf-8");
      await mkdir(path.dirname(output.installedPath), { recursive: true });
      await symlink(foreignPath, output.installedPath);
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await writeFile(
        config.manifest.path,
        makeManifestJson(
          [
            {
              name: output.name,
              target: output.target,
              type: output.type,
              sourcePath: output.sourcePath,
              generatedPath: output.generatedPath,
              installedPath: output.installedPath,
              installMode: "symlink",
              contentHash: output.contentHash,
              timestamp: new Date().toISOString(),
            },
          ],
          { config },
        ),
        "utf-8",
      );
      const manifestBefore = JSON.parse(
        await readTextFile(config.manifest.path),
      );
      const agentRecordBefore = manifestBefore.records.find(
        (record: { target: string; type: string; name: string }) =>
          record.target === "codex" &&
          record.type === "agent" &&
          record.name === "helper",
      );

      const result = await sync(config, {
        dryRun: false,
        force: false,
        strict: false,
      });

      expect(result.updated).toBe(0);
      expect(result.errors).toEqual([
        expect.stringContaining("symlink target mismatch"),
      ]);
      expect(await readlink(output.installedPath)).toBe(foreignPath);
      const manifestAfter = JSON.parse(
        await readTextFile(config.manifest.path),
      );
      expect(
        manifestAfter.records.find(
          (record: { target: string; type: string; name: string }) =>
            record.target === "codex" &&
            record.type === "agent" &&
            record.name === "helper",
        ),
      ).toEqual(agentRecordBefore);
    },
  );

  it("preserves representative public helpers through render and copy install", async () => {
    const config = makeResolvedConfig(suite.tempDir);
    const repositoryConfig = await loadConfig(
      path.resolve("devcanon.config.yaml"),
    );
    config.toolNames = repositoryConfig.toolNames;
    config.fileArtifacts = repositoryConfig.fileArtifacts;
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });

    const catalogRows = parsePublicHelperCatalog(
      await readFile(path.resolve("contracts/public-helpers.md"), "utf8"),
    );
    expect(catalogRows).toHaveLength(30);
    const representativeIds = new Set([
      "play-subagent-execution/write-snapshot-manifest",
      "play-agent-dispatch/source-immutability",
      "issue-worktree-setup/setup-worktree",
    ]);
    const rows = catalogRows.filter((row) => representativeIds.has(row.id));
    expect(rows).toHaveLength(3);
    const owningSkills = new Set(rows.map((row) => row.skill));
    const selectedSkills = new Set([
      ...owningSkills,
      "branch-review",
      "issue-priming-workflow",
      "play-branch-finish",
      "play-brainstorm",
      "play-planning",
      "play-review",
      "play-review-response",
      "play-validate-review-artifacts",
      "pr-authoring",
      "subagent-lifecycle",
    ]);
    for (const skill of selectedSkills) {
      await cp(
        path.resolve("skills", skill),
        path.join(config.library.skillsDir, skill),
        { recursive: true },
      );
    }

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      mode: "copy" as const,
    });
    expect(result.errors).toEqual([]);

    for (const row of rows) {
      const sourceScript = path.resolve(row.executable);
      const sourceUsage = path.resolve(row.usageDocument);
      const relativeScript = path.relative(
        path.join("skills", row.skill),
        row.executable,
      );
      const relativeUsage = path.relative(
        path.join("skills", row.skill),
        row.usageDocument,
      );
      const expectedAdjacency = path
        .relative(path.dirname(relativeScript), relativeUsage)
        .split(path.sep)
        .join("/");
      const sourceScriptBytes = await readFile(sourceScript);
      const expectedScriptBytes =
        normalizePackagedShellBytes(sourceScriptBytes);
      const sourceUsageBytes = await readFile(sourceUsage);
      const sourceExecutableMode = (await stat(sourceScript)).mode & 0o111;

      for (const target of ["claude", "codex"] as const) {
        const generatedRoot = path.join(
          config.library.generatedDir,
          target,
          "skills",
          row.skill,
        );
        const installedRoot = path.join(
          config.targets[target].skillsHome,
          row.skill,
        );
        const generatedScript = path.join(generatedRoot, relativeScript);
        const generatedUsage = path.join(generatedRoot, relativeUsage);
        const installedScript = path.join(installedRoot, relativeScript);
        const installedUsage = path.join(installedRoot, relativeUsage);

        expect(await readFile(generatedScript), row.executable).toEqual(
          expectedScriptBytes,
        );
        expect(await readFile(installedScript), row.executable).toEqual(
          expectedScriptBytes,
        );
        expect(await readFile(generatedUsage), row.usageDocument).toEqual(
          sourceUsageBytes,
        );
        expect(await readFile(installedUsage), row.usageDocument).toEqual(
          sourceUsageBytes,
        );
        expect(
          path
            .relative(path.dirname(generatedScript), generatedUsage)
            .split(path.sep)
            .join("/"),
          row.executable,
        ).toBe(expectedAdjacency);
        expect(
          path
            .relative(path.dirname(installedScript), installedUsage)
            .split(path.sep)
            .join("/"),
          row.executable,
        ).toBe(expectedAdjacency);
        expect((await stat(generatedScript)).mode & 0o111).toBe(
          sourceExecutableMode,
        );
        expect((await stat(installedScript)).mode & 0o111).toBe(
          sourceExecutableMode,
        );
      }
    }
  });

  it("reuses a config-relative manifest boundary and records from a second cwd", async () => {
    const configDir = path.join(suite.tempDir, "project", "config");
    const firstCwd = path.join(suite.tempDir, "first-cwd");
    const secondCwd = path.join(suite.tempDir, "second-cwd");
    await mkdir(configDir, { recursive: true });
    await mkdir(firstCwd, { recursive: true });
    await mkdir(secondCwd, { recursive: true });
    const configPath = await createConfigFile(
      configDir,
      makeConfigYaml({
        library: {
          skillsDir: "./library/skills",
          agentsDir: "./library/agents",
          generatedDir: "./generated",
        },
        targets: {
          claude: {
            enabled: true,
            skillsHome: "./homes/claude/skills",
            agentsHome: "./homes/claude/agents",
          },
          codex: {
            enabled: true,
            skillsHome: "./homes/codex/skills",
            agentsHome: "./homes/codex/agents",
          },
        },
        defaults: {
          installMode: "copy",
          overwritePolicy: "overwrite-managed",
          cleanManagedOutputs: true,
        },
        manifest: { path: "./state/manifest.json" },
      }),
    );
    const previousCwd = process.cwd();
    const opts = { dryRun: false, force: false, strict: false } as const;

    try {
      process.chdir(firstCwd);
      const firstConfig = await loadConfig(configPath);
      await seedPassiveRuntime(firstConfig);
      await createSkillFixture(firstConfig.library.skillsDir, "shared");
      await createAgentFixture(
        firstConfig.library.agentsDir,
        "helper",
        makeAgentYaml("helper"),
      );

      const first = await sync(firstConfig, opts);
      const firstManifest = JSON.parse(
        await readTextFile(firstConfig.manifest.path),
      );

      expect(first.errors).toEqual([]);
      expect(first.installed).toBeGreaterThan(0);
      expect(firstConfig.manifest.path).toBe(
        path.join(configDir, "state", "manifest.json"),
      );
      expect(firstManifest.boundary).toEqual({
        claudeSkillsHome: path.join(configDir, "homes", "claude", "skills"),
        claudeAgentsHome: path.join(configDir, "homes", "claude", "agents"),
        codexSkillsHome: path.join(configDir, "homes", "codex", "skills"),
        codexAgentsHome: path.join(configDir, "homes", "codex", "agents"),
      });
      expect(
        new Set(
          firstManifest.records.map(
            (record: { installedPath: string }) => record.installedPath,
          ),
        ),
      ).toEqual(
        new Set([
          path.join(configDir, "homes", "claude", "skills", "shared"),
          path.join(configDir, "homes", "claude", "agents", "helper.md"),
          path.join(configDir, "homes", "claude", "skills", "devcanon-runtime"),
          path.join(configDir, "homes", "codex", "skills", "shared"),
          path.join(configDir, "homes", "codex", "agents", "helper.toml"),
          path.join(configDir, "homes", "codex", "skills", "devcanon-runtime"),
        ]),
      );

      process.chdir(secondCwd);
      const secondConfig = await loadConfig(configPath);
      const second = await sync(secondConfig, opts);
      const secondManifest = JSON.parse(
        await readTextFile(secondConfig.manifest.path),
      );

      expect(secondConfig.manifest.path).toBe(firstConfig.manifest.path);
      expect(second.errors).toEqual([]);
      expect(second.reconciliation).toBeUndefined();
      expect(second.installed).toBe(0);
      expect(second.updated).toBe(0);
      expect(second.skipped).toBeGreaterThan(0);
      expect(secondManifest.boundary).toEqual(firstManifest.boundary);
      expect(secondManifest.records).toEqual(firstManifest.records);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("backs up an existing empty legacy manifest but not a missing manifest", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson([], { legacy: true }),
      "utf-8",
    );

    await sync(config, { dryRun: false, force: false, strict: false });

    const migrated = JSON.parse(await readTextFile(config.manifest.path));
    expect(migrated.boundary).toBeDefined();
    expect(
      (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
        entry.includes(".backup-"),
      ),
    ).toHaveLength(1);

    const missingConfig = {
      ...config,
      manifest: { path: path.join(suite.tempDir, "missing", "manifest.json") },
    };
    await sync(missingConfig, { dryRun: false, force: false, strict: false });
    expect(
      (await readdir(path.dirname(missingConfig.manifest.path))).filter(
        (entry) => entry.includes(".backup-"),
      ),
    ).toHaveLength(0);
  });

  it("leaves legacy adapters and runtime unchanged when manifest binding backup fails", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const shell = path.join(runtimeDir, "scripts", "devcanon-runtime.sh");
    const resolver = path.join(runtimeDir, "scripts", "resolve-bash.mjs");
    const runtime = path.join(runtimeDir, "scripts", "runtime");
    const runtimeLeaves = [
      path.join(runtime, "devcanon-runtime.mjs"),
      path.join(runtime, "runtime-manifest.json"),
      path.join(runtime, "THIRD_PARTY_LICENSES"),
    ];
    const provider = await createDevcanonRuntimeProviderFixture(suite.tempDir);
    await writeFile(shell, legacyShellAdapter(await readFile(shell, "utf8")));
    await writeFile(
      resolver,
      legacyResolverAdapter(await readFile(resolver, "utf8")),
    );
    await writeFile(runtimeLeaves[0], "stale provider bytes\n", "utf8");
    const manifestBytes = makeManifestJson([], { legacy: true });
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(config.manifest.path, manifestBytes, "utf8");
    const sourceBefore = await Promise.all(
      [shell, resolver, ...runtimeLeaves].map((sourcePath) =>
        readFile(sourcePath),
      ),
    );

    await expect(
      withManifestPersistenceFaultsForTesting(
        (stage) => {
          if (stage === "backup-write") {
            throw new Error("forced legacy binding backup failure");
          }
        },
        () =>
          sync(
            config,
            { dryRun: false, force: false, strict: false },
            provider,
          ),
      ),
    ).rejects.toThrow("forced legacy binding backup failure");

    await expect(readTextFile(config.manifest.path)).resolves.toBe(
      manifestBytes,
    );
    await expect(
      Promise.all(
        [shell, resolver, ...runtimeLeaves].map((sourcePath) =>
          readFile(sourcePath),
        ),
      ),
    ).resolves.toEqual(sourceBefore);
    expect(
      (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
        entry.includes(".backup-"),
      ),
    ).toHaveLength(0);
  });

  it("keeps invalid dry sync observationally pure and explicitly recovers a real sync", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    const invalidBytes = "{corrupt manifest";
    const agentName = "renderable";
    const generatedSentinel = path.join(
      config.library.generatedDir,
      "claude",
      "agents",
      `${agentName}.md`,
    );
    await createAgentFixture(
      config.library.agentsDir,
      agentName,
      makeAgentYaml(agentName),
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(path.dirname(generatedSentinel), { recursive: true });
    await writeFile(config.manifest.path, invalidBytes, "utf-8");
    await writeFile(generatedSentinel, "generated sentinel", "utf-8");

    let dryError: unknown;
    try {
      await sync(config, { dryRun: true, force: false, strict: false });
    } catch (error) {
      dryError = error;
    }
    expect(dryError).toBeInstanceOf(UserError);
    expect((dryError as Error).message).toContain(
      "Manifest is invalid: corrupt JSON",
    );
    expect((dryError as UserError).hint).toContain("non-dry sync");
    expect(await readTextFile(config.manifest.path)).toBe(invalidBytes);
    expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
    expect(
      (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
        entry.startsWith(path.basename(config.manifest.path)),
      ),
    ).toEqual([path.basename(config.manifest.path)]);

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
    });

    expect(result.errors).toEqual([]);
    expect(await readTextFile(`${config.manifest.path}.bak`)).toBe(
      invalidBytes,
    );
    expect(suite.testLogger.warnings.join("\n")).toContain(
      `${config.manifest.path}.bak`,
    );
    expect(suite.testLogger.warnings).toEqual([
      `Recovered invalid manifest to verified backup ${config.manifest.path}.bak.`,
    ]);
    expect(
      JSON.parse(await readTextFile(config.manifest.path)).boundary,
    ).toBeDefined();
  });

  it("rejects an incomplete runtime before recovering an invalid non-dry manifest", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    await seedPassiveRuntime(config);
    const invalidBytes = "{corrupt manifest";
    const generatedSentinel = path.join(
      config.library.generatedDir,
      "claude",
      "skills",
      "sentinel",
    );
    const homeSentinel = path.join(
      config.targets.claude.skillsHome,
      "sentinel",
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(generatedSentinel, { recursive: true });
    await mkdir(homeSentinel, { recursive: true });
    await writeFile(config.manifest.path, invalidBytes, "utf-8");
    await writeFile(path.join(generatedSentinel, "keep"), "generated", "utf-8");
    await writeFile(path.join(homeSentinel, "keep"), "installed", "utf-8");
    await rm(
      path.join(
        config.library.skillsDir,
        "devcanon-runtime",
        "scripts",
        "devcanon-runtime.sh",
      ),
    );

    await expect(
      sync(config, { dryRun: true, force: false, strict: false }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("Manifest is invalid: corrupt JSON"),
    });
    await expect(
      sync(config, { dryRun: false, force: false, strict: false }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        "Passive runtime adapter pair is missing",
      ),
    });

    expect(await readTextFile(config.manifest.path)).toBe(invalidBytes);
    expect(await pathExists(`${config.manifest.path}.bak`)).toBe(false);
    expect(await readTextFile(path.join(generatedSentinel, "keep"))).toBe(
      "generated",
    );
    expect(await readTextFile(path.join(homeSentinel, "keep"))).toBe(
      "installed",
    );
  });

  it("accepts the provider before invalid-manifest recovery or any source mutation", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    const invalidBytes = "{corrupt manifest";
    const runtimeBundle = path.join(
      config.library.skillsDir,
      "devcanon-runtime",
      "scripts",
      "runtime",
      "devcanon-runtime.mjs",
    );
    const beforeBundle = await readFile(runtimeBundle, "utf8");
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(config.manifest.path, invalidBytes, "utf8");

    await expect(
      sync(config, { dryRun: false, force: false, strict: false }, async () => {
        throw new Error("provider acceptance failed");
      }),
    ).rejects.toThrow("provider acceptance failed");

    expect(await readTextFile(config.manifest.path)).toBe(invalidBytes);
    expect(await pathExists(`${config.manifest.path}.bak`)).toBe(false);
    expect(await readFile(runtimeBundle, "utf8")).toBe(beforeBundle);
    expect(await pathExists(config.library.generatedDir)).toBe(false);
  });

  it("validates a provider-backed source before invalid-manifest recovery", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    const invalidBytes = "{corrupt manifest";
    const generatedSentinel = path.join(
      config.library.generatedDir,
      "claude",
      "skills",
      "sentinel",
      "keep",
    );
    const installedSentinel = path.join(
      config.targets.claude.skillsHome,
      "sentinel",
      "keep",
    );
    const runtimeCatalog = path.join(
      config.library.skillsDir,
      "devcanon-runtime",
      "config",
      "runtime-config.json",
    );
    const provider = await createDevcanonRuntimeProviderFixture(suite.tempDir);
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(path.dirname(generatedSentinel), { recursive: true });
    await mkdir(path.dirname(installedSentinel), { recursive: true });
    await writeFile(config.manifest.path, invalidBytes, "utf8");
    await writeFile(generatedSentinel, "generated sentinel", "utf8");
    await writeFile(installedSentinel, "installed sentinel", "utf8");
    await writeFile(runtimeCatalog, '{"schema":"incompatible"}\n', "utf8");

    await expect(
      sync(
        config,
        { dryRun: false, force: false, strict: false },
        async () => provider,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining("Invalid runtime configuration catalog"),
    });

    expect(await readTextFile(config.manifest.path)).toBe(invalidBytes);
    expect(await pathExists(`${config.manifest.path}.bak`)).toBe(false);
    expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
    expect(await readTextFile(installedSentinel)).toBe("installed sentinel");
  });

  it.each(["absent", "provider-mismatched"] as const)(
    "repairs a %s derived subtree only for non-dry provider-backed sync",
    async (state) => {
      const config = makeResolvedConfig(suite.tempDir, {
        codex: { enabled: false },
      });
      const runtimeDir = path.join(
        config.library.skillsDir,
        "devcanon-runtime",
      );
      const derived = path.join(runtimeDir, "scripts", "runtime");
      const shell = path.join(runtimeDir, "scripts", "devcanon-runtime.sh");
      const resolver = path.join(runtimeDir, "scripts", "resolve-bash.mjs");
      const provider = await createDevcanonRuntimeProviderFixture(
        suite.tempDir,
      );
      if (process.platform !== "win32") {
        await chmod(shell, 0o700);
        await chmod(resolver, 0o600);
      }
      const [shellBefore, resolverBefore] = await Promise.all([
        readFile(shell),
        readFile(resolver),
      ]);
      if (state === "absent") {
        await rm(derived, { recursive: true, force: true });
      } else {
        await writeFile(
          path.join(derived, "devcanon-runtime.mjs"),
          "stale provider bytes\n",
          "utf8",
        );
      }

      const dry = await sync(
        config,
        { dryRun: true, force: false, strict: false },
        provider,
      );
      expect(dry.errors).toEqual([]);
      expect(suite.testLogger.infos.join("\n")).toContain(
        "Source runtime: reconcile derived subtree",
      );
      if (state === "absent") expect(await pathExists(derived)).toBe(false);
      else {
        await expect(
          readFile(path.join(derived, "devcanon-runtime.mjs"), "utf8"),
        ).resolves.toBe("stale provider bytes\n");
      }
      expect(await pathExists(config.library.generatedDir)).toBe(false);

      const applied = await sync(
        config,
        { dryRun: false, force: false, strict: false },
        provider,
      );
      expect(applied.errors).toEqual([]);
      expect(await readdir(derived)).toEqual([
        "THIRD_PARTY_LICENSES",
        "devcanon-runtime.mjs",
        "runtime-manifest.json",
      ]);
      await expect(readFile(shell)).resolves.toEqual(shellBefore);
      await expect(readFile(resolver)).resolves.toEqual(resolverBefore);
      if (process.platform !== "win32") {
        expect((await stat(shell)).mode & 0o777).toBe(0o700);
        expect((await stat(resolver)).mode & 0o777).toBe(0o600);
      }
    },
  );

  it("updates an installed runtime copy after capability-profile intent changes", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    const options = { dryRun: false, force: false, strict: false } as const;
    const first = await sync(config, options);
    expect(first.errors).toEqual([]);
    config.capabilityProfiles = {
      ...config.capabilityProfiles,
      balanced: {
        ...config.capabilityProfiles.balanced,
        codex: "updated-profile-model",
      },
    };

    const second = await sync(config, options);

    expect(second.errors).toEqual([]);
    expect(second.updated).toBe(1);
    await expect(
      readFile(
        path.join(
          config.targets.claude.skillsHome,
          "devcanon-runtime",
          "config",
          "runtime-config.json",
        ),
        "utf8",
      ),
    ).resolves.toContain("updated-profile-model");
  });

  it("refuses to replace an installed runtime whose shell line endings changed", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    const options = { dryRun: false, force: false, strict: false } as const;
    const first = await sync(config, options);
    expect(first.errors).toEqual([]);
    const installedPath = path.join(
      config.targets.claude.skillsHome,
      "devcanon-runtime",
    );
    const shell = path.join(installedPath, "scripts", "devcanon-runtime.sh");
    const original = await readFile(shell);
    const crlf = Buffer.from(
      original.toString("utf8").replaceAll("\n", "\r\n"),
      "utf8",
    );
    expect(crlf).not.toEqual(original);
    await writeFile(shell, crlf);
    config.capabilityProfiles = {
      ...config.capabilityProfiles,
      balanced: {
        ...config.capabilityProfiles.balanced,
        codex: "updated-after-installed-shell-mutation",
      },
    };
    const manifestBefore = await readTextFile(config.manifest.path);

    const second = await sync(config, options);

    expect(second.updated).toBe(0);
    expect(second.errors).toEqual([
      expect.stringContaining("installed copy content hash mismatch"),
    ]);
    await expect(readFile(shell)).resolves.toEqual(crlf);
    await expect(readTextFile(config.manifest.path)).resolves.toBe(
      manifestBefore,
    );
  });

  it("does not repair the source runtime before prospective output validation succeeds", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    const runtimeBundle = path.join(
      config.library.skillsDir,
      "devcanon-runtime",
      "scripts",
      "runtime",
      "devcanon-runtime.mjs",
    );
    const provider = await createDevcanonRuntimeProviderFixture(suite.tempDir);
    await writeFile(runtimeBundle, "stale provider bytes\n", "utf8");
    await createAgentFixture(
      config.library.agentsDir,
      "invalid-agent",
      "name: invalid-agent\n",
    );

    await expect(
      sync(config, { dryRun: false, force: false, strict: false }, provider),
    ).rejects.toThrow();
    await expect(readFile(runtimeBundle, "utf8")).resolves.toBe(
      "stale provider bytes\n",
    );
  });

  it("treats a residual lock as invalid during dry sync without rendering or recovery", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    const lockPath = `${config.manifest.path}.lock`;
    const agentName = "renderable";
    const generatedSentinel = path.join(
      config.library.generatedDir,
      "claude",
      "agents",
      `${agentName}.md`,
    );
    await createAgentFixture(
      config.library.agentsDir,
      agentName,
      makeAgentYaml(agentName),
    );
    await mkdir(path.dirname(lockPath), { recursive: true });
    await mkdir(path.dirname(generatedSentinel), { recursive: true });
    await writeFile(lockPath, "residual lock", "utf-8");
    await writeFile(generatedSentinel, "generated sentinel", "utf-8");

    let dryError: unknown;
    try {
      await sync(config, { dryRun: true, force: false, strict: false });
    } catch (error) {
      dryError = error;
    }
    expect(dryError).toBeInstanceOf(UserError);
    expect((dryError as Error).message).toContain(lockPath);
    expect((dryError as UserError).hint).toContain("manually");
    expect((dryError as UserError).hint).not.toContain("non-dry sync");

    expect(await pathExists(config.manifest.path)).toBe(false);
    expect(await readTextFile(lockPath)).toBe("residual lock");
    expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
    expect(suite.testLogger.infos).toEqual([]);
    expect(suite.testLogger.warnings).toEqual([]);
  });

  it("gives unsafe manifest sources manual dry-run guidance without attempting recovery", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    const agentName = "renderable";
    const generatedSentinel = path.join(
      config.library.generatedDir,
      "claude",
      "agents",
      `${agentName}.md`,
    );
    await createAgentFixture(
      config.library.agentsDir,
      agentName,
      makeAgentYaml(agentName),
    );
    await mkdir(config.manifest.path, { recursive: true });
    await mkdir(path.dirname(generatedSentinel), { recursive: true });
    await writeFile(generatedSentinel, "generated sentinel", "utf-8");

    let dryError: unknown;
    try {
      await sync(config, { dryRun: true, force: false, strict: false });
    } catch (error) {
      dryError = error;
    }

    expect(dryError).toBeInstanceOf(UserError);
    expect((dryError as Error).message).toContain(config.manifest.path);
    expect((dryError as Error).message).toContain("unavailable or unsafe");
    expect((dryError as UserError).hint).toContain("regular file");
    expect((dryError as UserError).hint).not.toContain("non-dry sync");
    expect((await lstat(config.manifest.path)).isDirectory()).toBe(true);
    expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
    expect(await pathExists(`${config.manifest.path}.bak`)).toBe(false);
    expect(await pathExists(`${config.manifest.path}.lock`)).toBe(false);
    expect(suite.testLogger.infos).toEqual([]);
    expect(suite.testLogger.warnings).toEqual([]);
  });

  it("continues from the exact collision-allocated invalid recovery backup", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    const invalidBytes = '{"version":1}';
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(config.manifest.path, invalidBytes, "utf-8");
    await writeFile(`${config.manifest.path}.bak`, "occupied backup", "utf-8");

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
    });

    expect(result.errors).toEqual([]);
    expect(await readTextFile(`${config.manifest.path}.bak`)).toBe(
      "occupied backup",
    );
    expect(await readTextFile(`${config.manifest.path}.bak-1`)).toBe(
      invalidBytes,
    );
    expect(suite.testLogger.warnings.join("\n")).toContain(
      `${config.manifest.path}.bak-1`,
    );
  });

  it.each([
    ["source-changed", "recovery-after-candidate"],
    ["source-unavailable-or-unsafe", "recovery-before-candidate"],
    ["backup-create-or-verify-failed", "recovery-candidate-write"],
    ["source-retirement-failed", "recovery-retirement"],
  ] as const)(
    "stops a real invalid sync on pre-I5 %s without later effects",
    async (category, faultStage) => {
      const scenarioDir = path.join(suite.tempDir, category);
      const config = makeResolvedConfig(scenarioDir, {
        codex: { enabled: false },
      });
      await seedPassiveRuntime(config);
      const invalidBytes = `{corrupt ${category}`;
      const agentName = "renderable";
      const generatedSentinel = path.join(
        config.library.generatedDir,
        "claude",
        "agents",
        `${agentName}.md`,
      );
      await createAgentFixture(
        config.library.agentsDir,
        agentName,
        makeAgentYaml(agentName),
      );
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await mkdir(path.dirname(generatedSentinel), { recursive: true });
      await writeFile(config.manifest.path, invalidBytes, "utf-8");
      await writeFile(generatedSentinel, "generated sentinel", "utf-8");

      await expect(
        withManifestPersistenceFaultsForTesting(
          async (stage) => {
            if (stage !== faultStage) return;
            if (category === "source-changed") {
              await writeFile(config.manifest.path, "{replacement", "utf-8");
              return;
            }
            if (category === "source-unavailable-or-unsafe") {
              await rm(config.manifest.path);
              await mkdir(config.manifest.path);
              return;
            }
            throw new Error(`injected ${category}`);
          },
          () => sync(config, { dryRun: false, force: false, strict: false }),
        ),
      ).rejects.toThrow(category);

      expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
      expect(suite.testLogger.infos).toEqual([]);
      expect(suite.testLogger.warnings).toEqual([]);
      expect(await pathExists(`${config.manifest.path}.lock`)).toBe(false);
    },
  );

  it("preserves lock-unavailable as the primary pre-I5 sync failure", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    const invalidBytes = "{corrupt lock contention";
    const lockPath = `${config.manifest.path}.lock`;
    const agentName = "renderable";
    const generatedSentinel = path.join(
      config.library.generatedDir,
      "claude",
      "agents",
      `${agentName}.md`,
    );
    await createAgentFixture(
      config.library.agentsDir,
      agentName,
      makeAgentYaml(agentName),
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(path.dirname(generatedSentinel), { recursive: true });
    await writeFile(config.manifest.path, invalidBytes, "utf-8");
    await writeFile(lockPath, "other writer", "utf-8");
    await writeFile(generatedSentinel, "generated sentinel", "utf-8");

    let thrown: unknown;
    try {
      await sync(config, { dryRun: false, force: false, strict: false });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      message: expect.stringContaining("lock-unavailable"),
      hint: `Confirm no DevCanon manifest operation is active, then manually correct the pre-existing sibling lock at ${lockPath}.`,
    });
    expect((thrown as UserError).hint).not.toContain(".bak");

    expect(await readTextFile(config.manifest.path)).toBe(invalidBytes);
    expect(await readTextFile(lockPath)).toBe("other writer");
    expect(await pathExists(`${config.manifest.path}.bak`)).toBe(false);
    expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
    expect(suite.testLogger.infos).toEqual([]);
    expect(suite.testLogger.warnings).toEqual([]);
  });

  it.each(["EACCES", "EROFS", "ENOSPC", "EMFILE"] as const)(
    "reports an injected %s recovery lock failure without lock-removal guidance",
    async (code) => {
      const scenarioDir = path.join(suite.tempDir, `sync-lock-${code}`);
      const config = makeResolvedConfig(scenarioDir, {
        codex: { enabled: false },
      });
      await seedPassiveRuntime(config);
      const primary = Object.assign(new Error(`injected ${code}`), { code });
      const generatedSentinel = path.join(
        config.library.generatedDir,
        "claude",
        "agents",
        "sentinel.md",
      );
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await mkdir(path.dirname(generatedSentinel), { recursive: true });
      await writeFile(config.manifest.path, "{corrupt", "utf-8");
      await writeFile(generatedSentinel, "generated sentinel", "utf-8");

      let thrown: unknown;
      try {
        await withManifestPersistenceFaultsForTesting(
          (stage) => {
            if (stage === ("recovery-lock-open" as typeof stage)) {
              throw primary;
            }
          },
          () => sync(config, { dryRun: false, force: false, strict: false }),
        );
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toMatchObject({
        message: expect.stringContaining("lock-unavailable"),
        cause: primary,
        hint: "Resolve the reported manifest state before retrying sync.",
      });
      expect((thrown as UserError).hint).not.toContain("manually");
      expect(await readTextFile(config.manifest.path)).toBe("{corrupt");
      expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
      expect(await pathExists(`${config.manifest.path}.bak`)).toBe(false);
      expect(await pathExists(`${config.manifest.path}.lock`)).toBe(false);
      expect(suite.testLogger.infos).toEqual([]);
      expect(suite.testLogger.warnings).toEqual([]);
    },
  );

  it("reports an injected pre-open EEXIST recovery lock failure without lock-removal guidance", async () => {
    const scenarioDir = path.join(suite.tempDir, "sync-lock-EEXIST");
    const config = makeResolvedConfig(scenarioDir, {
      codex: { enabled: false },
    });
    await seedPassiveRuntime(config);
    const primary = Object.assign(new Error("injected EEXIST"), {
      code: "EEXIST",
    });
    const generatedSentinel = path.join(
      config.library.generatedDir,
      "claude",
      "agents",
      "sentinel.md",
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(path.dirname(generatedSentinel), { recursive: true });
    await writeFile(config.manifest.path, "{corrupt", "utf-8");
    await writeFile(generatedSentinel, "generated sentinel", "utf-8");

    let thrown: unknown;
    try {
      await withManifestPersistenceFaultsForTesting(
        (stage) => {
          if (stage === ("recovery-lock-open" as typeof stage)) {
            throw primary;
          }
        },
        () => sync(config, { dryRun: false, force: false, strict: false }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      message: expect.stringContaining("lock-unavailable"),
      cause: primary,
      hint: "Resolve the reported manifest state before retrying sync.",
    });
    expect((thrown as UserError).hint).not.toContain("manually");
    expect(await readTextFile(config.manifest.path)).toBe("{corrupt");
    expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
    expect(await pathExists(`${config.manifest.path}.bak`)).toBe(false);
    expect(await pathExists(`${config.manifest.path}.lock`)).toBe(false);
    expect((await readdir(path.dirname(config.manifest.path))).sort()).toEqual([
      "generated",
      "manifest.json",
      "skills",
    ]);
    expect(suite.testLogger.infos).toEqual([]);
    expect(suite.testLogger.warnings).toEqual([]);
  });

  it("does not replay a genuine contention cause as pre-existing sync custody", async () => {
    const contentionPath = path.join(
      suite.tempDir,
      "genuine-sync-contention.json",
    );
    await writeFile(contentionPath, "{corrupt", "utf-8");
    const contentionInspection = await inspectManifest(contentionPath);
    await writeFile(`${contentionPath}.lock`, "active", "utf-8");
    const contention = await recoverInvalidManifest(contentionInspection);
    if (contention.completed) throw new Error("expected contention result");
    const replayedCause = contention.cause;
    expect((replayedCause as NodeJS.ErrnoException).code).toBe("EEXIST");

    const scenarioDir = path.join(suite.tempDir, "sync-replayed-EEXIST");
    const config = makeResolvedConfig(scenarioDir, {
      codex: { enabled: false },
    });
    await seedPassiveRuntime(config);
    const generatedSentinel = path.join(
      config.library.generatedDir,
      "claude",
      "agents",
      "sentinel.md",
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(path.dirname(generatedSentinel), { recursive: true });
    await writeFile(config.manifest.path, "{corrupt", "utf-8");
    await writeFile(generatedSentinel, "generated sentinel", "utf-8");

    let thrown: unknown;
    try {
      await withManifestPersistenceFaultsForTesting(
        (stage) => {
          if (stage === ("recovery-lock-open" as typeof stage)) {
            throw replayedCause;
          }
        },
        () => sync(config, { dryRun: false, force: false, strict: false }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      message: expect.stringContaining("lock-unavailable"),
      cause: replayedCause,
      hint: "Resolve the reported manifest state before retrying sync.",
    });
    expect((thrown as Error & { cause?: unknown }).cause).toBe(replayedCause);
    expect((thrown as UserError).hint).not.toContain("manually");
    expect(await readTextFile(config.manifest.path)).toBe("{corrupt");
    expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
    expect(await pathExists(`${config.manifest.path}.bak`)).toBe(false);
    expect(await pathExists(`${config.manifest.path}.lock`)).toBe(false);
    expect((await readdir(path.dirname(config.manifest.path))).sort()).toEqual([
      "generated",
      "manifest.json",
      "skills",
    ]);
    expect(suite.testLogger.infos).toEqual([]);
    expect(suite.testLogger.warnings).toEqual([]);
  });

  it("reports the exact retained unverifiable candidate before any sync effect", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    const invalidBytes = "{corrupt pre-stat candidate";
    const candidatePath = `${config.manifest.path}.bak`;
    const primary = new Error("candidate stat fault");
    const agentName = "renderable";
    const generatedSentinel = path.join(
      config.library.generatedDir,
      "claude",
      "agents",
      `${agentName}.md`,
    );
    await createAgentFixture(
      config.library.agentsDir,
      agentName,
      makeAgentYaml(agentName),
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(path.dirname(generatedSentinel), { recursive: true });
    await writeFile(config.manifest.path, invalidBytes, "utf-8");
    await writeFile(generatedSentinel, "generated sentinel", "utf-8");

    let thrown: unknown;
    try {
      await withManifestPersistenceFaultsForTesting(
        (stage) => {
          if (stage === "recovery-candidate-stat") throw primary;
        },
        () => sync(config, { dryRun: false, force: false, strict: false }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      message: expect.stringContaining("backup-create-or-verify-failed"),
      cause: primary,
      hint: `Inspect and preserve the unverifiable recovery candidate at ${candidatePath}; do not remove it by pathname alone.`,
    });
    expect((thrown as Error).message).toContain(primary.message);
    expect((thrown as Error & { cause?: unknown }).cause).toBe(primary);
    expect(await readTextFile(config.manifest.path)).toBe(invalidBytes);
    expect(await readTextFile(candidatePath)).toBe("");
    expect(await pathExists(`${config.manifest.path}.lock`)).toBe(false);
    expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
    expect(suite.testLogger.infos).toEqual([]);
    expect(suite.testLogger.warnings).toEqual([]);
    expect((await readdir(path.dirname(config.manifest.path))).sort()).toEqual(
      [
        "agents",
        "generated",
        "skills",
        path.basename(config.manifest.path),
        path.basename(candidatePath),
      ].sort(),
    );
  });

  it("reports an exact candidate replacement without claiming recovery ownership", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    const invalidBytes = "{corrupt candidate replacement";
    const candidatePath = `${config.manifest.path}.bak`;
    const replacementPath = `${candidatePath}.replacement`;
    const replacementBytes = "unmanaged replacement";
    const agentName = "renderable";
    const generatedSentinel = path.join(
      config.library.generatedDir,
      "claude",
      "agents",
      `${agentName}.md`,
    );
    await createAgentFixture(
      config.library.agentsDir,
      agentName,
      makeAgentYaml(agentName),
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(path.dirname(generatedSentinel), { recursive: true });
    await writeFile(config.manifest.path, invalidBytes, "utf-8");
    await writeFile(generatedSentinel, "generated sentinel", "utf-8");

    let thrown: unknown;
    try {
      await withManifestPersistenceFaultsForTesting(
        async (stage) => {
          if (stage !== "recovery-after-candidate") return;
          await writeFile(replacementPath, replacementBytes, "utf-8");
          await rm(candidatePath);
          await rename(replacementPath, candidatePath);
        },
        () => sync(config, { dryRun: false, force: false, strict: false }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      message: expect.stringContaining("backup-create-or-verify-failed"),
      hint: `Preserve and inspect the unmanaged replacement at ${candidatePath}; it is not owned by recovery and must not be auto-deleted.`,
    });
    expect((thrown as Error & { hint?: string }).hint).not.toContain(
      "owned recovery candidate",
    );
    expect(await readTextFile(config.manifest.path)).toBe(invalidBytes);
    expect(await readTextFile(candidatePath)).toBe(replacementBytes);
    expect(await pathExists(`${config.manifest.path}.lock`)).toBe(false);
    expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
    expect(suite.testLogger.infos).toEqual([]);
    expect(suite.testLogger.warnings).toEqual([]);
  });

  it("does not mask a primary pre-I5 category with cleanup degradation", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    const invalidBytes = "{corrupt combined failure";
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(config.manifest.path, invalidBytes, "utf-8");

    let thrown: unknown;
    try {
      await withManifestPersistenceFaultsForTesting(
        (stage) => {
          if (stage === "recovery-candidate-write") {
            throw new Error("primary candidate write failure");
          }
        },
        () => sync(config, { dryRun: false, force: false, strict: false }),
        {
          injectPostAttemptOutcome: ({ operation }) =>
            operation === "recovery-lock-close"
              ? new Error("secondary close degradation")
              : undefined,
        },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      message: expect.stringContaining("backup-create-or-verify-failed"),
      cause: new Error("primary candidate write failure"),
      hint: "Resolve the reported manifest state before retrying sync.",
    });
    expect((thrown as Error).message).toContain("close-degraded");
    expect((thrown as UserError).hint).not.toContain(config.manifest.path);
    expect(await readTextFile(config.manifest.path)).toBe(invalidBytes);
    expect(await pathExists(`${config.manifest.path}.bak`)).toBe(false);
    expect(await pathExists(`${config.manifest.path}.lock`)).toBe(false);
    expect(suite.testLogger.infos).toEqual([]);
    expect(suite.testLogger.warnings).toEqual([]);
  });

  it.each([
    [true, false, "close-degraded"],
    [false, true, "unlink-degraded"],
    [true, true, "both-degraded"],
  ] as const)(
    "stops after committed recovery with %s/%s cleanup as %s",
    async (failClose, failUnlink, cleanup) => {
      const scenarioDir = path.join(suite.tempDir, cleanup);
      const config = makeResolvedConfig(scenarioDir, {
        codex: { enabled: false },
      });
      await seedPassiveRuntime(config);
      const invalidBytes = `{corrupt ${cleanup}`;
      const agentName = "renderable";
      const generatedSentinel = path.join(
        config.library.generatedDir,
        "claude",
        "agents",
        `${agentName}.md`,
      );
      await createAgentFixture(
        config.library.agentsDir,
        agentName,
        makeAgentYaml(agentName),
      );
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await mkdir(path.dirname(generatedSentinel), { recursive: true });
      await writeFile(config.manifest.path, invalidBytes, "utf-8");
      await writeFile(generatedSentinel, "generated sentinel", "utf-8");

      await expect(
        withManifestPersistenceFaultsForTesting(
          () => {},
          () => sync(config, { dryRun: false, force: false, strict: false }),
          {
            injectPostAttemptOutcome: ({ operation }) => {
              if (failClose && operation === "recovery-lock-close") {
                return new Error("injected close degradation");
              }
              if (failUnlink && operation === "recovery-lock-unlink") {
                return new Error("injected unlink degradation");
              }
              return undefined;
            },
          },
        ),
      ).rejects.toThrow(cleanup);

      expect(await pathExists(config.manifest.path)).toBe(false);
      expect(await readTextFile(`${config.manifest.path}.bak`)).toBe(
        invalidBytes,
      );
      expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
      expect(suite.testLogger.warnings.join("\n")).toContain(
        `${config.manifest.path}.bak`,
      );
      expect(suite.testLogger.warnings).toEqual([
        `Manifest recovery committed to verified backup ${config.manifest.path}.bak, but cleanup degraded (${cleanup}).`,
      ]);
      expect(suite.testLogger.warnings.join("\n")).not.toContain(
        "Recovered invalid manifest to verified backup",
      );
      // The deterministic post-attempt seam reports degraded cleanup after
      // the literal unlink effect, so its exact lock state is absent.
      expect(await pathExists(`${config.manifest.path}.lock`)).toBe(false);
    },
  );

  it.each(["skill-ancestor", "agent-ancestor"] as const)(
    "rejects selected-selected component overlap with %s before writes",
    async (direction) => {
      const scenarioDir = path.join(suite.tempDir, direction);
      const root = path.join(scenarioDir, "managed");
      const skillsHome =
        direction === "skill-ancestor" ? root : path.join(root, "parent.md");
      const agentsHome =
        direction === "skill-ancestor" ? path.join(root, "parent") : root;
      const skillName = direction === "skill-ancestor" ? "parent" : "child";
      const agentName = direction === "skill-ancestor" ? "child" : "parent";
      const config = makeResolvedConfig(scenarioDir, {
        claude: { skillsHome, agentsHome },
        codex: { enabled: false },
      });
      await seedPassiveRuntime(config);
      const skillPath = path.join(skillsHome, skillName);
      const agentPath = path.join(agentsHome, `${agentName}.md`);
      await createSkillFixture(config.library.skillsDir, skillName);
      await createAgentFixture(
        config.library.agentsDir,
        agentName,
        makeAgentYaml(agentName),
      );
      const generatedSentinel = path.join(
        config.library.generatedDir,
        "claude",
        "agents",
        `${agentName}.md`,
      );
      await mkdir(path.dirname(generatedSentinel), { recursive: true });
      await writeFile(generatedSentinel, "generated sentinel", "utf-8");

      await expect(
        sync(config, { dryRun: false, force: false, strict: false }),
      ).rejects.toThrow("Managed output physical path conflict");

      expect(await pathExists(skillPath)).toBe(false);
      expect(await pathExists(agentPath)).toBe(false);
      expect(await pathExists(config.manifest.path)).toBe(false);
      expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
    },
  );

  it.each([
    ["active-first", "claude"],
    ["passive-first", "claude"],
    ["active-first", undefined],
    ["passive-first", undefined],
  ] as const)(
    "rejects retained-retained component overlap in %s order for target %s",
    async (order, target) => {
      const scenarioDir = path.join(suite.tempDir, order);
      const root = path.join(scenarioDir, "managed");
      const config = makeResolvedConfig(scenarioDir, {
        claude: { skillsHome: root },
        codex: { agentsHome: path.join(root, "parent") },
        defaults: { cleanManagedOutputs: false },
      });
      await seedPassiveRuntime(config);
      const activeRecord = {
        target: "claude" as const,
        type: "skill" as const,
        name: "parent",
        sourcePath: path.join(config.library.skillsDir, "parent"),
        generatedPath: null,
        installedPath: path.join(root, "parent"),
        installMode: "copy" as const,
        contentHash: "active",
        timestamp: new Date().toISOString(),
      };
      const passiveRecord = {
        target: "codex" as const,
        type: "agent" as const,
        name: "child",
        sourcePath: path.join(config.library.agentsDir, "child.yaml"),
        generatedPath: null,
        installedPath: path.join(root, "parent", "child.toml"),
        installMode: "copy" as const,
        contentHash: "passive",
        timestamp: new Date().toISOString(),
      };
      const records =
        order === "active-first"
          ? [activeRecord, passiveRecord]
          : [passiveRecord, activeRecord];
      const renderableName = "render-sentinel";
      const generatedSentinel = path.join(
        config.library.generatedDir,
        "claude",
        "agents",
        `${renderableName}.md`,
      );
      await createAgentFixture(
        config.library.agentsDir,
        renderableName,
        makeAgentYaml(renderableName),
      );
      await mkdir(path.dirname(generatedSentinel), { recursive: true });
      await writeFile(generatedSentinel, "generated sentinel", "utf-8");
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await writeFile(
        config.manifest.path,
        makeManifestJson(records, { config }),
        "utf-8",
      );
      const manifestBefore = await readTextFile(config.manifest.path);

      await expect(
        sync(config, {
          dryRun: false,
          force: false,
          strict: false,
          target,
        }),
      ).rejects.toThrow("Managed output physical path conflict");

      expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
      expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
      expect(suite.testLogger.infos).toEqual([]);
    },
  );

  it.each(["active-first", "passive-first"] as const)(
    "rejects passive-ancestor active-descendant retained overlap in %s order",
    async (order) => {
      const scenarioDir = path.join(suite.tempDir, `passive-ancestor-${order}`);
      const root = path.join(scenarioDir, "managed");
      const config = makeResolvedConfig(scenarioDir, {
        claude: { agentsHome: path.join(root, "parent") },
        codex: { skillsHome: root },
        defaults: { cleanManagedOutputs: false },
      });
      await seedPassiveRuntime(config);
      const passiveAncestor = {
        target: "codex" as const,
        type: "skill" as const,
        name: "parent",
        sourcePath: path.join(config.library.skillsDir, "parent"),
        generatedPath: null,
        installedPath: path.join(root, "parent"),
        installMode: "copy" as const,
        contentHash: "passive",
        timestamp: new Date().toISOString(),
      };
      const activeDescendant = {
        target: "claude" as const,
        type: "agent" as const,
        name: "child",
        sourcePath: path.join(config.library.agentsDir, "child.yaml"),
        generatedPath: null,
        installedPath: path.join(root, "parent", "child.md"),
        installMode: "copy" as const,
        contentHash: "active",
        timestamp: new Date().toISOString(),
      };
      const records =
        order === "active-first"
          ? [activeDescendant, passiveAncestor]
          : [passiveAncestor, activeDescendant];
      const renderableName = "render-sentinel";
      const generatedSentinel = path.join(
        config.library.generatedDir,
        "claude",
        "skills",
        renderableName,
        "SKILL.md",
      );
      await createSkillFixture(config.library.skillsDir, renderableName);
      await mkdir(path.dirname(generatedSentinel), { recursive: true });
      await writeFile(generatedSentinel, "generated sentinel", "utf-8");
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await writeFile(
        config.manifest.path,
        makeManifestJson(records, { config }),
        "utf-8",
      );
      const manifestBefore = await readTextFile(config.manifest.path);

      let conflict: unknown;
      try {
        await sync(config, {
          dryRun: false,
          force: false,
          strict: false,
          target: "claude",
        });
      } catch (error) {
        conflict = error;
      }
      expect(conflict).toBeInstanceOf(UserError);
      expect((conflict as Error).message).toContain(
        "Managed output physical path conflict",
      );
      expect((conflict as Error).message).toContain(
        passiveAncestor.installedPath,
      );
      expect((conflict as Error).message).toContain(
        activeDescendant.installedPath,
      );

      expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
      expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
      expect(await pathExists(activeDescendant.installedPath)).toBe(false);
      expect(await pathExists(passiveAncestor.installedPath)).toBe(false);
      expect(suite.testLogger.infos).toEqual([]);
    },
  );

  it.each(["skill-first", "agent-first"] as const)(
    "allows passive-passive retained component overlap in %s order",
    async (order) => {
      const scenarioDir = path.join(suite.tempDir, `passive-passive-${order}`);
      const root = path.join(scenarioDir, "managed");
      const config = makeResolvedConfig(scenarioDir, {
        codex: {
          skillsHome: root,
          agentsHome: path.join(root, "parent"),
        },
        defaults: { cleanManagedOutputs: false },
      });
      await seedPassiveRuntime(config);
      const skillRecord = {
        target: "codex" as const,
        type: "skill" as const,
        name: "parent",
        sourcePath: path.join(config.library.skillsDir, "parent"),
        generatedPath: null,
        installedPath: path.join(root, "parent"),
        installMode: "copy" as const,
        contentHash: "passive-skill",
        timestamp: new Date().toISOString(),
      };
      const agentRecord = {
        target: "codex" as const,
        type: "agent" as const,
        name: "child",
        sourcePath: path.join(config.library.agentsDir, "child.yaml"),
        generatedPath: null,
        installedPath: path.join(root, "parent", "child.toml"),
        installMode: "copy" as const,
        contentHash: "passive-agent",
        timestamp: new Date().toISOString(),
      };
      const records =
        order === "skill-first"
          ? [skillRecord, agentRecord]
          : [agentRecord, skillRecord];
      const renderableName = "render-sentinel";
      const generatedSentinel = path.join(
        config.library.generatedDir,
        "claude",
        "skills",
        renderableName,
        "SKILL.md",
      );
      await createSkillFixture(config.library.skillsDir, renderableName);
      await mkdir(path.dirname(generatedSentinel), { recursive: true });
      await writeFile(generatedSentinel, "generated sentinel", "utf-8");
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await writeFile(
        config.manifest.path,
        makeManifestJson(records, { config }),
        "utf-8",
      );
      const manifestBefore = await readTextFile(config.manifest.path);

      const result = await sync(config, {
        dryRun: true,
        force: false,
        strict: false,
        target: "claude",
      });

      expect(result).toMatchObject({
        installed: 0,
        updated: 0,
        removed: 0,
        conflicts: 0,
        errors: [],
      });
      expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
      expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
      expect(await pathExists(skillRecord.installedPath)).toBe(false);
      expect(await pathExists(agentRecord.installedPath)).toBe(false);
    },
  );

  it.each(["retained-ancestor", "selected-ancestor"] as const)(
    "rejects a %s retained-selected component overlap before side effects",
    async (direction) => {
      const scenarioDir = path.join(suite.tempDir, direction);
      const root = path.join(scenarioDir, "managed");
      const claudeSkillsHome =
        direction === "selected-ancestor"
          ? root
          : path.join(root, "parent.toml");
      const codexAgentsHome =
        direction === "selected-ancestor" ? path.join(root, "parent") : root;
      const selectedName =
        direction === "selected-ancestor" ? "parent" : "child";
      const retainedName =
        direction === "selected-ancestor" ? "child" : "parent";
      const config = makeResolvedConfig(scenarioDir, {
        claude: { skillsHome: claudeSkillsHome },
        codex: { agentsHome: codexAgentsHome },
      });
      await seedPassiveRuntime(config);
      const selectedPath = path.join(claudeSkillsHome, selectedName);
      const retainedPath = path.join(codexAgentsHome, `${retainedName}.toml`);
      const generatedSentinel = path.join(
        config.library.generatedDir,
        "claude",
        "skills",
        selectedName,
        "SKILL.md",
      );
      await createSkillFixture(config.library.skillsDir, selectedName);
      await mkdir(path.dirname(generatedSentinel), { recursive: true });
      await writeFile(generatedSentinel, "generated sentinel", "utf-8");
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await writeFile(
        config.manifest.path,
        makeManifestJson(
          [
            {
              target: "codex",
              type: "agent",
              name: retainedName,
              sourcePath: path.join(
                config.library.agentsDir,
                `${retainedName}.yaml`,
              ),
              generatedPath: null,
              installedPath: retainedPath,
              installMode: "copy",
              contentHash: "retained",
              timestamp: new Date().toISOString(),
            },
          ],
          { config },
        ),
        "utf-8",
      );
      const manifestBefore = await readTextFile(config.manifest.path);

      await expect(
        sync(config, {
          dryRun: false,
          force: false,
          strict: false,
          target: "claude",
        }),
      ).rejects.toThrow("Managed output physical path conflict");

      expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
      expect(await pathExists(selectedPath)).toBe(false);
      expect(await pathExists(retainedPath)).toBe(false);
      expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
      expect(suite.testLogger.infos).toEqual([]);
    },
  );

  it("uses the next collision-safe backup sibling through the sync consumer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T01:02:03.456Z"));
    try {
      const config = makeResolvedConfig(suite.tempDir, {
        codex: { enabled: false },
      });
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await writeFile(
        config.manifest.path,
        makeManifestJson([], { legacy: true }),
        "utf-8",
      );
      const base = `${config.manifest.path}.backup-2026-07-17T01-02-03.456Z`;
      await writeFile(base, "base collision", "utf-8");
      await writeFile(`${base}-1`, "first collision", "utf-8");

      await sync(config, { dryRun: false, force: false, strict: false });

      expect(await readTextFile(base)).toBe("base collision");
      expect(await readTextFile(`${base}-1`)).toBe("first collision");
      expect(await readTextFile(`${base}-2`)).toContain('"version": 1');
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases backup authority after a successful consumer operation", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
      defaults: { cleanManagedOutputs: false },
    });
    const installedPath = path.join(
      config.targets.claude.agentsHome,
      "gone.md",
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "gone.yaml"),
            generatedPath: null,
            installedPath,
            installMode: "copy",
            contentHash: "gone",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );

    await sync(config, { dryRun: false, force: false, strict: false });
    const later = await uninstall(config, { dryRun: false });

    expect(later.errors).toEqual([]);
    expect(later.removed).toBe(2);
  });

  it("releases backup authority after a thrown consumer operation", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    const installedPath = path.join(
      config.targets.claude.agentsHome,
      "broken.md",
    );
    await mkdir(config.library.agentsDir, { recursive: true });
    await writeFile(
      path.join(config.library.agentsDir, "broken.yaml"),
      "not: [valid",
      "utf-8",
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "broken.yaml"),
            generatedPath: null,
            installedPath,
            installMode: "copy",
            contentHash: "broken",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );

    await expect(
      sync(config, { dryRun: false, force: false, strict: false }),
    ).rejects.toThrow();
    const later = await uninstall(config, { dryRun: false });

    expect(later.errors).toEqual([]);
    expect(later.removed).toBe(1);
  });

  it("reports malformed legacy identity validation without calling it a boundary mismatch", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            sourcePath: "/source.yaml",
            generatedPath: null,
            installedPath: path.join(
              config.targets.claude.agentsHome,
              "nested",
              "bad.md",
            ),
            installMode: "copy",
            contentHash: "bad",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );

    await expect(
      sync(config, { dryRun: false, force: false, strict: false }),
    ).rejects.toThrow("Manifest identity is invalid");
  });

  it.skipIf(!symlinkAvailable)(
    "reaches configured-home symlink verification from a bound matching manifest",
    async () => {
      const realHome = path.join(suite.tempDir, "real-home");
      const linkedHome = path.join(suite.tempDir, "linked-home");
      const config = makeResolvedConfig(suite.tempDir, {
        claude: { agentsHome: linkedHome },
        codex: { enabled: false },
      });
      const installedPath = path.join(linkedHome, "sentinel.md");
      await mkdir(realHome, { recursive: true });
      await symlink(realHome, linkedHome, "dir");
      await writeFile(path.join(realHome, "sentinel.md"), "sentinel", "utf-8");
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await writeFile(
        config.manifest.path,
        makeManifestJson(
          [
            {
              target: "claude",
              type: "agent",
              name: "sentinel",
              sourcePath: "/source/sentinel.yaml",
              generatedPath: null,
              installedPath,
              installMode: "copy",
              contentHash: "sentinel",
              timestamp: new Date().toISOString(),
            },
          ],
          { config },
        ),
        "utf-8",
      );

      const result = await sync(config, {
        dryRun: false,
        force: false,
        strict: false,
      });

      expect(result.errors).toEqual([
        expect.stringContaining("configured claude agent home is a symlink"),
      ]);
      expect(await readTextFile(path.join(realHome, "sentinel.md"))).toBe(
        "sentinel",
      );
    },
  );

  it("fails closed before installing cross-target outputs at one physical path", async () => {
    const sharedSkillsHome = path.join(suite.tempDir, "home", "shared-skills");
    const config = makeResolvedConfig(suite.tempDir, {
      claude: { skillsHome: sharedSkillsHome },
      codex: { skillsHome: sharedSkillsHome },
    });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, "shared-skill");

    await expect(
      sync(config, { dryRun: false, force: false, strict: false }),
    ).rejects.toThrow("physical path conflict");
    expect(await pathExists(path.join(sharedSkillsHome, "shared-skill"))).toBe(
      false,
    );
  });

  it.skipIf(!symlinkAvailable)(
    "rejects a selected target output that collides with a retained other-target record before writes",
    async () => {
      const scenarios = ["absent", "existing", "dangling"] as const;

      for (const state of scenarios) {
        const scenarioDir = path.join(suite.tempDir, state);
        const sharedSkillsHome = path.join(
          scenarioDir,
          "home",
          "shared-skills",
        );
        const config = makeResolvedConfig(scenarioDir, {
          claude: { skillsHome: sharedSkillsHome },
          codex: { skillsHome: sharedSkillsHome },
        });
        await seedPassiveRuntime(config);
        const name = "shared-skill";
        const installedPath = path.join(sharedSkillsHome, name);
        const generatedSentinel = path.join(
          config.library.generatedDir,
          "claude",
          "skills",
          name,
          "sentinel.txt",
        );

        await mkdir(config.library.skillsDir, { recursive: true });
        await mkdir(config.library.agentsDir, { recursive: true });
        await createSkillFixture(config.library.skillsDir, name);
        await mkdir(path.dirname(config.manifest.path), { recursive: true });
        await mkdir(path.dirname(generatedSentinel), { recursive: true });
        await writeFile(generatedSentinel, "generated sentinel", "utf-8");
        await writeFile(
          config.manifest.path,
          makeManifestJson(
            [
              {
                target: "codex",
                type: "skill",
                name,
                sourcePath: path.join(config.library.skillsDir, name),
                generatedPath: null,
                installedPath,
                installMode: "copy",
                contentHash: "retained",
                timestamp: new Date().toISOString(),
              },
            ],
            { config },
          ),
          "utf-8",
        );
        const manifestBefore = await readTextFile(config.manifest.path);

        if (state === "existing") {
          await mkdir(installedPath, { recursive: true });
          await writeFile(
            path.join(installedPath, "sentinel.txt"),
            "installed sentinel",
            "utf-8",
          );
        }
        if (state === "dangling") {
          await mkdir(path.dirname(installedPath), { recursive: true });
          await symlink(
            path.join(scenarioDir, "missing-target"),
            installedPath,
            "dir",
          );
        }

        await expect(
          sync(config, {
            dryRun: false,
            force: false,
            strict: false,
            target: "claude",
          }),
        ).rejects.toThrow("Managed output physical path conflict");

        expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
        expect(await readTextFile(generatedSentinel)).toBe(
          "generated sentinel",
        );
        if (state === "absent") {
          expect(await pathExists(installedPath)).toBe(false);
        }
        if (state === "existing") {
          expect(
            await readTextFile(path.join(installedPath, "sentinel.txt")),
          ).toBe("installed sentinel");
        }
        if (state === "dangling") {
          expect((await lstat(installedPath)).isSymbolicLink()).toBe(true);
          expect(await readlink(installedPath)).toBe(
            path.join(scenarioDir, "missing-target"),
          );
          expect(
            await pathExists(path.join(scenarioDir, "missing-target")),
          ).toBe(false);
        }
      }
    },
  );

  it("rejects retained output collisions regardless of overwrite or dry-run options", async () => {
    const scenarios = [
      {
        name: "default",
        defaults: {},
        options: { dryRun: false, force: false },
      },
      {
        name: "force",
        defaults: {},
        options: { dryRun: false, force: true },
      },
      {
        name: "configured-overwrite-all",
        defaults: { overwritePolicy: "overwrite-all" as const },
        options: { dryRun: false, force: false },
      },
      {
        name: "dry-run",
        defaults: {},
        options: { dryRun: true, force: false },
      },
    ];

    for (const scenario of scenarios) {
      const scenarioDir = path.join(suite.tempDir, scenario.name);
      const sharedSkillsHome = path.join(scenarioDir, "home", "shared-skills");
      const config = makeResolvedConfig(scenarioDir, {
        claude: { skillsHome: sharedSkillsHome },
        codex: { skillsHome: sharedSkillsHome },
        defaults: scenario.defaults,
      });
      await seedPassiveRuntime(config);
      const name = "shared-skill";
      const installedPath = path.join(sharedSkillsHome, name);
      const generatedSentinel = path.join(
        config.library.generatedDir,
        "claude",
        "skills",
        name,
        "sentinel.txt",
      );

      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      await createSkillFixture(config.library.skillsDir, name);
      await mkdir(installedPath, { recursive: true });
      await writeFile(
        path.join(installedPath, "sentinel.txt"),
        "installed sentinel",
        "utf-8",
      );
      await mkdir(path.dirname(generatedSentinel), { recursive: true });
      await writeFile(generatedSentinel, "generated sentinel", "utf-8");
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await writeFile(
        config.manifest.path,
        makeManifestJson(
          [
            {
              target: "codex",
              type: "skill",
              name,
              sourcePath: path.join(config.library.skillsDir, name),
              generatedPath: null,
              installedPath,
              installMode: "copy",
              contentHash: "retained",
              timestamp: new Date().toISOString(),
            },
          ],
          { config },
        ),
        "utf-8",
      );
      const manifestBefore = await readTextFile(config.manifest.path);

      await expect(
        sync(config, {
          ...scenario.options,
          strict: false,
          target: "claude",
        }),
      ).rejects.toThrow("Managed output physical path conflict");

      expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
      expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
      expect(await readTextFile(path.join(installedPath, "sentinel.txt"))).toBe(
        "installed sentinel",
      );
    }
  });

  it.each([
    ["absent dry-run", false, true, false],
    ["existing explicit force", true, false, true],
  ] as const)(
    "reserves an agent destination that is the exact manifest path: %s",
    async (_label, existingManifest, dryRun, force) => {
      const scenarioDir = path.join(suite.tempDir, `manifest-agent-${_label}`);
      const agentsHome = path.join(scenarioDir, "state");
      const manifestPath = path.join(agentsHome, "helper.md");
      const config = makeResolvedConfig(scenarioDir, {
        claude: { agentsHome },
        codex: { enabled: false },
        manifest: { path: manifestPath },
      });
      await seedPassiveRuntime(config);
      await mkdir(config.library.skillsDir, { recursive: true });
      await createAgentFixture(
        config.library.agentsDir,
        "helper",
        makeAgentYaml("helper"),
      );
      const manifestBytes = makeManifestJson([], { config });
      if (existingManifest) {
        await mkdir(path.dirname(manifestPath), { recursive: true });
        await writeFile(manifestPath, manifestBytes, "utf-8");
      }
      const generatedPath = path.join(
        config.library.generatedDir,
        "claude",
        "agents",
        "helper.md",
      );

      await expect(
        sync(config, { dryRun, force, strict: false, target: "claude" }),
      ).rejects.toThrow("Managed output physical path conflict");

      expect(await pathExists(generatedPath)).toBe(false);
      expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
      expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
      expect(suite.testLogger.infos).toEqual([]);
      if (existingManifest) {
        expect(await readTextFile(manifestPath)).toBe(manifestBytes);
        expect(await readdir(agentsHome)).toEqual(["helper.md"]);
      } else {
        expect(await pathExists(manifestPath)).toBe(false);
        expect(await pathExists(agentsHome)).toBe(false);
      }
    },
  );

  it.each(["copy", "symlink"] as const)(
    "reserves a manifest nested below a selected skill ancestor in %s mode",
    async (mode) => {
      const scenarioDir = path.join(
        suite.tempDir,
        `manifest-skill-ancestor-${mode}`,
      );
      const skillsHome = path.join(scenarioDir, "home", "skills");
      const name = "control-skill";
      const installedPath = path.join(skillsHome, name);
      const manifestPath = path.join(installedPath, "state", "manifest.json");
      const config = makeResolvedConfig(scenarioDir, {
        claude: { skillsHome, installMode: mode },
        codex: { enabled: false },
        defaults: { overwritePolicy: "overwrite-all" },
        manifest: { path: manifestPath },
      });
      await seedPassiveRuntime(config);
      await mkdir(config.library.agentsDir, { recursive: true });
      await createSkillFixture(config.library.skillsDir, name);
      await mkdir(path.dirname(manifestPath), { recursive: true });
      const manifestBytes = makeManifestJson([], { config });
      await writeFile(manifestPath, manifestBytes, "utf-8");
      const sentinelPath = path.join(installedPath, "installed-sentinel.txt");
      await writeFile(sentinelPath, "installed sentinel", "utf-8");
      const generatedPath = path.join(
        config.library.generatedDir,
        "claude",
        "skills",
        name,
      );

      await expect(
        sync(config, {
          dryRun: false,
          force: false,
          strict: false,
          target: "claude",
          mode,
        }),
      ).rejects.toThrow("Managed output physical path conflict");

      expect(await readTextFile(manifestPath)).toBe(manifestBytes);
      expect(await readTextFile(sentinelPath)).toBe("installed sentinel");
      expect((await lstat(installedPath)).isDirectory()).toBe(true);
      expect(await pathExists(generatedPath)).toBe(false);
      expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
      expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
    },
  );

  it("rejects a dry selected skill below the manifest control path before preview", async () => {
    const scenarioDir = path.join(suite.tempDir, "control-dry-descendant");
    const manifestPath = path.join(scenarioDir, "state", "manifest.json");
    const skillName = "nested-skill";
    const skillsHome = path.join(manifestPath, "managed");
    const config = makeResolvedConfig(scenarioDir, {
      claude: { skillsHome },
      codex: { enabled: false },
      manifest: { path: manifestPath },
    });
    await seedPassiveRuntime(config);
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, skillName);
    const installedPath = path.join(skillsHome, skillName);
    expect(path.relative(manifestPath, installedPath)).toBe(
      path.join("managed", skillName),
    );

    await expect(
      sync(config, {
        dryRun: true,
        force: true,
        strict: false,
        target: "claude",
      }),
    ).rejects.toThrow("Managed output physical path conflict");

    expect(suite.testLogger.infos).toEqual([]);
    expect(await pathExists(manifestPath)).toBe(false);
    expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
    expect(await pathExists(installedPath)).toBe(false);
    expect(await pathExists(config.library.generatedDir)).toBe(false);
  });

  it("reserves an active retained control collision but permits the same passive record", async () => {
    for (const control of ["manifest", "manifest-lock"] as const) {
      for (const target of ["claude", "codex"] as const) {
        suite.testLogger.infos.length = 0;
        suite.testLogger.warnings.length = 0;
        const scenarioDir = path.join(
          suite.tempDir,
          `retained-control-${control}-${target}`,
        );
        const controlHome = path.join(scenarioDir, "state");
        const manifestPath =
          control === "manifest"
            ? path.join(controlHome, "helper.md")
            : path.join(controlHome, "manifest.json");
        const installedPath =
          control === "manifest" ? manifestPath : `${manifestPath}.lock`;
        const type = control === "manifest" ? "agent" : "skill";
        const name =
          control === "manifest" ? "helper" : path.basename(installedPath);
        const config = makeResolvedConfig(scenarioDir, {
          claude:
            control === "manifest"
              ? { agentsHome: controlHome }
              : { skillsHome: controlHome },
          manifest: { path: manifestPath },
        });
        await seedPassiveRuntime(config);
        await mkdir(config.library.skillsDir, { recursive: true });
        await mkdir(config.library.agentsDir, { recursive: true });
        await mkdir(path.dirname(manifestPath), { recursive: true });
        const manifestBytes = makeManifestJson(
          [
            {
              target: "claude",
              type,
              name,
              sourcePath:
                type === "agent"
                  ? path.join(config.library.agentsDir, "helper.yaml")
                  : path.join(config.library.skillsDir, name),
              generatedPath:
                type === "agent"
                  ? path.join(
                      config.library.generatedDir,
                      "claude",
                      "agents",
                      "helper.md",
                    )
                  : null,
              installedPath,
              installMode: "copy",
              contentHash: "retained",
              timestamp: new Date().toISOString(),
            },
          ],
          { config },
        );
        await writeFile(manifestPath, manifestBytes, "utf-8");

        if (target === "claude") {
          await expect(
            sync(config, {
              dryRun: true,
              force: false,
              strict: false,
              target,
            }),
          ).rejects.toThrow("Managed output physical path conflict");
          expect(suite.testLogger.infos).toEqual([]);
        } else {
          const result = await sync(config, {
            dryRun: true,
            force: false,
            strict: false,
            target,
          });
          expect(result).toMatchObject({
            installed: 0,
            updated: 0,
            removed: 0,
            errors: [],
          });
        }
        expect(await readTextFile(manifestPath)).toBe(manifestBytes);
        expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
        expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
      }
    }
  });

  it("rejects a legacy retained output collision before binding or generated writes", async () => {
    const sharedSkillsHome = path.join(suite.tempDir, "home", "shared-skills");
    const config = makeResolvedConfig(suite.tempDir, {
      claude: { skillsHome: sharedSkillsHome },
      codex: { skillsHome: sharedSkillsHome },
    });
    const name = "shared-skill";
    const installedPath = path.join(sharedSkillsHome, name);
    const generatedSentinel = path.join(
      config.library.generatedDir,
      "claude",
      "skills",
      name,
      "sentinel.txt",
    );
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, name);
    await mkdir(path.dirname(generatedSentinel), { recursive: true });
    await writeFile(generatedSentinel, "generated sentinel", "utf-8");
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "codex",
            type: "skill",
            sourcePath: path.join(config.library.skillsDir, name),
            generatedPath: null,
            installedPath,
            installMode: "copy",
            contentHash: "retained",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );
    const manifestBefore = await readTextFile(config.manifest.path);

    await expect(
      sync(config, {
        dryRun: false,
        force: false,
        strict: false,
        target: "claude",
      }),
    ).rejects.toThrow("Managed output physical path conflict");

    expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
    expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
    expect(await pathExists(installedPath)).toBe(false);
  });

  it("allows an exact retained identity to match its selected target output", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    const name = "shared-skill";
    const installedPath = path.join(config.targets.claude.skillsHome, name);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, name);
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "skill",
            name,
            sourcePath: path.join(config.library.skillsDir, name),
            generatedPath: null,
            installedPath,
            installMode: "copy",
            contentHash: "previous",
            timestamp: new Date().toISOString(),
          },
        ],
        { config },
      ),
      "utf-8",
    );

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      target: "claude",
    });

    expect(result.errors).toEqual([]);
    expect(result.installed).toBe(2);
    expect(await pathExists(installedPath)).toBe(true);
  });
});
