import { describe, expect, it, vi } from "vitest";
import { parseMarkdownStructure } from "./markdown-structure.js";

async function loadFreshParser(): Promise<typeof parseMarkdownStructure> {
  vi.resetModules();
  return (await import("./markdown-structure.js")).parseMarkdownStructure;
}

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

  it("reuses one immutable structure for an exact cached input", async () => {
    const parse = await loadFreshParser();
    const first = parse("```\nliteral\n```");
    const second = parse("```\nliteral\n```");

    expect(second).toBe(first);
    expect(Object.isFrozen(second)).toBe(true);
    expect(Object.isFrozen(second.blockCodeRanges())).toBe(true);
    expect(Object.isFrozen(second.blockCodeRanges()[0])).toBe(true);
  });

  it("refreshes recency and evicts the least-recently used 129th entry", async () => {
    const parse = await loadFreshParser();
    const first = parse("cache entry 0");
    const leastRecent = parse("cache entry 1");
    for (let index = 2; index < 128; index += 1) {
      parse(`cache entry ${index}`);
    }

    expect(parse("cache entry 0")).toBe(first);
    parse("cache entry 128");

    expect(parse("cache entry 0")).toBe(first);
    expect(parse("cache entry 1")).not.toBe(leastRecent);
  });

  it("does not cache multibyte input over the UTF-8 byte limit", async () => {
    const parse = await loadFreshParser();
    const oversized = "한".repeat(100_000);

    expect(Buffer.byteLength(oversized, "utf8")).toBeGreaterThan(256 * 1024);
    expect(oversized.length).toBeLessThan(256 * 1024);
    expect(parse(oversized)).not.toBe(parse(oversized));
  });
});
