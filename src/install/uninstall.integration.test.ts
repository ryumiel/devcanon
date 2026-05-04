import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTempDir,
  createAgentFixture,
  createSkillFixture,
  createTempDir,
  makeAgentYaml,
  makeManifestJson,
  makeResolvedConfig,
} from "../__test-helpers__/fixtures.js";
import {
  type TestLoggerResult,
  installTestLogger,
} from "../__test-helpers__/logger.js";
import { pathExists } from "../utils/fs.js";
import { sync } from "./sync.js";
import { uninstall } from "./uninstall.js";

describe("uninstall", () => {
  let tempDir: string;
  let restoreLogger: () => void;
  let testLogger: TestLoggerResult;

  beforeEach(async () => {
    tempDir = await createTempDir();
    const installed = installTestLogger();
    restoreLogger = installed.restore;
    testLogger = installed.testLogger;
  });

  afterEach(async () => {
    restoreLogger();
    await cleanupTempDir(tempDir);
  });

  it("removes every installed output and clears the manifest", async () => {
    const config = makeResolvedConfig(tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, "greet");
    await createAgentFixture(
      config.library.agentsDir,
      "helper",
      makeAgentYaml("helper"),
    );

    // Pre-populate via sync
    const syncResult = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
    });
    expect(syncResult.installed).toBeGreaterThan(0);
    expect(syncResult.errors).toEqual([]);

    // Snapshot source files for AC4 verification
    const skillSourceContent = await readFile(
      path.join(config.library.skillsDir, "greet", "SKILL.md"),
      "utf-8",
    );
    const agentSourceContent = await readFile(
      path.join(config.library.agentsDir, "helper.yaml"),
      "utf-8",
    );

    // Sanity: at least one installed path exists (snapshot the list)
    const claudeAgentPath = path.join(
      config.targets.claude.agentsHome,
      "helper.md",
    );
    const codexAgentPath = path.join(
      config.targets.codex.agentsHome,
      "helper.toml",
    );
    expect(await pathExists(claudeAgentPath)).toBe(true);
    expect(await pathExists(codexAgentPath)).toBe(true);

    // Uninstall
    const result = await uninstall(config, { dryRun: false });

    expect(result.removed).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);

    // All previously installed paths gone
    expect(await pathExists(claudeAgentPath)).toBe(false);
    expect(await pathExists(codexAgentPath)).toBe(false);

    // Manifest has empty records
    const manifestRaw = await readFile(config.manifest.path, "utf-8");
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.records).toEqual([]);

    // AC4: sources unchanged
    expect(
      await readFile(
        path.join(config.library.skillsDir, "greet", "SKILL.md"),
        "utf-8",
      ),
    ).toBe(skillSourceContent);
    expect(
      await readFile(
        path.join(config.library.agentsDir, "helper.yaml"),
        "utf-8",
      ),
    ).toBe(agentSourceContent);
  });

  it("dry-run prints the plan and makes no changes", async () => {
    const config = makeResolvedConfig(tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, "greet");

    await sync(config, { dryRun: false, force: false, strict: false });

    const manifestBefore = await readFile(config.manifest.path, "utf-8");
    const claudeSkillPath = path.join(
      config.targets.claude.skillsHome,
      "greet",
    );
    expect(await pathExists(claudeSkillPath)).toBe(true);

    const result = await uninstall(config, { dryRun: true });

    expect(result.removed).toBe(0);
    expect(result.errors).toEqual([]);

    // Manifest unchanged
    const manifestAfter = await readFile(config.manifest.path, "utf-8");
    expect(manifestAfter).toBe(manifestBefore);

    // Files still installed
    expect(await pathExists(claudeSkillPath)).toBe(true);

    // Log includes a [remove] line
    expect(testLogger.infos.some((m) => m.includes("[remove]"))).toBe(true);
  });

  it("--target claude removes only Claude records and files", async () => {
    const config = makeResolvedConfig(tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, "greet");
    await createAgentFixture(
      config.library.agentsDir,
      "helper",
      makeAgentYaml("helper"),
    );

    await sync(config, { dryRun: false, force: false, strict: false });

    const claudeAgentPath = path.join(
      config.targets.claude.agentsHome,
      "helper.md",
    );
    const codexAgentPath = path.join(
      config.targets.codex.agentsHome,
      "helper.toml",
    );
    const claudeSkillPath = path.join(
      config.targets.claude.skillsHome,
      "greet",
    );
    const codexSkillPath = path.join(config.targets.codex.skillsHome, "greet");

    expect(await pathExists(claudeAgentPath)).toBe(true);
    expect(await pathExists(codexAgentPath)).toBe(true);

    const result = await uninstall(config, {
      target: "claude",
      dryRun: false,
    });

    expect(result.errors).toEqual([]);

    // Claude paths gone
    expect(await pathExists(claudeAgentPath)).toBe(false);
    expect(await pathExists(claudeSkillPath)).toBe(false);

    // Codex paths still present
    expect(await pathExists(codexAgentPath)).toBe(true);
    expect(await pathExists(codexSkillPath)).toBe(true);

    // Manifest contains only codex records
    const manifest = JSON.parse(await readFile(config.manifest.path, "utf-8"));
    expect(manifest.records.length).toBeGreaterThan(0);
    for (const record of manifest.records) {
      expect(record.target).toBe("codex");
    }
  });

  it("emits 'Nothing to remove.' when the manifest is empty", async () => {
    const config = makeResolvedConfig(tempDir);
    // No sync — manifest does not exist; loadManifest returns emptyManifest()

    const result = await uninstall(config, { dryRun: false });

    expect(result.removed).toBe(0);
    expect(result.errors).toEqual([]);
    expect(testLogger.infos).toContain("Nothing to remove.");
  });

  it("emits 'Nothing to remove.' under --dry-run when no records match", async () => {
    const config = makeResolvedConfig(tempDir);
    // Pre-populate manifest with a codex-only record; ask for --target claude
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson([
        {
          target: "codex",
          type: "skill",
          sourcePath: "/x/skills/foo",
          generatedPath: null,
          installedPath: path.join(config.targets.codex.skillsHome, "foo"),
          installMode: "copy",
          contentHash: "abc",
          timestamp: new Date().toISOString(),
        },
      ]),
      "utf-8",
    );

    const result = await uninstall(config, {
      target: "claude",
      dryRun: true,
    });

    expect(result.removed).toBe(0);
    expect(result.errors).toEqual([]);
    expect(testLogger.infos).toContain("Nothing to remove.");
  });

  it.skipIf(process.platform === "win32")(
    "continues past per-record failures and updates manifest with successful removals",
    async () => {
      const config = makeResolvedConfig(tempDir);
      const skillsHome = config.targets.claude.skillsHome;
      await mkdir(skillsHome, { recursive: true });

      // skill-a lives inside a parent that we will chmod to read-only.
      // `rm({ recursive: true, force: true })` cannot unlink skill-a from
      // its parent without write permission on the parent, so the rm call
      // throws EACCES and our error path is exercised. skill-b lives at
      // the writable top of skillsHome and is removable normally.
      const lockedParent = path.join(skillsHome, "_locked");
      await mkdir(lockedParent, { recursive: true });
      const skillAPath = path.join(lockedParent, "skill-a");
      const skillBPath = path.join(skillsHome, "skill-b");
      await mkdir(skillAPath, { recursive: true });
      await mkdir(skillBPath, { recursive: true });
      await writeFile(path.join(skillAPath, "SKILL.md"), "a", "utf-8");
      await writeFile(path.join(skillBPath, "SKILL.md"), "b", "utf-8");

      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      const timestamp = new Date().toISOString();
      await writeFile(
        config.manifest.path,
        makeManifestJson([
          {
            target: "claude",
            type: "skill",
            sourcePath: "/x/skills/skill-a",
            generatedPath: null,
            installedPath: skillAPath,
            installMode: "copy",
            contentHash: "a",
            timestamp,
          },
          {
            target: "claude",
            type: "skill",
            sourcePath: "/x/skills/skill-b",
            generatedPath: null,
            installedPath: skillBPath,
            installMode: "copy",
            contentHash: "b",
            timestamp,
          },
        ]),
        "utf-8",
      );

      await chmod(lockedParent, 0o555);

      try {
        const result = await uninstall(config, { dryRun: false });

        expect(result.removed).toBe(1);
        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toContain(skillAPath);
        expect(result.errors[0]).toMatch(/EACCES|EPERM|permission/i);

        // skill-b was removed; skill-a still on disk under the locked parent
        expect(await pathExists(skillBPath)).toBe(false);
        expect(await pathExists(skillAPath)).toBe(true);

        // Manifest reflects partial state: skill-a still tracked, skill-b cleared
        const manifest = JSON.parse(
          await readFile(config.manifest.path, "utf-8"),
        );
        expect(manifest.records.length).toBe(1);
        expect(manifest.records[0].installedPath).toBe(skillAPath);
      } finally {
        // Restore writability so cleanupTempDir can recursively delete tempDir
        await chmod(lockedParent, 0o755).catch(() => {});
      }
    },
  );
});
