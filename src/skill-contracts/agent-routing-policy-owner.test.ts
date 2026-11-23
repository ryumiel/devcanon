import { lstat, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  parseAgentRoutingPolicyOwner,
  readAgentRoutingPolicyOwner,
  readAgentSemanticRoleOwner,
} from "../__test-helpers__/agent-routing-policy.js";
import { readRepoFile } from "../__test-helpers__/skill-contracts.js";
import { loadConfig } from "../config/load.js";

const OWNER_PATH = "docs/guidelines/agent-routing-and-mutation-policy.md";
const AGENT_SPEC_PATH = "docs/specs/agents.md";

const CI_BRANCH_BY_MODEL = {
  CI_DIAGNOSIS_MODEL: "diagnosis",
  CI_EXACT_FIX_MODEL: "exact-fix",
  CI_JUDGMENT_FIX_MODEL: "judgment-fix",
} as const;

const ISSUE_PRIMING_GATE = "phase-2-complexity-gate.md";
const ISSUE_PRIMING_RESEARCH = "phase-3-research-controller.md";
const ISSUE_PRIMING_SPAWN_PROCEDURES = new Map([
  ["issue-gate-assessment", ISSUE_PRIMING_GATE],
  ["internal-research", ISSUE_PRIMING_RESEARCH],
  ["external-research", ISSUE_PRIMING_RESEARCH],
]);

const FRESH_SPAWNS = [
  [
    "issue-gate-assessment",
    "issue-priming-workflow",
    "assessor",
    "balanced",
    "ISSUE_GATE_ASSESSMENT_MODEL",
    "low",
    "source-immutable",
    "ISSUE_GATE_ASSESSMENT_PROMPT",
  ],
  [
    "internal-research",
    "issue-priming-workflow",
    "investigator",
    "balanced",
    "INTERNAL_RESEARCH_MODEL",
    "medium",
    "source-immutable",
    "INTERNAL_RESEARCH_PROMPT",
  ],
  [
    "external-research",
    "issue-priming-workflow",
    "investigator",
    "balanced",
    "EXTERNAL_RESEARCH_MODEL",
    "medium",
    "source-immutable",
    "EXTERNAL_RESEARCH_PROMPT",
  ],
  [
    "combined-planning-review",
    "play-planning",
    "reviewer",
    "frontier",
    "COMBINED_PLANNING_REVIEW_MODEL",
    "high",
    "source-immutable",
    "COMBINED_PLANNING_REVIEW_PLAN_REVIEW_PROMPT",
  ],
  [
    "independent-review",
    "play-review",
    "reviewer",
    "frontier",
    "INDEPENDENT_REVIEW_MODEL",
    "high",
    "source-immutable",
    "INDEPENDENT_REVIEW_PROMPT",
  ],
  [
    "targeted-verification",
    "play-review",
    "reviewer",
    "frontier",
    "TARGETED_VERIFICATION_MODEL",
    "high",
    "source-immutable",
    "TARGETED_VERIFICATION_CRITIC_PROMPT",
  ],
  [
    "skill-pressure-scenario",
    "play-skill-authoring",
    "assessor",
    "balanced",
    "SKILL_PRESSURE_SCENARIO_MODEL",
    "low",
    "source-immutable",
    "SKILL_PRESSURE_SCENARIO_SCENARIO_PROMPT",
  ],
  [
    "default-implementation",
    "play-subagent-execution",
    "implementer",
    "balanced",
    "DEFAULT_IMPLEMENTATION_MODEL",
    "medium",
    "source-mutable",
    "DEFAULT_IMPLEMENTATION_SELF_CONTAINED_PROMPT",
  ],
  [
    "exact-task-execution",
    "play-subagent-execution",
    "executor",
    "efficient",
    "EXACT_TASK_EXECUTION_MODEL",
    "medium",
    "source-mutable",
    "EXACT_TASK_EXECUTION_SELF_CONTAINED_PROMPT",
  ],
  [
    "task-spec-review",
    "play-subagent-execution",
    "reviewer",
    "frontier",
    "TASK_SPEC_REVIEW_MODEL",
    "high",
    "source-immutable",
    "TASK_SPEC_REVIEW_SELF_CONTAINED_PROMPT",
  ],
  [
    "task-quality-review",
    "play-subagent-execution",
    "reviewer",
    "frontier",
    "TASK_QUALITY_REVIEW_MODEL",
    "high",
    "source-immutable",
    "TASK_QUALITY_REVIEW_SELF_CONTAINED_PROMPT",
  ],
  [
    "whole-implementation-quality-review",
    "play-subagent-execution",
    "reviewer",
    "frontier",
    "WHOLE_IMPLEMENTATION_QUALITY_REVIEW_MODEL",
    "high",
    "source-immutable",
    "WHOLE_IMPLEMENTATION_QUALITY_REVIEW_SELF_CONTAINED_PROMPT",
  ],
  [
    "ci-diagnosis-and-fix",
    "pr-merge",
    "investigator",
    "balanced",
    "CI_DIAGNOSIS_MODEL",
    "medium",
    "source-immutable",
    "CI_DIAGNOSIS_SELF_CONTAINED_PROMPT",
  ],
  [
    "ci-diagnosis-and-fix",
    "pr-merge",
    "executor",
    "efficient",
    "CI_EXACT_FIX_MODEL",
    "medium",
    "source-mutable",
    "CI_EXACT_FIX_SELF_CONTAINED_PROMPT",
  ],
  [
    "ci-diagnosis-and-fix",
    "pr-merge",
    "implementer",
    "balanced",
    "CI_JUDGMENT_FIX_MODEL",
    "medium",
    "source-mutable",
    "CI_JUDGMENT_FIX_SELF_CONTAINED_PROMPT",
  ],
  [
    "semantic-review-context",
    "play-review",
    "assessor",
    "balanced",
    "SEMANTIC_REVIEW_CONTEXT_MODEL",
    "low",
    "source-immutable",
    "SEMANTIC_REVIEW_CONTEXT_PROMPT",
  ],
] as const;

