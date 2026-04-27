import { describe, expect, it } from "vitest";
import type { ModelTiers } from "../config/schema.js";
import { collectProseSegments, resolvePlaceholders } from "./placeholders.js";

const TIERS: ModelTiers = {
  fast: { claude: "haiku", codex: "gpt-5.4-mini" },
  standard: { claude: "sonnet", codex: "gpt-5.4" },
  deep: { claude: "opus", codex: "gpt-5.4" },
};

describe("resolvePlaceholders", () => {
  it("iterates prose and fenced-code segments with fenced code immunity", () => {
    const segments = collectProseSegments(
      [
        "Use opus here.",
        "```ts",
        'const model = "opus";',
        "```",
        "Use sonnet here.",
        "",
      ].join("\n"),
    );

    expect(segments).toHaveLength(2);
    expect(segments[0]).toContain("Use opus here.");
    expect(segments[1]).toContain("Use sonnet here.");
    expect(segments.join("\n")).not.toContain('const model = "opus";');
    expect(segments.join("\n")).not.toContain("```ts");
  });

  it("substitutes a single tier for the claude target", () => {
    const out = resolvePlaceholders(
      "use {{model:deep}} for synthesis",
      "claude",
      TIERS,
    );
    expect(out).toBe("use opus for synthesis");
  });

  it("substitutes a single tier for the codex target", () => {
    const out = resolvePlaceholders(
      "use {{model:fast}} for cleanup",
      "codex",
      TIERS,
    );
    expect(out).toBe("use gpt-5.4-mini for cleanup");
  });

  it("substitutes multiple placeholders in one string", () => {
    const out = resolvePlaceholders(
      "{{model:deep}} then {{model:fast}}",
      "claude",
      TIERS,
    );
    expect(out).toBe("opus then haiku");
  });

  it("leaves content inside a fenced code block untouched", () => {
    const input = [
      "use {{model:deep}} for synthesis.",
      "",
      "```",
      "example: {{model:deep}} stays literal",
      "```",
      "",
      "and {{model:fast}} after.",
    ].join("\n");
    const out = resolvePlaceholders(input, "claude", TIERS);
    expect(out).toContain("use opus for synthesis");
    expect(out).toContain("example: {{model:deep}} stays literal");
    expect(out).toContain("and haiku after");
  });

  it("leaves heading-adjacent indented code blocks untouched", () => {
    const input = [
      "# Example",
      "    model: {{model:deep}}",
      "",
      "after: {{model:fast}}",
    ].join("\n");
    const out = resolvePlaceholders(input, "claude", TIERS);
    expect(out).toContain("    model: {{model:deep}}");
    expect(out).toContain("after: haiku");
  });

  it("respects escape syntax", () => {
    const out = resolvePlaceholders(
      "literal \\{{model:deep}} here",
      "claude",
      TIERS,
    );
    expect(out).toBe("literal {{model:deep}} here");
  });

  it("throws on an unknown tier", () => {
    expect(() =>
      resolvePlaceholders("{{model:ultra}}", "claude", TIERS),
    ).toThrow(/unknown tier "ultra"/i);
  });

  it("throws on an unknown namespace", () => {
    expect(() =>
      resolvePlaceholders("{{path:skills_home}}", "claude", TIERS),
    ).toThrow(/unknown placeholder namespace "path"/i);
  });

  it("throws when modelTiers is undefined and a placeholder is present", () => {
    expect(() =>
      resolvePlaceholders("{{model:deep}}", "claude", undefined),
    ).toThrow(/modelTiers not configured/i);
  });

  it("is a no-op when there are no placeholders", () => {
    expect(resolvePlaceholders("plain text", "claude", TIERS)).toBe(
      "plain text",
    );
    expect(resolvePlaceholders("plain text", "claude", undefined)).toBe(
      "plain text",
    );
  });

  it("does not treat a language-tagged fence line as a closing fence", () => {
    const input = [
      "```",
      "```typescript",
      'const model = "{{model:deep}}";',
      "```",
      "",
      "after: {{model:fast}}",
    ].join("\n");
    const out = resolvePlaceholders(input, "claude", TIERS);
    // Inside the outer ``` fence, placeholders stay literal even past
    // the nested ```typescript line.
    expect(out).toContain('const model = "{{model:deep}}"');
    // Substitution resumes after the outer fence closes.
    expect(out).toContain("after: haiku");
  });

  it("does not treat an inner triple-backtick line as closing a 4-backtick fence", () => {
    const input = [
      "````",
      "```",
      "{{model:deep}}",
      "```",
      "````",
      "",
      "after: {{model:fast}}",
    ].join("\n");
    const out = resolvePlaceholders(input, "claude", TIERS);
    // Inside the outer 4-backtick fence, placeholders must remain literal,
    // even past nested triple-backtick lines.
    expect(out).toContain("{{model:deep}}");
    expect(out).toContain("after: haiku");
  });

  it("treats tilde fences as code fences", () => {
    const input = [
      "~~~",
      "{{model:deep}}",
      "~~~",
      "",
      "after: {{model:fast}}",
    ].join("\n");
    const out = resolvePlaceholders(input, "claude", TIERS);
    expect(out).toContain("{{model:deep}}");
    expect(out).toContain("after: haiku");
  });

  it("does not let a tilde line close a backtick fence", () => {
    const input = [
      "```",
      "~~~",
      "{{model:deep}}",
      "~~~",
      "```",
      "",
      "after: {{model:fast}}",
    ].join("\n");
    const out = resolvePlaceholders(input, "claude", TIERS);
    expect(out).toContain("{{model:deep}}");
    expect(out).toContain("after: haiku");
  });

  it("consumes only the closest backslash as the escape marker", () => {
    // Two literal backslashes then a placeholder. The regex only captures
    // one backslash as the escape, so the outer backslash passes through
    // and the inner one marks the placeholder as literal.
    const out = resolvePlaceholders("\\\\{{model:deep}}", "claude", TIERS);
    expect(out).toBe("\\{{model:deep}}");
  });
});
