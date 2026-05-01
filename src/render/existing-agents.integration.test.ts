import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config/load.js";
import { parseFrontmatter } from "./frontmatter.js";
import { renderAll } from "./pipeline.js";

const SHIPPED_AGENTS = [
  "implementer",
  "spec-compliance-reviewer",
  "code-quality-reviewer",
] as const;

describe("shipped agents render cleanly", () => {
  it("renders every shipped agent to both targets", async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "agents-manager.config.yaml"),
    );

    const { outputs } = await renderAll(config, false);
    const agentOutputs = outputs.filter((o) => o.type === "agent");

    expect(agentOutputs).toHaveLength(SHIPPED_AGENTS.length * 2);
    for (const output of agentOutputs) {
      expect(SHIPPED_AGENTS).toContain(output.name);
    }
  });

  it("resolves {{model:standard}} on both targets and snapshots output", async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "agents-manager.config.yaml"),
    );

    const { outputs } = await renderAll(config, false);

    for (const name of SHIPPED_AGENTS) {
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
        model: "claude-sonnet-4-7",
        effort: "medium",
      });
      expect(claudeOutput.content).not.toContain("{{model:");
      expect(claudeOutput.content).toMatchSnapshot(`${name}-claude`);

      expect(codexOutput.content).toContain(`name = "${name}"`);
      expect(codexOutput.content).toContain('model = "gpt-5.4"');
      expect(codexOutput.content).toContain(
        'model_reasoning_effort = "medium"',
      );
      expect(codexOutput.content).not.toContain("{{model:");
      expect(codexOutput.content).toMatchSnapshot(`${name}-codex`);
    }
  });
});
