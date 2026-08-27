import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

export interface MarkdownSourceRange {
  readonly start: number;
  readonly end: number;
}

interface MarkdownNode {
  readonly type: string;
  readonly position?: {
    readonly start: { readonly offset?: number };
    readonly end: { readonly offset?: number };
  };
  readonly children?: readonly MarkdownNode[];
}

// Validation and target rendering commonly inspect the same exact skill body.
// Keep only a small LRU of ordinary-sized inputs so reuse cannot grow retained
// source without bound in a long-lived caller.
const CACHE_CAPACITY = 128;
const CACHE_MAX_INPUT_BYTES = 256 * 1024;
const structureCache = new Map<string, MarkdownStructure>();

/**
 * Opaque structural view of one exact Markdown input.
 *
 * Consumers receive source ranges only; mdast node shapes stay private to this
 * adapter so artifact-specific policy cannot depend on parser representation.
 */
export class MarkdownStructure {
  private constructor(
    private readonly codeRanges: readonly MarkdownSourceRange[],
  ) {}

  static parse(input: string): MarkdownStructure {
    const cached = structureCache.get(input);
    if (cached !== undefined) {
      structureCache.delete(input);
      structureCache.set(input, cached);
      return cached;
    }

    const tree = fromMarkdown(input, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    }) as MarkdownNode;
    const codeRanges: MarkdownSourceRange[] = [];

    visit(tree, (node) => {
      if (node.type !== "code") return;
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) {
        throw new Error("Markdown block code is missing a source range.");
      }
      codeRanges.push(Object.freeze({ start, end }));
    });

    const structure = new MarkdownStructure(Object.freeze(codeRanges));
    Object.freeze(structure);
    if (Buffer.byteLength(input, "utf8") <= CACHE_MAX_INPUT_BYTES) {
      if (structureCache.size >= CACHE_CAPACITY) {
        const oldestInput = structureCache.keys().next().value;
        if (oldestInput !== undefined) {
          structureCache.delete(oldestInput);
        }
      }
      structureCache.set(input, structure);
    }

    return structure;
  }

  blockCodeRanges(): readonly MarkdownSourceRange[] {
    return this.codeRanges;
  }
}

export function parseMarkdownStructure(input: string): MarkdownStructure {
  return MarkdownStructure.parse(input);
}

function visit(
  node: MarkdownNode,
  visitor: (node: MarkdownNode) => void,
): void {
  visitor(node);
  for (const child of node.children ?? []) {
    visit(child, visitor);
  }
}
