import { stringify as yamlStringify } from "yaml";
import type { ModelTiers, SkillSource } from "../config/schema.js";
import { makeMdHeader } from "../utils/managed-header.js";
import { resolvePlaceholders } from "./placeholders.js";

export interface RenderedCodexSkill {
  skillMd: string;
  sidecar: string | null;
}

export interface SkillInput {
  source: SkillSource;
  body: string;
}

const SHARED_KEY_ORDER: Array<keyof SkillSource> = [
  "name",
  "description",
  "allowed-tools",
];

export function renderCodexSkill(
  input: SkillInput,
  modelTiers: ModelTiers | undefined,
): RenderedCodexSkill {
  const { source, body } = input;

  const frontmatter: Record<string, unknown> = {};
  for (const key of SHARED_KEY_ORDER) {
    const value = source[key];
    if (value === undefined) continue;
    if (key === "allowed-tools" && Array.isArray(value)) {
      frontmatter[key] = value.join(" ");
    } else {
      frontmatter[key as string] = value;
    }
  }

  if (source.codex) {
    const sortedKeys = Object.keys(source.codex).sort();
    for (const key of sortedKeys) {
      const value = (source.codex as Record<string, unknown>)[key];
      frontmatter[key] =
        typeof value === "string"
          ? resolvePlaceholders(value, "codex", modelTiers)
          : value;
    }
  }

  const headerMd = makeMdHeader(`skills/${source.name}/SKILL.md`);
  const yaml = yamlStringify(frontmatter, { lineWidth: 0 });
  const renderedBody = resolvePlaceholders(body, "codex", modelTiers);

  const skillMd = `${headerMd}\n---\n${yaml}---\n${renderedBody}`;

  const sidecar = source.codex_sidecar
    ? yamlStringify(source.codex_sidecar, { lineWidth: 0 })
    : null;

  return { skillMd, sidecar };
}
