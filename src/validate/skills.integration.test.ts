import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTempDir,
  createSkillFixture,
  createTempDir,
} from "../__test-helpers__/fixtures.js";
import { UserError } from "../utils/errors.js";
import { loadAndValidateSkills } from "./skills.js";

describe("loadAndValidateSkills", () => {
  let tempDir: string;
  let skillsDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    skillsDir = path.join(tempDir, "skills");
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

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
    const content = "# greeting\n\nA greeting skill.\n";
    await createSkillFixture(skillsDir, "greeting", content);

    const result = await loadAndValidateSkills(skillsDir);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "greeting",
      dirPath: path.join(skillsDir, "greeting"),
      skillMdContent: content,
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
});
