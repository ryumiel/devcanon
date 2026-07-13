import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTestLogger } from "../__test-helpers__/logger.js";
import { parseRenderedMarkdownArtifact } from "../__test-helpers__/render.js";
import { CLAUDE_TARGET_FIELDS, type ResolvedConfig } from "../config/schema.js";
import type { LoadedAgent, LoadedSkill } from "../models/types.js";
import { renderClaudeAgent } from "./claude.js";

type ClaudeSource = NonNullable<LoadedAgent["source"]["claude"]>;

function withClaude(
  base: LoadedAgent,
  claudeFields: Record<string, unknown>,
): LoadedAgent {
  return {
    ...base,
    source: {
      ...base.source,
      claude: {
        ...(base.source.claude ?? {}),
        ...claudeFields,
      } as ClaudeSource,
    },
  };
}

const agent: LoadedAgent = {
  name: "test-agent",
  filePath: "/test/agents/test-agent.yaml",
  source: {
    name: "test-agent",
    description: "A test agent for unit testing.",
    instructions:
      "Follow these steps:\n\n## Step One\n\nDo the first thing.\n\n## Step Two\n\nDo the second thing.",
    skills: ["test-skill"],
    claude: {
      model: "sonnet",
      tools: ["Read", "Grep", "Bash"],
    },
    codex: undefined,
    tags: undefined,
    notes: undefined,
  },
};

const config = {
  configDir: "/test",
  library: {
    skillsDir: "/test/skills",
    agentsDir: "/test/agents",
    generatedDir: "/test/generated",
  },
  targets: {
    claude: {
      enabled: true,
      skillsHome: "~/.claude/skills",
      agentsHome: "~/.claude/agents",
      installMode: "symlink" as const,
    },
    codex: {
      enabled: true,
      skillsHome: "~/.agents/skills",
      agentsHome: "~/.codex/agents",
      installMode: "symlink" as const,
    },
  },
  defaults: {
    installMode: "symlink" as const,
    overwritePolicy: "overwrite-managed" as const,
    cleanManagedOutputs: true,
  },
  platform: { windowsSymlinkFallback: "copy" as const },
  manifest: { path: "~/.devcanon/manifest.json" },
  capabilityProfiles: {
    efficient: { claude: "claude-haiku-4-5", codex: "gpt-mini" },
    balanced: { claude: "claude-sonnet-4-6", codex: "gpt" },
    frontier: { claude: "claude-opus-4-7", codex: "gpt-frontier" },
  },
} satisfies ResolvedConfig;

const emptySkills = new Map<string, LoadedSkill>();

