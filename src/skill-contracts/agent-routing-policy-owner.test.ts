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

  it("keeps the D12 continuity call configuration-free", async () => {
    const continuity = await readRepoFile(
      "skills/play-subagent-execution/references/lifecycle-status-policy.md",
    );

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
  });

  it("links every consuming route owner to the shared dispatch-ritual reference", async () => {
    const REFERENCE_PATH =
      "skills/play-agent-dispatch/references/dispatch-ritual-usage.md";
    const OWNER_LINK = /\[[^\]]+\]\(references\/dispatch-ritual-usage\.md\)/u;
    const CONSUMER_LINK =
      /\[[^\]]+\]\(\.\.\/play-agent-dispatch\/references\/dispatch-ritual-usage\.md\)/u;
    const consumingSkills = [
      "issue-priming-workflow",
      "play-planning",
      "play-review",
      "play-skill-authoring",
      "play-subagent-execution",
      "pr-merge",
    ] as const;
    const reference = await lstat(REFERENCE_PATH);
    const sources = await Promise.all(
      ["play-agent-dispatch", ...consumingSkills].map(
        async (skill) =>
          [skill, await readRepoFile(`skills/${skill}/SKILL.md`)] as const,
      ),
    );

    expect(reference.isFile(), "dispatch ritual reference is a file").toBe(
      true,
    );
    for (const [skill, source] of sources) {
      const link = skill === "play-agent-dispatch" ? OWNER_LINK : CONSUMER_LINK;
      expect(source, `${skill} links the shared dispatch ritual`).toMatch(link);
    }
  });
});