describe("agent routing and mutation policy owner", () => {
  it("parses the complete skill and active route set route inventories", async () => {
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
    expect(
      owner.directChildRoutes.map(({ id, displayName }) => [id, displayName]),
    ).toEqual([
      ["issue-gate-assessment", "Issue gate assessment"],
      ["internal-research", "Internal research"],
      ["external-research", "External research"],
      ["focused-specialist-dispatch", "Focused specialist dispatch"],
      ["combined-planning-review", "Combined planning review"],
      ["independent-review", "Independent review"],
      ["targeted-verification", "Targeted verification"],
      ["skill-pressure-scenario", "Skill pressure scenario"],
      ["default-implementation", "Default implementation"],
      ["exact-task-execution", "Exact task execution"],
      ["task-spec-review", "Task specification review"],
      ["task-quality-review", "Task quality review"],
      [
        "whole-implementation-quality-review",
        "Whole-implementation quality review",
      ],
      ["ci-diagnosis-and-fix", "CI diagnosis and fix"],
      ["semantic-review-context", "Semantic review context"],
    ]);
    expect(owner.escalationAdoptionInventory).toEqual(
      owner.directChildRoutes.map(({ id, displayName }) => ({
        id,
        displayName,
        state: "opt-out",
        transition: "none",
      })),
    );
  });

  it("rejects missing and extra routes in either inventory", async () => {
    const [owner, markdown] = await Promise.all([
      readAgentRoutingPolicyOwner(OWNER_PATH),
      readRepoFile(OWNER_PATH),
    ]);
    const sourceSkills = owner.inventory.map(({ skill }) => skill);
    const directRow = markdown
      .split("\n")
      .find((line) => line.includes('<a id="task-spec-review"></a>'));
    const adoptionRow = markdown
      .split("\n")
      .find((line) => line.includes("[`task-spec-review`](#task-spec-review)"));
    expect(directRow).toBeDefined();
    expect(adoptionRow).toBeDefined();
    for (const row of [directRow, adoptionRow]) {
      if (!row) throw new Error("Expected inventory row");
      expect(() =>
        parseAgentRoutingPolicyOwner(
          markdown.replace(`${row}\n`, ""),
          sourceSkills,
        ),
      ).toThrow();
      for (const extra of [
        row,
        row.replaceAll("task-spec-review", "unknown-review"),
      ]) {
        expect(() =>
          parseAgentRoutingPolicyOwner(
            markdown.replace(row, `${row}\n${extra}`),
            sourceSkills,
          ),
        ).toThrow();
      }
    }
  });

  it("keeps the ID, owner and dispatch contract when a display name changes", async () => {
    const [owner, markdown] = await Promise.all([
      readAgentRoutingPolicyOwner(OWNER_PATH),
      readRepoFile(OWNER_PATH),
    ]);
    const sourceSkills = owner.inventory.map(({ skill }) => skill);
    const original = owner.directChildRoutes.find(
      ({ id }) => id === "task-spec-review",
    );
    const renamed = parseAgentRoutingPolicyOwner(
      markdown.replace(
        "Task specification review —",
        "Per-task specification review —",
      ),
      sourceSkills,
    );
    expect(
      renamed.directChildRoutes.find(({ id }) => id === "task-spec-review"),
    ).toEqual({
      ...original,
      displayName: "Per-task specification review",
      surfaceAndOwner: original?.surfaceAndOwner.replace(
        "Task specification review",
        "Per-task specification review",
      ),
    });
    expect(
      renamed.escalationAdoptionInventory.find(
        ({ id }) => id === "task-spec-review",
      )?.displayName,
    ).toBe("Per-task specification review");
    expect(() =>
      parseAgentRoutingPolicyOwner(
        markdown.replace("Task specification review —", " —"),
        sourceSkills,
      ),
    ).toThrow(/display name/);
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
        const expectedEffort = role?.routeEffort;
        expect(clause.effort).toBe(expectedEffort);
        expect(clause.sourceAuthority).toBe(role?.sourceAuthority);
        expect(config.modelProfiles[clause.capability].codex).toMatch(/\S/);
      }
    }
  });

  it("uses high effort for every ordinary reviewer route", async () => {
    const owner = await readAgentRoutingPolicyOwner(OWNER_PATH);
    const reviewerRoutes = owner.directChildRoutes
      .filter((route) =>
        route.clauses.some((clause) => clause.role === "reviewer"),
      )
      .map((route) => [route.id, route.clauses[0]?.effort]);

    expect(reviewerRoutes).toEqual([
      ["combined-planning-review", "high"],
      ["independent-review", "high"],
      ["targeted-verification", "high"],
      ["task-spec-review", "high"],
      ["task-quality-review", "high"],
      ["whole-implementation-quality-review", "high"],
    ]);
  });

  it("activates one combined planning route and retires D6 everywhere", async () => {
    const [owner, planning, contract] = await Promise.all([
      readAgentRoutingPolicyOwner(OWNER_PATH),
      readRepoFile("skills/play-planning/SKILL.md"),
      readRepoFile(
        "skills/play-planning/references/combined-review-contract.md",
      ),
    ]);

    expect(
      owner.directChildRoutes.filter(
        ({ id }) => id === "combined-planning-review",
      ),
    ).toHaveLength(1);
    const activeCombined = planning.slice(
      planning.lastIndexOf("## Exact Digest and Combined Review Orchestration"),
    );
    expect(activeCombined).toContain("planning-review/combined-v1");
    expect(activeCombined).not.toContain("D6_EXECUTABILITY_REVIEW_PROMPT");
    expect(contract).not.toContain("Status: proposed");
    expect(contract).toContain("Correctness");
    expect(contract).toContain("Executability");
  });

  it("correlates every fixed active route set policy clause to its exact fresh Codex tuple", async () => {
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

    const primingProcedures = new Map(
      await Promise.all(
        [ISSUE_PRIMING_GATE, ISSUE_PRIMING_RESEARCH].map(
          async (file) =>
            [
              file,
              await readRepoFile(
                `skills/issue-priming-workflow/references/${file}`,
              ),
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
          (id !== "ci-diagnosis-and-fix" ||
            clause.branchId ===
              CI_BRANCH_BY_MODEL[model as keyof typeof CI_BRANCH_BY_MODEL]),
      );
      expect(
        matchingClauses,
        `${id} ${role} policy clause matches its fixed spawn tuple`,
      ).toHaveLength(1);

      const source = ownerSkills.get(ownerSkill);
      expect(source, `${ownerSkill} source is readable`).toBeDefined();
      const profile =
        role === "reviewer"
          ? "balanced"
          : role === "implementer"
            ? "implementation"
            : capability;
      const placeholder = `{{model-codex:${profile}}}`;
      expect(source?.replace(/\s+/gu, " ")).toContain(
        role === "reviewer"
          ? `${model} = "${placeholder}"`
          : `\`${model}\` = \`${placeholder}\``,
      );
      expect(config.modelProfiles[profile].codex).toMatch(/\S/);
      const procedureFile = ISSUE_PRIMING_SPAWN_PROCEDURES.get(id);
      const procedure = procedureFile
        ? primingProcedures.get(procedureFile)
        : source;
      if (procedureFile) {
        expect(source).toContain(`](references/${procedureFile})`);
      }
      expect(procedure).toContain(
        [
          "Codex.spawn_agent({",
          `  task_name: ${id.replaceAll("-", "_")}_<instance_ordinal>,`,
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

  it("keeps focused specialist dispatch as the existing dynamic exact-configured-role contract", async () => {
    const [owner, source, roles] = await Promise.all([
      readAgentRoutingPolicyOwner(OWNER_PATH),
      readRepoFile("skills/play-agent-dispatch/SKILL.md"),
      readAgentSemanticRoleOwner(AGENT_SPEC_PATH),
    ]);
    const specialist = owner.directChildRoutes.find(
      (route) => route.id === "focused-specialist-dispatch",
    );

    expect(specialist?.ownerSkill).toBe("play-agent-dispatch");
    expect(specialist?.clauses).toEqual([]);
    expect(specialist?.specialistContract).toMatchObject({
      roleCardinality: 7,
      selectionTiming: "before spawn",
      configuration: "exact configured capability/effort",
      sourceDefault: "matching source default",
      scopeAndTermination: "scope/termination",
      externalAuthority: "none",
    });
    expect(roles).toHaveLength(7);
    expect(source.replace(/\s+/gu, " ")).toContain(
      "Reviewer uses balanced and implementer uses implementation.",
    );
    for (const { capability } of roles) {
      expect(source.replace(/\s+/gu, " ")).toContain(
        `\`${capability}\` → \`{{model-codex:${capability}}}\``,
      );
    }
    expect(source).toContain(
      [
        "Codex.spawn_agent({",
        "  task_name: focused_specialist_dispatch_<instance_ordinal>,",
        "  agent_type: SELECTED_ROLE_ID,",
        "  model: RESOLVED_CODEX_MODEL,",
        "  reasoning_effort: SELECTED_CODEX_EFFORT,",
        '  fork_turns: "none",',
        "  message: SELF_CONTAINED_PROMPT,",
        "})",
      ].join("\n"),
    );
  });

  it("keeps the default implementation continuity call configuration-free", async () => {
    const continuity = await readRepoFile(
      "skills/play-subagent-execution/references/lifecycle-status-policy.md",
    );

    const followupStart = continuity.indexOf("Codex.followup_task({");
    expect(
      followupStart,
      "Default implementation lifecycle follow-up anchor is present",
    ).toBeGreaterThanOrEqual(0);
    const followupEnd = continuity.indexOf("\n})", followupStart);
    expect(
      followupEnd,
      "Default implementation lifecycle follow-up terminator is present",
    ).toBeGreaterThan(followupStart);
    expect(continuity.slice(followupStart, followupEnd + 3)).toBe(
      [
        "Codex.followup_task({",
        "  target: DEFAULT_IMPLEMENTATION_STABLE_SESSION_ID,",
        "  message: DEFAULT_IMPLEMENTATION_INCREMENTAL_FINDINGS_AND_TASK_CONTEXT_PLUS_VERIFIED_AUTO_ROUTE_ATTESTATION_WHEN_APPLICABLE,",
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
    const primingConsumerLink =
      /\[[^\]]+\]\(\.\.\/\.\.\/play-agent-dispatch\/references\/dispatch-ritual-usage\.md\)/u;
    for (const file of [ISSUE_PRIMING_GATE, ISSUE_PRIMING_RESEARCH]) {
      const source = await readRepoFile(
        `skills/issue-priming-workflow/references/${file}`,
      );
      expect(source, `${file} links the shared dispatch ritual`).toMatch(
        primingConsumerLink,
      );
    }
  });
});
