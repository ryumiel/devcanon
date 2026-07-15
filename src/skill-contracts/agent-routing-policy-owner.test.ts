import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  parseAgentRoutingPolicyOwner,
  readAgentRoutingPolicyOwner,
} from "../__test-helpers__/agent-routing-policy.js";
import { readRepoFile } from "../__test-helpers__/skill-contracts.js";

const OWNER_PATH = "docs/guidelines/agent-routing-and-mutation-policy.md";

describe("agent routing and mutation policy owner", () => {
  it("covers every source skill exactly once and exactly D1-D17", async () => {
    const owner = await readAgentRoutingPolicyOwner(OWNER_PATH);
    const sourceSkills = (await readdir("skills", { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(owner.inventory.map((row) => row.skill).sort()).toEqual(
      sourceSkills,
    );
    expect(owner.directChildRoutes.map((row) => row.id)).toEqual(
      Array.from({ length: 17 }, (_, index) => `D${index + 1}`),
    );
  });

  it("preserves representative closed inventory and route fields", async () => {
    const owner = await readAgentRoutingPolicyOwner(OWNER_PATH);

    expect(
      owner.inventory.find((row) => row.skill === "github-issue-priming"),
    ).toMatchObject({
      demand: "inherited",
      stance: "normal",
      sourceAuthority: "source-mutable",
      externalAuthority: "external-mutable",
    });
    expect(
      owner.directChildRoutes.find((row) => row.id === "D17"),
    ).toMatchObject({
      surfaceAndOwner: expect.stringContaining("CI diagnosis/fix"),
      route: expect.stringContaining(
        "`investigator`, balanced/high, source-immutable",
      ),
      existingOutputOrTermination: expect.stringContaining(
        "mutable child commits only",
      ),
    });
  });

  it("rejects a malformed inventory row in the inventory dimension", async () => {
    const { markdown, sourceSkills } = await ownerInputs();
    const mutated = markdown.replace(
      /^(\| `[^`]+`\s+\| [^|]+\| [^|]+\| [^|]+)\| [^|]+\|$/m,
      "$1|",
    );

    expect(() => parseAgentRoutingPolicyOwner(mutated, sourceSkills)).toThrow(
      /inventory row .* malformed/i,
    );
  });

  it("rejects a duplicate inventory skill without deduplicating it", async () => {
    const { markdown, sourceSkills } = await ownerInputs();
    const row = markdown.match(/^\| `[^`]+`\s+\|.*$/m)?.[0];
    expect(row).toBeDefined();
    const mutated = markdown.replace(row ?? "", `${row}\n${row}`);

    expect(() => parseAgentRoutingPolicyOwner(mutated, sourceSkills)).toThrow(
      /duplicate inventory skill/i,
    );
  });

  it("rejects incomplete source-skill coverage", async () => {
    const { markdown, sourceSkills } = await ownerInputs();
    const row = markdown.match(/^\| `[^`]+`\s+\|.*$/m)?.[0];
    expect(row).toBeDefined();
    const mutated = markdown.replace(`${row}\n`, "");

    expect(() => parseAgentRoutingPolicyOwner(mutated, sourceSkills)).toThrow(
      /inventory source-skill coverage mismatch; missing:/i,
    );
  });

  it("rejects an invalid inventory closed value by dimension", async () => {
    const { markdown, sourceSkills } = await ownerInputs();
    const mutated = markdown.replace(
      "inherited / adversarial",
      "unbounded / adversarial",
    );

    expect(() => parseAgentRoutingPolicyOwner(mutated, sourceSkills)).toThrow(
      /inventory demand has invalid closed value: unbounded/i,
    );
  });

  it("rejects an incomplete direct-route ID set", async () => {
    const { markdown, sourceSkills } = await ownerInputs();
    const mutated = markdown.replace(/^\| D17 \|.*\n/m, "");

    expect(() => parseAgentRoutingPolicyOwner(mutated, sourceSkills)).toThrow(
      /direct-route ID coverage must be exactly D1-D17; missing: D17/i,
    );
  });

  it("rejects a duplicate direct-route ID without deduplicating it", async () => {
    const { markdown, sourceSkills } = await ownerInputs();
    const row = markdown.match(/^\| D1\s+\|.*$/m)?.[0];
    expect(row).toBeDefined();
    const mutated = markdown.replace(row ?? "", `${row}\n${row}`);

    expect(() => parseAgentRoutingPolicyOwner(mutated, sourceSkills)).toThrow(
      /duplicate direct-route ID: D1/i,
    );
  });

  it("rejects an invalid direct-route source field", async () => {
    const { markdown, sourceSkills } = await ownerInputs();
    const mutated = markdown.replace(
      "`assessor`, balanced/medium, source-immutable",
      "`assessor`, balanced/medium, source-observable",
    );

    expect(() => parseAgentRoutingPolicyOwner(mutated, sourceSkills)).toThrow(
      /direct-route D1 .* invalid role\/capability\/effort\/source field/i,
    );
  });

  it("requires the exact owned headings and table headers", async () => {
    const { markdown, sourceSkills } = await ownerInputs();

    expect(() =>
      parseAgentRoutingPolicyOwner(
        markdown.replace("## Complete Skill Inventory", "## Skill Inventory"),
        sourceSkills,
      ),
    ).toThrow(/inventory heading must appear exactly once/i);
    expect(() =>
      parseAgentRoutingPolicyOwner(
        markdown.replace("| Demand / stance", "| Demand"),
        sourceSkills,
      ),
    ).toThrow(/inventory headers must be/i);
  });
});

async function ownerInputs(): Promise<{
  markdown: string;
  sourceSkills: readonly string[];
}> {
  const owner = await readAgentRoutingPolicyOwner(OWNER_PATH);
  return {
    markdown: await readRepoFile(OWNER_PATH),
    sourceSkills: owner.inventory.map((row) => row.skill),
  };
}
