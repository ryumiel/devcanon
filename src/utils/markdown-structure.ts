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

    return new MarkdownStructure(Object.freeze(codeRanges));
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
