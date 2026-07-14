import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  parseRenderedMarkdownArtifact,
  parseRenderedTomlArtifact,
} from "../__test-helpers__/render.js";
import { loadConfig } from "../config/load.js";
import type { ResolvedConfig } from "../config/schema.js";
import { renderAll } from "./pipeline.js";

const RETIRED_AGENTS = [
  "research-agent",
  "spec-compliance-reviewer",
  "code-quality-reviewer",
] as const;

interface SemanticRoleContract {
  name: string;
  capability: "efficient" | "balanced" | "frontier";
  claudeEffort: string;
  codexEffort: string;
  sourceDefault: "source-immutable" | "source-mutable";
  externalDefault: "none";
}

interface ToolContract {
  name: string;
  claudeTools: string[];
  codexSandbox: string;
  defaultNetwork: "None" | "Dispatch-owned" | "Task-owned";
}

interface AgentSourceFixture {
  name: string;
  description: string;
  instructions: string;
  skills: string[];
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

function tableCells(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim().replaceAll("`", ""));
}

function tableRowsAfter(markdown: string, heading: string): string[][] {
  const sectionStart = markdown.indexOf(heading);
  if (sectionStart === -1)
    throw new Error(`Missing contract heading: ${heading}`);

  const lines = markdown.slice(sectionStart + heading.length).split("\n");
  const headerIndex = lines.findIndex((line) => line.startsWith("| Agent"));
  if (headerIndex === -1)
    throw new Error(`Missing contract table after: ${heading}`);

  const rows: string[][] = [];
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.startsWith("|")) break;
    rows.push(tableCells(line));
  }
  return rows;
}

function parseSemanticRoleContract(markdown: string): SemanticRoleContract[] {
  return tableRowsAfter(markdown, "## Semantic role catalog").map((cells) => ({
    name: cells[0],
    capability: cells[1] as SemanticRoleContract["capability"],
    claudeEffort: cells[2],
    codexEffort: cells[3],
    sourceDefault: cells[4] as SemanticRoleContract["sourceDefault"],
    externalDefault: cells[5] as SemanticRoleContract["externalDefault"],
  }));
}

function parseToolContract(markdown: string): ToolContract[] {
  return tableRowsAfter(markdown, "### Tool and sandbox behavior").map(
    (cells) => ({
      name: cells[0],
      claudeTools: cells[1].split(",").map((tool) => tool.trim()),
      codexSandbox: cells[2],
      defaultNetwork: cells[3] as ToolContract["defaultNetwork"],
    }),
  );
}

async function readContract() {
  const markdown = await readFile(
    path.join(process.cwd(), "docs", "specs", "agents.md"),
    "utf8",
  );
  return {
    roles: parseSemanticRoleContract(markdown),
    tools: parseToolContract(markdown),
  };
}

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

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function expectSharedBoundaries(instructions: string): void {
  const normalized = normalizeWhitespace(instructions);
  expect(normalized).toContain("permitted routine commands");
  expect(normalized).toMatch(
    /write exactly one[\s\S]*dispatch-named direct-child \.ephemeral[\s\S]*handoff/,
  );
  expect(normalized).toContain(
    "Do not mutate GitHub, Linear, Notion, or any other external system.",
  );
}

