import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTempDir,
  createConfigFile,
  createTempDir,
  makeConfigYaml,
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
      makeConfigYaml({
        library: {
          skillsDir: "./skills",
          agentsDir: "./agents",
          generatedDir: "./generated",
        },
      }),
    );
    ({ restore } = installTestLogger());
  });

  afterEach(async () => {
    restore();
    await cleanupTempDir(tempDir);
  });

  async function scaffoldReviewer(): Promise<void> {
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
  }

  it("writes a balanced capability scaffold without model placeholders", async () => {
    await scaffoldReviewer();

    const content = await readTextFile(
      path.join(tempDir, "agents", "reviewer.yaml"),
    );
    expect(content).toContain("capability: balanced");
    expect(content).not.toContain("{{model:");
    expect(content).not.toContain("\n  model:");
    expect(content).toContain("codex:");
  });

  it("renders the scaffold through both native targets without inferred effort", async () => {
    await scaffoldReviewer();

    const config = await loadConfig(configPath);
    const result = await renderAll(config, false);
    const claudeAgent = result.outputs.find(
      (output) => output.type === "agent" && output.target === "claude",
    );
    const codexAgent = result.outputs.find(
      (output) => output.type === "agent" && output.target === "codex",
    );

    expect(claudeAgent?.content).toContain(
      `model: ${config.capabilityProfiles.balanced.claude}`,
    );
    expect(claudeAgent?.content).not.toContain("effort:");
    expect(codexAgent?.content).toContain(
      `model = "${config.capabilityProfiles.balanced.codex}"`,
    );
    expect(codexAgent?.content).not.toContain("model_reasoning_effort");
  });
});
