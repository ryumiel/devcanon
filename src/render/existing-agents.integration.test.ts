import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { readAgentSemanticRoleOwner } from "../__test-helpers__/agent-routing-policy.js";
import {
  parseRenderedMarkdownArtifact,
  parseRenderedTomlArtifact,
} from "../__test-helpers__/render.js";
import { loadConfig } from "../config/load.js";
import type { ResolvedConfig } from "../config/schema.js";
import { renderAll } from "./pipeline.js";

interface AgentSourceFixture {
  name: string;
  description: string;
  instructions: string;
  capability: "efficient" | "balanced" | "frontier";
  claude: {
    model?: string;
    effort: string;
    tools: string[];
  };
  codex: {
    model?: string;
    model_reasoning_effort: string;
    sandbox_mode: string;
  };
}

type RenderOutput = Awaited<ReturnType<typeof renderAll>>["outputs"][number];

async function readAgentSources(): Promise<AgentSourceFixture[]> {
  const agentsDir = path.join(process.cwd(), "agents");
  const entries = (await readdir(agentsDir))
    .filter((entry) => entry.endsWith(".yaml"))
    .sort();

  return Promise.all(
    entries.map(async (entry) =>
      parseYaml(await readFile(path.join(agentsDir, entry), "utf8")),
    ),
  ) as Promise<AgentSourceFixture[]>;
}

async function loadConfigWithFixedSkillsHome(): Promise<ResolvedConfig> {
  const config = await loadConfig(
    path.join(process.cwd(), "devcanon.config.yaml"),
    true,
  );
  config.targets.claude.skillsHome = "/test/claude/skills";
  config.targets.codex.skillsHome = "/test/codex/skills";
  return config;
}

function getAgentOutput(
  outputs: RenderOutput[],
  name: string,
  target: "claude" | "codex",
) {
  const output = outputs.find(
    (candidate) =>
      candidate.type === "agent" &&
      candidate.name === name &&
      candidate.target === target,
  );
  if (!output) {
    throw new Error(`Missing rendered ${target} output for agent ${name}`);
  }
  return output;
}

describe("shipped semantic agents", () => {
  it("matches the structurally parsed role catalog and target envelopes", async () => {
    const [roles, sources, sourceFiles] = await Promise.all([
      readAgentSemanticRoleOwner(),
      readAgentSources(),
      readdir(path.join(process.cwd(), "agents")).then((entries) =>
        entries.filter((entry) => entry.endsWith(".yaml")),
      ),
    ]);

    expect(sourceFiles.sort()).toEqual(
      roles.map((role) => `${role.name}.yaml`).sort(),
    );
    expect(sources.map((source) => source.name).sort()).toEqual(
      roles.map((role) => role.name).sort(),
    );

    for (const role of roles) {
      const source = sources.find((candidate) => candidate.name === role.name);
      expect(source, `missing source role ${role.name}`).toBeDefined();
      if (!source) continue;

      expect(source.capability).toBe(role.capability);
      expect(source.claude).not.toHaveProperty("model");
      expect(source.claude.effort).toBe(role.claudeEffort);
      expect(source.claude.tools).toEqual(role.claudeTools);
      expect(source.codex).not.toHaveProperty("model");
      expect(source.codex.model_reasoning_effort).toBe(role.codexEffort);
      expect(source.codex.sandbox_mode).toBe(role.codexSandbox);
    }
  });

  it("renders every catalog role to both target formats", async () => {
    const [roles, config] = await Promise.all([
      readAgentSemanticRoleOwner(),
      loadConfigWithFixedSkillsHome(),
    ]);
    const { outputs, agents } = await renderAll(config, false, true);
    const agentOutputs = outputs.filter((output) => output.type === "agent");

    expect(agentOutputs).toHaveLength(roles.length * 2);

    for (const role of roles) {
      const source = agents.find((agent) => agent.name === role.name)?.source;
      expect(source, `missing loaded role ${role.name}`).toBeDefined();
      if (!source) continue;

      const claudeOutput = getAgentOutput(agentOutputs, role.name, "claude");
      const codexOutput = getAgentOutput(agentOutputs, role.name, "codex");
      const { frontmatter, body } = parseRenderedMarkdownArtifact(
        claudeOutput.content,
      );
      const codexToml = parseRenderedTomlArtifact(codexOutput.content);

      expect(frontmatter).toEqual({
        name: role.name,
        description: source.description,
        tools: role.claudeTools.join(", "),
        model: config.capabilityProfiles[role.capability].claude,
        effort: role.claudeEffort,
      });
      expect(body).toContain(source.instructions.trim());

      expect(codexToml).toEqual({
        name: role.name,
        description: source.description,
        model: config.capabilityProfiles[role.capability].codex,
        model_reasoning_effort: role.codexEffort,
        sandbox_mode: role.codexSandbox,
        developer_instructions: expect.stringContaining(
          source.instructions.trim(),
        ),
      });
      expect(claudeOutput.content).not.toContain("{{model:");
      expect(codexOutput.content).not.toContain("{{model:");
    }
  });
});