describe("shipped semantic agents", () => {
  it("matches the documented six-role source catalog and target envelopes", async () => {
    const [{ roles, tools }, sources, sourceFiles] = await Promise.all([
      readContract(),
      readAgentSources(),
      readdir(path.join(process.cwd(), "agents")),
    ]);
    const toolsByName = new Map(
      tools.map((contract) => [contract.name, contract]),
    );

    expect(roles).toHaveLength(6);
    expect(tools).toHaveLength(6);
    expect(sourceFiles.sort()).toEqual(
      roles.map((role) => `${role.name}.yaml`).sort(),
    );
    expect(sources.map((source) => source.name).sort()).toEqual(
      roles.map((role) => role.name).sort(),
    );

    for (const role of roles) {
      const source = sources.find((candidate) => candidate.name === role.name);
      const toolContract = toolsByName.get(role.name);
      expect(source, `missing source role ${role.name}`).toBeDefined();
      expect(toolContract, `missing tool contract ${role.name}`).toBeDefined();
      if (!source || !toolContract) continue;

      expect(source.capability).toBe(role.capability);
      expect(source.claude).not.toHaveProperty("model");
      expect(source.claude.effort).toBe(role.claudeEffort);
      expect(source.claude.tools).toEqual(toolContract.claudeTools);
      expect(source.codex).not.toHaveProperty("model");
      expect(source.codex.model_reasoning_effort).toBe(role.codexEffort);
      expect(source.codex.sandbox_mode).toBe(toolContract.codexSandbox);
      expect(role.externalDefault).toBe("none");
      expectSharedBoundaries(source.instructions);

      if (role.sourceDefault === "source-immutable") {
        const normalized = normalizeWhitespace(source.instructions);
        expect(normalized).toContain(
          "Do not modify durable source, tests, configuration, or documentation.",
        );
        expect(normalized).toMatch(
          /Write access exists only for (?:the|that) optional handoff\./,
        );
      }

      if (toolContract.defaultNetwork === "None") {
        expect(normalizeWhitespace(source.instructions)).toContain(
          "Do not use network access.",
        );
      } else if (toolContract.defaultNetwork === "Dispatch-owned") {
        expect(normalizeWhitespace(source.instructions)).toContain(
          "Use network access only when the dispatch explicitly names external research",
        );
      } else {
        expect(normalizeWhitespace(source.instructions)).toContain(
          "Use network access only when the task explicitly authorizes and owns it.",
        );
      }
    }
  });

  it("keeps specialized mutation and leaf-role boundaries in neutral instructions", async () => {
    const sources = await readAgentSources();
    const byName = new Map(sources.map((source) => [source.name, source]));
    const investigator = byName.get("investigator");
    const executor = byName.get("executor");
    const implementer = byName.get("implementer");
    const reviewer = byName.get("reviewer");
    const deepReviewer = byName.get("deep-reviewer");
    const investigatorInstructions = normalizeWhitespace(
      investigator?.instructions ?? "",
    );
    const executorInstructions = normalizeWhitespace(
      executor?.instructions ?? "",
    );
    const implementerInstructions = normalizeWhitespace(
      implementer?.instructions ?? "",
    );

    expect(investigatorInstructions).toContain("handoff for diagnostics");
    expect(investigatorInstructions).toContain("Do not delegate, orchestrate");
    expect(investigatorInstructions).toContain("persist ambient artifacts");
    expect(investigatorInstructions).toContain("final-owner synthesis");

    expect(executorInstructions).toContain(
      "exact validated no-policy operation",
    );
    expect(executorInstructions).toContain("exact dispatch-authorized paths");
    expect(executorInstructions).toContain("within every stated guardrail");
    expect(executorInstructions).toContain("Stop and hand off");
    expect(executorInstructions).toContain("judgment or policy appears");

    expect(implementer?.skills).toEqual(["play-tdd", "play-verification"]);
    expect(implementerInstructions).toContain(
      "Follow TDD when the task says to",
    );
    expect(implementerInstructions).toContain("Commit your own work");
    expect(implementerInstructions).toContain(
      "Self-review before reporting back",
    );
    expect(implementerInstructions).toContain(
      "DONE, DONE_WITH_CONCERNS, BLOCKED, NEEDS_CONTEXT",
    );

    for (const source of [reviewer, deepReviewer]) {
      expect(source?.instructions).not.toMatch(
        /base\.\.head|line by line|Blocking|Nit|spec-compliance|code-quality/,
      );
    }
  });

  it("renders and parses exactly six configured roles for both targets", async () => {
    const [{ roles, tools }, config] = await Promise.all([
      readContract(),
      loadConfigWithFixedSkillsHome(),
    ]);
    const toolsByName = new Map(
      tools.map((contract) => [contract.name, contract]),
    );
    const { outputs, agents } = await renderAll(config, false, true);
    const agentOutputs = outputs.filter((output) => output.type === "agent");
    const renderedNames = agentOutputs.map((output) => output.name);
    const renderedFiles = agentOutputs
      .map((output) => path.basename(output.generatedPath))
      .sort();

    expect(agentOutputs).toHaveLength(12);
    expect(renderedFiles).toEqual(
      roles.flatMap((role) => [`${role.name}.md`, `${role.name}.toml`]).sort(),
    );
    expect(new Set(renderedNames)).toEqual(
      new Set(roles.map((role) => role.name)),
    );
    for (const retired of RETIRED_AGENTS) {
      expect(agents.map((agent) => agent.name)).not.toContain(retired);
      expect(renderedNames).not.toContain(retired);
    }

    for (const role of roles) {
      const source = agents.find((agent) => agent.name === role.name)?.source;
      const toolContract = toolsByName.get(role.name);
      expect(source, `missing loaded role ${role.name}`).toBeDefined();
      expect(toolContract, `missing tool contract ${role.name}`).toBeDefined();
      if (!source || !toolContract) continue;

      const claudeOutput = getAgentOutput(agentOutputs, role.name, "claude");
      const codexOutput = getAgentOutput(agentOutputs, role.name, "codex");
      const { frontmatter, body } = parseRenderedMarkdownArtifact(
        claudeOutput.content,
      );
      const codexToml = parseRenderedTomlArtifact(codexOutput.content);

      expect(frontmatter).toEqual({
        name: role.name,
        description: source.description,
        tools: toolContract.claudeTools.join(", "),
        model: config.capabilityProfiles[role.capability].claude,
        effort: role.claudeEffort,
      });
      expect(body).toContain(source.instructions.trim());
      expect(claudeOutput.content).not.toContain("{{model:");

      expect(codexToml).toEqual({
        name: role.name,
        description: source.description,
        model: config.capabilityProfiles[role.capability].codex,
        model_reasoning_effort: role.codexEffort,
        sandbox_mode: toolContract.codexSandbox,
        developer_instructions: expect.stringContaining(
          source.instructions.trim(),
        ),
      });
      expect(codexOutput.content).not.toContain("{{model:");
    }
  });
});
