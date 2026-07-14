import path from "node:path";
import { parse } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeCodexSource } from "../__test-helpers__/fixtures.js";
import { installTestLogger } from "../__test-helpers__/logger.js";
import { parseRenderedTomlArtifact } from "../__test-helpers__/render.js";
import { CODEX_TARGET_FIELDS, type ResolvedConfig } from "../config/schema.js";
import type { LoadedAgent, LoadedSkill } from "../models/types.js";
import {
  renderCodexAgent,
  tomlQuote,
  tomlQuoteMultilineBasic,
} from "./codex.js";

type CodexSource = NonNullable<LoadedAgent["source"]["codex"]>;

function withCodex(
  base: LoadedAgent,
  codexFields: Record<string, unknown>,
): LoadedAgent {
  return {
    ...base,
    source: {
      ...base.source,
      codex: {
        ...(base.source.codex ?? {}),
        ...codexFields,
      } as CodexSource,
    },
  };
}

const agent: LoadedAgent = {
  name: "test-agent",
  filePath: "/test/agents/test-agent.yaml",
  source: {
    name: "test-agent",
    description: "A test agent for unit testing.",
    instructions:
      "Follow these steps:\n\n## Step One\n\nDo the first thing.\n\n## Step Two\n\nDo the second thing.",
    skills: ["test-skill"],
    claude: {
      model: "sonnet",
      tools: ["Read", "Grep", "Bash"],
    },
    codex: { sandbox_mode: "read-only" },
    tags: undefined,
    notes: undefined,
  },
};

const config = {
  configDir: "/test",
  library: {
    skillsDir: "/test/skills",
    agentsDir: "/test/agents",
    generatedDir: "/test/generated",
  },
  targets: {
    claude: {
      enabled: true,
      skillsHome: "~/.claude/skills",
      agentsHome: "~/.claude/agents",
      installMode: "symlink" as const,
    },
    codex: {
      enabled: true,
      skillsHome: "~/.agents/skills",
      agentsHome: "~/.codex/agents",
      installMode: "symlink" as const,
    },
  },
  defaults: {
    installMode: "symlink" as const,
    overwritePolicy: "overwrite-managed" as const,
    cleanManagedOutputs: true,
  },
  platform: { windowsSymlinkFallback: "copy" as const },
  manifest: { path: "~/.devcanon/manifest.json" },
  capabilityProfiles: {
    efficient: { claude: "claude-haiku", codex: "gpt-mini" },
    balanced: { claude: "claude-sonnet", codex: "gpt-5.4" },
    frontier: { claude: "claude-opus", codex: "gpt-frontier" },
  },
} satisfies ResolvedConfig;

const emptySkills = new Map<string, LoadedSkill>();

