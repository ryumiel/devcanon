import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
import type { ResolvedConfig } from "../config/schema.js";
import type { RenderedAgent } from "../models/types.js";
import { UserError } from "../utils/errors.js";
import { pathExists } from "../utils/fs.js";
import { loadAndValidateAgents } from "../validate/agents.js";
import { loadAndValidateSkills } from "../validate/skills.js";
import { renderAll, renderLoaded } from "./pipeline.js";

const symlinkAvailable = await canCreateSymlinks();

describe("renderAll", () => {
  let tempDir: string;
  let config: ResolvedConfig;
  let restore: () => void;

  beforeEach(async () => {
    tempDir = await createTempDir();
    config = makeResolvedConfig(tempDir);
    const installed = installTestLogger();
    restore = installed.restore;
    // Create skills and agents directories expected by makeResolvedConfig
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
  });

  afterEach(async () => {
    restore();
    await cleanupTempDir(tempDir);
  });

  it("produces 4 outputs for 1 agent + 1 skill with both targets enabled", async () => {
    await createSkillFixture(config.library.skillsDir, "my-skill");
    await createAgentFixture(
      config.library.agentsDir,
      "my-agent",
      makeAgentYaml("my-agent"),
    );

    const result = await renderAll(config, false);

    expect(result.outputs).toHaveLength(4);
    const types = result.outputs.map((o) => `${o.target}:${o.type}`).sort();
    expect(types).toEqual([
      "claude:agent",
      "claude:skill",
      "codex:agent",
      "codex:skill",
    ]);
  });

  it("writes agent files to generatedDir when writeToGenerated is true", async () => {
    await createSkillFixture(config.library.skillsDir, "s1");
    await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    const result = await renderAll(config, true);

    const agentOutputs = result.outputs.filter(
      (o): o is RenderedAgent => o.type === "agent",
    );
    for (const output of agentOutputs) {
      expect(output.generatedPath).toBeTruthy();
      expect(await pathExists(output.generatedPath)).toBe(true);
    }
  });

  it("renders agents when the YAML filename differs from the source name", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "source-file",
      makeAgentYaml("actual-agent", { name: "actual-agent" }),
    );

    const result = await renderAll(config, false);

    expect(result.agents.map((agent) => agent.name)).toEqual(["actual-agent"]);
    expect(result.outputs.map((output) => output.name).sort()).toEqual([
      "actual-agent",
      "actual-agent",
    ]);
  });

  it("does not write files to disk when writeToGenerated is false", async () => {
    await createSkillFixture(config.library.skillsDir, "s1");
    await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    await renderAll(config, false);

    const generatedDir = config.library.generatedDir;
    expect(await pathExists(generatedDir)).toBe(false);
  });

  it("returns only claude outputs when targetFilter is 'claude'", async () => {
    await createSkillFixture(config.library.skillsDir, "s1");
    await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    const result = await renderAll(config, false, false, "claude");

    expect(result.outputs).toHaveLength(2);
    expect(result.outputs.every((o) => o.target === "claude")).toBe(true);
  });

  it("excludes codex outputs when codex target is disabled", async () => {
    const disabledConfig = makeResolvedConfig(tempDir, {
      codex: { enabled: false },
    });
    await createSkillFixture(disabledConfig.library.skillsDir, "s1");
    await createAgentFixture(
      disabledConfig.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    const result = await renderAll(disabledConfig, false);

    expect(result.outputs.every((o) => o.target === "claude")).toBe(true);
    expect(result.outputs.some((o) => o.target === "codex")).toBe(false);
  });

  it("produces deterministic 64-char hex contentHash for skills", async () => {
    await createSkillFixture(config.library.skillsDir, "hash-skill");
    await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    const result1 = await renderAll(config, false);
    const result2 = await renderAll(config, false);

    const skillOutputs1 = result1.outputs.filter((o) => o.type === "skill");
    const skillOutputs2 = result2.outputs.filter((o) => o.type === "skill");

    for (const output of skillOutputs1) {
      expect(output.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
    // Deterministic: same inputs produce same hashes
    expect(skillOutputs1.map((o) => o.contentHash)).toEqual(
      skillOutputs2.map((o) => o.contentHash),
    );
  });

  it("agent outputs have non-null content containing rendered text", async () => {
    await createSkillFixture(config.library.skillsDir, "s1");
    await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    const result = await renderAll(config, false);

    const agentOutputs = result.outputs.filter((o) => o.type === "agent");
    expect(agentOutputs.length).toBeGreaterThan(0);
    for (const output of agentOutputs) {
      expect(output.content).not.toBeNull();
      expect(output.content?.length).toBeGreaterThan(0);
      expect(output.content).toContain("a1");
    }
  });

  it("returns empty outputs when no skills and no agents exist", async () => {
    const result = await renderAll(config, false);

    expect(result.outputs).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result.agents).toEqual([]);
  });

  it("propagates strict mode to agent validation", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "strict-agent",
      `${makeAgentYaml("strict-agent")}\nunknown_field: oops`,
    );

    await expect(renderAll(config, false, true)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message).toContain("unknown_field");
        return true;
      },
    );
  });

  it("propagates strict mode for unknown nested target-specific fields", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "strict-target-agent",
      makeAgentYaml("strict-target-agent", {
        claude: {
          model: "sonnet",
          tols: ["Read"],
        },
        codex: {
          sandbox_mode: "read-only",
          approvval_policy: "never",
        },
      }),
    );

    await expect(renderAll(config, false, true)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message).toContain("claude.tols");
        expect((err as UserError).message).toContain("codex.approvval_policy");
        return true;
      },
    );
  });

  it("propagates strict mode for unknown granular approval policy fields", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "strict-granular-approval-agent",
      makeAgentYaml("strict-granular-approval-agent", {
        codex: {
          approval_policy: {
            extra_toggle: true,
            granular: {
              sandbox_approval: true,
              extra_toggle: true,
            },
          },
        },
      }),
    );

    await expect(renderAll(config, false, true)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message).toContain(
          "codex.approval_policy.extra_toggle",
        );
        expect((err as UserError).message).toContain(
          "codex.approval_policy.granular.extra_toggle",
        );
        return true;
      },
    );
  });

  it("fails render pipeline for invalid nested target-specific values", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "bad-nested-values",
      makeAgentYaml("bad-nested-values", {
        claude: {
          tools: "Read",
        },
        codex: {
          sandbox_mode: "unrestricted",
        },
      }),
    );

    await expect(renderAll(config, false)).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(UserError);
      expect((err as UserError).message).toContain("claude.tools");
      expect((err as UserError).message).toContain("codex.sandbox_mode");
      return true;
    });
  });

  it("fails render pipeline for invalid model_reasoning_effort values", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "bad-reasoning-effort",
      makeAgentYaml("bad-reasoning-effort", {
        codex: {
          model_reasoning_effort: "banana",
        },
      }),
    );

    await expect(renderAll(config, false)).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(UserError);
      expect((err as UserError).message).toContain(
        "codex.model_reasoning_effort",
      );
      return true;
    });
  });

  it("fails render pipeline for invalid approval_policy object shapes", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "bad-approval-policy",
      makeAgentYaml("bad-approval-policy", {
        codex: {
          approval_policy: {},
        },
      }),
    );

    await expect(renderAll(config, false)).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(UserError);
      expect((err as UserError).message).toContain(
        "codex.approval_policy.granular",
      );
      return true;
    });
  });

  it("fails render pipeline for granular approval_policy objects missing required keys", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "empty-granular-approval-policy",
      makeAgentYaml("empty-granular-approval-policy", {
        codex: {
          approval_policy: {
            granular: {
              skill_approval: true,
            },
          },
        },
      }),
    );

    await expect(renderAll(config, false)).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(UserError);
      expect((err as UserError).message).toContain(
        "codex.approval_policy.granular",
      );
      return true;
    });
  });

  it("fails render pipeline for empty nickname_candidates lists", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "empty-nickname-candidates",
      makeAgentYaml("empty-nickname-candidates", {
        codex: {
          nickname_candidates: [],
        },
      }),
    );

    await expect(renderAll(config, false)).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(UserError);
      expect((err as UserError).message).toContain("codex.nickname_candidates");
      return true;
    });
  });

  it("fails render pipeline for invalid nickname_candidates characters", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "invalid-nickname-candidates",
      makeAgentYaml("invalid-nickname-candidates", {
        codex: {
          nickname_candidates: ["bad!name"],
        },
      }),
    );

    await expect(renderAll(config, false)).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(UserError);
      expect((err as UserError).message).toContain(
        "codex.nickname_candidates.0",
      );
      return true;
    });
  });

  it("fails render pipeline for blank nickname_candidates after trimming", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "blank-nickname-candidates",
      makeAgentYaml("blank-nickname-candidates", {
        codex: {
          nickname_candidates: ["   "],
        },
      }),
    );

    await expect(renderAll(config, false)).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(UserError);
      expect((err as UserError).message).toContain(
        "codex.nickname_candidates.0",
      );
      return true;
    });
  });

  it("fails render pipeline for duplicate nickname_candidates after trimming", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "trim-duplicate-nickname-candidates",
      makeAgentYaml("trim-duplicate-nickname-candidates", {
        codex: {
          nickname_candidates: ["Atlas", " Atlas "],
        },
      }),
    );

    await expect(renderAll(config, false)).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(UserError);
      expect((err as UserError).message).toContain(
        "codex.nickname_candidates.1",
      );
      return true;
    });
  });

  describe("unknown target-field passthrough (normal mode)", () => {
    it("preserves unknown claude field end-to-end into rendered .md", async () => {
      await createAgentFixture(
        config.library.agentsDir,
        "passthrough-claude",
        makeAgentYaml("passthrough-claude", {
          claude: {
            model: "sonnet",
            experimental_mode: "beta",
            mcp_servers: ["fs", "web"],
          },
        }),
      );

      const result = await renderAll(config, false);

      const claudeOutput = result.outputs.find(
        (o): o is RenderedAgent => o.type === "agent" && o.target === "claude",
      );
      expect(claudeOutput).toBeDefined();
      expect(claudeOutput?.content).toContain('experimental_mode: "beta"');
      expect(claudeOutput?.content).toContain('mcp_servers: ["fs", "web"]');
      expect(claudeOutput?.content).toContain("model: sonnet");
    });

    it("preserves unknown codex field end-to-end into rendered .toml", async () => {
      await createAgentFixture(
        config.library.agentsDir,
        "passthrough-codex",
        makeAgentYaml("passthrough-codex", {
          codex: {
            sandbox_mode: "read-only",
            future_flag: "x",
            tool_budget: 42,
          },
        }),
      );

      const result = await renderAll(config, false);

      const codexOutput = result.outputs.find(
        (o): o is RenderedAgent => o.type === "agent" && o.target === "codex",
      );
      expect(codexOutput).toBeDefined();
      expect(codexOutput?.content).toContain('future_flag = "x"');
      expect(codexOutput?.content).toContain("tool_budget = 42");
      expect(codexOutput?.content).toContain('sandbox_mode = "read-only"');
    });

    it("skips unrenderable shapes at render time without affecting other fields", async () => {
      await createAgentFixture(
        config.library.agentsDir,
        "passthrough-shape-skip",
        makeAgentYaml("passthrough-shape-skip", {
          claude: {
            model: "sonnet",
            nested_object: { a: 1 },
          },
        }),
      );

      const result = await renderAll(config, false);

      const claudeOutput = result.outputs.find(
        (o): o is RenderedAgent => o.type === "agent" && o.target === "claude",
      );
      expect(claudeOutput?.content).not.toContain("nested_object");
      expect(claudeOutput?.content).toContain("model: sonnet");
    });
  });

  describe("skill content hashing", () => {
    it("produces distinct hashes for skills with different content", async () => {
      await createSkillFixture(
        config.library.skillsDir,
        "skill-a",
        "---\nname: skill-a\ndescription: Alpha skill.\n---\n\n# skill-a\n\nAlpha content.\n",
      );
      await createSkillFixture(
        config.library.skillsDir,
        "skill-b",
        "---\nname: skill-b\ndescription: Beta skill.\n---\n\n# skill-b\n\nBeta content.\n",
      );
      await createAgentFixture(
        config.library.agentsDir,
        "a1",
        makeAgentYaml("a1"),
      );

      const result = await renderAll(config, false);

      const skillOutputs = result.outputs.filter((o) => o.type === "skill");
      expect(skillOutputs).toHaveLength(4);

      const aClaude = skillOutputs.find(
        (o) => o.target === "claude" && o.name === "skill-a",
      )?.contentHash;
      const aCodex = skillOutputs.find(
        (o) => o.target === "codex" && o.name === "skill-a",
      )?.contentHash;
      const bClaude = skillOutputs.find(
        (o) => o.target === "claude" && o.name === "skill-b",
      )?.contentHash;

      expect(aClaude).toBeDefined();
      // For a neutral skill with no target overrides, rendered content is identical
      expect(aClaude).toBe(aCodex);
      // Skills with different content produce different hashes
      expect(aClaude).not.toBe(bClaude);
    });

    it("produces no outputs when all targets are disabled", async () => {
      const noTargetsConfig = makeResolvedConfig(tempDir, {
        claude: { enabled: false },
        codex: { enabled: false },
      });
      await createSkillFixture(noTargetsConfig.library.skillsDir, "skill-a");

      const result = await renderAll(noTargetsConfig, false);

      expect(result.outputs).toEqual([]);
    });

    it("produces no outputs when targetFilter excludes all enabled targets", async () => {
      const claudeOnlyConfig = makeResolvedConfig(tempDir, {
        codex: { enabled: false },
      });
      await createSkillFixture(claudeOnlyConfig.library.skillsDir, "skill-a");

      const result = await renderAll(claudeOnlyConfig, false, false, "codex");

      expect(result.outputs).toEqual([]);
    });
  });

  it("removes stale generated files when source agent is deleted", async () => {
    await createSkillFixture(config.library.skillsDir, "s1");
    await createAgentFixture(
      config.library.agentsDir,
      "a1",
      makeAgentYaml("a1"),
    );

    // First render creates generated files
    await renderAll(config, true);

    const staleClaudePath = path.join(
      config.library.generatedDir,
      "claude",
      "agents",
      "a1.md",
    );
    expect(await pathExists(staleClaudePath)).toBe(true);

    // Delete the agent source
    await rm(path.join(config.library.agentsDir, "a1.yaml"));

    // Re-render — stale generated file should be removed
    await renderAll(config, true);

    expect(await pathExists(staleClaudePath)).toBe(false);
  });

  it("writes per-target SKILL.md without a managed header", async () => {
    await createSkillFixture(
      config.library.skillsDir,
      "my-skill",
      [
        "---",
        "name: my-skill",
        "description: A test skill.",
        "---",
        "",
        "# my-skill",
        "",
        "Body.",
        "",
      ].join("\n"),
    );

    await renderAll(config, true);

    const claudePath = path.join(
      config.library.generatedDir,
      "claude",
      "skills",
      "my-skill",
      "SKILL.md",
    );
    const codexPath = path.join(
      config.library.generatedDir,
      "codex",
      "skills",
      "my-skill",
      "SKILL.md",
    );

    const claudeContent = await readFile(claudePath, "utf-8");
    const codexContent = await readFile(codexPath, "utf-8");

    expect(claudeContent.startsWith("---\n")).toBe(true);
    expect(claudeContent).toContain("name: my-skill");
    expect(codexContent.startsWith("---\n")).toBe(true);
    expect(codexContent).toContain("name: my-skill");
  });

  it("writes the codex sidecar when codex_sidecar is present", async () => {
    await createSkillFixture(
      config.library.skillsDir,
      "sc-skill",
      [
        "---",
        "name: sc-skill",
        "description: A test skill.",
        "codex_sidecar:",
        "  interface:",
        "    display_name: SC Skill",
        "---",
        "",
        "# body",
        "",
      ].join("\n"),
    );

    await renderAll(config, true);

    const sidecarPath = path.join(
      config.library.generatedDir,
      "codex",
      "skills",
      "sc-skill",
      "agents",
      "openai.yaml",
    );
    expect(await pathExists(sidecarPath)).toBe(true);
    const content = await readFile(sidecarPath, "utf-8");
    expect(content).toContain("display_name: SC Skill");
  });

  it("substitutes {{model:*}} placeholders per target", async () => {
    const tieredConfig = makeResolvedConfig(tempDir);
    tieredConfig.modelTiers = {
      fast: {
        claude: { model: "haiku" },
        codex: { model: "gpt-5.4-mini" },
      },
      standard: {
        claude: { model: "sonnet", effort: "medium" },
        codex: { model: "gpt-5.4", reasoning_effort: "medium" },
      },
      deep: {
        claude: { model: "opus", effort: "high" },
        codex: { model: "gpt-5.4", reasoning_effort: "high" },
      },
    };

    await createSkillFixture(
      tieredConfig.library.skillsDir,
      "tier-skill",
      [
        "---",
        "name: tier-skill",
        "description: A test skill.",
        "---",
        "",
        "use {{model:deep}} for synthesis",
        "",
      ].join("\n"),
    );

    await renderAll(tieredConfig, true);

    const claudeContent = await readFile(
      path.join(
        tieredConfig.library.generatedDir,
        "claude",
        "skills",
        "tier-skill",
        "SKILL.md",
      ),
      "utf-8",
    );
    const codexContent = await readFile(
      path.join(
        tieredConfig.library.generatedDir,
        "codex",
        "skills",
        "tier-skill",
        "SKILL.md",
      ),
      "utf-8",
    );
    expect(claudeContent).toContain("use opus for synthesis");
    expect(codexContent).toContain("use gpt-5.4 for synthesis");
  });

  it("resolves tier placeholders in agent targets and hydrates target-native effort", async () => {
    const tieredConfig = makeResolvedConfig(tempDir);
    tieredConfig.modelTiers = {
      standard: {
        claude: { model: "claude-sonnet-4-6", effort: "medium" },
        codex: { model: "gpt-5.4", reasoning_effort: "medium" },
      },
    };

    await createAgentFixture(
      tieredConfig.library.agentsDir,
      "tier-agent",
      makeAgentYaml("tier-agent", {
        claude: {
          model: "{{model:standard}}",
          tools: ["Read", "Grep"],
        },
        codex: {
          model: "{{model:standard}}",
          sandbox_mode: "read-only",
        },
      }),
    );

    await renderAll(tieredConfig, true);

    const claudeAgentContent = await readFile(
      path.join(
        tieredConfig.library.generatedDir,
        "claude",
        "agents",
        "tier-agent.md",
      ),
      "utf-8",
    );
    const codexAgentContent = await readFile(
      path.join(
        tieredConfig.library.generatedDir,
        "codex",
        "agents",
        "tier-agent.toml",
      ),
      "utf-8",
    );

    expect(claudeAgentContent).toContain("model: claude-sonnet-4-6");
    expect(claudeAgentContent).toContain("effort: medium");
    expect(codexAgentContent).toContain('model = "gpt-5.4"');
    expect(codexAgentContent).toContain('model_reasoning_effort = "medium"');
  });

  it("mirrors known subdirs into each target's generated dir", async () => {
    await createSkillFixture(
      config.library.skillsDir,
      "sub-skill",
      [
        "---",
        "name: sub-skill",
        "description: A test skill.",
        "---",
        "",
        "# body",
        "",
      ].join("\n"),
      ["references", "scripts"],
    );
    // Put a file inside references/ to verify mirroring.
    await writeFile(
      path.join(
        config.library.skillsDir,
        "sub-skill",
        "references",
        "notes.md",
      ),
      "hello\n",
      "utf-8",
    );

    await renderAll(config, true);

    const claudeFile = path.join(
      config.library.generatedDir,
      "claude",
      "skills",
      "sub-skill",
      "references",
      "notes.md",
    );
    const codexFile = path.join(
      config.library.generatedDir,
      "codex",
      "skills",
      "sub-skill",
      "references",
      "notes.md",
    );
    expect(await pathExists(claudeFile)).toBe(true);
    expect(await pathExists(codexFile)).toBe(true);
    expect(await readFile(claudeFile, "utf-8")).toBe("hello\n");
    expect(await readFile(codexFile, "utf-8")).toBe("hello\n");
  });

  it("purges stale orphans inside a per-skill generated dir on re-render", async () => {
    // First render: skill with codex_sidecar and a mirrored scripts/ subdir.
    await createSkillFixture(
      config.library.skillsDir,
      "purge-skill",
      [
        "---",
        "name: purge-skill",
        "description: A skill with sidecar and subdir.",
        "codex_sidecar:",
        "  interface:",
        "    display_name: Purge Skill",
        "---",
        "",
        "# body",
        "",
      ].join("\n"),
      ["scripts"],
    );
    await writeFile(
      path.join(config.library.skillsDir, "purge-skill", "scripts", "foo.txt"),
      "hello\n",
      "utf-8",
    );

    await renderAll(config, true);

    const sidecarPath = path.join(
      config.library.generatedDir,
      "codex",
      "skills",
      "purge-skill",
      "agents",
      "openai.yaml",
    );
    const scriptsPath = path.join(
      config.library.generatedDir,
      "codex",
      "skills",
      "purge-skill",
      "scripts",
      "foo.txt",
    );
    expect(await pathExists(sidecarPath)).toBe(true);
    expect(await pathExists(scriptsPath)).toBe(true);

    // Re-render with codex_sidecar removed AND scripts/ removed from source.
    await rm(path.join(config.library.skillsDir, "purge-skill"), {
      recursive: true,
      force: true,
    });
    await createSkillFixture(
      config.library.skillsDir,
      "purge-skill",
      [
        "---",
        "name: purge-skill",
        "description: A skill with sidecar and subdir.",
        "---",
        "",
        "# body",
        "",
      ].join("\n"),
    );

    await renderAll(config, true);

    expect(await pathExists(sidecarPath)).toBe(false);
    expect(await pathExists(scriptsPath)).toBe(false);
  });

  it("removes stale per-target skill directories when the source is deleted", async () => {
    await createSkillFixture(
      config.library.skillsDir,
      "stale-skill",
      "---\nname: stale-skill\ndescription: A skill that will be deleted.\n---\n\n# body\n",
    );

    // First render — skill dirs are created
    await renderAll(config, true);

    const claudeSkillDir = path.join(
      config.library.generatedDir,
      "claude",
      "skills",
      "stale-skill",
    );
    const codexSkillDir = path.join(
      config.library.generatedDir,
      "codex",
      "skills",
      "stale-skill",
    );
    expect(await pathExists(claudeSkillDir)).toBe(true);
    expect(await pathExists(codexSkillDir)).toBe(true);

    // Delete the source skill
    await rm(path.join(config.library.skillsDir, "stale-skill"), {
      recursive: true,
      force: true,
    });

    // Re-render — stale generated dirs should be removed
    await renderAll(config, true);

    expect(await pathExists(claudeSkillDir)).toBe(false);
    expect(await pathExists(codexSkillDir)).toBe(false);
  });
});

