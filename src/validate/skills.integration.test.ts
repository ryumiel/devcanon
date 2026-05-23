import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTempDir,
  createSkillFixture,
  createTempDir,
} from "../__test-helpers__/fixtures.js";
import type { FileArtifacts, ModelTiers, ToolNames } from "../config/schema.js";
import { UserError } from "../utils/errors.js";
import { type Logger, getLogger, setLogger } from "../utils/output.js";
import { loadAndValidateSkills } from "./skills.js";

describe("loadAndValidateSkills", () => {
  let tempDir: string;
  let skillsDir: string;
  const loadAndValidateSkillsWithDiagnostics = loadAndValidateSkills as (
    skillsDir: string,
    options?: {
      diagnostics?: {
        enabled?: boolean;
        strict?: boolean;
        modelTiers?: ModelTiers;
        toolNames?: ToolNames;
        fileArtifacts?: FileArtifacts;
      };
    },
  ) => Promise<Awaited<ReturnType<typeof loadAndValidateSkills>>>;

  beforeEach(async () => {
    tempDir = await createTempDir();
    skillsDir = path.join(tempDir, "skills");
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  function createRecordingLogger(): {
    logger: Logger;
    warnings: string[];
  } {
    const warnings: string[] = [];
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
        info: () => {},
        verbose: () => {},
        debug: () => {},
        json: () => {},
      },
      warnings,
    };
  }

  async function captureWarnings<T>(
    callback: (warnings: string[]) => Promise<T>,
  ): Promise<T> {
    const { logger, warnings } = createRecordingLogger();
    const priorLogger = getLogger();
    setLogger(logger);

    try {
      return await callback(warnings);
    } finally {
      setLogger(priorLogger);
    }
  }

  function expectWarningLine(warnings: string[], ...patterns: RegExp[]): void {
    expect(
      warnings.some((warning) =>
        patterns.every((pattern) => pattern.test(warning)),
      ),
    ).toBe(true);
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

  it("returns empty array when skills directory does not exist", async () => {
    const result = await loadAndValidateSkills(skillsDir);
    expect(result).toEqual([]);
  });

  it("returns empty array for an empty skills directory", async () => {
    await mkdir(skillsDir, { recursive: true });

    const result = await loadAndValidateSkills(skillsDir);
    expect(result).toEqual([]);
  });

  it("loads a single valid skill with correct fields", async () => {
    await mkdir(skillsDir, { recursive: true });
    const content =
      "---\nname: greeting\ndescription: A greeting skill.\n---\n\n# greeting\n\nA greeting skill.\n";
    await createSkillFixture(skillsDir, "greeting", content);

    const result = await loadAndValidateSkills(skillsDir);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "greeting",
      dirPath: path.join(skillsDir, "greeting"),
      skillMdContent: content,
      source: { name: "greeting", description: "A greeting skill." },
      body: "# greeting\n\nA greeting skill.\n",
      subdirs: [],
    });
  });

  it("detects all known subdirs when present", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(skillsDir, "full-skill", undefined, [
      "assets",
      "examples",
      "references",
      "scripts",
    ]);

    const result = await loadAndValidateSkills(skillsDir);

    expect(result).toHaveLength(1);
    expect(result[0].subdirs).toEqual([
      "assets",
      "examples",
      "references",
      "scripts",
    ]);
  });

  it("returns empty subdirs when no known subdirs exist", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(skillsDir, "bare-skill");

    const result = await loadAndValidateSkills(skillsDir);

    expect(result).toHaveLength(1);
    expect(result[0].subdirs).toEqual([]);
  });

  it("throws UserError for uppercase skill name", async () => {
    await mkdir(skillsDir, { recursive: true });
    const skillDir = path.join(skillsDir, "MySkill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "# MySkill\n", "utf-8");

    await expect(loadAndValidateSkills(skillsDir)).rejects.toThrow(UserError);
    await expect(loadAndValidateSkills(skillsDir)).rejects.toThrow(
      "not filesystem-safe",
    );
  });

  it("throws UserError for name starting with a dot or dash", async () => {
    await mkdir(skillsDir, { recursive: true });
    const skillDir = path.join(skillsDir, "-bad-name");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "# bad\n", "utf-8");

    await expect(loadAndValidateSkills(skillsDir)).rejects.toThrow(UserError);
    await expect(loadAndValidateSkills(skillsDir)).rejects.toThrow(
      "not filesystem-safe",
    );
  });

  it("throws UserError when SKILL.md is missing", async () => {
    await mkdir(skillsDir, { recursive: true });
    const skillDir = path.join(skillsDir, "no-readme");
    await mkdir(skillDir, { recursive: true });

    await expect(loadAndValidateSkills(skillsDir)).rejects.toThrow(UserError);
    await expect(loadAndValidateSkills(skillsDir)).rejects.toThrow(
      "missing SKILL.md",
    );
  });

  it("loads multiple valid skills", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(skillsDir, "alpha");
    await createSkillFixture(skillsDir, "beta");
    await createSkillFixture(skillsDir, "gamma");

    const result = await loadAndValidateSkills(skillsDir);

    expect(result).toHaveLength(3);
    const names = result.map((s) => s.name).sort();
    expect(names).toEqual(["alpha", "beta", "gamma"]);
  });

  it("ignores non-directory entries in the skills directory", async () => {
    await mkdir(skillsDir, { recursive: true });
    await writeFile(path.join(skillsDir, "stray-file.txt"), "noise", "utf-8");
    await createSkillFixture(skillsDir, "real-skill");

    const result = await loadAndValidateSkills(skillsDir);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("real-skill");
  });

  it("includes only the subdirs that actually exist", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(skillsDir, "partial-skill", undefined, ["assets"]);

    const result = await loadAndValidateSkills(skillsDir);

    expect(result).toHaveLength(1);
    expect(result[0].subdirs).toEqual(["assets"]);
  });

  it("batches multiple errors into a single UserError", async () => {
    await mkdir(skillsDir, { recursive: true });

    // Create a skill with an unsafe name
    const badNameDir = path.join(skillsDir, "BadName");
    await mkdir(badNameDir, { recursive: true });
    await writeFile(path.join(badNameDir, "SKILL.md"), "# bad\n", "utf-8");

    // Create a skill missing SKILL.md
    const missingMdDir = path.join(skillsDir, "missing-md");
    await mkdir(missingMdDir, { recursive: true });

    try {
      await loadAndValidateSkills(skillsDir);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UserError);
      const message = (err as UserError).message;
      expect(message).toContain("not filesystem-safe");
      expect(message).toContain("missing SKILL.md");
    }
  });

  it("parses frontmatter and populates source + body", async () => {
    await mkdir(skillsDir, { recursive: true });
    const content = [
      "---",
      "name: example",
      "description: Use when X.",
      "---",
      "",
      "# Body",
      "",
      "content.",
      "",
    ].join("\n");
    await createSkillFixture(skillsDir, "example", content);

    const result = await loadAndValidateSkills(skillsDir);

    expect(result).toHaveLength(1);
    expect(result[0].source.name).toBe("example");
    expect(result[0].source.description).toBe("Use when X.");
    expect(result[0].body).toBe("# Body\n\ncontent.\n");
  });

  it("rejects a skill missing frontmatter", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(skillsDir, "no-fm", "# just body\n");

    await expect(loadAndValidateSkills(skillsDir)).rejects.toThrow(UserError);
    await expect(loadAndValidateSkills(skillsDir)).rejects.toThrow(
      /missing frontmatter|required/i,
    );
  });

  it("rejects a skill with unknown top-level frontmatter key", async () => {
    await mkdir(skillsDir, { recursive: true });
    const content =
      "---\nname: bad\ndescription: d\nunknown_key: 1\n---\n\n# body\n";
    await createSkillFixture(skillsDir, "bad", content);

    await expect(loadAndValidateSkills(skillsDir)).rejects.toThrow(UserError);
    await expect(loadAndValidateSkills(skillsDir)).rejects.toThrow(
      /unknown_key/,
    );
  });

  it("rejects a description containing angle brackets", async () => {
    await mkdir(skillsDir, { recursive: true });
    const content = "---\nname: xy\ndescription: uses <tool>\n---\n\n# b\n";
    await createSkillFixture(skillsDir, "xy", content);

    await expect(loadAndValidateSkills(skillsDir)).rejects.toThrow(UserError);
  });

  it("accepts claude and codex override blocks", async () => {
    await mkdir(skillsDir, { recursive: true });
    const content = [
      "---",
      "name: example",
      "description: Use when X.",
      "claude:",
      "  model: opus",
      "codex:",
      "  license: MIT",
      "---",
      "",
      "# body",
      "",
    ].join("\n");
    await createSkillFixture(skillsDir, "example", content);

    const result = await loadAndValidateSkills(skillsDir);
    expect(result[0].source.claude?.model).toBe("opus");
    expect(result[0].source.codex?.license).toBe("MIT");
  });

  it("rejects a claude block containing a codex-only key", async () => {
    await mkdir(skillsDir, { recursive: true });
    const content = [
      "---",
      "name: xy",
      "description: d",
      "claude:",
      "  license: MIT",
      "---",
      "",
    ].join("\n");
    await createSkillFixture(skillsDir, "xy", content);

    await expect(loadAndValidateSkills(skillsDir)).rejects.toThrow(UserError);
    await expect(loadAndValidateSkills(skillsDir)).rejects.toThrow(/license/);
  });

  it("rejects a skill where frontmatter name differs from directory name", async () => {
    await mkdir(skillsDir, { recursive: true });
    const content = "---\nname: other-name\ndescription: d.\n---\n\n# body\n";
    await createSkillFixture(skillsDir, "my-dir", content);

    await expect(loadAndValidateSkills(skillsDir)).rejects.toThrow(
      /other-name/,
    );
    await expect(loadAndValidateSkills(skillsDir)).rejects.toThrow(/my-dir/);
  });

  it("does not warn about normal-sized skill prompt size", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(skillsDir, "small-skill");

    await captureWarnings(async (warnings) => {
      const result = await loadAndValidateSkillsWithDiagnostics(skillsDir, {
        diagnostics: {
          enabled: true,
          strict: false,
        },
      });

      expect(result).toHaveLength(1);
      expect(
        warnings.some((warning) => /SKILL\.md is large/i.test(warning)),
      ).toBe(false);
    });
  });

  it("warns with tokenizer metrics when a skill prompt is oversized", async () => {
    await mkdir(skillsDir, { recursive: true });
    const content = makeOversizedSkillContent("large-skill");
    await createSkillFixture(skillsDir, "large-skill", content);
    const bytes = Buffer.byteLength(content, "utf-8");
    const lines = content.split(/\r\n|\r|\n/).length;

    await captureWarnings(async (warnings) => {
      const result = await loadAndValidateSkillsWithDiagnostics(skillsDir, {
        diagnostics: {
          enabled: true,
          strict: false,
        },
      });

      expect(result).toHaveLength(1);
      expectWarningLine(
        warnings,
        /large-skill/i,
        /SKILL\.md is large/i,
        /GPT tokens estimated with o200k_base/i,
        /threshold 8,000 tokens/i,
        new RegExp(`${bytes.toLocaleString("en-US")} bytes`),
        new RegExp(`${lines.toLocaleString("en-US")} lines`),
        /references\/ or scripts\//i,
      );
    });
  });

  it("does not warn about oversized skill prompts when diagnostics are disabled", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(
      skillsDir,
      "quiet-large-skill",
      makeOversizedSkillContent("quiet-large-skill"),
    );

    await captureWarnings(async (warnings) => {
      const result = await loadAndValidateSkillsWithDiagnostics(skillsDir);

      expect(result).toHaveLength(1);
      expect(
        warnings.some((warning) => /SKILL\.md is large/i.test(warning)),
      ).toBe(false);
    });
  });

  it("keeps oversized skill prompt diagnostics advisory in strict mode", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(
      skillsDir,
      "strict-large-skill",
      makeOversizedSkillContent("strict-large-skill"),
    );

    await captureWarnings(async (warnings) => {
      await expect(
        loadAndValidateSkillsWithDiagnostics(skillsDir, {
          diagnostics: {
            enabled: true,
            strict: true,
          },
        }),
      ).resolves.toHaveLength(1);

      expectWarningLine(warnings, /strict-large-skill/i, /SKILL\.md is large/i);
    });
  });

  it("warns in non-strict validate mode on raw Claude aliases in prose", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(
      skillsDir,
      "raw-claude-alias",
      [
        "---",
        "name: raw-claude-alias",
        "description: Detect drift-prone prose.",
        "---",
        "",
        "# Skill",
        "",
        "Prefer sonnet for planning and opus for review.",
        "",
      ].join("\n"),
    );

    await captureWarnings(async (warnings) => {
      const result = await loadAndValidateSkillsWithDiagnostics(skillsDir, {
        diagnostics: {
          enabled: true,
          strict: false,
        },
      });

      expect(result).toHaveLength(1);
      expectWarningLine(warnings, /raw-claude-alias/i, /sonnet/i);
      expectWarningLine(warnings, /raw-claude-alias/i, /opus/i);
    });
  });

  it("warns on drift-prone tokens in frontmatter description", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(
      skillsDir,
      "description-drift",
      [
        "---",
        "name: description-drift",
        "description: Prefer sonnet when drafting shared instructions.",
        "---",
        "",
        "# Skill",
        "",
        "Body prose stays neutral.",
        "",
      ].join("\n"),
    );

    await captureWarnings(async (warnings) => {
      await loadAndValidateSkillsWithDiagnostics(skillsDir, {
        diagnostics: {
          enabled: true,
          strict: false,
        },
      });

      expectWarningLine(warnings, /description-drift/i, /sonnet/i);
    });
  });

  it("fails in strict validate mode on raw Claude aliases in prose", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(
      skillsDir,
      "strict-raw-claude-alias",
      [
        "---",
        "name: strict-raw-claude-alias",
        "description: Detect drift-prone prose.",
        "---",
        "",
        "# Skill",
        "",
        "Use haiku for lightweight scans.",
        "",
      ].join("\n"),
    );

    await expect(
      loadAndValidateSkillsWithDiagnostics(skillsDir, {
        diagnostics: {
          enabled: true,
          strict: true,
        },
      }),
    ).rejects.toThrow(/strict-raw-claude-alias/i);
    await expect(
      loadAndValidateSkillsWithDiagnostics(skillsDir, {
        diagnostics: {
          enabled: true,
          strict: true,
        },
      }),
    ).rejects.toThrow(/haiku/i);
  });

  it("warns for configured Codex model ids in prose", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(
      skillsDir,
      "raw-codex-model",
      [
        "---",
        "name: raw-codex-model",
        "description: Detect drift-prone prose.",
        "---",
        "",
        "# Skill",
        "",
        "Reach for gpt-5.4-mini when turnaround matters.",
        "",
      ].join("\n"),
    );

    await captureWarnings(async (warnings) => {
      await loadAndValidateSkillsWithDiagnostics(skillsDir, {
        diagnostics: {
          enabled: true,
          strict: false,
          modelTiers: {
            fast: {
              claude: { model: "haiku" },
              codex: { model: "gpt-5.4-mini" },
            },
            standard: {
              claude: { model: "sonnet" },
              codex: { model: "gpt-5.4" },
            },
          },
        },
      });

      expectWarningLine(warnings, /raw-codex-model/i, /gpt-5\.4-mini/i);
    });
  });

  it("warns for sentence-final drift tokens in prose", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(
      skillsDir,
      "sentence-final-drift",
      [
        "---",
        "name: sentence-final-drift",
        "description: Detect drift-prone prose.",
        "---",
        "",
        "# Skill",
        "",
        "Use sonnet. Reach for gpt-5.4-mini.",
        "",
      ].join("\n"),
    );

    await captureWarnings(async (warnings) => {
      await loadAndValidateSkillsWithDiagnostics(skillsDir, {
        diagnostics: {
          enabled: true,
          strict: false,
          modelTiers: {
            fast: {
              claude: { model: "haiku" },
              codex: { model: "gpt-5.4-mini" },
            },
            standard: {
              claude: { model: "sonnet" },
              codex: { model: "gpt-5.4" },
            },
          },
        },
      });

      expectWarningLine(warnings, /sentence-final-drift/i, /sonnet/i);
      expectWarningLine(warnings, /sentence-final-drift/i, /gpt-5\.4-mini/i);
    });
  });

  it("warns for target-specific path tokens in prose", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(
      skillsDir,
      "raw-target-path",
      [
        "---",
        "name: raw-target-path",
        "description: Detect target-specific path drift.",
        "---",
        "",
        "# Skill",
        "",
        "Do not tell users to copy files into ~/.claude/skills or ~/.codex/agents.",
        "",
      ].join("\n"),
    );

    await captureWarnings(async (warnings) => {
      await loadAndValidateSkillsWithDiagnostics(skillsDir, {
        diagnostics: {
          enabled: true,
          strict: false,
        },
      });

      expectWarningLine(warnings, /raw-target-path/i, /\.claude\//i);
      expectWarningLine(warnings, /raw-target-path/i, /\.codex\//i);
    });
  });

  it("warns for bare .codex path tokens in prose", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(
      skillsDir,
      "raw-bare-codex-path",
      [
        "---",
        "name: raw-bare-codex-path",
        "description: Detect generic Codex path drift.",
        "---",
        "",
        "# Skill",
        "",
        "Generated agents land under .codex/agents after sync.",
        "",
      ].join("\n"),
    );

    await captureWarnings(async (warnings) => {
      await loadAndValidateSkillsWithDiagnostics(skillsDir, {
        diagnostics: {
          enabled: true,
          strict: false,
        },
      });

      expectWarningLine(warnings, /raw-bare-codex-path/i, /\.codex\//i);
    });
  });

  it("warns for ~/.agents install path tokens in prose", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(
      skillsDir,
      "raw-agents-home-path",
      [
        "---",
        "name: raw-agents-home-path",
        "description: Detect shared prose that hard-codes Codex skill home paths.",
        "---",
        "",
        "# Skill",
        "",
        "Codex installs shared skills under ~/.agents/skills after sync.",
        "",
      ].join("\n"),
    );

    await captureWarnings(async (warnings) => {
      await loadAndValidateSkillsWithDiagnostics(skillsDir, {
        diagnostics: {
          enabled: true,
          strict: false,
        },
      });

      expectWarningLine(warnings, /raw-agents-home-path/i, /\.agents\//i);
    });
  });

  it("ignores flagged tokens inside fenced code blocks", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(
      skillsDir,
      "fenced-code-immunity",
      [
        "---",
        "name: fenced-code-immunity",
        "description: Ignore literal tokens inside fences.",
        "---",
        "",
        "# Skill",
        "",
        "```yaml",
        "preferred_model: sonnet",
        "backup_model: gpt-5.4",
        "```",
        "",
        "Outside prose stays neutral.",
        "",
      ].join("\n"),
    );

    await captureWarnings(async (warnings) => {
      await expect(
        loadAndValidateSkillsWithDiagnostics(skillsDir, {
          diagnostics: {
            enabled: true,
            strict: true,
            modelTiers: {
              standard: {
                claude: { model: "sonnet" },
                codex: { model: "gpt-5.4" },
              },
            },
          },
        }),
      ).resolves.toHaveLength(1);

      expect(warnings).toEqual([]);
    });
  });

  it("ignores flagged tokens inside blockquoted fenced code blocks", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(
      skillsDir,
      "blockquote-fenced-code-immunity",
      [
        "---",
        "name: blockquote-fenced-code-immunity",
        "description: Ignore literal tokens inside blockquoted fences.",
        "---",
        "",
        "# Skill",
        "",
        "> ```yaml",
        "> preferred_model: sonnet",
        "> backup_model: gpt-5.4",
        "> ```",
        "",
        "Outside prose stays neutral.",
        "",
      ].join("\n"),
    );

    await captureWarnings(async (warnings) => {
      await expect(
        loadAndValidateSkillsWithDiagnostics(skillsDir, {
          diagnostics: {
            enabled: true,
            strict: true,
            modelTiers: {
              standard: {
                claude: { model: "sonnet" },
                codex: { model: "gpt-5.4" },
              },
            },
          },
        }),
      ).resolves.toHaveLength(1);

      expect(warnings).toEqual([]);
    });
  });

  it("ignores flagged tokens inside indented code blocks", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(
      skillsDir,
      "indented-code-immunity",
      [
        "---",
        "name: indented-code-immunity",
        "description: Ignore literal tokens inside indented code blocks.",
        "---",
        "",
        "# Skill",
        "",
        "    preferred_model: sonnet",
        "    backup_model: gpt-5.4",
        "",
        "Outside prose stays neutral.",
        "",
      ].join("\n"),
    );

    await captureWarnings(async (warnings) => {
      await expect(
        loadAndValidateSkillsWithDiagnostics(skillsDir, {
          diagnostics: {
            enabled: true,
            strict: true,
            modelTiers: {
              standard: {
                claude: { model: "sonnet" },
                codex: { model: "gpt-5.4" },
              },
            },
          },
        }),
      ).resolves.toHaveLength(1);

      expect(warnings).toEqual([]);
    });
  });

  it("ignores flagged tokens inside blockquoted indented code blocks", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(
      skillsDir,
      "blockquote-indented-code-immunity",
      [
        "---",
        "name: blockquote-indented-code-immunity",
        "description: Ignore literal tokens inside blockquoted indented code blocks.",
        "---",
        "",
        "# Skill",
        "",
        "> # Example",
        ">     preferred_model: sonnet",
        ">     backup_model: gpt-5.4",
        "",
        "Outside prose stays neutral.",
        "",
      ].join("\n"),
    );

    await captureWarnings(async (warnings) => {
      await expect(
        loadAndValidateSkillsWithDiagnostics(skillsDir, {
          diagnostics: {
            enabled: true,
            strict: true,
            modelTiers: {
              standard: {
                claude: { model: "sonnet" },
                codex: { model: "gpt-5.4" },
              },
            },
          },
        }),
      ).resolves.toHaveLength(1);

      expect(warnings).toEqual([]);
    });
  });

  it("ignores flagged tokens inside heading-adjacent indented code blocks", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(
      skillsDir,
      "heading-adjacent-indented-code-immunity",
      [
        "---",
        "name: heading-adjacent-indented-code-immunity",
        "description: Ignore literal tokens inside heading-adjacent indented code blocks.",
        "---",
        "",
        "# Example",
        "    preferred_model: sonnet",
        "    backup_model: gpt-5.4",
        "",
        "Outside prose stays neutral.",
        "",
      ].join("\n"),
    );

    await captureWarnings(async (warnings) => {
      await expect(
        loadAndValidateSkillsWithDiagnostics(skillsDir, {
          diagnostics: {
            enabled: true,
            strict: true,
            modelTiers: {
              standard: {
                claude: { model: "sonnet" },
                codex: { model: "gpt-5.4" },
              },
            },
          },
        }),
      ).resolves.toHaveLength(1);

      expect(warnings).toEqual([]);
    });
  });

  it("treats indented list continuation lines as prose for drift diagnostics", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(
      skillsDir,
      "list-continuation-prose-drift",
      [
        "---",
        "name: list-continuation-prose-drift",
        "description: Detect drift in list continuation prose.",
        "---",
        "",
        "1. Item",
        "    continuation with sonnet",
        "",
      ].join("\n"),
    );

    await captureWarnings(async (_warnings) => {
      await expect(
        loadAndValidateSkillsWithDiagnostics(skillsDir, {
          diagnostics: {
            enabled: true,
            strict: true,
            modelTiers: {
              standard: {
                claude: { model: "sonnet" },
                codex: { model: "gpt-5.4" },
              },
            },
          },
        }),
      ).rejects.toThrow(/drift-prone prose token "sonnet"/i);
    });
  });

  it("ignores nested list indented code blocks for drift diagnostics", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(
      skillsDir,
      "list-indented-code-immunity",
      [
        "---",
        "name: list-indented-code-immunity",
        "description: Ignore drift tokens in list-nested code blocks.",
        "---",
        "",
        "- Bullet",
        "      bullet_model: sonnet",
        "1. Ordered",
        "       ordered_model: gpt-5.4-mini",
        "-\tTabbed bullet",
        "        tabbed_bullet_model: sonnet",
        "1.\tTabbed ordered",
        "        tabbed_ordered_model: gpt-5.4-mini",
        "",
      ].join("\n"),
    );

    await captureWarnings(async (warnings) => {
      await expect(
        loadAndValidateSkillsWithDiagnostics(skillsDir, {
          diagnostics: {
            enabled: true,
            strict: true,
            modelTiers: {
              fast: {
                claude: { model: "haiku" },
                codex: { model: "gpt-5.4-mini" },
              },
              standard: {
                claude: { model: "sonnet" },
                codex: { model: "gpt-5.4" },
              },
            },
          },
        }),
      ).resolves.toHaveLength(1);

      expect(warnings).toEqual([]);
    });
  });

  it("warns on list continuation prose while ignoring nested code that follows", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(
      skillsDir,
      "list-continuation-prose",
      [
        "---",
        "name: list-continuation-prose",
        "description: Flag drift tokens in continuation prose while ignoring nested code.",
        "---",
        "",
        "- Bullet",
        "\tcontinuation with sonnet stays in prose.",
        "",
        "\t\tpreferred_model: haiku",
        "",
      ].join("\n"),
    );

    await captureWarnings(async (warnings) => {
      const result = await loadAndValidateSkillsWithDiagnostics(skillsDir, {
        diagnostics: {
          enabled: true,
          strict: false,
        },
      });

      expect(result).toHaveLength(1);
      expectWarningLine(warnings, /list-continuation-prose/i, /sonnet/i);
      expect(warnings.some((warning) => /haiku/i.test(warning))).toBe(false);
    });
  });

  it("warns on configured tool names in shared prose", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(
      skillsDir,
      "raw-tool-name",
      [
        "---",
        "name: raw-tool-name",
        "description: Detect tool drift.",
        "---",
        "",
        "# Skill",
        "",
        "Use TodoWrite to track tasks.",
        "",
      ].join("\n"),
    );

    await captureWarnings(async (warnings) => {
      await loadAndValidateSkillsWithDiagnostics(skillsDir, {
        diagnostics: {
          enabled: true,
          strict: false,
          toolNames: {
            "task-tracker": { claude: "TodoWrite", codex: "update_plan" },
          },
        },
      });

      expectWarningLine(warnings, /raw-tool-name/i, /TodoWrite/);
    });
  });

  it("warns on Codex tool names in shared prose", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(
      skillsDir,
      "raw-codex-tool",
      [
        "---",
        "name: raw-codex-tool",
        "description: Detect codex tool drift.",
        "---",
        "",
        "# Skill",
        "",
        "Use update_plan to track tasks.",
        "",
      ].join("\n"),
    );

    await captureWarnings(async (warnings) => {
      await loadAndValidateSkillsWithDiagnostics(skillsDir, {
        diagnostics: {
          enabled: true,
          strict: false,
          toolNames: {
            "task-tracker": { claude: "TodoWrite", codex: "update_plan" },
          },
        },
      });

      expectWarningLine(warnings, /raw-codex-tool/i, /update_plan/);
    });
  });

  it("fails in strict mode on configured tool names in prose", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(
      skillsDir,
      "strict-tool-drift",
      [
        "---",
        "name: strict-tool-drift",
        "description: Detect tool drift in strict mode.",
        "---",
        "",
        "# Skill",
        "",
        "Use TodoWrite to track tasks.",
        "",
      ].join("\n"),
    );

    const diagnostics = {
      enabled: true,
      strict: true,
      toolNames: {
        "task-tracker": { claude: "TodoWrite", codex: "update_plan" },
      },
    };
    await expect(
      loadAndValidateSkillsWithDiagnostics(skillsDir, { diagnostics }),
    ).rejects.toThrow(/strict-tool-drift/i);
    await expect(
      loadAndValidateSkillsWithDiagnostics(skillsDir, { diagnostics }),
    ).rejects.toThrow(/TodoWrite/);
  });

  it("fails in strict mode on configured file artifacts in prose", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(
      skillsDir,
      "strict-file-drift",
      [
        "---",
        "name: strict-file-drift",
        "description: Detect file artifact drift in strict mode.",
        "---",
        "",
        "# Skill",
        "",
        "Edit CLAUDE.md to set rules.",
        "",
      ].join("\n"),
    );

    const diagnostics = {
      enabled: true,
      strict: true,
      fileArtifacts: {
        "project-instructions": {
          claude: "CLAUDE.md",
          codex: "AGENTS.md",
        },
      },
    };
    await expect(
      loadAndValidateSkillsWithDiagnostics(skillsDir, { diagnostics }),
    ).rejects.toThrow(/strict-file-drift/i);
    await expect(
      loadAndValidateSkillsWithDiagnostics(skillsDir, { diagnostics }),
    ).rejects.toThrow(/CLAUDE\.md/);
  });

  it("warns on configured file artifacts in shared prose", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(
      skillsDir,
      "raw-file-artifact",
      [
        "---",
        "name: raw-file-artifact",
        "description: Detect file artifact drift.",
        "---",
        "",
        "# Skill",
        "",
        "Edit CLAUDE.md to set rules.",
        "",
      ].join("\n"),
    );

    await captureWarnings(async (warnings) => {
      await loadAndValidateSkillsWithDiagnostics(skillsDir, {
        diagnostics: {
          enabled: true,
          strict: false,
          fileArtifacts: {
            "project-instructions": {
              claude: "CLAUDE.md",
              codex: "AGENTS.md",
            },
          },
        },
      });

      expectWarningLine(warnings, /raw-file-artifact/i, /CLAUDE\.md/);
    });
  });

  it("warns on Codex file artifacts in shared prose", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(
      skillsDir,
      "raw-codex-file-artifact",
      [
        "---",
        "name: raw-codex-file-artifact",
        "description: Detect codex file artifact drift.",
        "---",
        "",
        "# Skill",
        "",
        "Read AGENTS.md for the rules.",
        "",
      ].join("\n"),
    );

    await captureWarnings(async (warnings) => {
      await loadAndValidateSkillsWithDiagnostics(skillsDir, {
        diagnostics: {
          enabled: true,
          strict: false,
          fileArtifacts: {
            "project-instructions": {
              claude: "CLAUDE.md",
              codex: "AGENTS.md",
            },
          },
        },
      });

      expectWarningLine(warnings, /raw-codex-file-artifact/i, /AGENTS\.md/);
    });
  });

  it("does not flag tool tokens inside fenced code blocks", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(
      skillsDir,
      "fenced-tool-token",
      [
        "---",
        "name: fenced-tool-token",
        "description: Tokens in code stay literal.",
        "---",
        "",
        "# Skill",
        "",
        "Example syntax:",
        "",
        "```",
        "TodoWrite(...)",
        "```",
        "",
        "Body stays neutral.",
        "",
      ].join("\n"),
    );

    await captureWarnings(async (warnings) => {
      await loadAndValidateSkillsWithDiagnostics(skillsDir, {
        diagnostics: {
          enabled: true,
          strict: false,
          toolNames: {
            "task-tracker": { claude: "TodoWrite", codex: "update_plan" },
          },
        },
      });

      // No drift warning should mention the fenced token.
      expect(warnings.filter((w) => /fenced-tool-token/i.test(w))).toEqual([]);
    });
  });

  it("emits separate warnings when the same value is in toolNames and fileArtifacts", async () => {
    // A glossary collision -- the same string registered as both a tool
    // name and a file artifact -- must surface as one warning per
    // namespace, not be deduped to a single entry.
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(
      skillsDir,
      "glossary-collision",
      [
        "---",
        "name: glossary-collision",
        "description: Detect collision between tool and file glossaries.",
        "---",
        "",
        "# Skill",
        "",
        "Reference SHARED.md inline.",
        "",
      ].join("\n"),
    );

    await captureWarnings(async (warnings) => {
      await loadAndValidateSkillsWithDiagnostics(skillsDir, {
        diagnostics: {
          enabled: true,
          strict: false,
          toolNames: {
            shared: { claude: "SHARED.md", codex: "SHARED.md" },
          },
          fileArtifacts: {
            shared: { claude: "SHARED.md", codex: "SHARED.md" },
          },
        },
      });

      const matched = warnings.filter((w) =>
        /glossary-collision/i.test(w) ? /SHARED\.md/.test(w) : false,
      );
      expect(
        matched.filter((w) => /\{\{tool:<key>\}\}/.test(w)).length,
      ).toBeGreaterThanOrEqual(1);
      expect(
        matched.filter((w) => /\{\{file:<key>\}\}/.test(w)).length,
      ).toBeGreaterThanOrEqual(1);
    });
  });

  it("flags drift tokens at line start and adjacent to non-whitespace punctuation", async () => {
    await mkdir(skillsDir, { recursive: true });
    await createSkillFixture(
      skillsDir,
      "boundary-drift",
      [
        "---",
        "name: boundary-drift",
        "description: Detect boundary cases for containsToken.",
        "---",
        "",
        "# Skill",
        "",
        "TodoWrite is preferred; CLAUDE.md is the file.",
        "",
      ].join("\n"),
    );

    await captureWarnings(async (warnings) => {
      await loadAndValidateSkillsWithDiagnostics(skillsDir, {
        diagnostics: {
          enabled: true,
          strict: false,
          toolNames: {
            "task-tracker": { claude: "TodoWrite", codex: "update_plan" },
          },
          fileArtifacts: {
            "project-instructions": {
              claude: "CLAUDE.md",
              codex: "AGENTS.md",
            },
          },
        },
      });

      expectWarningLine(warnings, /boundary-drift/i, /TodoWrite/);
      expectWarningLine(warnings, /boundary-drift/i, /CLAUDE\.md/);
    });
  });

  describe("stray top-level files", () => {
    it("warns on a stray top-level file in non-strict validate mode", async () => {
      await mkdir(skillsDir, { recursive: true });
      const skillDir = await createSkillFixture(skillsDir, "stray-warn");
      await writeFile(
        path.join(skillDir, "gate-agent-prompt.md"),
        "# stray\n",
        "utf-8",
      );

      await captureWarnings(async (warnings) => {
        const result = await loadAndValidateSkillsWithDiagnostics(skillsDir, {
          diagnostics: { enabled: true, strict: false },
        });

        expect(result).toHaveLength(1);
        expectWarningLine(
          warnings,
          /stray-warn/,
          /gate-agent-prompt\.md/,
          /references\//,
        );
      });
    });

    it("fails on a stray top-level file in strict validate mode", async () => {
      await mkdir(skillsDir, { recursive: true });
      const skillDir = await createSkillFixture(skillsDir, "stray-strict");
      await writeFile(path.join(skillDir, "stray.md"), "# stray\n", "utf-8");

      await expect(
        loadAndValidateSkillsWithDiagnostics(skillsDir, {
          diagnostics: { enabled: true, strict: true },
        }),
      ).rejects.toThrow(UserError);
      await expect(
        loadAndValidateSkillsWithDiagnostics(skillsDir, {
          diagnostics: { enabled: true, strict: true },
        }),
      ).rejects.toThrow(/stray-strict/);
      await expect(
        loadAndValidateSkillsWithDiagnostics(skillsDir, {
          diagnostics: { enabled: true, strict: true },
        }),
      ).rejects.toThrow(/stray\.md/);
    });

    it("does not flag hidden files at the skill root", async () => {
      await mkdir(skillsDir, { recursive: true });
      const skillDir = await createSkillFixture(skillsDir, "hidden-allowed");
      await writeFile(path.join(skillDir, ".DS_Store"), "", "utf-8");
      await writeFile(path.join(skillDir, ".gitkeep"), "", "utf-8");

      await captureWarnings(async (warnings) => {
        const result = await loadAndValidateSkillsWithDiagnostics(skillsDir, {
          diagnostics: { enabled: true, strict: false },
        });

        expect(result).toHaveLength(1);
        expect(warnings.some((w) => /hidden-allowed/.test(w))).toBe(false);
      });
    });

    it("does not flag a skill that contains only SKILL.md", async () => {
      await mkdir(skillsDir, { recursive: true });
      await createSkillFixture(skillsDir, "bare-skill");

      await captureWarnings(async (warnings) => {
        const result = await loadAndValidateSkillsWithDiagnostics(skillsDir, {
          diagnostics: { enabled: true, strict: false },
        });

        expect(result).toHaveLength(1);
        expect(warnings.some((w) => /bare-skill/.test(w))).toBe(false);
      });
    });

    it("does not flag files inside the four mirrored subdirs", async () => {
      await mkdir(skillsDir, { recursive: true });
      const skillDir = await createSkillFixture(
        skillsDir,
        "subdir-files-ok",
        undefined,
        ["assets", "examples", "references", "scripts"],
      );
      await writeFile(
        path.join(skillDir, "references", "prompt.md"),
        "# prompt\n",
        "utf-8",
      );
      await writeFile(
        path.join(skillDir, "scripts", "run.sh"),
        "#!/bin/sh\n",
        "utf-8",
      );
      await writeFile(
        path.join(skillDir, "assets", "logo.txt"),
        "logo\n",
        "utf-8",
      );
      await writeFile(
        path.join(skillDir, "examples", "ex.md"),
        "# ex\n",
        "utf-8",
      );

      await captureWarnings(async (warnings) => {
        const result = await loadAndValidateSkillsWithDiagnostics(skillsDir, {
          diagnostics: { enabled: true, strict: false },
        });

        expect(result).toHaveLength(1);
        expect(warnings.some((w) => /subdir-files-ok/.test(w))).toBe(false);
      });
    });

    it("does not run when diagnostics are disabled", async () => {
      await mkdir(skillsDir, { recursive: true });
      const skillDir = await createSkillFixture(skillsDir, "no-diagnostics");
      await writeFile(path.join(skillDir, "stray.md"), "# stray\n", "utf-8");

      await captureWarnings(async (warnings) => {
        // No `diagnostics` option at all — same call shape as render/sync use.
        const result = await loadAndValidateSkills(skillsDir);

        expect(result).toHaveLength(1);
        expect(warnings.some((w) => /no-diagnostics/.test(w))).toBe(false);
      });
    });

    it("does not flag stray top-level directories", async () => {
      await mkdir(skillsDir, { recursive: true });
      const skillDir = await createSkillFixture(skillsDir, "stray-dir");
      await mkdir(path.join(skillDir, "prompts"), { recursive: true });
      await writeFile(
        path.join(skillDir, "prompts", "draft.md"),
        "# draft\n",
        "utf-8",
      );

      await captureWarnings(async (warnings) => {
        const result = await loadAndValidateSkillsWithDiagnostics(skillsDir, {
          diagnostics: { enabled: true, strict: false },
        });

        expect(result).toHaveLength(1);
        expect(warnings.some((w) => /stray-dir/.test(w))).toBe(false);
      });
    });
  });
});
