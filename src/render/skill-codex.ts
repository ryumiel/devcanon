import { stringify as yamlStringify } from "yaml";
import type { PlaceholderGlossary } from "./placeholders.js";
import { resolvePlaceholders } from "./placeholders.js";
import { SHARED_KEY_ORDER, type SkillInput } from "./skill-shared.js";

export type { SkillInput } from "./skill-shared.js";

export interface RenderedCodexSkill {
  skillMd: string;
  sidecar: string | null;
}

export function renderCodexSkill(
  input: SkillInput,
  glossary: PlaceholderGlossary,
): RenderedCodexSkill {
  const { source, body } = input;

  const frontmatter: Record<string, unknown> = {};
  for (const key of SHARED_KEY_ORDER) {
    const value = source[key];
    if (value === undefined) continue;
    if (key === "allowed-tools" && Array.isArray(value)) {
      frontmatter[key] = value.join(" ");
    } else {
      frontmatter[key] = value;
    }
  }

  // Only top-level codex override strings are placeholder-substituted.
  // Nested values (e.g. metadata sub-keys) pass through as-is.
  if (source.codex) {
    const sortedKeys = Object.keys(source.codex).sort();
    for (const key of sortedKeys) {
      const value = (source.codex as Record<string, unknown>)[key];
      frontmatter[key] =
        typeof value === "string"
          ? resolvePlaceholders(value, "codex", glossary)
          : value;
    }
  }

  const yaml = yamlStringify(frontmatter, { lineWidth: 0 });
  const renderedBody = resolvePlaceholders(body, "codex", glossary);

  const skillMd = `---\n${yaml}---\n${renderedBody}`;

  const sidecar = source.codex_sidecar
    ? yamlStringify(source.codex_sidecar, { lineWidth: 0 })
    : null;

  return { skillMd, sidecar };
}
