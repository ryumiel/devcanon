import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTempDir,
  createSkillFixture,
  createTempDir,
} from "../__test-helpers__/fixtures.js";
import type { ModelTiers } from "../config/schema.js";
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
            fast: { claude: "haiku", codex: "gpt-5.4-mini" },
            standard: { claude: "sonnet", codex: "gpt-5.4" },
          },
        },
      });

      expectWarningLine(warnings, /raw-codex-model/i, /gpt-5\.4-mini/i);
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
              standard: { claude: "sonnet", codex: "gpt-5.4" },
            },
          },
        }),
      ).resolves.toHaveLength(1);

      expect(warnings).toEqual([]);
    });
  });
});