describe("renderLoaded", () => {
  let tempDir: string;
  let config: ResolvedConfig;
  let restore: () => void;

  beforeEach(async () => {
    tempDir = await createTempDir();
    config = makeResolvedConfig(tempDir);
    const installed = installTestLogger();
    restore = installed.restore;
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
  });

  afterEach(async () => {
    restore();
    await cleanupTempDir(tempDir);
  });

  it("renders supplied loaded skills and agents through an options object", async () => {
    await createSkillFixture(config.library.skillsDir, "loaded-skill");
    await createAgentFixture(
      config.library.agentsDir,
      "loaded-agent",
      makeAgentYaml("loaded-agent", { skills: ["loaded-skill"] }),
    );
    const skills = await loadAndValidateSkills(config.library.skillsDir);
    const agents = await loadAndValidateAgents(
      config.library.agentsDir,
      skills,
      {
        strict: false,
        modelTiers: config.modelTiers,
      },
    );
    await writeFile(
      path.join(config.library.skillsDir, "loaded-skill", "SKILL.md"),
      "---\nname: loaded-skill\ndescription: Mutated source.\n---\n\n# changed\n",
      "utf-8",
    );
    await writeFile(
      path.join(config.library.agentsDir, "loaded-agent.yaml"),
      makeAgentYaml("mutated-agent"),
      "utf-8",
    );

    const result = await renderLoaded({
      config,
      skills,
      agents,
      writeToGenerated: true,
      targetFilter: "codex",
    });

    expect(result.skills).toBe(skills);
    expect(result.agents).toBe(agents);
    expect(result.outputs).toHaveLength(2);
    expect(result.outputs.every((output) => output.target === "codex")).toBe(
      true,
    );
    expect(
      result.outputs.map((output) => `${output.target}:${output.type}`).sort(),
    ).toEqual(["codex:agent", "codex:skill"]);

    const agentOutput = result.outputs.find(
      (output): output is RenderedAgent => output.type === "agent",
    );
    expect(agentOutput?.content).toContain('name = "loaded-agent"');
    expect(await pathExists(agentOutput?.generatedPath ?? "")).toBe(true);
    const generatedSkillPath = path.join(
      config.library.generatedDir,
      "codex",
      "skills",
      "loaded-skill",
      "SKILL.md",
    );
    expect(await pathExists(generatedSkillPath)).toBe(true);
    const generatedSkillContent = await readFile(generatedSkillPath, "utf-8");
    expect(generatedSkillContent).toContain("A test skill.");
    expect(generatedSkillContent).not.toContain("Mutated source");
    expect(generatedSkillContent).not.toContain("# changed");
  });

  it("requires mirrored subdirs to remain source-backed for loaded skills", async () => {
    await createSkillFixture(
      config.library.skillsDir,
      "loaded-skill",
      undefined,
      ["scripts"],
    );
    const skills = await loadAndValidateSkills(config.library.skillsDir);
    await rm(config.library.skillsDir, { recursive: true, force: true });

    await expect(
      renderLoaded({
        config,
        skills,
        agents: [],
      }),
    ).rejects.toThrow(UserError);
  });

  it("renders loaded skills without mirrored subdirs after source directories are removed", async () => {
    await createSkillFixture(config.library.skillsDir, "loaded-skill");
    const skills = await loadAndValidateSkills(config.library.skillsDir);
    await rm(config.library.skillsDir, { recursive: true, force: true });

    const result = await renderLoaded({
      config,
      skills,
      agents: [],
      targetFilter: "codex",
    });

    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0].name).toBe("loaded-skill");
    expect(result.outputs[0].type).toBe("skill");
    expect(await pathExists(config.library.generatedDir)).toBe(false);
  });

  it("renders loaded agents after source YAML files are removed", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "loaded-agent",
      makeAgentYaml("loaded-agent"),
    );
    const agents = await loadAndValidateAgents(config.library.agentsDir, [], {
      strict: false,
      modelTiers: config.modelTiers,
    });
    await rm(config.library.agentsDir, { recursive: true, force: true });

    const result = await renderLoaded({
      config,
      skills: [],
      agents,
      targetFilter: "codex",
    });

    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0].name).toBe("loaded-agent");
    expect(result.outputs[0].type).toBe("agent");
    expect(result.outputs[0].content).toContain('name = "loaded-agent"');
    expect(await pathExists(config.library.generatedDir)).toBe(false);
  });

  it("does not write generated output when writeToGenerated is false", async () => {
    await createSkillFixture(config.library.skillsDir, "loaded-no-write-skill");
    await createAgentFixture(
      config.library.agentsDir,
      "loaded-no-write-agent",
      makeAgentYaml("loaded-no-write-agent", {
        skills: ["loaded-no-write-skill"],
      }),
    );
    const skills = await loadAndValidateSkills(config.library.skillsDir);
    const agents = await loadAndValidateAgents(
      config.library.agentsDir,
      skills,
      {
        strict: false,
        modelTiers: config.modelTiers,
      },
    );

    const result = await renderLoaded({
      config,
      skills,
      agents,
      writeToGenerated: false,
    });

    expect(result.outputs).toHaveLength(4);
    expect(await pathExists(config.library.generatedDir)).toBe(false);
  });

  it("does not remove unrelated generated outputs for partial loaded input", async () => {
    await createSkillFixture(config.library.skillsDir, "kept-skill");
    await createSkillFixture(config.library.skillsDir, "omitted-skill");
    await createAgentFixture(
      config.library.agentsDir,
      "kept-agent",
      makeAgentYaml("kept-agent", { skills: ["kept-skill"] }),
    );
    await createAgentFixture(
      config.library.agentsDir,
      "omitted-agent",
      makeAgentYaml("omitted-agent", { skills: ["omitted-skill"] }),
    );

    const fullRender = await renderAll(config, true, false, "codex");
    const omittedPaths = fullRender.outputs
      .filter((output) => output.name.startsWith("omitted-"))
      .map((output) =>
        output.type === "skill"
          ? path.join(output.generatedPath, "SKILL.md")
          : output.generatedPath,
      );
    for (const omittedPath of omittedPaths) {
      expect(await pathExists(omittedPath)).toBe(true);
    }

    const loadedSkills = await loadAndValidateSkills(config.library.skillsDir);
    const loadedAgents = await loadAndValidateAgents(
      config.library.agentsDir,
      loadedSkills,
      {
        strict: false,
        modelTiers: config.modelTiers,
      },
    );
    const skills = loadedSkills.filter((skill) => skill.name === "kept-skill");
    const agents = loadedAgents.filter((agent) => agent.name === "kept-agent");

    const result = await renderLoaded({
      config,
      skills,
      agents,
      writeToGenerated: true,
      targetFilter: "codex",
    });

    expect(result.outputs.map((output) => output.name).sort()).toEqual([
      "kept-agent",
      "kept-skill",
    ]);
    for (const omittedPath of omittedPaths) {
      expect(await pathExists(omittedPath)).toBe(true);
    }
  });

  it("renders an agent-only partial input after full validation", async () => {
    await createSkillFixture(config.library.skillsDir, "referenced-skill");
    await createAgentFixture(
      config.library.agentsDir,
      "agent-only",
      makeAgentYaml("agent-only", { skills: ["referenced-skill"] }),
    );
    const loadedSkills = await loadAndValidateSkills(config.library.skillsDir);
    const loadedAgents = await loadAndValidateAgents(
      config.library.agentsDir,
      loadedSkills,
      {
        strict: false,
        modelTiers: config.modelTiers,
      },
    );
    const agents = loadedAgents.filter((agent) => agent.name === "agent-only");
    await rm(path.join(config.library.skillsDir, "referenced-skill"), {
      recursive: true,
      force: true,
    });

    const result = await renderLoaded({
      config,
      skills: [],
      validatedSkills: loadedSkills,
      agents,
      targetFilter: "codex",
    });

    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0].name).toBe("agent-only");
    expect(result.outputs[0].type).toBe("agent");
    expect(result.outputs[0].content).toContain("referenced-skill");
    expect(await pathExists(config.library.generatedDir)).toBe(false);
  });

  it("rejects unvalidated loaded inputs before writing generated output", async () => {
    await createSkillFixture(config.library.skillsDir, "safe-skill");
    const [skill] = await loadAndValidateSkills(config.library.skillsDir);

    await expect(
      renderLoaded({
        config,
        skills: [
          {
            ...skill,
            name: "../escape",
            source: { ...skill.source, name: "../escape" },
          },
        ],
        agents: [],
        writeToGenerated: true,
      }),
    ).rejects.toThrow(UserError);

    expect(await pathExists(config.library.generatedDir)).toBe(false);
  });

  it("rejects loaded skill paths outside the configured skills root", async () => {
    await createSkillFixture(
      config.library.skillsDir,
      "safe-skill",
      undefined,
      ["scripts"],
    );
    const [skill] = await loadAndValidateSkills(config.library.skillsDir);
    const externalSkillDir = path.join(tempDir, "external-skill");

    await expect(
      renderLoaded({
        config,
        skills: [{ ...skill, dirPath: externalSkillDir }],
        agents: [],
        writeToGenerated: true,
      }),
    ).rejects.toThrow(UserError);

    expect(await pathExists(config.library.generatedDir)).toBe(false);
  });

  it("rejects nested loaded skill paths inside the configured skills root", async () => {
    await createSkillFixture(config.library.skillsDir, "safe-skill");
    const [skill] = await loadAndValidateSkills(config.library.skillsDir);

    await expect(
      renderLoaded({
        config,
        skills: [
          {
            ...skill,
            dirPath: path.join(config.library.skillsDir, "nested", skill.name),
          },
        ],
        agents: [],
      }),
    ).rejects.toThrow(UserError);
  });

  it.skipIf(!symlinkAvailable)(
    "rejects symlinked loaded skill directories inside the configured skills root",
    async () => {
      const skillDir = await createSkillFixture(
        config.library.skillsDir,
        "safe-skill",
        undefined,
        ["scripts"],
      );
      const [skill] = await loadAndValidateSkills(config.library.skillsDir);
      const externalSkillDir = path.join(tempDir, "external-loaded-skill");
      await mkdir(path.join(externalSkillDir, "scripts"), { recursive: true });
      await writeFile(
        path.join(externalSkillDir, "SKILL.md"),
        skill.skillMdContent,
        "utf-8",
      );
      await rm(skillDir, { recursive: true, force: true });
      await symlink(externalSkillDir, skillDir, "dir");

      await expect(
        renderLoaded({
          config,
          skills: [skill],
          agents: [],
        }),
      ).rejects.toThrow(UserError);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "rejects symlinked loaded skill mirrored subdirectories",
    async () => {
      await createSkillFixture(
        config.library.skillsDir,
        "safe-skill",
        undefined,
        ["scripts"],
      );
      const [skill] = await loadAndValidateSkills(config.library.skillsDir);
      const scriptsDir = path.join(skill.dirPath, "scripts");
      const externalScriptsDir = path.join(tempDir, "external-scripts");
      await mkdir(externalScriptsDir, { recursive: true });
      await rm(scriptsDir, { recursive: true, force: true });
      await symlink(externalScriptsDir, scriptsDir, "dir");

      await expect(
        renderLoaded({
          config,
          skills: [skill],
          agents: [],
        }),
      ).rejects.toThrow(UserError);
    },
  );

  it("rejects loaded agent paths outside the configured agents root", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "safe-agent",
      makeAgentYaml("safe-agent"),
    );
    const [agent] = await loadAndValidateAgents(config.library.agentsDir, [], {
      strict: false,
      modelTiers: config.modelTiers,
    });

    await expect(
      renderLoaded({
        config,
        skills: [],
        agents: [{ ...agent, filePath: path.join(tempDir, "safe-agent.yaml") }],
        writeToGenerated: true,
      }),
    ).rejects.toThrow(UserError);

    expect(await pathExists(config.library.generatedDir)).toBe(false);
  });

  it("rejects agent skill references outside the validated skill universe", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "safe-agent",
      makeAgentYaml("safe-agent"),
    );
    const [agent] = await loadAndValidateAgents(config.library.agentsDir, [], {
      strict: false,
      modelTiers: config.modelTiers,
    });

    await expect(
      renderLoaded({
        config,
        skills: [],
        validatedSkills: [],
        agents: [
          {
            ...agent,
            source: { ...agent.source, skills: ["missing-skill"] },
          },
        ],
      }),
    ).rejects.toThrow(UserError);
  });

  it("rejects nested loaded agent paths inside the configured agents root", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "safe-agent",
      makeAgentYaml("safe-agent"),
    );
    const [agent] = await loadAndValidateAgents(config.library.agentsDir, [], {
      strict: false,
      modelTiers: config.modelTiers,
    });

    await expect(
      renderLoaded({
        config,
        skills: [],
        agents: [
          {
            ...agent,
            filePath: path.join(
              config.library.agentsDir,
              "nested",
              "safe-agent.yaml",
            ),
          },
        ],
      }),
    ).rejects.toThrow(UserError);
  });

  it.skipIf(!symlinkAvailable)(
    "renders loaded agents without inspecting symlinked source YAML files",
    async () => {
      await createAgentFixture(
        config.library.agentsDir,
        "safe-agent",
        makeAgentYaml("safe-agent"),
      );
      const [agent] = await loadAndValidateAgents(
        config.library.agentsDir,
        [],
        {
          strict: false,
          modelTiers: config.modelTiers,
        },
      );
      const externalAgentPath = path.join(tempDir, "external-agent.yaml");
      await writeFile(externalAgentPath, makeAgentYaml("safe-agent"), "utf-8");
      await rm(agent.filePath, { force: true });
      await symlink(externalAgentPath, agent.filePath, "file");

      const result = await renderLoaded({
        config,
        skills: [],
        agents: [agent],
        targetFilter: "codex",
      });

      expect(result.outputs).toHaveLength(1);
      expect(result.outputs[0].name).toBe("safe-agent");
    },
  );

  it("rejects unnormalized loaded agent sources", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "safe-agent",
      makeAgentYaml("safe-agent"),
    );
    const [agent] = await loadAndValidateAgents(config.library.agentsDir, [], {
      strict: false,
      modelTiers: config.modelTiers,
    });
    const sourceWithoutDefaultSkills = { ...agent.source };
    (sourceWithoutDefaultSkills as { skills?: unknown }).skills = undefined;

    await expect(
      renderLoaded({
        config,
        skills: [],
        agents: [{ ...agent, source: sourceWithoutDefaultSkills }],
      }),
    ).rejects.toThrow(UserError);
  });

  it("rejects loaded agent sources with different keys than schema output", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "safe-agent",
      makeAgentYaml("safe-agent"),
    );
    const [agent] = await loadAndValidateAgents(config.library.agentsDir, [], {
      strict: false,
      modelTiers: config.modelTiers,
    });
    const sourceWithExtraUndefined = {
      name: agent.source.name,
      description: agent.source.description,
      instructions: agent.source.instructions,
      extra: undefined,
    } as unknown as typeof agent.source;

    await expect(
      renderLoaded({
        config,
        skills: [],
        agents: [{ ...agent, source: sourceWithExtraUndefined }],
      }),
    ).rejects.toThrow(UserError);
  });

  it("rejects loaded agent sources that still need schema transforms", async () => {
    await createAgentFixture(
      config.library.agentsDir,
      "safe-agent",
      makeAgentYaml("safe-agent"),
    );
    const [agent] = await loadAndValidateAgents(config.library.agentsDir, [], {
      strict: false,
      modelTiers: config.modelTiers,
    });

    await expect(
      renderLoaded({
        config,
        skills: [],
        agents: [
          {
            ...agent,
            source: {
              ...agent.source,
              codex: {
                ...agent.source.codex,
                nickname_candidates: ["  Alias  "],
              },
            },
          },
        ],
      }),
    ).rejects.toThrow(UserError);
  });

  it.skipIf(!symlinkAvailable)(
    "rejects symlinked generated skill parents before writing",
    async () => {
      await createSkillFixture(config.library.skillsDir, "safe-skill");
      const skills = await loadAndValidateSkills(config.library.skillsDir);
      const externalDir = path.join(tempDir, "external-generated-skills");
      await mkdir(externalDir, { recursive: true });
      await mkdir(path.join(config.library.generatedDir, "codex"), {
        recursive: true,
      });
      await symlink(
        externalDir,
        path.join(config.library.generatedDir, "codex", "skills"),
      );

      await expect(
        renderLoaded({
          config,
          skills,
          agents: [],
          writeToGenerated: true,
          targetFilter: "codex",
        }),
      ).rejects.toThrow(UserError);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "rejects symlinked generated agent parents before writing",
    async () => {
      await createAgentFixture(
        config.library.agentsDir,
        "safe-agent",
        makeAgentYaml("safe-agent"),
      );
      const agents = await loadAndValidateAgents(config.library.agentsDir, [], {
        strict: false,
        modelTiers: config.modelTiers,
      });
      const externalDir = path.join(tempDir, "external-generated-agents");
      await mkdir(externalDir, { recursive: true });
      await mkdir(path.join(config.library.generatedDir, "codex"), {
        recursive: true,
      });
      await symlink(
        externalDir,
        path.join(config.library.generatedDir, "codex", "agents"),
      );

      await expect(
        renderLoaded({
          config,
          skills: [],
          agents,
          writeToGenerated: true,
          targetFilter: "codex",
        }),
      ).rejects.toThrow(UserError);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "rejects a symlinked generated root before writing",
    async () => {
      await createSkillFixture(config.library.skillsDir, "safe-skill");
      const skills = await loadAndValidateSkills(config.library.skillsDir);
      const externalDir = path.join(tempDir, "external-generated-root");
      await mkdir(externalDir, { recursive: true });
      await rm(config.library.generatedDir, { recursive: true, force: true });
      await symlink(externalDir, config.library.generatedDir);

      await expect(
        renderLoaded({
          config,
          skills,
          agents: [],
          writeToGenerated: true,
          targetFilter: "codex",
        }),
      ).rejects.toThrow(UserError);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "rejects symlinked generated ancestors before the generated root exists",
    async () => {
      await createSkillFixture(config.library.skillsDir, "safe-skill");
      const skills = await loadAndValidateSkills(config.library.skillsDir);
      const externalParent = path.join(tempDir, "external-generated-parent");
      const linkedParent = path.join(tempDir, "linked-generated-parent");
      await mkdir(externalParent, { recursive: true });
      await symlink(externalParent, linkedParent, "dir");
      const symlinkAncestorConfig = makeResolvedConfig(tempDir, {
        library: {
          generatedDir: path.join(linkedParent, "generated"),
        },
      });

      await expect(
        renderLoaded({
          config: symlinkAncestorConfig,
          skills,
          agents: [],
          writeToGenerated: true,
          targetFilter: "codex",
        }),
      ).rejects.toThrow(UserError);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "rejects symlinked generated agent cleanup directories before listing",
    async () => {
      const externalDir = path.join(tempDir, "external-cleanup-agents");
      await mkdir(externalDir, { recursive: true });
      await mkdir(path.join(config.library.generatedDir, "codex"), {
        recursive: true,
      });
      await symlink(
        externalDir,
        path.join(config.library.generatedDir, "codex", "agents"),
      );

      await expect(renderAll(config, true, false, "codex")).rejects.toThrow(
        UserError,
      );
    },
  );

  it.skipIf(!symlinkAvailable)(
    "rejects symlinked generated skill cleanup directories before listing",
    async () => {
      const externalDir = path.join(tempDir, "external-cleanup-skills");
      await mkdir(externalDir, { recursive: true });
      await mkdir(path.join(config.library.generatedDir, "codex"), {
        recursive: true,
      });
      await symlink(
        externalDir,
        path.join(config.library.generatedDir, "codex", "skills"),
      );

      await expect(renderAll(config, true, false, "codex")).rejects.toThrow(
        UserError,
      );
    },
  );
});
