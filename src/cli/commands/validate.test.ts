import { mkdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTempDir,
  createConfigFile,
  createSkillFixture,
  createTempDir,
} from "../../__test-helpers__/fixtures.js";
import { UserError } from "../../utils/errors.js";
import { type Logger, getLogger, setLogger } from "../../utils/output.js";
import { validateAction } from "./validate.js";

describe("validateAction", () => {
  let tempDir: string;
  let configPath: string;
  let skillsDir: string;
  let agentsDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    skillsDir = path.join(tempDir, "skills");
    agentsDir = path.join(tempDir, "agents");
    await mkdir(skillsDir, { recursive: true });
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
        "  fast:",
        "    claude: claude-haiku-4",
        "    codex: gpt-5.4-mini",
        "  standard:",
        "    claude: claude-sonnet-4-7",
        "    codex: gpt-5.4",
        "  deep:",
        "    claude: claude-opus-4-7",
        "    codex: gpt-5.4",
        "",
      ].join("\n"),
    );
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  function createRecordingLogger(): {
    logger: Logger;
    warnings: string[];
    infos: string[];
  } {
    const warnings: string[] = [];
    const infos: string[] = [];
    return {
      logger: {
        error: () => {},
        warn: (msg, ...args) => {
          warnings.push(
            [msg, ...args]
              .map((value) =>
                typeof value === "string" ? value : JSON.stringify(value),
              )
              .join(" "),
          );
        },
        info: (msg, ...args) => {
          infos.push(
            [msg, ...args]
              .map((value) =>
                typeof value === "string" ? value : JSON.stringify(value),
              )
              .join(" "),
          );
        },
        verbose: () => {},
        debug: () => {},
        json: () => {},
      },
      warnings,
      infos,
    };
  }

  async function withRecordingLogger<T>(
    callback: (capture: { warnings: string[]; infos: string[] }) => Promise<T>,
  ): Promise<T> {
    const { logger, warnings, infos } = createRecordingLogger();
    const priorLogger = getLogger();
    setLogger(logger);

    try {
      return await callback({ warnings, infos });
    } finally {
      setLogger(priorLogger);
    }
  }

  function makeCommand(
    json = false,
    strict = false,
  ): {
    parent: { opts(): Record<string, unknown> };
  } {
    return {
      parent: {
        opts: () => ({
          config: configPath,
          json,
          strict,
        }),
      },
    };
  }

  it("warns in normal validate mode without failing", async () => {
    await createSkillFixture(
      skillsDir,
      "warn-skill",
      [
        "---",
        "name: warn-skill",
        "description: Use when drafting shared instructions with sonnet.",
        "---",
        "",
        "# Skill",
        "",
        "Use neutral prose in the body.",
        "",
      ].join("\n"),
    );

    await withRecordingLogger(async ({ warnings, infos }) => {
      await expect(
        validateAction({}, makeCommand(false, false)),
      ).resolves.toBeUndefined();

      expect(
        warnings.some(
          (warning) =>
            /warn-skill/i.test(warning) &&
            /sonnet|claude-sonnet-4-7/i.test(warning),
        ),
      ).toBe(true);
      expect(infos).toContain("Config: valid");
      expect(infos).toContain("Skills: 1 valid");
    });
  });

  it("fails in strict validate mode when drift diagnostics are present", async () => {
    await createSkillFixture(
      skillsDir,
      "strict-skill",
      [
        "---",
        "name: strict-skill",
        "description: Use when drafting shared instructions with sonnet.",
        "---",
        "",
        "# Skill",
        "",
        "Use neutral prose in the body.",
        "",
      ].join("\n"),
    );

    await withRecordingLogger(async ({ warnings }) => {
      await expect(
        validateAction({ strict: true }, makeCommand(false, false)),
      ).rejects.toThrow(UserError);
      await expect(
        validateAction({ strict: true }, makeCommand(false, false)),
      ).rejects.toThrow(/strict-skill/i);

      expect(warnings).toEqual([]);
    });
  });
});
