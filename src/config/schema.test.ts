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

const CAPABILITY_PROFILES = {
  efficient: {
    claude: "claude-haiku-4-5-20251001",
    codex: "gpt-5.6-luna",
  },
  balanced: {
    claude: "claude-sonnet-5",
    codex: "gpt-5.6-terra",
  },
  frontier: {
    claude: "claude-opus-4-8",
    codex: "gpt-5.6-sol",
  },
};

const VALID_CONFIG = {
  version: 2 as const,
  capabilityProfiles: CAPABILITY_PROFILES,
};

describe("ConfigSchema", () => {
  it("parses the minimal version 2 config with the fixed catalog", () => {
    const result = ConfigSchema.safeParse(VALID_CONFIG);
    expect(result.success).toBe(true);
  });

  it("rejects missing version", () => {
    const result = ConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects version 1", () => {
    const result = ConfigSchema.safeParse({
      ...VALID_CONFIG,
      version: 1,
    });
    expect(result.success).toBe(false);
  });

  it("applies correct defaults", () => {
    const result = ConfigSchema.parse(VALID_CONFIG);

    expect(result.library.skillsDir).toBe("./skills");
    expect(result.library.agentsDir).toBe("./agents");
    expect(result.library.generatedDir).toBe("./generated");

    expect(result.targets.claude.enabled).toBe(true);
    expect(result.targets.claude.skillsHome).toBe("~/.claude/skills");
    expect(result.targets.claude.agentsHome).toBe("~/.claude/agents");

    expect(result.targets.codex.enabled).toBe(true);
    expect(result.targets.codex.skillsHome).toBe("~/.agents/skills");
    expect(result.targets.codex.agentsHome).toBe("~/.codex/agents");
    expect(result.targets.codex.skillDisplayNameSuffix).toBeUndefined();

    expect(result.defaults.installMode).toBe("symlink");
    expect(result.defaults.overwritePolicy).toBe("overwrite-managed");
    expect(result.defaults.cleanManagedOutputs).toBe(true);

    expect(result.platform.windowsSymlinkFallback).toBe("copy");

    expect(result.manifest.path).toBe("~/.devcanon/manifest.json");
  });

  it("accepts a Codex display name suffix", () => {
    const result = ConfigSchema.parse({
      ...VALID_CONFIG,
      targets: {
        codex: {
          skillsHome: "~/.agents/skills",
          agentsHome: "~/.codex/agents",
          skillDisplayNameSuffix: "devcanon",
        },
      },
    });

    expect(result.targets.codex.skillDisplayNameSuffix).toBe("devcanon");
  });

  it("rejects an empty Codex display name suffix", () => {
    const result = ConfigSchema.safeParse({
      ...VALID_CONFIG,
      targets: {
        codex: {
          skillsHome: "~/.agents/skills",
          agentsHome: "~/.codex/agents",
          skillDisplayNameSuffix: "",
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects Codex display name suffix line breaks", () => {
    const result = ConfigSchema.safeParse({
      ...VALID_CONFIG,
      targets: {
        codex: {
          skillsHome: "~/.agents/skills",
          agentsHome: "~/.codex/agents",
          skillDisplayNameSuffix: "devcanon\ninjected",
        },
      },
    });

    expect(result.success).toBe(false);
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

  it("accepts optional fields (capability, tags, notes, skills)", () => {
    const result = AgentSourceSchema.parse({
      ...validAgent,
      capability: "balanced",
      tags: ["coding", "review"],
      notes: "Some notes here.",
      skills: ["skill-a", "skill-b"],
    });
    expect(result.capability).toBe("balanced");
    expect(result.tags).toEqual(["coding", "review"]);
    expect(result.notes).toBe("Some notes here.");
    expect(result.skills).toEqual(["skill-a", "skill-b"]);
  });

  it.each(["efficient", "balanced", "frontier"] as const)(
    "accepts canonical capability %s",
    (capability) => {
      expect(
        AgentSourceSchema.parse({ ...validAgent, capability }).capability,
      ).toBe(capability);
    },
  );

  it("rejects an unknown capability", () => {
    expect(
      AgentSourceSchema.safeParse({
        ...validAgent,
        capability: "standard",
      }).success,
    ).toBe(false);
  });

  it("defaults skills to empty array", () => {
    const result = AgentSourceSchema.parse(validAgent);
    expect(result.skills).toEqual([]);
  });

  it("rejects an empty description", () => {
    const result = AgentSourceSchema.safeParse({
      ...validAgent,
      description: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a description over 1024 chars", () => {
    const result = AgentSourceSchema.safeParse({
      ...validAgent,
      description: "d".repeat(1025),
    });
    expect(result.success).toBe(false);
  });

  it("accepts a description at exactly 1024 chars", () => {
    const result = AgentSourceSchema.safeParse({
      ...validAgent,
      description: "d".repeat(1024),
    });
    expect(result.success).toBe(true);
  });

  it("rejects a description containing angle brackets", () => {
    const result = AgentSourceSchema.safeParse({
      ...validAgent,
      description: "uses <tool> for things",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("description must not contain '<' or '>'");
    }
  });

  it("rejects a description containing only '<'", () => {
    const result = AgentSourceSchema.safeParse({
      ...validAgent,
      description: "less than < only",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a description containing only '>'", () => {
    const result = AgentSourceSchema.safeParse({
      ...validAgent,
      description: "greater than > only",
    });
    expect(result.success).toBe(false);
  });

  it("exposes the exact supported shared and target-specific field lists", () => {
    expect(new Set(AGENT_SOURCE_FIELDS)).toEqual(
      new Set([
        "name",
        "description",
        "instructions",
        "skills",
        "capability",
        "claude",
        "codex",
        "tags",
        "notes",
      ]),
    );
    expect(AGENT_SOURCE_FIELDS).toHaveLength(9);
    expect(new Set(CLAUDE_TARGET_FIELDS)).toEqual(
      new Set(["model", "effort", "tools"]),
    );
    expect(CLAUDE_TARGET_FIELDS).toHaveLength(3);
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

  it("rejects claude.model strings containing a newline", () => {
    const result = AgentSourceSchema.safeParse({
      ...validAgent,
      claude: {
        model: `sonnet${String.fromCharCode(0x0a)}tools: Read`,
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" ");
      expect(messages).toMatch(/control characters or line breaks/i);
    }
  });

  it("rejects codex.model strings containing a newline", () => {
    const result = AgentSourceSchema.safeParse({
      ...validAgent,
      codex: {
        model: `gpt-5.4${String.fromCharCode(0x0a)}`,
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects claude.tools entries containing a newline", () => {
    const result = AgentSourceSchema.safeParse({
      ...validAgent,
      claude: {
        tools: [`Read${String.fromCharCode(0x0a)}model: pwned`, "Grep"],
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" ");
      expect(messages).toMatch(/control characters or line breaks/i);
    }
  });

  it("rejects claude.tools entries containing a comma", () => {
    const result = AgentSourceSchema.safeParse({
      ...validAgent,
      claude: {
        tools: ["Read, Grep"],
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" ");
      expect(messages).toMatch(/','|comma/i);
    }
  });

  it("rejects claude.tools entries containing '#' (silent YAML comment)", () => {
    // Verified empirically: ["# bad", "Grep"] renders to
    // `tools: # bad, Grep` and round-trips through YAML 1.2 as
    // `{ tools: null }`, silently dropping every tool.
    const result = AgentSourceSchema.safeParse({
      ...validAgent,
      claude: {
        tools: ["# bad", "Grep"],
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" ");
      expect(messages).toMatch(/'#'|hash/i);
    }
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

describe("ConfigSchema.capabilityProfiles", () => {
  it("parses the canonical direct-string catalog", () => {
    const result = ConfigSchema.safeParse(VALID_CONFIG);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capabilityProfiles).toEqual(CAPABILITY_PROFILES);
    }
  });

  it("rejects a missing catalog", () => {
    const result = ConfigSchema.safeParse({ version: 2 });
    expect(result.success).toBe(false);
  });

  it.each(["efficient", "balanced", "frontier"] as const)(
    "rejects a catalog missing the %s profile",
    (profile) => {
      const capabilityProfiles = { ...CAPABILITY_PROFILES };
      delete capabilityProfiles[profile];

      const result = ConfigSchema.safeParse({
        ...VALID_CONFIG,
        capabilityProfiles,
      });
      expect(result.success).toBe(false);
    },
  );

  it("rejects an extra profile", () => {
    const result = ConfigSchema.safeParse({
      ...VALID_CONFIG,
      capabilityProfiles: {
        ...CAPABILITY_PROFILES,
        experimental: { claude: "claude-test", codex: "gpt-test" },
      },
    });
    expect(result.success).toBe(false);
  });

  it.each(["claude", "codex"] as const)(
    "rejects a profile missing the %s target",
    (target) => {
      const balanced = { ...CAPABILITY_PROFILES.balanced };
      delete balanced[target];

      const result = ConfigSchema.safeParse({
        ...VALID_CONFIG,
        capabilityProfiles: {
          ...CAPABILITY_PROFILES,
          balanced,
        },
      });
      expect(result.success).toBe(false);
    },
  );

  it("rejects an extra target key", () => {
    const result = ConfigSchema.safeParse({
      ...VALID_CONFIG,
      capabilityProfiles: {
        ...CAPABILITY_PROFILES,
        balanced: {
          ...CAPABILITY_PROFILES.balanced,
          other: "model",
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a nested model object", () => {
    const result = ConfigSchema.safeParse({
      ...VALID_CONFIG,
      capabilityProfiles: {
        ...CAPABILITY_PROFILES,
        balanced: {
          ...CAPABILITY_PROFILES.balanced,
          claude: { model: "claude-sonnet-5" },
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects effort metadata", () => {
    const result = ConfigSchema.safeParse({
      ...VALID_CONFIG,
      capabilityProfiles: {
        ...CAPABILITY_PROFILES,
        balanced: {
          ...CAPABILITY_PROFILES.balanced,
          effort: "high",
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it.each(["", "   "])("rejects an empty or blank model string", (claude) => {
    const result = ConfigSchema.safeParse({
      ...VALID_CONFIG,
      capabilityProfiles: {
        ...CAPABILITY_PROFILES,
        balanced: { ...CAPABILITY_PROFILES.balanced, claude },
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects values exceeding the 256-character cap", () => {
    const result = ConfigSchema.safeParse({
      ...VALID_CONFIG,
      capabilityProfiles: {
        ...CAPABILITY_PROFILES,
        frontier: {
          ...CAPABILITY_PROFILES.frontier,
          codex: "g".repeat(300),
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it.each([
    { name: "LF (0x0A)", code: 0x0a },
    { name: "NUL (0x00)", code: 0x00 },
    { name: "CR (0x0D)", code: 0x0d },
    { name: "VT (0x0B)", code: 0x0b },
    { name: "NEL (U+0085)", code: 0x85 },
    { name: "LS (U+2028)", code: 0x2028 },
    { name: "PS (U+2029)", code: 0x2029 },
  ])("rejects a model containing $name", ({ code }) => {
    const result = ConfigSchema.safeParse({
      ...VALID_CONFIG,
      capabilityProfiles: {
        ...CAPABILITY_PROFILES,
        frontier: {
          ...CAPABILITY_PROFILES.frontier,
          claude: `opus${String.fromCharCode(code)}injected`,
        },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("AgentSourceSchema render-safe code-point coverage", () => {
  const validAgent = {
    name: "test-agent",
    description: "Test agent for unit tests.",
    instructions: "Do the thing.",
    skills: [],
  };

  const LINE_BREAK_CODE_POINTS: ReadonlyArray<{ name: string; code: number }> =
    [
      { name: "CR (0x0D)", code: 0x0d },
      { name: "VT (0x0B)", code: 0x0b },
      { name: "NEL (U+0085)", code: 0x85 },
      { name: "LS (U+2028)", code: 0x2028 },
      { name: "PS (U+2029)", code: 0x2029 },
    ];

  for (const { name, code } of LINE_BREAK_CODE_POINTS) {
    it(`rejects agent.claude.model containing ${name}`, () => {
      const result = AgentSourceSchema.safeParse({
        ...validAgent,
        claude: { model: `sonnet${String.fromCharCode(code)}injected` },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join(" ");
        expect(messages).toMatch(/control characters or line breaks/i);
      }
    });

    it(`rejects agent.codex.model containing ${name}`, () => {
      const result = AgentSourceSchema.safeParse({
        ...validAgent,
        codex: { model: `gpt-5.4${String.fromCharCode(code)}injected` },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join(" ");
        expect(messages).toMatch(/control characters or line breaks/i);
      }
    });
  }
});

describe("ConfigSchema.toolNames", () => {
  it("parses a valid toolNames glossary with kebab-case keys", () => {
    const result = ConfigSchema.safeParse({
      ...VALID_CONFIG,
      toolNames: {
        "task-tracker": { claude: "TodoWrite", codex: "update_plan" },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.toolNames?.["task-tracker"].claude).toBe("TodoWrite");
      expect(result.data.toolNames?.["task-tracker"].codex).toBe("update_plan");
    }
  });

  it("accepts config without toolNames", () => {
    const result = ConfigSchema.safeParse(VALID_CONFIG);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.toolNames).toBeUndefined();
    }
  });

  it("rejects an empty toolNames object", () => {
    const result = ConfigSchema.safeParse({
      ...VALID_CONFIG,
      toolNames: {},
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" ");
      expect(messages).toMatch(/at least one entry/i);
    }
  });

  it("rejects an entry missing the codex key", () => {
    const result = ConfigSchema.safeParse({
      ...VALID_CONFIG,
      toolNames: { "task-tracker": { claude: "TodoWrite" } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-string value", () => {
    const result = ConfigSchema.safeParse({
      ...VALID_CONFIG,
      toolNames: { "task-tracker": { claude: 123, codex: "update_plan" } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty-string value", () => {
    const result = ConfigSchema.safeParse({
      ...VALID_CONFIG,
      toolNames: { "task-tracker": { claude: "", codex: "update_plan" } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects keys with uppercase letters", () => {
    const result = ConfigSchema.safeParse({
      ...VALID_CONFIG,
      toolNames: {
        TaskTracker: { claude: "TodoWrite", codex: "update_plan" },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" ");
      expect(messages).toMatch(/lowercase, digits, hyphens/i);
    }
  });

  it("rejects keys with underscores", () => {
    const result = ConfigSchema.safeParse({
      ...VALID_CONFIG,
      toolNames: {
        task_tracker: { claude: "TodoWrite", codex: "update_plan" },
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects keys with a leading hyphen", () => {
    const result = ConfigSchema.safeParse({
      ...VALID_CONFIG,
      toolNames: {
        "-task-tracker": { claude: "TodoWrite", codex: "update_plan" },
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects values exceeding the 256-character cap", () => {
    const result = ConfigSchema.safeParse({
      ...VALID_CONFIG,
      toolNames: {
        "task-tracker": {
          claude: "T".repeat(300),
          codex: "update_plan",
        },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("ConfigSchema.fileArtifacts", () => {
  it("parses a valid fileArtifacts glossary with kebab-case keys", () => {
    const result = ConfigSchema.safeParse({
      ...VALID_CONFIG,
      fileArtifacts: {
        "project-instructions": { claude: "CLAUDE.md", codex: "AGENTS.md" },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fileArtifacts?.["project-instructions"].claude).toBe(
        "CLAUDE.md",
      );
      expect(result.data.fileArtifacts?.["project-instructions"].codex).toBe(
        "AGENTS.md",
      );
    }
  });

  it("accepts config without fileArtifacts", () => {
    const result = ConfigSchema.safeParse(VALID_CONFIG);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fileArtifacts).toBeUndefined();
    }
  });

  it("rejects an empty fileArtifacts object", () => {
    const result = ConfigSchema.safeParse({
      ...VALID_CONFIG,
      fileArtifacts: {},
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" ");
      expect(messages).toMatch(/at least one entry/i);
    }
  });

  it("rejects an entry missing the claude key", () => {
    const result = ConfigSchema.safeParse({
      ...VALID_CONFIG,
      fileArtifacts: { "project-instructions": { codex: "AGENTS.md" } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects keys with uppercase letters", () => {
    const result = ConfigSchema.safeParse({
      ...VALID_CONFIG,
      fileArtifacts: {
        ProjectInstructions: { claude: "CLAUDE.md", codex: "AGENTS.md" },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" ");
      expect(messages).toMatch(/file artifact/i);
    }
  });

  it("rejects keys with underscores", () => {
    const result = ConfigSchema.safeParse({
      ...VALID_CONFIG,
      fileArtifacts: {
        project_instructions: { claude: "CLAUDE.md", codex: "AGENTS.md" },
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects values exceeding the 256-character cap", () => {
    const result = ConfigSchema.safeParse({
      ...VALID_CONFIG,
      fileArtifacts: {
        "project-instructions": {
          claude: "C".repeat(300),
          codex: "AGENTS.md",
        },
      },
    });
    expect(result.success).toBe(false);
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

  it("accepts a description at exactly 1024 chars", () => {
    const result = SkillSourceSchema.safeParse({
      name: "xy",
      description: "d".repeat(1024),
    });
    expect(result.success).toBe(true);
  });

  it("rejects a description containing angle brackets", () => {
    const result = SkillSourceSchema.safeParse({
      name: "xy",
      description: "uses <tool> for things",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a description containing only '<'", () => {
    const result = SkillSourceSchema.safeParse({
      name: "xy",
      description: "less than < only",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a description containing only '>'", () => {
    const result = SkillSourceSchema.safeParse({
      name: "xy",
      description: "greater than > only",
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

  it("rejects unknown keys inside the claude override block", () => {
    const result = SkillSourceSchema.safeParse({
      name: "xy",
      description: "d",
      claude: { unknown_field: 1 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys inside the codex override block", () => {
    const result = SkillSourceSchema.safeParse({
      name: "xy",
      description: "d",
      codex: { unknown_field: 1 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys inside codex_sidecar.interface", () => {
    const result = SkillSourceSchema.safeParse({
      name: "xy",
      description: "d",
      codex_sidecar: { interface: { unknown: 1 } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys inside codex_sidecar.policy", () => {
    const result = SkillSourceSchema.safeParse({
      name: "xy",
      description: "d",
      codex_sidecar: { policy: { unknown: 1 } },
    });
    expect(result.success).toBe(false);
  });
});
