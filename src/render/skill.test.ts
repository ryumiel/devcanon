import { describe, expect, it } from "vitest";
import { makeResolvedConfig } from "../__test-helpers__/fixtures.js";
import type { ModelTiers, SkillSource } from "../config/schema.js";
import type { LoadedSkill } from "../models/types.js";
import { sha256 } from "../utils/hash.js";
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

  it("uses POSIX-normalized relative paths in the sidecar hash", () => {
    // The hash must not depend on the host's path separator. We pin it to
    // the POSIX representation by reproducing the implementation's recipe
    // with `agents/openai.yaml` (forward-slash) and asserting equality. A
    // regression that hashed `agents\openai.yaml` on Windows would diverge.
    const config = makeResolvedConfig("/tmp/test-hash");
    config.modelTiers = TIERS;

    const source: SkillSource = {
      name: "x",
      description: "d",
      codex_sidecar: { interface: { display_name: "Stable" } },
    };
    const rendered = renderSkillForTarget(
      makeLoaded(source),
      "codex",
      config,
    ).rendered;

    const sidecarYaml = "interface:\n  display_name: Stable\n";
    const expected = sha256(
      [rendered.content, "agents/openai.yaml", sidecarYaml].join("\0"),
    );
    expect(rendered.contentHash).toBe(expected);
  });

  it("isolates claude override changes from codex hash", () => {
    // A `claude:` override change must flip the claude hash but never the
    // codex hash. If a regression bled claude overrides into the codex
    // render path, both hashes would change.
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

    const baseClaude = renderSkillForTarget(
      makeLoaded(baseSource),
      "claude",
      config,
    ).rendered;
    const mutatedClaude = renderSkillForTarget(
      makeLoaded(mutatedSource),
      "claude",
      config,
    ).rendered;
    const baseCodex = renderSkillForTarget(
      makeLoaded(baseSource),
      "codex",
      config,
    ).rendered;
    const mutatedCodex = renderSkillForTarget(
      makeLoaded(mutatedSource),
      "codex",
      config,
    ).rendered;

    expect(baseClaude.contentHash).not.toBe(mutatedClaude.contentHash);
    expect(baseCodex.contentHash).toBe(mutatedCodex.contentHash);
  });

  it("isolates codex sidecar changes from claude hash", () => {
    // Symmetric: a `codex_sidecar:` mutation must flip the codex hash but
    // leave the claude hash untouched.
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

    const baseCodex = renderSkillForTarget(
      makeLoaded(baseSource),
      "codex",
      config,
    ).rendered;
    const mutatedCodex = renderSkillForTarget(
      makeLoaded(mutatedSource),
      "codex",
      config,
    ).rendered;
    const baseClaude = renderSkillForTarget(
      makeLoaded(baseSource),
      "claude",
      config,
    ).rendered;
    const mutatedClaude = renderSkillForTarget(
      makeLoaded(mutatedSource),
      "claude",
      config,
    ).rendered;

    expect(baseCodex.contentHash).not.toBe(mutatedCodex.contentHash);
    expect(baseClaude.contentHash).toBe(mutatedClaude.contentHash);
  });
});
