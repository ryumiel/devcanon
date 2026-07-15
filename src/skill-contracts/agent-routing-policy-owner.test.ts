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
      /direct-route D1 source authority has invalid closed value: source-observable/i,
    );
  });

  it("requires the exact owned headings and inventory headers", async () => {
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

  it("rejects malformed direct-route headers, dividers, and rows", async () => {
    const { markdown, sourceSkills } = await ownerInputs();
    const malformedHeader = markdown.replace(
      "| Surface and owner",
      "| Surface",
    );
    const malformedDivider = markdown.replace(
      /^\| --- \| -+ \| -+ \| -+ \|$/m,
      "| --- |",
    );
    const malformedRow = mutateRouteRow(markdown, "D12", (cells) =>
      cells.slice(0, 3),
    );

    expect(() =>
      parseAgentRoutingPolicyOwner(malformedHeader, sourceSkills),
    ).toThrow(/direct-route headers must be/i);
    expect(() =>
      parseAgentRoutingPolicyOwner(malformedDivider, sourceSkills),
    ).toThrow(/direct-route table divider is malformed/i);
    expect(() =>
      parseAgentRoutingPolicyOwner(malformedRow, sourceSkills),
    ).toThrow(/direct-route row .* malformed/i);
  });

  it("preserves D12 owner-field drift for the consumer assertion boundary", async () => {
    const { markdown, sourceSkills } = await ownerInputs();
    const canonical = parseAgentRoutingPolicyOwner(markdown, sourceSkills);
    const mutatedMarkdown = mutateRouteRow(markdown, "D12", (cells) => {
      cells[1] = cells[1].replace(
        "Default implementation",
        "Alternate implementation",
      );
      return cells;
    });
    const mutated = parseAgentRoutingPolicyOwner(mutatedMarkdown, sourceSkills);

    const canonicalD12 = canonical.directChildRoutes.find(
      (row) => row.id === "D12",
    );
    const mutatedD12 = mutated.directChildRoutes.find(
      (row) => row.id === "D12",
    );
    expect(mutatedD12?.surfaceAndOwner).toContain("Alternate implementation");
    expect(mutatedD12?.surfaceAndOwner).not.toBe(canonicalD12?.surfaceAndOwner);
  });

  it("rejects a D13 route missing its source-authority dimension", async () => {
    const { markdown, sourceSkills } = await ownerInputs();
    const mutated = mutateRouteRow(markdown, "D13", (cells) => {
      cells[2] = cells[2].replace(", source-mutable", "");
      return cells;
    });

    expect(() => parseAgentRoutingPolicyOwner(mutated, sourceSkills)).toThrow(
      /direct-route D13 clause 1 is missing a source authority dimension/i,
    );
  });

  it("rejects a D17 route with an invalid closed effort", async () => {
    const { markdown, sourceSkills } = await ownerInputs();
    const mutated = mutateRouteRow(markdown, "D17", (cells) => {
      cells[2] = cells[2].replace("balanced/high", "balanced/ultra");
      return cells;
    });

    expect(() => parseAgentRoutingPolicyOwner(mutated, sourceSkills)).toThrow(
      /direct-route D17 effort has invalid closed value: ultra/i,
    );
  });

  it("rejects a malformed role structure in one D17 clause", async () => {
    const { markdown, sourceSkills } = await ownerInputs();
    const mutated = mutateRouteRow(markdown, "D17", (cells) => {
      cells[2] = cells[2].replace("`investigator`", "`investigator!`");
      return cells;
    });

    expect(() => parseAgentRoutingPolicyOwner(mutated, sourceSkills)).toThrow(
      /direct-route D17 clause 1 has malformed clause structure/i,
    );
  });

  it("rejects a source-authority token with a malformed suffix", async () => {
    const { markdown, sourceSkills } = await ownerInputs();
    const mutated = mutateRouteRow(markdown, "D17", (cells) => {
      cells[2] = cells[2].replace("source-mutable", "source-mutable!");
      return cells;
    });

    expect(() => parseAgentRoutingPolicyOwner(mutated, sourceSkills)).toThrow(
      /direct-route D17 source authority has invalid closed value: source-mutable!/i,
    );
  });

  it("rejects mismatched role backticks", async () => {
    const { markdown, sourceSkills } = await ownerInputs();
    const mutated = mutateRouteRow(markdown, "D12", (cells) => {
      cells[2] = cells[2].replace("`implementer`", "`implementer");
      return cells;
    });

    expect(() => parseAgentRoutingPolicyOwner(mutated, sourceSkills)).toThrow(
      /direct-route D12 clause 1 has malformed clause structure/i,
    );
  });

  it("rejects an extra malformed tuple appended to a valid D17 clause", async () => {
    const { markdown, sourceSkills } = await ownerInputs();
    const mutated = mutateRouteRow(markdown, "D17", (cells) => {
      cells[2] = cells[2].replace(
        "source-immutable;",
        "source-immutable, `executor!`, efficient/medium, source-mutable;",
      );
      return cells;
    });

    expect(() => parseAgentRoutingPolicyOwner(mutated, sourceSkills)).toThrow(
      /direct-route D17 clause 1 has malformed clause structure/i,
    );
  });

  it("rejects an uppercase unquoted role without suffix reparsing", async () => {
    const { markdown, sourceSkills } = await ownerInputs();
    const mutated = mutateRouteRow(markdown, "D13", (cells) => {
      cells[2] = cells[2].replace("`executor`", "Executor");
      return cells;
    });

    expect(() => parseAgentRoutingPolicyOwner(mutated, sourceSkills)).toThrow(
      /direct-route D13 clause 1 has malformed clause structure/i,
    );
  });
});

async function ownerInputs(): Promise<{
  markdown: string;
  sourceSkills: readonly string[];
}> {
  const markdown = await readRepoFile(OWNER_PATH);
  const sourceSkills = (await readdir("skills", { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  return {
    markdown,
    sourceSkills,
  };
}

function mutateRouteRow(
  markdown: string,
  id: `D${number}`,
  mutate: (cells: string[]) => string[],
): string {
  const rowPattern = new RegExp(`^\\| ${id}\\s+\\|.*$`, "m");
  const row = markdown.match(rowPattern)?.[0];
  if (!row) throw new Error(`Missing owner route row ${id}`);

  const cells = row
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
  return markdown.replace(row, `| ${mutate(cells).join(" | ")} |`);
}
