import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  cleanupTempDir,
  createAgentFixture,
  createTempDir,
  makeAgentYaml,
} from "../__test-helpers__/fixtures.js";
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
      model: "claude-sonnet-5",
      effort: "high",
    },
    codex: {
      model: "gpt-5.6-terra",
      model_reasoning_effort: "high",
      sandbox_mode: "workspace-write",
    },
  },
  "spec-compliance-reviewer": {
    claude: {
      model: "claude-opus-4-8",
      effort: "xhigh",
    },
    codex: {
      model: "gpt-5.6-sol",
      model_reasoning_effort: "xhigh",
      sandbox_mode: "read-only",
    },
  },
  "code-quality-reviewer": {
    claude: {
      model: "claude-opus-4-8",
      effort: "xhigh",
    },
    codex: {
      model: "gpt-5.6-sol",
      model_reasoning_effort: "xhigh",
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

describe("shipped agents render cleanly", () => {
  it("uses canonical capabilities and explicit effort in shipped source roles", async () => {
    const migratedExpectations = {
      implementer: {
        capability: "balanced",
        claudeEffort: "high",
        codexEffort: "high",
      },
      "spec-compliance-reviewer": {
        capability: "frontier",
        claudeEffort: "xhigh",
        codexEffort: "xhigh",
      },
      "code-quality-reviewer": {
        capability: "frontier",
        claudeEffort: "xhigh",
        codexEffort: "xhigh",
      },
    } as const;

    for (const [name, expected] of Object.entries(migratedExpectations)) {
      const source = parseYaml(
        await readFile(
          path.join(process.cwd(), "agents", `${name}.yaml`),
          "utf8",
        ),
      ) as Record<string, unknown>;
      const claude = source.claude as Record<string, unknown>;
      const codex = source.codex as Record<string, unknown>;

      expect(source.capability).toBe(expected.capability);
      expect(claude).not.toHaveProperty("model");
      expect(claude.effort).toBe(expected.claudeEffort);
      expect(codex).not.toHaveProperty("model");
      expect(codex.model_reasoning_effort).toBe(expected.codexEffort);
    }

    const researchSource = parseYaml(
      await readFile(
        path.join(process.cwd(), "agents", "research-agent.yaml"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(researchSource).not.toHaveProperty("capability");
    expect(researchSource.claude).not.toHaveProperty("model");
    expect(researchSource.claude).not.toHaveProperty("effort");
    expect(researchSource.codex).not.toHaveProperty("model");
    expect(researchSource.codex).not.toHaveProperty("model_reasoning_effort");
  });

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

  it("renders research-agent as a read-only single-scope leaf role", async () => {
    const config = await loadConfigWithFixedSkillsHome();

    const { outputs } = await renderAll(config, false);
    const claudeOutput = getAgentOutput(outputs, "research-agent", "claude");
    const codexOutput = getAgentOutput(outputs, "research-agent", "codex");

    const { frontmatter: claudeFrontmatter, body: claudeInstructions } =
      parseRenderedMarkdownArtifact(claudeOutput.content);
    const claudeTools = (claudeFrontmatter.tools as string)
      .split(",")
      .map((tool) => tool.trim());
    expect(claudeTools).toEqual(["Read", "Grep", "WebFetch", "WebSearch"]);
    expect(claudeTools).not.toContain("Agent");
    expect(claudeTools).not.toContain("Bash");

    const codexToml = parseRenderedTomlArtifact(codexOutput.content);
    expect(codexToml.sandbox_mode).toBe("read-only");
    const codexInstructions = codexToml.developer_instructions as string;

    for (const instructions of [claudeInstructions, codexInstructions]) {
      expect(instructions).toContain(
        "exactly one assigned investigation scope",
      );
      expect(instructions).toContain("Return a concise, source-linked report");
      expect(instructions).toContain("using only the scope-report format");
      expect(instructions).toContain(
        "Do not produce or format a final synthesized issue brief",
      );
      expect(instructions).toContain("even if the caller asks");
      expect(instructions).toContain("caller owns final-brief composition");
      expect(instructions).not.toContain("in the format the caller requests");
      expect(instructions).toContain("Do not delegate");
      expect(instructions).toContain("Do not write or persist artifacts");
      expect(instructions).toContain("Do not emit producer notice lines");
      expect(instructions).not.toContain("parallel sub-investigations");
      expect(instructions).not.toContain(
        "Synthesize findings into a single brief",
      );
    }
  });

  it("renders the efficient capability through a synthetic agent for both targets", async () => {
    const tempDir = await createTempDir();
    try {
      const config = await loadConfigWithFixedSkillsHome();
      config.library.agentsDir = path.join(tempDir, "agents");
      await createAgentFixture(
        config.library.agentsDir,
        "efficient-capability-probe",
        makeAgentYaml("efficient-capability-probe", {
          capability: "efficient",
          codex: { sandbox_mode: "read-only" },
        }),
      );

      const { outputs } = await renderAll(config, false);
      const claudeOutput = getAgentOutput(
        outputs,
        "efficient-capability-probe",
        "claude",
      );
      const codexOutput = getAgentOutput(
        outputs,
        "efficient-capability-probe",
        "codex",
      );

      expect(
        parseRenderedMarkdownArtifact(claudeOutput.content).frontmatter,
      ).toMatchObject({
        name: "efficient-capability-probe",
        model: "claude-haiku-4-5-20251001",
      });
      expect(
        parseRenderedMarkdownArtifact(claudeOutput.content).frontmatter,
      ).not.toHaveProperty("effort");
      expect(parseRenderedTomlArtifact(codexOutput.content)).toMatchObject({
        name: "efficient-capability-probe",
        model: "gpt-5.6-luna",
        sandbox_mode: "read-only",
      });
      expect(parseRenderedTomlArtifact(codexOutput.content)).not.toHaveProperty(
        "model_reasoning_effort",
      );
      expect(claudeOutput.content).not.toContain("{{model:");
      expect(codexOutput.content).not.toContain("{{model:");
    } finally {
      await cleanupTempDir(tempDir);
    }
  });
});
