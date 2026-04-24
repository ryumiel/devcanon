import { stringify as yamlStringify } from "yaml";
import type { ModelTiers, SkillSource } from "../config/schema.js";
import { makeMdHeader } from "../utils/managed-header.js";
import { resolvePlaceholders } from "./placeholders.js";

export interface SkillInput {
  source: SkillSource;
  body: string;
}

const SHARED_KEY_ORDER: Array<keyof SkillSource> = [
  "name",
  "description",
  "allowed-tools",
];

export function renderClaudeSkill(
  input: SkillInput,
  modelTiers: ModelTiers | undefined,
): string {
  const { source, body } = input;

  const frontmatter: Record<string, unknown> = {};
  for (const key of SHARED_KEY_ORDER) {
    if (source[key] !== undefined) {
      frontmatter[key as string] = source[key];
    }
  }

  if (source.claude) {
    const sortedKeys = Object.keys(source.claude).sort();
    for (const key of sortedKeys) {
      const value = (source.claude as Record<string, unknown>)[key];
      frontmatter[key] =
        typeof value === "string"
          ? resolvePlaceholders(value, "claude", modelTiers)
          : value;
    }
  }

  const headerMd = makeMdHeader(`skills/${source.name}/SKILL.md`);
  const yaml = yamlStringify(frontmatter);
  const renderedBody = resolvePlaceholders(body, "claude", modelTiers);

  return `${headerMd}\n---\n${yaml}---\n${renderedBody}`;
}
