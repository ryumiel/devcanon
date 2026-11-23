import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { readAgentSemanticRoleOwner } from "../__test-helpers__/agent-routing-policy.js";
import {
  cleanupTempDir,
  createTempDir,
  makeConfigYaml,
  providerFromRuntimeFixture,
} from "../__test-helpers__/fixtures.js";
import {
  parseRenderedMarkdownArtifact,
  parseRenderedTomlArtifact,
} from "../__test-helpers__/render.js";
import { loadConfig } from "../config/load.js";
import type { ModelProfile, ResolvedConfig } from "../config/schema.js";
import { sync } from "../install/sync.js";
import { renderAll as renderAllWithProvider } from "./pipeline.js";

interface AgentSourceFixture {
  name: string;
  description: string;
  instructions: string;
  capability: "efficient" | "balanced" | "frontier";
  claude: {
    modelProfile?: ModelProfile;
    effort?: string;
    tools: string[];
  };
  codex: {
    modelProfile?: ModelProfile;
    model_reasoning_effort?: string;
    sandbox_mode: string;
  };
}

async function renderAll(
  config: ResolvedConfig,
  writeToGenerated = true,
  strict = false,
  targetFilter?: "claude" | "codex",
) {
  return renderAllWithProvider(
    config,
    await providerFromRuntimeFixture(
      path.join(config.library.skillsDir, "devcanon-runtime"),
    ),
    writeToGenerated,
    strict,
    targetFilter,
  );
}

const PINNED_CODEX_ROLES = new Set([
  "architect",
  "assessor",
  "investigator",
  "implementer",
  "reviewer",
  "deep-reviewer",
]);

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
      expect(source.claude.modelProfile).toBe(role.capability);
      if (PINNED_CODEX_ROLES.has(role.name)) {
        const profile =
          role.name === "implementer"
            ? "implementation"
            : role.name === "reviewer"
              ? "balanced"
              : role.capability;
        expect(source.codex.modelProfile).toBe(profile);
        expect(source.codex.model_reasoning_effort).toBe(role.routeEffort);
      } else {
        expect(source.codex).not.toHaveProperty("modelProfile");
        expect(source.codex).not.toHaveProperty("model_reasoning_effort");
      }
      expect(source.codex.sandbox_mode).toBe(role.codexSandbox);
    }
  });

  it("renders every catalog role to both target formats", async () => {
    const [roles, config] = await Promise.all([
      readAgentSemanticRoleOwner(),
      loadConfigWithFixedSkillsHome(),
    ]);
    config.modelProfiles.efficient = {
      codex: "codex-efficient-check",
      claude: "claude-efficient-check",
    };
    config.modelProfiles.balanced = {
      codex: "codex-balanced-check",
      claude: "claude-balanced-check",
    };
    config.modelProfiles.frontier = {
      codex: "codex-frontier-check",
      claude: "claude-frontier-check",
    };
    config.modelProfiles.implementation = {
      codex: "codex-implementation-check",
    };
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
        model: config.modelProfiles[role.capability].claude,
        ...(role.claudeEffort === undefined
          ? {}
          : { effort: role.claudeEffort }),
      });
      if (role.name === "executor") {
        expect(frontmatter).not.toHaveProperty("effort");
      }
      expect(body).toContain(source.instructions.trim());

      expect(codexToml).toEqual({
        name: role.name,
        description: source.description,
        ...(PINNED_CODEX_ROLES.has(role.name)
          ? {
              model:
                config.modelProfiles[
                  source.codex?.modelProfile ?? role.capability
                ].codex,
              model_reasoning_effort: role.routeEffort,
            }
          : {}),
        sandbox_mode: role.codexSandbox,
        developer_instructions: expect.stringContaining(
          source.instructions.trim(),
        ),
      });
      if (!PINNED_CODEX_ROLES.has(role.name)) {
        expect(codexToml).not.toHaveProperty("model");
        expect(codexToml).not.toHaveProperty("model_reasoning_effort");
      }
      expect(claudeOutput.content).not.toContain("{{model:");
      expect(codexOutput.content).not.toContain("{{model:");
    }
  });
  it("updates installed agents, dispatch bindings, and catalog after only a config edit", async () => {
    const temp = await createTempDir();
    const configPath = path.join(temp, "devcanon.config.yaml");
    const source = await loadConfigWithFixedSkillsHome();
    const provider = await providerFromRuntimeFixture(
      path.join(source.library.skillsDir, "devcanon-runtime"),
    );
    const claudeSkillsHome = path.join(temp, "claude", "skills");
    const codexSkillsHome = path.join(temp, "codex", "skills");
    const codexAgentsHome = path.join(temp, "codex", "agents");
    const options = { dryRun: false, force: false, strict: true };
    const writeConfig = (modelProfiles: ResolvedConfig["modelProfiles"]) =>
      writeFile(
        configPath,
        makeConfigYaml({
          library: {
            ...source.library,
            generatedDir: path.join(temp, "generated"),
          },
          targets: {
            claude: {
              skillsHome: claudeSkillsHome,
              agentsHome: path.join(temp, "claude", "agents"),
              installMode: "copy",
            },
            codex: {
              skillsHome: codexSkillsHome,
              agentsHome: codexAgentsHome,
              installMode: "copy",
            },
          },
          manifest: { path: path.join(temp, "manifest.json") },
          toolNames: source.toolNames,
          fileArtifacts: source.fileArtifacts,
          modelProfiles,
        }),
      );
    try {
      await writeConfig(source.modelProfiles);
      expect(
        await sync(await loadConfig(configPath), options, provider),
      ).toMatchObject({
        errors: [],
        conflicts: 0,
      });
      const updatedProfiles = {
        ...source.modelProfiles,
        balanced: {
          ...source.modelProfiles.balanced,
          codex: "updated-balanced-model",
        },
        implementation: { codex: "updated-implementation-model" },
      };
      await writeConfig(updatedProfiles);
      expect(
        await sync(await loadConfig(configPath), options, provider),
      ).toMatchObject({
        errors: [],
        conflicts: 0,
      });
      for (const [role, model] of [
        ["reviewer", updatedProfiles.balanced.codex],
        ["implementer", updatedProfiles.implementation.codex],
      ]) {
        const content = await readFile(
          path.join(codexAgentsHome, `${role}.toml`),
          "utf8",
        );
        expect(parseRenderedTomlArtifact(content).model).toBe(model);
      }
      for (const root of [claudeSkillsHome, codexSkillsHome]) {
        const workflow = await readFile(
          path.join(root, "play-subagent-execution", "SKILL.md"),
          "utf8",
        );
        const catalog = await readFile(
          path.join(root, "devcanon-runtime", "config", "runtime-config.json"),
          "utf8",
        );
        expect(workflow).toContain(
          'TASK_SPEC_REVIEW_MODEL = "updated-balanced-model"',
        );
        expect(workflow).toContain(
          "`DEFAULT_IMPLEMENTATION_MODEL` = `updated-implementation-model`",
        );
        expect(JSON.parse(catalog).modelProfiles).toEqual(updatedProfiles);
      }
    } finally {
      await cleanupTempDir(temp);
    }
  });
});
