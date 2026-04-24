import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
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
import { renderAll } from "./pipeline.js";

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

  it("writes per-target SKILL.md with managed headers", async () => {
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

    expect(claudeContent).toContain("<!-- Managed by agents-manager");
    expect(claudeContent).toContain("name: my-skill");
    expect(codexContent).toContain("<!-- Managed by agents-manager");
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
      fast: { claude: "haiku", codex: "gpt-5.4-mini" },
      standard: { claude: "sonnet", codex: "gpt-5.4" },
      deep: { claude: "opus", codex: "gpt-5.4" },
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
