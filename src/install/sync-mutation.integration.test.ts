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
import { buildSkillContentHash } from "../render/skill.js";
import { pathExists, readTextFile } from "../utils/fs.js";

const symlinkAvailable = await canCreateSymlinks();

async function expectRelativeSymlinkTarget(
  linkPath: string,
  expectedTarget: string,
): Promise<void> {
  const actualTarget = await readlink(linkPath);
  expect(actualTarget.replaceAll("\\", "/")).toBe(
    expectedTarget.replaceAll("\\", "/"),
  );
}

describe("sync", () => {
  const suite = useSyncFixture();
  const { sync, seedPassiveRuntime, seedInstalled } = suite;

  it("blocks component-overlapping managed updates and removals in both directions", async () => {
    const scenarios = [
      { action: "update" as const, direction: "descendant" as const },
      { action: "update" as const, direction: "ancestor" as const },
      { action: "remove" as const, direction: "descendant" as const },
      { action: "remove" as const, direction: "ancestor" as const },
    ];
    for (const scenario of scenarios) {
      const scenarioDir = path.join(
        suite.tempDir,
        `${scenario.action}-${scenario.direction}`,
      );
      const config = makeResolvedConfig(scenarioDir, {
        codex: { enabled: false },
      });
      await seedPassiveRuntime(config);
      const type = scenario.direction === "ancestor" ? "skill" : "agent";
      const name = "protected";
      const sourcePath =
        type === "skill"
          ? await createSkillFixture(config.library.skillsDir, name)
          : await createAgentFixture(
              config.library.agentsDir,
              name,
              makeAgentYaml(name),
            );
      await seedInstalled(config, {
        dryRun: false,
        force: false,
        strict: false,
      });
      const initial = JSON.parse(await readTextFile(config.manifest.path));
      const record = initial.records.find(
        (candidate: { target: string; type: string; name: string }) =>
          candidate.target === "claude" &&
          candidate.type === type &&
          candidate.name === name,
      );
      const { name: _name, ...legacyRecord } = record;
      const foreignPath =
        scenario.direction === "ancestor"
          ? path.join(record.installedPath, "foreign.md")
          : type === "agent"
            ? config.targets.claude.agentsHome
            : config.targets.claude.skillsHome;
      if (scenario.direction === "ancestor") {
        await writeFile(foreignPath, "foreign child bytes", "utf-8");
      }
      await writeFile(
        config.manifest.path,
        makeManifestJson(
          [
            legacyRecord,
            {
              target: "claude",
              type: scenario.direction === "ancestor" ? "agent" : "skill",
              sourcePath: path.join(scenarioDir, "foreign"),
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
      const installedBefore =
        type === "agent"
          ? await readTextFile(record.installedPath)
          : await readTextFile(path.join(record.installedPath, "SKILL.md"));
      if (scenario.action === "update") {
        if (type === "agent") {
          await writeFile(
            sourcePath,
            makeAgentYaml(name, { description: "updated" }),
            "utf-8",
          );
        } else {
          await writeFile(
            path.join(sourcePath, "SKILL.md"),
            "---\nname: protected\ndescription: updated\n---\n\n# protected\n",
            "utf-8",
          );
        }
      } else {
        await rm(sourcePath, { recursive: true });
      }

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
      expect(
        type === "agent"
          ? await readTextFile(record.installedPath)
          : await readTextFile(path.join(record.installedPath, "SKILL.md")),
      ).toBe(installedBefore);
      expect(
        JSON.parse(await readTextFile(config.manifest.path)).records,
      ).toEqual([
        expect.objectContaining({ name, installedPath: record.installedPath }),
      ]);
    }
  });

  it("allows an unrelated component-prefix sibling overwrite while a foreign path is protected", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
      defaults: { cleanManagedOutputs: false },
    });
    const installedPath = path.join(
      config.targets.claude.agentsHome,
      "foobar.md",
    );
    const foreignPath = path.join(config.targets.claude.agentsHome, "foo");
    await createAgentFixture(
      config.library.agentsDir,
      "foobar",
      makeAgentYaml("foobar"),
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(path.dirname(installedPath), { recursive: true });
    await writeFile(installedPath, "unmanaged foobar bytes", "utf-8");
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "skill",
            sourcePath: path.join(config.library.skillsDir, "foo"),
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
      force: true,
      strict: false,
      reconcileManifest: true,
    });
    expect(result).toMatchObject({
      installed: 2,
      conflicts: 0,
      errors: [],
    });
    expect(await readTextFile(installedPath)).not.toBe(
      "unmanaged foobar bytes",
    );
    expect(
      JSON.parse(await readTextFile(config.manifest.path)).records,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "foobar", installedPath }),
        expect.objectContaining({ name: "devcanon-runtime" }),
      ]),
    );
  });

  it.skipIf(!symlinkAvailable)(
    "preserves component-overlapping foreign files trees and dangling links across install modes",
    async () => {
      const scenarios = (["file", "tree", "link"] as const).flatMap((kind) =>
        (["copy", "symlink"] as const).flatMap((mode) => [
          { kind, mode, force: true },
          { kind, mode, force: false },
        ]),
      );

      for (const scenario of scenarios) {
        suite.testLogger.infos.length = 0;
        const scenarioDir = path.join(
          suite.tempDir,
          `component-${scenario.kind}-${scenario.mode}-${scenario.force ? "force" : "overwrite-all"}`,
        );
        const config = makeResolvedConfig(scenarioDir, {
          codex: { enabled: false },
          defaults: {
            cleanManagedOutputs: false,
            ...(scenario.force ? {} : { overwritePolicy: "overwrite-all" }),
          },
        });
        await seedPassiveRuntime(config);
        const type = scenario.kind === "tree" ? "skill" : "agent";
        const name = "protected";
        const home =
          type === "skill"
            ? config.targets.claude.skillsHome
            : config.targets.claude.agentsHome;
        const installedPath = path.join(
          home,
          type === "skill" ? name : `${name}.md`,
        );
        const foreignPath =
          scenario.kind === "tree"
            ? path.join(installedPath, "foreign.md")
            : home;
        const missingTarget = path.join(scenarioDir, "missing-target");
        const sentinelPath = path.join(installedPath, "sentinel.txt");

        await mkdir(config.library.skillsDir, { recursive: true });
        await mkdir(config.library.agentsDir, { recursive: true });
        await mkdir(path.dirname(config.manifest.path), { recursive: true });
        if (type === "skill") {
          await createSkillFixture(config.library.skillsDir, name);
        } else {
          await createAgentFixture(
            config.library.agentsDir,
            name,
            makeAgentYaml(name),
          );
        }
        await mkdir(path.dirname(installedPath), { recursive: true });
        if (scenario.kind === "file") {
          await writeFile(installedPath, "foreign file bytes", "utf-8");
        } else if (scenario.kind === "tree") {
          await mkdir(installedPath, { recursive: true });
          await writeFile(sentinelPath, "foreign tree bytes", "utf-8");
        } else {
          await symlink(missingTarget, installedPath, "file");
        }
        await writeFile(
          config.manifest.path,
          makeManifestJson(
            [
              {
                target: "claude",
                type: scenario.kind === "tree" ? "agent" : "skill",
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
        const manifestBefore = await readTextFile(config.manifest.path);
        const originalLink =
          scenario.kind === "link" ? await readlink(installedPath) : undefined;

        const dryRun = await sync(config, {
          dryRun: true,
          force: scenario.force,
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
          `[skip-conflict] claude/${type}/protected`,
        );
        expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
        expect(
          (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
            entry.includes(".backup-"),
          ),
        ).toHaveLength(0);

        const result = await sync(config, {
          dryRun: false,
          force: scenario.force,
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
        if (scenario.kind === "file") {
          expect((await lstat(installedPath)).isFile()).toBe(true);
          expect(await readTextFile(installedPath)).toBe("foreign file bytes");
        } else if (scenario.kind === "tree") {
          expect((await lstat(installedPath)).isDirectory()).toBe(true);
          expect(await readTextFile(sentinelPath)).toBe("foreign tree bytes");
        } else {
          expect((await lstat(installedPath)).isSymbolicLink()).toBe(true);
          expect(await readlink(installedPath)).toBe(originalLink);
          expect(await pathExists(missingTarget)).toBe(false);
        }
        expect(
          JSON.parse(await readTextFile(config.manifest.path)).records,
        ).toEqual([expect.objectContaining({ name: "devcanon-runtime" })]);
      }
    },
  );

  it("blocks a planned install nested beneath a reconciled foreign directory", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    const name = "nested";
    const installedPath = path.join(
      config.targets.claude.agentsHome,
      `${name}.md`,
    );
    const protectedPath = config.targets.claude.agentsHome;
    const sentinelPath = path.join(protectedPath, "foreign-sentinel.txt");
    await mkdir(config.library.agentsDir, { recursive: true });
    await createAgentFixture(
      config.library.agentsDir,
      name,
      makeAgentYaml(name),
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(protectedPath, { recursive: true });
    await writeFile(sentinelPath, "foreign tree bytes", "utf-8");
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "skill",
            sourcePath: path.join(config.library.skillsDir, "foreign"),
            generatedPath: null,
            installedPath: protectedPath,
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

    expect(dryRun).toMatchObject({
      installed: 0,
      updated: 0,
      removed: 0,
      skipped: 0,
      conflicts: 0,
      errors: [],
    });
    expect(suite.testLogger.infos.join("\n")).toContain(
      "[skip-conflict] claude/agent/nested",
    );
    expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
    expect(await pathExists(installedPath)).toBe(false);
    expect(await readTextFile(sentinelPath)).toBe("foreign tree bytes");

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
    expect(await pathExists(installedPath)).toBe(false);
    expect(await readTextFile(sentinelPath)).toBe("foreign tree bytes");
    expect(
      JSON.parse(await readTextFile(config.manifest.path)).records,
    ).toEqual([expect.objectContaining({ name: "devcanon-runtime" })]);

    const afterProtectionExpires = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
    });
    expect(afterProtectionExpires).toMatchObject({
      installed: 1,
      conflicts: 0,
      errors: [],
    });
    expect(await pathExists(installedPath)).toBe(true);
  });

  it("blocks a planned ancestor install that contains an absent protected descendant", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    const name = "ancestor-install";
    const installedPath = path.join(config.targets.claude.skillsHome, name);
    const protectedPath = path.join(installedPath, "foreign.md");
    await createSkillFixture(config.library.skillsDir, name);
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
            installedPath: protectedPath,
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

    expect(dryRun).toMatchObject({
      installed: 0,
      updated: 0,
      removed: 0,
      skipped: 0,
      conflicts: 0,
      errors: [],
    });
    expect(suite.testLogger.infos.join("\n")).toContain(
      "[skip-conflict] claude/skill/ancestor-install",
    );
    expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
    expect(await pathExists(installedPath)).toBe(false);
    expect(await pathExists(protectedPath)).toBe(false);
    expect(
      (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
        entry.includes(".backup-"),
      ),
    ).toHaveLength(0);

    suite.testLogger.infos.length = 0;
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
    expect(await pathExists(installedPath)).toBe(false);
    expect(await pathExists(protectedPath)).toBe(false);
    expect(
      JSON.parse(await readTextFile(config.manifest.path)).records,
    ).toEqual([expect.objectContaining({ name: "devcanon-runtime" })]);

    const afterProtectionExpires = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
    });
    expect(afterProtectionExpires).toMatchObject({
      installed: 1,
      conflicts: 0,
      errors: [],
    });
    expect(await pathExists(installedPath)).toBe(true);
  });

  it("blocks an explicit force overwrite that contains a reconciled foreign child", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    const name = "protected";
    const installedPath = path.join(config.targets.claude.skillsHome, name);
    const foreignPath = path.join(installedPath, "foreign.md");
    await mkdir(config.library.skillsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, name);
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(installedPath, { recursive: true });
    await writeFile(foreignPath, "foreign child bytes", "utf-8");
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
    const manifestBefore = await readTextFile(config.manifest.path);

    const dryRun = await sync(config, {
      dryRun: true,
      force: true,
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
    expect(suite.testLogger.infos.join("\n")).toContain(
      "[skip-conflict] claude/skill/protected",
    );
    expect(await readTextFile(config.manifest.path)).toBe(manifestBefore);
    expect(await readTextFile(foreignPath)).toBe("foreign child bytes");
    expect(
      (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
        entry.includes(".backup-"),
      ),
    ).toHaveLength(0);

    const result = await sync(config, {
      dryRun: false,
      force: true,
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
    expect(await readTextFile(foreignPath)).toBe("foreign child bytes");
    expect(
      JSON.parse(await readTextFile(config.manifest.path)).records,
    ).toEqual([expect.objectContaining({ name: "devcanon-runtime" })]);
    expect(
      (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
        entry.includes(".backup-"),
      ),
    ).toHaveLength(1);
  });

  it("idempotent re-sync skips when nothing changed", async () => {
    const config = makeResolvedConfig(suite.tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, "alpha");
    await createAgentFixture(
      config.library.agentsDir,
      "bot",
      makeAgentYaml("bot"),
    );

    const opts = { dryRun: false, force: false, strict: false } as const;
    await sync(config, opts);
    const second = await sync(config, opts);

    expect(second.skipped).toBeGreaterThan(0);
    expect(second.installed).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.errors).toEqual([]);
  });

  it("re-sync detects updated source and reports updated count", async () => {
    const config = makeResolvedConfig(suite.tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, "s1");
    const agentPath = await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    const opts = { dryRun: false, force: false, strict: false } as const;
    await sync(config, opts);

    // Modify agent instructions
    await writeFile(
      agentPath,
      makeAgentYaml("a1", { instructions: "Updated instructions v2" }),
      "utf-8",
    );

    const second = await sync(config, opts);

    expect(second.updated).toBeGreaterThan(0);
    expect(second.errors).toEqual([]);

    // Verify at least one installed agent file has the new content
    const claudeAgentPath = path.join(
      config.targets.claude.agentsHome,
      "a1.md",
    );
    const content = await readTextFile(claudeAgentPath);
    expect(content).toContain("Updated instructions v2");
  });

  it("skips copy-mode update when installed agent content no longer matches the manifest", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    const agentPath = await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    const opts = { dryRun: false, force: false, strict: false } as const;
    await seedInstalled(config, opts);

    const claudeAgentPath = path.join(
      config.targets.claude.agentsHome,
      "a1.md",
    );
    await writeFile(claudeAgentPath, "tampered installed content", "utf-8");
    const manifestBefore = JSON.parse(await readTextFile(config.manifest.path));

    await writeFile(
      agentPath,
      makeAgentYaml("a1", { instructions: "Updated instructions v2" }),
      "utf-8",
    );

    const result = await sync(config, { ...opts, force: true });

    expect(result.updated).toBe(0);
    expect(result.errors).toEqual([
      expect.stringContaining("Managed output identity failure"),
    ]);
    expect(await readTextFile(claudeAgentPath)).toBe(
      "tampered installed content",
    );
    const manifestAfter = JSON.parse(await readTextFile(config.manifest.path));
    expect(manifestAfter.records).toEqual(manifestBefore.records);
  });

  it("reports copy identity failure when installed agent kind changes before update", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    const agentPath = await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    const opts = { dryRun: false, force: false, strict: false } as const;
    await seedInstalled(config, opts);

    const claudeAgentPath = path.join(
      config.targets.claude.agentsHome,
      "a1.md",
    );
    await rm(claudeAgentPath);
    await mkdir(claudeAgentPath, { recursive: true });
    await writeFile(path.join(claudeAgentPath, "sentinel"), "keep me", "utf-8");
    const manifestBefore = JSON.parse(await readTextFile(config.manifest.path));

    await writeFile(
      agentPath,
      makeAgentYaml("a1", { instructions: "Updated instructions v2" }),
      "utf-8",
    );

    const result = await sync(config, opts);

    expect(result.updated).toBe(0);
    expect(result.errors).toEqual([
      expect.stringContaining("Managed output identity failure"),
    ]);
    expect(result.errors[0]).toContain("installed agent is not a file");
    expect(await readTextFile(path.join(claudeAgentPath, "sentinel"))).toBe(
      "keep me",
    );
    const manifestAfter = JSON.parse(await readTextFile(config.manifest.path));
    expect(manifestAfter.records).toEqual(manifestBefore.records);
  });

  it("skips copy-mode update when installed skill directory content no longer matches the manifest", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    const skillDir = await createSkillFixture(
      config.library.skillsDir,
      "skill-a",
      "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n",
      ["scripts"],
    );
    await writeFile(
      path.join(skillDir, "scripts", "helper.sh"),
      "#!/bin/sh\necho helper\n",
      "utf-8",
    );

    const opts = { dryRun: false, force: false, strict: false } as const;
    await seedInstalled(config, opts);

    const claudeSkillPath = path.join(
      config.targets.claude.skillsHome,
      "skill-a",
    );
    await writeFile(
      path.join(claudeSkillPath, "scripts", "helper.sh"),
      "tampered helper\n",
      "utf-8",
    );
    const manifestBefore = JSON.parse(await readTextFile(config.manifest.path));

    await writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n\nUpdated.\n",
      "utf-8",
    );

    const result = await sync(config, opts);

    expect(result.updated).toBe(0);
    expect(result.errors).toEqual([
      expect.stringContaining("installed copy content hash mismatch"),
    ]);
    expect(
      await readTextFile(path.join(claudeSkillPath, "scripts", "helper.sh")),
    ).toBe("tampered helper\n");
    const manifestAfter = JSON.parse(await readTextFile(config.manifest.path));
    expect(manifestAfter.records).toEqual(manifestBefore.records);
  });

  it("skips copy-mode update when installed skill has unexpected top-level entries", async () => {
    const config = makeResolvedConfig(suite.tempDir, {
      codex: { enabled: false },
    });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    const skillDir = await createSkillFixture(
      config.library.skillsDir,
      "skill-a",
      "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n",
    );

    const opts = { dryRun: false, force: false, strict: false } as const;
    await seedInstalled(config, opts);

    const claudeSkillPath = path.join(
      config.targets.claude.skillsHome,
      "skill-a",
    );
    const sentinelPath = path.join(claudeSkillPath, "local-note.txt");
    await writeFile(sentinelPath, "keep me", "utf-8");
    const manifestBefore = JSON.parse(await readTextFile(config.manifest.path));

    await writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n\nUpdated.\n",
      "utf-8",
    );

    const result = await sync(config, opts);

    expect(result.updated).toBe(0);
    expect(result.errors).toEqual([
      expect.stringContaining("unexpected top-level entries"),
    ]);
    expect(await readTextFile(sentinelPath)).toBe("keep me");
    const manifestAfter = JSON.parse(await readTextFile(config.manifest.path));
    expect(manifestAfter.records).toEqual(manifestBefore.records);
  });

  it.skipIf(!symlinkAvailable)(
    "updates copy-installed skills when a mirrored symlink target changes",
    async () => {
      const config = makeResolvedConfig(suite.tempDir, {
        codex: { enabled: false },
      });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      const skillDir = await createSkillFixture(
        config.library.skillsDir,
        "skill-a",
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n",
        ["scripts"],
      );
      const sourceLink = path.join(skillDir, "scripts", "link.txt");
      await symlink("../target-a/payload.txt", sourceLink);

      const opts = { dryRun: false, force: false, strict: false } as const;
      await seedInstalled(config, opts);

      await rm(sourceLink);
      await symlink("../target-b/payload.txt", sourceLink);

      const result = await sync(config, opts);

      const installedLink = path.join(
        config.targets.claude.skillsHome,
        "skill-a",
        "scripts",
        "link.txt",
      );
      expect(result.errors).toEqual([]);
      expect(result.updated).toBe(1);
      await expectRelativeSymlinkTarget(
        installedLink,
        "../target-b/payload.txt",
      );
    },
  );

  it.skipIf(!symlinkAvailable)(
    "updates copy-installed skills with absolute mirrored symlinks",
    async () => {
      const config = makeResolvedConfig(suite.tempDir, {
        codex: { enabled: false },
      });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      const skillDir = await createSkillFixture(
        config.library.skillsDir,
        "skill-a",
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n",
        ["scripts"],
      );
      const absoluteTarget = path.join(
        suite.tempDir,
        "absolute-target",
        "payload.txt",
      );
      await mkdir(path.dirname(absoluteTarget), { recursive: true });
      await writeFile(absoluteTarget, "payload", "utf-8");
      await symlink(absoluteTarget, path.join(skillDir, "scripts", "link.txt"));

      const opts = { dryRun: false, force: false, strict: false } as const;
      await seedInstalled(config, opts);

      await writeFile(
        path.join(skillDir, "SKILL.md"),
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n\nUpdated.\n",
        "utf-8",
      );

      const result = await sync(config, opts);

      const installedLink = path.join(
        config.targets.claude.skillsHome,
        "skill-a",
        "scripts",
        "link.txt",
      );
      expect(result.updated).toBe(1);
      expect(result.errors).toEqual([]);
      expect(await readlink(installedLink)).toBe(absoluteTarget);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "updates copy-installed skills when rewritten absolute symlinks came from dot-relative links",
    async () => {
      const config = makeResolvedConfig(suite.tempDir, {
        codex: { enabled: false },
      });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      const skillDir = await createSkillFixture(
        config.library.skillsDir,
        "skill-a",
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n",
        ["scripts"],
      );
      await writeFile(
        path.join(skillDir, "scripts", "payload.txt"),
        "payload",
        "utf-8",
      );
      const sourceLink = path.join(skillDir, "scripts", "link.txt");
      await symlink("./payload.txt", sourceLink);

      const opts = { dryRun: false, force: false, strict: false } as const;
      await seedInstalled(config, opts);

      const installedLink = path.join(
        config.targets.claude.skillsHome,
        "skill-a",
        "scripts",
        "link.txt",
      );
      const rewrittenTarget = path.join(
        config.library.generatedDir,
        "claude",
        "skills",
        "skill-a",
        "scripts",
        "payload.txt",
      );
      await rm(installedLink);
      await symlink(rewrittenTarget, installedLink, "file");
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n\nUpdated.\n",
        "utf-8",
      );

      const result = await sync(config, opts);

      expect(result.updated).toBe(1);
      expect(result.errors).toEqual([]);
      await expectRelativeSymlinkTarget(installedLink, "./payload.txt");
    },
  );

  it.skipIf(!symlinkAvailable)(
    "updates copy-installed skills when legacy dot and current no-dot symlink spellings resolve to the same target",
    async () => {
      const config = makeResolvedConfig(suite.tempDir, {
        codex: { enabled: false },
      });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      const skillDir = await createSkillFixture(
        config.library.skillsDir,
        "skill-a",
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n",
        ["scripts"],
      );
      await writeFile(
        path.join(skillDir, "scripts", "payload.txt"),
        "payload",
        "utf-8",
      );
      const sourceLink = path.join(skillDir, "scripts", "link.txt");
      await symlink("./payload.txt", sourceLink);

      const opts = { dryRun: false, force: false, strict: false } as const;
      await seedInstalled(config, opts);

      const installedLink = path.join(
        config.targets.claude.skillsHome,
        "skill-a",
        "scripts",
        "link.txt",
      );
      const rewrittenTarget = path.join(
        config.library.generatedDir,
        "claude",
        "skills",
        "skill-a",
        "scripts",
        "payload.txt",
      );
      await rm(installedLink);
      await symlink(rewrittenTarget, installedLink, "file");
      await rm(sourceLink);
      await symlink("payload.txt", sourceLink);
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n\nUpdated.\n",
        "utf-8",
      );

      const result = await sync(config, opts);

      expect(result.updated).toBe(1);
      expect(result.errors).toEqual([]);
      await expectRelativeSymlinkTarget(installedLink, "payload.txt");
    },
  );

  it.skipIf(!symlinkAvailable)(
    "updates copy-installed skills when legacy no-dot and current dot symlink spellings resolve to the same target",
    async () => {
      const config = makeResolvedConfig(suite.tempDir, {
        codex: { enabled: false },
      });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      const skillDir = await createSkillFixture(
        config.library.skillsDir,
        "skill-a",
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n",
        ["scripts"],
      );
      await writeFile(
        path.join(skillDir, "scripts", "payload.txt"),
        "payload",
        "utf-8",
      );
      const sourceLink = path.join(skillDir, "scripts", "link.txt");
      await symlink("payload.txt", sourceLink);

      const opts = { dryRun: false, force: false, strict: false } as const;
      await seedInstalled(config, opts);

      const installedLink = path.join(
        config.targets.claude.skillsHome,
        "skill-a",
        "scripts",
        "link.txt",
      );
      const rewrittenTarget = path.join(
        config.library.generatedDir,
        "claude",
        "skills",
        "skill-a",
        "scripts",
        "payload.txt",
      );
      await rm(installedLink);
      await symlink(rewrittenTarget, installedLink, "file");
      await rm(sourceLink);
      await symlink("./payload.txt", sourceLink);
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n\nUpdated.\n",
        "utf-8",
      );

      const result = await sync(config, opts);

      expect(result.updated).toBe(1);
      expect(result.errors).toEqual([]);
      await expectRelativeSymlinkTarget(installedLink, "./payload.txt");
    },
  );

  it.skipIf(!symlinkAvailable)(
    "updates copy-installed skills when the manifest hash used native separators for a contained symlink target",
    async () => {
      const config = makeResolvedConfig(suite.tempDir, {
        codex: { enabled: false },
      });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      const skillDir = await createSkillFixture(
        config.library.skillsDir,
        "skill-a",
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n",
        ["scripts"],
      );
      await mkdir(path.join(skillDir, "scripts", "nested"), {
        recursive: true,
      });
      await writeFile(
        path.join(skillDir, "scripts", "nested", "payload.txt"),
        "payload",
        "utf-8",
      );
      await symlink(
        "nested/payload.txt",
        path.join(skillDir, "scripts", "link.txt"),
      );

      const opts = { dryRun: false, force: false, strict: false } as const;
      await seedInstalled(config, opts);

      const installedLink = path.join(
        config.targets.claude.skillsHome,
        "skill-a",
        "scripts",
        "link.txt",
      );
      const generatedSkillDir = path.join(
        config.library.generatedDir,
        "claude",
        "skills",
        "skill-a",
      );
      const rewrittenTarget = path.join(
        generatedSkillDir,
        "scripts",
        "nested",
        "payload.txt",
      );
      await rm(installedLink);
      await symlink(rewrittenTarget, installedLink, "file");

      const manifest = JSON.parse(await readTextFile(config.manifest.path));
      const installedSkillContent = await readTextFile(
        path.join(config.targets.claude.skillsHome, "skill-a", "SKILL.md"),
      );
      const claudeRecord = manifest.records.find(
        (record: { installedPath: string }) =>
          record.installedPath ===
          path.join(config.targets.claude.skillsHome, "skill-a"),
      );
      claudeRecord.contentHash = buildSkillContentHash(
        installedSkillContent,
        new Map([
          [
            path.join(generatedSkillDir, "scripts", "nested", "payload.txt"),
            `file:${Buffer.from("payload").toString("base64")}`,
          ],
          [
            path.join(generatedSkillDir, "scripts", "link.txt"),
            "symlink:nested\\payload.txt",
          ],
        ]),
        generatedSkillDir,
      );
      await writeFile(
        config.manifest.path,
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf-8",
      );
      const sourceLink = path.join(skillDir, "scripts", "link.txt");
      await rm(sourceLink);
      await symlink("./nested/payload.txt", sourceLink);
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n\nUpdated.\n",
        "utf-8",
      );

      const result = await sync(config, opts);

      expect(result.errors).toEqual([]);
      expect(result.updated).toBe(1);
      await expectRelativeSymlinkTarget(installedLink, "./nested/payload.txt");
    },
  );

  it("dry run makes no changes and returns zero counts", async () => {
    const config = makeResolvedConfig(suite.tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, "s1");
    await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    const result = await sync(config, {
      dryRun: true,
      force: false,
      strict: false,
    });

    expect(result.installed).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.conflicts).toBe(0);

    // No manifest should have been written
    expect(await pathExists(config.manifest.path)).toBe(false);

    // No installed files
    const claudeAgentPath = path.join(
      config.targets.claude.agentsHome,
      "a1.md",
    );
    expect(await pathExists(claudeAgentPath)).toBe(false);
  });

  it("force mode overwrites unmanaged file at installed path", async () => {
    const config = makeResolvedConfig(suite.tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    // Pre-create an unmanaged file at the agent's installed path
    const claudeAgentPath = path.join(
      config.targets.claude.agentsHome,
      "a1.md",
    );
    await mkdir(path.dirname(claudeAgentPath), { recursive: true });
    await writeFile(claudeAgentPath, "unmanaged content", "utf-8");

    const result = await sync(config, {
      dryRun: false,
      force: true,
      strict: false,
    });

    expect(result.installed).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);

    const content = await readTextFile(claudeAgentPath);
    expect(content).not.toBe("unmanaged content");
  });
});
