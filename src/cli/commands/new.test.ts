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
import { UserError } from "../../utils/errors.js";
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
        "      model: claude-sonnet-4-7",
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

    expect(claudeAgent?.content).toContain("model: claude-sonnet-4-7");
    expect(claudeAgent?.content).toContain("effort: medium");
    expect(codexAgent?.content).toContain('model = "gpt-5.4"');
    expect(codexAgent?.content).toContain('model_reasoning_effort = "medium"');
  });

  it("fails with targeted guidance when the standard tier is missing", async () => {
    const missingStandardConfigPath = await createConfigFile(
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
        "      model: claude-haiku-4",
        "    codex:",
        "      model: gpt-5.4-mini",
      ].join("\n"),
    );

    await expect(
      newAgentAction(
        "reviewer",
        {},
        {
          parent: {
            parent: {
              opts: () => ({ config: missingStandardConfigPath }),
            },
          },
        },
      ),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(UserError);
      expect((err as UserError).message).toContain("modelTiers.standard");
      return true;
    });
  });
});
