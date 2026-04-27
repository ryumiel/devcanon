interface FenceState {
  char: "`" | "~";
  length: number;
}

interface MarkdownLineVisitor {
  onProseLine(line: string): void;
  onFenceLine?(line: string): void;
  onCodeLine?(line: string): void;
}

/**
 * Per CommonMark, an opening fence is 3+ backticks OR 3+ tildes.
 * The closing fence must use the same character, be at least as long as the
 * opener, carry no info string, and may have trailing whitespace only.
 */
const FENCE_OPEN = /^(`{3,}|~{3,})/;

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

export function visitMarkdownLines(
  input: string,
  visitor: MarkdownLineVisitor,
): void {
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
