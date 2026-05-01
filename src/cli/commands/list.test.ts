import { mkdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTempDir,
  createAgentFixture,
  createConfigFile,
  createTempDir,
  makeAgentYaml,
} from "../../__test-helpers__/fixtures.js";
import { installTestLogger } from "../../__test-helpers__/logger.js";
import { type Logger, getLogger, setLogger } from "../../utils/output.js";
import { listAction } from "./list.js";

describe("listAction", () => {
  let tempDir: string;
  let configPath: string;
  let agentsDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    agentsDir = path.join(tempDir, "agents");
    await mkdir(path.join(tempDir, "skills"), { recursive: true });
    await mkdir(agentsDir, { recursive: true });
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

  it("lists agents that use configured model tier placeholders", async () => {
    await createAgentFixture(
      agentsDir,
      "reviewer",
      makeAgentYaml("reviewer", {
        claude: { model: "{{model:standard}}", tools: ["Read"] },
        codex: { model: "{{model:standard}}", sandbox_mode: "read-only" },
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
});
