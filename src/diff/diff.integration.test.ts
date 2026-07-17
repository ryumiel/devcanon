import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import type { ResolvedConfig } from "../config/schema.js";
import { renderAll } from "../render/pipeline.js";
import { diffAll } from "./diff.js";

const symlinkAvailable = await canCreateSymlinks();

describe("diffAll integration", () => {
  let tempDir: string;
  let config: ResolvedConfig;
  let restoreLogger: () => void;

  beforeEach(async () => {
    tempDir = await createTempDir();
    config = makeResolvedConfig(tempDir);
    const { restore } = installTestLogger();
    restoreLogger = restore;

    // Ensure required directories exist
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await mkdir(config.library.generatedDir, { recursive: true });
    await mkdir(config.targets.claude.agentsHome, { recursive: true });
    await mkdir(config.targets.claude.skillsHome, { recursive: true });
    await mkdir(config.targets.codex.agentsHome, { recursive: true });
    await mkdir(config.targets.codex.skillsHome, { recursive: true });
  });

  afterEach(async () => {
    restoreLogger();
    await cleanupTempDir(tempDir);
  });

  it("reports agent as added when not yet installed", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "test-agent",
      makeAgentYaml("test-agent", { description: "A test agent" }),
    );

    const results = await diffAll(config);

    const agentResults = results.filter(
      (r) => r.type === "agent" && r.name === "test-agent",
    );
    expect(agentResults.length).toBeGreaterThanOrEqual(1);
    for (const result of agentResults) {
      expect(result.status).toBe("added");
      expect(result.diff).toBeNull();
    }
  });

  it("reports agent as up-to-date when installed content matches", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "test-agent",
      makeAgentYaml("test-agent", { description: "A test agent" }),
    );

    // Render to get expected content
    const { outputs } = await renderAll(config, false);
    const claudeAgent = outputs.find(
      (o) =>
        o.target === "claude" && o.type === "agent" && o.name === "test-agent",
    );
    expect(claudeAgent).toBeDefined();
    if (!claudeAgent || claudeAgent.type !== "agent") {
      throw new Error(
        "internal: expected rendered claude agent for 'test-agent'",
      );
    }

    // Write rendered content to installed path
    const installedPath = claudeAgent.installedPath;
    const content = claudeAgent.content;
    await mkdir(path.dirname(installedPath), { recursive: true });
    await writeFile(installedPath, content, "utf-8");

    const results = await diffAll(config, "claude");

    const result = results.find(
      (r) =>
        r.target === "claude" && r.type === "agent" && r.name === "test-agent",
    );
    expect(result).toBeDefined();
    expect(result?.status).toBe("up-to-date");
    expect(result?.diff).toBeNull();
  });

  it("reports agent as changed with unified diff when installed content differs", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "test-agent",
      makeAgentYaml("test-agent", { description: "A test agent" }),
    );

    // Render to get expected content
    const { outputs } = await renderAll(config, false);
    const claudeAgent = outputs.find(
      (o) =>
        o.target === "claude" && o.type === "agent" && o.name === "test-agent",
    );
    expect(claudeAgent).toBeDefined();

    // Write different content to installed path
    const installedPath = claudeAgent?.installedPath as string;
    await mkdir(path.dirname(installedPath), { recursive: true });
    await writeFile(
      installedPath,
      "<!-- old content -->\nThis is outdated.\n",
      "utf-8",
    );

    const results = await diffAll(config, "claude");

    const result = results.find(
      (r) =>
        r.target === "claude" && r.type === "agent" && r.name === "test-agent",
    );
    expect(result).toBeDefined();
    expect(result?.status).toBe("changed");
    expect(result?.diff).toContain("---");
    expect(result?.diff).toContain("+++");
  });

  it("reports skill as added when not yet installed", async () => {
    await createSkillFixture(config.library.skillsDir, "test-skill");

    const results = await diffAll(config);

    const skillResults = results.filter(
      (r) => r.type === "skill" && r.name === "test-skill",
    );
    expect(skillResults.length).toBeGreaterThanOrEqual(1);
    for (const result of skillResults) {
      expect(result.status).toBe("added");
    }
  });

  it("reports skill as up-to-date when hash matches manifest record", async () => {
    await createSkillFixture(config.library.skillsDir, "test-skill");

    // Render to get expected output with hash
    const { outputs } = await renderAll(config, false, false, "claude");
    const skillOutput = outputs.find(
      (o) =>
        o.target === "claude" && o.type === "skill" && o.name === "test-skill",
    );
    expect(skillOutput).toBeDefined();

    // Create installed skill directory (copy the source)
    const installedSkillDir = skillOutput?.installedPath as string;
    await mkdir(installedSkillDir, { recursive: true });
    await writeFile(
      path.join(installedSkillDir, "SKILL.md"),
      "# test-skill\n\nA test skill.\n",
      "utf-8",
    );

    // Write manifest with matching hash
    const manifestDir = path.dirname(config.manifest.path);
    await mkdir(manifestDir, { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "skill",
            sourcePath: skillOutput?.sourcePath as string,
            generatedPath: null,
            installedPath: installedSkillDir,
            installMode: "copy",
            contentHash: skillOutput?.contentHash as string,
            timestamp: new Date().toISOString(),
          },
        ],
        { config },
      ),
      "utf-8",
    );

    const results = await diffAll(config, "claude");

    const result = results.find(
      (r) =>
        r.target === "claude" && r.type === "skill" && r.name === "test-skill",
    );
    expect(result).toBeDefined();
    expect(result?.status).toBe("up-to-date");
    expect(result?.diff).toBeNull();
  });

  it("reports skill as changed when hash differs from manifest record", async () => {
    await createSkillFixture(config.library.skillsDir, "test-skill");

    // Render to get expected output
    const { outputs } = await renderAll(config, false, false, "claude");
    const skillOutput = outputs.find(
      (o) =>
        o.target === "claude" && o.type === "skill" && o.name === "test-skill",
    );
    expect(skillOutput).toBeDefined();

    // Create installed skill directory
    const installedSkillDir = skillOutput?.installedPath as string;
    await mkdir(installedSkillDir, { recursive: true });
    await writeFile(
      path.join(installedSkillDir, "SKILL.md"),
      "# test-skill\n\nA test skill.\n",
      "utf-8",
    );

    // Write manifest with a DIFFERENT hash
    const manifestDir = path.dirname(config.manifest.path);
    await mkdir(manifestDir, { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "skill",
            sourcePath: skillOutput?.sourcePath as string,
            generatedPath: null,
            installedPath: installedSkillDir,
            installMode: "copy",
            contentHash: "stale-hash-does-not-match",
            timestamp: new Date().toISOString(),
          },
        ],
        { config },
      ),
      "utf-8",
    );

    const results = await diffAll(config, "claude");

    const result = results.find(
      (r) =>
        r.target === "claude" && r.type === "skill" && r.name === "test-skill",
    );
    expect(result).toBeDefined();
    expect(result?.status).toBe("changed");
    expect(result?.diff).toBe("Skill directory content has changed.");
  });

  it("reports skill as unmanaged-conflict when installed but not in manifest", async () => {
    await createSkillFixture(config.library.skillsDir, "test-skill");

    // Render to get expected output
    const { outputs } = await renderAll(config, false, false, "claude");
    const skillOutput = outputs.find(
      (o) =>
        o.target === "claude" && o.type === "skill" && o.name === "test-skill",
    );
    expect(skillOutput).toBeDefined();

    // Create installed skill directory but NO manifest record
    const installedSkillDir = skillOutput?.installedPath as string;
    await mkdir(installedSkillDir, { recursive: true });
    await writeFile(
      path.join(installedSkillDir, "SKILL.md"),
      "# test-skill\n\nA test skill.\n",
      "utf-8",
    );

    // Write empty manifest (no records)
    const manifestDir = path.dirname(config.manifest.path);
    await mkdir(manifestDir, { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson([], { config }),
      "utf-8",
    );

    const results = await diffAll(config, "claude");

    const result = results.find(
      (r) =>
        r.target === "claude" && r.type === "skill" && r.name === "test-skill",
    );
    expect(result).toBeDefined();
    expect(result?.status).toBe("unmanaged-conflict");
  });

  it("reports removed when manifest has record for source that no longer exists", async () => {
    // Write manifest with a record for a non-existent source
    const manifestDir = path.dirname(config.manifest.path);
    await mkdir(manifestDir, { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            sourcePath: "/src/agents/deleted.yaml",
            generatedPath: "/gen/claude/agents/deleted.md",
            installedPath: path.join(
              config.targets.claude.agentsHome,
              "deleted.md",
            ),
            installMode: "copy",
            contentHash: "old-hash",
            timestamp: new Date().toISOString(),
          },
        ],
        { config },
      ),
      "utf-8",
    );

    const results = await diffAll(config, "claude");

    const result = results.find((r) => r.name === "deleted");
    expect(result).toBeDefined();
    expect(result?.status).toBe("removed");
    expect(result?.diff).toBeNull();
  });

  it("target filter limits results to matching target only", async () => {
    await createSkillFixture(config.library.skillsDir, "test-skill");
    await createAgentFixture(
      config.library.agentsDir,
      "test-agent",
      makeAgentYaml("test-agent", { description: "A test agent" }),
    );

    const claudeResults = await diffAll(config, "claude");
    const codexResults = await diffAll(config, "codex");

    // All claude results should be target "claude"
    for (const r of claudeResults) {
      expect(r.target).toBe("claude");
    }
    // All codex results should be target "codex"
    for (const r of codexResults) {
      expect(r.target).toBe("codex");
    }

    // Both should have results
    expect(claudeResults.length).toBeGreaterThan(0);
    expect(codexResults.length).toBeGreaterThan(0);
  });

  it.skipIf(!symlinkAvailable)(
    "treats broken symlink at installed path as added",
    async () => {
      await createAgentFixture(
        config.library.agentsDir,
        "test-agent",
        makeAgentYaml("test-agent", { description: "A test agent" }),
      );

      // Render to get installed path
      const { outputs } = await renderAll(config, false, false, "claude");
      const claudeAgent = outputs.find(
        (o) =>
          o.target === "claude" &&
          o.type === "agent" &&
          o.name === "test-agent",
      );
      expect(claudeAgent).toBeDefined();

      // Create a broken symlink at the installed path
      const installedPath = claudeAgent?.installedPath as string;
      const brokenTarget = path.join(tempDir, "nonexistent-target.md");
      await mkdir(path.dirname(installedPath), { recursive: true });
      await symlink(brokenTarget, installedPath);

      // A dangling installed-path symlink should be treated as a missing
      // file and reported as "added" consistently across platforms.
      const results = await diffAll(config, "claude");
      const result = results.find(
        (r) =>
          r.target === "claude" &&
          r.type === "agent" &&
          r.name === "test-agent",
      );
      expect(result).toBeDefined();
      expect(result?.status).toBe("added");
    },
  );

  it("reports bound foreign records before rendering a diff", async () => {
    const foreignPath = path.join(tempDir, "foreign", "sentinel.md");
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
            installedPath: foreignPath,
            installMode: "copy",
            contentHash: "foreign",
            timestamp: new Date().toISOString(),
          },
        ],
        { config },
      ),
      "utf-8",
    );

    await expect(diffAll(config)).rejects.toThrow(
      "Bound manifest contains foreign records",
    );
  });
});
