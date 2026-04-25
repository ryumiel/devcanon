import { parse as parseYaml, stringify as yamlStringify } from "yaml";

export interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
}

const FENCE = "---";

export function parseFrontmatter(input: string): ParsedFrontmatter {
  if (!input.startsWith(`${FENCE}\n`) && !input.startsWith(`${FENCE}\r\n`)) {
    return { frontmatter: {}, body: input };
  }

  const firstFenceEnd = input.indexOf("\n") + 1;
  const rest = input.slice(firstFenceEnd);
  const closingMatch = rest.match(/^---[ \t]*(?:\r?\n|$)/m);

  if (!closingMatch || closingMatch.index === undefined) {
    throw new Error("Frontmatter is unterminated: missing closing '---' fence");
  }

  const yamlBlock = rest.slice(0, closingMatch.index);
  const bodyStart = closingMatch.index + closingMatch[0].length;
  const rawBody = rest.slice(bodyStart);
  // Strip the single newline that conventionally follows the closing fence
  // (handles both LF and CRLF). Without this the leading "\r" on Windows
  // documents survives and corrupts SKILL.md / contentHash.
  const body = rawBody.startsWith("\r\n")
    ? rawBody.slice(2)
    : rawBody.startsWith("\n")
      ? rawBody.slice(1)
      : rawBody;

  const parsed = yamlBlock.trim().length === 0 ? {} : parseYaml(yamlBlock);

  if (parsed === null || parsed === undefined) {
    return { frontmatter: {}, body };
  }

  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Frontmatter must be a YAML mapping");
  }

  return {
    frontmatter: parsed as Record<string, unknown>,
    body,
  };
}

export function serializeFrontmatter(
  frontmatter: Record<string, unknown>,
): string {
  if (Object.keys(frontmatter).length === 0) return "";
  const yaml = yamlStringify(frontmatter);
  return `---\n${yaml}---\n`;
}
