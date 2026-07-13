import { describe, expect, it } from "vitest";
import type {
  CapabilityProfiles,
  FileArtifacts,
  ToolNames,
} from "../config/schema.js";
import { collectProseSegments, resolvePlaceholders } from "./placeholders.js";

const CAPABILITY_PROFILES: CapabilityProfiles = {
  efficient: { claude: "haiku", codex: "gpt-5.4-mini" },
  balanced: { claude: "sonnet", codex: "gpt-5.4" },
  frontier: { claude: "opus", codex: "gpt-5.4-pro" },
};

const TOOLS: ToolNames = {
  "task-tracker": { claude: "TodoWrite", codex: "update_plan" },
};

const FILES: FileArtifacts = {
  "project-instructions": { claude: "CLAUDE.md", codex: "AGENTS.md" },
};

const GLOSSARY = {
  model: CAPABILITY_PROFILES,
  tool: TOOLS,
  file: FILES,
};
const MODEL_ONLY = { model: CAPABILITY_PROFILES };

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

  it.each([
    ["efficient", "haiku"],
    ["balanced", "sonnet"],
    ["frontier", "opus"],
  ] as const)(
    "substitutes the %s capability for the claude target",
    (capability, model) => {
      const out = resolvePlaceholders(
        `use {{model:${capability}}} for synthesis`,
        "claude",
        MODEL_ONLY,
      );
      expect(out).toBe(`use ${model} for synthesis`);
    },
  );

  it.each([
    ["efficient", "gpt-5.4-mini"],
    ["balanced", "gpt-5.4"],
    ["frontier", "gpt-5.4-pro"],
  ] as const)(
    "substitutes the %s capability for the codex target",
    (capability, model) => {
      const out = resolvePlaceholders(
        `use {{model:${capability}}} for cleanup`,
        "codex",
        MODEL_ONLY,
      );
      expect(out).toBe(`use ${model} for cleanup`);
    },
  );

  it("substitutes multiple placeholders in one string", () => {
    const out = resolvePlaceholders(
      "{{model:frontier}} then {{model:efficient}}",
      "claude",
      MODEL_ONLY,
    );
    expect(out).toBe("opus then haiku");
  });

  it("leaves content inside a fenced code block untouched", () => {
    const input = [
      "use {{model:frontier}} for synthesis.",
      "",
      "```",
      "example: {{model:frontier}} stays literal",
      "```",
      "",
      "and {{model:efficient}} after.",
    ].join("\n");
    const out = resolvePlaceholders(input, "claude", MODEL_ONLY);
    expect(out).toContain("use opus for synthesis");
    expect(out).toContain("example: {{model:frontier}} stays literal");
    expect(out).toContain("and haiku after");
  });

  it("leaves content inside a blockquoted fenced code block untouched", () => {
    const input = [
      "before: {{model:efficient}}",
      "> ```ts",
      '> const model = "{{model:frontier}}";',
      "> ```",
      "after: {{model:balanced}}",
    ].join("\n");

    const out = resolvePlaceholders(input, "claude", MODEL_ONLY);
    expect(out).toContain("before: haiku");
    expect(out).toContain('> const model = "{{model:frontier}}"');
    expect(out).toContain("after: sonnet");
  });

  it("leaves heading-adjacent indented code blocks untouched", () => {
    const input = [
      "# Example",
      "    model: {{model:frontier}}",
      "",
      "after: {{model:efficient}}",
    ].join("\n");
    const out = resolvePlaceholders(input, "claude", MODEL_ONLY);
    expect(out).toContain("    model: {{model:frontier}}");
    expect(out).toContain("after: haiku");
  });

  it("leaves content inside a blockquoted indented code block untouched", () => {
    const input = [
      "before: {{model:efficient}}",
      "> # Example",
      ">     preferred_model: {{model:frontier}}",
      "after: {{model:balanced}}",
    ].join("\n");

    const out = resolvePlaceholders(input, "claude", MODEL_ONLY);
    expect(out).toContain("before: haiku");
    expect(out).toContain("> # Example");
    expect(out).toContain(">     preferred_model: {{model:frontier}}");
    expect(out).toContain("after: sonnet");
  });

  it("treats indented list continuation lines as prose", () => {
    const input = [
      "1. Item",
      "    continuation with {{model:balanced}}",
      "",
    ].join("\n");
    const out = resolvePlaceholders(input, "claude", MODEL_ONLY);
    expect(out).toContain("continuation with sonnet");
  });

  it("leaves nested list indented code blocks untouched", () => {
    const input = [
      "- Item",
      "      const bulletPreferred = {{model:balanced}}",
      "1. Ordered",
      "       const orderedPreferred = {{model:frontier}}",
      "",
    ].join("\n");

    const out = resolvePlaceholders(input, "claude", MODEL_ONLY);
    expect(out).toContain("const bulletPreferred = {{model:balanced}}");
    expect(out).toContain("const orderedPreferred = {{model:frontier}}");
  });

  it("leaves nested list code blocks untouched when the list marker uses a tab separator", () => {
    const input = [
      "-\tItem",
      "        const preferred = {{model:balanced}}",
      "1.\tOrdered",
      "        const orderedPreferred = {{model:frontier}}",
      "",
    ].join("\n");

    const out = resolvePlaceholders(input, "claude", MODEL_ONLY);
    expect(out).toContain("const preferred = {{model:balanced}}");
    expect(out).toContain("const orderedPreferred = {{model:frontier}}");
  });

  it("keeps nested list code blocks after continuation prose untouched", () => {
    const input = [
      "- Item",
      "    continuation with {{model:efficient}}",
      "",
      "      const preferred = {{model:balanced}}",
      "",
    ].join("\n");

    const out = resolvePlaceholders(input, "claude", MODEL_ONLY);
    expect(out).toContain("continuation with haiku");
    expect(out).toContain("const preferred = {{model:balanced}}");
  });

  it("treats single-tab list continuations as prose before nested tab-indented code", () => {
    const input = [
      "- Item",
      "\tcontinuation with {{model:efficient}}",
      "",
      "\t\tconst preferred = {{model:balanced}}",
      "",
    ].join("\n");

    const out = resolvePlaceholders(input, "claude", MODEL_ONLY);
    expect(out).toContain("continuation with haiku");
    expect(out).toContain("const preferred = {{model:balanced}}");
  });

  it("respects escape syntax", () => {
    const out = resolvePlaceholders(
      "literal \\{{model:frontier}} here",
      "claude",
      MODEL_ONLY,
    );
    expect(out).toBe("literal {{model:frontier}} here");
  });

  it.each(["fast", "standard", "deep", "ultra"])(
    "rejects unsupported active model capability %s with canonical guidance",
    (capability) => {
      expect(() =>
        resolvePlaceholders(`{{model:${capability}}}`, "claude", MODEL_ONLY, {
          skillName: "canonical-models",
          target: "claude",
        }),
      ).toThrow(
        new RegExp(
          `canonical-models.*claude.*\\{\\{model:${capability}\\}\\}.*efficient.*balanced.*frontier.*devcanon\\.config\\.yaml`,
          "i",
        ),
      );
    },
  );

  it("rejects malformed active model keys with canonical guidance", () => {
    expect(() =>
      resolvePlaceholders("{{model: balanced}}", "codex", MODEL_ONLY, {
        skillName: "canonical-models",
        target: "codex",
      }),
    ).toThrow(/canonical-models.*codex.*model: balanced.*efficient.*frontier/i);
  });

  // Active model values accept brace-free text so canonical validation can
  // report malformed keys; PLACEHOLDER_KEY rejects "__proto__" for tool/file
  // but accepts "constructor". Object.hasOwn is the defense against inherited
  // Object.prototype values, so assert it for every namespace.
  it("throws on {{model:__proto__}} rather than resolving via prototype chain", () => {
    expect(() =>
      resolvePlaceholders("{{model:__proto__}}", "claude", MODEL_ONLY),
    ).toThrow(/unsupported model capability "__proto__"/i);
  });

  it("throws on {{model:constructor}} rather than resolving via prototype chain", () => {
    expect(() =>
      resolvePlaceholders("{{model:constructor}}", "claude", MODEL_ONLY),
    ).toThrow(/unsupported model capability "constructor"/i);
  });

  it("throws on {{tool:constructor}} rather than resolving via prototype chain", () => {
    expect(() =>
      resolvePlaceholders("{{tool:constructor}}", "claude", GLOSSARY),
    ).toThrow(/unknown tool key "constructor"/i);
  });

  it("throws on {{file:constructor}} rather than resolving via prototype chain", () => {
    expect(() =>
      resolvePlaceholders("{{file:constructor}}", "claude", GLOSSARY),
    ).toThrow(/unknown file key "constructor"/i);
  });

  it("throws on an unknown namespace", () => {
    expect(() =>
      resolvePlaceholders("{{path:skills_home}}", "claude", GLOSSARY),
    ).toThrow(/unknown placeholder namespace "path"/i);
  });

  it.each([
    "{{tool:bad key}}",
    "{{file:}}",
    "{{bogus:a b}}",
    "\\{{tool:bad key}}",
    "\\{{file:}}",
  ])("preserves established pass-through behavior for %s", (input) => {
    expect(resolvePlaceholders(input, "claude", GLOSSARY)).toBe(input);
  });

  it("rejects a tool key that violates the kebab-case format", () => {
    expect(() =>
      resolvePlaceholders("{{tool:taskTracker}}", "claude", GLOSSARY),
    ).toThrow(/invalid tool placeholder key "taskTracker"/i);
  });

  it("rejects a file key with a leading hyphen", () => {
    expect(() =>
      resolvePlaceholders("{{file:-project}}", "claude", GLOSSARY),
    ).toThrow(/invalid file placeholder key "-project"/i);
  });

  it("includes skill name and target in render error when context is provided", () => {
    expect(() =>
      resolvePlaceholders("{{tool:unknown}}", "claude", GLOSSARY, {
        skillName: "my-skill",
        target: "claude",
      }),
    ).toThrow(/Skill "my-skill" \(claude\): unknown tool key "unknown"/i);
  });

  it("is a no-op when there are no placeholders", () => {
    expect(resolvePlaceholders("plain text", "claude", MODEL_ONLY)).toBe(
      "plain text",
    );
    expect(resolvePlaceholders("plain text", "claude", MODEL_ONLY)).toBe(
      "plain text",
    );
  });

  it("does not treat a language-tagged fence line as a closing fence", () => {
    const input = [
      "```",
      "```typescript",
      'const model = "{{model:frontier}}";',
      "```",
      "",
      "after: {{model:efficient}}",
    ].join("\n");
    const out = resolvePlaceholders(input, "claude", MODEL_ONLY);
    // Inside the outer ``` fence, placeholders stay literal even past
    // the nested ```typescript line.
    expect(out).toContain('const model = "{{model:frontier}}"');
    // Substitution resumes after the outer fence closes.
    expect(out).toContain("after: haiku");
  });

  it("does not treat an inner triple-backtick line as closing a 4-backtick fence", () => {
    const input = [
      "````",
      "```",
      "{{model:frontier}}",
      "```",
      "````",
      "",
      "after: {{model:efficient}}",
    ].join("\n");
    const out = resolvePlaceholders(input, "claude", MODEL_ONLY);
    // Inside the outer 4-backtick fence, placeholders must remain literal,
    // even past nested triple-backtick lines.
    expect(out).toContain("{{model:frontier}}");
    expect(out).toContain("after: haiku");
  });

  it("treats tilde fences as code fences", () => {
    const input = [
      "~~~",
      "{{model:frontier}}",
      "~~~",
      "",
      "after: {{model:efficient}}",
    ].join("\n");
    const out = resolvePlaceholders(input, "claude", MODEL_ONLY);
    expect(out).toContain("{{model:frontier}}");
    expect(out).toContain("after: haiku");
  });

  it("does not let a tilde line close a backtick fence", () => {
    const input = [
      "```",
      "~~~",
      "{{model:frontier}}",
      "~~~",
      "```",
      "",
      "after: {{model:efficient}}",
    ].join("\n");
    const out = resolvePlaceholders(input, "claude", MODEL_ONLY);
    expect(out).toContain("{{model:frontier}}");
    expect(out).toContain("after: haiku");
  });

  it("consumes only the closest backslash as the escape marker", () => {
    // Two literal backslashes then a placeholder. The regex only captures
    // one backslash as the escape, so the outer backslash passes through
    // and the inner one marks the placeholder as literal.
    const out = resolvePlaceholders(
      "\\\\{{model:frontier}}",
      "claude",
      MODEL_ONLY,
    );
    expect(out).toBe("\\{{model:frontier}}");
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
