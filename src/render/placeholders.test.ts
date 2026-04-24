import { describe, expect, it } from "vitest";
import type { ModelTiers } from "../config/schema.js";
import { resolvePlaceholders } from "./placeholders.js";

const TIERS: ModelTiers = {
  fast: { claude: "haiku", codex: "gpt-5.4-mini" },
  standard: { claude: "sonnet", codex: "gpt-5.4" },
  deep: { claude: "opus", codex: "gpt-5.4" },
};

describe("resolvePlaceholders", () => {
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
});
