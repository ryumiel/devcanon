import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseRenderedMarkdownArtifact,
  parseRenderedTomlArtifact,
} from "../__test-helpers__/render.js";
import { loadConfig } from "../config/load.js";
import type { ResolvedConfig } from "../config/schema.js";
import { renderAll } from "./pipeline.js";

const SHIPPED_AGENTS = [
  "implementer",
  "spec-compliance-reviewer",
  "code-quality-reviewer",
  "research-agent",
] as const;

type ShippedAgent = (typeof SHIPPED_AGENTS)[number];
type RenderOutput = Awaited<ReturnType<typeof renderAll>>["outputs"][number];
type ShippedAgentExpectations = Record<
  ShippedAgent,
  {
    claude: { model?: string; effort?: string };
    codex: {
      model?: string;
      model_reasoning_effort?: string;
      sandbox_mode: string;
    };
  }
>;

const SHIPPED_AGENT_EXPECTATIONS: ShippedAgentExpectations = {
  implementer: {
    claude: {
      model: "claude-sonnet-4-6",
      effort: "high",
    },
    codex: {
      model: "gpt-5.5",
      model_reasoning_effort: "medium",
      sandbox_mode: "workspace-write",
    },
  },
  "spec-compliance-reviewer": {
    claude: {
      model: "claude-opus-4-7",
      effort: "xhigh",
    },
    codex: {
      model: "gpt-5.5",
      model_reasoning_effort: "high",
      sandbox_mode: "read-only",
    },
  },
  "code-quality-reviewer": {
    claude: {
      model: "claude-opus-4-7",
      effort: "xhigh",
    },
    codex: {
      model: "gpt-5.5",
      model_reasoning_effort: "high",
      sandbox_mode: "read-only",
    },
  },
  "research-agent": {
    claude: {},
    codex: {
      sandbox_mode: "read-only",
    },
  },
};

async function loadConfigWithFixedSkillsHome(): Promise<ResolvedConfig> {
  const config = await loadConfig(
    path.join(process.cwd(), "devcanon.config.yaml"),
  );
  config.targets.claude.skillsHome = "/test/claude/skills";
  config.targets.codex.skillsHome = "/test/codex/skills";
  return config;
}

function getAgentOutput(
  outputs: RenderOutput[],
  name: ShippedAgent,
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

  it("renders parseable target-native role settings for every shipped agent", async () => {
    const config = await loadConfigWithFixedSkillsHome();

    const { outputs } = await renderAll(config, false);

    expect(Object.keys(SHIPPED_AGENT_EXPECTATIONS).sort()).toEqual(
      [...SHIPPED_AGENTS].sort(),
    );

    for (const name of SHIPPED_AGENTS) {
      const expected = SHIPPED_AGENT_EXPECTATIONS[name];
      const claudeOutput = getAgentOutput(outputs, name, "claude");
      const codexOutput = getAgentOutput(outputs, name, "codex");

      const { frontmatter: claudeFrontmatter, body: claudeBody } =
        parseRenderedMarkdownArtifact(claudeOutput.content);
      expect(claudeFrontmatter).toMatchObject({
        name,
        ...expected.claude,
      });
      if (expected.claude.model === undefined) {
        expect(claudeFrontmatter).not.toHaveProperty("model");
      }
      if (expected.claude.effort === undefined) {
        expect(claudeFrontmatter).not.toHaveProperty("effort");
      }
      expect(claudeBody.trim()).not.toHaveLength(0);
      expect(claudeOutput.content).not.toContain("{{model:");

      const codexToml = parseRenderedTomlArtifact(codexOutput.content);
      expect(codexToml).toMatchObject({
        name,
        ...expected.codex,
      });
      if (expected.codex.model === undefined) {
        expect(codexToml).not.toHaveProperty("model");
      }
      if (expected.codex.model_reasoning_effort === undefined) {
        expect(codexToml).not.toHaveProperty("model_reasoning_effort");
      }
      expect(codexToml.developer_instructions).toEqual(expect.any(String));
      expect(
        (codexToml.developer_instructions as string).trim(),
      ).not.toHaveLength(0);
      expect(codexOutput.content).not.toContain("{{model:");
    }
  });
});
