interface FenceState {
  char: "`" | "~";
  length: number;
}

interface ListContext {
  contentIndent: number;
  codeIndent: number;
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

function isIndentedCodeLine(line: string): boolean {
  return /^( {4,}|\t)/.test(line);
}

function advanceColumn(column: number, char: string): number {
  if (char === "\t") {
    const remainder = column % 4;
    return column + (remainder === 0 ? 4 : 4 - remainder);
  }

  return column + 1;
}

function measureColumns(text: string, startColumn = 0): number {
  let column = startColumn;

  for (const char of text) {
    column = advanceColumn(column, char);
  }

  return column;
}

function leadingIndentColumns(line: string): number {
  const indent = line.match(/^[ \t]*/)?.[0] ?? "";
  return measureColumns(indent);
}

function stripBlockquotePrefixes(line: string): string {
  let rest = line;

  while (true) {
    const match = rest.match(/^( {0,3}> ?)/);
    if (!match) return rest;
    rest = rest.slice(match[0].length);
  }
}

function listContextForLine(line: string): ListContext | null {
  const match = line.match(/^([ \t]*)([-+*]|\d+[.)])([ \t]+)/);
  if (!match) return null;

  const markerStart = measureColumns(match[1]);
  const markerEnd = markerStart + match[2].length;
  const contentIndent = measureColumns(match[3], markerEnd);

  return {
    contentIndent,
    codeIndent: contentIndent + 4,
  };
}

function isWithinListContext(line: string, context: ListContext): boolean {
  if (line.trim().length === 0) return true;
  return leadingIndentColumns(line) >= context.contentIndent;
}

function isListIndentedCodeLine(line: string, context: ListContext): boolean {
  return (
    isIndentedCodeLine(line) && leadingIndentColumns(line) >= context.codeIndent
  );
}

function isParagraphLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (/^#{1,6}(?:\s|$)/.test(trimmed)) return false;
  if (/^>/.test(trimmed)) return false;
  if (/^([-+*])(?:\s|$)/.test(trimmed)) return false;
  if (/^\d+[.)]\s/.test(trimmed)) return false;
  if (/^([-*_])(?:\s*\1){2,}\s*$/.test(trimmed)) return false;
  return true;
}

export function visitMarkdownLines(
  input: string,
  visitor: MarkdownLineVisitor,
): void {
  const lines = input.split("\n");
  let openFence: FenceState | null = null;
  let inIndentedCodeBlock = false;
  let afterParagraphLine = false;
  let listContext: ListContext | null = null;

  for (const line of lines) {
    const normalizedLine = stripBlockquotePrefixes(line);
    const trimmed = normalizedLine.trimStart();
    if (openFence === null) {
      if (inIndentedCodeBlock) {
        if (
          normalizedLine.trim().length === 0 ||
          isIndentedCodeLine(normalizedLine)
        ) {
          visitor.onCodeLine?.(line);
          afterParagraphLine = false;
          continue;
        }

        inIndentedCodeBlock = false;
      }

      const opening = fenceInfo(trimmed);
      if (opening) {
        openFence = opening;
        visitor.onFenceLine?.(line);
        afterParagraphLine = false;
        continue;
      }

      if (
        listContext !== null &&
        isListIndentedCodeLine(normalizedLine, listContext)
      ) {
        inIndentedCodeBlock = true;
        visitor.onCodeLine?.(line);
        afterParagraphLine = false;
        continue;
      }

      if (
        !afterParagraphLine &&
        listContext === null &&
        isIndentedCodeLine(normalizedLine)
      ) {
        inIndentedCodeBlock = true;
        visitor.onCodeLine?.(line);
        afterParagraphLine = false;
        continue;
      }

      visitor.onProseLine(line);
      afterParagraphLine = isParagraphLine(normalizedLine);
      const nextListContext = listContextForLine(normalizedLine);
      if (nextListContext !== null) {
        listContext = nextListContext;
      } else if (
        listContext !== null &&
        isWithinListContext(normalizedLine, listContext)
      ) {
        // Keep the current list context active across blank lines and indented
        // continuation content so nested code can still be recognized
        // relative to the list item's content column.
      } else {
        listContext = null;
      }
      continue;
    }

    // Inside an open fence: only a same-char, equal-or-longer fence with no
    // info string closes it. A nested ``` inside a 4-backtick fence, or a
    // tilde line inside a backtick fence, does not close.
    if (isClosingFence(trimmed, openFence)) {
      openFence = null;
      visitor.onFenceLine?.(line);
      afterParagraphLine = false;
      continue;
    }

    visitor.onCodeLine?.(line);
    afterParagraphLine = false;
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
