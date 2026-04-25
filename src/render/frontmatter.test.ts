import { describe, expect, it } from "vitest";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.js";

describe("parseFrontmatter", () => {
  it("splits frontmatter and body on a well-formed document", () => {
    const input = "---\nname: foo\ndescription: bar\n---\n\n# Body\n\ntext.\n";
    const result = parseFrontmatter(input);
    expect(result.frontmatter).toEqual({ name: "foo", description: "bar" });
    expect(result.body).toBe("# Body\n\ntext.\n");
  });

  it("returns empty frontmatter and full content as body when no frontmatter present", () => {
    const input = "# Just a body\n\ntext.\n";
    const result = parseFrontmatter(input);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe(input);
  });

  it("throws when frontmatter opening fence is present but closing fence is missing", () => {
    const input = "---\nname: foo\n# Body\n";
    expect(() => parseFrontmatter(input)).toThrow(/unterminated/i);
  });

  it("preserves leading whitespace in the body", () => {
    const input = "---\nname: foo\n---\n\n\n  indented body\n";
    const result = parseFrontmatter(input);
    expect(result.body).toBe("\n  indented body\n");
  });

  it("handles CRLF line endings without leaking a leading \\r into the body", () => {
    const input = "---\r\nname: x\r\n---\r\n\r\nbody\r\n";
    const result = parseFrontmatter(input);
    expect(result.frontmatter).toEqual({ name: "x" });
    expect(result.body).toBe("body\r\n");
  });

  it("accepts a closing fence at end-of-input with no trailing newline", () => {
    const input = "---\nname: x\n---";
    const result = parseFrontmatter(input);
    expect(result.frontmatter).toEqual({ name: "x" });
    expect(result.body).toBe("");
  });
});

describe("serializeFrontmatter", () => {
  it("serializes a simple frontmatter block in order", () => {
    const output = serializeFrontmatter({ name: "foo", description: "bar" });
    expect(output).toBe("---\nname: foo\ndescription: bar\n---\n");
  });

  it("round-trips through parseFrontmatter", () => {
    const fm = { name: "foo", description: "bar with: colon" };
    const serialized = serializeFrontmatter(fm);
    const parsed = parseFrontmatter(`${serialized}\nbody\n`);
    expect(parsed.frontmatter).toEqual(fm);
  });
});
