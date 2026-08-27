import { describe, expect, it } from "vitest";
import { parseMarkdownStructure } from "./markdown-structure.js";

describe("parseMarkdownStructure", () => {
  it("reports block-code ranges in exact input coordinates", () => {
    const input = ["before", "```ts", "literal", "```", "after"].join("\n");

    expect(parseMarkdownStructure(input).blockCodeRanges()).toEqual([
      { start: 7, end: 24 },
    ]);
  });

  it("classifies fenced, indented, and container-nested block code only", () => {
    const literals = [
      "fenced literal",
      "indented literal",
      "quoted literal",
      "listed literal",
    ];
    const active = [
      "list prose",
      "quote prose",
      "inline active",
      "heading active",
      "link active",
      "html active",
    ];
    const input = [
      "```",
      literals[0],
      "```",
      "",
      `    ${literals[1]}`,
      "",
      "> ```",
      `> ${literals[2]}`,
      "> ```",
      "",
      "- item",
      "",
      `      ${literals[3]}`,
      "",
      `- ${active[0]}`,
      `> ${active[1]}`,
      `\`${active[2]}\``,
      `# ${active[3]}`,
      `[${active[4]}](https://example.com)`,
      `<span>${active[5]}</span>`,
    ].join("\n");

    const ranges = parseMarkdownStructure(input).blockCodeRanges();
    const isInBlockCode = (text: string) => {
      const offset = input.indexOf(text);
      return ranges.some(
        (range) => offset >= range.start && offset < range.end,
      );
    };

    expect(literals.every(isInBlockCode)).toBe(true);
    expect(active.every((text) => !isInBlockCode(text))).toBe(true);
  });
});
