import type { ModelTiers } from "../config/schema.js";
import {
  collectProseSegments,
  visitMarkdownLines,
} from "../utils/markdown-prose.js";

/**
 * Matches an optional escape (`\`) followed by `{{namespace:value}}`.
 * Only `\w+` characters inside the braces.
 */
const PLACEHOLDER = /(\\)?\{\{(\w+):(\w+)\}\}/g;
export { collectProseSegments } from "../utils/markdown-prose.js";

export function resolvePlaceholders(
  input: string,
  target: "claude" | "codex",
  modelTiers: ModelTiers | undefined,
): string {
  const out: string[] = [];

  visitMarkdownLines(input, {
    onProseLine: (line) => {
      out.push(substituteLine(line, target, modelTiers));
    },
    onFenceLine: (line) => {
      out.push(line);
    },
    onCodeLine: (line) => {
      out.push(line);
    },
  });

  return out.join("\n");
}

function substituteLine(
  line: string,
  target: "claude" | "codex",
  modelTiers: ModelTiers | undefined,
): string {
  return line.replace(PLACEHOLDER, (_match, esc, namespace, value) => {
    if (esc) {
      return `{{${namespace}:${value}}}`;
    }
    if (namespace !== "model") {
      throw new Error(
        `Unknown placeholder namespace "${namespace}" — only "model" is supported`,
      );
    }
    if (!modelTiers) {
      throw new Error(
        "modelTiers not configured — define modelTiers in agents-manager.config.yaml",
      );
    }
    const tier = modelTiers[value];
    if (!tier) {
      throw new Error(
        `Unknown tier "${value}" — define it under modelTiers in config`,
      );
    }
    return tier[target];
  });
}
