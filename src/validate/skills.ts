import { readdir } from "node:fs/promises";
import path from "node:path";
import type { ZodIssue } from "zod";
import { SkillSourceSchema } from "../config/schema.js";
import type { LoadedSkill } from "../models/types.js";
import {
  parseFrontmatter,
  type ParsedFrontmatter,
} from "../render/frontmatter.js";
import { UserError } from "../utils/errors.js";
import { isDirectory, pathExists, readTextFile } from "../utils/fs.js";
import { FILESYSTEM_SAFE } from "../utils/naming.js";

const KNOWN_SUBDIRS = ["assets", "examples", "references", "scripts"];

function formatZodIssue(issue: ZodIssue): string {
  if (issue.code === "invalid_union") {
    return issue.unionErrors
      .flatMap((unionError) => unionError.issues.map(formatZodIssue))
      .join("; ");
  }

  if (issue.path.length === 0) return issue.message;
  return `${issue.path.join(".")}: ${issue.message}`;
}

export async function loadAndValidateSkills(
  skillsDir: string,
): Promise<LoadedSkill[]> {
  if (!(await pathExists(skillsDir))) return [];

  const entries = await readdir(skillsDir, { withFileTypes: true });
  const skills: LoadedSkill[] = [];
  const names = new Set<string>();
  const errors: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const name = entry.name;
    const dirPath = path.join(skillsDir, name);

    if (!FILESYSTEM_SAFE.test(name)) {
      errors.push(`Skill "${name}": name is not filesystem-safe.`);
      continue;
    }

    if (names.has(name)) {
      errors.push(`Skill "${name}": duplicate name.`);
      continue;
    }
    names.add(name);

    const skillMdPath = path.join(dirPath, "SKILL.md");
    if (!(await pathExists(skillMdPath))) {
      errors.push(`Skill "${name}": missing SKILL.md.`);
      continue;
    }

    const skillMdContent = await readTextFile(skillMdPath);

    let parsed: ParsedFrontmatter;
    try {
      parsed = parseFrontmatter(skillMdContent);
    } catch (e) {
      errors.push(`Skill "${name}": ${(e as Error).message}`);
      continue;
    }

    if (Object.keys(parsed.frontmatter).length === 0) {
      errors.push(
        `Skill "${name}": missing frontmatter (expected name and description).`,
      );
      continue;
    }

    const result = SkillSourceSchema.safeParse(parsed.frontmatter);
    if (!result.success) {
      const issues = result.error.issues.map(formatZodIssue).join("; ");
      errors.push(`Skill "${name}": ${issues}`);
      continue;
    }

    if (result.data.name !== name) {
      errors.push(
        `Skill "${name}": frontmatter name "${result.data.name}" does not match directory name.`,
      );
      continue;
    }

    const subdirs: string[] = [];
    for (const sub of KNOWN_SUBDIRS) {
      if (await isDirectory(path.join(dirPath, sub))) subdirs.push(sub);
    }

    skills.push({
      name,
      dirPath,
      skillMdContent,
      source: result.data,
      body: parsed.body,
      subdirs,
    });
  }

  if (errors.length > 0) {
    throw new UserError(
      `Skill validation failed:\n  ${errors.join("\n  ")}`,
      skillsDir,
    );
  }

  return skills;
}
