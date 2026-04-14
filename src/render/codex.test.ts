import path from "node:path";
import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import { CODEX_TARGET_FIELDS, type ResolvedConfig } from "../config/schema.js";
import type { LoadedAgent, LoadedSkill } from "../models/types.js";
import { renderCodexAgent, tomlQuote } from "./codex.js";

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
  manifest: { path: "~/.agents-manager/manifest.json" },
} satisfies ResolvedConfig;

const emptySkills = new Map<string, LoadedSkill>();

describe("renderCodexAgent", () => {
  it("renders a sample agent to Codex TOML format (snapshot)", () => {
    const result = renderCodexAgent(agent, emptySkills, config);
    expect(result.content).toMatchSnapshot();
  });

  it("includes managed comment header", () => {
    const result = renderCodexAgent(agent, emptySkills, config);
    const content = result.content as string;
    expect(content).toContain(
      "# Managed by agents-manager. Do not edit directly.",
    );
    expect(content).toContain("# Source: agents/test-agent.yaml");
  });

  it("includes name, description, and sandbox_mode fields", () => {
    const result = renderCodexAgent(agent, emptySkills, config);
    const content = result.content as string;
    expect(content).toContain('name = "test-agent"');
    expect(content).toContain('description = "A test agent for unit testing."');
    expect(content).toContain('sandbox_mode = "read-only"');
  });

  it("uses triple-quoted literal strings for developer_instructions", () => {
    const result = renderCodexAgent(agent, emptySkills, config);
    const content = result.content as string;
    expect(content).toContain("developer_instructions = '''");
    expect(content).toContain("'''");
    // Verify instructions content is inside the triple quotes
    expect(content).toContain("## Step One");
    expect(content).toContain("## Step Two");
  });

  it("includes skills section in developer_instructions", () => {
    const result = renderCodexAgent(agent, emptySkills, config);
    const content = result.content as string;
    expect(content).toContain("## Skills");
    expect(content).toContain(
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
    const content = result.content as string;
    const expectedFragments = {
      model: 'model = "gpt-5.4"',
      model_reasoning_effort: 'model_reasoning_effort = "high"',
      sandbox_mode: 'sandbox_mode = "danger-full-access"',
      nickname_candidates: 'nickname_candidates = ["builder", "reviewer"]',
      approval_policy:
        "approval_policy = { granular = { mcp_elicitations = true, request_permissions = false, rules = true, sandbox_approval = true, skill_approval = false } }",
    } satisfies Record<(typeof CODEX_TARGET_FIELDS)[number], string>;

    for (const field of CODEX_TARGET_FIELDS) {
      expect(content).toContain(expectedFragments[field]);
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
    const content = result.content as string;
    expect(content).toContain('approval_policy = "on-failure"');
  });

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

describe("Codex TOML renderer round-trip", () => {
  it("round-trips all basic-string fields through smol-toml", () => {
    const mixedPayload =
      'hello\\world"q\ttab\nline\rcr\bbs\fff\u0000nul\u007Fdel\u0080c1\u{1F600}emoji';

    // Cast codex block: renderer consumes these as strings and is the
    // unit under test; we bypass the Zod enum narrowing to exercise escaping
    // for the typically-enum fields (sandbox_mode, approval_policy, etc.).
    const fixture: LoadedAgent = {
      name: "test-agent",
      filePath: "/test/agents/test-agent.yaml",
      source: {
        name: "test-agent",
        description: mixedPayload,
        instructions: "hello",
        skills: [],
        claude: undefined,
        codex: {
          model: "mo\ndel",
          model_reasoning_effort: "hi\tgh",
          sandbox_mode: "sb\tmode",
          approval_policy: 'ap\\prov"al',
          nickname_candidates: ["name\twith\ttab", 'quote"and\\slash'],
        } as LoadedAgent["source"]["codex"],
        tags: undefined,
        notes: undefined,
      },
    };

    const result = renderCodexAgent(fixture, emptySkills, config);
    const parsed = parse(result.content) as Record<string, unknown>;

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
});
