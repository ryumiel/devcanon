import { describe, expect, it } from "vitest";
import {
  AGENT_SOURCE_FIELDS,
  AgentSourceSchema,
  CLAUDE_TARGET_FIELDS,
  CODEX_APPROVAL_POLICY_FIELDS,
  CODEX_APPROVAL_POLICY_GRANULAR_FIELDS,
  CODEX_TARGET_FIELDS,
  ConfigSchema,
  SkillSourceSchema,
} from "./schema.js";

describe("ConfigSchema", () => {
  it("parses valid minimal config (version 1 only)", () => {
    const result = ConfigSchema.safeParse({ version: 1 });
    expect(result.success).toBe(true);
  });

  it("rejects missing version", () => {
    const result = ConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects version 2", () => {
    const result = ConfigSchema.safeParse({ version: 2 });
    expect(result.success).toBe(false);
  });

  it("applies correct defaults", () => {
    const result = ConfigSchema.parse({ version: 1 });

    expect(result.library.skillsDir).toBe("./skills");
    expect(result.library.agentsDir).toBe("./agents");
    expect(result.library.generatedDir).toBe("./generated");

    expect(result.targets.claude.enabled).toBe(true);
    expect(result.targets.claude.skillsHome).toBe("~/.claude/skills");
    expect(result.targets.claude.agentsHome).toBe("~/.claude/agents");

    expect(result.targets.codex.enabled).toBe(true);
    expect(result.targets.codex.skillsHome).toBe("~/.agents/skills");
    expect(result.targets.codex.agentsHome).toBe("~/.codex/agents");

    expect(result.defaults.installMode).toBe("symlink");
    expect(result.defaults.overwritePolicy).toBe("overwrite-managed");
    expect(result.defaults.cleanManagedOutputs).toBe(true);

    expect(result.platform.windowsSymlinkFallback).toBe("copy");

    expect(result.manifest.path).toBe("~/.agents-manager/manifest.json");
  });
});

