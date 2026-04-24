import type { ModelTiers } from "../config/schema.js";

/**
 * Matches an optional escape (`\`) followed by `{{namespace:value}}`.
 * Only `\w+` characters inside the braces.
 */
const PLACEHOLDER = /(\\)?\{\{(\w+):(\w+)\}\}/g;

/** Detects the start of a fenced code block (```). Matches with or without info string. */
const CODE_FENCE_OPEN = /^```/;
/**
 * Detects a closing fenced code block. Per CommonMark, closing fences must
 * not carry an info string — so `\`\`\`lang` inside an open fence does not
 * close it.
 */
const CODE_FENCE_CLOSE = /^```\s*$/;

export function resolvePlaceholders(
  input: string,
  target: "claude" | "codex",
  modelTiers: ModelTiers | undefined,
): string {
  const lines = input.split("\n");
  let inFence = false;
  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!inFence && CODE_FENCE_OPEN.test(trimmed)) {
      inFence = true;
      out.push(line);
      continue;
    }
    if (inFence && CODE_FENCE_CLOSE.test(trimmed)) {
      inFence = false;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    out.push(substituteLine(line, target, modelTiers));
  }

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