describe("renderClaudeAgent", () => {
  it("renders a sample agent to Claude markdown format (snapshot)", () => {
    const result = renderClaudeAgent(agent, emptySkills, config);
    expect(result.content).toMatchSnapshot();
  });

  it("starts with YAML frontmatter (no managed header)", () => {
    const result = renderClaudeAgent(agent, emptySkills, config);
    expect(result.content.startsWith("---\n")).toBe(true);
    expect(result.content).not.toContain("Managed by DevCanon");
  });

  it("includes frontmatter with name, description, tools, model", () => {
    const result = renderClaudeAgent(agent, emptySkills, config);
    const { frontmatter } = parseRenderedMarkdownArtifact(result.content);
    expect(frontmatter).toMatchObject({
      name: "test-agent",
      description: "A test agent for unit testing.",
      tools: "Read, Grep, Bash",
      model: "sonnet",
    });
  });

  it("renders every supported claude target field", () => {
    const fullAgent = withClaude(agent, {
      model: "claude-sonnet-4-6",
      effort: "high",
      tools: ["Read", "Grep", "Bash"],
    });
    const result = renderClaudeAgent(fullAgent, emptySkills, config);
    const { frontmatter } = parseRenderedMarkdownArtifact(result.content);
    const expectedValues = {
      model: "claude-sonnet-4-6",
      effort: "high",
      tools: "Read, Grep, Bash",
    } satisfies Record<(typeof CLAUDE_TARGET_FIELDS)[number], string>;

    for (const field of CLAUDE_TARGET_FIELDS) {
      expect(frontmatter[field]).toBe(expectedValues[field]);
    }
  });

  it("resolves top-level capability to the target-native model without effort", () => {
    const result = renderClaudeAgent(
      {
        ...agent,
        source: { ...agent.source, capability: "balanced", claude: undefined },
      },
      emptySkills,
      config,
    );
    const { frontmatter } = parseRenderedMarkdownArtifact(result.content);
    expect(frontmatter.model).toBe("claude-sonnet-4-6");
    expect(frontmatter).not.toHaveProperty("effort");
  });

  it("rejects a schema-bypassed custom capability even when its profile is owned", () => {
    const customConfig = {
      ...config,
      capabilityProfiles: {
        ...config.capabilityProfiles,
        experimental: { claude: "custom-claude", codex: "custom-codex" },
      },
    } as ResolvedConfig;

    expect(() =>
      renderClaudeAgent(
        {
          ...agent,
          source: {
            ...agent.source,
            capability: "experimental" as "balanced",
            claude: undefined,
          },
        },
        emptySkills,
        customConfig,
      ),
    ).toThrow(/unknown capability "experimental"/);
  });

  it.each(["foo # dropped", "null", "true", "123", 'quote"slash\\'])(
    "round-trips YAML-significant capability model %j as a string",
    (model) => {
      const modelConfig = {
        ...config,
        capabilityProfiles: {
          ...config.capabilityProfiles,
          balanced: { ...config.capabilityProfiles.balanced, claude: model },
        },
      } satisfies ResolvedConfig;
      const result = renderClaudeAgent(
        {
          ...agent,
          source: {
            ...agent.source,
            capability: "balanced",
            claude: undefined,
          },
        },
        emptySkills,
        modelConfig,
      );

      expect(
        parseRenderedMarkdownArtifact(result.content).frontmatter.model,
      ).toBe(model);
      expect(result.content).toContain(`model: ${JSON.stringify(model)}`);
    },
  );

  it.each(["foo # dropped", "null", "true", "123", 'quote"slash\\'])(
    "round-trips YAML-significant literal model %j as a string",
    (model) => {
      const literalAgent = withClaude(agent, { model });
      const result = renderClaudeAgent(
        {
          ...literalAgent,
          source: { ...literalAgent.source, capability: "balanced" },
        },
        emptySkills,
        config,
      );

      expect(
        parseRenderedMarkdownArtifact(result.content).frontmatter.model,
      ).toBe(model);
      expect(result.content).toContain(`model: ${JSON.stringify(model)}`);
    },
  );

  it("prefers a literal model and emits only explicit effort", () => {
    const literalAgent = withClaude(agent, {
      model: "literal-claude",
      effort: "high",
    });
    const result = renderClaudeAgent(
      {
        ...literalAgent,
        source: { ...literalAgent.source, capability: "balanced" },
      },
      emptySkills,
      config,
    );
    const { frontmatter } = parseRenderedMarkdownArtifact(result.content);
    expect(frontmatter.model).toBe("literal-claude");
    expect(frontmatter.effort).toBe("high");
  });

  it("omits ambient model and effort", () => {
    const result = renderClaudeAgent(
      {
        ...agent,
        source: { ...agent.source, claude: undefined },
      },
      emptySkills,
      config,
    );
    const { frontmatter } = parseRenderedMarkdownArtifact(result.content);
    expect(frontmatter).not.toHaveProperty("model");
    expect(frontmatter).not.toHaveProperty("effort");
  });

  it.each([
    ["capability", undefined, "balanced"],
    ["literal", "literal-claude", undefined],
    ["ambient", undefined, undefined],
  ] as const)(
    "emits explicit effort on the %s model path",
    (_path, model, capability) => {
      const result = renderClaudeAgent(
        {
          ...agent,
          source: {
            ...agent.source,
            capability,
            claude: { model, effort: "high" },
          },
        },
        emptySkills,
        config,
      );
      const { frontmatter } = parseRenderedMarkdownArtifact(result.content);
      expect(frontmatter.effort).toBe("high");
    },
  );

  it.each([
    ["capability", undefined, "balanced"],
    ["literal", "literal-claude", undefined],
    ["ambient", undefined, undefined],
  ] as const)(
    "does not infer effort on the %s model path",
    (_path, model, capability) => {
      const result = renderClaudeAgent(
        {
          ...agent,
          source: {
            ...agent.source,
            capability,
            claude: model === undefined ? undefined : { model },
          },
        },
        emptySkills,
        config,
      );
      const { frontmatter } = parseRenderedMarkdownArtifact(result.content);
      expect(frontmatter).not.toHaveProperty("effort");
    },
  );

  it.each([
    "{{model:standard}}",
    "  {{model:standard}}  ",
    "{{model: standard}}",
    "{{model:deep-tier}}",
  ])(
    "rejects obsolete model placeholder %s with migration guidance",
    (model) => {
      // Defense-in-depth: validation usually rejects this earlier, but the
      // renderer must refuse placeholders from callers that bypass validation.
      expect(() =>
        renderClaudeAgent(withClaude(agent, { model }), emptySkills, config),
      ).toThrow(/top-level capability.*literal target model/);
    },
  );

  it("emits instructions body directly without ## Instructions wrapper", () => {
    const result = renderClaudeAgent(agent, emptySkills, config);
    const content = result.content;
    expect(content).toContain("## Step One");
    expect(content).toContain("## Step Two");
    expect(content).not.toContain("## Instructions");
  });

  it("appends ## Skills section", () => {
    const result = renderClaudeAgent(agent, emptySkills, config);
    const content = result.content;
    expect(content).toContain("## Skills");
    expect(content).toContain(
      "- **test-skill** (`~/.claude/skills/test-skill`)",
    );
  });

  it("returns correct metadata fields", () => {
    const result = renderClaudeAgent(agent, emptySkills, config);
    expect(result.target).toBe("claude");
    expect(result.type).toBe("agent");
    expect(result.name).toBe("test-agent");
    expect(result.sourcePath).toBe("/test/agents/test-agent.yaml");
    expect(result.generatedPath).toBe(
      path.join("/test/generated", "claude", "agents", "test-agent.md"),
    );
    expect(result.installedPath).toBe(
      path.join("~/.claude/agents", "test-agent.md"),
    );
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("renderClaudeAgent passthrough", () => {
  let warnings: string[];
  let restore: () => void;

  beforeEach(() => {
    const installed = installTestLogger();
    warnings = installed.testLogger.warnings;
    restore = installed.restore;
  });

  afterEach(() => restore());

  it("emits unknown string field as JSON-quoted frontmatter line", () => {
    const result = renderClaudeAgent(
      withClaude(agent, { experimental_mode: "beta" }),
      emptySkills,
      config,
    );
    const { frontmatter } = parseRenderedMarkdownArtifact(result.content);
    expect(frontmatter.experimental_mode).toBe("beta");
    expect(result.content).toContain('experimental_mode: "beta"');
    expect(warnings).toEqual([]);
  });

  it("emits unknown number, boolean, and null scalars", () => {
    const result = renderClaudeAgent(
      withClaude(agent, {
        temperature: 0.7,
        eager: true,
        opt_out: null,
      }),
      emptySkills,
      config,
    );
    const { frontmatter } = parseRenderedMarkdownArtifact(result.content);
    expect(frontmatter.temperature).toBe(0.7);
    expect(frontmatter.eager).toBe(true);
    expect(frontmatter.opt_out).toBeNull();
  });

  it("emits unknown string array as JSON flow form", () => {
    const result = renderClaudeAgent(
      withClaude(agent, { mcp_servers: ["fs", "web"] }),
      emptySkills,
      config,
    );
    const { frontmatter } = parseRenderedMarkdownArtifact(result.content);
    expect(frontmatter.mcp_servers).toEqual(["fs", "web"]);
  });

  it("emits unknown number and boolean arrays bare", () => {
    const result = renderClaudeAgent(
      withClaude(agent, { weights: [1, 2, 3], flags: [true, false] }),
      emptySkills,
      config,
    );
    const { frontmatter } = parseRenderedMarkdownArtifact(result.content);
    expect(frontmatter.weights).toEqual([1, 2, 3]);
    expect(frontmatter.flags).toEqual([true, false]);
  });

  it("emits empty unknown array as []", () => {
    const result = renderClaudeAgent(
      withClaude(agent, { mcp_servers: [] }),
      emptySkills,
      config,
    );
    const { frontmatter } = parseRenderedMarkdownArtifact(result.content);
    expect(frontmatter.mcp_servers).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("sorts unknown fields alphabetically after known fields", () => {
    const result = renderClaudeAgent(
      withClaude(agent, { zeta: 1, alpha: 2, middle: 3 }),
      emptySkills,
      config,
    );
    const frontmatter = result.content.split("---")[1];
    const keys = frontmatter
      .split("\n")
      .map((l) => l.match(/^(\w[\w-]*):/)?.[1])
      .filter((k): k is string => Boolean(k));
    const passthroughStart = keys.indexOf("model") + 1;
    expect(keys.slice(passthroughStart)).toEqual(["alpha", "middle", "zeta"]);
  });

  it("skips inline object value with warning", () => {
    const result = renderClaudeAgent(
      withClaude(agent, { nested: { a: 1 } }),
      emptySkills,
      config,
    );
    const { frontmatter } = parseRenderedMarkdownArtifact(result.content);
    expect(frontmatter).not.toHaveProperty("nested");
    expect(warnings.some((w) => w.includes('"nested"'))).toBe(true);
    expect(warnings.some((w) => w.includes("object"))).toBe(true);
  });

  it("skips mixed-type array with warning", () => {
    const result = renderClaudeAgent(
      withClaude(agent, { mixed: [1, "a"] }),
      emptySkills,
      config,
    );
    const { frontmatter } = parseRenderedMarkdownArtifact(result.content);
    expect(frontmatter).not.toHaveProperty("mixed");
    expect(warnings.some((w) => w.includes('"mixed"'))).toBe(true);
  });

  it("skips non-finite numbers with warning", () => {
    const result = renderClaudeAgent(
      withClaude(agent, { bad: Number.POSITIVE_INFINITY }),
      emptySkills,
      config,
    );
    const { frontmatter } = parseRenderedMarkdownArtifact(result.content);
    expect(frontmatter).not.toHaveProperty("bad");
    expect(warnings.some((w) => w.includes('"bad"'))).toBe(true);
  });

  it("skips unsafe keys with warning", () => {
    const result = renderClaudeAgent(
      withClaude(agent, { "bad key!": "x" }),
      emptySkills,
      config,
    );
    const { frontmatter } = parseRenderedMarkdownArtifact(result.content);
    expect(frontmatter).not.toHaveProperty("bad key!");
    expect(warnings.some((w) => w.includes('"bad key!"'))).toBe(true);
  });

  it("does not double-emit or clobber known fields present via passthrough object", () => {
    const result = renderClaudeAgent(
      withClaude(agent, { extra: "x" }),
      emptySkills,
      config,
    );
    const modelLines = result.content.match(/^model:/gm) ?? [];
    const toolsLines = result.content.match(/^tools:/gm) ?? [];
    const { frontmatter } = parseRenderedMarkdownArtifact(result.content);
    expect(modelLines).toHaveLength(1);
    expect(toolsLines).toHaveLength(1);
    expect(frontmatter.tools).toBe("Read, Grep, Bash");
  });

  it("JSON-quotes strings containing frontmatter-hostile characters", () => {
    const result = renderClaudeAgent(
      withClaude(agent, { note: 'has "quotes": and #hash' }),
      emptySkills,
      config,
    );
    const { frontmatter } = parseRenderedMarkdownArtifact(result.content);
    expect(frontmatter.note).toBe('has "quotes": and #hash');
    expect(result.content).toContain('note: "has \\"quotes\\": and #hash"');
  });
});
