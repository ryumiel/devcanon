import {
  lstat,
  mkdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canCreateSymlinks,
  cleanupTempDir,
  createAgentFixture,
  createSkillFixture,
  createTempDir,
  makeAgentYaml,
  makeManifestJson,
  makeResolvedConfig,
} from "../__test-helpers__/fixtures.js";
import { installTestLogger } from "../__test-helpers__/logger.js";
import { pathExists, readTextFile } from "../utils/fs.js";
import { sync } from "./sync.js";
import { uninstall } from "./uninstall.js";

const symlinkFailure = vi.hoisted(() => ({ enabled: false }));
vi.mock("./symlink.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./symlink.js")>();
  return {
    ...actual,
    createSymlink: async (...args: Parameters<typeof actual.createSymlink>) => {
      if (symlinkFailure.enabled) {
        const error = new Error(
          "forced symlink failure",
        ) as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }

      return actual.createSymlink(...args);
    },
  };
});

const symlinkAvailable = await canCreateSymlinks();

describe("sync", () => {
  let tempDir: string;
  let restoreLogger: () => void;

  beforeEach(async () => {
    tempDir = await createTempDir();
    const { restore } = installTestLogger();
    restoreLogger = restore;
  });

  afterEach(async () => {
    symlinkFailure.enabled = false;
    restoreLogger();
    await cleanupTempDir(tempDir);
  });

  it("fresh sync installs skills and agents via copy", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
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

  it("skips copy-mode update when installed agent content no longer matches the manifest", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    const agentPath = await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    const opts = { dryRun: false, force: false, strict: false } as const;
    await sync(config, opts);

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
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    const agentPath = await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    const opts = { dryRun: false, force: false, strict: false } as const;
    await sync(config, opts);

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
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
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
    await sync(config, opts);

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
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    const skillDir = await createSkillFixture(
      config.library.skillsDir,
      "skill-a",
      "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n",
    );

    const opts = { dryRun: false, force: false, strict: false } as const;
    await sync(config, opts);

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

  it.skipIf(!symlinkAvailable)(
    "skips symlink-mode update when the installed symlink points elsewhere",
    async () => {
      const config = makeResolvedConfig(tempDir, {
        claude: { installMode: "symlink" },
        codex: { enabled: false },
        defaults: { installMode: "symlink" },
      });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      const agentPath = await createAgentFixture(
        config.library.agentsDir,
        "a1",
        makeAgentYaml("a1"),
      );

      const opts = { dryRun: false, force: false, strict: false } as const;
      await sync(config, opts);

      const claudeAgentPath = path.join(
        config.targets.claude.agentsHome,
        "a1.md",
      );
      await rm(claudeAgentPath);
      const foreignTarget = path.join(tempDir, "outside", "foreign.md");
      await mkdir(path.dirname(foreignTarget), { recursive: true });
      await writeFile(foreignTarget, "foreign", "utf-8");
      await symlink(foreignTarget, claudeAgentPath, "file");
      const manifestBefore = JSON.parse(
        await readTextFile(config.manifest.path),
      );

      await writeFile(
        agentPath,
        makeAgentYaml("a1", { instructions: "Updated instructions v2" }),
        "utf-8",
      );

      const result = await sync(config, opts);

      expect(result.updated).toBe(0);
      expect(result.errors).toEqual([
        expect.stringContaining("symlink target mismatch"),
      ]);
      expect(await readlink(claudeAgentPath)).toBe(foreignTarget);
      const manifestAfter = JSON.parse(
        await readTextFile(config.manifest.path),
      );
      expect(manifestAfter.records).toEqual(manifestBefore.records);
    },
  );

  it("skips stale copy removal when installed content no longer matches the manifest", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    const agentPath = await createAgentFixture(
      config.library.agentsDir,
      "stale",
      makeAgentYaml("stale"),
    );

    const opts = { dryRun: false, force: false, strict: false } as const;
    await sync(config, opts);

    const claudeAgentPath = path.join(
      config.targets.claude.agentsHome,
      "stale.md",
    );
    await writeFile(claudeAgentPath, "tampered stale content", "utf-8");
    const manifestBefore = JSON.parse(await readTextFile(config.manifest.path));
    await rm(agentPath);

    const result = await sync(config, opts);

    expect(result.removed).toBe(0);
    expect(result.errors).toEqual([
      expect.stringContaining("installed copy content hash mismatch"),
    ]);
    expect(await readTextFile(claudeAgentPath)).toBe("tampered stale content");
    const manifestAfter = JSON.parse(await readTextFile(config.manifest.path));
    expect(manifestAfter.records).toEqual(manifestBefore.records);
  });

  it.skipIf(!symlinkAvailable)(
    "skips stale symlink removal when the installed symlink points elsewhere",
    async () => {
      const config = makeResolvedConfig(tempDir, {
        claude: { installMode: "symlink" },
        codex: { enabled: false },
        defaults: { installMode: "symlink" },
      });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      const agentPath = await createAgentFixture(
        config.library.agentsDir,
        "stale",
        makeAgentYaml("stale"),
      );

      const opts = { dryRun: false, force: false, strict: false } as const;
      await sync(config, opts);

      const claudeAgentPath = path.join(
        config.targets.claude.agentsHome,
        "stale.md",
      );
      await rm(claudeAgentPath);
      const foreignTarget = path.join(tempDir, "outside", "foreign.md");
      await mkdir(path.dirname(foreignTarget), { recursive: true });
      await writeFile(foreignTarget, "foreign", "utf-8");
      await symlink(foreignTarget, claudeAgentPath, "file");
      const manifestBefore = JSON.parse(
        await readTextFile(config.manifest.path),
      );
      await rm(agentPath);

      const result = await sync(config, opts);

      expect(result.removed).toBe(0);
      expect(result.errors).toEqual([
        expect.stringContaining("symlink target mismatch"),
      ]);
      expect(await readlink(claudeAgentPath)).toBe(foreignTarget);
      const manifestAfter = JSON.parse(
        await readTextFile(config.manifest.path),
      );
      expect(manifestAfter.records).toEqual(manifestBefore.records);
    },
  );

  it("skips managed update when manifest identity fields do not match the rendered output", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    const agentPath = await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    const opts = { dryRun: false, force: false, strict: false } as const;
    await sync(config, opts);
    const manifest = JSON.parse(await readTextFile(config.manifest.path));
    const claudeRecord = manifest.records.find(
      (record: { installedPath: string }) =>
        record.installedPath ===
        path.join(config.targets.claude.agentsHome, "a1.md"),
    );
    claudeRecord.sourcePath = path.join(config.library.agentsDir, "wrong.yaml");
    await writeFile(
      config.manifest.path,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf-8",
    );
    const manifestBefore = JSON.parse(await readTextFile(config.manifest.path));

    await writeFile(
      agentPath,
      makeAgentYaml("a1", { instructions: "Updated instructions v2" }),
      "utf-8",
    );

    const result = await sync(config, opts);

    expect(result.updated).toBe(0);
    expect(result.errors).toEqual([
      expect.stringContaining("manifest source path mismatch"),
    ]);
    const manifestAfter = JSON.parse(await readTextFile(config.manifest.path));
    expect(manifestAfter.records).toEqual(manifestBefore.records);
  });

  it("skips stale removal when the manifest installed path is outside the target home", async () => {
    const config = makeResolvedConfig(tempDir);
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    const outsidePath = path.join(tempDir, "outside", "sentinel.md");
    await mkdir(path.dirname(outsidePath), { recursive: true });
    await writeFile(outsidePath, "sentinel", "utf-8");
    await writeFile(
      config.manifest.path,
      makeManifestJson([
        {
          target: "claude",
          type: "agent",
          sourcePath: path.join(config.library.agentsDir, "sentinel.yaml"),
          generatedPath: path.join(
            config.library.generatedDir,
            "claude",
            "agents",
            "sentinel.md",
          ),
          installedPath: outsidePath,
          installMode: "copy",
          contentHash: "wrong-hash",
          timestamp: new Date().toISOString(),
        },
      ]),
      "utf-8",
    );
    const manifestBefore = JSON.parse(await readTextFile(config.manifest.path));

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
    });

    expect(result.removed).toBe(0);
    expect(result.errors).toEqual([
      expect.stringContaining("outside configured claude agent home"),
    ]);
    expect(await readTextFile(outsidePath)).toBe("sentinel");
    const manifestAfter = JSON.parse(await readTextFile(config.manifest.path));
    expect(manifestAfter.records).toEqual(manifestBefore.records);
  });

  it.skipIf(!symlinkAvailable)(
    "skips stale removal when an installed path crosses a symlinked parent",
    async () => {
      const config = makeResolvedConfig(tempDir);
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      const outsideDir = path.join(tempDir, "outside");
      const linkParent = path.join(config.targets.claude.agentsHome, "alias");
      const installedPath = path.join(linkParent, "sentinel.md");
      await mkdir(config.targets.claude.agentsHome, { recursive: true });
      await mkdir(outsideDir, { recursive: true });
      await symlink(outsideDir, linkParent, "dir");
      await writeFile(
        path.join(outsideDir, "sentinel.md"),
        "sentinel",
        "utf-8",
      );
      await writeFile(
        config.manifest.path,
        makeManifestJson([
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "sentinel.yaml"),
            generatedPath: path.join(
              config.library.generatedDir,
              "claude",
              "agents",
              "sentinel.md",
            ),
            installedPath,
            installMode: "copy",
            contentHash: "wrong-hash",
            timestamp: new Date().toISOString(),
          },
        ]),
        "utf-8",
      );
      const manifestBefore = JSON.parse(
        await readTextFile(config.manifest.path),
      );

      const result = await sync(config, {
        dryRun: false,
        force: false,
        strict: false,
      });

      expect(result.removed).toBe(0);
      expect(result.errors).toEqual([
        expect.stringContaining("crosses symlinked parent component"),
      ]);
      expect(await readTextFile(path.join(outsideDir, "sentinel.md"))).toBe(
        "sentinel",
      );
      const manifestAfter = JSON.parse(
        await readTextFile(config.manifest.path),
      );
      expect(manifestAfter.records).toEqual(manifestBefore.records);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "skips stale removal when the configured target home is a symlink",
    async () => {
      const realHome = path.join(tempDir, "outside-home");
      const linkedHome = path.join(tempDir, "linked-home");
      const config = makeResolvedConfig(tempDir, {
        claude: { agentsHome: linkedHome },
      });
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await mkdir(realHome, { recursive: true });
      await symlink(realHome, linkedHome, "dir");
      const installedPath = path.join(linkedHome, "sentinel.md");
      const realInstalledPath = path.join(realHome, "sentinel.md");
      await writeFile(realInstalledPath, "sentinel", "utf-8");
      await writeFile(
        config.manifest.path,
        makeManifestJson([
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "sentinel.yaml"),
            generatedPath: path.join(
              config.library.generatedDir,
              "claude",
              "agents",
              "sentinel.md",
            ),
            installedPath,
            installMode: "copy",
            contentHash: "wrong-hash",
            timestamp: new Date().toISOString(),
          },
        ]),
        "utf-8",
      );
      const manifestBefore = JSON.parse(
        await readTextFile(config.manifest.path),
      );

      const result = await sync(config, {
        dryRun: false,
        force: false,
        strict: false,
      });

      expect(result.removed).toBe(0);
      expect(result.errors).toEqual([
        expect.stringContaining("configured claude agent home is a symlink"),
      ]);
      expect(await readTextFile(realInstalledPath)).toBe("sentinel");
      const manifestAfter = JSON.parse(
        await readTextFile(config.manifest.path),
      );
      expect(manifestAfter.records).toEqual(manifestBefore.records);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "skips stale removal when the configured target home crosses a symlinked ancestor",
    async () => {
      const realParent = path.join(tempDir, "outside-parent");
      const linkedParent = path.join(tempDir, "linked-parent");
      const agentsHome = path.join(linkedParent, "agents");
      const config = makeResolvedConfig(tempDir, {
        claude: { agentsHome },
      });
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await mkdir(path.join(realParent, "agents"), { recursive: true });
      await symlink(realParent, linkedParent, "dir");
      const installedPath = path.join(agentsHome, "sentinel.md");
      const realInstalledPath = path.join(realParent, "agents", "sentinel.md");
      await writeFile(realInstalledPath, "sentinel", "utf-8");
      await writeFile(
        config.manifest.path,
        makeManifestJson([
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "sentinel.yaml"),
            generatedPath: path.join(
              config.library.generatedDir,
              "claude",
              "agents",
              "sentinel.md",
            ),
            installedPath,
            installMode: "copy",
            contentHash: "wrong-hash",
            timestamp: new Date().toISOString(),
          },
        ]),
        "utf-8",
      );
      const manifestBefore = JSON.parse(
        await readTextFile(config.manifest.path),
      );

      const result = await sync(config, {
        dryRun: false,
        force: false,
        strict: false,
      });

      expect(result.removed).toBe(0);
      expect(result.errors).toEqual([
        expect.stringContaining("crosses symlinked ancestor"),
      ]);
      expect(await readTextFile(realInstalledPath)).toBe("sentinel");
      const manifestAfter = JSON.parse(
        await readTextFile(config.manifest.path),
      );
      expect(manifestAfter.records).toEqual(manifestBefore.records);
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

  it("windows symlink fallback copies when symlinks fail", async () => {
    symlinkFailure.enabled = true;

    const config = makeResolvedConfig(tempDir, {
      claude: { installMode: "symlink" },
      codex: { enabled: false },
      platform: { windowsSymlinkFallback: "copy" },
    });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
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

    const manifest = JSON.parse(await readTextFile(config.manifest.path));
    const claudeAgentRecord = manifest.records.find(
      (record: { installedPath: string }) =>
        record.installedPath === claudeAgentPath,
    );
    expect(claudeAgentRecord.installMode).toBe("copy");

    await writeFile(claudeAgentPath, "tampered fallback copy", "utf-8");
    symlinkFailure.enabled = false;
    const manifestBefore = JSON.parse(await readTextFile(config.manifest.path));

    const uninstallResult = await uninstall(config, {
      target: "claude",
      dryRun: false,
    });

    expect(uninstallResult.removed).toBe(0);
    expect(uninstallResult.errors).toEqual([
      expect.stringContaining("installed copy content hash mismatch"),
    ]);
    expect(await readTextFile(claudeAgentPath)).toBe("tampered fallback copy");
    let manifestAfter = JSON.parse(await readTextFile(config.manifest.path));
    expect(manifestAfter.records).toEqual(manifestBefore.records);

    await writeFile(
      path.join(config.library.agentsDir, "a1.yaml"),
      makeAgentYaml("a1", { instructions: "Updated instructions v2" }),
      "utf-8",
    );

    const second = await sync(config, {
      target: "claude",
      dryRun: false,
      force: false,
      strict: false,
    });

    expect(second.updated).toBe(0);
    expect(second.errors).toEqual([
      expect.stringContaining("manifest install mode mismatch"),
    ]);
    expect(await readTextFile(claudeAgentPath)).toBe("tampered fallback copy");
    manifestAfter = JSON.parse(await readTextFile(config.manifest.path));
    expect(manifestAfter.records).toEqual(manifestBefore.records);
  });

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
