import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
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
import { withManifestPersistenceFaultsForTesting } from "../install/manifest.js";
import type { RenderedAgent } from "../models/types.js";
import { renderAll } from "../render/pipeline.js";
import { sha256 } from "../utils/hash.js";
import { diffAll } from "./diff.js";

const symlinkAvailable = await canCreateSymlinks();
const execFileAsync = promisify(execFile);

async function canCreateFifo(): Promise<boolean> {
  if (process.platform === "win32") return false;
  const dir = await createTempDir();
  try {
    await execFileAsync("mkfifo", [path.join(dir, "probe")]);
    return true;
  } catch {
    return false;
  } finally {
    await cleanupTempDir(dir);
  }
}

const fifoAvailable = await canCreateFifo();

type TreeInventoryEntry = {
  path: string;
  kind: "directory" | "file" | "symlink" | "fifo" | "other";
  mode: number;
  size: number;
  bytes?: string;
  unreadable?: true;
  target?: string;
};

async function captureTreeInventory(
  root: string,
): Promise<TreeInventoryEntry[]> {
  const entries: TreeInventoryEntry[] = [];
  async function visit(current: string, relative: string): Promise<void> {
    let stat: Awaited<ReturnType<typeof lstat>>;
    try {
      stat = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const kind = stat.isDirectory()
      ? "directory"
      : stat.isFile()
        ? "file"
        : stat.isSymbolicLink()
          ? "symlink"
          : stat.isFIFO()
            ? "fifo"
            : "other";
    const fileEvidence =
      kind === "file"
        ? await readFile(current).then(
            (bytes) => ({ bytes: bytes.toString("base64") }),
            () => ({ unreadable: true as const }),
          )
        : {};
    entries.push({
      path: relative || ".",
      kind,
      mode: stat.mode & 0o777,
      size: stat.size,
      ...fileEvidence,
      ...(kind === "symlink" ? { target: await readlink(current) } : {}),
    });
    if (kind !== "directory") return;
    for (const child of (await readdir(current)).sort()) {
      await visit(path.join(current, child), path.join(relative, child));
    }
  }
  await visit(root, "");
  return entries;
}

async function canEnforceUnreadableFile(): Promise<boolean> {
  if (process.platform === "win32" || process.getuid?.() === 0) return false;
  const dir = await createTempDir();
  const file = path.join(dir, "unreadable");
  try {
    await writeFile(file, "probe", "utf-8");
    await chmod(file, 0o000);
    try {
      await readFile(file);
      return false;
    } catch {
      return true;
    }
  } finally {
    await chmod(file, 0o600).catch(() => {});
    await cleanupTempDir(dir);
  }
}

const unreadableFileEnforced = await canEnforceUnreadableFile();

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

  async function writeAgentManifest(
    agent: RenderedAgent,
    overrides: Record<string, unknown> = {},
  ) {
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: agent.target,
            type: agent.type,
            name: agent.name,
            sourcePath: agent.sourcePath,
            generatedPath: agent.generatedPath,
            installedPath: agent.installedPath,
            installMode: "copy",
            contentHash: agent.contentHash,
            timestamp: new Date().toISOString(),
            ...overrides,
          },
        ],
        { config },
      ),
      "utf-8",
    );
  }

  async function writeNonmatchingAgentManifest() {
    const name = "other-agent";
    const content = "<!-- stale other-agent render -->\n";
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            name,
            sourcePath: path.join(config.library.agentsDir, `${name}.yaml`),
            generatedPath: path.join(
              config.library.generatedDir,
              "claude",
              "agents",
              `${name}.md`,
            ),
            installedPath: path.join(
              config.targets.claude.agentsHome,
              `${name}.md`,
            ),
            installMode: "copy",
            contentHash: sha256(content),
            timestamp: new Date().toISOString(),
          },
        ],
        { config },
      ),
      "utf-8",
    );
  }

  async function createPureConsumerSentinels() {
    const name = "pure-consumer";
    await createAgentFixture(
      config.library.agentsDir,
      name,
      makeAgentYaml(name),
    );
    await writeFile(
      path.join(config.library.agentsDir, "render-order-tripwire.yaml"),
      "name: [unterminated",
      "utf-8",
    );
    const generatedPath = path.join(
      config.library.generatedDir,
      "claude",
      "agents",
      `${name}.md`,
    );
    const installedPath = path.join(
      config.targets.claude.agentsHome,
      `${name}.md`,
    );
    await mkdir(path.dirname(generatedPath), { recursive: true });
    await mkdir(path.dirname(installedPath), { recursive: true });
    await writeFile(generatedPath, "generated sentinel", "utf-8");
    await writeFile(installedPath, "installed sentinel", "utf-8");
    const generatedSecondaryPath = path.join(
      config.library.generatedDir,
      "codex",
      "skills",
      "secondary.txt",
    );
    const installedSecondaryPath = path.join(
      config.targets.codex.skillsHome,
      "secondary.txt",
    );
    await mkdir(path.dirname(generatedSecondaryPath), { recursive: true });
    await mkdir(path.dirname(installedSecondaryPath), { recursive: true });
    await writeFile(generatedSecondaryPath, "generated secondary", "utf-8");
    await writeFile(installedSecondaryPath, "installed secondary", "utf-8");
    return {
      generatedPath,
      installedPath,
      generatedRoot: config.library.generatedDir,
      installedRoot: path.join(tempDir, "home"),
      generatedTree: await captureTreeInventory(config.library.generatedDir),
      installedTree: await captureTreeInventory(path.join(tempDir, "home")),
    };
  }

  async function manifestSiblingInventory(): Promise<string[]> {
    const parent = path.dirname(config.manifest.path);
    await mkdir(parent, { recursive: true });
    const basename = path.basename(config.manifest.path);
    return (await readdir(parent))
      .filter((entry) => entry.startsWith(basename))
      .sort();
  }

  async function manifestArtifactTree(): Promise<TreeInventoryEntry[]> {
    const parent = path.dirname(config.manifest.path);
    await mkdir(parent, { recursive: true });
    const basename = path.basename(config.manifest.path);
    const entries: TreeInventoryEntry[] = [];
    for (const entry of (await readdir(parent))
      .filter((name) => name.startsWith(basename))
      .sort()) {
      for (const item of await captureTreeInventory(path.join(parent, entry))) {
        entries.push({
          ...item,
          path: item.path === "." ? entry : path.join(entry, item.path),
        });
      }
    }
    return entries;
  }

  async function expectPureConsumerTreesUnchanged(
    sentinels: Awaited<ReturnType<typeof createPureConsumerSentinels>>,
  ): Promise<void> {
    expect(await captureTreeInventory(sentinels.generatedRoot)).toEqual(
      sentinels.generatedTree,
    );
    expect(await captureTreeInventory(sentinels.installedRoot)).toEqual(
      sentinels.installedTree,
    );
  }

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
    await writeAgentManifest(claudeAgent);

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
    if (!claudeAgent || claudeAgent.type !== "agent") {
      throw new Error(
        "internal: expected rendered claude agent for 'test-agent'",
      );
    }

    // Write different content to installed path
    const installedPath = claudeAgent.installedPath;
    await mkdir(path.dirname(installedPath), { recursive: true });
    await writeFile(
      installedPath,
      "<!-- old content -->\nThis is outdated.\n",
      "utf-8",
    );
    await writeAgentManifest(claudeAgent);

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

  it("keeps an exact agent record managed when source and generated paths drift", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "test-agent",
      makeAgentYaml("test-agent", { description: "A test agent" }),
    );

    const { outputs } = await renderAll(config, false, false, "claude");
    const claudeAgent = outputs.find(
      (output) =>
        output.target === "claude" &&
        output.type === "agent" &&
        output.name === "test-agent",
    );
    expect(claudeAgent).toBeDefined();
    if (!claudeAgent || claudeAgent.type !== "agent") {
      throw new Error(
        "internal: expected rendered claude agent for 'test-agent'",
      );
    }

    await writeFile(claudeAgent.installedPath, claudeAgent.content, "utf-8");
    await writeAgentManifest(claudeAgent, {
      sourcePath: path.join(tempDir, "stale", "test-agent.yaml"),
      generatedPath: path.join(tempDir, "stale", "test-agent.md"),
    });

    const results = await diffAll(config, "claude");

    const result = results.find(
      (entry) =>
        entry.target === "claude" &&
        entry.type === "agent" &&
        entry.name === "test-agent",
    );
    expect(result).toBeDefined();
    expect(result?.status).toBe("up-to-date");
    expect(result?.diff).toBeNull();
  });

  it("reports an agent with an exact record as added when the installed file is missing", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "test-agent",
      makeAgentYaml("test-agent", { description: "A test agent" }),
    );

    const { outputs } = await renderAll(config, false, false, "claude");
    const claudeAgent = outputs.find(
      (output) =>
        output.target === "claude" &&
        output.type === "agent" &&
        output.name === "test-agent",
    );
    expect(claudeAgent).toBeDefined();
    if (!claudeAgent || claudeAgent.type !== "agent") {
      throw new Error(
        "internal: expected rendered claude agent for 'test-agent'",
      );
    }
    await writeAgentManifest(claudeAgent);

    const results = await diffAll(config, "claude");

    const result = results.find(
      (entry) =>
        entry.target === "claude" &&
        entry.type === "agent" &&
        entry.name === "test-agent",
    );
    expect(result).toBeDefined();
    expect(result?.status).toBe("added");
    expect(result?.diff).toBeNull();
  });

  it("reports matching agent content without an exact record as unmanaged-conflict", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "test-agent",
      makeAgentYaml("test-agent", { description: "A test agent" }),
    );

    const { outputs } = await renderAll(config, false, false, "claude");
    const claudeAgent = outputs.find(
      (output) =>
        output.target === "claude" &&
        output.type === "agent" &&
        output.name === "test-agent",
    );
    expect(claudeAgent).toBeDefined();
    if (!claudeAgent || claudeAgent.type !== "agent") {
      throw new Error(
        "internal: expected rendered claude agent for 'test-agent'",
      );
    }

    await writeFile(claudeAgent.installedPath, claudeAgent.content, "utf-8");
    await writeNonmatchingAgentManifest();

    const results = await diffAll(config, "claude");

    const result = results.find(
      (entry) =>
        entry.target === "claude" &&
        entry.type === "agent" &&
        entry.name === "test-agent",
    );
    expect(result).toBeDefined();
    expect(result?.status).toBe("unmanaged-conflict");
    expect(result?.diff).toBeNull();
    expect(results).toContainEqual({
      status: "removed",
      target: "claude",
      type: "agent",
      name: "other-agent",
      installedPath: path.join(
        config.targets.claude.agentsHome,
        "other-agent.md",
      ),
      diff: null,
    });
  });

  it("reports differing agent content without an exact record as unmanaged-conflict", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "test-agent",
      makeAgentYaml("test-agent", { description: "A test agent" }),
    );

    const { outputs } = await renderAll(config, false, false, "claude");
    const claudeAgent = outputs.find(
      (output) =>
        output.target === "claude" &&
        output.type === "agent" &&
        output.name === "test-agent",
    );
    expect(claudeAgent).toBeDefined();
    if (!claudeAgent || claudeAgent.type !== "agent") {
      throw new Error(
        "internal: expected rendered claude agent for 'test-agent'",
      );
    }

    await writeFile(
      claudeAgent.installedPath,
      "<!-- old content -->\nThis is unmanaged.\n",
      "utf-8",
    );
    await writeNonmatchingAgentManifest();

    const results = await diffAll(config, "claude");

    const result = results.find(
      (entry) =>
        entry.target === "claude" &&
        entry.type === "agent" &&
        entry.name === "test-agent",
    );
    expect(result).toBeDefined();
    expect(result?.status).toBe("unmanaged-conflict");
    expect(result?.diff).toBeNull();
    expect(results).toContainEqual({
      status: "removed",
      target: "claude",
      type: "agent",
      name: "other-agent",
      installedPath: path.join(
        config.targets.claude.agentsHome,
        "other-agent.md",
      ),
      diff: null,
    });
  });

  it("reports an unmanaged installed directory as a conflict without reading it", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "test-agent",
      makeAgentYaml("test-agent", { description: "A test agent" }),
    );

    const { outputs } = await renderAll(config, false, false, "claude");
    const claudeAgent = outputs.find(
      (output) =>
        output.target === "claude" &&
        output.type === "agent" &&
        output.name === "test-agent",
    );
    expect(claudeAgent).toBeDefined();
    if (!claudeAgent || claudeAgent.type !== "agent") {
      throw new Error(
        "internal: expected rendered claude agent for 'test-agent'",
      );
    }

    await mkdir(claudeAgent.installedPath);
    await writeNonmatchingAgentManifest();

    const results = await diffAll(config, "claude");

    const result = results.find(
      (entry) =>
        entry.target === "claude" &&
        entry.type === "agent" &&
        entry.name === "test-agent",
    );
    expect(result).toBeDefined();
    expect(result?.status).toBe("unmanaged-conflict");
    expect(result?.diff).toBeNull();
    expect(results).toContainEqual({
      status: "removed",
      target: "claude",
      type: "agent",
      name: "other-agent",
      installedPath: path.join(
        config.targets.claude.agentsHome,
        "other-agent.md",
      ),
      diff: null,
    });
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
      if (!claudeAgent || claudeAgent.type !== "agent") {
        throw new Error(
          "internal: expected rendered claude agent for 'test-agent'",
        );
      }
      await writeAgentManifest(claudeAgent);

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

  it.each(["json", "schema"] as const)(
    "fails on %s-invalid manifest bytes before diff results and without recovery",
    async (invalidKind) => {
      const sentinels = await createPureConsumerSentinels();
      const validBytes = makeManifestJson([], { config });
      const invalidBytes =
        invalidKind === "json"
          ? validBytes.slice(0, -1)
          : JSON.stringify(
              { ...JSON.parse(validBytes), version: 999 },
              null,
              2,
            );
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await writeFile(config.manifest.path, invalidBytes, "utf-8");
      const manifestTreeBefore = await manifestArtifactTree();
      const faultStages: string[] = [];
      let results: Awaited<ReturnType<typeof diffAll>> | undefined;
      let thrown: unknown;

      try {
        results = await withManifestPersistenceFaultsForTesting(
          (stage) => {
            faultStages.push(stage);
          },
          () => diffAll(config),
        );
      } catch (error) {
        thrown = error;
      }

      expect(results).toBeUndefined();
      expect(thrown).toMatchObject({
        message: expect.stringContaining(
          invalidKind === "json" ? "corrupt JSON" : "schema validation",
        ),
      });
      expect(faultStages).toEqual([]);
      expect(await readFile(config.manifest.path, "utf-8")).toBe(invalidBytes);
      expect(await manifestSiblingInventory()).toEqual([
        path.basename(config.manifest.path),
      ]);
      expect(await manifestArtifactTree()).toEqual(manifestTreeBefore);
      await expectPureConsumerTreesUnchanged(sentinels);
    },
  );

  it("binds invalid-manifest ordering to the real renderer input path", async () => {
    await createPureConsumerSentinels();
    await writeFile(
      config.manifest.path,
      makeManifestJson([], { config }),
      "utf-8",
    );

    await expect(diffAll(config)).rejects.toThrow("render-order-tripwire");
  });

  it.each(["regular", "directory"] as const)(
    "rejects an absent manifest with a %s sibling lock before render or recovery",
    async (lockKind) => {
      const sentinels = await createPureConsumerSentinels();
      const lockPath = `${config.manifest.path}.lock`;
      await mkdir(path.dirname(lockPath), { recursive: true });
      if (lockKind === "regular") {
        await writeFile(lockPath, "lock sentinel", "utf-8");
      } else {
        await mkdir(lockPath);
      }
      const manifestTreeBefore = await manifestArtifactTree();
      const faultStages: string[] = [];

      await expect(
        withManifestPersistenceFaultsForTesting(
          (stage) => {
            faultStages.push(stage);
          },
          () => diffAll(config),
        ),
      ).rejects.toThrow(lockPath);

      expect(faultStages).toEqual([]);
      expect(await manifestSiblingInventory()).toEqual([
        path.basename(lockPath),
      ]);
      if (lockKind === "regular") {
        expect(await readFile(lockPath, "utf-8")).toBe("lock sentinel");
      } else {
        expect((await lstat(lockPath)).isDirectory()).toBe(true);
      }
      expect(await manifestArtifactTree()).toEqual(manifestTreeBefore);
      await expectPureConsumerTreesUnchanged(sentinels);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "rejects an absent manifest with a symlink sibling lock without touching its target",
    async () => {
      const sentinels = await createPureConsumerSentinels();
      const lockPath = `${config.manifest.path}.lock`;
      const targetPath = path.join(tempDir, "lock-target");
      await writeFile(targetPath, "lock target sentinel", "utf-8");
      await symlink(targetPath, lockPath, "file");
      const manifestTreeBefore = await manifestArtifactTree();
      const faultStages: string[] = [];

      await expect(
        withManifestPersistenceFaultsForTesting(
          (stage) => {
            faultStages.push(stage);
          },
          () => diffAll(config),
        ),
      ).rejects.toThrow(lockPath);

      expect(faultStages).toEqual([]);
      expect((await lstat(lockPath)).isSymbolicLink()).toBe(true);
      expect(await readlink(lockPath)).toBe(targetPath);
      expect(await readFile(targetPath, "utf-8")).toBe("lock target sentinel");
      expect(await manifestSiblingInventory()).toEqual([
        path.basename(lockPath),
      ]);
      expect(await manifestArtifactTree()).toEqual(manifestTreeBefore);
      await expectPureConsumerTreesUnchanged(sentinels);
    },
  );

  it.skipIf(!fifoAvailable)(
    "rejects an absent manifest with a FIFO sibling lock without blocking or recovery",
    async () => {
      const sentinels = await createPureConsumerSentinels();
      const lockPath = `${config.manifest.path}.lock`;
      await execFileAsync("mkfifo", [lockPath]);
      const manifestTreeBefore = await manifestArtifactTree();
      const faultStages: string[] = [];

      await expect(
        withManifestPersistenceFaultsForTesting(
          (stage) => {
            faultStages.push(stage);
          },
          () => diffAll(config),
        ),
      ).rejects.toThrow(lockPath);

      expect(faultStages).toEqual([]);
      expect((await lstat(lockPath)).isFIFO()).toBe(true);
      expect(await manifestSiblingInventory()).toEqual([
        path.basename(lockPath),
      ]);
      expect(await manifestArtifactTree()).toEqual(manifestTreeBefore);
      await expectPureConsumerTreesUnchanged(sentinels);
    },
  );

  it.skipIf(!unreadableFileEnforced)(
    "rejects an absent manifest with an unreadable sibling lock without recovery",
    async () => {
      const sentinels = await createPureConsumerSentinels();
      const lockPath = `${config.manifest.path}.lock`;
      await writeFile(lockPath, "unreadable lock sentinel", "utf-8");
      await chmod(lockPath, 0o000);
      await expect(readFile(lockPath)).rejects.toBeDefined();
      const manifestTreeBefore = await manifestArtifactTree();
      const faultStages: string[] = [];

      try {
        await expect(
          withManifestPersistenceFaultsForTesting(
            (stage) => {
              faultStages.push(stage);
            },
            () => diffAll(config),
          ),
        ).rejects.toThrow(lockPath);

        expect(faultStages).toEqual([]);
        expect((await lstat(lockPath)).mode & 0o777).toBe(0);
        expect(await manifestSiblingInventory()).toEqual([
          path.basename(lockPath),
        ]);
        expect(await manifestArtifactTree()).toEqual(manifestTreeBefore);
        await expectPureConsumerTreesUnchanged(sentinels);
      } finally {
        await chmod(lockPath, 0o600);
      }
      expect(await readFile(lockPath, "utf-8")).toBe(
        "unreadable lock sentinel",
      );
    },
  );

  it.each(["absent", "valid"] as const)(
    "keeps %s manifest control distinct from invalid state",
    async (state) => {
      await createAgentFixture(
        config.library.agentsDir,
        "control-agent",
        makeAgentYaml("control-agent"),
      );
      const faultStages: string[] = [];
      if (state === "valid") {
        await mkdir(path.dirname(config.manifest.path), { recursive: true });
        await writeFile(
          config.manifest.path,
          makeManifestJson([], { config }),
          "utf-8",
        );
      }

      const results = await withManifestPersistenceFaultsForTesting(
        (stage) => {
          faultStages.push(stage);
        },
        () => diffAll(config, "claude"),
      );

      expect(results).toContainEqual(
        expect.objectContaining({
          target: "claude",
          type: "agent",
          name: "control-agent",
          status: "added",
        }),
      );
      expect(faultStages).toEqual([]);
      expect(await manifestSiblingInventory()).toEqual(
        state === "valid" ? [path.basename(config.manifest.path)] : [],
      );
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

    await expect(diffAll(config)).rejects.toMatchObject({
      message:
        "Bound manifest contains foreign records; automatic reconciliation is forbidden.",
      hint: "Restore matching configured homes or repair the manifest from a verified backup.",
    });
  });

  it("directs unbound mixed legacy foreign records to reconciliation before rendering", async () => {
    const ownedPath = path.join(config.targets.claude.agentsHome, "owned.md");
    const foreignPath = path.join(tempDir, "foreign", "sentinel.md");
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            sourcePath: "/source/owned.yaml",
            generatedPath: null,
            installedPath: ownedPath,
            installMode: "copy",
            contentHash: "owned",
            timestamp: new Date().toISOString(),
          },
          {
            target: "claude",
            type: "agent",
            sourcePath: "/source/sentinel.yaml",
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

    await expect(diffAll(config)).rejects.toMatchObject({
      message:
        "Legacy manifest contains foreign records; rerun sync with --reconcile-manifest.",
      hint: "Run sync --reconcile-manifest to safely reconcile the legacy manifest.",
    });
  });
});
