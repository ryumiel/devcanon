import { readdir } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { AgentSourceSchema } from "../config/schema.js";
import type { LoadedAgent, LoadedSkill } from "../models/types.js";
import { UserError } from "../utils/errors.js";
import { pathExists, readTextFile } from "../utils/fs.js";
import { getLogger } from "../utils/output.js";

export async function loadAndValidateAgents(
  agentsDir: string,
  skills: LoadedSkill[],
  strict = false,
): Promise<LoadedAgent[]> {
  if (!(await pathExists(agentsDir))) {
    return [];
  }

  const entries = await readdir(agentsDir, { withFileTypes: true });
  const agents: LoadedAgent[] = [];
  const names = new Set<string>();
  const errors: string[] = [];
  const skillNames = new Set(skills.map((s) => s.name));

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".yaml")) continue;

    const filePath = path.join(agentsDir, entry.name);
    const raw = await readTextFile(filePath);
    let parsed: unknown;

    try {
      parsed = parseYaml(raw);
    } catch (e) {
      errors.push(
        `Agent "${entry.name}": invalid YAML - ${(e as Error).message}`,
      );
      continue;
    }

    // Check for unknown fields
    if (parsed && typeof parsed === "object") {
      const knownKeys = new Set([
        "name",
        "description",
        "instructions",
        "skills",
        "claude",
        "codex",
        "tags",
        "notes",
      ]);
      for (const key of Object.keys(parsed as Record<string, unknown>)) {
        if (!knownKeys.has(key)) {
          if (strict) {
            errors.push(`Agent "${entry.name}": unknown field "${key}".`);
          } else {
            getLogger().warn(`Warning: unknown field "${key}" in ${filePath}`);
          }
        }
      }
    }

    const result = AgentSourceSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => i.message).join(", ");
      errors.push(`Agent "${entry.name}": ${issues}`);
      continue;
    }

    const source = result.data;

    if (names.has(source.name)) {
      errors.push(`Agent "${source.name}": duplicate name.`);
      continue;
    }
    names.add(source.name);

    // Validate skill references
    for (const skillRef of source.skills) {
      if (!skillNames.has(skillRef)) {
        errors.push(
          `Agent "${source.name}": references unknown skill "${skillRef}".`,
        );
      }
    }

    agents.push({ name: source.name, filePath, source });
  }

  // Warn about .yml files
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".yml")) {
      getLogger().warn(
        `Warning: ${entry.name} uses .yml extension. Rename to .yaml to be recognized.`,
      );
    }
  }

  if (errors.length > 0) {
    throw new UserError(
      `Agent validation failed:\n  ${errors.join("\n  ")}`,
      agentsDir,
    );
  }

  return agents;
}
