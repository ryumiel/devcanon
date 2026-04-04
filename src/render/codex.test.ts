import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ResolvedConfig } from "../config/schema.js";
import type { LoadedAgent, LoadedSkill } from "../models/types.js";
import { renderCodexAgent } from "./codex.js";

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
    codex: { sandbox_mode: "read-only" },
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

describe("renderCodexAgent", () => {
  it("renders a sample agent to Codex TOML format (snapshot)", () => {
    const result = renderCodexAgent(agent, emptySkills, config);
    expect(result.content).toMatchSnapshot();
  });

  it("includes managed comment header", () => {
    const result = renderCodexAgent(agent, emptySkills, config);
    const content = result.content as string;
    expect(content).toContain(
      "# Managed by agents-manager. Do not edit directly.",
    );
    expect(content).toContain("# Source: agents/test-agent.yaml");
  });

  it("includes name, description, and sandbox_mode fields", () => {
    const result = renderCodexAgent(agent, emptySkills, config);
    const content = result.content as string;
    expect(content).toContain('name = "test-agent"');
    expect(content).toContain('description = "A test agent for unit testing."');
    expect(content).toContain('sandbox_mode = "read-only"');
  });

  it("uses triple-quoted literal strings for developer_instructions", () => {
    const result = renderCodexAgent(agent, emptySkills, config);
    const content = result.content as string;
    expect(content).toContain("developer_instructions = '''");
    expect(content).toContain("'''");
    // Verify instructions content is inside the triple quotes
    expect(content).toContain("## Step One");
    expect(content).toContain("## Step Two");
  });

  it("includes skills section in developer_instructions", () => {
    const result = renderCodexAgent(agent, emptySkills, config);
    const content = result.content as string;
    expect(content).toContain("## Skills");
    expect(content).toContain(
      "- **test-skill** (`~/.agents/skills/test-skill`)",
    );
  });

  it("returns correct metadata fields", () => {
    const result = renderCodexAgent(agent, emptySkills, config);
    expect(result.target).toBe("codex");
    expect(result.type).toBe("agent");
    expect(result.name).toBe("test-agent");
    expect(result.sourcePath).toBe("/test/agents/test-agent.yaml");
    expect(result.generatedPath).toBe(
      path.join("/test/generated", "codex", "agents", "test-agent.toml"),
    );
    expect(result.installedPath).toBe(
      path.join("~/.codex/agents", "test-agent.toml"),
    );
  });
});
