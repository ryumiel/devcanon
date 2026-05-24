import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTempDir,
  createAgentFixture,
  createConfigFile,
  createSkillFixture,
  createTempDir,
  makeAgentYaml,
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
        "    claude:",
        "      model: claude-haiku-4-5",
        "    codex:",
        "      model: gpt-5.4-mini",
        "  standard:",
        "    claude:",
        "      model: claude-sonnet-4-6",
        "      effort: medium",
        "    codex:",
        "      model: gpt-5.4",
        "      reasoning_effort: medium",
        "  deep:",
        "    claude:",
        "      model: claude-opus-4-7",
        "      effort: high",
        "    codex:",
        "      model: gpt-5.4",
        "      reasoning_effort: high",
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
    jsonPayloads: unknown[];
  } {
    const warnings: string[] = [];
    const infos: string[] = [];
    const jsonPayloads: unknown[] = [];
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
        json: (data) => {
          jsonPayloads.push(data);
        },
      },
      warnings,
      infos,
      jsonPayloads,
    };
  }

  async function withRecordingLogger<T>(
    callback: (capture: {
      warnings: string[];
      infos: string[];
      jsonPayloads: unknown[];
    }) => Promise<T>,
  ): Promise<T> {
    const { logger, warnings, infos, jsonPayloads } = createRecordingLogger();
    const priorLogger = getLogger();
    setLogger(logger);

    try {
      return await callback({ warnings, infos, jsonPayloads });
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

  function makeOversizedSkillContent(name: string): string {
    return [
      "---",
      `name: ${name}`,
      "description: A large skill prompt.",
      "---",
      "",
      "# Large prompt",
      "",
      ...Array.from({ length: 9000 }, (_, index) => `instruction-${index}`),
      "",
    ].join("\n");
  }

  it("groups skill warnings in normal validate mode without failing", async () => {
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

      expect(warnings).toEqual([]);
      expect(infos).toContain("Config: valid");
      expect(infos).toContain("Skills: 1 valid, 1 warning");
      expect(infos).toContain("Warnings (1)");
      expect(infos).toContain("[skill.drift-token] warn-skill (strictable)");
      expect(infos.join("\n")).toMatch(/sonnet|claude-sonnet-4-6/i);
      expect(infos).toContain("\nAll validations passed with warnings.");
    });
  });

  it("reports grouped mixed advisory and strictable warning counts", async () => {
    await createSkillFixture(
      skillsDir,
      "large-skill",
      makeOversizedSkillContent("large-skill"),
    );
    const straySkillDir = await createSkillFixture(skillsDir, "stray-skill");
    await mkdir(path.join(straySkillDir, "references"), { recursive: true });
    await writeFile(path.join(straySkillDir, "notes.md"), "# notes\n", "utf-8");

    await withRecordingLogger(async ({ warnings, infos }) => {
      await expect(
        validateAction({}, makeCommand(false, false)),
      ).resolves.toBeUndefined();

      expect(warnings).toEqual([]);
      expect(infos).toContain("Skills: 2 valid, 2 warnings");
      expect(infos).toContain("Warnings (2)");

      const output = infos.join("\n");
      expect(output).toContain("[skill.prompt-size] large-skill (advisory)");
      expect(output).toContain("[skill.stray-file] stray-skill (strictable)");
      expect(output).toContain('stray top-level file "notes.md"');
      expect(output).toContain(
        "allowed subdirs: assets/, examples/, references/, scripts/",
      );
      expect(infos).toContain("\nAll validations passed with warnings.");
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

  it("renders prompt-size warning metrics and guidance without failing strict validate mode", async () => {
    await createSkillFixture(
      skillsDir,
      "cli-large-skill",
      makeOversizedSkillContent("cli-large-skill"),
    );

    await withRecordingLogger(async ({ warnings, infos }) => {
      await expect(
        validateAction({ strict: true }, makeCommand(false, false)),
      ).resolves.toBeUndefined();

      expect(warnings).toEqual([]);
      expect(infos).toContain("Skills: 1 valid, 1 warning");

      const output = infos.join("\n");
      expect(output).toContain("Warnings (1)");
      expect(output).toContain(
        "[skill.prompt-size] cli-large-skill (advisory)",
      );
      expect(output).toMatch(/Estimated tokens: [0-9,]+/);
      expect(output).toContain("Encoding: o200k_base");
      expect(output).toMatch(/UTF-8 bytes: [0-9,]+/);
      expect(output).toContain("Lines: 9,007");
      expect(output).toContain("Target range: 1,500-3,500 tokens");
      expect(output).toContain("Soft limit: 5,000 tokens or 500 lines");
      expect(output).toContain("Hint: Keep critical instructions");
      expect(infos).toContain("\nAll validations passed with warnings.");
    });
  });

  it("keeps validate json payload shape when skill warnings are collected", async () => {
    await createSkillFixture(
      skillsDir,
      "json-large-skill",
      makeOversizedSkillContent("json-large-skill"),
    );

    await withRecordingLogger(async ({ infos, warnings, jsonPayloads }) => {
      await expect(
        validateAction({}, makeCommand(true, false)),
      ).resolves.toBeUndefined();

      expect(infos).toEqual([]);
      expect(warnings).toEqual([]);
      expect(jsonPayloads).toEqual([
        {
          config: "valid",
          skills: ["json-large-skill"],
          agents: [],
        },
      ]);
    });
  });

  it("prints collected skill warnings before later agent validation failures", async () => {
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
    await createSkillFixture(
      skillsDir,
      "agent-failure-large-skill",
      makeOversizedSkillContent("agent-failure-large-skill"),
    );
    await createAgentFixture(
      agentsDir,
      "tier-agent",
      makeAgentYaml("tier-agent", {
        claude: {
          model: "{{model:standard}}",
          tools: ["Read"],
        },
        codex: {
          model: "{{model:standard}}",
          sandbox_mode: "read-only",
        },
      }),
    );

    const command = {
      parent: {
        opts: () => ({
          config: noTierConfigPath,
          json: false,
          strict: false,
        }),
      },
    };

    await withRecordingLogger(async ({ infos, warnings }) => {
      await expect(validateAction({}, command)).rejects.toThrow(/modelTiers/i);

      expect(warnings).toEqual([]);
      expect(infos).toContain("Skills: 1 valid, 1 warning");
      expect(infos).toContain("Warnings (1)");
      expect(infos).toContain(
        "[skill.prompt-size] agent-failure-large-skill (advisory)",
      );
      expect(infos).not.toContain("Agents: 1 valid");
      expect(infos).not.toContain("\nAll validations passed with warnings.");
    });
  });

  it("prints collected skill warnings before skill validation failures", async () => {
    await createSkillFixture(
      skillsDir,
      "advisory-large-skill",
      makeOversizedSkillContent("advisory-large-skill"),
    );
    await createSkillFixture(
      skillsDir,
      "invalid-skill",
      [
        "---",
        "name: mismatched-skill",
        "description: Invalid fixture.",
        "---",
        "",
        "# Skill",
        "",
      ].join("\n"),
    );

    await withRecordingLogger(async ({ infos, warnings }) => {
      await expect(
        validateAction({}, makeCommand(false, false)),
      ).rejects.toThrow(/Skill validation failed/i);

      expect(warnings).toEqual([]);
      expect(infos).toContain("Config: valid");
      expect(infos).toContain("Warnings (1)");
      expect(infos).toContain(
        "[skill.prompt-size] advisory-large-skill (advisory)",
      );
      expect(infos).not.toContain("Skills: 1 valid, 1 warning");
      expect(infos).not.toContain("\nAll validations passed with warnings.");
    });
  });

  it("fails validate when an agent tier placeholder has no configured glossary", async () => {
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
    await createAgentFixture(
      agentsDir,
      "tier-agent",
      makeAgentYaml("tier-agent", {
        claude: {
          model: "{{model:standard}}",
          tools: ["Read"],
        },
        codex: {
          model: "{{model:standard}}",
          sandbox_mode: "read-only",
        },
      }),
    );

    await expect(
      validateAction(
        {},
        {
          parent: {
            opts: () => ({
              config: noTierConfigPath,
              json: false,
              strict: false,
            }),
          },
        },
      ),
    ).rejects.toThrow(/modelTiers/i);
  });
});