describe("AgentSourceSchema", () => {
  const validAgent = {
    name: "my-agent",
    description: "A helpful agent.",
    instructions: "Do things well.",
  };

  it("parses valid agent", () => {
    const result = AgentSourceSchema.safeParse(validAgent);
    expect(result.success).toBe(true);
  });

  it("rejects missing name", () => {
    const { name: _, ...noName } = validAgent;
    const result = AgentSourceSchema.safeParse(noName);
    expect(result.success).toBe(false);
  });

  it("rejects missing instructions", () => {
    const { instructions: _, ...noInstructions } = validAgent;
    const result = AgentSourceSchema.safeParse(noInstructions);
    expect(result.success).toBe(false);
  });

  it("rejects missing description", () => {
    const { description: _, ...noDesc } = validAgent;
    const result = AgentSourceSchema.safeParse(noDesc);
    expect(result.success).toBe(false);
  });

  it("accepts optional fields (tags, notes, skills)", () => {
    const result = AgentSourceSchema.parse({
      ...validAgent,
      tags: ["coding", "review"],
      notes: "Some notes here.",
      skills: ["skill-a", "skill-b"],
    });
    expect(result.tags).toEqual(["coding", "review"]);
    expect(result.notes).toBe("Some notes here.");
    expect(result.skills).toEqual(["skill-a", "skill-b"]);
  });

  it("defaults skills to empty array", () => {
    const result = AgentSourceSchema.parse(validAgent);
    expect(result.skills).toEqual([]);
  });

  it("exposes the exact supported shared and target-specific field lists", () => {
    expect(new Set(AGENT_SOURCE_FIELDS)).toEqual(
      new Set([
        "name",
        "description",
        "instructions",
        "skills",
        "claude",
        "codex",
        "tags",
        "notes",
      ]),
    );
    expect(AGENT_SOURCE_FIELDS).toHaveLength(8);
    expect(new Set(CLAUDE_TARGET_FIELDS)).toEqual(new Set(["model", "tools"]));
    expect(CLAUDE_TARGET_FIELDS).toHaveLength(2);
    expect(new Set(CODEX_TARGET_FIELDS)).toEqual(
      new Set([
        "model",
        "model_reasoning_effort",
        "sandbox_mode",
        "nickname_candidates",
        "approval_policy",
      ]),
    );
    expect(CODEX_TARGET_FIELDS).toHaveLength(5);
    expect(new Set(CODEX_APPROVAL_POLICY_GRANULAR_FIELDS)).toEqual(
      new Set([
        "mcp_elicitations",
        "request_permissions",
        "rules",
        "sandbox_approval",
        "skill_approval",
      ]),
    );
    expect(CODEX_APPROVAL_POLICY_GRANULAR_FIELDS).toHaveLength(5);
    expect(new Set(CODEX_APPROVAL_POLICY_FIELDS)).toEqual(
      new Set(["granular"]),
    );
    expect(CODEX_APPROVAL_POLICY_FIELDS).toHaveLength(1);
  });

  it("preserves unknown target-specific fields during parsing", () => {
    const result = AgentSourceSchema.parse({
      ...validAgent,
      claude: {
        model: "sonnet",
        tools: ["Read", "Grep"],
        tols: ["Read"],
      },
      codex: {
        sandbox_mode: "workspace-write",
        approvval_policy: "never",
      },
    });

    expect(result.claude).toEqual({
      model: "sonnet",
      tools: ["Read", "Grep"],
      tols: ["Read"],
    });
    expect(result.codex).toEqual({
      sandbox_mode: "workspace-write",
      approvval_policy: "never",
    });
  });

  it("rejects invalid nested claude field types", () => {
    const result = AgentSourceSchema.safeParse({
      ...validAgent,
      claude: {
        tools: "Read",
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid nested codex enum values", () => {
    const result = AgentSourceSchema.safeParse({
      ...validAgent,
      codex: {
        sandbox_mode: "unrestricted",
      },
    });

    expect(result.success).toBe(false);
  });

  it("accepts granular codex approval policy objects", () => {
    const result = AgentSourceSchema.safeParse({
      ...validAgent,
      codex: {
        approval_policy: {
          granular: {
            mcp_elicitations: true,
            rules: true,
            sandbox_approval: true,
            request_permissions: false,
          },
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects granular approval policy objects missing required keys", () => {
    const result = AgentSourceSchema.safeParse({
      ...validAgent,
      codex: {
        approval_policy: {
          granular: {
            skill_approval: true,
          },
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("accepts on-failure approval_policy", () => {
    const result = AgentSourceSchema.safeParse({
      ...validAgent,
      codex: {
        approval_policy: "on-failure",
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts model_reasoning_effort none", () => {
    const result = AgentSourceSchema.safeParse({
      ...validAgent,
      codex: {
        model_reasoning_effort: "none",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects invalid model_reasoning_effort values", () => {
    const result = AgentSourceSchema.safeParse({
      ...validAgent,
      codex: {
        model_reasoning_effort: "banana",
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects empty nickname_candidates arrays", () => {
    const result = AgentSourceSchema.safeParse({
      ...validAgent,
      codex: {
        nickname_candidates: [],
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects duplicate nickname_candidates", () => {
    const result = AgentSourceSchema.safeParse({
      ...validAgent,
      codex: {
        nickname_candidates: ["Atlas", "Atlas"],
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects blank nickname_candidates after trimming", () => {
    const result = AgentSourceSchema.safeParse({
      ...validAgent,
      codex: {
        nickname_candidates: ["   "],
      },
    });

    expect(result.success).toBe(false);
  });

  it("normalizes nickname_candidates by trimming whitespace", () => {
    const result = AgentSourceSchema.parse({
      ...validAgent,
      codex: {
        nickname_candidates: [" Atlas ", "Delta"],
      },
    });

    expect(result.codex?.nickname_candidates).toEqual(["Atlas", "Delta"]);
  });

  it("rejects duplicate nickname_candidates after trimming", () => {
    const result = AgentSourceSchema.safeParse({
      ...validAgent,
      codex: {
        nickname_candidates: ["Atlas", " Atlas "],
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid name with spaces", () => {
    const result = AgentSourceSchema.safeParse({
      ...validAgent,
      name: "my agent",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid name with uppercase", () => {
    const result = AgentSourceSchema.safeParse({
      ...validAgent,
      name: "MyAgent",
    });
    expect(result.success).toBe(false);
  });
});

describe("ConfigSchema.modelTiers", () => {
  it("parses a valid modelTiers glossary", () => {
    const result = ConfigSchema.safeParse({
      version: 1,
      modelTiers: {
        fast: { claude: "haiku", codex: "gpt-5.4-mini" },
        standard: { claude: "sonnet", codex: "gpt-5.4" },
        deep: { claude: "opus", codex: "gpt-5.4" },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.modelTiers?.deep.claude).toBe("opus");
      expect(result.data.modelTiers?.fast.codex).toBe("gpt-5.4-mini");
    }
  });

  it("accepts config without modelTiers", () => {
    const result = ConfigSchema.safeParse({ version: 1 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.modelTiers).toBeUndefined();
    }
  });

  it("rejects a tier missing the claude key", () => {
    const result = ConfigSchema.safeParse({
      version: 1,
      modelTiers: { fast: { codex: "gpt-5.4-mini" } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a tier name that is not a string", () => {
    const result = ConfigSchema.safeParse({
      version: 1,
      modelTiers: { deep: { claude: 123, codex: "gpt-5.4" } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects tier names with hyphens", () => {
    const result = ConfigSchema.safeParse({
      version: 1,
      modelTiers: { "gpt-fast": { claude: "haiku", codex: "gpt-5.4-mini" } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty modelTiers object", () => {
    const result = ConfigSchema.safeParse({
      version: 1,
      modelTiers: {},
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" ");
      expect(messages).toMatch(/at least one tier/i);
    }
  });
});

describe("SkillSourceSchema", () => {
  it("accepts a minimal skill with only name and description", () => {
    const result = SkillSourceSchema.safeParse({
      name: "example",
      description: "Use when X.",
    });
    expect(result.success).toBe(true);
  });

  it("accepts allowed-tools as a string or string array", () => {
    const str = SkillSourceSchema.safeParse({
      name: "xy",
      description: "d",
      "allowed-tools": "Bash Read",
    });
    const arr = SkillSourceSchema.safeParse({
      name: "xy",
      description: "d",
      "allowed-tools": ["Bash", "Read"],
    });
    expect(str.success).toBe(true);
    expect(arr.success).toBe(true);
  });

  it("rejects an empty allowed-tools array", () => {
    const result = SkillSourceSchema.safeParse({
      name: "xy",
      description: "d",
      "allowed-tools": [],
    });
    expect(result.success).toBe(false);
  });

  it("accepts claude and codex override blocks", () => {
    const result = SkillSourceSchema.safeParse({
      name: "xy",
      description: "d",
      claude: { model: "opus", effort: "high" },
      codex: { license: "MIT", metadata: { "short-description": "blurb" } },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a codex_sidecar block", () => {
    const result = SkillSourceSchema.safeParse({
      name: "xy",
      description: "d",
      codex_sidecar: {
        interface: {
          display_name: "X",
          short_description: "blurb",
          brand_color: "#00ccff",
        },
        policy: { allow_implicit_invocation: true },
        dependencies: { tools: [] },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a description over 1024 chars", () => {
    const result = SkillSourceSchema.safeParse({
      name: "xy",
      description: "d".repeat(1025),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a description containing angle brackets", () => {
    const result = SkillSourceSchema.safeParse({
      name: "xy",
      description: "uses <tool> for things",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a name violating the kebab-case contract", () => {
    const result = SkillSourceSchema.safeParse({
      name: "Bad_Name",
      description: "d",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown top-level keys", () => {
    const result = SkillSourceSchema.safeParse({
      name: "xy",
      description: "d",
      typo_key: "oops",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid claude effort enum values", () => {
    const result = SkillSourceSchema.safeParse({
      name: "xy",
      description: "d",
      claude: { effort: "turbo" },
    });
    expect(result.success).toBe(false);
  });
});
