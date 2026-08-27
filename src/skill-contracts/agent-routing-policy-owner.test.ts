import { lstat, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  readAgentRoutingPolicyOwner,
  readAgentSemanticRoleOwner,
} from "../__test-helpers__/agent-routing-policy.js";
import { readRepoFile } from "../__test-helpers__/skill-contracts.js";
import { loadConfig } from "../config/load.js";

const OWNER_PATH = "docs/guidelines/agent-routing-and-mutation-policy.md";
const AGENT_SPEC_PATH = "docs/specs/agents.md";

const FIXED_ROUTE_OWNER_INVENTORY = [
  ["D1", "Issue gate — `issue-priming-workflow` Phase 2"],
  ["D2", "Internal research — `issue-priming-workflow` Phase 3"],
  ["D3", "External research — `issue-priming-workflow` Phase 3"],
  ["D4", "Focused specialist — `play-agent-dispatch`"],
  ["D5", "Plan review — `play-planning`"],
  ["D6", "Executability review — `play-planning`"],
  ["D7", "Code-quality topical — `play-review` Phase 3"],
  ["D8", "Architecture topical — `play-review` Phase 3"],
  ["D9", "Spec topical — `play-review` Phase 3"],
  ["D10", "Critic — `play-review` Phase 5"],
  ["D11", "Skill pressure scenario — `play-skill-authoring`"],
  ["D12", "Default implementation — `play-subagent-execution`"],
  ["D13", "Exact task — `play-subagent-execution`"],
  ["D14", "Per-task spec review — `play-subagent-execution` review routing"],
  ["D15", "Per-task quality review — `play-subagent-execution` review routing"],
  [
    "D16",
    "Final whole-implementation quality review — `play-subagent-execution` Process step 10",
  ],
  ["D17", "CI diagnosis/fix — `pr-merge` Step 4"],
  ["D18", "Semantic review context — `play-review` Phase 2.25"],
] as const;

const D17_BRANCH_BY_MODEL = {
  D17_DIAGNOSIS_MODEL: "diagnosis",
  D17_EXACT_FIX_MODEL: "exact-fix",
  D17_JUDGMENT_FIX_MODEL: "judgment-fix",
} as const;

