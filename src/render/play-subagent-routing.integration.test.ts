import path from "node:path";
import { describe, expect, it } from "vitest";
import { readAgentRoutingPolicyOwner } from "../__test-helpers__/agent-routing-policy.js";
import { getSkillOutput } from "../__test-helpers__/render.js";
import { loadConfig } from "../config/load.js";
import { parseFrontmatter } from "./frontmatter.js";
import { renderAll } from "./pipeline.js";

const OWNER_PATH = "docs/guidelines/agent-routing-and-mutation-policy.md";
const TARGETS = ["claude", "codex"] as const;

describe("routing-owner skill rendering", () => {
  it("renders every route owner named by the structural policy inventory", async () => {
    const [owner, config] = await Promise.all([
      readAgentRoutingPolicyOwner(OWNER_PATH),
      loadConfig(path.join(process.cwd(), "devcanon.config.yaml")),
    ]);
    const { outputs } = await renderAll(config, false, true);
    const ownerSkills = new Set(
      owner.directChildRoutes.map((route) => route.ownerSkill),
    );

    for (const skillName of ownerSkills) {
      for (const target of TARGETS) {
        const output = getSkillOutput(outputs, skillName, target);
        const { frontmatter, body } = parseFrontmatter(output.content);

        expect(frontmatter.name).toBe(skillName);
        expect(body.trim()).not.toHaveLength(0);
      }
    }
  });
});
