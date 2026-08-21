import { describe, expect, it } from "vitest";
import { readRepoFile } from "../__test-helpers__/skill-contracts.js";

const OWNERSHIP_SENTENCE =
  "Findings are evidence; mutation disposition belongs to the controller.";

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

  it("keeps one stable controller-ownership sentence in each reviewer prompt", async () => {
    const prompts = await Promise.all([
      readRepoFile(
        "skills/play-subagent-execution/references/spec-reviewer-prompt.md",
      ),
      readRepoFile(
        "skills/play-subagent-execution/references/code-quality-reviewer-prompt.md",
      ),
    ]);

    for (const prompt of prompts) {
      expect(prompt.match(new RegExp(OWNERSHIP_SENTENCE, "g"))).toHaveLength(1);
    }
  });
});