const FRESH_SPAWNS = [
  [
    "D1",
    "issue-priming-workflow",
    "assessor",
    "balanced",
    "D1_MODEL",
    "medium",
    "source-immutable",
    "D1_PROMPT",
  ],
  [
    "D2",
    "issue-priming-workflow",
    "investigator",
    "balanced",
    "D2_MODEL",
    "high",
    "source-immutable",
    "D2_PROMPT",
  ],
  [
    "D3",
    "issue-priming-workflow",
    "investigator",
    "balanced",
    "D3_MODEL",
    "high",
    "source-immutable",
    "D3_PROMPT",
  ],
  [
    "D5",
    "play-planning",
    "reviewer",
    "frontier",
    "D5_MODEL",
    "high",
    "source-immutable",
    "D5_PLAN_REVIEW_PROMPT",
  ],
  [
    "D6",
    "play-planning",
    "reviewer",
    "frontier",
    "D6_MODEL",
    "high",
    "source-immutable",
    "D6_EXECUTABILITY_REVIEW_PROMPT",
  ],
  [
    "D7",
    "play-review",
    "reviewer",
    "frontier",
    "D7_MODEL",
    "high",
    "source-immutable",
    "D7_PROMPT",
  ],
  [
    "D8",
    "play-review",
    "reviewer",
    "frontier",
    "D8_MODEL",
    "high",
    "source-immutable",
    "D8_PROMPT",
  ],
  [
    "D9",
    "play-review",
    "reviewer",
    "frontier",
    "D9_MODEL",
    "high",
    "source-immutable",
    "D9_PROMPT",
  ],
  [
    "D10",
    "play-review",
    "reviewer",
    "frontier",
    "D10_MODEL",
    "high",
    "source-immutable",
    "D10_CRITIC_PROMPT",
  ],
  [
    "D11",
    "play-skill-authoring",
    "assessor",
    "balanced",
    "D11_MODEL",
    "medium",
    "source-immutable",
    "D11_SCENARIO_PROMPT",
  ],
  [
    "D12",
    "play-subagent-execution",
    "implementer",
    "balanced",
    "D12_MODEL",
    "high",
    "source-mutable",
    "D12_SELF_CONTAINED_PROMPT",
  ],
  [
    "D13",
    "play-subagent-execution",
    "executor",
    "efficient",
    "D13_MODEL",
    "medium",
    "source-mutable",
    "D13_SELF_CONTAINED_PROMPT",
  ],
  [
    "D14",
    "play-subagent-execution",
    "deep-reviewer",
    "frontier",
    "D14_MODEL",
    "xhigh",
    "source-immutable",
    "D14_SELF_CONTAINED_PROMPT",
  ],
  [
    "D15",
    "play-subagent-execution",
    "deep-reviewer",
    "frontier",
    "D15_MODEL",
    "xhigh",
    "source-immutable",
    "D15_SELF_CONTAINED_PROMPT",
  ],
  [
    "D16",
    "play-subagent-execution",
    "deep-reviewer",
    "frontier",
    "D16_MODEL",
    "xhigh",
    "source-immutable",
    "D16_SELF_CONTAINED_PROMPT",
  ],
  [
    "D17",
    "pr-merge",
    "investigator",
    "balanced",
    "D17_DIAGNOSIS_MODEL",
    "high",
    "source-immutable",
    "D17_DIAGNOSIS_SELF_CONTAINED_PROMPT",
  ],
  [
    "D17",
    "pr-merge",
    "executor",
    "efficient",
    "D17_EXACT_FIX_MODEL",
    "medium",
    "source-mutable",
    "D17_EXACT_FIX_SELF_CONTAINED_PROMPT",
  ],
  [
    "D17",
    "pr-merge",
    "implementer",
    "balanced",
    "D17_JUDGMENT_FIX_MODEL",
    "high",
    "source-mutable",
    "D17_JUDGMENT_FIX_SELF_CONTAINED_PROMPT",
  ],
  [
    "D18",
    "play-review",
    "assessor",
    "balanced",
    "D18_MODEL",
    "medium",
    "source-immutable",
    "D18_SEMANTIC_CONTEXT_PROMPT",
  ],
] as const;

