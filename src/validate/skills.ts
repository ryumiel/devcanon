import { readdir } from "node:fs/promises";
import path from "node:path";
import type { LoadedSkill } from "../models/types.js";
import { UserError } from "../utils/errors.js";
import { isDirectory, pathExists } from "../utils/fs.js";
import { readTextFile } from "../utils/fs.js";

const FILESYSTEM_SAFE = /^[a-z0-9][a-z0-9._-]*$/;
const KNOWN_SUBDIRS = ["assets", "examples", "references", "scripts"];

export async function loadAndValidateSkills(
  skillsDir: string,
): Promise<LoadedSkill[]> {
  if (!(await pathExists(skillsDir))) {
    return [];
  }

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

    const subdirs: string[] = [];
    for (const sub of KNOWN_SUBDIRS) {
      if (await isDirectory(path.join(dirPath, sub))) {
        subdirs.push(sub);
      }
    }

    skills.push({ name, dirPath, skillMdContent, subdirs });
  }

  if (errors.length > 0) {
    throw new UserError(
      `Skill validation failed:\n  ${errors.join("\n  ")}`,
      skillsDir,
    );
  }

  return skills;
}
