import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canCreateSymlinks,
  cleanupTempDir,
  createAgentFixture,
  createSkillFixture,
  createTempDir,
  makeAgentYaml,
  makeResolvedConfig,
} from "../__test-helpers__/fixtures.js";
import { installTestLogger } from "../__test-helpers__/logger.js";
import { pathExists, readTextFile } from "../utils/fs.js";
import { sync } from "./sync.js";

const symlinkAvailable = await canCreateSymlinks();
const isWindows = process.platform === "win32";

describe("sync", () => {
  let tempDir: string;
  let restoreLogger: () => void;

  beforeEach(async () => {
    tempDir = await createTempDir();
    const { restore } = installTestLogger();
    restoreLogger = restore;
  });

  afterEach(async () => {
    restoreLogger();
    await cleanupTempDir(tempDir);
  });

  it("fresh sync installs skills and agents via copy", async () => {
    const config = makeResolvedConfig(tempDir);
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

  it("idempotent re-sync skips when nothing changed", async () => {
    const config = makeResolvedConfig(tempDir);
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
    const config = makeResolvedConfig(tempDir);
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

  it("dry run makes no changes and returns zero counts", async () => {
    const config = makeResolvedConfig(tempDir);
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
    const config = makeResolvedConfig(tempDir);
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

  it("cleans removed outputs when source is deleted", async () => {
    const config = makeResolvedConfig(tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, "s1");
    const agentPath = await createAgentFixture(
      config.library.agentsDir,
      "removeme",
      makeAgentYaml("removeme"),
    );

    const opts = { dryRun: false, force: false, strict: false } as const;
    const first = await sync(config, opts);
    expect(first.installed).toBeGreaterThan(0);

    // Verify agent is installed
    const claudeAgentPath = path.join(
      config.targets.claude.agentsHome,
      "removeme.md",
    );
    expect(await pathExists(claudeAgentPath)).toBe(true);

    // Delete the agent source YAML
    await rm(agentPath);

    const second = await sync(config, opts);

    expect(second.removed).toBeGreaterThan(0);
    expect(second.errors).toEqual([]);

    // Installed agent file should be gone
    expect(await pathExists(claudeAgentPath)).toBe(false);

    // Manifest should not contain removed path
    const manifestContent = await readTextFile(config.manifest.path);
    expect(manifestContent).not.toContain("removeme");
  });

  it.skipIf(!symlinkAvailable)(
    "removes broken skill symlinks when source directory is deleted",
    async () => {
      const config = makeResolvedConfig(tempDir);
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      await createSkillFixture(config.library.skillsDir, "ephemeral-skill");
      await createAgentFixture(
        config.library.agentsDir,
        "a1",
        makeAgentYaml("a1"),
      );

      const opts = {
        mode: "symlink" as const,
        dryRun: false,
        force: false,
        strict: false,
      };
      const first = await sync(config, opts);
      expect(first.installed).toBeGreaterThan(0);
      expect(first.errors).toEqual([]);

      // Verify skill symlink exists
      const claudeSkillPath = path.join(
        config.targets.claude.skillsHome,
        "ephemeral-skill",
      );
      const stat = await lstat(claudeSkillPath);
      expect(stat.isSymbolicLink()).toBe(true);

      // Delete the skill source directory
      await rm(path.join(config.library.skillsDir, "ephemeral-skill"), {
        recursive: true,
      });

      // Re-sync — broken symlink should be removed
      const second = await sync(config, opts);
      expect(second.removed).toBeGreaterThan(0);
      expect(second.errors).toEqual([]);

      // Broken symlink should be gone
      let symlinkGone = false;
      try {
        await lstat(claudeSkillPath);
      } catch {
        symlinkGone = true;
      }
      expect(symlinkGone).toBe(true);

      // Manifest should not contain the removed skill
      const manifestContent = await readTextFile(config.manifest.path);
      expect(manifestContent).not.toContain("ephemeral-skill");
    },
  );

  it("target filter installs only for the specified target", async () => {
    const config = makeResolvedConfig(tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, "s1");
    await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    const result = await sync(config, {
      target: "claude",
      dryRun: false,
      force: false,
      strict: false,
    });

    expect(result.installed).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);

    // Claude agent should exist
    const claudeAgentPath = path.join(
      config.targets.claude.agentsHome,
      "a1.md",
    );
    expect(await pathExists(claudeAgentPath)).toBe(true);

    // Codex agent should NOT exist
    const codexAgentPath = path.join(
      config.targets.codex.agentsHome,
      "a1.toml",
    );
    expect(await pathExists(codexAgentPath)).toBe(false);
  });

  it.skipIf(!symlinkAvailable)(
    "symlink mode creates symlinks for installed outputs",
    async () => {
      const config = makeResolvedConfig(tempDir);
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      await createSkillFixture(config.library.skillsDir, "s1");
      await createAgentFixture(
        config.library.agentsDir,
        "a1",
        makeAgentYaml("a1"),
      );

      const result = await sync(config, {
        mode: "symlink",
        dryRun: false,
        force: false,
        strict: false,
      });

      expect(result.installed).toBeGreaterThan(0);
      expect(result.errors).toEqual([]);

      // Agent installed path should be a symlink
      const claudeAgentPath = path.join(
        config.targets.claude.agentsHome,
        "a1.md",
      );
      const agentStat = await lstat(claudeAgentPath);
      expect(agentStat.isSymbolicLink()).toBe(true);

      // Skill installed path should be a symlink
      const claudeSkillPath = path.join(config.targets.claude.skillsHome, "s1");
      const skillStat = await lstat(claudeSkillPath);
      expect(skillStat.isSymbolicLink()).toBe(true);
    },
  );

  it.skipIf(!isWindows && symlinkAvailable)(
    "windows symlink fallback copies when symlinks fail",
    async () => {
      const config = makeResolvedConfig(tempDir, {
        claude: { installMode: "symlink" },
        codex: { installMode: "symlink" },
        platform: { windowsSymlinkFallback: "copy" },
      });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      await createSkillFixture(config.library.skillsDir, "s1");
      await createAgentFixture(
        config.library.agentsDir,
        "a1",
        makeAgentYaml("a1"),
      );

      const result = await sync(config, {
        dryRun: false,
        force: false,
        strict: false,
      });

      expect(result.installed).toBeGreaterThan(0);
      expect(result.errors).toEqual([]);

      // Files should exist (installed via copy fallback) but not be symlinks
      const claudeAgentPath = path.join(
        config.targets.claude.agentsHome,
        "a1.md",
      );
      expect(await pathExists(claudeAgentPath)).toBe(true);
      const stat = await lstat(claudeAgentPath);
      expect(stat.isSymbolicLink()).toBe(false);
    },
  );

  it("collects errors without throwing when an action fails", async () => {
    const config = makeResolvedConfig(tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, "s1");
    await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    // Make the claude agents home a file instead of a directory so mkdir fails
    await mkdir(path.dirname(config.targets.claude.agentsHome), {
      recursive: true,
    });
    await writeFile(config.targets.claude.agentsHome, "blocker", "utf-8");

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
    });

    expect(result.errors.length).toBeGreaterThan(0);
  });
});
