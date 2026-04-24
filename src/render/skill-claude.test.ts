import { describe, expect, it } from "vitest";
import type { ModelTiers, SkillSource } from "../config/schema.js";
import { renderClaudeSkill } from "./skill-claude.js";

const TIERS: ModelTiers = {
  fast: { claude: "haiku", codex: "gpt-5.4-mini" },
  standard: { claude: "sonnet", codex: "gpt-5.4" },
  deep: { claude: "opus", codex: "gpt-5.4" },
};

function make(
  source: Partial<SkillSource> & Pick<SkillSource, "name" | "description">,
  body: string,
): { source: SkillSource; body: string } {
  return { source: source as SkillSource, body };
}

describe("renderClaudeSkill", () => {
  it("emits a managed header and name/description frontmatter", () => {
    const out = renderClaudeSkill(
      make({ name: "x", description: "d" }, "# body\n"),
      TIERS,
    );
    expect(out.startsWith("<!-- Managed by agents-manager")).toBe(true);
    expect(out).toContain("<!-- Source: skills/x/SKILL.md -->");
    expect(out).toContain("name: x");
    expect(out).toContain("description: d");
    expect(out).toContain("# body");
  });

  it("includes the allowed-tools key when provided", () => {
    const out = renderClaudeSkill(
      make(
        {
          name: "x",
          description: "d",
          "allowed-tools": "Bash Read",
        },
        "",
      ),
      TIERS,
    );
    expect(out).toContain("allowed-tools: Bash Read");
  });

  it("normalizes allowed-tools arrays to a space-joined string", () => {
    const out = renderClaudeSkill(
      make(
        {
          name: "x",
          description: "d",
          "allowed-tools": ["Bash", "Read"],
        },
        "",
      ),
      TIERS,
    );
    expect(out).toContain("allowed-tools: Bash Read");
    expect(out).not.toContain("- Bash");
  });

  it("inlines claude override fields and strips codex/codex_sidecar", () => {
    const out = renderClaudeSkill(
      make(
        {
          name: "x",
          description: "d",
          claude: { model: "opus", effort: "high" },
          codex: { license: "MIT" },
          codex_sidecar: { interface: { display_name: "X" } },
        },
        "",
      ),
      TIERS,
    );
    expect(out).toContain("model: opus");
    expect(out).toContain("effort: high");
    expect(out).not.toContain("license");
    expect(out).not.toContain("display_name");
    expect(out).not.toMatch(/^codex:/m);
    expect(out).not.toMatch(/^codex_sidecar:/m);
  });

  it("substitutes {{model:*}} placeholders in body and in override string values", () => {
    const out = renderClaudeSkill(
      make(
        {
          name: "x",
          description: "d",
          claude: { model: "{{model:deep}}" },
        },
        "use {{model:deep}} for synthesis.\n",
      ),
      TIERS,
    );
    expect(out).toContain("model: opus");
    expect(out).toContain("use opus for synthesis.");
  });
});
