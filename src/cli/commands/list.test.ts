import { mkdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTempDir,
  createAgentFixture,
  createConfigFile,
  createSkillFixture,
  createTempDir,
  makeAgentYaml,
  makeConfigYaml,
} from "../../__test-helpers__/fixtures.js";
import { installTestLogger } from "../../__test-helpers__/logger.js";
import { type Logger, getLogger, setLogger } from "../../utils/output.js";
import { listAction } from "./list.js";

describe("listAction", () => {
  let tempDir: string;
  let configPath: string;
  let agentsDir: string;
  let skillsDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    agentsDir = path.join(tempDir, "agents");
    skillsDir = path.join(tempDir, "skills");
    await mkdir(skillsDir, { recursive: true });
    await mkdir(agentsDir, { recursive: true });
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
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  function createRecordingLogger(): { logger: Logger; infos: string[] } {
    const infos: string[] = [];
    return {
      logger: {
        error: () => {},
        warn: () => {},
        info: (msg) => infos.push(msg),
        verbose: () => {},
        debug: () => {},
        json: () => {},
      },
      infos,
    };
  }

  it("lists agents that use a neutral capability", async () => {
    await createAgentFixture(
      agentsDir,
      "reviewer",
      makeAgentYaml("reviewer", {
        capability: "balanced",
        claude: { tools: ["Read"] },
        codex: { sandbox_mode: "read-only" },
      }),
    );

    const { logger, infos } = createRecordingLogger();
    const priorLogger = getLogger();
    setLogger(logger);

    try {
      await listAction(
        {},
        {
          parent: {
            opts: () => ({ config: configPath, strict: false, json: false }),
          },
        },
      );
    } finally {
      setLogger(priorLogger);
    }

    expect(infos).toContain("\nAgents:");
    expect(
      infos.some((entry) => entry.includes("reviewer: Test agent reviewer")),
    ).toBe(true);
  });

  it.each(["fast", " balanced"])(
    "rejects active model token key %s even with advisory diagnostics disabled",
    async (modelKey) => {
      await createSkillFixture(
        skillsDir,
        "invalid-model-token",
        [
          "---",
          "name: invalid-model-token",
          "description: A skill with an invalid active model token.",
          "---",
          "",
          `Use {{model:${modelKey}}} for synthesis.`,
          "",
        ].join("\n"),
      );

      await expect(
        listAction(
          {},
          {
            parent: {
              opts: () => ({ config: configPath, strict: false, json: false }),
            },
          },
        ),
      ).rejects.toThrow(`{{model:${modelKey}}}`);
    },
  );
});
