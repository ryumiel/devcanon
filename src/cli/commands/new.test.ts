import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  CANONICAL_CAPABILITY_PROFILES,
  cleanupTempDir,
  createConfigFile,
  createTempDir,
  makeConfigYaml,
} from "../../__test-helpers__/fixtures.js";
import { installTestLogger } from "../../__test-helpers__/logger.js";
import { loadConfig } from "../../config/load.js";
import { AgentSourceSchema } from "../../config/schema.js";
import { renderAll } from "../../render/pipeline.js";
import { readTextFile } from "../../utils/fs.js";
import { newAgentAction } from "./new.js";

describe("newAgentAction", () => {
  let tempDir: string;
  let configPath: string;
  let restore: () => void;

  beforeEach(async () => {
    tempDir = await createTempDir();
    configPath = await createConfigFile(tempDir);
    ({ restore } = installTestLogger());
  });

  afterEach(async () => {
    restore();
    await cleanupTempDir(tempDir);
  });

  it("writes a balanced agent scaffold without target model or effort fields", async () => {
    await newAgentAction(
      "reviewer",
      {},
      {
        parent: {
          parent: {
            opts: () => ({ config: configPath }),
          },
        },
      },
    );

    const content = await readTextFile(
      path.join(tempDir, "agents", "reviewer.yaml"),
    );

    expect(content).toContain("capability: balanced");
    expect(content).not.toContain("{{model:");
    expect(content).not.toMatch(/^\s*(model|effort|model_reasoning_effort):/mu);
    expect(content).toContain("codex:");

    const agent = AgentSourceSchema.parse(parseYaml(content));
    expect(agent.capability).toBe("balanced");
    expect(agent.claude).toEqual({ tools: ["Read", "Grep"] });
    expect(agent.codex).toEqual({ sandbox_mode: "read-only" });
  });

  it("renders the scaffold using the balanced profile without inferred effort", async () => {
    await newAgentAction(
      "reviewer",
      {},
      {
        parent: {
          parent: {
            opts: () => ({ config: configPath }),
          },
        },
      },
    );

    const config = await loadConfig(configPath);
    const result = await renderAll(config, false);

    const claudeAgent = result.outputs.find(
      (output) => output.type === "agent" && output.target === "claude",
    );
    const codexAgent = result.outputs.find(
      (output) => output.type === "agent" && output.target === "codex",
    );

    expect(claudeAgent?.content).toContain('model: "claude-sonnet-5"');
    expect(claudeAgent?.content).not.toContain("effort:");
    expect(codexAgent?.content).toContain('model = "gpt-5.6-terra"');
    expect(codexAgent?.content).not.toContain("model_reasoning_effort");
  });

  it("loads config before checking for an existing agent", async () => {
    const legacyConfigPath = await createConfigFile(tempDir, "version: 1\n");
    await mkdir(path.join(tempDir, "agents"), { recursive: true });
    await writeFile(
      path.join(tempDir, "agents", "reviewer.yaml"),
      "existing\n",
      "utf-8",
    );

    await expect(
      newAgentAction(
        "reviewer",
        {},
        {
          parent: {
            parent: {
              opts: () => ({ config: legacyConfigPath }),
            },
          },
        },
      ),
    ).rejects.toThrow(/version 1 is no longer supported/i);
  });

  it("rejects a v2 catalog missing one target model before writing", async () => {
    const invalidConfigPath = await createConfigFile(
      tempDir,
      makeConfigYaml({
        capabilityProfiles: {
          efficient: CANONICAL_CAPABILITY_PROFILES.efficient,
          balanced: CANONICAL_CAPABILITY_PROFILES.balanced,
          frontier: {
            claude: CANONICAL_CAPABILITY_PROFILES.frontier.claude,
          },
        },
      }),
    );

    await expect(
      newAgentAction(
        "reviewer",
        {},
        {
          parent: {
            parent: {
              opts: () => ({ config: invalidConfigPath }),
            },
          },
        },
      ),
    ).rejects.toThrow(/Invalid config/i);

    await expect(
      readTextFile(path.join(tempDir, "agents", "reviewer.yaml")),
    ).rejects.toThrow();
  });

  it("propagates a write failure without replacing a blocking parent path", async () => {
    const blockingAgentsPath = path.join(tempDir, "blocked-agents");
    await writeFile(blockingAgentsPath, "keep me\n", "utf-8");
    const blockedConfigPath = await createConfigFile(
      tempDir,
      makeConfigYaml({
        library: {
          skillsDir: "./skills",
          agentsDir: "./blocked-agents",
          generatedDir: "./generated",
        },
      }),
    );

    await expect(
      newAgentAction(
        "reviewer",
        {},
        {
          parent: {
            parent: {
              opts: () => ({ config: blockedConfigPath }),
            },
          },
        },
      ),
    ).rejects.toThrow();

    expect(await readTextFile(blockingAgentsPath)).toBe("keep me\n");
  });
});
