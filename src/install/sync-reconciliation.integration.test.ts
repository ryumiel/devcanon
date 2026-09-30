import {
  lstat,
  mkdir,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canCreateSymlinks,
  createAgentFixture,
  createSkillFixture,
  makeAgentYaml,
  makeManifestJson,
  makeResolvedConfig,
} from "../__test-helpers__/fixtures.js";
import { useSyncFixture } from "../__test-helpers__/sync-fixture.js";
import { UserError } from "../utils/errors.js";
import { pathExists, readTextFile } from "../utils/fs.js";

const symlinkAvailable = await canCreateSymlinks();

describe("sync", () => {
  const suite = useSyncFixture();
  const { sync, diffAll, seedPassiveRuntime, seedInstalled } = suite;

  it("previews mixed legacy reconciliation without mutating the manifest", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    const ownedPath = path.join(config.targets.claude.agentsHome, "helper.md");
    const foreignPath = path.join(suite.tempDir, "foreign", "helper.md");
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "helper.yaml"),
            generatedPath: null,
            installedPath: ownedPath,
            installMode: "copy",
            contentHash: "owned",
            timestamp: new Date().toISOString(),
          },
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "foreign.yaml"),
            generatedPath: null,
            installedPath: foreignPath,
            installMode: "copy",
            contentHash: "foreign",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );
    const before = await readTextFile(config.manifest.path);

    const result = await sync(config, {
      dryRun: true,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(result.reconciliation).toEqual({
      retained: [
        {
          target: "claude",
          type: "agent",
          name: "helper",
          installedPath: ownedPath,
        },
      ],
      removed: [
        {
          target: "claude",
          type: "agent",
          name: "helper",
          installedPath: foreignPath,
        },
      ],
    });
    expect(await readTextFile(config.manifest.path)).toBe(before);
    expect(
      (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
        entry.includes(".backup-"),
      ),
    ).toHaveLength(0);
  });

  it("reconciles mixed legacy records while preserving production tuples and foreign bytes", async () => {
    const config = makeResolvedConfig(suite.tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, "ordinary-skill");
    const keepSource = await createAgentFixture(
      config.library.agentsDir,
      "keep",
      makeAgentYaml("keep"),
    );
    const staleSource = await createAgentFixture(
      config.library.agentsDir,
      "stale",
      makeAgentYaml("stale"),
    );
    await sync(config, { dryRun: false, force: false, strict: false });

    const current = JSON.parse(await readTextFile(config.manifest.path));
    const foreignPathOne = path.join(
      suite.tempDir,
      "foreign-one",
      "sentinel.md",
    );
    const foreignPathTwo = path.join(suite.tempDir, "foreign-two", "sentinel");
    await mkdir(path.dirname(foreignPathOne), { recursive: true });
    await mkdir(path.dirname(foreignPathTwo), { recursive: true });
    await writeFile(foreignPathOne, "foreign sentinel one bytes", "utf-8");
    await writeFile(foreignPathTwo, "foreign sentinel two bytes", "utf-8");
    const legacy = {
      ...current,
      boundary: undefined,
      records: [
        ...current.records.map(
          ({ name: _name, ...record }: { name: string }) => record,
        ),
        {
          target: "claude",
          type: "agent",
          sourcePath: path.join(config.library.agentsDir, "foreign.yaml"),
          generatedPath: null,
          installedPath: foreignPathOne,
          installMode: "copy",
          contentHash: "foreign",
          timestamp: new Date().toISOString(),
        },
        {
          target: "codex",
          type: "skill",
          sourcePath: path.join(config.library.skillsDir, "foreign"),
          generatedPath: null,
          installedPath: foreignPathTwo,
          installMode: "copy",
          contentHash: "foreign",
          timestamp: new Date().toISOString(),
        },
      ],
    };
    await writeFile(
      config.manifest.path,
      `${JSON.stringify(legacy, null, 2)}\n`,
      "utf-8",
    );
    const originalManifest = await readTextFile(config.manifest.path);
    await rm(staleSource);
    await writeFile(
      keepSource,
      makeAgentYaml("keep", { instructions: "updated after migration" }),
      "utf-8",
    );

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(result.errors).toEqual([]);
    expect(result.updated).toBe(2);
    expect(result.removed).toBe(2);
    expect(result.reconciliation?.removed).toEqual([
      {
        target: "claude",
        type: "agent",
        name: "sentinel",
        installedPath: foreignPathOne,
      },
      {
        target: "codex",
        type: "skill",
        name: "sentinel",
        installedPath: foreignPathTwo,
      },
    ]);
    expect(await readTextFile(foreignPathOne)).toBe(
      "foreign sentinel one bytes",
    );
    expect(await readTextFile(foreignPathTwo)).toBe(
      "foreign sentinel two bytes",
    );
    const backups = (await readdir(path.dirname(config.manifest.path))).filter(
      (entry) => entry.includes(".backup-"),
    );
    expect(backups).toHaveLength(1);
    expect(await readTextFile(path.join(suite.tempDir, backups[0]))).toBe(
      originalManifest,
    );
    const migrated = JSON.parse(await readTextFile(config.manifest.path));
    expect(migrated.boundary).toBeDefined();
    expect(migrated.records).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ installedPath: foreignPathOne }),
        expect.objectContaining({ installedPath: foreignPathTwo }),
      ]),
    );
    expect(migrated.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "claude",
          type: "agent",
          name: "keep",
        }),
        expect.objectContaining({
          target: "codex",
          type: "agent",
          name: "keep",
        }),
        expect.objectContaining({
          target: "claude",
          type: "skill",
          name: "ordinary-skill",
        }),
        expect.objectContaining({
          target: "codex",
          type: "skill",
          name: "ordinary-skill",
        }),
        expect.objectContaining({
          target: "claude",
          type: "skill",
          name: "devcanon-runtime",
        }),
        expect.objectContaining({
          target: "codex",
          type: "skill",
          name: "devcanon-runtime",
        }),
      ]),
    );
    expect(
      await pathExists(path.join(config.targets.claude.agentsHome, "keep.md")),
    ).toBe(true);
    expect(
      await pathExists(path.join(config.targets.codex.agentsHome, "keep.toml")),
    ).toBe(true);
    expect(
      await pathExists(
        path.join(config.targets.claude.skillsHome, "ordinary-skill"),
      ),
    ).toBe(true);
    expect(
      await pathExists(
        path.join(config.targets.codex.skillsHome, "ordinary-skill"),
      ),
    ).toBe(true);
    expect(
      await pathExists(
        path.join(
          config.targets.claude.skillsHome,
          "devcanon-runtime",
          "scripts",
          "devcanon-runtime.sh",
        ),
      ),
    ).toBe(true);
    expect(
      await pathExists(
        path.join(
          config.targets.codex.skillsHome,
          "devcanon-runtime",
          "scripts",
          "devcanon-runtime.sh",
        ),
      ),
    ).toBe(true);

    const second = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      reconcileManifest: true,
    });
    expect(second.reconciliation).toBeUndefined();
    expect(second.removed).toBe(0);
    expect(
      (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
        entry.includes(".backup-"),
      ),
    ).toHaveLength(1);
    const diffs = await diffAll(config);
    expect(diffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "claude",
          type: "agent",
          name: "keep",
          status: "up-to-date",
        }),
        expect.objectContaining({
          target: "codex",
          type: "agent",
          name: "keep",
          status: "up-to-date",
        }),
        expect.objectContaining({
          target: "claude",
          type: "skill",
          name: "ordinary-skill",
          status: "up-to-date",
        }),
        expect.objectContaining({
          target: "claude",
          type: "skill",
          name: "devcanon-runtime",
          status: "up-to-date",
        }),
        expect.objectContaining({
          target: "codex",
          type: "skill",
          name: "ordinary-skill",
          status: "up-to-date",
        }),
        expect.objectContaining({
          target: "codex",
          type: "skill",
          name: "devcanon-runtime",
          status: "up-to-date",
        }),
      ]),
    );
    expect(diffs).not.toHaveLength(0);
    expect(diffs.every((entry) => entry.status === "up-to-date")).toBe(true);
    expect(diffs).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ installedPath: foreignPathOne }),
        expect.objectContaining({ installedPath: foreignPathTwo }),
      ]),
    );
  });

  it("dry-runs a mixed legacy reconciliation without ordinary foreign removal logs", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
      defaults: { cleanManagedOutputs: false },
    });
    const ownedPath = path.join(config.targets.claude.agentsHome, "owned.md");
    const foreignPath = path.join(suite.tempDir, "foreign", "sentinel.md");
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(path.dirname(foreignPath), { recursive: true });
    await writeFile(foreignPath, "foreign sentinel bytes", "utf-8");
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "owned.yaml"),
            generatedPath: null,
            installedPath: ownedPath,
            installMode: "copy",
            contentHash: "owned",
            timestamp: new Date().toISOString(),
          },
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "foreign.yaml"),
            generatedPath: null,
            installedPath: foreignPath,
            installMode: "copy",
            contentHash: "foreign",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );
    const before = await readTextFile(config.manifest.path);

    await sync(config, {
      dryRun: true,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    const foreignLines = suite.testLogger.infos.filter((line) =>
      line.includes(foreignPath),
    );
    expect(foreignLines).toEqual([expect.stringContaining("[remove-record]")]);
    expect(suite.testLogger.infos.join("\n")).not.toContain(
      "[remove] claude/agent/foreign",
    );
    expect(await readTextFile(foreignPath)).toBe("foreign sentinel bytes");
    expect(await readTextFile(config.manifest.path)).toBe(before);
  });

  it("protects a reconciled foreign file path from same-sync explicit force overwrite", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
      defaults: { cleanManagedOutputs: false },
    });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createAgentFixture(
      config.library.agentsDir,
      "protected",
      makeAgentYaml("protected"),
    );
    await createAgentFixture(
      config.library.agentsDir,
      "unrelated",
      makeAgentYaml("unrelated"),
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    const installedPath = path.join(
      config.targets.claude.agentsHome,
      "protected.md",
    );
    const foreignPath = `${config.targets.claude.agentsHome}${path.sep}.${path.sep}protected.md`;
    const unrelatedInstalledPath = path.join(
      config.targets.claude.agentsHome,
      "unrelated.md",
    );
    await mkdir(path.dirname(installedPath), { recursive: true });
    await writeFile(installedPath, "foreign sentinel bytes", "utf-8");
    await writeFile(
      unrelatedInstalledPath,
      "unrelated sentinel bytes",
      "utf-8",
    );
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "foreign.yaml"),
            generatedPath: null,
            installedPath: foreignPath,
            installMode: "copy",
            contentHash: "foreign",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );
    const originalManifest = await readTextFile(config.manifest.path);

    const dryRun = await sync(config, {
      dryRun: true,
      force: true,
      strict: false,
      reconcileManifest: true,
    });

    expect(dryRun.reconciliation?.removed).toEqual([
      {
        target: "claude",
        type: "agent",
        name: "protected",
        installedPath: foreignPath,
      },
    ]);
    expect(suite.testLogger.infos.join("\n")).toContain(
      "[skip-conflict] claude/agent/protected",
    );
    expect(suite.testLogger.infos.join("\n")).toContain(
      "[force-overwrite] claude/agent/unrelated",
    );
    expect(await readTextFile(installedPath)).toBe("foreign sentinel bytes");
    expect(await readTextFile(unrelatedInstalledPath)).toBe(
      "unrelated sentinel bytes",
    );
    expect(await readTextFile(config.manifest.path)).toBe(originalManifest);

    const result = await sync(config, {
      dryRun: false,
      force: true,
      strict: false,
      reconcileManifest: true,
    });

    expect(result.errors).toEqual([]);
    expect(result.installed).toBe(2);
    expect(result.conflicts).toBe(1);
    expect(await readTextFile(installedPath)).toBe("foreign sentinel bytes");
    expect(await readTextFile(unrelatedInstalledPath)).not.toBe(
      "unrelated sentinel bytes",
    );
    const migrated = JSON.parse(await readTextFile(config.manifest.path));
    expect(migrated.records).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ installedPath }),
        expect.objectContaining({ installedPath: foreignPath }),
      ]),
    );
    expect(migrated.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "unrelated",
          installedPath: unrelatedInstalledPath,
        }),
      ]),
    );

    const afterProtectionExpires = await sync(config, {
      dryRun: false,
      force: true,
      strict: false,
      reconcileManifest: true,
    });

    expect(afterProtectionExpires.errors).toEqual([]);
    expect(afterProtectionExpires.installed).toBe(1);
    expect(afterProtectionExpires.conflicts).toBe(0);
    expect(await readTextFile(installedPath)).not.toBe(
      "foreign sentinel bytes",
    );
    const afterExpiration = JSON.parse(
      await readTextFile(config.manifest.path),
    );
    expect(afterExpiration.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "protected", installedPath }),
      ]),
    );
  });

  it("protects a reconciled foreign tree path from configured overwrite-all", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
      defaults: {
        cleanManagedOutputs: false,
        overwritePolicy: "overwrite-all",
      },
    });
    await mkdir(config.library.skillsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, "protected");
    await createSkillFixture(config.library.skillsDir, "unrelated");
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    const installedPath = path.join(
      config.targets.claude.skillsHome,
      "protected",
    );
    const foreignPath = `${config.targets.claude.skillsHome}${path.sep}.${path.sep}protected`;
    const sentinelPath = path.join(installedPath, "sentinel.txt");
    const unrelatedInstalledPath = path.join(
      config.targets.claude.skillsHome,
      "unrelated",
    );
    const unrelatedSentinelPath = path.join(
      unrelatedInstalledPath,
      "sentinel.txt",
    );
    await mkdir(installedPath, { recursive: true });
    await mkdir(unrelatedInstalledPath, { recursive: true });
    await writeFile(sentinelPath, "foreign tree sentinel bytes", "utf-8");
    await writeFile(
      unrelatedSentinelPath,
      "unrelated tree sentinel bytes",
      "utf-8",
    );
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "skill",
            sourcePath: path.join(config.library.skillsDir, "foreign"),
            generatedPath: null,
            installedPath: foreignPath,
            installMode: "copy",
            contentHash: "foreign",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(result.errors).toEqual([]);
    expect(result.installed).toBe(2);
    expect(result.conflicts).toBe(1);
    expect(await readTextFile(sentinelPath)).toBe(
      "foreign tree sentinel bytes",
    );
    expect(await readdir(installedPath)).toEqual(["sentinel.txt"]);
    expect(await pathExists(unrelatedSentinelPath)).toBe(false);
    const migrated = JSON.parse(await readTextFile(config.manifest.path));
    expect(migrated.records).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ installedPath }),
        expect.objectContaining({ installedPath: foreignPath }),
      ]),
    );
    expect(migrated.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "unrelated",
          installedPath: unrelatedInstalledPath,
        }),
      ]),
    );
  });

  it.skipIf(!symlinkAvailable)(
    "protects reconciled dangling file and tree symlinks from same-sync installs in requested modes",
    async () => {
      const scenarios = [
        { type: "agent" as const, mode: "copy" as const },
        { type: "agent" as const, mode: "symlink" as const },
        { type: "skill" as const, mode: "copy" as const },
        { type: "skill" as const, mode: "symlink" as const },
      ];

      for (const scenario of scenarios) {
        suite.testLogger.infos.length = 0;
        const scenarioDir = path.join(
          suite.tempDir,
          `${scenario.type}-${scenario.mode}`,
        );
        const config = makeResolvedConfig(scenarioDir, {
          codex: { enabled: false },
          defaults: { cleanManagedOutputs: false },
        });
        await seedPassiveRuntime(config);
        const name = "protected";
        const home =
          scenario.type === "agent"
            ? config.targets.claude.agentsHome
            : config.targets.claude.skillsHome;
        const installedPath = path.join(
          home,
          scenario.type === "agent" ? `${name}.md` : name,
        );
        const foreignPath = `${home}${path.sep}.${path.sep}${path.basename(installedPath)}`;
        const missingTarget = path.join(scenarioDir, "missing-target");

        await mkdir(config.library.agentsDir, { recursive: true });
        await mkdir(config.library.skillsDir, { recursive: true });
        await mkdir(path.dirname(config.manifest.path), { recursive: true });
        await mkdir(path.dirname(installedPath), { recursive: true });
        if (scenario.type === "agent") {
          await createAgentFixture(
            config.library.agentsDir,
            name,
            makeAgentYaml(name),
          );
        } else {
          await createSkillFixture(config.library.skillsDir, name);
        }
        await symlink(
          missingTarget,
          installedPath,
          scenario.type === "agent" ? "file" : "dir",
        );
        await writeFile(
          config.manifest.path,
          makeManifestJson(
            [
              {
                target: "claude",
                type: scenario.type,
                sourcePath: path.join(scenarioDir, "foreign"),
                generatedPath: null,
                installedPath: foreignPath,
                installMode: scenario.mode,
                contentHash: "foreign",
                timestamp: new Date().toISOString(),
              },
            ],
            { legacy: true },
          ),
          "utf-8",
        );
        const before = await readTextFile(config.manifest.path);
        const originalLink = await readlink(installedPath);

        const dryRun = await sync(config, {
          dryRun: true,
          force: false,
          strict: false,
          mode: scenario.mode,
          reconcileManifest: true,
        });

        expect(dryRun).toMatchObject({
          installed: 0,
          updated: 0,
          removed: 0,
          skipped: 0,
          conflicts: 0,
          errors: [],
        });
        expect(suite.testLogger.infos.join("\n")).toContain(
          `[skip-conflict] claude/${scenario.type}/${name}`,
        );
        expect(await readTextFile(config.manifest.path)).toBe(before);
        expect((await lstat(installedPath)).isSymbolicLink()).toBe(true);
        expect(await readlink(installedPath)).toBe(originalLink);
        expect(await pathExists(missingTarget)).toBe(false);

        const result = await sync(config, {
          dryRun: false,
          force: false,
          strict: false,
          mode: scenario.mode,
          reconcileManifest: true,
        });

        expect(result).toMatchObject({
          installed: 1,
          updated: 0,
          removed: 0,
          conflicts: 1,
          errors: [],
        });
        expect((await lstat(installedPath)).isSymbolicLink()).toBe(true);
        expect(await readlink(installedPath)).toBe(originalLink);
        expect(await pathExists(missingTarget)).toBe(false);
        const reconciled = JSON.parse(await readTextFile(config.manifest.path));
        expect(reconciled.records).toEqual([
          expect.objectContaining({ name: "devcanon-runtime" }),
        ]);
      }
    },
  );

  it("protects a reachable canonical update at a reconciled foreign lexical alias", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    await mkdir(config.library.agentsDir, { recursive: true });
    const sourcePath = await createAgentFixture(
      config.library.agentsDir,
      "protected",
      makeAgentYaml("protected"),
    );
    const options = { dryRun: false, force: false, strict: false } as const;
    await seedInstalled(config, options);
    suite.testLogger.infos.length = 0;

    const installedPath = path.join(
      config.targets.claude.agentsHome,
      "protected.md",
    );
    const originalInstalled = await readTextFile(installedPath);
    const firstManifest = JSON.parse(await readTextFile(config.manifest.path));
    const [boundCanonicalRecord] = firstManifest.records;
    expect(boundCanonicalRecord).toMatchObject({
      installedPath,
      name: "protected",
    });
    const { name: _canonicalName, ...canonicalRecord } = boundCanonicalRecord;
    const foreignPath = `${config.targets.claude.agentsHome}${path.sep}.${path.sep}protected.md`;
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [canonicalRecord, { ...canonicalRecord, installedPath: foreignPath }],
        { legacy: true },
      ),
      "utf-8",
    );
    await writeFile(
      sourcePath,
      makeAgentYaml("protected", { description: "Updated protected agent" }),
      "utf-8",
    );
    const before = await readTextFile(config.manifest.path);
    const dryRun = await sync(config, {
      dryRun: true,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(dryRun).toMatchObject({
      installed: 0,
      updated: 0,
      removed: 0,
      skipped: 0,
      conflicts: 0,
      errors: [],
    });
    expect(dryRun.reconciliation?.retained).toEqual([
      expect.objectContaining({ installedPath, name: "protected" }),
    ]);
    expect(suite.testLogger.infos.join("\n")).toContain(
      "[skip-conflict] claude/agent/protected",
    );
    expect(await readTextFile(config.manifest.path)).toBe(before);

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(result).toMatchObject({
      installed: 0,
      updated: 0,
      removed: 0,
      conflicts: 2,
      errors: [],
    });
    expect(await readTextFile(installedPath)).toBe(originalInstalled);
    const reconciled = JSON.parse(await readTextFile(config.manifest.path));
    expect(reconciled.records).toEqual([
      expect.objectContaining({ installedPath, name: "protected" }),
    ]);
  });

  it("protects a reachable canonical removal at a reconciled foreign lexical alias", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    await mkdir(config.library.agentsDir, { recursive: true });
    const sourcePath = await createAgentFixture(
      config.library.agentsDir,
      "protected",
      makeAgentYaml("protected"),
    );
    const options = { dryRun: false, force: false, strict: false } as const;
    await seedInstalled(config, options);
    suite.testLogger.infos.length = 0;

    const installedPath = path.join(
      config.targets.claude.agentsHome,
      "protected.md",
    );
    const originalInstalled = await readTextFile(installedPath);
    const firstManifest = JSON.parse(await readTextFile(config.manifest.path));
    const [boundCanonicalRecord] = firstManifest.records;
    expect(boundCanonicalRecord).toMatchObject({
      installedPath,
      name: "protected",
    });
    const { name: _canonicalName, ...canonicalRecord } = boundCanonicalRecord;
    const foreignPath = `${config.targets.claude.agentsHome}${path.sep}.${path.sep}protected.md`;
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [canonicalRecord, { ...canonicalRecord, installedPath: foreignPath }],
        { legacy: true },
      ),
      "utf-8",
    );
    await rm(sourcePath);
    const before = await readTextFile(config.manifest.path);
    const dryRun = await sync(config, {
      dryRun: true,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(dryRun).toMatchObject({
      installed: 0,
      updated: 0,
      removed: 0,
      skipped: 0,
      conflicts: 0,
      errors: [],
    });
    expect(dryRun.reconciliation?.retained).toEqual([
      expect.objectContaining({ installedPath, name: "protected" }),
    ]);
    expect(suite.testLogger.infos.join("\n")).toContain(
      "[skip-conflict] claude/agent/protected",
    );
    expect(await readTextFile(config.manifest.path)).toBe(before);

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(result).toMatchObject({
      installed: 0,
      updated: 0,
      removed: 0,
      conflicts: 2,
      errors: [],
    });
    expect(await readTextFile(installedPath)).toBe(originalInstalled);
    const reconciled = JSON.parse(await readTextFile(config.manifest.path));
    expect(reconciled.records).toEqual([
      expect.objectContaining({ installedPath, name: "protected" }),
    ]);
  });

  it("keeps skip-up-to-date when a reconciled foreign lexical alias protects its key", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createAgentFixture(
      config.library.agentsDir,
      "protected",
      makeAgentYaml("protected"),
    );
    const options = { dryRun: false, force: false, strict: false } as const;
    await seedInstalled(config, options);
    suite.testLogger.infos.length = 0;

    const installedPath = path.join(
      config.targets.claude.agentsHome,
      "protected.md",
    );
    const firstManifest = JSON.parse(await readTextFile(config.manifest.path));
    const [boundCanonicalRecord] = firstManifest.records;
    const { name: _canonicalName, ...canonicalRecord } = boundCanonicalRecord;
    const foreignPath = `${config.targets.claude.agentsHome}${path.sep}.${path.sep}protected.md`;
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [canonicalRecord, { ...canonicalRecord, installedPath: foreignPath }],
        { legacy: true },
      ),
      "utf-8",
    );

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(result).toMatchObject({
      installed: 0,
      updated: 0,
      removed: 0,
      skipped: 1,
      conflicts: 1,
      errors: [],
    });
    expect(suite.testLogger.infos.join("\n")).not.toContain(
      "[skip-conflict] claude/agent/protected",
    );
    const reconciled = JSON.parse(await readTextFile(config.manifest.path));
    expect(reconciled.records).toEqual([
      expect.objectContaining({ installedPath, name: "protected" }),
    ]);
  });

  it("keeps an existing skip-conflict when a reconciled foreign record protects its key", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
      defaults: { cleanManagedOutputs: false },
    });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createAgentFixture(
      config.library.agentsDir,
      "protected",
      makeAgentYaml("protected"),
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    const installedPath = path.join(
      config.targets.claude.agentsHome,
      "protected.md",
    );
    const foreignPath = `${config.targets.claude.agentsHome}${path.sep}.${path.sep}protected.md`;
    await mkdir(path.dirname(installedPath), { recursive: true });
    await writeFile(installedPath, "unmanaged protected bytes", "utf-8");
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "foreign.yaml"),
            generatedPath: null,
            installedPath: foreignPath,
            installMode: "copy",
            contentHash: "foreign",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(result).toMatchObject({
      installed: 1,
      updated: 0,
      removed: 0,
      skipped: 0,
      conflicts: 1,
      errors: [],
    });
    expect(await readTextFile(installedPath)).toBe("unmanaged protected bytes");
    expect(suite.testLogger.warnings).toContain(
      "  ! claude/agent/protected: Unmanaged file exists (overwrite-managed policy).",
    );
  });

  it("keeps remove-missing when a reconciled foreign lexical alias protects its key", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    await mkdir(config.library.agentsDir, { recursive: true });
    const sourcePath = await createAgentFixture(
      config.library.agentsDir,
      "protected",
      makeAgentYaml("protected"),
    );
    const options = { dryRun: false, force: false, strict: false } as const;
    await seedInstalled(config, options);

    const installedPath = path.join(
      config.targets.claude.agentsHome,
      "protected.md",
    );
    const firstManifest = JSON.parse(await readTextFile(config.manifest.path));
    const [boundCanonicalRecord] = firstManifest.records;
    const { name: _canonicalName, ...canonicalRecord } = boundCanonicalRecord;
    const foreignPath = `${config.targets.claude.agentsHome}${path.sep}.${path.sep}protected.md`;
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [canonicalRecord, { ...canonicalRecord, installedPath: foreignPath }],
        { legacy: true },
      ),
      "utf-8",
    );
    await rm(sourcePath);
    await rm(installedPath);

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(result).toMatchObject({
      installed: 0,
      updated: 0,
      removed: 1,
      skipped: 0,
      conflicts: 1,
      errors: [],
    });
    expect(await pathExists(installedPath)).toBe(false);
    const reconciled = JSON.parse(await readTextFile(config.manifest.path));
    expect(reconciled.records).toEqual([]);
  });

  it("reconciles colliding foreign legacy records after excluding them from retained collision validation", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    const foreignPath = path.join(suite.tempDir, "foreign", "shared.md");
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(path.dirname(foreignPath), { recursive: true });
    await writeFile(foreignPath, "foreign shared bytes", "utf-8");
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "first.yaml"),
            generatedPath: null,
            installedPath: foreignPath,
            installMode: "copy",
            contentHash: "first",
            timestamp: new Date().toISOString(),
          },
          {
            target: "claude",
            type: "skill",
            sourcePath: path.join(config.library.skillsDir, "second"),
            generatedPath: null,
            installedPath: foreignPath,
            installMode: "copy",
            contentHash: "second",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );
    const manifestBefore = await readTextFile(config.manifest.path);

    const dryRun = await sync(config, {
      dryRun: true,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(dryRun.errors).toEqual([]);
    expect(dryRun.reconciliation?.retained).toEqual([]);
    expect(dryRun.reconciliation?.removed).toHaveLength(2);
    expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
    expect(await readTextFile(foreignPath)).toBe("foreign shared bytes");
    expect(
      (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
        entry.includes(".backup-"),
      ),
    ).toHaveLength(0);

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(result.errors).toEqual([]);
    expect(result.reconciliation?.removed).toHaveLength(2);
    expect(await readTextFile(foreignPath)).toBe("foreign shared bytes");
    expect(
      (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
        entry.includes(".backup-"),
      ),
    ).toHaveLength(1);
    expect(
      JSON.parse(await readTextFile(config.manifest.path)).records,
    ).toEqual([expect.objectContaining({ name: "devcanon-runtime" })]);

    const second = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
    });
    expect(second.errors).toEqual([]);
    expect(second.reconciliation).toBeUndefined();
  });

  it.each([
    ["exact manifest", "manifest", "exact"],
    ["managed descendant of manifest", "manifest", "descendant"],
    ["managed ancestor of manifest", "manifest", "ancestor"],
    ["exact sibling lock", "lock", "exact"],
    ["managed descendant of sibling lock", "lock", "descendant"],
    ["managed ancestor of sibling lock", "lock", "ancestor"],
  ] as const)(
    "refuses a reconciled foreign record at the %s control relation before save or render",
    async (_label, control, relation) => {
      const scenarioDir = path.join(suite.tempDir, `${control}-${relation}`);
      const manifestPath = path.join(scenarioDir, "state", "manifest.json");
      const lockPath = `${manifestPath}.lock`;
      const controlPath = control === "manifest" ? manifestPath : lockPath;
      const foreignPath =
        relation === "exact"
          ? controlPath
          : relation === "descendant"
            ? path.join(controlPath, "foreign")
            : path.dirname(controlPath);
      const config = makeResolvedConfig(scenarioDir, {
        codex: { enabled: false },
        manifest: { path: manifestPath },
      });
      await seedPassiveRuntime(config);
      const generatedName = "generated-sentinel";
      const generatedPath = path.join(
        config.library.generatedDir,
        "claude",
        "agents",
        `${generatedName}.md`,
      );
      const installedPath = path.join(
        config.targets.claude.agentsHome,
        `${generatedName}.md`,
      );
      await createAgentFixture(
        config.library.agentsDir,
        generatedName,
        makeAgentYaml(generatedName),
      );
      await mkdir(path.dirname(manifestPath), { recursive: true });
      await mkdir(path.dirname(generatedPath), { recursive: true });
      await writeFile(generatedPath, "generated sentinel", "utf-8");
      const manifestBytes = makeManifestJson(
        [
          {
            target: "claude",
            type: "skill",
            sourcePath: path.join(config.library.skillsDir, "foreign"),
            generatedPath: null,
            installedPath: foreignPath,
            installMode: "copy",
            contentHash: "foreign",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      );
      await writeFile(manifestPath, manifestBytes, "utf-8");

      await expect(
        sync(config, {
          dryRun: false,
          force: false,
          strict: false,
          reconcileManifest: true,
        }),
      ).rejects.toThrow("Managed output physical path conflict");

      expect(await readTextFile(manifestPath)).toBe(manifestBytes);
      expect(await readTextFile(generatedPath)).toBe("generated sentinel");
      expect(await pathExists(installedPath)).toBe(false);
      expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
      expect(await pathExists(lockPath)).toBe(false);
      expect(await readdir(path.dirname(manifestPath))).toEqual([
        "manifest.json",
      ]);
      expect(suite.testLogger.infos).toEqual([]);
    },
  );

  it.each(
    [
      {
        label: "selected agent exact",
        selectedType: "agent",
        domain: "selected",
        relation: "exact",
        dryRun: false,
        shape: "symlink",
      },
      {
        label: "selected agent foreign ancestor",
        selectedType: "agent",
        domain: "selected",
        relation: "foreign-ancestor",
        dryRun: true,
        shape: "directory",
      },
      {
        label: "selected agent foreign descendant",
        selectedType: "agent",
        domain: "selected",
        relation: "foreign-descendant",
        dryRun: false,
        shape: "directory",
      },
      {
        label: "selected skill exact",
        selectedType: "skill",
        domain: "selected",
        relation: "exact",
        dryRun: false,
        shape: "directory",
      },
      {
        label: "selected skill foreign ancestor",
        selectedType: "skill",
        domain: "selected",
        relation: "foreign-ancestor",
        dryRun: true,
        shape: "directory",
      },
      {
        label: "selected skill foreign descendant",
        selectedType: "skill",
        domain: "selected",
        relation: "foreign-descendant",
        dryRun: false,
        shape: "file",
      },
      {
        label: "stale agent exact removal",
        selectedType: "skill",
        domain: "stale-agent",
        relation: "exact",
        dryRun: false,
        shape: "file",
      },
      {
        label: "stale agent foreign ancestor",
        selectedType: "skill",
        domain: "stale-agent",
        relation: "foreign-ancestor",
        dryRun: true,
        shape: "directory",
      },
      {
        label: "stale skill foreign descendant",
        selectedType: "agent",
        domain: "stale-skill",
        relation: "foreign-descendant",
        dryRun: false,
        shape: "symlink",
      },
    ].filter((scenario) => symlinkAvailable || scenario.shape !== "symlink"),
  )(
    "rejects reconciled foreign overlap with the $label generated mutation domain before effects",
    async ({ selectedType, domain, relation, dryRun, shape }) => {
      const scenarioDir = path.join(
        suite.tempDir,
        `${selectedType}-${domain}-${relation}`,
      );
      const config = makeResolvedConfig(scenarioDir, {
        codex: { enabled: false },
      });
      await seedPassiveRuntime(config);
      const selectedName = "selected";
      if (selectedType === "agent") {
        await createAgentFixture(
          config.library.agentsDir,
          selectedName,
          makeAgentYaml(selectedName),
        );
      } else {
        await createSkillFixture(config.library.skillsDir, selectedName);
      }
      const selectedGeneratedPath = path.join(
        config.library.generatedDir,
        "claude",
        selectedType === "agent" ? "agents" : "skills",
        selectedType === "agent" ? `${selectedName}.md` : selectedName,
      );
      const mutationPath =
        domain === "selected"
          ? selectedGeneratedPath
          : domain === "stale-agent"
            ? path.join(
                config.library.generatedDir,
                "claude",
                "agents",
                "stale.md",
              )
            : path.join(
                config.library.generatedDir,
                "claude",
                "skills",
                "stale",
              );
      const authoritativeMutationPath =
        domain === "selected"
          ? selectedGeneratedPath
          : path.join(
              config.library.generatedDir,
              "claude",
              domain === "stale-agent" ? "agents" : "skills",
            );
      const authoritativeMutationKind =
        domain === "selected" ? "selected-output" : "stale-cleanup-root";
      const foreignPath =
        relation === "exact"
          ? mutationPath
          : relation === "foreign-ancestor"
            ? path.dirname(mutationPath)
            : path.join(mutationPath, "foreign-child");
      const foreignType = path.basename(foreignPath).endsWith(".md")
        ? "agent"
        : "skill";
      const foreignSentinelPath =
        shape === "directory"
          ? path.join(foreignPath, "foreign-sentinel.txt")
          : foreignPath;
      const externalLinkTarget = path.join(
        scenarioDir,
        "external-link-target.txt",
      );
      await mkdir(path.dirname(foreignPath), { recursive: true });
      if (shape === "directory") {
        await mkdir(foreignPath, { recursive: true });
        await writeFile(
          foreignSentinelPath,
          "foreign directory sentinel",
          "utf-8",
        );
      } else if (shape === "symlink") {
        await writeFile(externalLinkTarget, "external sentinel", "utf-8");
        await symlink(externalLinkTarget, foreignPath, "file");
      } else {
        await writeFile(foreignPath, "foreign file sentinel", "utf-8");
      }

      const installedHome =
        selectedType === "agent"
          ? config.targets.claude.agentsHome
          : config.targets.claude.skillsHome;
      const installedSentinelPath = path.join(
        installedHome,
        "installed-sentinel.txt",
      );
      await mkdir(installedHome, { recursive: true });
      await writeFile(installedSentinelPath, "installed sentinel", "utf-8");
      const generatedSentinelPath = path.join(
        config.library.generatedDir,
        "generated-sentinel.txt",
      );
      await mkdir(config.library.generatedDir, { recursive: true });
      await writeFile(generatedSentinelPath, "generated sentinel", "utf-8");
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      const manifestBytes = makeManifestJson(
        [
          {
            target: "claude",
            type: foreignType,
            sourcePath:
              foreignType === "agent"
                ? path.join(config.library.agentsDir, "foreign.yaml")
                : path.join(config.library.skillsDir, "foreign"),
            generatedPath: null,
            installedPath: foreignPath,
            installMode: "copy",
            contentHash: "foreign",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      );
      await writeFile(config.manifest.path, manifestBytes, "utf-8");
      const manifestStat = await lstat(config.manifest.path);
      const foreignStat = await lstat(foreignPath);
      const foreignLink =
        shape === "symlink" ? await readlink(foreignPath) : undefined;
      const manifestParentInventory = await readdir(
        path.dirname(config.manifest.path),
      );
      const foreignParentInventory = await readdir(path.dirname(foreignPath));
      const installedInventory = await readdir(installedHome);

      let result: Awaited<ReturnType<typeof sync>> | undefined;
      let thrown: unknown;
      try {
        result = await sync(config, {
          dryRun,
          force: false,
          strict: false,
          reconcileManifest: true,
        });
      } catch (error) {
        thrown = error;
      }

      expect(await readTextFile(config.manifest.path)).toBe(manifestBytes);
      expect((await lstat(config.manifest.path)).ino).toBe(manifestStat.ino);
      expect(await readdir(path.dirname(config.manifest.path))).toEqual(
        manifestParentInventory,
      );
      expect(await pathExists(`${config.manifest.path}.lock`)).toBe(false);
      expect(await pathExists(foreignPath)).toBe(true);
      expect((await lstat(foreignPath)).ino).toBe(foreignStat.ino);
      expect((await lstat(foreignPath)).isFile()).toBe(foreignStat.isFile());
      expect((await lstat(foreignPath)).isDirectory()).toBe(
        foreignStat.isDirectory(),
      );
      expect((await lstat(foreignPath)).isSymbolicLink()).toBe(
        foreignStat.isSymbolicLink(),
      );
      expect(await readdir(path.dirname(foreignPath))).toEqual(
        foreignParentInventory,
      );
      if (shape === "directory") {
        expect(await readTextFile(foreignSentinelPath)).toBe(
          "foreign directory sentinel",
        );
      } else if (shape === "symlink") {
        expect(await readlink(foreignPath)).toBe(foreignLink);
        expect(await readTextFile(externalLinkTarget)).toBe(
          "external sentinel",
        );
      } else {
        expect(await readTextFile(foreignPath)).toBe("foreign file sentinel");
      }
      expect(await readTextFile(generatedSentinelPath)).toBe(
        "generated sentinel",
      );
      expect(await readTextFile(installedSentinelPath)).toBe(
        "installed sentinel",
      );
      expect(await readdir(installedHome)).toEqual(installedInventory);
      expect(suite.testLogger.infos).toEqual([]);
      expect(result).toBeUndefined();
      expect(thrown).toBeInstanceOf(UserError);
      expect((thrown as Error).message).toContain(
        "Reconciled foreign path overlaps renderer mutation inventory",
      );
      expect((thrown as Error).message).toContain(path.resolve(foreignPath));
      expect((thrown as Error).message).toContain(authoritativeMutationKind);
      expect(
        (await readdir(path.dirname(config.manifest.path))).filter(
          (entry) =>
            entry.includes(".backup-") ||
            entry.includes(".tmp") ||
            entry.endsWith(".lock"),
        ),
      ).toEqual([]);
    },
  );

  it("allows a reconciled foreign path in a passive target generated tree", async () => {
    const config = makeResolvedConfig(suite.tempDir);
    const selectedName = "selected";
    await createAgentFixture(
      config.library.agentsDir,
      selectedName,
      makeAgentYaml(selectedName),
    );
    const foreignPath = path.join(
      config.library.generatedDir,
      "codex",
      "agents",
      "passive.toml",
    );
    await mkdir(path.dirname(foreignPath), { recursive: true });
    await writeFile(foreignPath, "passive foreign sentinel", "utf-8");
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "codex",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "passive.yaml"),
            generatedPath: null,
            installedPath: foreignPath,
            installMode: "copy",
            contentHash: "passive-foreign",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );

    const result = await sync(config, {
      target: "claude",
      dryRun: false,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(result).toMatchObject({
      installed: 2,
      updated: 0,
      removed: 0,
      conflicts: 0,
      errors: [],
      reconciliation: {
        retained: [],
        removed: [expect.objectContaining({ installedPath: foreignPath })],
      },
    });
    expect(await readTextFile(foreignPath)).toBe("passive foreign sentinel");
    expect(
      await pathExists(
        path.join(
          config.library.generatedDir,
          "claude",
          "agents",
          "selected.md",
        ),
      ),
    ).toBe(true);
    expect(
      await pathExists(
        path.join(config.targets.claude.agentsHome, "selected.md"),
      ),
    ).toBe(true);
  });

  it("allows an active selected-tree component sibling without overbroad root containment", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    const selectedName = "selected";
    await createAgentFixture(
      config.library.agentsDir,
      selectedName,
      makeAgentYaml(selectedName),
    );
    const foreignPath = path.join(
      config.library.generatedDir,
      "claude",
      "agents-archive",
      "foreign.md",
    );
    await mkdir(path.dirname(foreignPath), { recursive: true });
    await writeFile(foreignPath, "active sibling sentinel", "utf-8");
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "foreign.yaml"),
            generatedPath: null,
            installedPath: foreignPath,
            installMode: "copy",
            contentHash: "foreign",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      reconcileManifest: true,
    });

    expect(result.errors).toEqual([]);
    expect(result.installed).toBe(2);
    expect(await readTextFile(foreignPath)).toBe("active sibling sentinel");
    expect(
      await pathExists(
        path.join(
          config.library.generatedDir,
          "claude",
          "agents",
          `${selectedName}.md`,
        ),
      ),
    ).toBe(true);
  });

  it("rejects differently identified retained records at one literal path before side effects", async () => {
    for (const dryRun of [true, false]) {
      const scenarioDir = path.join(suite.tempDir, dryRun ? "dry" : "real");
      const sharedSkillsHome = path.join(scenarioDir, "home", "skills");
      const config = makeResolvedConfig(scenarioDir, {
        claude: { skillsHome: sharedSkillsHome },
        codex: { skillsHome: sharedSkillsHome },
      });
      await seedPassiveRuntime(config);
      const installedPath = path.join(sharedSkillsHome, "shared");
      const generatedSentinel = path.join(
        config.library.generatedDir,
        "sentinel.txt",
      );
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await mkdir(path.dirname(generatedSentinel), { recursive: true });
      await writeFile(generatedSentinel, "generated sentinel", "utf-8");
      await writeFile(
        config.manifest.path,
        makeManifestJson(
          [
            {
              target: "claude",
              type: "skill",
              name: "shared",
              sourcePath: path.join(config.library.skillsDir, "shared"),
              generatedPath: null,
              installedPath,
              installMode: "copy",
              contentHash: "claude-retained",
              timestamp: new Date().toISOString(),
            },
            {
              target: "codex",
              type: "skill",
              name: "shared",
              sourcePath: path.join(config.library.skillsDir, "shared"),
              generatedPath: null,
              installedPath,
              installMode: "copy",
              contentHash: "codex-retained",
              timestamp: new Date().toISOString(),
            },
          ],
          { config },
        ),
        "utf-8",
      );
      const manifestBefore = await readTextFile(config.manifest.path);

      await expect(
        sync(config, { dryRun, force: false, strict: false }),
      ).rejects.toThrow("Managed output physical path conflict");

      expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
      expect(await readTextFile(generatedSentinel)).toBe("generated sentinel");
      expect(await pathExists(installedPath)).toBe(false);
      expect(
        (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
          entry.includes(".backup-"),
        ),
      ).toHaveLength(0);
      expect(suite.testLogger.infos).toEqual([]);
    }
  });

  it("reconciles an owned and foreign exact-path legacy pair without replacing the owned output", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    const name = "shared";
    const installedPath = path.join(
      config.targets.claude.agentsHome,
      `${name}.md`,
    );
    await mkdir(config.library.agentsDir, { recursive: true });
    await createAgentFixture(
      config.library.agentsDir,
      name,
      makeAgentYaml(name),
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, `${name}.yaml`),
            generatedPath: null,
            installedPath,
            installMode: "copy",
            contentHash: "owned",
            timestamp: new Date().toISOString(),
          },
          {
            target: "claude",
            type: "skill",
            sourcePath: path.join(config.library.skillsDir, "foreign"),
            generatedPath: null,
            installedPath,
            installMode: "copy",
            contentHash: "foreign",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );
    const manifestBefore = await readTextFile(config.manifest.path);

    const dryRun = await sync(config, {
      dryRun: true,
      force: false,
      strict: false,
      reconcileManifest: true,
    });
    expect(dryRun.reconciliation).toMatchObject({
      retained: [expect.objectContaining({ name, installedPath })],
      removed: [expect.objectContaining({ installedPath })],
    });
    expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
    expect(await pathExists(installedPath)).toBe(false);

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      reconcileManifest: true,
    });
    expect(result).toMatchObject({
      installed: 1,
      updated: 0,
      removed: 0,
      conflicts: 1,
      errors: [],
    });
    const backups = (await readdir(path.dirname(config.manifest.path))).filter(
      (entry) => entry.includes(".backup-"),
    );
    expect(backups).toHaveLength(1);
    expect(await readTextFile(path.join(suite.tempDir, backups[0]))).toBe(
      manifestBefore,
    );
    expect(await pathExists(installedPath)).toBe(false);
    expect(
      JSON.parse(await readTextFile(config.manifest.path)).records,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name, installedPath }),
        expect.objectContaining({ name: "devcanon-runtime" }),
      ]),
    );

    const second = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
    });
    expect(second.errors).toEqual([]);
    expect(second.installed).toBe(1);
    expect(await pathExists(installedPath)).toBe(true);
  });

  it("refuses bound foreign and unreconciled legacy exact-path pairs before writes", async () => {
    for (const scenario of [
      {
        name: "bound",
        fixture: "bound" as const,
        error: "Bound manifest contains foreign records",
      },
      {
        name: "legacy",
        fixture: "legacy" as const,
        error: "Legacy manifest contains foreign records",
      },
    ]) {
      const scenarioDir = path.join(
        suite.tempDir,
        `exact-refusal-${scenario.name}`,
      );
      const config = makeResolvedConfig(scenarioDir, {
        codex: { enabled: false },
      });
      await seedPassiveRuntime(config);
      const installedPath = path.join(
        config.targets.claude.agentsHome,
        "shared.md",
      );
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      const records = [
        {
          target: "claude",
          type: "agent",
          ...(scenario.fixture === "bound" ? { name: "shared" } : {}),
          sourcePath: path.join(config.library.agentsDir, "shared.yaml"),
          generatedPath: null,
          installedPath,
          installMode: "copy",
          contentHash: "owned",
          timestamp: new Date().toISOString(),
        },
        {
          target: "claude",
          type: "skill",
          ...(scenario.fixture === "bound" ? { name: "foreign" } : {}),
          sourcePath: path.join(config.library.skillsDir, "foreign"),
          generatedPath: null,
          installedPath,
          installMode: "copy",
          contentHash: "foreign",
          timestamp: new Date().toISOString(),
        },
      ];
      await writeFile(
        config.manifest.path,
        makeManifestJson(records, {
          ...(scenario.fixture === "bound" ? { config } : { legacy: true }),
        }),
        "utf-8",
      );
      const manifestBefore = await readTextFile(config.manifest.path);

      await expect(
        sync(config, { dryRun: false, force: false, strict: false }),
      ).rejects.toThrow(scenario.error);
      expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
      expect(await pathExists(installedPath)).toBe(false);
      expect(await pathExists(config.library.generatedDir)).toBe(false);
      expect(
        (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
          entry.includes(".backup-"),
        ),
      ).toHaveLength(0);
    }
  });
});
