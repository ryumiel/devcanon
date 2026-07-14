import { describe, expect, it } from "vitest";
import {
  parseRenderedMarkdownArtifact,
  parseRenderedYamlArtifact,
} from "../__test-helpers__/render.js";
import type { CapabilityProfiles, SkillSource } from "../config/schema.js";
import type { PlaceholderGlossary } from "./placeholders.js";
import { renderCodexSkill } from "./skill-codex.js";

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

describe("renderCodexSkill", () => {
  it("emits name/description frontmatter starting at the first line", () => {
    const out = renderCodexSkill(
      make({ name: "x", description: "d" }, "# body\n"),
      GLOSSARY,
    );
    const parsed = parseRenderedMarkdownArtifact(out.skillMd);
    expect(out.skillMd.startsWith("---\n")).toBe(true);
    expect(out.skillMd).not.toContain("Managed by DevCanon");
    expect(parsed.frontmatter).toMatchObject({ name: "x", description: "d" });
    expect(parsed.body).toBe("# body\n");
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
      GLOSSARY,
    );
    const { frontmatter } = parseRenderedMarkdownArtifact(out.skillMd);
    expect(frontmatter.license).toBe("MIT");
    expect(frontmatter.metadata).toEqual({ "short-description": "blurb" });
    expect(frontmatter).not.toHaveProperty("model");
    expect(frontmatter).not.toHaveProperty("display_name");
    expect(frontmatter).not.toHaveProperty("claude");
    expect(frontmatter).not.toHaveProperty("codex_sidecar");
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
      GLOSSARY,
    );
    expect(out.sidecar).not.toBeNull();
    const parsed = parseRenderedYamlArtifact(out.sidecar as string);
    expect(parsed.interface).toMatchObject({
      display_name: "X",
      brand_color: "#00ccff",
    });
    expect(parsed.policy).toMatchObject({ allow_implicit_invocation: true });
    expect(parsed.dependencies).toMatchObject({ tools: [] });
  });

  it("appends a configured display suffix to an existing display name", () => {
    const out = renderCodexSkill(
      make(
        {
          name: "pr-review",
          description: "d",
          codex_sidecar: {
            interface: { display_name: "PR Review", brand_color: "#0969da" },
          },
        },
        "",
      ),
      GLOSSARY,
      { skillDisplayNameSuffix: " devcanon " },
    );

    const parsed = parseRenderedYamlArtifact(out.sidecar as string);
    expect(parsed.interface).toMatchObject({
      display_name: "PR Review (devcanon)",
      brand_color: "#0969da",
    });
  });

  it("creates a sidecar with a display name when only a suffix is configured", () => {
    const out = renderCodexSkill(
      make({ name: "branch-review", description: "d" }, ""),
      GLOSSARY,
      { skillDisplayNameSuffix: "devcanon" },
    );

    const parsed = parseRenderedYamlArtifact(out.sidecar as string);
    expect(parsed).toEqual({
      interface: { display_name: "Branch Review (devcanon)" },
    });
  });

  it("preserves policy-only sidecars when adding a generated display name", () => {
    const out = renderCodexSkill(
      make(
        {
          name: "play-tdd",
          description: "d",
          codex_sidecar: {
            policy: { allow_implicit_invocation: false },
          },
        },
        "",
      ),
      GLOSSARY,
      { skillDisplayNameSuffix: "devcanon" },
    );

    const parsed = parseRenderedYamlArtifact(out.sidecar as string);
    expect(parsed).toEqual({
      interface: { display_name: "Play TDD (devcanon)" },
      policy: { allow_implicit_invocation: false },
    });
  });

  it("does not append the configured display suffix twice", () => {
    const out = renderCodexSkill(
      make(
        {
          name: "pr-review",
          description: "d",
          codex_sidecar: {
            interface: { display_name: "PR Review (devcanon)" },
          },
        },
        "",
      ),
      GLOSSARY,
      { skillDisplayNameSuffix: "devcanon" },
    );

    const parsed = parseRenderedYamlArtifact(out.sidecar as string);
    expect(parsed.interface).toMatchObject({
      display_name: "PR Review (devcanon)",
    });
  });

  it("substitutes {{model:*}} in body using the codex resolution", () => {
    const out = renderCodexSkill(
      make(
        { name: "x", description: "d" },
        "use {{model:efficient}} for cleanup.\n",
      ),
      GLOSSARY,
    );
    const { body } = parseRenderedMarkdownArtifact(out.skillMd);
    expect(body).toContain("use gpt-5.4-mini for cleanup.");
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
      GLOSSARY,
    );
    const { frontmatter } = parseRenderedMarkdownArtifact(out.skillMd);
    expect(frontmatter["allowed-tools"]).toBe("Bash Read");
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
        "Use {{model:frontier}} for synthesis.\n",
      ),
      GLOSSARY,
    );
    const { frontmatter, body } = parseRenderedMarkdownArtifact(out.skillMd);
    const sidecar = parseRenderedYamlArtifact(out.sidecar as string);
    expect(frontmatter).toMatchObject({
      name: "snap-skill",
      description: "Snapshot fixture skill.",
      "allowed-tools": "Bash Read",
      license: "MIT",
      metadata: { "short-description": "Snapshot blurb" },
    });
    expect(frontmatter).not.toHaveProperty("model");
    expect(frontmatter).not.toHaveProperty("claude");
    expect(frontmatter).not.toHaveProperty("codex_sidecar");
    expect(body).toBe("Use gpt-5.4-pro for synthesis.\n");
    expect(sidecar).toEqual({
      interface: {
        display_name: "Snap",
        short_description: "Snapshot blurb",
        brand_color: "#00ccff",
      },
      policy: { allow_implicit_invocation: true },
      dependencies: { tools: ["fs", "web"] },
    });
    expect(out.skillMd).toMatchSnapshot("skillMd");
    expect(out.sidecar).toMatchSnapshot("sidecar");
  });
});
