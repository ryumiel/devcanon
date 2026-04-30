import { stringify as yamlStringify } from "yaml";
import type { PlaceholderGlossary } from "./placeholders.js";
import { resolvePlaceholders } from "./placeholders.js";
import { SHARED_KEY_ORDER, type SkillInput } from "./skill-shared.js";

export type { SkillInput } from "./skill-shared.js";

export function renderClaudeSkill(
  input: SkillInput,
  glossary: PlaceholderGlossary,
): string {
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

  if (source.claude) {
    const sortedKeys = Object.keys(source.claude).sort();
    for (const key of sortedKeys) {
      const value = (source.claude as Record<string, unknown>)[key];
      frontmatter[key] =
        typeof value === "string"
          ? resolvePlaceholders(value, "claude", glossary)
          : value;
    }
  }

  const yaml = yamlStringify(frontmatter, { lineWidth: 0 });
  const renderedBody = resolvePlaceholders(body, "claude", glossary);

  return `---\n${yaml}---\n${renderedBody}`;
}
