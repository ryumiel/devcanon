import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTempDir,
  createConfigFile,
  createTempDir,
} from "../../__test-helpers__/fixtures.js";
import { installTestLogger } from "../../__test-helpers__/logger.js";
import { loadConfig } from "../../config/load.js";
import { renderAll } from "../../render/pipeline.js";
import { readTextFile } from "../../utils/fs.js";
import { newAgentAction } from "./new.js";

describe("newAgentAction", () => {
  let tempDir: string;
  let configPath: string;
  let restore: () => void;

  beforeEach(async () => {
    tempDir = await createTempDir();
    configPath = await createConfigFile(
      tempDir,
      [
        "version: 1",
        "library:",
        "  skillsDir: ./skills",
        "  agentsDir: ./agents",
        "  generatedDir: ./generated",
        "modelTiers:",
        "  standard:",
        "    claude:",
        "      model: claude-sonnet-4-6",
        "      effort: medium",
        "    codex:",
        "      model: gpt-5.4",
        "      reasoning_effort: medium",
      ].join("\n"),
    );
    ({ restore } = installTestLogger());
  });

  afterEach(async () => {
    restore();
    await cleanupTempDir(tempDir);
  });

  it("writes a new agent scaffold using the tier placeholder pattern", async () => {
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

    expect(content).toContain('model: "{{model:standard}}"');
    expect(content).not.toContain("model: sonnet");
    expect(content).toContain("codex:");
    expect(content).toContain('model: "{{model:standard}}"');
  });

  it("renders the scaffold successfully when the standard tier exists", async () => {
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

    expect(claudeAgent?.content).toContain("model: claude-sonnet-4-6");
    expect(claudeAgent?.content).toContain("effort: medium");
    expect(codexAgent?.content).toContain('model = "gpt-5.4"');
    expect(codexAgent?.content).toContain('model_reasoning_effort = "medium"');
  });

  it("uses the first configured tier when standard is missing", async () => {
    const missingStandardConfigPath = await createConfigFile(
      tempDir,
      [
        "version: 1",
        "library:",
        "  skillsDir: ./skills",
        "  agentsDir: ./agents",
        "  generatedDir: ./generated",
        "modelTiers:",
        "  default:",
        "    claude:",
        "      model: claude-haiku-4-5",
        "    codex:",
        "      model: gpt-5.4-mini",
      ].join("\n"),
    );

    await newAgentAction(
      "reviewer",
      {},
      {
        parent: {
          parent: {
            opts: () => ({ config: missingStandardConfigPath }),
          },
        },
      },
    );

    const content = await readTextFile(
      path.join(tempDir, "agents", "reviewer.yaml"),
    );
    expect(content).toContain('model: "{{model:default}}"');
  });

  it("uses the first inserted tier when multiple tiers exist without standard", async () => {
    const multiTierConfigPath = await createConfigFile(
      tempDir,
      [
        "version: 1",
        "library:",
        "  skillsDir: ./skills",
        "  agentsDir: ./agents",
        "  generatedDir: ./generated",
        "modelTiers:",
        "  fast:",
        "    claude:",
        "      model: claude-haiku-4-5",
        "    codex:",
        "      model: gpt-5.4-mini",
        "  deep:",
        "    claude:",
        "      model: claude-opus-4-7",
        "    codex:",
        "      model: gpt-5.4",
      ].join("\n"),
    );

    await newAgentAction(
      "reviewer",
      {},
      {
        parent: {
          parent: {
            opts: () => ({ config: multiTierConfigPath }),
          },
        },
      },
    );

    const content = await readTextFile(
      path.join(tempDir, "agents", "reviewer.yaml"),
    );
    expect(content).toContain('model: "{{model:fast}}"');
    expect(content).not.toContain('model: "{{model:deep}}"');
  });

  it("omits model scaffolding when no model tiers are configured", async () => {
    const noTierConfigPath = await createConfigFile(
      tempDir,
      [
        "version: 1",
        "library:",
        "  skillsDir: ./skills",
        "  agentsDir: ./agents",
        "  generatedDir: ./generated",
      ].join("\n"),
    );

    await newAgentAction(
      "reviewer",
      {},
      {
        parent: {
          parent: {
            opts: () => ({ config: noTierConfigPath }),
          },
        },
      },
    );

    const content = await readTextFile(
      path.join(tempDir, "agents", "reviewer.yaml"),
    );
    expect(content).not.toContain("{{model:");
    expect(content).not.toContain("\n  model:");

    const config = await loadConfig(noTierConfigPath);
    const result = await renderAll(config, false);
    const agentOutputs = result.outputs.filter(
      (output) => output.type === "agent",
    );
    expect(agentOutputs).toHaveLength(2);
  });
});
