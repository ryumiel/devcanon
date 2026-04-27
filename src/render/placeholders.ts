import type { ModelTiers } from "../config/schema.js";

/**
 * Matches an optional escape (`\`) followed by `{{namespace:value}}`.
 * Only `\w+` characters inside the braces.
 */
const PLACEHOLDER = /(\\)?\{\{(\w+):(\w+)\}\}/g;

/**
 * Per CommonMark, an opening fence is 3+ backticks OR 3+ tildes.
 * The closing fence must use the same character, be at least as long as the
 * opener, carry no info string, and may have trailing whitespace only.
 */
const FENCE_OPEN = /^(`{3,}|~{3,})/;

interface FenceState {
  char: "`" | "~";
  length: number;
}

interface MarkdownLineVisitor {
  onProseLine(line: string): void;
  onFenceLine?(line: string): void;
  onCodeLine?(line: string): void;
}

function fenceInfo(line: string): FenceState | null {
  const match = line.match(FENCE_OPEN);
  if (!match) return null;
  const char = match[1][0] as "`" | "~";
  return { char, length: match[1].length };
}

function isClosingFence(line: string, open: FenceState): boolean {
  const info = fenceInfo(line);
  if (!info) return false;
  if (info.char !== open.char) return false;
  if (info.length < open.length) return false;
  // Closing fences carry no info string — only the fence run plus optional
  // trailing whitespace.
  const fenceRun = info.char.repeat(info.length);
  const after = line.slice(line.indexOf(fenceRun) + info.length);
  return /^\s*$/.test(after);
}

function visitMarkdownLines(input: string, visitor: MarkdownLineVisitor): void {
  const lines = input.split("\n");
  let openFence: FenceState | null = null;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (openFence === null) {
      const opening = fenceInfo(trimmed);
      if (opening) {
        openFence = opening;
        visitor.onFenceLine?.(line);
        continue;
      }
      visitor.onProseLine(line);
      continue;
    }

    // Inside an open fence: only a same-char, equal-or-longer fence with no
    // info string closes it. A nested ``` inside a 4-backtick fence, or a
    // tilde line inside a backtick fence, does not close.
    if (isClosingFence(trimmed, openFence)) {
      openFence = null;
      visitor.onFenceLine?.(line);
      continue;
    }

    visitor.onCodeLine?.(line);
  }
}

export function collectProseSegments(input: string): string[] {
  const segments: string[] = [];
  let current: string[] = [];

  const flush = () => {
    if (current.length === 0) return;
    segments.push(current.join("\n"));
    current = [];
  };

  visitMarkdownLines(input, {
    onProseLine: (line) => {
      current.push(line);
    },
    onFenceLine: () => {
      flush();
    },
    onCodeLine: () => {
      flush();
    },
  });

  flush();
  return segments;
}

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
