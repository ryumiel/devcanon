import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTempDir,
  createAgentFixture,
  createTempDir,
  makeAgentYaml,
} from "../__test-helpers__/fixtures.js";
import { installTestLogger } from "../__test-helpers__/logger.js";
import type { TestLoggerResult } from "../__test-helpers__/logger.js";
import type { ModelTiers } from "../config/schema.js";
import type { LoadedSkill } from "../models/types.js";
import { UserError } from "../utils/errors.js";
import { loadAndValidateAgents } from "./agents.js";

describe("loadAndValidateAgents", () => {
  let tempDir: string;
  let agentsDir: string;
  let testLogger: TestLoggerResult;
  let restore: () => void;

  beforeEach(async () => {
    tempDir = await createTempDir();
    agentsDir = path.join(tempDir, "agents");
    const installed = installTestLogger();
    testLogger = installed.testLogger;
    restore = installed.restore;
  });

  afterEach(async () => {
    restore();
    await cleanupTempDir(tempDir);
  });

  const noSkills: LoadedSkill[] = [];
  const modelTiers: ModelTiers = {
    standard: {
      claude: { model: "claude-sonnet-4-6", effort: "medium" },
      codex: { model: "gpt-5.4", reasoning_effort: "medium" },
    },
  };

  it("returns empty array when agents directory does not exist", async () => {
    const result = await loadAndValidateAgents(
      path.join(tempDir, "nonexistent"),
      noSkills,
    );
    expect(result).toEqual([]);
  });

  it("returns empty array for an empty agents directory", async () => {
    await mkdir(agentsDir, { recursive: true });
    const result = await loadAndValidateAgents(agentsDir, noSkills);
    expect(result).toEqual([]);
  });

  it("loads a single valid agent with correct LoadedAgent fields", async () => {
    const yaml = makeAgentYaml("my-agent");
    const filePath = await createAgentFixture(agentsDir, "my-agent", yaml);

    const result = await loadAndValidateAgents(agentsDir, noSkills);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("my-agent");
    expect(result[0].filePath).toBe(filePath);
    expect(result[0].source.description).toBe("Test agent my-agent");
    expect(result[0].source.instructions).toBe("Instructions for my-agent");
    expect(result[0].source.skills).toEqual([]);
  });

  it("throws UserError for invalid YAML syntax", async () => {
    await createAgentFixture(agentsDir, "bad", "name: [\ninvalid yaml");

    await expect(loadAndValidateAgents(agentsDir, noSkills)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message).toContain("invalid YAML");
        return true;
      },
    );
  });

  it("does not emit unknown-field warnings when agent YAML root is a list", async () => {
    await createAgentFixture(agentsDir, "list-root", "- name: wrong-shape");

    await expect(loadAndValidateAgents(agentsDir, noSkills)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message).not.toContain('unknown field "0"');
        return true;
      },
    );
    expect(testLogger.warnings).toEqual([]);
  });

  it("throws UserError when a required field is missing", async () => {
    const yaml = "name: test-agent\ndescription: A test agent\nskills: []";
    await createAgentFixture(agentsDir, "no-instructions", yaml);

    await expect(loadAndValidateAgents(agentsDir, noSkills)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message).toContain("no-instructions.yaml");
        return true;
      },
    );
  });

  it("throws UserError when name field is not filesystem-safe", async () => {
    const yaml = makeAgentYaml("BadName", {
      name: "BadName",
    });
    await createAgentFixture(agentsDir, "uppercase", yaml);

    await expect(loadAndValidateAgents(agentsDir, noSkills)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message).toContain("filesystem-safe");
        return true;
      },
    );
  });

  it("throws UserError when agent references an unknown skill", async () => {
    const yaml = makeAgentYaml("ref-agent", {
      skills: ["nonexistent-skill"],
    });
    await createAgentFixture(agentsDir, "ref-agent", yaml);

    await expect(loadAndValidateAgents(agentsDir, noSkills)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message).toContain("nonexistent-skill");
        return true;
      },
    );
  });

  it("rejects agent model tier placeholders when modelTiers is not configured", async () => {
    const yaml = makeAgentYaml("tier-agent", {
      claude: {
        model: "{{model:standard}}",
        tools: ["Read"],
      },
      codex: {
        model: "{{model:standard}}",
        sandbox_mode: "read-only",
      },
    });
    await createAgentFixture(agentsDir, "tier-agent", yaml);

    await expect(loadAndValidateAgents(agentsDir, noSkills)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message).toContain('model tier "standard"');
        expect((err as UserError).message).toContain("claude.model");
        expect((err as UserError).message).toContain("modelTiers");
        return true;
      },
    );
  });

  it("rejects agent model tier placeholders that reference an unknown tier", async () => {
    const yaml = makeAgentYaml("tier-agent", {
      claude: {
        model: "{{model:deep}}",
        tools: ["Read"],
      },
      codex: {
        model: "{{model:deep}}",
        sandbox_mode: "read-only",
      },
    });
    await createAgentFixture(agentsDir, "tier-agent", yaml);

    await expect(
      loadAndValidateAgents(agentsDir, noSkills, { modelTiers }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(UserError);
      expect((err as UserError).message).toContain('unknown model tier "deep"');
      expect((err as UserError).message).toContain("codex.model");
      return true;
    });
  });

  it("rejects malformed agent model tier placeholders", async () => {
    const yaml = makeAgentYaml("tier-agent", {
      claude: {
        model: "{{model:bad-tier}}",
        tools: ["Read"],
      },
      codex: {
        model: "{{model:bad-tier}}",
        sandbox_mode: "read-only",
      },
    });
    await createAgentFixture(agentsDir, "tier-agent", yaml);

    await expect(
      loadAndValidateAgents(agentsDir, noSkills, { modelTiers }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(UserError);
      expect((err as UserError).message).toContain("invalid model placeholder");
      expect((err as UserError).message).toContain("claude.model");
      return true;
    });
  });

  it("rejects prototype-chain tier names like __proto__", async () => {
    const yaml = makeAgentYaml("tier-agent", {
      claude: {
        model: "{{model:__proto__}}",
        tools: ["Read"],
      },
    });
    await createAgentFixture(agentsDir, "tier-agent", yaml);

    await expect(
      loadAndValidateAgents(agentsDir, noSkills, { modelTiers }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(UserError);
      expect((err as UserError).message).toContain(
        'unknown model tier "__proto__"',
      );
      return true;
    });
  });

  it("succeeds when agent references a valid skill", async () => {
    const skill: LoadedSkill = {
      name: "my-skill",
      dirPath: "/fake",
      skillMdContent:
        "---\nname: my-skill\ndescription: A test skill.\n---\n\n# my-skill\n",
      source: { name: "my-skill", description: "A test skill." },
      body: "# my-skill\n",
      subdirs: [],
    };
    const yaml = makeAgentYaml("skill-user", {
      skills: ["my-skill"],
    });
    await createAgentFixture(agentsDir, "skill-user", yaml);

    const result = await loadAndValidateAgents(agentsDir, [skill]);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("skill-user");
    expect(result[0].source.skills).toEqual(["my-skill"]);
  });

  it("returns agent with warning for unknown field in non-strict mode", async () => {
    const yaml = `${makeAgentYaml("warn-agent")}\nextra_field: surprise`;
    await createAgentFixture(agentsDir, "warn-agent", yaml);

    const result = await loadAndValidateAgents(agentsDir, noSkills, {
      strict: false,
      modelTiers,
    });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("warn-agent");
    expect(testLogger.warnings.some((w) => w.includes("extra_field"))).toBe(
      true,
    );
  });

  it("throws UserError for unknown field in strict mode", async () => {
    const yaml = `${makeAgentYaml("strict-agent")}\nextra_field: surprise`;
    await createAgentFixture(agentsDir, "strict-agent", yaml);

    await expect(
      loadAndValidateAgents(agentsDir, noSkills, true),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(UserError);
      expect((err as UserError).message).toContain("extra_field");
      return true;
    });
  });

  it("warns for unknown target-specific fields in non-strict mode", async () => {
    const yaml = makeAgentYaml("warn-target-agent", {
      claude: {
        model: "sonnet",
        tols: ["Read"],
      },
      codex: {
        sandbox_mode: "read-only",
        approvval_policy: "on-request",
      },
    });
    await createAgentFixture(agentsDir, "warn-target-agent", yaml);

    const result = await loadAndValidateAgents(agentsDir, noSkills, {
      strict: false,
      modelTiers,
    });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("warn-target-agent");
    expect(result[0].source.claude).toEqual({
      model: "sonnet",
      tols: ["Read"],
    });
    expect(result[0].source.codex).toEqual({
      sandbox_mode: "read-only",
      approvval_policy: "on-request",
    });
    expect(testLogger.warnings.some((w) => w.includes("claude.tols"))).toBe(
      true,
    );
    expect(
      testLogger.warnings.some((w) => w.includes("codex.approvval_policy")),
    ).toBe(true);
  });

  it("warns for unknown nested granular approval policy fields in non-strict mode", async () => {
    const yaml = makeAgentYaml("warn-granular-approval-agent", {
      codex: {
        approval_policy: {
          extra_toggle: true,
          granular: {
            mcp_elicitations: true,
            rules: true,
            sandbox_approval: true,
            extra_toggle: true,
          },
        },
      },
    });
    await createAgentFixture(agentsDir, "warn-granular-approval-agent", yaml);

    const result = await loadAndValidateAgents(agentsDir, noSkills, {
      strict: false,
      modelTiers,
    });

    expect(result).toHaveLength(1);
    expect(result[0].source.codex).toEqual({
      approval_policy: {
        granular: {
          mcp_elicitations: true,
          rules: true,
          sandbox_approval: true,
        },
      },
    });
    expect(
      testLogger.warnings.some((w) =>
        w.includes("codex.approval_policy.extra_toggle"),
      ),
    ).toBe(true);
    expect(
      testLogger.warnings.some((w) =>
        w.includes("codex.approval_policy.granular.extra_toggle"),
      ),
    ).toBe(true);
  });

  it("throws UserError for unknown target-specific fields in strict mode", async () => {
    const yaml = makeAgentYaml("strict-target-agent", {
      claude: {
        model: "sonnet",
        tols: ["Read"],
      },
      codex: {
        sandbox_mode: "read-only",
        approvval_policy: "on-request",
      },
    });
    await createAgentFixture(agentsDir, "strict-target-agent", yaml);

    await expect(
      loadAndValidateAgents(agentsDir, noSkills, true),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(UserError);
      expect((err as UserError).message).toContain("claude.tols");
      expect((err as UserError).message).toContain("codex.approvval_policy");
      return true;
    });
  });

  it("throws UserError for unknown nested granular approval policy fields in strict mode", async () => {
    const yaml = makeAgentYaml("strict-granular-approval-agent", {
      codex: {
        approval_policy: {
          extra_toggle: true,
          granular: {
            sandbox_approval: true,
            extra_toggle: true,
          },
        },
      },
    });
    await createAgentFixture(agentsDir, "strict-granular-approval-agent", yaml);

    await expect(
      loadAndValidateAgents(agentsDir, noSkills, true),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(UserError);
      expect((err as UserError).message).toContain(
        "codex.approval_policy.extra_toggle",
      );
      expect((err as UserError).message).toContain(
        "codex.approval_policy.granular.extra_toggle",
      );
      return true;
    });
  });

  it("accepts all supported target-specific fields without warnings", async () => {
    const yaml = makeAgentYaml("all-target-fields", {
      claude: {
        model: "{{model:standard}}",
        effort: "high",
        tools: ["Read", "Grep"],
      },
      codex: {
        model: "gpt-5.4",
        model_reasoning_effort: "high",
        sandbox_mode: "danger-full-access",
        nickname_candidates: ["builder", "reviewer"],
        approval_policy: {
          granular: {
            mcp_elicitations: true,
            request_permissions: false,
            rules: true,
            sandbox_approval: true,
            skill_approval: false,
          },
        },
      },
    });
    await createAgentFixture(agentsDir, "all-target-fields", yaml);

    const result = await loadAndValidateAgents(agentsDir, noSkills, {
      strict: false,
      modelTiers,
    });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("all-target-fields");
    expect(result[0].source.claude).toEqual({
      model: "{{model:standard}}",
      effort: "high",
      tools: ["Read", "Grep"],
    });
    expect(result[0].source.codex).toEqual({
      model: "gpt-5.4",
      model_reasoning_effort: "high",
      sandbox_mode: "danger-full-access",
      nickname_candidates: ["builder", "reviewer"],
      approval_policy: {
        granular: {
          mcp_elicitations: true,
          request_permissions: false,
          rules: true,
          sandbox_approval: true,
          skill_approval: false,
        },
      },
    });
    expect(testLogger.warnings).toEqual([]);
  });

  it("accepts string approval_policy values", async () => {
    const yaml = makeAgentYaml("string-approval-policy", {
      codex: {
        approval_policy: "on-failure",
      },
    });
    await createAgentFixture(agentsDir, "string-approval-policy", yaml);

    const result = await loadAndValidateAgents(agentsDir, noSkills, false);

    expect(result).toHaveLength(1);
    expect(result[0].source.codex).toEqual({
      approval_policy: "on-failure",
    });
  });

  it("accepts model_reasoning_effort none", async () => {
    const yaml = makeAgentYaml("none-reasoning-effort", {
      codex: {
        model_reasoning_effort: "none",
      },
    });
    await createAgentFixture(agentsDir, "none-reasoning-effort", yaml);

    const result = await loadAndValidateAgents(agentsDir, noSkills, false);

    expect(result).toHaveLength(1);
    expect(result[0].source.codex).toEqual({
      model_reasoning_effort: "none",
    });
  });

  it("accepts model_reasoning_effort max", async () => {
    const yaml = makeAgentYaml("max-reasoning-effort", {
      codex: {
        model: "gpt-5.6-sol",
        model_reasoning_effort: "max",
      },
    });
    await createAgentFixture(agentsDir, "max-reasoning-effort", yaml);

    const result = await loadAndValidateAgents(agentsDir, noSkills, false);

    expect(result).toHaveLength(1);
    expect(result[0].source.codex).toEqual({
      model: "gpt-5.6-sol",
      model_reasoning_effort: "max",
    });
  });

  it("accepts all supported target-specific fields in strict mode", async () => {
    const yaml = makeAgentYaml("all-target-fields-strict", {
      claude: {
        model: "{{model:standard}}",
        effort: "high",
        tools: ["Read", "Grep"],
      },
      codex: {
        model: "gpt-5.4",
        model_reasoning_effort: "high",
        sandbox_mode: "danger-full-access",
        nickname_candidates: ["builder", "reviewer"],
        approval_policy: {
          granular: {
            mcp_elicitations: true,
            request_permissions: false,
            rules: true,
            sandbox_approval: true,
            skill_approval: false,
          },
        },
      },
    });
    await createAgentFixture(agentsDir, "all-target-fields-strict", yaml);

    await expect(
      loadAndValidateAgents(agentsDir, noSkills, {
        strict: true,
        modelTiers,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        name: "all-target-fields-strict",
        source: expect.objectContaining({
          claude: {
            model: "{{model:standard}}",
            effort: "high",
            tools: ["Read", "Grep"],
          },
          codex: {
            model: "gpt-5.4",
            model_reasoning_effort: "high",
            sandbox_mode: "danger-full-access",
            nickname_candidates: ["builder", "reviewer"],
            approval_policy: {
              granular: {
                mcp_elicitations: true,
                request_permissions: false,
                rules: true,
                sandbox_approval: true,
                skill_approval: false,
              },
            },
          },
        }),
      }),
    ]);
  });

  it("throws UserError for invalid nested claude field types", async () => {
    const yaml = makeAgentYaml("bad-claude-tools", {
      claude: {
        tools: "Read",
      },
    });
    await createAgentFixture(agentsDir, "bad-claude-tools", yaml);

    await expect(loadAndValidateAgents(agentsDir, noSkills)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message).toContain("claude.tools");
        return true;
      },
    );
  });

  it("throws UserError for invalid nested codex enum values", async () => {
    const yaml = makeAgentYaml("bad-codex-sandbox", {
      codex: {
        sandbox_mode: "unrestricted",
      },
    });
    await createAgentFixture(agentsDir, "bad-codex-sandbox", yaml);

    await expect(loadAndValidateAgents(agentsDir, noSkills)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message).toContain("codex.sandbox_mode");
        return true;
      },
    );
  });

  it("throws UserError for invalid model_reasoning_effort values", async () => {
    const yaml = makeAgentYaml("bad-reasoning-effort", {
      codex: {
        model_reasoning_effort: "banana",
      },
    });
    await createAgentFixture(agentsDir, "bad-reasoning-effort", yaml);

    await expect(loadAndValidateAgents(agentsDir, noSkills)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message).toContain(
          "codex.model_reasoning_effort",
        );
        return true;
      },
    );
  });

  it("throws UserError for model_reasoning_effort ultra", async () => {
    const yaml = makeAgentYaml("ultra-reasoning-effort", {
      codex: {
        model: "gpt-5.6-sol",
        model_reasoning_effort: "ultra",
      },
    });
    await createAgentFixture(agentsDir, "ultra-reasoning-effort", yaml);

    await expect(loadAndValidateAgents(agentsDir, noSkills)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message).toContain(
          "codex.model_reasoning_effort",
        );
        return true;
      },
    );
  });

  it("throws UserError for invalid approval_policy object shapes", async () => {
    const yaml = makeAgentYaml("bad-approval-policy", {
      codex: {
        approval_policy: {},
      },
    });
    await createAgentFixture(agentsDir, "bad-approval-policy", yaml);

    await expect(loadAndValidateAgents(agentsDir, noSkills)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message).toContain(
          "codex.approval_policy.granular",
        );
        return true;
      },
    );
  });

  it("throws UserError for granular approval_policy objects missing required keys", async () => {
    const yaml = makeAgentYaml("empty-granular-approval-policy", {
      codex: {
        approval_policy: {
          granular: {
            skill_approval: true,
          },
        },
      },
    });
    await createAgentFixture(agentsDir, "empty-granular-approval-policy", yaml);

    await expect(loadAndValidateAgents(agentsDir, noSkills)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message).toContain(
          "codex.approval_policy.granular",
        );
        return true;
      },
    );
  });

  it("throws UserError for invalid nickname_candidates", async () => {
    const yaml = makeAgentYaml("bad-nickname-candidates", {
      codex: {
        nickname_candidates: ["Atlas", "Atlas"],
      },
    });
    await createAgentFixture(agentsDir, "bad-nickname-candidates", yaml);

    await expect(loadAndValidateAgents(agentsDir, noSkills)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message).toContain(
          "codex.nickname_candidates",
        );
        expect((err as UserError).message).toContain(
          "Nickname candidates must be unique",
        );
        return true;
      },
    );
  });

  it("throws UserError for empty nickname_candidates lists", async () => {
    const yaml = makeAgentYaml("empty-nickname-candidates", {
      codex: {
        nickname_candidates: [],
      },
    });
    await createAgentFixture(agentsDir, "empty-nickname-candidates", yaml);

    await expect(loadAndValidateAgents(agentsDir, noSkills)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message).toContain(
          "codex.nickname_candidates",
        );
        return true;
      },
    );
  });

  it("throws UserError for invalid nickname_candidates characters", async () => {
    const yaml = makeAgentYaml("invalid-nickname-candidates", {
      codex: {
        nickname_candidates: ["bad!name"],
      },
    });
    await createAgentFixture(agentsDir, "invalid-nickname-candidates", yaml);

    await expect(loadAndValidateAgents(agentsDir, noSkills)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message).toContain(
          "codex.nickname_candidates.0",
        );
        return true;
      },
    );
  });

  it("throws UserError for blank nickname_candidates after trimming", async () => {
    const yaml = makeAgentYaml("blank-nickname-candidates", {
      codex: {
        nickname_candidates: ["   "],
      },
    });
    await createAgentFixture(agentsDir, "blank-nickname-candidates", yaml);

    await expect(loadAndValidateAgents(agentsDir, noSkills)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message).toContain(
          "codex.nickname_candidates.0",
        );
        return true;
      },
    );
  });

  it("throws UserError for duplicate nickname_candidates after trimming", async () => {
    const yaml = makeAgentYaml("trim-duplicate-nickname-candidates", {
      codex: {
        nickname_candidates: ["Atlas", " Atlas "],
      },
    });
    await createAgentFixture(
      agentsDir,
      "trim-duplicate-nickname-candidates",
      yaml,
    );

    await expect(loadAndValidateAgents(agentsDir, noSkills)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message).toContain(
          "codex.nickname_candidates.1",
        );
        expect((err as UserError).message).toContain(
          "Nickname candidates must be unique",
        );
        return true;
      },
    );
  });

  it("warns about .yml files and does not load them", async () => {
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      path.join(agentsDir, "ignored.yml"),
      makeAgentYaml("ignored"),
      "utf-8",
    );

    const result = await loadAndValidateAgents(agentsDir, noSkills);

    expect(result).toEqual([]);
    expect(testLogger.warnings.some((w) => w.includes("ignored.yml"))).toBe(
      true,
    );
    expect(testLogger.warnings.some((w) => w.includes(".yaml"))).toBe(true);
  });

  it("throws UserError mentioning duplicate when two files share the same name field", async () => {
    const yamlA = makeAgentYaml("same-name");
    const yamlB = makeAgentYaml("same-name");
    await createAgentFixture(agentsDir, "alpha", yamlA);
    await createAgentFixture(agentsDir, "beta", yamlB);

    await expect(loadAndValidateAgents(agentsDir, noSkills)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message.toLowerCase()).toContain("duplicate");
        return true;
      },
    );
  });

  it("ignores non-YAML files and returns empty array", async () => {
    await mkdir(agentsDir, { recursive: true });
    await writeFile(path.join(agentsDir, "readme.txt"), "hello", "utf-8");
    await writeFile(
      path.join(agentsDir, "notes.json"),
      JSON.stringify({ a: 1 }),
      "utf-8",
    );

    const result = await loadAndValidateAgents(agentsDir, noSkills);

    expect(result).toEqual([]);
  });

  it("batches multiple errors into a single UserError", async () => {
    // Agent with invalid YAML
    await createAgentFixture(agentsDir, "broken", "name: [\nbad yaml");
    // Agent with non-filesystem-safe name
    await createAgentFixture(
      agentsDir,
      "upper",
      makeAgentYaml("Upper", { name: "Upper" }),
    );

    await expect(loadAndValidateAgents(agentsDir, noSkills)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        const msg = (err as UserError).message;
        expect(msg).toContain("broken.yaml");
        expect(msg).toContain("upper.yaml");
        return true;
      },
    );
  });

  it("rejects a description containing angle brackets", async () => {
    const yaml = makeAgentYaml("bad", {
      description: "uses <tool>",
    });
    await createAgentFixture(agentsDir, "bad", yaml);

    await expect(loadAndValidateAgents(agentsDir, noSkills)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        const msg = (err as UserError).message;
        expect(msg).toContain("bad.yaml");
        expect(msg).toContain("description");
        expect(msg).toContain("'<' or '>'");
        return true;
      },
    );
  });
});
