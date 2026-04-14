import { mkdir } from "node:fs/promises";
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
      (o) => o.type === "agent" && o.generatedPath,
    );
    for (const output of agentOutputs) {
      expect(output.generatedPath).toBeTruthy();
      expect(await pathExists(output.generatedPath as string)).toBe(true);
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
});
