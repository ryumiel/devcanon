import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTestLogger } from "../__test-helpers__/logger.js";
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
  manifest: { path: "~/.agents-manager/manifest.json" },
  modelTiers: {
    standard: {
      claude: { model: "claude-sonnet-4-7", effort: "medium" },
      codex: { model: "gpt-5.4", reasoning_effort: "medium" },
    },
    deep: {
      claude: { model: "claude-opus-4-7", effort: "high" },
      codex: { model: "gpt-5.4", reasoning_effort: "high" },
    },
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
    expect(result.content).not.toContain("Managed by agents-manager");
  });

  it("includes frontmatter with name, description, tools, model", () => {
    const result = renderClaudeAgent(agent, emptySkills, config);
    const content = result.content;
    expect(content).toContain("name: test-agent");
    expect(content).toContain('description: "A test agent for unit testing."');
    expect(content).toContain("tools: Read, Grep, Bash");
    expect(content).toContain("model: sonnet");
  });

  it("renders every supported claude target field", () => {
    const fullAgent = withClaude(agent, {
      model: "claude-sonnet-4-7",
      effort: "high",
      tools: ["Read", "Grep", "Bash"],
    });
    const result = renderClaudeAgent(fullAgent, emptySkills, config);
    const content = result.content;
    const expectedFragments = {
      model: "model: claude-sonnet-4-7",
      effort: "effort: high",
      tools: "tools: Read, Grep, Bash",
    } satisfies Record<(typeof CLAUDE_TARGET_FIELDS)[number], string>;

    for (const field of CLAUDE_TARGET_FIELDS) {
      expect(content).toContain(expectedFragments[field]);
    }
  });

  it("resolves a tier placeholder to the target-native model and effort", () => {
    const result = renderClaudeAgent(
      withClaude(agent, { model: "{{model:standard}}" }),
      emptySkills,
      config,
    );
    expect(result.content).toContain("model: claude-sonnet-4-7");
    expect(result.content).toContain("effort: medium");
  });

  it("prefers an explicit claude effort over the tier profile default", () => {
    const result = renderClaudeAgent(
      withClaude(agent, {
        model: "{{model:standard}}",
        effort: "high",
      }),
      emptySkills,
      config,
    );
    expect(result.content).toContain("model: claude-sonnet-4-7");
    expect(result.content).toContain("effort: high");
    expect(result.content).not.toContain("effort: medium");
  });

  it("throws when claude.model contains the placeholder prefix but is not a valid placeholder", () => {
    // Defense-in-depth: validation usually rejects this earlier, but the
    // renderer must refuse to emit a literal "{{model:...}}" if a caller
    // bypasses validation (e.g. a programmatic API consumer).
    expect(() =>
      renderClaudeAgent(
        withClaude(agent, { model: "  {{model:standard}}  " }),
        emptySkills,
        config,
      ),
    ).toThrow(/invalid model placeholder syntax/);
  });

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
    expect(result.content).toContain("temperature: 0.7");
    expect(result.content).toContain("eager: true");
    expect(result.content).toContain("opt_out: null");
  });

  it("emits unknown string array as JSON flow form", () => {
    const result = renderClaudeAgent(
      withClaude(agent, { mcp_servers: ["fs", "web"] }),
      emptySkills,
      config,
    );
    expect(result.content).toContain('mcp_servers: ["fs", "web"]');
  });

  it("emits unknown number and boolean arrays bare", () => {
    const result = renderClaudeAgent(
      withClaude(agent, { weights: [1, 2, 3], flags: [true, false] }),
      emptySkills,
      config,
    );
    expect(result.content).toContain("weights: [1, 2, 3]");
    expect(result.content).toContain("flags: [true, false]");
  });

  it("emits empty unknown array as []", () => {
    const result = renderClaudeAgent(
      withClaude(agent, { mcp_servers: [] }),
      emptySkills,
      config,
    );
    expect(result.content).toContain("mcp_servers: []");
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
    expect(result.content).not.toMatch(/^nested:/m);
    expect(warnings.some((w) => w.includes('"nested"'))).toBe(true);
    expect(warnings.some((w) => w.includes("object"))).toBe(true);
  });

  it("skips mixed-type array with warning", () => {
    const result = renderClaudeAgent(
      withClaude(agent, { mixed: [1, "a"] }),
      emptySkills,
      config,
    );
    expect(result.content).not.toMatch(/^mixed:/m);
    expect(warnings.some((w) => w.includes('"mixed"'))).toBe(true);
  });

  it("skips non-finite numbers with warning", () => {
    const result = renderClaudeAgent(
      withClaude(agent, { bad: Number.POSITIVE_INFINITY }),
      emptySkills,
      config,
    );
    expect(result.content).not.toMatch(/^bad:/m);
    expect(warnings.some((w) => w.includes('"bad"'))).toBe(true);
  });

  it("skips unsafe keys with warning", () => {
    const result = renderClaudeAgent(
      withClaude(agent, { "bad key!": "x" }),
      emptySkills,
      config,
    );
    expect(result.content).not.toContain("bad key!");
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
    expect(modelLines).toHaveLength(1);
    expect(toolsLines).toHaveLength(1);
    expect(result.content).toContain("tools: Read, Grep, Bash");
  });

  it("JSON-quotes strings containing frontmatter-hostile characters", () => {
    const result = renderClaudeAgent(
      withClaude(agent, { note: 'has "quotes": and #hash' }),
      emptySkills,
      config,
    );
    expect(result.content).toContain('note: "has \\"quotes\\": and #hash"');
  });
});
