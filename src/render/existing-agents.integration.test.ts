import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config/load.js";
import type { ResolvedConfig } from "../config/schema.js";
import { parseFrontmatter } from "./frontmatter.js";
import { renderAll } from "./pipeline.js";

const SHIPPED_AGENTS = [
  "implementer",
  "spec-compliance-reviewer",
  "code-quality-reviewer",
  "research-agent",
] as const;

async function loadConfigWithFixedSkillsHome(): Promise<ResolvedConfig> {
  const config = await loadConfig(
    path.join(process.cwd(), "devcanon.config.yaml"),
  );
  config.targets.claude.skillsHome = "/test/claude/skills";
  config.targets.codex.skillsHome = "/test/codex/skills";
  return config;
}

describe("shipped agents render cleanly", () => {
  it("renders every shipped agent to both targets", async () => {
    const config = await loadConfigWithFixedSkillsHome();

    const { outputs } = await renderAll(config, false);
    const agentOutputs = outputs.filter((o) => o.type === "agent");

    expect(agentOutputs).toHaveLength(SHIPPED_AGENTS.length * 2);
    for (const output of agentOutputs) {
      expect(SHIPPED_AGENTS).toContain(output.name);
    }
  });

  it("resolves model tiers on both targets and snapshots output", async () => {
    const config = await loadConfigWithFixedSkillsHome();

    const { outputs } = await renderAll(config, false);

    const STANDARD_AGENTS = ["implementer"] as const;
    const DEEP_AGENTS = [
      "spec-compliance-reviewer",
      "code-quality-reviewer",
    ] as const;
    const MODEL_UNSET_AGENTS = ["research-agent"] as const;

    expect(
      [...STANDARD_AGENTS, ...DEEP_AGENTS, ...MODEL_UNSET_AGENTS].sort(),
    ).toEqual([...SHIPPED_AGENTS].sort());

    for (const name of STANDARD_AGENTS) {
      const claudeOutput = outputs.find(
        (o) => o.type === "agent" && o.target === "claude" && o.name === name,
      );
      const codexOutput = outputs.find(
        (o) => o.type === "agent" && o.target === "codex" && o.name === name,
      );
      if (!claudeOutput || !codexOutput) {
        throw new Error(`Missing rendered output for shipped agent ${name}`);
      }

      const { frontmatter: claudeFrontmatter } = parseFrontmatter(
        claudeOutput.content,
      );
      expect(claudeFrontmatter).toMatchObject({
        name,
        model: "claude-sonnet-4-6",
        effort: "high",
      });
      expect(claudeOutput.content).not.toContain("{{model:");
      expect(claudeOutput.content).toMatchSnapshot(`${name}-claude`);

      expect(codexOutput.content).toContain(`name = "${name}"`);
      expect(codexOutput.content).toContain('model = "gpt-5.5"');
      expect(codexOutput.content).toContain(
        'model_reasoning_effort = "medium"',
      );
      expect(codexOutput.content).not.toContain("{{model:");
      expect(codexOutput.content).toMatchSnapshot(`${name}-codex`);
    }

    for (const name of DEEP_AGENTS) {
      const claudeOutput = outputs.find(
        (o) => o.type === "agent" && o.target === "claude" && o.name === name,
      );
      const codexOutput = outputs.find(
        (o) => o.type === "agent" && o.target === "codex" && o.name === name,
      );
      if (!claudeOutput || !codexOutput) {
        throw new Error(`Missing rendered output for shipped agent ${name}`);
      }

      const { frontmatter: claudeFrontmatter } = parseFrontmatter(
        claudeOutput.content,
      );
      expect(claudeFrontmatter).toMatchObject({
        name,
        model: "claude-opus-4-7",
        effort: "xhigh",
      });
      expect(claudeOutput.content).not.toContain("{{model:");
      expect(claudeOutput.content).toMatchSnapshot(`${name}-claude`);

      expect(codexOutput.content).toContain(`name = "${name}"`);
      expect(codexOutput.content).toContain('model = "gpt-5.5"');
      expect(codexOutput.content).toContain('model_reasoning_effort = "high"');
      expect(codexOutput.content).not.toContain("{{model:");
      expect(codexOutput.content).toMatchSnapshot(`${name}-codex`);
    }

    for (const name of MODEL_UNSET_AGENTS) {
      const claudeOutput = outputs.find(
        (o) => o.type === "agent" && o.target === "claude" && o.name === name,
      );
      const codexOutput = outputs.find(
        (o) => o.type === "agent" && o.target === "codex" && o.name === name,
      );
      if (!claudeOutput || !codexOutput) {
        throw new Error(`Missing rendered output for shipped agent ${name}`);
      }

      const { frontmatter: claudeFrontmatter } = parseFrontmatter(
        claudeOutput.content,
      );
      expect(claudeFrontmatter).not.toHaveProperty("model");
      expect(claudeFrontmatter).not.toHaveProperty("effort");
      expect(claudeOutput.content).not.toContain("{{model:");
      expect(claudeOutput.content).not.toMatch(/^model:/m);
      expect(claudeOutput.content).toMatchSnapshot(`${name}-claude`);

      expect(codexOutput.content).toContain(`name = "${name}"`);
      expect(codexOutput.content).toContain('sandbox_mode = "read-only"');
      expect(codexOutput.content).not.toMatch(/^model = /m);
      expect(codexOutput.content).not.toMatch(/^model_reasoning_effort = /m);
      expect(codexOutput.content).not.toContain("{{model:");
      expect(codexOutput.content).toMatchSnapshot(`${name}-codex`);
    }
  });
});
