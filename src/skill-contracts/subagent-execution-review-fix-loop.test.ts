import { describe, expect, it } from "vitest";
import { readRepoFile } from "../__test-helpers__/skill-contracts.js";

describe("subagent-execution review-fix loop composition", () => {
  it("keeps lifecycle policy as the execution skill's canonical reference", async () => {
    const skill = await readRepoFile("skills/play-subagent-execution/SKILL.md");

    expect(skill).toMatch(
      /\[[^\]]+\]\(references\/lifecycle-status-policy\.md\)/,
    );
  });

  it("links the lifecycle owner to the portable proportionality policy", async () => {
    const lifecycle = await readRepoFile(
      "skills/play-subagent-execution/references/lifecycle-status-policy.md",
    );

    expect(lifecycle).toMatch(
      /\[[^\]]+\]\(\.\.\/\.\.\/play-review-response\/references\/finding-proportionality\.md\)/,
    );
  });
});
