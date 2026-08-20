import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  readAgentRoutingPolicyOwner,
  readAgentSemanticRoleOwner,
} from "../__test-helpers__/agent-routing-policy.js";
import { readRepoFile } from "../__test-helpers__/skill-contracts.js";
import { loadConfig } from "../config/load.js";

const OWNER_PATH = "docs/guidelines/agent-routing-and-mutation-policy.md";
const AGENT_SPEC_PATH = "docs/specs/agents.md";

const FRESH_SPAWNS = [
  [
    "D1",
    "issue-priming-workflow",
    "assessor",
    "D1_MODEL",
    "medium",
    "D1_PROMPT",
  ],
  [
    "D2",
    "issue-priming-workflow",
    "investigator",
    "D2_MODEL",
    "high",
    "D2_PROMPT",
  ],
  [
    "D3",
    "issue-priming-workflow",
    "investigator",
    "D3_MODEL",
    "high",
    "D3_PROMPT",
  ],
  [
    "D4",
    "play-agent-dispatch",
    "SELECTED_ROLE_ID",
    "RESOLVED_CODEX_MODEL",
    "SELECTED_CODEX_EFFORT",
    "SELF_CONTAINED_PROMPT",
  ],
  [
    "D5",
    "play-planning",
    "reviewer",
    "D5_MODEL",
    "high",
    "D5_PLAN_REVIEW_PROMPT",
  ],
  [
    "D6",
    "play-planning",
    "reviewer",
    "D6_MODEL",
    "high",
    "D6_EXECUTABILITY_REVIEW_PROMPT",
  ],
  ["D7", "play-review", "reviewer", "D7_MODEL", "high", "D7_PROMPT"],
  ["D8", "play-review", "reviewer", "D8_MODEL", "high", "D8_PROMPT"],
  ["D9", "play-review", "reviewer", "D9_MODEL", "high", "D9_PROMPT"],
  [
    "D10",
    "play-review",
    "deep-reviewer",
    "D10_MODEL",
    "xhigh",
    "D10_CRITIC_PROMPT",
  ],
  [
    "D11",
    "play-skill-authoring",
    "assessor",
    "D11_MODEL",
    "medium",
    "D11_SCENARIO_PROMPT",
  ],
  [
    "D12",
    "play-subagent-execution",
    "implementer",
    "D12_MODEL",
    "high",
    "D12_SELF_CONTAINED_PROMPT",
  ],
  [
    "D13",
    "play-subagent-execution",
    "executor",
    "D13_MODEL",
    "medium",
    "D13_SELF_CONTAINED_PROMPT",
  ],
  [
    "D14",
    "play-subagent-execution",
    "deep-reviewer",
    "D14_MODEL",
    "xhigh",
    "D14_SELF_CONTAINED_PROMPT",
  ],
  [
    "D15",
    "play-subagent-execution",
    "deep-reviewer",
    "D15_MODEL",
    "xhigh",
    "D15_SELF_CONTAINED_PROMPT",
  ],
  [
    "D16",
    "play-subagent-execution",
    "deep-reviewer",
    "D16_MODEL",
    "xhigh",
    "D16_SELF_CONTAINED_PROMPT",
  ],
  [
    "D17",
    "pr-merge",
    "investigator",
    "D17_DIAGNOSIS_MODEL, # capabilityProfiles.balanced.codex",
    "high",
    "D17_DIAGNOSIS_SELF_CONTAINED_PROMPT",
  ],
  [
    "D17",
    "pr-merge",
    "executor",
    "D17_EXACT_FIX_MODEL, # capabilityProfiles.efficient.codex",
    "medium",
    "D17_EXACT_FIX_SELF_CONTAINED_PROMPT",
  ],
  [
    "D17",
    "pr-merge",
    "implementer",
    "D17_JUDGMENT_FIX_MODEL, # capabilityProfiles.balanced.codex",
    "high",
    "D17_JUDGMENT_FIX_SELF_CONTAINED_PROMPT",
  ],
] as const;

describe("agent routing and mutation policy owner", () => {
  it("parses the complete skill and D1-D17 route inventories", async () => {
    const [owner, sourceSkills] = await Promise.all([
      readAgentRoutingPolicyOwner(OWNER_PATH),
      readdir("skills", { withFileTypes: true }).then((entries) =>
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort(),
      ),
    ]);

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

  it("declares the concrete fresh Codex tuple for every D1-D17 spawn", async () => {
    const owner = await readAgentRoutingPolicyOwner(OWNER_PATH);
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

    for (const [id, ownerSkill, role, model, effort, message] of FRESH_SPAWNS) {
      const route = owner.directChildRoutes.find(
        (candidate) => candidate.id === id,
      );
      expect(route, `${id} policy route is present`).toBeDefined();
      expect(route?.ownerSkill, `${id} has its canonical owner`).toBe(
        ownerSkill,
      );

      const source = ownerSkills.get(ownerSkill);
      expect(source, `${ownerSkill} source is readable`).toBeDefined();
      const d4Template = id === "D4";
      expect(source).toContain(
        [
          "Codex.spawn_agent({",
          `  task_name: ${id.toLowerCase()}_<instance_ordinal>,`,
          `  agent_type: ${d4Template ? role : `\"${role}\"`},`,
          `  model: ${model}${id === "D17" ? "" : ","}`,
          `  reasoning_effort: ${d4Template ? effort : `\"${effort}\"`},`,
          '  fork_turns: "none",',
          `  message: ${message},`,
          "})",
        ].join("\n"),
      );
    }
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
