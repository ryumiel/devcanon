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

const RETIRED_AGENTS = [
  "research-agent",
  "spec-compliance-reviewer",
  "code-quality-reviewer",
] as const;

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

const AGENT_SPEC_PATH = "docs/specs/agents.md";
const SOURCE_IMMUTABLE_DIMENSIONS = [
  "durable-file-edit",
  "exact-handoff-command",
  "external-write",
] as const;

type SourceImmutableDimension = (typeof SOURCE_IMMUTABLE_DIMENSIONS)[number];

interface AgentInstructionBoundaryContract {
  dimension: SourceImmutableDimension;
  appliesTo: "source-immutable" | "all roles";
  instruction: string;
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

async function readAgentInstructionBoundaryOwner(): Promise<
  AgentInstructionBoundaryContract[]
> {
  const markdown = await readFile(
    path.join(process.cwd(), AGENT_SPEC_PATH),
    "utf8",
  );
  const section = markdown.match(
    /### Instruction mutation boundaries\n(?<body>[\s\S]*?)(?=\n### |\n## )/,
  )?.groups?.body;
  if (!section) {
    throw new Error(
      "Agent spec instruction mutation boundary owner is missing",
    );
  }

  const rows = [
    ...section.matchAll(/^\| `([^`]+)`\s+\| `([^`]+)`\s+\| `([^`]+)`\s+\|$/gm),
  ].map(([, dimension, appliesTo, instruction]) => ({
    dimension,
    appliesTo,
    instruction,
  }));
  if (
    rows.length !== SOURCE_IMMUTABLE_DIMENSIONS.length ||
    !SOURCE_IMMUTABLE_DIMENSIONS.every(
      (dimension) =>
        rows.filter((row) => row.dimension === dimension).length === 1,
    )
  ) {
    throw new Error(
      "Agent spec instruction mutation boundary owner must define each source-immutable dimension exactly once",
    );
  }
  for (const row of rows) {
    if (
      !SOURCE_IMMUTABLE_DIMENSIONS.includes(
        row.dimension as SourceImmutableDimension,
      ) ||
      (row.appliesTo !== "source-immutable" && row.appliesTo !== "all roles") ||
      !row.instruction
    ) {
      throw new Error(
        "Agent spec instruction mutation boundary row is invalid",
      );
    }
  }
  return rows as AgentInstructionBoundaryContract[];
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

function expectSharedBoundaries(
  instructions: string,
  externalWriteInstruction: string,
): void {
  const normalized = normalizeWhitespace(instructions);
  expect(normalized).toContain("permitted routine commands");
  expect(normalized).toMatch(
    /write exactly one[\s\S]*dispatch-named direct-child \.ephemeral[\s\S]*handoff/,
  );
  expect(normalized).toContain(externalWriteInstruction);
}

function followsInstructionBoundaries(
  instructions: string,
  boundaries: readonly AgentInstructionBoundaryContract[],
): boolean {
  const normalized = normalizeWhitespace(instructions);
  return boundaries.every((boundary) =>
    normalized.includes(boundary.instruction),
  );
}

describe("shipped semantic agents", () => {
  it("matches the documented six-role source catalog and target envelopes", async () => {
    const [roles, boundaries, sources, sourceFiles] = await Promise.all([
      readAgentSemanticRoleOwner(),
      readAgentInstructionBoundaryOwner(),
      readAgentSources(),
      readdir(path.join(process.cwd(), "agents")),
    ]);
    const externalWriteInstruction = boundaries.find(
      (boundary) => boundary.dimension === "external-write",
    )?.instruction;
    expect(externalWriteInstruction).toBeDefined();
    if (!externalWriteInstruction) return;

    expect(roles).toHaveLength(6);
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
      expect(role.externalAuthority).toBe("none");
      expectSharedBoundaries(source.instructions, externalWriteInstruction);

      if (role.sourceAuthority === "source-immutable") {
        const normalized = normalizeWhitespace(source.instructions);
        expect(
          followsInstructionBoundaries(source.instructions, boundaries),
        ).toBe(true);
        expect(normalized).toMatch(
          /Write access exists only for (?:the|that) optional handoff\./,
        );
      }

      if (role.defaultNetwork === "None") {
        expect(normalizeWhitespace(source.instructions)).toContain(
          "Do not use network access.",
        );
      } else if (role.defaultNetwork === "Dispatch-owned") {
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

  it("rejects each single-dimension source-immutable instruction contradiction", async () => {
    const [roles, boundaries, sources] = await Promise.all([
      readAgentSemanticRoleOwner(),
      readAgentInstructionBoundaryOwner(),
      readAgentSources(),
    ]);
    const sourceImmutableRole = roles.find(
      (role) => role.sourceAuthority === "source-immutable",
    );
    const canonicalInstructions = sources.find(
      (source) => source.name === sourceImmutableRole?.name,
    )?.instructions;
    expect(canonicalInstructions).toBeDefined();
    if (!canonicalInstructions) return;
    const normalizedInstructions = normalizeWhitespace(canonicalInstructions);
    const invalidFamilies = [
      {
        dimension: "durable-file-edit",
        contradiction: "You may make durable file edits.",
      },
      {
        dimension: "exact-handoff-command",
        contradiction:
          "You may run unrelated mutating commands while preparing the handoff.",
      },
      {
        dimension: "external-write",
        contradiction: "You may mutate GitHub, Linear, and Notion.",
      },
    ] as const;

    expect(
      followsInstructionBoundaries(normalizedInstructions, boundaries),
    ).toBe(true);
    for (const invalid of invalidFamilies) {
      const ownedInstruction = boundaries.find(
        (boundary) => boundary.dimension === invalid.dimension,
      )?.instruction;
      expect(ownedInstruction).toBeDefined();
      if (!ownedInstruction) continue;
      const mutated = normalizedInstructions.replace(
        ownedInstruction,
        invalid.contradiction,
      );
      expect(
        followsInstructionBoundaries(mutated, boundaries),
        invalid.dimension,
      ).toBe(false);
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
    const [roles, boundaries, config] = await Promise.all([
      readAgentSemanticRoleOwner(),
      readAgentInstructionBoundaryOwner(),
      loadConfigWithFixedSkillsHome(),
    ]);
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
      expect(claudeOutput.content).not.toContain("{{model:");

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
      expect(codexOutput.content).not.toContain("{{model:");

      if (role.sourceAuthority === "source-immutable") {
        const developerInstructions = codexToml.developer_instructions;
        if (typeof developerInstructions !== "string") {
          throw new Error(
            `Missing Codex developer instructions for ${role.name}`,
          );
        }
        for (const boundary of boundaries) {
          expect(normalizeWhitespace(body)).toContain(boundary.instruction);
          expect(normalizeWhitespace(developerInstructions)).toContain(
            boundary.instruction,
          );
        }
      }
    }
  });
});
