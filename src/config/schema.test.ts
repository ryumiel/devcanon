import { describe, expect, it } from "vitest";
import {
  AGENT_SOURCE_FIELDS,
  AgentSourceSchema,
  CLAUDE_TARGET_FIELDS,
  CODEX_APPROVAL_POLICY_FIELDS,
  CODEX_APPROVAL_POLICY_GRANULAR_FIELDS,
  CODEX_TARGET_FIELDS,
  ConfigSchema,
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

  it("strips unknown target-specific fields during parsing", () => {
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
    });
    expect(result.codex).toEqual({
      sandbox_mode: "workspace-write",
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

  it("rejects empty granular approval policy objects", () => {
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
