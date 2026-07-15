import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  parseAgentRoutingPolicyOwner,
  parseAgentSemanticRoleOwner,
  readAgentRoutingPolicyOwner,
  readAgentSemanticRoleOwner,
} from "../__test-helpers__/agent-routing-policy.js";
import { readRepoFile } from "../__test-helpers__/skill-contracts.js";

const OWNER_PATH = "docs/guidelines/agent-routing-and-mutation-policy.md";
const AGENT_SPEC_PATH = "docs/specs/agents.md";

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
      ownerSkill: "pr-merge",
      evidenceLabel: "CI diagnosis/fix",
      surfaceAndOwner: expect.stringContaining("CI diagnosis/fix"),
      clauses: [
        {
          role: "investigator",
          capability: "balanced",
          effort: "high",
          sourceAuthority: "source-immutable",
        },
        { role: "executor", sourceAuthority: "source-mutable" },
        { role: "implementer", sourceAuthority: "source-mutable" },
      ],
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

  it("rejects extra uppercase role-like text before a valid tuple", async () => {
    const { markdown, sourceSkills } = await ownerInputs();
    const mutated = mutateRouteRow(markdown, "D12", (cells) => {
      cells[2] = `Executor ${cells[2]}`;
      return cells;
    });

    expect(() => parseAgentRoutingPolicyOwner(mutated, sourceSkills)).toThrow(
      /direct-route D12 clause 1 has malformed clause structure/i,
    );
  });

  it("rejects a non-owner inline-or prefix", async () => {
    const { markdown, sourceSkills } = await ownerInputs();
    const mutated = mutateRouteRow(markdown, "D13", (cells) => {
      cells[2] = cells[2].replace("Inline or", "Executor or");
      return cells;
    });

    expect(() => parseAgentRoutingPolicyOwner(mutated, sourceSkills)).toThrow(
      /direct-route D13 clause 1 has malformed clause structure/i,
    );
  });

  it("owns exactly six unique semantic roles with target envelopes", async () => {
    const roles = await readAgentSemanticRoleOwner(AGENT_SPEC_PATH);

    expect(roles).toHaveLength(6);
    expect(new Set(roles.map((role) => role.name)).size).toBe(6);
    expect(roles.every((role) => role.claudeTools.length > 0)).toBe(true);
    expect(roles.every((role) => role.primaryUse.length > 0)).toBe(true);
  });

  it("rejects malformed, duplicate, extra, and missing semantic role rows", async () => {
    const markdown = await readRepoFile(AGENT_SPEC_PATH);
    const assessor = markdown.match(/^\| `assessor`\s+\| balanced.*$/m)?.[0];
    expect(assessor).toBeDefined();

    expect(() =>
      parseAgentSemanticRoleOwner(
        markdown.replace(
          "| Agent           | Capability",
          "| Role            | Capability",
        ),
      ),
    ).toThrow(/semantic-role headers must be/i);
    expect(() =>
      parseAgentSemanticRoleOwner(
        markdown.replace(assessor ?? "", `${assessor}\n${assessor}`),
      ),
    ).toThrow(/duplicate semantic-role identity/i);
    expect(() =>
      parseAgentSemanticRoleOwner(
        markdown.replace(
          assessor ?? "",
          `${assessor}\n| \`observer\`      | balanced   | medium        | medium       | \`source-immutable\` | \`none\`           | Observation |`,
        ),
      ),
    ).toThrow(/semantic-role catalog must contain exactly six rows: 7/i);
    expect(() =>
      parseAgentSemanticRoleOwner(markdown.replace(`${assessor}\n`, "")),
    ).toThrow(/semantic-role catalog must contain exactly six rows: 5/i);
  });

  it("rejects malformed, duplicate, extra, and missing tool-envelope rows", async () => {
    const markdown = await readRepoFile(AGENT_SPEC_PATH);
    const assessor = markdown.match(
      /^\| `assessor`\s+\| Read, Grep, Bash, Write.*$/m,
    )?.[0];
    expect(assessor).toBeDefined();

    expect(() =>
      parseAgentSemanticRoleOwner(
        markdown.replace("workspace-write | None", "workspace-read | None"),
      ),
    ).toThrow(/tool-envelope Codex sandbox has invalid closed value/i);
    expect(() =>
      parseAgentSemanticRoleOwner(
        markdown.replace(assessor ?? "", `${assessor}\n${assessor}`),
      ),
    ).toThrow(/duplicate tool-envelope identity/i);
    expect(() =>
      parseAgentSemanticRoleOwner(
        markdown.replace(
          assessor ?? "",
          `${assessor}\n| \`observer\`      | Read                                         | workspace-write | None            |`,
        ),
      ),
    ).toThrow(
      /tool-envelope and semantic-role identities must match exactly.*unexpected: observer/i,
    );
    expect(() =>
      parseAgentSemanticRoleOwner(markdown.replace(`${assessor}\n`, "")),
    ).toThrow(
      /tool-envelope and semantic-role identities must match exactly; missing: assessor/i,
    );
  });

  it("rejects drift in every closed semantic-role and envelope field", async () => {
    const markdown = await readRepoFile(AGENT_SPEC_PATH);
    const mutations = [
      [
        "| balanced   | medium",
        "| unbounded  | medium",
        /semantic-role capability/i,
      ],
      [
        "| medium        | medium",
        "| ultra         | medium",
        /semantic-role Claude effort/i,
      ],
      [
        "| medium       | `source-immutable`",
        "| ultra        | `source-immutable`",
        /semantic-role Codex effort/i,
      ],
      [
        "`source-immutable` | `none`",
        "`source-observable` | `none`",
        /semantic-role source authority/i,
      ],
      [
        "`none`           | Bounded",
        "`external-mutable` | Bounded",
        /semantic-role external authority/i,
      ],
      [
        "Read, Grep, Bash, Write",
        "Read, Grep, Shell, Write",
        /tool-envelope Claude tool/i,
      ],
      [
        "workspace-write | None",
        "workspace-read | None",
        /tool-envelope Codex sandbox/i,
      ],
      [
        "workspace-write | Dispatch-owned",
        "workspace-write | Ambient",
        /tool-envelope default network/i,
      ],
    ] as const;

    for (const [from, to, error] of mutations) {
      expect(() =>
        parseAgentSemanticRoleOwner(markdown.replace(from, to)),
      ).toThrow(error);
    }
    expect(() =>
      parseAgentSemanticRoleOwner(
        markdown.replace("Read, Grep, Bash, Write", "Read, Grep, Read, Write"),
      ),
    ).toThrow(/duplicate Claude tool in the assessor tool envelope/i);
  });

  it("rejects deletion or addition of complete route clauses", async () => {
    const { markdown, sourceSkills } = await ownerInputs();
    const missingD17Clause = mutateRouteRow(markdown, "D17", (cells) => {
      cells[2] = cells[2].split(";").slice(0, -1).join(";");
      return cells;
    });
    const extraD12Clause = mutateRouteRow(markdown, "D12", (cells) => {
      cells[2] = `${cells[2]}; ${cells[2]}`;
      return cells;
    });

    expect(() =>
      parseAgentRoutingPolicyOwner(missingD17Clause, sourceSkills),
    ).toThrow(/direct-route D17 must contain exactly 3 route clauses/i);
    expect(() =>
      parseAgentRoutingPolicyOwner(extraD12Clause, sourceSkills),
    ).toThrow(/direct-route D12 must contain exactly 1 route clause/i);
  });

  it("validates the complete dynamic D4 route before role derivation", async () => {
    const { markdown, sourceSkills } = await ownerInputs();
    const owner = parseAgentRoutingPolicyOwner(markdown, sourceSkills);
    expect(
      owner.directChildRoutes.find((route) => route.id === "D4")?.d4Contract,
    ).toEqual({
      roleCardinality: 6,
      selectionTiming: "before spawn",
      configuration: "exact configured capability/effort",
      sourceDefault: "matching source default",
      scopeAndTermination: "scope/termination",
      externalAuthority: "none",
    });

    const mutations = [
      ["six semantic roles", "seven semantic roles", /role cardinality/i],
      ["before spawn", "after spawn", /selection timing/i],
      [
        "exact configured capability/effort",
        "ambient capability/effort",
        /configured capability and effort/i,
      ],
      ["matching source default", "ambient source default", /source default/i],
      ["scope/termination", "scope only", /scope and termination/i],
      [
        "external authority `none`",
        "external authority `external-mutable`",
        /external authority/i,
      ],
    ] as const;

    for (const [from, to, error] of mutations) {
      const mutated = mutateRouteRow(markdown, "D4", (cells) => {
        cells[2] = cells[2].replace(from, to);
        return cells;
      });
      expect(() => parseAgentRoutingPolicyOwner(mutated, sourceSkills)).toThrow(
        error,
      );
    }

    for (const field of [
      " and matching source default",
      "; declare scope/termination",
    ]) {
      const mutated = mutateRouteRow(markdown, "D4", (cells) => {
        cells[2] = cells[2].replace(field, "");
        return cells;
      });
      expect(() => parseAgentRoutingPolicyOwner(mutated, sourceSkills)).toThrow(
        /direct-route D4/i,
      );
    }
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
