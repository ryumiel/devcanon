import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  parseAgentRoutingPolicyOwner,
  parseAgentSemanticRoleOwner,
  readAgentRoutingPolicyOwner,
  readAgentSemanticRoleOwner,
} from "../__test-helpers__/agent-routing-policy.js";
import { readRepoFile } from "../__test-helpers__/skill-contracts.js";
import { loadConfig } from "../config/load.js";
import { resolveCapabilityModel } from "../render/capability-profiles.js";

const OWNER_PATH = "docs/guidelines/agent-routing-and-mutation-policy.md";
const AGENT_SPEC_PATH = "docs/specs/agents.md";

interface SemanticAgentSource {
  readonly capability?: string;
  readonly claude?: { readonly effort?: string; readonly model?: string };
  readonly codex?: {
    readonly model_reasoning_effort?: string;
    readonly model?: string | null;
  };
}

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
    expect(owner.escalationAdoptionInventory).toEqual(
      Array.from({ length: 17 }, (_, index) => ({
        id: `D${index + 1}`,
        state: "opt-out",
        transition: "none",
      })),
    );
  });

  it("rejects representative adoption and owner-reference drift", async () => {
    const { markdown, sourceSkills } = await ownerInputs();
    const d1 = markdown.match(/^\| D1\s+\| opt-out\s+\| none\s+\|$/m)?.[0];
    expect(d1).toBeDefined();

    const missing = markdown.replace(`${d1}\n`, "");
    const duplicate = markdown.replace(d1 ?? "", `${d1}\n${d1}`);
    const qualifierMismatch = markdown.replace(
      "evidence-qualifier `named-network`",
      "evidence-qualifier `unnamed-network`",
    );
    const ownerReferenceMismatch = markdown.replace(
      "[`subagent-lifecycle`](../../skills/subagent-lifecycle/SKILL.md)",
      "[`subagent-lifecycle`](../../skills/other/SKILL.md)",
    );

    expect(() => parseAgentRoutingPolicyOwner(missing, sourceSkills)).toThrow(
      /escalation-adoption ID coverage must be exactly D1-D17; missing: D1/i,
    );
    expect(() => parseAgentRoutingPolicyOwner(duplicate, sourceSkills)).toThrow(
      /duplicate escalation-adoption ID: D1/i,
    );
    expect(representativeOwnerErrors(markdown, sourceSkills)).toEqual([]);
    expect(representativeOwnerErrors(qualifierMismatch, sourceSkills)).toEqual([
      "D3:evidence-qualifier",
    ]);
    expect(
      representativeOwnerErrors(ownerReferenceMismatch, sourceSkills),
    ).toEqual(["shared-owner-reference"]);
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

  it("preserves distinct same-digest D5/D6 review routes", async () => {
    const owner = await readAgentRoutingPolicyOwner(OWNER_PATH);
    const roles = await readAgentSemanticRoleOwner(AGENT_SPEC_PATH);
    const reviewer = roles.find((role) => role.name === "reviewer");
    const d5 = owner.directChildRoutes.find((row) => row.id === "D5");
    const d6 = owner.directChildRoutes.find((row) => row.id === "D6");

    expect(reviewer).toMatchObject({ externalAuthority: "none" });
    expect(d5?.clauses).toEqual([
      {
        role: "reviewer",
        capability: "frontier",
        effort: "high",
        sourceAuthority: "source-immutable",
      },
    ]);
    expect(d6?.clauses).toEqual(d5?.clauses);
    expect(d5?.existingOutputOrTermination).toBe(
      "Distinct digest-bound PASS/FAIL; join paired results for one digest",
    );
    expect(d6?.existingOutputOrTermination).toBe(
      "Distinct digest-bound PASS/FAIL; join paired results for one digest",
    );
  });

  it("keeps the six source agents target-neutral for Codex while preserving Claude", async () => {
    const roles = await readAgentSemanticRoleOwner(AGENT_SPEC_PATH);

    for (const role of roles) {
      const source = parseYaml(
        await readRepoFile(`agents/${role.name}.yaml`),
      ) as SemanticAgentSource;

      expect(source.capability).toBe(role.capability);
      expect(source.claude?.effort).toBe(role.claudeEffort);
      expect(source.codex?.model).toBeNull();
      expect(source.codex).not.toHaveProperty("model_reasoning_effort");
    }
  });

  it("derives fresh Codex route model from capability and effort from the route", async () => {
    const [roles, config] = await Promise.all([
      readAgentSemanticRoleOwner(AGENT_SPEC_PATH),
      loadConfig("devcanon.config.yaml", true),
    ]);

    for (const role of roles) {
      const source = parseYaml(
        await readRepoFile(`agents/${role.name}.yaml`),
      ) as SemanticAgentSource;
      expect(source.capability).toBe(role.capability);
      expect(resolveFreshCodexModel(source, config.capabilityProfiles)).toBe(
        config.capabilityProfiles[role.capability].codex,
      );
      expect(role.routeEffort).toMatch(/^(medium|high|xhigh)$/);
    }
  });

  it("reconciles every static D1-D17 tuple to its semantic role without source Codex overrides", async () => {
    const [owner, roles, config] = await Promise.all([
      readAgentRoutingPolicyOwner(OWNER_PATH),
      readAgentSemanticRoleOwner(AGENT_SPEC_PATH),
      loadConfig("devcanon.config.yaml", true),
    ]);
    const rolesByName = new Map(roles.map((role) => [role.name, role]));

    for (const route of owner.directChildRoutes) {
      for (const clause of route.clauses) {
        const role = rolesByName.get(clause.role);
        expect(role, `${route.id} has a known semantic role`).toBeDefined();
        expect(clause.capability).toBe(role?.capability);
        expect(clause.effort).toBe(role?.routeEffort);
        expect(clause.sourceAuthority).toBe(role?.sourceAuthority);
        expect(config.capabilityProfiles[clause.capability].codex).toMatch(
          /\S/,
        );
      }
    }
  });

  it("reconciles each D1-D17 route to its implemented owner spawn contract", async () => {
    const [owner, roles, config] = await Promise.all([
      readAgentRoutingPolicyOwner(OWNER_PATH),
      readAgentSemanticRoleOwner(AGENT_SPEC_PATH),
      loadConfig("devcanon.config.yaml", true),
    ]);
    const ownerSources = await readRouteOwnerSources(owner);

    expect(
      routeOwnerContractErrors(owner, roles, config, ownerSources),
    ).toEqual([]);
  });

  it("rejects single-dimension route-owner spawn and continuity drift", async () => {
    const [owner, roles, config] = await Promise.all([
      readAgentRoutingPolicyOwner(OWNER_PATH),
      readAgentSemanticRoleOwner(AGENT_SPEC_PATH),
      loadConfig("devcanon.config.yaml", true),
    ]);
    const ownerSources = await readRouteOwnerSources(owner);

    expect(
      routeOwnerContractErrors(owner, roles, config, {
        ...ownerSources,
        "issue-priming-workflow": ownerSources[
          "issue-priming-workflow"
        ].replace('fork_turns: "none",', ""),
      }),
    ).toContain("D1:fork_turns");
    expect(
      routeOwnerContractErrors(owner, roles, config, {
        ...ownerSources,
        "play-subagent-execution": ownerSources[
          "play-subagent-execution"
        ].replace(
          "message; do not\nsubstitute",
          "message; model: OVERRIDE; do not\nsubstitute",
        ),
      }),
    ).toContain("D12:followup-override");
    expect(
      routeOwnerContractErrors(owner, roles, config, {
        ...ownerSources,
        "play-subagent-execution": ownerSources[
          "play-subagent-execution"
        ].replace("use the lifecycle fresh-child path", "continue in place"),
      }),
    ).toContain("D16:changed-tuple-fresh");
    expect(
      routeOwnerContractErrors(owner, roles, config, {
        "play-agent-dispatch": ownerSources["play-agent-dispatch"].replace(
          "Do not retry, alias, alter effort,\nescalate, or substitute a role.",
          "Retry with a fallback alias.",
        ),
      }),
    ).toContain("D4:rejection");
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

  it("rejects an unknown D13 operand", async () => {
    const { markdown, sourceSkills } = await ownerInputs();
    const mutated = mutateRouteRow(markdown, "D13", (cells) => {
      cells[2] = cells[2].replace("selection-mode", "dispatch-mode");
      return cells;
    });

    expect(() => parseAgentRoutingPolicyOwner(mutated, sourceSkills)).toThrow(
      /direct-route D13 operand key is unknown: dispatch-mode/i,
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
        /semantic-role route effort/i,
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

function representativeOwnerErrors(
  markdown: string,
  sourceSkills: readonly string[],
): string[] {
  const owner = parseAgentRoutingPolicyOwner(markdown, sourceSkills);
  const d3 = owner.directChildRoutes.find((route) => route.id === "D3");
  const errors: string[] = [];
  if (d3?.clauses[0]?.evidenceQualifier !== "named-network") {
    errors.push("D3:evidence-qualifier");
  }
  if (
    !markdownLinkTargets(markdown).includes(
      "../../skills/subagent-lifecycle/SKILL.md",
    )
  ) {
    errors.push("shared-owner-reference");
  }
  return errors;
}

function markdownLinkTargets(markdown: string): string[] {
  return [...markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(
    (match) => match[1],
  );
}

function resolveFreshCodexModel(
  source: SemanticAgentSource,
  capabilityProfiles: Awaited<
    ReturnType<typeof loadConfig>
  >["capabilityProfiles"],
): string | undefined {
  return resolveCapabilityModel(
    undefined,
    source.capability as "efficient" | "balanced" | "frontier" | undefined,
    "codex",
    capabilityProfiles,
  );
}

async function readRouteOwnerSources(
  owner: Awaited<ReturnType<typeof readAgentRoutingPolicyOwner>>,
): Promise<Record<string, string>> {
  const ownerSkills = new Set(
    owner.directChildRoutes.map((route) => route.ownerSkill),
  );
  const entries = await Promise.all(
    [...ownerSkills].map(async (ownerSkill) => [
      ownerSkill,
      await readRepoFile(`skills/${ownerSkill}/SKILL.md`),
    ]),
  );
  return Object.fromEntries(entries);
}

function routeOwnerContractErrors(
  owner: Awaited<ReturnType<typeof readAgentRoutingPolicyOwner>>,
  roles: Awaited<ReturnType<typeof readAgentSemanticRoleOwner>>,
  config: Awaited<ReturnType<typeof loadConfig>>,
  ownerSources: Record<string, string>,
): string[] {
  const errors: string[] = [];
  const rolesByName = new Map(roles.map((role) => [role.name, role]));

  for (const route of owner.directChildRoutes) {
    const source = ownerSources[route.ownerSkill];
    if (!source) {
      errors.push(`${route.id}:owner-source`);
      continue;
    }

    if (route.id === "D4") {
      for (const role of roles) {
        if (
          resolveFreshCodexModel(
            { capability: role.capability },
            config.capabilityProfiles,
          ) !== config.capabilityProfiles[role.capability].codex
        ) {
          errors.push(`D4:${role.name}:model`);
        }
        if (
          !routeSpawnFieldsPresent(source, "D4", role.name, role.routeEffort)
        ) {
          errors.push(`D4:${role.name}:spawn`);
        }
      }
      const evidence = routeEvidenceWindow(source, "D4", "SELECTED_ROLE_ID");
      if (!evidence?.includes("capabilityProfiles.<capability>.codex")) {
        errors.push("D4:capability-model");
      }
      if (
        !evidence?.includes(
          "selected source capability to match the selected semantic role",
        )
      ) {
        errors.push("D4:source-capability-parity");
      }
      if (
        !evidence?.includes(
          "matching Codex effort from the semantic-role catalog",
        )
      ) {
        errors.push("D4:catalog-effort");
      }
      if (!routeContextPresent(evidence ?? "")) errors.push("D4:context");
      if (!routePrevalidates(evidence ?? "")) errors.push("D4:prevalidation");
      if (!routeFailClosed(evidence ?? "")) errors.push("D4:rejection");
      continue;
    }

    for (const clause of route.clauses) {
      const role = rolesByName.get(clause.role);
      if (!role) {
        errors.push(`${route.id}:role`);
        continue;
      }
      if (
        role.capability !== clause.capability ||
        role.routeEffort !== clause.effort ||
        role.sourceAuthority !== clause.sourceAuthority
      ) {
        errors.push(`${route.id}:tuple`);
      }
      if (!config.capabilityProfiles[clause.capability].codex) {
        errors.push(`${route.id}:configured-model`);
      }
      if (
        !routeSpawnFieldsPresent(source, route.id, clause.role, clause.effort)
      ) {
        for (const field of [
          "task_name",
          "agent_type",
          "model",
          "reasoning_effort",
          "fork_turns",
          "message",
        ]) {
          if (!routeSpawnFieldPresent(source, route.id, clause.role, field)) {
            errors.push(`${route.id}:${field}`);
          }
        }
      }
      const evidence = routeEvidenceWindow(source, route.id, clause.role);
      if (
        !evidence?.includes(`capabilityProfiles.${clause.capability}.codex`)
      ) {
        errors.push(`${route.id}:capability-model`);
      }
      if (!routeContextPresent(evidence ?? ""))
        errors.push(`${route.id}:context`);
      if (!routePrevalidates(evidence ?? "")) {
        errors.push(`${route.id}:prevalidation`);
      }
      if (!routeFailClosed(evidence ?? ""))
        errors.push(`${route.id}:rejection`);
    }
  }

  const execution = ownerSources["play-subagent-execution"];
  if (
    !execution?.includes(
      "only in the incremental task-local `followup_task` message; do not\nsubstitute",
    )
  ) {
    errors.push("D12:followup-override");
  }
  if (
    !execution?.includes(
      "D13-to-D12 reclassification and a D16 final\nwhole-implementation fix use the lifecycle fresh-child path",
    )
  ) {
    errors.push("D16:changed-tuple-fresh");
  }
  if (!execution?.includes("D14/D15 are\nalways fresh one-shot reviewers")) {
    errors.push("D14-D15:one-shot");
  }
  const merge = ownerSources["pr-merge"];
  if (
    !merge?.includes(
      "diagnosis-to-fix classification is a fresh changed\ntuple",
    )
  ) {
    errors.push("D17:changed-tuple-fresh");
  }
  return errors;
}

function routeSpawnFieldsPresent(
  source: string,
  routeId: `D${number}`,
  role: string,
  effort: string,
): boolean {
  return [
    "task_name",
    "agent_type",
    "model",
    "reasoning_effort",
    "fork_turns",
    "message",
  ].every((field) =>
    routeSpawnFieldPresent(source, routeId, role, field, effort),
  );
}

function routeSpawnFieldPresent(
  source: string,
  routeId: `D${number}` | "D4",
  role: string,
  field: string,
  effort?: string,
): boolean {
  const match = spawnWindow(source, routeId, role);
  if (!match) return false;
  const expected = {
    task_name: `task_name: ${routeId.toLowerCase()}_<instance_ordinal>`,
    agent_type: `agent_type: ${routeId === "D4" ? "SELECTED_ROLE_ID" : `"${role}"`}`,
    model: "model:",
    reasoning_effort:
      routeId === "D4"
        ? "reasoning_effort: SELECTED_CODEX_EFFORT"
        : `reasoning_effort: "${effort}"`,
    fork_turns: 'fork_turns: "none"',
    message: "message:",
  }[field];
  return expected !== undefined && match.includes(expected);
}

function spawnWindow(
  source: string,
  routeId: `D${number}` | "D4",
  role: string,
): string | undefined {
  const taskName = `task_name: ${routeId.toLowerCase()}_<instance_ordinal>`;
  let start = source.indexOf(taskName);
  while (start !== -1) {
    const end = source.indexOf("})", start);
    const window = source.slice(start, end === -1 ? undefined : end + 2);
    if (
      window.includes(
        `agent_type: ${routeId === "D4" ? "SELECTED_ROLE_ID" : `"${role}"`}`,
      )
    ) {
      return window;
    }
    start = source.indexOf(taskName, start + taskName.length);
  }
  return undefined;
}

function routeEvidenceWindow(
  source: string,
  routeId: `D${number}` | "D4",
  role: string,
): string | undefined {
  const spawn = spawnWindow(source, routeId, role);
  if (!spawn) return undefined;

  const start = source.indexOf(spawn);
  return source.slice(
    Math.max(0, start - 5_000),
    Math.min(source.length, start + spawn.length + 8_000),
  );
}

function routeFailClosed(source: string): boolean {
  return (
    /(?:native Codex (?:rejects|rejection)|target rejection|Native rejection)/i.test(
      source,
    ) && /(?:Do not\s+retry|without\s+substitution)/i.test(source)
  );
}

function routePrevalidates(source: string): boolean {
  return /(?:missing|mismatched)[\s\S]{0,160}(?:blocks|block|prevents)/i.test(
    source,
  );
}

function routeContextPresent(source: string): boolean {
  return /(?:self-contained|fully substituted|complete prompt|independently substituted template)/i.test(
    source,
  );
}
