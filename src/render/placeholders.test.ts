import { describe, expect, it } from "vitest";
import type {
  FileArtifacts,
  ModelTiers,
  ToolNames,
} from "../config/schema.js";
import { collectProseSegments, resolvePlaceholders } from "./placeholders.js";

const TIERS: ModelTiers = {
  fast: { claude: "haiku", codex: "gpt-5.4-mini" },
  standard: { claude: "sonnet", codex: "gpt-5.4" },
  deep: { claude: "opus", codex: "gpt-5.4" },
};

const TOOLS: ToolNames = {
  "task-tracker": { claude: "TodoWrite", codex: "update_plan" },
};

const FILES: FileArtifacts = {
  "project-instructions": { claude: "CLAUDE.md", codex: "AGENTS.md" },
};

const GLOSSARY = { model: TIERS, tool: TOOLS, file: FILES };
const MODEL_ONLY = { model: TIERS };

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
      MODEL_ONLY,
    );
    expect(out).toBe("use opus for synthesis");
  });

  it("substitutes a single tier for the codex target", () => {
    const out = resolvePlaceholders(
      "use {{model:fast}} for cleanup",
      "codex",
      MODEL_ONLY,
    );
    expect(out).toBe("use gpt-5.4-mini for cleanup");
  });

  it("substitutes multiple placeholders in one string", () => {
    const out = resolvePlaceholders(
      "{{model:deep}} then {{model:fast}}",
      "claude",
      MODEL_ONLY,
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
    const out = resolvePlaceholders(input, "claude", MODEL_ONLY);
    expect(out).toContain("use opus for synthesis");
    expect(out).toContain("example: {{model:deep}} stays literal");
    expect(out).toContain("and haiku after");
  });

  it("leaves content inside a blockquoted fenced code block untouched", () => {
    const input = [
      "before: {{model:fast}}",
      "> ```ts",
      '> const model = "{{model:deep}}";',
      "> ```",
      "after: {{model:standard}}",
    ].join("\n");

    const out = resolvePlaceholders(input, "claude", MODEL_ONLY);
    expect(out).toContain("before: haiku");
    expect(out).toContain('> const model = "{{model:deep}}"');
    expect(out).toContain("after: sonnet");
  });

  it("leaves heading-adjacent indented code blocks untouched", () => {
    const input = [
      "# Example",
      "    model: {{model:deep}}",
      "",
      "after: {{model:fast}}",
    ].join("\n");
    const out = resolvePlaceholders(input, "claude", MODEL_ONLY);
    expect(out).toContain("    model: {{model:deep}}");
    expect(out).toContain("after: haiku");
  });

  it("leaves content inside a blockquoted indented code block untouched", () => {
    const input = [
      "before: {{model:fast}}",
      "> # Example",
      ">     preferred_model: {{model:deep}}",
      "after: {{model:standard}}",
    ].join("\n");

    const out = resolvePlaceholders(input, "claude", MODEL_ONLY);
    expect(out).toContain("before: haiku");
    expect(out).toContain("> # Example");
    expect(out).toContain(">     preferred_model: {{model:deep}}");
    expect(out).toContain("after: sonnet");
  });

  it("treats indented list continuation lines as prose", () => {
    const input = [
      "1. Item",
      "    continuation with {{model:standard}}",
      "",
    ].join("\n");
    const out = resolvePlaceholders(input, "claude", MODEL_ONLY);
    expect(out).toContain("continuation with sonnet");
  });

  it("leaves nested list indented code blocks untouched", () => {
    const input = [
      "- Item",
      "      const bulletPreferred = {{model:standard}}",
      "1. Ordered",
      "       const orderedPreferred = {{model:deep}}",
      "",
    ].join("\n");

    const out = resolvePlaceholders(input, "claude", MODEL_ONLY);
    expect(out).toContain("const bulletPreferred = {{model:standard}}");
    expect(out).toContain("const orderedPreferred = {{model:deep}}");
  });

  it("leaves nested list code blocks untouched when the list marker uses a tab separator", () => {
    const input = [
      "-\tItem",
      "        const preferred = {{model:standard}}",
      "1.\tOrdered",
      "        const orderedPreferred = {{model:deep}}",
      "",
    ].join("\n");

    const out = resolvePlaceholders(input, "claude", MODEL_ONLY);
    expect(out).toContain("const preferred = {{model:standard}}");
    expect(out).toContain("const orderedPreferred = {{model:deep}}");
  });

  it("keeps nested list code blocks after continuation prose untouched", () => {
    const input = [
      "- Item",
      "    continuation with {{model:fast}}",
      "",
      "      const preferred = {{model:standard}}",
      "",
    ].join("\n");

    const out = resolvePlaceholders(input, "claude", MODEL_ONLY);
    expect(out).toContain("continuation with haiku");
    expect(out).toContain("const preferred = {{model:standard}}");
  });

  it("treats single-tab list continuations as prose before nested tab-indented code", () => {
    const input = [
      "- Item",
      "\tcontinuation with {{model:fast}}",
      "",
      "\t\tconst preferred = {{model:standard}}",
      "",
    ].join("\n");

    const out = resolvePlaceholders(input, "claude", MODEL_ONLY);
    expect(out).toContain("continuation with haiku");
    expect(out).toContain("const preferred = {{model:standard}}");
  });

  it("respects escape syntax", () => {
    const out = resolvePlaceholders(
      "literal \\{{model:deep}} here",
      "claude",
      MODEL_ONLY,
    );
    expect(out).toBe("literal {{model:deep}} here");
  });

  it("throws on an unknown tier", () => {
    expect(() =>
      resolvePlaceholders("{{model:ultra}}", "claude", MODEL_ONLY),
    ).toThrow(/unknown model key "ultra"/i);
  });

  it("throws on an unknown namespace", () => {
    expect(() =>
      resolvePlaceholders("{{path:skills_home}}", "claude", GLOSSARY),
    ).toThrow(/unknown placeholder namespace "path"/i);
  });

  it("throws when modelTiers is undefined and a placeholder is present", () => {
    expect(() =>
      resolvePlaceholders("{{model:deep}}", "claude", {}),
    ).toThrow(/modelTiers not configured/i);
  });

  it("is a no-op when there are no placeholders", () => {
    expect(resolvePlaceholders("plain text", "claude", MODEL_ONLY)).toBe(
      "plain text",
    );
    expect(resolvePlaceholders("plain text", "claude", {})).toBe(
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
    const out = resolvePlaceholders(input, "claude", MODEL_ONLY);
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
    const out = resolvePlaceholders(input, "claude", MODEL_ONLY);
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
    const out = resolvePlaceholders(input, "claude", MODEL_ONLY);
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
    const out = resolvePlaceholders(input, "claude", MODEL_ONLY);
    expect(out).toContain("{{model:deep}}");
    expect(out).toContain("after: haiku");
  });

  it("consumes only the closest backslash as the escape marker", () => {
    // Two literal backslashes then a placeholder. The regex only captures
    // one backslash as the escape, so the outer backslash passes through
    // and the inner one marks the placeholder as literal.
    const out = resolvePlaceholders("\\\\{{model:deep}}", "claude", MODEL_ONLY);
    expect(out).toBe("\\{{model:deep}}");
  });

  describe("tool: namespace", () => {
    it("substitutes tool placeholder for the claude target", () => {
      const out = resolvePlaceholders(
        "Use the {{tool:task-tracker}} for tracking",
        "claude",
        GLOSSARY,
      );
      expect(out).toBe("Use the TodoWrite for tracking");
    });

    it("substitutes tool placeholder for the codex target", () => {
      const out = resolvePlaceholders(
        "Use the {{tool:task-tracker}} for tracking",
        "codex",
        GLOSSARY,
      );
      expect(out).toBe("Use the update_plan for tracking");
    });

    it("respects backslash escape on tool placeholders", () => {
      const out = resolvePlaceholders(
        "literal \\{{tool:task-tracker}} stays",
        "claude",
        GLOSSARY,
      );
      expect(out).toBe("literal {{tool:task-tracker}} stays");
    });

    it("leaves tool placeholders inside fenced code untouched", () => {
      const input = [
        "before {{tool:task-tracker}}",
        "```",
        "literal {{tool:task-tracker}}",
        "```",
        "after {{tool:task-tracker}}",
      ].join("\n");
      const out = resolvePlaceholders(input, "claude", GLOSSARY);
      expect(out).toContain("before TodoWrite");
      expect(out).toContain("literal {{tool:task-tracker}}");
      expect(out).toContain("after TodoWrite");
    });

    it("throws on an unknown tool key", () => {
      expect(() =>
        resolvePlaceholders("{{tool:unknown}}", "claude", GLOSSARY),
      ).toThrow(/unknown tool key "unknown"/i);
    });

    it("throws when toolNames is not configured", () => {
      expect(() =>
        resolvePlaceholders("{{tool:task-tracker}}", "claude", MODEL_ONLY),
      ).toThrow(/toolNames not configured/i);
    });
  });

  describe("file: namespace", () => {
    it("substitutes file placeholder for the claude target", () => {
      const out = resolvePlaceholders(
        "Edit {{file:project-instructions}} for rules",
        "claude",
        GLOSSARY,
      );
      expect(out).toBe("Edit CLAUDE.md for rules");
    });

    it("substitutes file placeholder for the codex target", () => {
      const out = resolvePlaceholders(
        "Edit {{file:project-instructions}} for rules",
        "codex",
        GLOSSARY,
      );
      expect(out).toBe("Edit AGENTS.md for rules");
    });

    it("respects backslash escape on file placeholders", () => {
      const out = resolvePlaceholders(
        "literal \\{{file:project-instructions}} stays",
        "claude",
        GLOSSARY,
      );
      expect(out).toBe("literal {{file:project-instructions}} stays");
    });

    it("leaves file placeholders inside fenced code untouched", () => {
      const input = [
        "before {{file:project-instructions}}",
        "```",
        "literal {{file:project-instructions}}",
        "```",
        "after {{file:project-instructions}}",
      ].join("\n");
      const out = resolvePlaceholders(input, "claude", GLOSSARY);
      expect(out).toContain("before CLAUDE.md");
      expect(out).toContain("literal {{file:project-instructions}}");
      expect(out).toContain("after CLAUDE.md");
    });

    it("throws on an unknown file key", () => {
      expect(() =>
        resolvePlaceholders("{{file:unknown}}", "claude", GLOSSARY),
      ).toThrow(/unknown file key "unknown"/i);
    });

    it("throws when fileArtifacts is not configured", () => {
      expect(() =>
        resolvePlaceholders(
          "{{file:project-instructions}}",
          "claude",
          MODEL_ONLY,
        ),
      ).toThrow(/fileArtifacts not configured/i);
    });
  });
});
