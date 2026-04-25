import { describe, expect, it } from "vitest";
import { makeResolvedConfig } from "../__test-helpers__/fixtures.js";
import type { ModelTiers, SkillSource } from "../config/schema.js";
import type { LoadedSkill } from "../models/types.js";
import { renderSkillForTarget } from "./skill.js";

const TIERS: ModelTiers = {
  fast: { claude: "haiku", codex: "gpt-5.4-mini" },
  standard: { claude: "sonnet", codex: "gpt-5.4" },
  deep: { claude: "opus", codex: "gpt-5.4" },
};

function makeLoaded(source: SkillSource, body = "# body\n"): LoadedSkill {
  return {
    name: source.name,
    dirPath: `/tmp/skills/${source.name}`,
    skillMdContent: "",
    source,
    body,
    subdirs: [],
  };
}

describe("renderSkillForTarget contentHash", () => {
  it("changes when only the codex sidecar changes (codex target)", () => {
    const config = makeResolvedConfig("/tmp/test-hash");
    config.modelTiers = TIERS;

    const baseSource: SkillSource = {
      name: "x",
      description: "d",
      codex_sidecar: { interface: { display_name: "Original" } },
    };
    const mutatedSource: SkillSource = {
      name: "x",
      description: "d",
      codex_sidecar: {
        interface: { display_name: "Original", brand_color: "#fff" },
      },
    };

    const baseRender = renderSkillForTarget(
      makeLoaded(baseSource),
      "codex",
      config,
    );
    const mutatedRender = renderSkillForTarget(
      makeLoaded(mutatedSource),
      "codex",
      config,
    );

    // SKILL.md content is unchanged (sidecar lives in a separate file),
    // but the hash must reflect sidecar mutation so plan computation
    // re-installs the skill.
    expect(baseRender.rendered.content).toBe(mutatedRender.rendered.content);
    expect(baseRender.rendered.contentHash).not.toBe(
      mutatedRender.rendered.contentHash,
    );
  });

  it("changes when only the claude override changes (claude target)", () => {
    const config = makeResolvedConfig("/tmp/test-hash");
    config.modelTiers = TIERS;

    const baseSource: SkillSource = {
      name: "x",
      description: "d",
      claude: { model: "sonnet" },
    };
    const mutatedSource: SkillSource = {
      name: "x",
      description: "d",
      claude: { model: "opus" },
    };

    const baseRender = renderSkillForTarget(
      makeLoaded(baseSource),
      "claude",
      config,
    );
    const mutatedRender = renderSkillForTarget(
      makeLoaded(mutatedSource),
      "claude",
      config,
    );

    expect(baseRender.rendered.contentHash).not.toBe(
      mutatedRender.rendered.contentHash,
    );
  });

  it("is deterministic across renders of the same source+sidecar", () => {
    const config = makeResolvedConfig("/tmp/test-hash");
    config.modelTiers = TIERS;

    const source: SkillSource = {
      name: "x",
      description: "d",
      codex_sidecar: { interface: { display_name: "Stable" } },
    };
    const a = renderSkillForTarget(makeLoaded(source), "codex", config);
    const b = renderSkillForTarget(makeLoaded(source), "codex", config);
    expect(a.rendered.contentHash).toBe(b.rendered.contentHash);
  });
});
