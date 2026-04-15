import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLAUDE_TARGET_FIELDS, type ResolvedConfig } from "../config/schema.js";
import type { LoadedAgent, LoadedSkill } from "../models/types.js";
import { renderClaudeAgent } from "./claude.js";

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
} satisfies ResolvedConfig;

const emptySkills = new Map<string, LoadedSkill>();

describe("renderClaudeAgent", () => {
  it("renders a sample agent to Claude markdown format (snapshot)", () => {
    const result = renderClaudeAgent(agent, emptySkills, config);
    expect(result.content).toMatchSnapshot();
  });

  it("includes managed header", () => {
    const result = renderClaudeAgent(agent, emptySkills, config);
    expect(result.content).toContain(
      "<!-- Managed by agents-manager. Do not edit directly. -->",
    );
    expect(result.content).toContain("<!-- Source: agents/test-agent.yaml -->");
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
    const result = renderClaudeAgent(agent, emptySkills, config);
    const content = result.content;
    const expectedFragments = {
      model: "model: sonnet",
      tools: "tools: Read, Grep, Bash",
    } satisfies Record<(typeof CLAUDE_TARGET_FIELDS)[number], string>;

    for (const field of CLAUDE_TARGET_FIELDS) {
      expect(content).toContain(expectedFragments[field]);
    }
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