describe("renderCodexAgent", () => {
  it("renders a sample agent to Codex TOML format (snapshot)", () => {
    const result = renderCodexAgent(agent, emptySkills, config);
    expect(result.content).toMatchSnapshot();
  });

  it("starts with TOML assignments (no managed header)", () => {
    const result = renderCodexAgent(agent, emptySkills, config);
    const content = result.content;
    expect(content.startsWith("name = ")).toBe(true);
    expect(content).not.toContain("Managed by DevCanon");
  });

  it("includes name, description, and sandbox_mode fields", () => {
    const result = renderCodexAgent(agent, emptySkills, config);
    const parsed = parseRenderedTomlArtifact(result.content);
    expect(parsed).toMatchObject({
      name: "test-agent",
      description: "A test agent for unit testing.",
      sandbox_mode: "read-only",
    });
  });

  it("uses triple-quoted basic strings for developer_instructions", () => {
    const result = renderCodexAgent(agent, emptySkills, config);
    const content = result.content;
    const parsed = parseRenderedTomlArtifact(content);
    expect(content).toMatch(/developer_instructions = """\n[\s\S]*\n"""/);
    expect(parsed.developer_instructions).toContain("## Step One");
    expect(parsed.developer_instructions).toContain("## Step Two");
  });

  it("includes skills section in developer_instructions", () => {
    const result = renderCodexAgent(agent, emptySkills, config);
    const parsed = parseRenderedTomlArtifact(result.content);
    expect(parsed.developer_instructions).toContain("## Skills");
    expect(parsed.developer_instructions).toContain(
      "- **test-skill** (`~/.agents/skills/test-skill`)",
    );
  });

  it("renders all supported codex target fields", () => {
    const fullAgent: LoadedAgent = {
      ...agent,
      source: {
        ...agent.source,
        codex: {
          model: "gpt-5.4",
          model_reasoning_effort: "high",
          sandbox_mode: "danger-full-access",
          nickname_candidates: ["builder", "reviewer"],
          approval_policy: {
            granular: {
              mcp_elicitations: true,
              request_permissions: false,
              rules: true,
              sandbox_approval: true,
              skill_approval: false,
            },
          },
        },
      },
    };

    const result = renderCodexAgent(fullAgent, emptySkills, config);
    const parsed = parseRenderedTomlArtifact(result.content);
    const expectedValues = {
      model: "gpt-5.4",
      model_reasoning_effort: "high",
      sandbox_mode: "danger-full-access",
      nickname_candidates: ["builder", "reviewer"],
      approval_policy: {
        granular: {
          mcp_elicitations: true,
          request_permissions: false,
          rules: true,
          sandbox_approval: true,
          skill_approval: false,
        },
      },
    } satisfies Record<(typeof CODEX_TARGET_FIELDS)[number], unknown>;

    for (const field of CODEX_TARGET_FIELDS) {
      expect(parsed[field]).toEqual(expectedValues[field]);
    }
  });

  it("renders string approval_policy values", () => {
    const stringApprovalAgent: LoadedAgent = {
      ...agent,
      source: {
        ...agent.source,
        codex: {
          approval_policy: "on-failure",
        },
      },
    };

    const result = renderCodexAgent(stringApprovalAgent, emptySkills, config);
    const parsed = parseRenderedTomlArtifact(result.content);
    expect(parsed.approval_policy).toBe("on-failure");
  });

  it("resolves top-level capability without reasoning effort or a codex block", () => {
    const result = renderCodexAgent(
      {
        ...agent,
        source: { ...agent.source, capability: "balanced", codex: undefined },
      },
      emptySkills,
      config,
    );
    const parsed = parseRenderedTomlArtifact(result.content);
    expect(parsed.model).toBe("gpt-5.4");
    expect(parsed).not.toHaveProperty("model_reasoning_effort");
  });

  it("rejects a schema-bypassed custom capability even when its profile is owned", () => {
    const customConfig = {
      ...config,
      capabilityProfiles: {
        ...config.capabilityProfiles,
        experimental: { claude: "custom-claude", codex: "custom-codex" },
      },
    } as ResolvedConfig;

    expect(() =>
      renderCodexAgent(
        {
          ...agent,
          source: {
            ...agent.source,
            capability: "experimental" as "balanced",
            codex: { sandbox_mode: "read-only" },
          },
        },
        emptySkills,
        customConfig,
      ),
    ).toThrow(/unknown capability "experimental"/);
  });

  it("prefers a literal model and emits only explicit reasoning effort", () => {
    const literalAgent = withCodex(agent, {
      model: "literal-codex",
      model_reasoning_effort: "high",
    });
    const result = renderCodexAgent(
      {
        ...literalAgent,
        source: { ...literalAgent.source, capability: "balanced" },
      },
      emptySkills,
      config,
    );
    const parsed = parseRenderedTomlArtifact(result.content);
    expect(parsed.model).toBe("literal-codex");
    expect(parsed.model_reasoning_effort).toBe("high");
  });

  it("omits ambient model and reasoning effort", () => {
    const result = renderCodexAgent(
      { ...agent, source: { ...agent.source, codex: undefined } },
      emptySkills,
      config,
    );
    const parsed = parseRenderedTomlArtifact(result.content);
    expect(parsed).not.toHaveProperty("model");
    expect(parsed).not.toHaveProperty("model_reasoning_effort");
  });

  it.each([
    ["capability", undefined, "balanced"],
    ["literal", "literal-codex", undefined],
    ["ambient", undefined, undefined],
  ] as const)(
    "emits explicit reasoning effort on the %s model path",
    (_path, model, capability) => {
      const result = renderCodexAgent(
        {
          ...agent,
          source: {
            ...agent.source,
            capability,
            codex: { model, model_reasoning_effort: "high" },
          },
        },
        emptySkills,
        config,
      );
      const parsed = parseRenderedTomlArtifact(result.content);
      expect(parsed.model_reasoning_effort).toBe("high");
    },
  );

  it.each([
    ["capability", undefined, "balanced"],
    ["literal", "literal-codex", undefined],
    ["ambient", undefined, undefined],
  ] as const)(
    "does not infer reasoning effort on the %s model path",
    (_path, model, capability) => {
      const result = renderCodexAgent(
        {
          ...agent,
          source: {
            ...agent.source,
            capability,
            codex: model === undefined ? undefined : { model },
          },
        },
        emptySkills,
        config,
      );
      const parsed = parseRenderedTomlArtifact(result.content);
      expect(parsed).not.toHaveProperty("model_reasoning_effort");
    },
  );

  it.each([
    "{{model:standard}}",
    "  {{model:standard}}  ",
    "{{model: standard}}",
    "{{model:deep-tier}}",
  ])(
    "rejects obsolete model placeholder %s with migration guidance",
    (model) => {
      // Defense-in-depth: validation usually rejects this earlier, but the
      // renderer must refuse placeholders from callers that bypass validation.
      expect(() =>
        renderCodexAgent(withCodex(agent, { model }), emptySkills, config),
      ).toThrow(/top-level capability.*literal target model/);
    },
  );

  it("returns correct metadata fields", () => {
    const result = renderCodexAgent(agent, emptySkills, config);
    expect(result.target).toBe("codex");
    expect(result.type).toBe("agent");
    expect(result.name).toBe("test-agent");
    expect(result.sourcePath).toBe("/test/agents/test-agent.yaml");
    expect(result.generatedPath).toBe(
      path.join("/test/generated", "codex", "agents", "test-agent.toml"),
    );
    expect(result.installedPath).toBe(
      path.join("~/.codex/agents", "test-agent.toml"),
    );
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// Verifies tomlQuote output is valid TOML 1.0 basic-string-compliant.
// Ordering-sensitive rows: 3, 6-12, 15.
describe("tomlQuote basic-string escaping", () => {
  it("empty string", () => {
    expect(tomlQuote("")).toBe('""');
  });

  it("plain ASCII", () => {
    expect(tomlQuote("a")).toBe('"a"');
  });

  it("single backslash (ordering-sensitive)", () => {
    expect(tomlQuote("\\")).toBe('"\\\\"');
  });

  it("single double-quote", () => {
    expect(tomlQuote('"')).toBe('"\\""');
  });

  it('compound a\\b"c', () => {
    expect(tomlQuote('a\\b"c')).toBe('"a\\\\b\\"c"');
  });

  it("NUL", () => {
    expect(tomlQuote("a\u0000b")).toBe('"a\\u0000b"');
  });

  it("BS U+0008 (ordering-sensitive canonical)", () => {
    expect(tomlQuote("a\bb")).toBe('"a\\bb"');
  });

  it("TAB U+0009", () => {
    expect(tomlQuote("a\tb")).toBe('"a\\tb"');
  });

  it("LF U+000A", () => {
    expect(tomlQuote("a\nb")).toBe('"a\\nb"');
  });

  it("CR U+000D", () => {
    expect(tomlQuote("a\rb")).toBe('"a\\rb"');
  });

  it("U+001F (upper C0 edge)", () => {
    expect(tomlQuote("a\u001Fb")).toBe('"a\\u001Fb"');
  });

  it("DEL U+007F", () => {
    expect(tomlQuote("a\u007Fb")).toBe('"a\\u007Fb"');
  });

  it("U+0080 pass-through", () => {
    expect(tomlQuote("a\u0080b")).toBe('"a\u0080b"');
  });

  it("astral emoji pass-through", () => {
    expect(tomlQuote("a\u{1F600}b")).toBe('"a\u{1F600}b"');
  });

  it("BS-only canonical ordering test", () => {
    expect(tomlQuote("\u0008")).toBe('"\\b"');
  });
});

describe("developer_instructions multi-line basic escaping", () => {
  // The escaper returns `"""\n${body}\n"""`. TOML trims the leading newline
  // after `"""`, but the trailing `\n` before the closing delimiter is
  // preserved in the parsed value (see plan §1 "Output shape"). Round-trip
  // assertions therefore expect `input + "\n"` on the parsed side.
  const wrap = (escaped: string) => parse(`x = ${escaped}`) as { x: string };

  it("wraps in triple quotes with leading newline", () => {
    expect(tomlQuoteMultilineBasic("hi")).toBe('"""\nhi\n"""');
  });

  it("preserves literal LF", () => {
    expect(tomlQuoteMultilineBasic("a\nb")).toBe('"""\na\nb\n"""');
  });

  it("preserves TAB unescaped", () => {
    const out = tomlQuoteMultilineBasic("a\tb");
    expect(out).toContain("a\tb");
    expect(out).not.toContain("\\t");
  });

  it("escapes backslash before other rewrites (ordering)", () => {
    expect(tomlQuoteMultilineBasic("a\\b")).toContain("\\\\");
  });

  it("escapes bare CR to \\r", () => {
    const out = tomlQuoteMultilineBasic("a\rb");
    expect(out).toContain("\\r");
    expect(out).not.toMatch(/\r[^\n]/);
    expect(out).not.toMatch(/\r$/);
  });

  it("preserves CRLF pairs", () => {
    const out = tomlQuoteMultilineBasic("a\r\nb");
    expect(out).toContain("a\r\nb");
    expect(out).not.toContain("\\r");
  });

  it("escapes C0 controls and FF/VT via short or unicode escape", () => {
    const out = tomlQuoteMultilineBasic("\u0000\u0001\u000B\fb");
    expect(out).toContain("\\u0000");
    expect(out).toContain("\\u0001");
    expect(out).toContain("\\u000B");
    expect(out).toContain("\\f");
  });

  it("escapes DEL U+007F", () => {
    expect(tomlQuoteMultilineBasic("a\u007Fb")).toContain("\\u007F");
  });

  it("passes through U+0080 and astral code points", () => {
    const input = "a\u0080\u{1F600}b";
    const out = tomlQuoteMultilineBasic(input);
    expect(out).toContain("a\u0080\u{1F600}b");
  });

  it("breaks runs of three double quotes (round-trip)", () => {
    const input = 'a"""b';
    expect(wrap(tomlQuoteMultilineBasic(input)).x).toBe(`${input}\n`);
  });

  it("handles four consecutive quotes (round-trip)", () => {
    const input = 'a""""b';
    expect(wrap(tomlQuoteMultilineBasic(input)).x).toBe(`${input}\n`);
  });

  it("handles body ending in one or two quotes (round-trip)", () => {
    expect(wrap(tomlQuoteMultilineBasic('hi"')).x).toBe('hi"\n');
    expect(wrap(tomlQuoteMultilineBasic('hi""')).x).toBe('hi""\n');
  });

  it("handles runs of 5, 6, 7 consecutive quotes (round-trip)", () => {
    for (const input of ['a"""""b', 'a""""""b', 'a"""""""b']) {
      expect(wrap(tomlQuoteMultilineBasic(input)).x).toBe(`${input}\n`);
    }
  });

  it("handles body ending in a single backslash (round-trip)", () => {
    const input = "hi\\";
    expect(wrap(tomlQuoteMultilineBasic(input)).x).toBe(`${input}\n`);
  });

  it("handles empty body", () => {
    // Empty body yields `"""\n\n"""`; TOML trims the leading newline,
    // so the parsed value is the trailing structural `\n`.
    expect(wrap(tomlQuoteMultilineBasic("")).x).toBe("\n");
  });

  it("handles body that is only a run of quotes", () => {
    const input = '""""""';
    expect(wrap(tomlQuoteMultilineBasic(input)).x).toBe(`${input}\n`);
  });
});

describe("Codex TOML renderer round-trip", () => {
  it("round-trips all basic-string fields through smol-toml", () => {
    const mixedPayload =
      'hello\\world"q\ttab\nline\rcr\bbs\fff\u0000nul\u007Fdel\u0080c1\u{1F600}emoji';

    const fixture: LoadedAgent = {
      name: "test-agent",
      filePath: "/test/agents/test-agent.yaml",
      source: {
        name: "test-agent",
        description: mixedPayload,
        instructions: "hello",
        skills: [],
        claude: undefined,
        codex: makeCodexSource({
          model: "mo\ndel",
          model_reasoning_effort: "hi\tgh",
          sandbox_mode: "sb\tmode",
          approval_policy: 'ap\\prov"al',
          nickname_candidates: ["name\twith\ttab", 'quote"and\\slash'],
        }),
        tags: undefined,
        notes: undefined,
      },
    };

    const result = renderCodexAgent(fixture, emptySkills, config);
    const parsed = parseRenderedTomlArtifact(result.content);

    expect(parsed.name).toBe(fixture.source.name);
    expect(parsed.description).toBe(fixture.source.description);
    expect(parsed.model).toBe(fixture.source.codex?.model);
    expect(parsed.model_reasoning_effort).toBe(
      fixture.source.codex?.model_reasoning_effort,
    );
    expect(parsed.sandbox_mode).toBe(fixture.source.codex?.sandbox_mode);
    expect(parsed.approval_policy).toBe(fixture.source.codex?.approval_policy);
    expect(parsed.nickname_candidates).toEqual(
      fixture.source.codex?.nickname_candidates,
    );
  });

  const makeInstrFixture = (instructions: string): LoadedAgent => ({
    name: "test-agent",
    filePath: "/test/agents/test-agent.yaml",
    source: {
      name: "test-agent",
      description: "desc",
      instructions,
      skills: [],
      claude: undefined,
      codex: { sandbox_mode: "read-only" },
      tags: undefined,
      notes: undefined,
    },
  });

  it("round-trips instructions containing ''' through smol-toml", () => {
    const instructions = "pre\n'''\nmid\n'''\npost";
    const result = renderCodexAgent(
      makeInstrFixture(instructions),
      emptySkills,
      config,
    );
    const parsed = parseRenderedTomlArtifact(result.content);
    const di = parsed.developer_instructions as string;
    expect(di).toContain("pre");
    expect(di).toContain("mid");
    expect(di).toContain("post");
    // Trailing "\n" is the structural newline before the closing """
    // delimiter (same contract as the previous '''...''' output).
    expect(di).toBe("pre\n'''\nmid\n'''\npost\n");
  });

  it("round-trips instructions containing triple double-quotes through smol-toml", () => {
    const instructions = 'pre\n"""\nmid\n"""\npost';
    const result = renderCodexAgent(
      makeInstrFixture(instructions),
      emptySkills,
      config,
    );
    const parsed = parseRenderedTomlArtifact(result.content);
    expect(parsed.developer_instructions).toBe('pre\n"""\nmid\n"""\npost\n');
  });

  it("round-trips instructions containing backslashes and embedded quotes", () => {
    const instructions = 'a\\b\n"c\nd"""e';
    const result = renderCodexAgent(
      makeInstrFixture(instructions),
      emptySkills,
      config,
    );
    const parsed = parseRenderedTomlArtifact(result.content);
    expect(parsed.developer_instructions).toBe('a\\b\n"c\nd"""e\n');
  });

  it("round-trips instructions containing tabs and CRLF", () => {
    const instructions = "line1\r\nline2\tcol";
    const result = renderCodexAgent(
      makeInstrFixture(instructions),
      emptySkills,
      config,
    );
    const parsed = parseRenderedTomlArtifact(result.content);
    expect(parsed.developer_instructions).toBe("line1\r\nline2\tcol\n");
  });
});

describe("renderCodexAgent passthrough", () => {
  let warnings: string[];
  let restore: () => void;

  beforeEach(() => {
    const installed = installTestLogger();
    warnings = installed.testLogger.warnings;
    restore = installed.restore;
  });

  afterEach(() => restore());

  it("emits unknown string field as TOML string assignment", () => {
    const result = renderCodexAgent(
      withCodex(agent, { future_flag: "x" }),
      emptySkills,
      config,
    );
    const parsed = parseRenderedTomlArtifact(result.content);
    expect(parsed.future_flag).toBe("x");
    expect(warnings).toEqual([]);
  });

  it("emits unknown number and boolean scalars bare", () => {
    const result = renderCodexAgent(
      withCodex(agent, { temperature: 0.7, eager: true }),
      emptySkills,
      config,
    );
    const parsed = parseRenderedTomlArtifact(result.content);
    expect(parsed.temperature).toBe(0.7);
    expect(parsed.eager).toBe(true);
  });

  it("emits unknown string array using tomlQuote", () => {
    const result = renderCodexAgent(
      withCodex(agent, { extra_servers: ["a", 'with"quote'] }),
      emptySkills,
      config,
    );
    const parsed = parseRenderedTomlArtifact(result.content);
    expect(parsed.extra_servers).toEqual(["a", 'with"quote']);
  });

  it("emits unknown number and boolean arrays bare", () => {
    const result = renderCodexAgent(
      withCodex(agent, { weights: [1, 2, 3], flags: [true, false] }),
      emptySkills,
      config,
    );
    const parsed = parseRenderedTomlArtifact(result.content);
    expect(parsed.weights).toEqual([1, 2, 3]);
    expect(parsed.flags).toEqual([true, false]);
  });

  it("emits empty unknown array as []", () => {
    const result = renderCodexAgent(
      withCodex(agent, { extra_servers: [] }),
      emptySkills,
      config,
    );
    expect(result.content).toContain("extra_servers = []");
    const parsed = parseRenderedTomlArtifact(result.content);
    expect(parsed.extra_servers).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("sorts unknown fields alphabetically after known fields", () => {
    const result = renderCodexAgent(
      withCodex(agent, { zeta_field: 1, alpha_field: 2, middle_field: 3 }),
      emptySkills,
      config,
    );
    const alpha = result.content.indexOf("alpha_field");
    const middle = result.content.indexOf("middle_field");
    const zeta = result.content.indexOf("zeta_field");
    const knownSandbox = result.content.indexOf("sandbox_mode");
    expect(knownSandbox).toBeGreaterThan(-1);
    expect(alpha).toBeGreaterThan(knownSandbox);
    expect(middle).toBeGreaterThan(alpha);
    expect(zeta).toBeGreaterThan(middle);
  });

  it("skips null values with warning (TOML has no null)", () => {
    const result = renderCodexAgent(
      withCodex(agent, { opt_out: null }),
      emptySkills,
      config,
    );
    const parsed = parseRenderedTomlArtifact(result.content);
    expect(parsed).not.toHaveProperty("opt_out");
    expect(warnings.some((w) => w.includes('"opt_out"'))).toBe(true);
    expect(warnings.some((w) => w.includes("TOML has no null"))).toBe(true);
  });

  it("skips inline objects with warning (no inline-table passthrough)", () => {
    const result = renderCodexAgent(
      withCodex(agent, { nested: { a: 1, b: "x" } }),
      emptySkills,
      config,
    );
    const parsed = parseRenderedTomlArtifact(result.content);
    expect(parsed).not.toHaveProperty("nested");
    expect(warnings.some((w) => w.includes('"nested"'))).toBe(true);
    expect(warnings.some((w) => w.includes("object"))).toBe(true);
  });

  it("skips mixed-type array with warning", () => {
    const result = renderCodexAgent(
      withCodex(agent, { mixed: [1, "a"] }),
      emptySkills,
      config,
    );
    const parsed = parseRenderedTomlArtifact(result.content);
    expect(parsed).not.toHaveProperty("mixed");
    expect(warnings.some((w) => w.includes('"mixed"'))).toBe(true);
  });

  it("skips non-finite numbers with warning", () => {
    const result = renderCodexAgent(
      withCodex(agent, { bad: Number.NaN }),
      emptySkills,
      config,
    );
    const parsed = parseRenderedTomlArtifact(result.content);
    expect(parsed).not.toHaveProperty("bad");
    expect(warnings.some((w) => w.includes('"bad"'))).toBe(true);
  });

  it("skips unsafe keys with warning", () => {
    const result = renderCodexAgent(
      withCodex(agent, { "bad key!": "x" }),
      emptySkills,
      config,
    );
    const parsed = parseRenderedTomlArtifact(result.content);
    expect(parsed).not.toHaveProperty("bad key!");
    expect(warnings.some((w) => w.includes('"bad key!"'))).toBe(true);
  });

  it("coexists with known approval_policy without duplicate emission", () => {
    const result = renderCodexAgent(
      withCodex(agent, {
        approval_policy: "on-request",
        alpha: 1,
      }),
      emptySkills,
      config,
    );
    const approvalLines = result.content.match(/^approval_policy =/gm) ?? [];
    const parsed = parseRenderedTomlArtifact(result.content);
    expect(approvalLines).toHaveLength(1);
    expect(parsed.approval_policy).toBe("on-request");
    expect(parsed.alpha).toBe(1);
  });

  it("TOML round-trip: parser accepts all passthrough output", () => {
    const result = renderCodexAgent(
      withCodex(agent, {
        str_field: "hello",
        num_field: 42,
        bool_field: true,
        arr_strings: ["a", "b"],
        arr_numbers: [1, 2],
      }),
      emptySkills,
      config,
    );
    const parsed = parseRenderedTomlArtifact(result.content);
    expect(parsed.str_field).toBe("hello");
    expect(parsed.num_field).toBe(42);
    expect(parsed.bool_field).toBe(true);
    expect(parsed.arr_strings).toEqual(["a", "b"]);
    expect(parsed.arr_numbers).toEqual([1, 2]);
  });
});
