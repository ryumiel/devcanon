import { describe, expect, it } from "vitest";
import { parseRenderedMarkdownArtifact } from "../__test-helpers__/render.js";
import type { CapabilityProfiles, SkillSource } from "../config/schema.js";
import type { PlaceholderGlossary } from "./placeholders.js";
import { renderClaudeSkill } from "./skill-claude.js";

const CAPABILITY_PROFILES: CapabilityProfiles = {
  efficient: { claude: "haiku", codex: "gpt-5.4-mini" },
  balanced: { claude: "sonnet", codex: "gpt-5.4" },
  frontier: { claude: "opus", codex: "gpt-5.4-pro" },
};

const GLOSSARY: PlaceholderGlossary = { model: CAPABILITY_PROFILES };

function make(
  source: Partial<SkillSource> & Pick<SkillSource, "name" | "description">,
  body: string,
): { source: SkillSource; body: string } {
  return { source: source as SkillSource, body };
}

describe("renderClaudeSkill", () => {
  it("emits name/description frontmatter starting at the first line", () => {
    const out = renderClaudeSkill(
      make({ name: "x", description: "d" }, "# body\n"),
      GLOSSARY,
    );
    const parsed = parseRenderedMarkdownArtifact(out);
    expect(out.startsWith("---\n")).toBe(true);
    expect(out).not.toContain("Managed by DevCanon");
    expect(parsed.frontmatter).toMatchObject({ name: "x", description: "d" });
    expect(parsed.body).toContain("# body");
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
      GLOSSARY,
    );
    const { frontmatter } = parseRenderedMarkdownArtifact(out);
    expect(frontmatter["allowed-tools"]).toBe("Bash Read");
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
      GLOSSARY,
    );
    const { frontmatter } = parseRenderedMarkdownArtifact(out);
    expect(frontmatter["allowed-tools"]).toBe("Bash Read");
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
      GLOSSARY,
    );
    const { frontmatter } = parseRenderedMarkdownArtifact(out);
    expect(frontmatter.model).toBe("opus");
    expect(frontmatter.effort).toBe("high");
    expect(frontmatter).not.toHaveProperty("license");
    expect(frontmatter).not.toHaveProperty("display_name");
    expect(frontmatter).not.toHaveProperty("codex");
    expect(frontmatter).not.toHaveProperty("codex_sidecar");
  });

  it("substitutes {{model:*}} placeholders in body and in override string values", () => {
    const out = renderClaudeSkill(
      make(
        {
          name: "x",
          description: "d",
          claude: { model: "{{model:balanced}}", effort: "high" },
        },
        "use {{model:balanced}} for synthesis.\n",
      ),
      GLOSSARY,
    );
    const { frontmatter, body } = parseRenderedMarkdownArtifact(out);
    expect(frontmatter.model).toBe("sonnet");
    expect(frontmatter.effort).toBe("high");
    expect(body).toContain("use sonnet for synthesis.");
  });

  it("matches snapshot for a representative skill", () => {
    const out = renderClaudeSkill(
      make(
        {
          name: "snap-skill",
          description: "Snapshot fixture skill.",
          "allowed-tools": ["Bash", "Read"],
          claude: {
            model: "{{model:frontier}}",
            effort: "high",
            when_to_use: "Use when synthesizing.",
          },
          codex: { license: "MIT" },
          codex_sidecar: { interface: { display_name: "Snap" } },
        },
        "Use {{model:frontier}} for synthesis.\n",
      ),
      GLOSSARY,
    );
    const { frontmatter, body } = parseRenderedMarkdownArtifact(out);
    expect(frontmatter).toMatchObject({
      name: "snap-skill",
      description: "Snapshot fixture skill.",
      "allowed-tools": "Bash Read",
      model: "opus",
      effort: "high",
      when_to_use: "Use when synthesizing.",
    });
    expect(frontmatter).not.toHaveProperty("license");
    expect(frontmatter).not.toHaveProperty("codex_sidecar");
    expect(body).toBe("Use opus for synthesis.\n");
    expect(out).toMatchSnapshot();
  });
});