describe("agent routing and mutation policy owner", () => {
  it("keeps a literal D1-D18 route-owner inventory", async () => {
    const source = await readRepoFile(OWNER_PATH);
    const routeSection = source
      .split("## Direct-Child Route Inventory", 2)[1]
      ?.split("## Capability Escalation Adoption Inventory", 1)[0];
    expect(routeSection).toBeDefined();
    const rows = new Map(
      (routeSection ?? "")
        .split("\n")
        .filter((line) => /^\| D\d+\s+\|/u.test(line))
        .map((line) => {
          const cells = line
            .split("|")
            .slice(1, -1)
            .map((cell) => cell.trim());
          return [cells[0], cells[1]] as const;
        }),
    );

    expect(FIXED_ROUTE_OWNER_INVENTORY.map(([id]) => id)).toEqual(
      Array.from({ length: 18 }, (_, index) => `D${index + 1}`),
    );
    for (const [id, surfaceAndOwner] of FIXED_ROUTE_OWNER_INVENTORY) {
      expect(rows.get(id), `${id} exact surface and owner`).toBe(
        surfaceAndOwner,
      );
    }
  });

  it("parses the complete skill and D1-D18 route inventories", async () => {
    const [owner, sourceSkills] = await Promise.all([
      readAgentRoutingPolicyOwner(OWNER_PATH),
      readdir("skills", { withFileTypes: true }).then((entries) =>
        Promise.all(
          entries
            .filter((entry) => entry.isDirectory())
            .map(async (entry) => {
              try {
                return (await lstat(`skills/${entry.name}/SKILL.md`)).isFile()
                  ? entry.name
                  : null;
              } catch {
                return null;
              }
            }),
        ).then((names) =>
          names.filter((name): name is string => name !== null).sort(),
        ),
      ),
    ]);

    expect(owner.inventory.map((row) => row.skill).sort()).toEqual(
      sourceSkills,
    );
    expect(owner.directChildRoutes.map((row) => row.id)).toEqual(
      Array.from({ length: 18 }, (_, index) => `D${index + 1}`),
    );
    expect(owner.escalationAdoptionInventory).toEqual(
      Array.from({ length: 18 }, (_, index) => ({
        id: `D${index + 1}`,
        state: "opt-out",
        transition: "none",
      })),
    );
  });

  it("reconciles every policy route to its semantic role capability, effort, and authority", async () => {
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

  it("correlates every fixed D1-D18 policy clause to its exact fresh Codex tuple", async () => {
    const [owner, config] = await Promise.all([
      readAgentRoutingPolicyOwner(OWNER_PATH),
      loadConfig("devcanon.config.yaml", true),
    ]);
    const ownerSkills = new Map(
      await Promise.all(
        [...new Set(FRESH_SPAWNS.map(([, ownerSkill]) => ownerSkill))].map(
          async (ownerSkill) =>
            [
              ownerSkill,
              await readRepoFile(`skills/${ownerSkill}/SKILL.md`),
            ] as const,
        ),
      ),
    );

    for (const [
      id,
      ownerSkill,
      role,
      capability,
      model,
      effort,
      sourceAuthority,
      message,
    ] of FRESH_SPAWNS) {
      const route = owner.directChildRoutes.find(
        (candidate) => candidate.id === id,
      );
      expect(route, `${id} policy route is present`).toBeDefined();
      expect(route?.ownerSkill, `${id} has its canonical owner`).toBe(
        ownerSkill,
      );
      const matchingClauses = route?.clauses.filter(
        (clause) =>
          clause.role === role &&
          clause.capability === capability &&
          clause.effort === effort &&
          clause.sourceAuthority === sourceAuthority &&
          (id !== "D17" ||
            clause.branchId ===
              D17_BRANCH_BY_MODEL[model as keyof typeof D17_BRANCH_BY_MODEL]),
      );
      expect(
        matchingClauses,
        `${id} ${role} policy clause matches its fixed spawn tuple`,
      ).toHaveLength(1);

      const source = ownerSkills.get(ownerSkill);
      expect(source, `${ownerSkill} source is readable`).toBeDefined();
      expect(source?.replace(/\s+/gu, " ")).toContain(
        `\`${model}\` = \`{{model-codex:${capability}}}\``,
      );
      expect(config.capabilityProfiles[capability].codex).toMatch(/\S/);
      expect(source).toContain(
        [
          "Codex.spawn_agent({",
          `  task_name: ${id.toLowerCase()}_<instance_ordinal>,`,
          `  agent_type: \"${role}\",`,
          `  model: ${model},`,
          `  reasoning_effort: \"${effort}\",`,
          '  fork_turns: "none",',
          `  message: ${message},`,
          "})",
        ].join("\n"),
      );
    }
  });

  it("keeps every D1-D18 model source Codex-bound and checkout-independent", async () => {
    const ownerSkills = [
      [
        "issue-priming-workflow",
        "A missing, blank, unresolved, or mismatched marker blocks before capture or spawn. Do not search a source checkout, use an alias, or fall back to a nearby or ambient model.",
      ],
      [
        "play-agent-dispatch",
        "A missing, blank, unresolved, or mismatched binding blocks before spawn. Do not search a source checkout, use a sibling runtime when a rendered binding owns this field, or select an alias, nearby, or ambient model.",
      ],
      [
        "play-planning",
        "A missing, blank, unresolved, or mismatched marker blocks before capture or spawn. Do not search a source checkout, use an alias, or fall back to a nearby or ambient model.",
      ],
      [
        "play-review",
        "A missing, blank, unresolved, or mismatched marker blocks before capture or spawn. Do not search a source checkout, use an alias, or fall back to a nearby or ambient model.",
      ],
      [
        "play-skill-authoring",
        "A missing, blank, unresolved, or mismatched marker blocks before capture or spawn. Do not search a source checkout, use an alias, or fall back to a nearby or ambient model.",
      ],
      [
        "play-subagent-execution",
        "A missing, blank, unresolved, or mismatched marker blocks before capture or spawn. Do not search a source checkout, use an alias, or fall back to a nearby or ambient model.",
      ],
      [
        "pr-merge",
        "A missing, blank, unresolved, or mismatched marker blocks before capture or spawn. Do not search a source checkout, use an alias, or fall back to a nearby or ambient model.",
      ],
    ] as const;
    const sources = await Promise.all(
      ownerSkills.map(
        async ([skill, failClosed]) =>
          [
            skill,
            failClosed,
            await readRepoFile(`skills/${skill}/SKILL.md`),
          ] as const,
      ),
    );

    for (const [skill, failClosed, source] of sources) {
      expect(
        source,
        `${skill} never discovers an original checkout config`,
      ).not.toContain("devcanon.config.yaml");
      expect(
        source,
        `${skill} never uses symbolic capability profiles`,
      ).not.toContain("capabilityProfiles.");
      expect(
        source.replace(/\s+/gu, " "),
        `${skill} fail-closes model resolution`,
      ).toContain(failClosed);
    }
  });

  it("keeps D4 as the existing dynamic exact-configured-role contract", async () => {
    const [owner, source, roles] = await Promise.all([
      readAgentRoutingPolicyOwner(OWNER_PATH),
      readRepoFile("skills/play-agent-dispatch/SKILL.md"),
      readAgentSemanticRoleOwner(AGENT_SPEC_PATH),
    ]);
    const d4 = owner.directChildRoutes.find((route) => route.id === "D4");

    expect(d4?.ownerSkill).toBe("play-agent-dispatch");
    expect(d4?.clauses).toEqual([]);
    expect(d4?.d4Contract).toMatchObject({
      roleCardinality: 6,
      selectionTiming: "before spawn",
      configuration: "exact configured capability/effort",
      sourceDefault: "matching source default",
      scopeAndTermination: "scope/termination",
      externalAuthority: "none",
    });
    expect(roles).toHaveLength(6);
    for (const { capability } of roles) {
      expect(source.replace(/\s+/gu, " ")).toContain(
        `\`${capability}\` → \`{{model-codex:${capability}}}\``,
      );
    }
    expect(source).toContain(
      [
        "Codex.spawn_agent({",
        "  task_name: d4_<instance_ordinal>,",
        "  agent_type: SELECTED_ROLE_ID,",
        "  model: RESOLVED_CODEX_MODEL,",
        "  reasoning_effort: SELECTED_CODEX_EFFORT,",
        '  fork_turns: "none",',
        "  message: SELF_CONTAINED_PROMPT,",
        "})",
      ].join("\n"),
    );
  });

  it("keeps unchanged D12 continuity configuration-free and routes changed tuples to fresh children", async () => {
    const [continuity, execution, merge] = await Promise.all([
      readRepoFile(
        "skills/play-subagent-execution/references/lifecycle-status-policy.md",
      ),
      readRepoFile("skills/play-subagent-execution/SKILL.md"),
      readRepoFile("skills/pr-merge/SKILL.md"),
    ]);

    const followupStart = continuity.indexOf("Codex.followup_task({");
    expect(
      followupStart,
      "D12 lifecycle follow-up anchor is present",
    ).toBeGreaterThanOrEqual(0);
    const followupEnd = continuity.indexOf("\n})", followupStart);
    expect(
      followupEnd,
      "D12 lifecycle follow-up terminator is present",
    ).toBeGreaterThan(followupStart);
    expect(continuity.slice(followupStart, followupEnd + 3)).toBe(
      [
        "Codex.followup_task({",
        "  target: D12_STABLE_SESSION_ID,",
        "  message: D12_INCREMENTAL_FINDINGS_AND_TASK_CONTEXT_PLUS_VERIFIED_AUTO_ROUTE_ATTESTATION_WHEN_APPLICABLE,",
        "})",
      ].join("\n"),
    );
    expect(continuity).toContain(
      "D13-to-D12 reclassification and a\nD16 final whole-implementation fix instead use the shared fresh-child lifecycle\npath.",
    );
    expect(execution).toContain(
      "D13-to-D12 reclassification and a D16 final\nwhole-implementation fix use the lifecycle fresh-child path.",
    );
    expect(merge).toContain(
      "diagnosis-to-fix classification is a fresh changed\ntuple.",
    );
  });
});
