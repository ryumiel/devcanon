import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import type { ModelTiers, SkillSource } from "../config/schema.js";
import { renderCodexSkill } from "./skill-codex.js";

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

describe("renderCodexSkill", () => {
  it("emits name/description frontmatter starting at the first line", () => {
    const out = renderCodexSkill(
      make({ name: "x", description: "d" }, "# body\n"),
      TIERS,
    );
    expect(out.skillMd.startsWith("---\n")).toBe(true);
    expect(out.skillMd).not.toContain("Managed by agents-manager");
    expect(out.skillMd).toContain("name: x");
    expect(out.skillMd).toContain("description: d");
    expect(out.sidecar).toBeNull();
  });

  it("inlines codex override fields and strips claude/codex_sidecar from skill.md", () => {
    const out = renderCodexSkill(
      make(
        {
          name: "x",
          description: "d",
          claude: { model: "opus" },
          codex: { license: "MIT", metadata: { "short-description": "blurb" } },
          codex_sidecar: { interface: { display_name: "X" } },
        },
        "",
      ),
      TIERS,
    );
    expect(out.skillMd).toContain("license: MIT");
    expect(out.skillMd).toContain("metadata:\n  short-description: blurb");
    expect(out.skillMd).not.toContain("model: opus");
    expect(out.skillMd).not.toContain("display_name");
  });

  it("emits a sidecar when codex_sidecar is present", () => {
    const out = renderCodexSkill(
      make(
        {
          name: "x",
          description: "d",
          codex_sidecar: {
            interface: { display_name: "X", brand_color: "#00ccff" },
            policy: { allow_implicit_invocation: true },
            dependencies: { tools: [] },
          },
        },
        "",
      ),
      TIERS,
    );
    expect(out.sidecar).not.toBeNull();
    const parsed = parseYaml(out.sidecar as string) as Record<string, unknown>;
    expect(parsed.interface).toMatchObject({
      display_name: "X",
      brand_color: "#00ccff",
    });
    expect(parsed.policy).toMatchObject({ allow_implicit_invocation: true });
    expect(parsed.dependencies).toMatchObject({ tools: [] });
  });

  it("substitutes {{model:*}} in body using the codex resolution", () => {
    const out = renderCodexSkill(
      make(
        { name: "x", description: "d" },
        "use {{model:fast}} for cleanup.\n",
      ),
      TIERS,
    );
    expect(out.skillMd).toContain("use gpt-5.4-mini for cleanup.");
  });

  it("normalizes allowed-tools arrays to a space-joined string", () => {
    const out = renderCodexSkill(
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
    expect(out.skillMd).toContain("allowed-tools: Bash Read");
    expect(out.skillMd).not.toContain("- Bash");
  });

  it("matches snapshot for a representative skill with sidecar", () => {
    const out = renderCodexSkill(
      make(
        {
          name: "snap-skill",
          description: "Snapshot fixture skill.",
          "allowed-tools": ["Bash", "Read"],
          claude: { model: "opus" },
          codex: {
            license: "MIT",
            metadata: { "short-description": "Snapshot blurb" },
          },
          codex_sidecar: {
            interface: {
              display_name: "Snap",
              short_description: "Snapshot blurb",
              brand_color: "#00ccff",
            },
            policy: { allow_implicit_invocation: true },
            dependencies: { tools: ["fs", "web"] },
          },
        },
        "Use {{model:deep}} for synthesis.\n",
      ),
      TIERS,
    );
    expect(out.skillMd).toMatchSnapshot("skillMd");
    expect(out.sidecar).toMatchSnapshot("sidecar");
  });
});
