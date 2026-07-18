import { describe, expect, it } from "vitest";
import {
  type D4DispatchExpectation,
  type D4ProducedDeclaration,
  parseAgentRoutingPolicyOwner,
  parseAgentSemanticRoleOwner,
  parseCapabilityEscalationAdoptionContractFromSources,
  validateD4ProducedDeclaration,
} from "../__test-helpers__/agent-routing-policy.js";
import {
  SNAPSHOT_REQUEST_TRIGGER_CONTRACTS,
  getMarkdownSection,
  normalizeWhitespace,
  readRepoFile,
  readSkillSource,
} from "../__test-helpers__/skill-contracts.js";
import { loadConfig } from "../config/load.js";
import { resolveCapabilityModel } from "../render/capability-profiles.js";

function sliceBetween(content: string, start: string, end: string): string {
  const startIndex = content.indexOf(start);
  const endIndex = content.indexOf(end);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return content.slice(startIndex, endIndex);
}

function markdownTableRow(content: string, firstCell: string): string {
  const escapedCell = firstCell.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const row = new RegExp(`^\\|\\s*${escapedCell}\\s*\\|.*$`, "m").exec(content);

  expect(row, `missing Markdown table row: ${firstCell}`).not.toBeNull();
  return normalizeWhitespace(row?.[0] ?? "");
}

function expectSubstringsInOrder(content: string, substrings: string[]): void {
  let previousIndex = -1;

  for (const substring of substrings) {
    const currentIndex = content.indexOf(substring, previousIndex + 1);
    expect(
      currentIndex,
      `missing ordered substring: ${substring}`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      currentIndex,
      `substring out of order: ${substring}`,
    ).toBeGreaterThan(previousIndex);
    previousIndex = currentIndex;
  }
}

function validateNoTriggerExample(content: string): string[] {
  const errors: string[] = [];

  if (content.includes("**Contract checklist:**")) {
    errors.push("contract-checklist-label");
  }
  if (!content.includes("**NO-TRIGGER reason:**")) {
    errors.push("missing-task-specific-reason");
  }
  if (!content.includes("**Proof sufficiency:**")) {
    errors.push("missing-minimum-proof");
  }

  return errors;
}

type EscalationConsumerSources = {
  adr: string;
  agentSpec: string;
  issuePriming: string;
  lifecyclePolicy: string;
  prMerge: string;
  routingSpec: string;
  writingSkills: string;
  agentAuthoring: string;
  lifecycleOwner: string;
  adoptionInventory: string;
};

async function readEscalationConsumerSources(): Promise<EscalationConsumerSources> {
  return {
    adr: await readRepoFile(
      "docs/adr/adr-0027-semantic-agent-routing-and-mutation-authority.md",
    ),
    agentSpec: await readRepoFile("docs/specs/agents.md"),
    issuePriming: await readSkillSource("issue-priming-workflow"),
    lifecyclePolicy: await readRepoFile(
      "skills/play-subagent-execution/references/lifecycle-status-policy.md",
    ),
    prMerge: await readSkillSource("pr-merge"),
    routingSpec: await readRepoFile("docs/specs/afds-workflow-routing.md"),
    writingSkills: await readRepoFile("docs/guidelines/writing-skills.md"),
    agentAuthoring: await readRepoFile(
      "docs/guidelines/agent-authoring-guide.md",
    ),
    lifecycleOwner: await readSkillSource("subagent-lifecycle"),
    adoptionInventory: await readRepoFile(
      "docs/guidelines/agent-routing-and-mutation-policy.md",
    ),
  };
}

function capabilityEscalationSourceRecord(
  sources: EscalationConsumerSources,
): Record<string, string> {
  return {
    "docs/adr/adr-0027-semantic-agent-routing-and-mutation-authority.md":
      sources.adr,
    "docs/guidelines/agent-authoring-guide.md": sources.agentAuthoring,
    "docs/guidelines/writing-skills.md": sources.writingSkills,
    "docs/specs/afds-workflow-routing.md": sources.routingSpec,
    "docs/specs/agents.md": sources.agentSpec,
    "skills/issue-priming-workflow/SKILL.md": sources.issuePriming,
    "skills/play-subagent-execution/references/lifecycle-status-policy.md":
      sources.lifecyclePolicy,
    "skills/pr-merge/SKILL.md": sources.prMerge,
    "skills/subagent-lifecycle/SKILL.md": sources.lifecycleOwner,
    "docs/guidelines/agent-routing-and-mutation-policy.md":
      sources.adoptionInventory,
  };
}

async function canonicalD4RuntimeInput(): Promise<{
  declaration: D4ProducedDeclaration;
  expectations: D4DispatchExpectation;
}> {
  const agentSpec = await readRepoFile("docs/specs/agents.md");
  const investigator = parseAgentSemanticRoleOwner(agentSpec).find(
    (role) => role.name === "investigator",
  );
  expect(investigator).toBeDefined();
  if (!investigator) throw new Error("Missing canonical investigator role");
  const target = "codex" as const;
  const config = await loadConfig("devcanon.config.yaml", true);

  return {
    declaration: {
      route_id: "D4",
      target_id: target,
      selected_role_id: investigator.name,
      capability: investigator.capability,
      effort: investigator.codexEffort,
      model:
        resolveCapabilityModel(
          undefined,
          investigator.capability,
          target,
          config.capabilityProfiles,
        ) ?? "",
      source_authority: investigator.sourceAuthority,
      external_authority: investigator.externalAuthority,
      claude_tools: investigator.claudeTools,
      codex_sandbox: investigator.codexSandbox,
      default_network: investigator.defaultNetwork,
      scope: "scope:diagnostic-attribution",
      termination: "termination:response-only",
      context_ref: "context-ref:diagnostic-attribution",
      approval_ref: "approval-ref:diagnostic-attribution",
    },
    expectations: {
      plannerSelectedRoleId: investigator.name,
      targetId: target,
      scope: "scope:diagnostic-attribution",
      termination: "termination:response-only",
      contextRef: "context-ref:diagnostic-attribution",
      approvalRef: "approval-ref:diagnostic-attribution",
    },
  };
}

async function rejectedMessage(
  operation: () => Promise<unknown>,
): Promise<string> {
  try {
    await operation();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("Expected operation to reject");
}

function replaceRequired(source: string, from: string, to: string): string {
  expect(source, `missing mutation source: ${from}`).toContain(from);
  const mutated = source.replace(from, to);
  expect(mutated, `mutation did not change: ${from}`).not.toBe(source);
  return mutated;
}

function validateEscalationConsumerContracts(
  sources: EscalationConsumerSources,
): string[] {
  try {
    parseCapabilityEscalationAdoptionContractFromSources({
      "docs/adr/adr-0027-semantic-agent-routing-and-mutation-authority.md":
        sources.adr,
      "docs/guidelines/agent-authoring-guide.md": sources.agentAuthoring,
      "docs/guidelines/writing-skills.md": sources.writingSkills,
      "docs/specs/afds-workflow-routing.md": sources.routingSpec,
      "docs/specs/agents.md": sources.agentSpec,
      "skills/issue-priming-workflow/SKILL.md": sources.issuePriming,
      "skills/play-subagent-execution/references/lifecycle-status-policy.md":
        sources.lifecyclePolicy,
      "skills/pr-merge/SKILL.md": sources.prMerge,
      "skills/subagent-lifecycle/SKILL.md": sources.lifecycleOwner,
      "docs/guidelines/agent-routing-and-mutation-policy.md":
        sources.adoptionInventory,
    });
    return [];
  } catch (error) {
    return [(error as Error).message];
  }
}

function validateRouteLevelOptOutGuideContracts(
  sources: EscalationConsumerSources,
): string[] {
  try {
    const contract = parseCapabilityEscalationAdoptionContractFromSources({
      "docs/adr/adr-0027-semantic-agent-routing-and-mutation-authority.md":
        sources.adr,
      "docs/guidelines/agent-authoring-guide.md": sources.agentAuthoring,
      "docs/guidelines/writing-skills.md": sources.writingSkills,
      "docs/specs/afds-workflow-routing.md": sources.routingSpec,
      "docs/specs/agents.md": sources.agentSpec,
      "skills/issue-priming-workflow/SKILL.md": sources.issuePriming,
      "skills/play-subagent-execution/references/lifecycle-status-policy.md":
        sources.lifecyclePolicy,
      "skills/pr-merge/SKILL.md": sources.prMerge,
      "skills/subagent-lifecycle/SKILL.md": sources.lifecycleOwner,
      "docs/guidelines/agent-routing-and-mutation-policy.md":
        sources.adoptionInventory,
    });
    const writingProjection = parseGuideProjection(
      sources.writingSkills,
      "guide-capability-transition-projection",
      "writing-skills projection",
    );
    const agentProjection = parseGuideProjection(
      sources.agentAuthoring,
      "guide-capability-transition-delegation",
      "agent-authoring delegation",
    );
    assertExactObject(
      writingProjection,
      [
        "declaration_id",
        "source_path",
        "surface_mode",
        "authority_ref",
        "opt_out",
        "d4",
        "d17",
      ],
      "writing-skills projection",
    );
    assertGuideValues(
      writingProjection,
      {
        declaration_id: "GUIDE-WRITING-SKILLS-CAPABILITY-TRANSITIONS",
        source_path: "docs/guidelines/writing-skills.md",
        surface_mode: "non-owning-semantic-projection",
        authority_ref: contract.inventoryOwnerPath,
      },
      "writing-skills projection",
    );
    const optOut = exactGuideObject(
      writingProjection.opt_out,
      [
        "route_identity",
        "target_ids",
        "target_permission",
        "role_permission",
        "transition",
        "non_d4_direct_route_role_ids",
        "owner_clauses",
      ],
      "writing-skills opt-out",
    );
    assertGuideValues(
      optOut,
      {
        route_identity: "route-level",
        target_ids: "plural",
        target_permission: "exact-only",
        role_permission: "canonical-direct-route",
        transition: contract.adoptions.every(
          (adoption) => adoption.transition === "none",
        )
          ? "none"
          : "invalid",
        non_d4_direct_route_role_ids: contract.adoptions
          .filter((adoption) => adoption.routeId !== "D4")
          .every((adoption) => adoption.directRouteRoleIds !== undefined)
          ? "required"
          : "invalid",
        owner_clauses: "route-specific",
      },
      "writing-skills opt-out",
    );
    const d4 = exactGuideObject(
      writingProjection.d4,
      [
        "route_id",
        "declaration_count",
        "role_set",
        "selection_mode",
        "direct_route_role_ids",
      ],
      "writing-skills D4",
    );
    assertGuideValues(
      d4,
      {
        route_id: contract.d4RouteSet.routeId,
        declaration_count: 1,
        role_set:
          contract.d4RouteSet.allowedRoleIds.length === 6
            ? "canonical-complete"
            : "invalid",
        selection_mode: contract.d4RouteSet.selectionMode,
        direct_route_role_ids: "forbidden",
      },
      "writing-skills D4",
    );
    const d17 = contract.adoptions.find(
      (adoption) => adoption.routeId === "D17",
    );
    if (!d17 || d17.directRouteRoleIds?.length !== 3) {
      throw new Error("canonical D17 route binding is unavailable");
    }
    const d17Projection = exactGuideObject(
      writingProjection.d17,
      ["route_id", "declaration_count", "direct_route_role_ids", "binding"],
      "writing-skills D17",
    );
    assertGuideValues(
      d17Projection,
      {
        route_id: d17.routeId,
        declaration_count: 1,
        direct_route_role_ids: "canonical-ordered",
        binding: "route-level",
      },
      "writing-skills D17",
    );
    assertExactObject(
      agentProjection,
      [
        "declaration_id",
        "source_path",
        "surface_mode",
        "writing_skills_projection_ref",
        "canonical_owner_ref",
        "authority_ref",
      ],
      "agent-authoring delegation",
    );
    assertGuideValues(
      agentProjection,
      {
        declaration_id: "GUIDE-AGENT-AUTHORING-CAPABILITY-TRANSITIONS",
        source_path: "docs/guidelines/agent-authoring-guide.md",
        surface_mode: "delegation-only",
        writing_skills_projection_ref:
          "GUIDE-WRITING-SKILLS-CAPABILITY-TRANSITIONS",
        canonical_owner_ref: contract.inventoryOwnerPath,
        authority_ref: "non-owner",
      },
      "agent-authoring delegation",
    );
    return [];
  } catch (error) {
    return [(error as Error).message];
  }
}

function parseGuideProjection(
  markdown: string,
  label: string,
  description: string,
): Record<string, unknown> {
  const matches = [
    ...markdown.matchAll(new RegExp(`<!-- ${label}\\n([\\s\\S]*?)\\n-->`, "g")),
  ];
  if (matches.length !== 1) {
    throw new Error(`${description} must contain exactly one declaration`);
  }
  assertNoDuplicateGuideKeys(matches[0][1], description);
  let parsed: unknown;
  try {
    parsed = JSON.parse(matches[0][1]);
  } catch {
    throw new Error(`${description} declaration is malformed JSON`);
  }
  return exactGuideObject(parsed, [], description, false);
}

function assertNoDuplicateGuideKeys(json: string, description: string): void {
  const objectKeySets: Set<string>[] = [];
  for (let index = 0; index < json.length; index += 1) {
    if (json[index] === "{") {
      objectKeySets.push(new Set<string>());
      continue;
    }
    if (json[index] === "}") {
      objectKeySets.pop();
      continue;
    }
    if (json[index] !== '"') continue;
    let end = index + 1;
    while (end < json.length) {
      if (json[end] === "\\") {
        end += 2;
        continue;
      }
      if (json[end] === '"') break;
      end += 1;
    }
    if (end >= json.length) break;
    const literal = json.slice(index, end + 1);
    let next = end + 1;
    while (/\s/u.test(json[next] ?? "")) next += 1;
    if (objectKeySets.length > 0 && json[next] === ":") {
      const key = JSON.parse(literal);
      const keys = objectKeySets.at(-1);
      if (keys?.has(key)) {
        throw new Error(`${description} declaration has duplicate key`);
      }
      keys?.add(key);
    }
    index = end;
  }
}

function exactGuideObject(
  value: unknown,
  expectedKeys: readonly string[],
  description: string,
  enforceKeys = true,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${description} declaration must be an object`);
  }
  const object = value as Record<string, unknown>;
  if (enforceKeys) assertExactObject(object, expectedKeys, description);
  return object;
}

function assertExactObject(
  object: Record<string, unknown>,
  expectedKeys: readonly string[],
  description: string,
): void {
  const actualKeys = Object.keys(object).sort();
  const expected = [...expectedKeys].sort();
  if (
    actualKeys.length !== expected.length ||
    actualKeys.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${description} declaration has missing or extra field`);
  }
}

function assertGuideValues(
  object: Record<string, unknown>,
  expected: Record<string, unknown>,
  description: string,
): void {
  for (const [key, value] of Object.entries(expected)) {
    if (object[key] !== value) {
      throw new Error(`${description} ${key} is contradictory or unknown`);
    }
  }
}

function mutateEscalationAnchor(
  source: string,
  mutate: (anchor: Record<string, unknown>) => void,
): string {
  const match = /<!-- escalation-adoption-anchor\n([\s\S]*?)\n-->/u.exec(
    source,
  );
  expect(match, "missing escalation-adoption anchor").not.toBeNull();
  const anchor = JSON.parse(match?.[1] ?? "") as Record<string, unknown>;
  mutate(anchor);
  return source.replace(
    match?.[0] ?? "",
    `<!-- escalation-adoption-anchor\n${JSON.stringify(anchor)}\n-->`,
  );
}

function parseEscalationAnchor(source: string): Record<string, unknown> {
  const match = /<!-- escalation-adoption-anchor\n([\s\S]*?)\n-->/u.exec(
    source,
  );
  expect(match, "missing escalation-adoption anchor").not.toBeNull();
  return JSON.parse(match?.[1] ?? "") as Record<string, unknown>;
}

function mutateAdoptionRecord(
  source: string,
  routeId: string,
  mutate: (record: Record<string, unknown>) => void,
): string {
  return mutateEscalationAnchor(source, (anchor) => {
    const record = (anchor.adoptions as Record<string, unknown>[]).find(
      (candidate) => candidate.route_id === routeId,
    );
    if (!record) throw new Error(`Missing adoption record ${routeId}`);
    mutate(record);
  });
}

function withExplicitD3EvidenceQualifier(
  sources: EscalationConsumerSources,
): EscalationConsumerSources {
  expect(sources.adoptionInventory).toContain(
    "network-binding `dispatch-named`, evidence-qualifier `named-network`",
  );
  expect(sources.adoptionInventory).toContain(
    '"network_binding":"dispatch-named","evidence_qualifier":"named-network"',
  );
  return sources;
}

const CHILD_AGENT_PROMPT_TEMPLATES = [
  "references/implementer-prompt.md",
  "references/executor-prompt.md",
  "references/spec-reviewer-prompt.md",
  "references/code-quality-reviewer-prompt.md",
] as const;

const BRANCH_POLICY_REFERENCES = [
  {
    label: "review routing",
    path: "references/review-routing-policy.md",
  },
  {
    label: "skip-dispatch behavior",
    path: "references/skip-dispatch-policy.md",
  },
  {
    label: "lifecycle/status handling",
    path: "references/lifecycle-status-policy.md",
  },
  {
    label: "snapshot consumption",
    path: "references/snapshot-consumption.md",
  },
  {
    label: "examples",
    path: "references/example-workflow.md",
  },
  {
    label: "rationale",
    path: "references/advantages.md",
  },
] as const;

const COPIED_BRANCH_FINISH_CHOICE_PATTERNS = [
  /^\s*1\.\s+Merge back to <base-branch> locally\s*$/m,
  /^\s*2\.\s+Push and create a Pull Request\s*$/m,
  /^\s*3\.\s+Keep the branch as-is \(I'll handle it later\)\s*$/m,
  /^\s*4\.\s+Discard this work\s*$/m,
  /^\s*Which option\?\s*$/m,
  /^#{2,6}\s+Option 1: Merge Locally\s*$/m,
  /^#{2,6}\s+Option 2: Push and Create PR\s*$/m,
  /^#{2,6}\s+Option 3: Keep As-Is\s*$/m,
  /^#{2,6}\s+Option 4: Discard\s*$/m,
] as const;

type ResearchOutcomeRoute =
  | "skipped-inline"
  | "full-success"
  | "useful-bounded"
  | "internal-partial"
  | "internal-no-partial"
  | "blocked-required";

type ResearchOutcomeExample = {
  researchSkipped: boolean;
  internalDispatchCount: number;
  internalSettled: boolean;
  internalValid: boolean;
  internalUsablePartial: boolean;
  externalCriterionMet: boolean;
  externalDispatchCount: number;
  externalSettled: boolean;
  externalNecessity: "(none)" | "required" | "useful";
  externalValid: boolean;
  uncoveredMaterialExternalEvidence: boolean;
  boundedUncertainty: boolean;
  childSpawnedChild: boolean;
  childWroteArtifact: boolean;
  childEmittedNotice: boolean;
  claimedRoute: ResearchOutcomeRoute;
  helperInvoked: boolean;
  artifactCreated: boolean;
  noticeEmitted: boolean;
  phase4Invoked: boolean;
};

const FULL_RESEARCH_SUCCESS: ResearchOutcomeExample = {
  researchSkipped: false,
  internalDispatchCount: 1,
  internalSettled: true,
  internalValid: true,
  internalUsablePartial: false,
  externalCriterionMet: true,
  externalDispatchCount: 1,
  externalSettled: true,
  externalNecessity: "useful",
  externalValid: true,
  uncoveredMaterialExternalEvidence: false,
  boundedUncertainty: false,
  childSpawnedChild: false,
  childWroteArtifact: false,
  childEmittedNotice: false,
  claimedRoute: "full-success",
  helperInvoked: true,
  artifactCreated: true,
  noticeEmitted: true,
  phase4Invoked: true,
};

const NOT_APPLICABLE_RESEARCH_SUCCESS: ResearchOutcomeExample = {
  ...FULL_RESEARCH_SUCCESS,
  externalCriterionMet: false,
  externalDispatchCount: 0,
  externalSettled: false,
  externalNecessity: "(none)",
  externalValid: false,
};

const SKIPPED_RESEARCH: ResearchOutcomeExample = {
  ...NOT_APPLICABLE_RESEARCH_SUCCESS,
  researchSkipped: true,
  internalDispatchCount: 0,
  internalSettled: false,
  internalValid: false,
  claimedRoute: "skipped-inline",
  helperInvoked: false,
  artifactCreated: false,
  noticeEmitted: false,
};

const INTERNAL_PARTIAL: ResearchOutcomeExample = {
  ...NOT_APPLICABLE_RESEARCH_SUCCESS,
  internalValid: false,
  internalUsablePartial: true,
  claimedRoute: "internal-partial",
  helperInvoked: false,
  artifactCreated: false,
  noticeEmitted: false,
};

const INTERNAL_NO_PARTIAL: ResearchOutcomeExample = {
  ...INTERNAL_PARTIAL,
  internalUsablePartial: false,
  claimedRoute: "internal-no-partial",
};

const USEFUL_EXTERNAL_FAILURE: ResearchOutcomeExample = {
  ...FULL_RESEARCH_SUCCESS,
  externalValid: false,
  boundedUncertainty: true,
  claimedRoute: "useful-bounded",
};

const REQUIRED_EXTERNAL_FAILURE: ResearchOutcomeExample = {
  ...FULL_RESEARCH_SUCCESS,
  internalValid: false,
  internalUsablePartial: true,
  externalNecessity: "required",
  externalValid: false,
  claimedRoute: "blocked-required",
  helperInvoked: false,
  artifactCreated: false,
  noticeEmitted: false,
  phase4Invoked: false,
};

function expectedResearchRoute(
  example: ResearchOutcomeExample,
): ResearchOutcomeRoute {
  if (example.researchSkipped) {
    return "skipped-inline";
  }

  const externalFailed =
    example.externalDispatchCount > 0 &&
    (!example.externalValid || example.uncoveredMaterialExternalEvidence);
  if (externalFailed && example.externalNecessity === "required") {
    return "blocked-required";
  }
  if (!example.internalValid) {
    return example.internalUsablePartial
      ? "internal-partial"
      : "internal-no-partial";
  }
  if (externalFailed && example.externalNecessity === "useful") {
    return "useful-bounded";
  }
  return "full-success";
}

function expectedResearchSideEffects(route: ResearchOutcomeRoute) {
  switch (route) {
    case "skipped-inline":
    case "internal-partial":
    case "internal-no-partial":
      return {
        helperInvoked: false,
        artifactCreated: false,
        noticeEmitted: false,
        phase4Invoked: true,
      };
    case "blocked-required":
      return {
        helperInvoked: false,
        artifactCreated: false,
        noticeEmitted: false,
        phase4Invoked: false,
      };
    case "full-success":
    case "useful-bounded":
      return {
        helperInvoked: true,
        artifactCreated: true,
        noticeEmitted: true,
        phase4Invoked: true,
      };
  }
}

function validateResearchOutcome(example: ResearchOutcomeExample): string[] {
  const errors: string[] = [];

  if (example.childSpawnedChild) {
    errors.push("child-spawned-child");
  }
  if (example.childWroteArtifact) {
    errors.push("child-wrote-artifact");
  }
  if (example.childEmittedNotice) {
    errors.push("child-emitted-notice");
  }
  if (example.researchSkipped && example.internalDispatchCount !== 0) {
    errors.push("skipped-research-dispatched-internal-child");
  }
  if (example.researchSkipped && example.externalDispatchCount !== 0) {
    errors.push("skipped-research-dispatched-child");
  }
  if (!example.researchSkipped && example.internalDispatchCount !== 1) {
    errors.push("invalid-internal-dispatch-count");
  }
  if (example.externalDispatchCount > 1) {
    errors.push("too-many-external-dispatches");
  }
  if (example.externalCriterionMet && example.externalDispatchCount !== 1) {
    errors.push("met-criterion-skipped");
  }
  if (!example.externalCriterionMet && example.externalDispatchCount !== 0) {
    errors.push("unmet-criterion-dispatched");
  }
  if (
    example.externalDispatchCount > 0 &&
    !["required", "useful"].includes(example.externalNecessity)
  ) {
    errors.push("missing-external-classification");
  }

  const hasActiveSibling =
    (example.internalDispatchCount > 0 && !example.internalSettled) ||
    (example.externalDispatchCount > 0 && !example.externalSettled);
  if (
    hasActiveSibling &&
    (example.helperInvoked || example.noticeEmitted || example.phase4Invoked)
  ) {
    errors.push("routed-before-siblings-settled");
  }

  const expectedRoute = expectedResearchRoute(example);
  if (example.claimedRoute !== expectedRoute) {
    errors.push(`wrong-route:${expectedRoute}`);
  }
  const expectedEffects = expectedResearchSideEffects(expectedRoute);
  for (const key of [
    "helperInvoked",
    "artifactCreated",
    "noticeEmitted",
    "phase4Invoked",
  ] as const) {
    if (example[key] !== expectedEffects[key]) {
      errors.push(`wrong-side-effect:${key}`);
    }
  }
  if (expectedRoute === "useful-bounded" && !example.boundedUncertainty) {
    errors.push("missing-bounded-uncertainty");
  }

  return errors;
}

describe("play subagent routing source contracts", () => {
  it("attributes missing and unexpected escalation sources to the escalation source boundary", async () => {
    const sources = await readEscalationConsumerSources();
    const contractSources = {
      "docs/adr/adr-0027-semantic-agent-routing-and-mutation-authority.md":
        sources.adr,
      "docs/guidelines/agent-authoring-guide.md": sources.agentAuthoring,
      "docs/guidelines/writing-skills.md": sources.writingSkills,
      "docs/specs/afds-workflow-routing.md": sources.routingSpec,
      "docs/specs/agents.md": sources.agentSpec,
      "skills/issue-priming-workflow/SKILL.md": sources.issuePriming,
      "skills/play-subagent-execution/references/lifecycle-status-policy.md":
        sources.lifecyclePolicy,
      "skills/pr-merge/SKILL.md": sources.prMerge,
      "skills/subagent-lifecycle/SKILL.md": sources.lifecycleOwner,
      "docs/guidelines/agent-routing-and-mutation-policy.md":
        sources.adoptionInventory,
    };
    const missingPath = "skills/pr-merge/SKILL.md";
    const unexpectedPath = "skills/unexpected/SKILL.md";
    const { [missingPath]: removedSource, ...missingSources } = contractSources;
    const unexpectedSources = {
      ...contractSources,
      [unexpectedPath]: sources.prMerge,
    };

    expect(removedSource).toBe(sources.prMerge);
    expect(Object.keys(missingSources)).not.toContain(missingPath);
    expect(unexpectedSources[unexpectedPath]).toBe(sources.prMerge);
    expect(() =>
      parseCapabilityEscalationAdoptionContractFromSources(contractSources),
    ).not.toThrow();
    let missingMessage = "";
    try {
      parseCapabilityEscalationAdoptionContractFromSources(missingSources);
    } catch (error) {
      missingMessage = (error as Error).message;
    }
    let unexpectedMessage = "";
    try {
      parseCapabilityEscalationAdoptionContractFromSources(unexpectedSources);
    } catch (error) {
      unexpectedMessage = (error as Error).message;
    }

    expect(missingMessage).toBe(
      `escalation source identities must match exactly; missing: ${missingPath}; unexpected: none`,
    );
    expect(unexpectedMessage).toBe(
      `escalation source identities must match exactly; missing: none; unexpected: ${unexpectedPath}`,
    );
  });

  const nonAgentSpecAttributionProbes: Array<{
    name: string;
    mutate: (sources: EscalationConsumerSources) => EscalationConsumerSources;
    assertMutation: (sources: EscalationConsumerSources) => void;
    expectedError: string;
  }> = [
    {
      name: "common owner fields",
      mutate: (sources) => ({
        ...sources,
        lifecycleOwner: mutateEscalationAnchor(
          sources.lifecycleOwner,
          (anchor) => {
            anchor.unexpected_field = "probe";
          },
        ),
      }),
      assertMutation: (sources) => {
        expect(parseEscalationAnchor(sources.lifecycleOwner)).toMatchObject({
          unexpected_field: "probe",
        });
      },
      expectedError:
        "capability-escalation common owner fields identities must match exactly; missing: none; unexpected: unexpected_field",
    },
    {
      name: "inventory owner fields",
      mutate: (sources) => ({
        ...sources,
        adoptionInventory: mutateEscalationAnchor(
          sources.adoptionInventory,
          (anchor) => {
            anchor.unexpected_field = "probe";
          },
        ),
      }),
      assertMutation: (sources) => {
        expect(parseEscalationAnchor(sources.adoptionInventory)).toMatchObject({
          unexpected_field: "probe",
        });
      },
      expectedError:
        "capability-escalation inventory owner fields identities must match exactly; missing: none; unexpected: unexpected_field",
    },
    {
      name: "adoption record fields",
      mutate: (sources) => ({
        ...sources,
        adoptionInventory: mutateAdoptionRecord(
          sources.adoptionInventory,
          "D1",
          (record) => {
            record.unexpected_field = "probe";
          },
        ),
      }),
      assertMutation: (sources) => {
        const record = (
          parseEscalationAnchor(sources.adoptionInventory).adoptions as Record<
            string,
            unknown
          >[]
        ).find((candidate) => candidate.route_id === "D1");
        expect(record).toMatchObject({ unexpected_field: "probe" });
      },
      expectedError:
        "capability-escalation adoption record fields identities must match exactly; missing: none; unexpected: unexpected_field",
    },
    {
      name: "adoption target IDs",
      mutate: (sources) => ({
        ...sources,
        adoptionInventory: mutateAdoptionRecord(
          sources.adoptionInventory,
          "D1",
          (record) => {
            record.target_ids = ["claude"];
          },
        ),
      }),
      assertMutation: (sources) => {
        const record = (
          parseEscalationAnchor(sources.adoptionInventory).adoptions as Record<
            string,
            unknown
          >[]
        ).find((candidate) => candidate.route_id === "D1");
        expect(record?.target_ids).toEqual(["claude"]);
      },
      expectedError:
        "capability-escalation adoption target IDs identities must match exactly; missing: codex; unexpected: none",
    },
    {
      name: "adoption route IDs",
      mutate: (sources) => ({
        ...sources,
        adoptionInventory: mutateEscalationAnchor(
          sources.adoptionInventory,
          (anchor) => {
            anchor.adoptions = (
              anchor.adoptions as Record<string, unknown>[]
            ).filter((record) => record.route_id !== "D17");
          },
        ),
      }),
      assertMutation: (sources) => {
        const records = parseEscalationAnchor(sources.adoptionInventory)
          .adoptions as Record<string, unknown>[];
        expect(records.some((record) => record.route_id === "D17")).toBe(false);
      },
      expectedError:
        "capability-escalation adoption route IDs identities must match exactly; missing: D17; unexpected: none",
    },
    {
      name: "D4 route-set fields",
      mutate: (sources) => ({
        ...sources,
        adoptionInventory: mutateEscalationAnchor(
          sources.adoptionInventory,
          (anchor) => {
            (anchor.d4_route_set as Record<string, unknown>).unexpected_field =
              "probe";
          },
        ),
      }),
      assertMutation: (sources) => {
        expect(
          (
            parseEscalationAnchor(sources.adoptionInventory)
              .d4_route_set as Record<string, unknown>
          ).unexpected_field,
        ).toBe("probe");
      },
      expectedError:
        "capability-escalation D4 route-set fields identities must match exactly; missing: none; unexpected: unexpected_field",
    },
    {
      name: "D4 allowed role IDs",
      mutate: (sources) => ({
        ...sources,
        adoptionInventory: mutateEscalationAnchor(
          sources.adoptionInventory,
          (anchor) => {
            const d4RouteSet = anchor.d4_route_set as Record<string, unknown>;
            d4RouteSet.allowed_role_ids = (
              d4RouteSet.allowed_role_ids as string[]
            ).filter((roleId) => roleId !== "deep-reviewer");
          },
        ),
      }),
      assertMutation: (sources) => {
        const d4RouteSet = parseEscalationAnchor(sources.adoptionInventory)
          .d4_route_set as Record<string, unknown>;
        expect(d4RouteSet.allowed_role_ids).not.toContain("deep-reviewer");
      },
      expectedError:
        "capability-escalation D4 allowed role IDs identities must match exactly; missing: deep-reviewer; unexpected: none",
    },
    {
      name: "projection fields",
      mutate: (sources) => ({
        ...sources,
        prMerge: mutateEscalationAnchor(sources.prMerge, (anchor) => {
          anchor.unexpected_field = "probe";
        }),
      }),
      assertMutation: (sources) => {
        expect(parseEscalationAnchor(sources.prMerge)).toMatchObject({
          unexpected_field: "probe",
        });
      },
      expectedError:
        "capability-escalation projection fields identities must match exactly; missing: none; unexpected: unexpected_field",
    },
    {
      name: "projection route IDs",
      mutate: (sources) => ({
        ...sources,
        prMerge: mutateEscalationAnchor(sources.prMerge, (anchor) => {
          anchor.route_ids = ["D16"];
        }),
      }),
      assertMutation: (sources) => {
        expect(parseEscalationAnchor(sources.prMerge).route_ids).toEqual([
          "D16",
        ]);
      },
      expectedError:
        "capability-escalation projection route IDs identities must match exactly; missing: D17; unexpected: D16",
    },
    {
      name: "projection adoption refs",
      mutate: (sources) => ({
        ...sources,
        prMerge: mutateEscalationAnchor(sources.prMerge, (anchor) => {
          anchor.adoption_refs = ["ESC-ADOPT-D16"];
        }),
      }),
      assertMutation: (sources) => {
        expect(parseEscalationAnchor(sources.prMerge).adoption_refs).toEqual([
          "ESC-ADOPT-D16",
        ]);
      },
      expectedError:
        "capability-escalation projection adoption refs identities must match exactly; missing: ESC-ADOPT-D17; unexpected: ESC-ADOPT-D16",
    },
  ];

  for (const probe of nonAgentSpecAttributionProbes) {
    it(`attributes ${probe.name} to its capability-escalation boundary`, async () => {
      const sources = await readEscalationConsumerSources();
      const mutated = probe.mutate(sources);

      expect(
        parseCapabilityEscalationAdoptionContractFromSources(
          capabilityEscalationSourceRecord(sources),
        ),
      ).toMatchObject({ contractId: "capability-escalation-adoption" });
      probe.assertMutation(mutated);
      expect(validateEscalationConsumerContracts(mutated)).toEqual([
        probe.expectedError,
      ]);
    });
  }

  it("attributes D4 declaration and dispatch-expectation fields to D4 runtime boundaries", async () => {
    const { declaration, expectations } = await canonicalD4RuntimeInput();
    const { approval_ref: removedApprovalRef, ...missingDeclaration } =
      declaration;
    const {
      approvalRef: removedApprovalRefExpectation,
      ...missingExpectations
    } = expectations;

    expect(removedApprovalRef).toBe("approval-ref:diagnostic-attribution");
    expect(removedApprovalRefExpectation).toBe(
      "approval-ref:diagnostic-attribution",
    );
    await expect(
      validateD4ProducedDeclaration(declaration, expectations),
    ).resolves.toBeUndefined();
    const declarationMessage = await rejectedMessage(() =>
      validateD4ProducedDeclaration(
        missingDeclaration as unknown as D4ProducedDeclaration,
        expectations,
      ),
    );
    const expectationMessage = await rejectedMessage(() =>
      validateD4ProducedDeclaration(
        declaration,
        missingExpectations as unknown as D4DispatchExpectation,
      ),
    );

    expect([declarationMessage, expectationMessage]).toEqual([
      "D4 produced declaration fields identities must match exactly; missing: approval_ref; unexpected: none",
      "D4 dispatch expectations fields identities must match exactly; missing: approvalRef; unexpected: none",
    ]);
  });

  it("preserves Agent spec attribution for actual agent-spec identity mismatches", async () => {
    const sources = await readEscalationConsumerSources();
    const originalToolEnvelope =
      "| `deep-reviewer` | Read, Grep, Bash, Write                      | workspace-write | None            |";
    const mutatedToolEnvelope =
      "| `deep-reviewer-mutated` | Read, Grep, Bash, Write                      | workspace-write | None            |";
    const mutatedAgentSpec = replaceRequired(
      sources.agentSpec,
      originalToolEnvelope,
      mutatedToolEnvelope,
    );

    expect(mutatedAgentSpec).not.toBe(sources.agentSpec);
    expect(mutatedAgentSpec).toContain(mutatedToolEnvelope);
    expect(mutatedAgentSpec).not.toContain(originalToolEnvelope);
    expect(() => parseAgentSemanticRoleOwner(sources.agentSpec)).not.toThrow();
    let mismatchMessage = "";
    try {
      parseAgentSemanticRoleOwner(mutatedAgentSpec);
    } catch (error) {
      mismatchMessage = (error as Error).message;
    }

    expect(mismatchMessage).toBe(
      "Agent spec tool-envelope and semantic-role identities must match exactly; missing: deep-reviewer; unexpected: deep-reviewer-mutated",
    );
  });

  it("uses capability vocabulary in the active model-selection contract", async () => {
    const skill = await readSkillSource("play-subagent-execution");
    const section = getMarkdownSection(skill, "Model Selection");
    const normalizedSection = normalizeWhitespace(section);

    for (const capability of ["efficient", "balanced", "frontier"]) {
      expect(section).toContain(`\`${capability}\``);
    }
    expect(normalizedSection).toContain(
      "Capability selects only the model. It never implies effort, authority, tools, sandbox, approvals, or `**Mode:** mechanical`.",
    );
    expect(normalizedSection).toContain(
      "Mechanical mode does not select a capability",
    );
    expect(normalizedSection).toContain(
      "D12 uses `implementer`, balanced/high",
    );
    expect(normalizedSection).toContain(
      "D13 uses `executor`, efficient/medium",
    );
    expect(normalizedSection).toContain(
      "D14-D16 use `deep-reviewer`, frontier/xhigh",
    );
    expect(section).not.toMatch(/\b(?:fast|standard|cheap)\b/i);
  });

  it("keeps issue-priming mode, model, lifecycle, and review contracts visible while helpers own mechanics", async () => {
    const issuePrimingWorkflow = await readSkillSource(
      "issue-priming-workflow",
    );
    const phase7Reference = await readRepoFile(
      "skills/issue-priming-workflow/references/phase-7-review-handling.md",
    );
    const phase6Reference = await readRepoFile(
      "skills/issue-priming-workflow/references/phase-6-auto-handoff.md",
    );
    const phase2 = sliceBetween(
      issuePrimingWorkflow,
      "## Phase 2: Complexity Gate",
      "## Phase 3: Research (Conditional)",
    );
    const phase3 = sliceBetween(
      issuePrimingWorkflow,
      "## Phase 3: Research (Conditional)",
      "## Phase 4: Invoke Brainstorming",
    );
    const phase5 = sliceBetween(
      issuePrimingWorkflow,
      "### Phase 5: Write Plan",
      "### Phase 6: Implement",
    );
    const phase6 = sliceBetween(
      issuePrimingWorkflow,
      "### Phase 6: Implement",
      "### Phase 7: Branch Review",
    );
    const phase7 = sliceBetween(
      issuePrimingWorkflow,
      "### Phase 7: Branch Review",
      "### Phase 8: Create PR",
    );
    const normalizedPhase5 = normalizeWhitespace(phase5);
    const normalizedPhase3 = normalizeWhitespace(phase3);
    const normalizedPhase6 = normalizeWhitespace(phase6);
    const normalizedPhase7 = normalizeWhitespace(phase7);
    const normalizedPhase6Reference = normalizeWhitespace(phase6Reference);

    expect(phase2).toContain("payload.research = gated");
    expect(phase2).toContain("payload.research = forced");
    expect(phase2).toContain("forced by --research");
    expect(phase2).toContain("`assessor`, balanced/medium");
    expect(phase2).toContain("source-immutable");
    expect(phase2).toContain("response-only");
    expect(phase3).toContain("`investigator`, balanced/high");
    expect(phase3).toContain("source-immutable");
    expect(phase3).toContain("response-only");
    expect(normalizedPhase3).toContain("named network access");
    expect(phase3).toContain("Research brief written to");
    expect(normalizedPhase5).toContain(
      "Comment evidence: <repo-relative-path from payload.comment-evidence-path>",
    );
    expect(normalizedPhase5).toContain(
      "Do NOT prompt for execution mode at the end",
    );
    expect(normalizedPhase5).toContain(
      "return after saving the plan and only after both Plan Review and Implementer Executability Review pass",
    );

    expect(phase6).toContain("subagent-lifecycle");
    expect(normalizedPhase6).toContain(
      "cleanup gate for completed or superseded gate and research sessions",
    );
    expect(phase6).toContain("Plan written to <path>.");
    expect(normalizedPhase6).toContain(
      "That return means both planning review gates passed",
    );
    expect(phase6).toContain("validate-read plan");
    expect(phase6).toContain("scripts/write-auto-handoff.sh");
    expect(normalizedPhase6).toContain(
      "Treat a nonzero helper exit as a contract failure and stop before invoking the executor",
    );
    expect(phase6).toContain("references/phase-6-auto-handoff.md");
    expect(phase6Reference).toContain("issue-priming/auto-handoff/v1");
    expect(normalizedPhase6).toContain(
      "controller-local state for the executor's handoff validation",
    );
    expect(phase6).toContain("ISSUE_PRIMING_AUTO_PARENT_ACTIVE=true");
    expect(phase6).toContain("ISSUE_PRIMING_AUTO_HEAD");
    expect(phase6).toContain("Plan: <PLAN_PATH captured above>");
    expect(phase6).toContain("Auto handoff: <repo-relative-path>");
    expect(normalizedPhase6).toContain(
      "missing, unclear, invalid, or unverified reduced-route state fails closed to `spec-and-quality`",
    );
    expect(normalizedPhase6).toContain(
      "single-task plans skip per-task review",
    );
    expect(normalizedPhase6).toContain(
      "the two-gate `play-planning` return from Phase 5",
    );
    expect(normalizedPhase6).not.toContain("plan-review PASS from Phase 5");
    expect(normalizedPhase6).toContain(
      'Phase 6 itself remains "invoke `play-subagent-execution`"',
    );
    expect(normalizedPhase6).toContain(
      "Successful `play-subagent-execution` completion returns control to this owning workflow",
    );

    for (const heading of [
      "## Helper Interface",
      "## Artifact Schema",
      "## Parent State",
      "## Executor Route Boundary",
      "## Lifecycle Before Handoff",
      "## Single-Task Final-Review Carve-Out",
      "## Phase 7 Final-Review Guarantee",
      "## Failure Modes",
    ]) {
      expect(phase6Reference).toContain(heading);
    }
    expect(phase6Reference).toContain("issue-priming/auto-handoff/v1");
    expect(phase6Reference).toContain(
      ".ephemeral/issue-priming-auto-handoff-<head_sha>.json",
    );
    expect(phase6Reference).toContain('"phase": "issue-priming-workflow:6"');
    expect(phase6Reference).toContain('"plan_path": "<PLAN_PATH>"');
    expect(phase6Reference).toContain(
      '"phase7_branch_review_fix_required": true',
    );
    expect(phase6Reference).toContain('"phase7_rerun_after_commits": true');
    expect(phase6Reference).toContain(
      '"phase7_final_approval_summary_notice_required": true',
    );
    expect(normalizedPhase6Reference).toContain(
      "controller-local because repository files and copied invocation prose can be forged or replayed",
    );
    expect(normalizedPhase6Reference).toContain(
      "`issue-priming-workflow` provides the plan path, auto-handoff path, and controller-local parent state. It does not compute per-task review routes",
    );
    expect(normalizedPhase6Reference).toContain(
      "missing, malformed, stale, ambiguous, unclear, invalid, or unverified reduced-route state uses `spec-and-quality`",
    );
    expect(normalizedPhase6Reference).toContain(
      "The carve-out is not a standalone shortcut. Its safety depends on the mandatory Phase 7 whole-diff review guarantee",
    );
    expect(normalizedPhase6Reference).toContain(
      "This final whole-diff review is the downstream guarantee that supports both reduced per-task routes and the single-task final-review carve-out",
    );

    expect(phase7).toContain("branch-review --fix");
    expect(phase7).toContain("references/phase-7-review-handling.md");
    expect(phase7).toContain("prepare-judgment-nits");
    expect(phase7).toContain("-nits-pending.json");
    expect(normalizedPhase7).toContain(
      'ignore `critic: "INVALID"` for continuation and never pass it to Phase 8',
    );
    expect(normalizedPhase7).toContain(
      'treat `critic: "DOWNGRADE"` as non-blocking, judgment-required feedback',
    );
    expect(normalizedPhase7).toContain(
      "If Phase 6 emitted `Risk signals written to <path>.`, invoke `branch-review --fix --risk-signals <path>` for default-base artifacts",
    );
    expect(normalizedPhase7).toContain(
      "If Phase 6 emitted detached issue-base risk signals whose reviewed range is `<full-base-sha>...HEAD`, invoke `branch-review --fix --risk-signals <path> <full-base-sha>`",
    );
    expect(normalizedPhase7).toContain(
      "regenerate risk signals for the new `HEAD` before rerunning `branch-review --fix --risk-signals <new-path>` with the same base-side rule",
    );
    expect(normalizedPhase7).toContain(
      "This runs the full multi-agent review on `git diff <base>...HEAD` where `<base>` is branch-review's selected base: normally the repository's default branch, or the supplied full base SHA for detached issue-base risk signals that use that same base side",
    );
    expect(normalizedPhase7).toContain(
      "With `--fix`, `branch-review` attempts eligible `Blocking` auto-fixes and eligible fixable-nit units, and commits branch-review-owned fixes",
    );
    expect(normalizedPhase7).not.toContain(
      "With `--fix`, `branch-review` attempts eligible `Blocking` auto-fixes and commits them",
    );
    expect(
      issuePrimingWorkflow.indexOf("### Phase 7: Branch Review"),
    ).toBeLessThan(issuePrimingWorkflow.indexOf("### Phase 8: Create PR"));
    expect(normalizedPhase7).toContain("classification flow is `--auto` only");
    const phase8 = sliceBetween(
      issuePrimingWorkflow,
      "### Phase 8: Create PR",
      "## Phase Flow Reference",
    );
    const normalizedPhase8 = normalizeWhitespace(phase8);

    expect(normalizedPhase8).toContain(
      "Phase 7 owns branch review before Phase 8",
    );
    expect(normalizedPhase8).toContain(
      "Phase 8 must not rely on `play-branch-finish` to run, validate, classify, or complete branch review",
    );
    expect(normalizedPhase8).toContain(
      "Phase 8 does not classify findings or prepare the nits envelope",
    );
    expect(normalizedPhase8).toContain(
      "Pass judgment-required Phase 7 feedback only through `nits_file`",
    );

    for (const heading of [
      "## Review Artifact Parsing",
      "## Blocker Stop Rules",
      "## Remaining Nit Classification",
      "## Branch-Review-Owned Fix Commits",
      "## Judgment-Required Nits Envelope",
      "## Phase 8 Handoff",
    ]) {
      expect(phase7Reference).toContain(heading);
    }
    expect(phase7Reference).toContain("Review head: <40-hex-sha>.");
    expect(phase7Reference).toContain("Findings written to <path>.");
    expect(phase7Reference).toContain("PLAY_REVIEW_HELPER");
    expect(phase7Reference).toContain("scripts/review-artifacts.sh");
    expect(phase7Reference).toContain("prepare-judgment-nits");
    expect(phase7Reference).toContain(
      "Reported by branch-review at <path>:<line>",
    );
    expect(normalizeWhitespace(phase7Reference)).toContain(
      "only after the final Phase 7 review run satisfies",
    );
    expect(normalizeWhitespace(phase7Reference)).toContain(
      "`branch-review --fix` owns fixable review feedback",
    );
    expect(normalizeWhitespace(phase7Reference)).toContain(
      "Manual operators decide nit handling case by case",
    );

    expect(issuePrimingWorkflow).not.toContain("Project-Specific Overrides");
  });

  it("routes conditional issue research through depth-1 root-owned leaf siblings", async () => {
    const issuePrimingWorkflow = await readSkillSource(
      "issue-priming-workflow",
    );
    const investigatorPrompt = await readRepoFile(
      "skills/issue-priming-workflow/references/investigator-prompt.md",
    );
    const phase3 = sliceBetween(
      issuePrimingWorkflow,
      "## Phase 3: Research (Conditional)",
      "## Phase 4: Invoke Brainstorming",
    );
    const normalizedPhase3 = normalizeWhitespace(phase3);
    const normalizedConcurrentJoin = normalizeWhitespace(
      sliceBetween(
        phase3,
        "### Lifecycle and Concurrent Join",
        "### Child Report Validation",
      ),
    );

    expect(normalizedPhase3).toContain(
      "The depth-0 root is the sole research dispatcher",
    );
    expect(normalizedPhase3).toContain(
      "Every `investigator` is a direct depth-1 source-immutable leaf child",
    );
    expect(normalizedPhase3).toContain(
      "Always dispatch exactly one internal-scoped child",
    );
    expect(normalizedPhase3).toContain(
      "immediately and concurrently as a sibling of the internal child",
    );
    expect(normalizedPhase3).toContain(
      "dispatch exactly one late external sibling",
    );
    expect(normalizedPhase3).toContain(
      "record `external research: not applicable` plus a short reason",
    );
    expect(normalizedPhase3).toContain(
      "Complexity or cross-module scope alone is insufficient",
    );
    expect(normalizedPhase3).toContain(
      "Before any external spawn, record `required` or `useful` plus a one-sentence reason",
    );
    expect(normalizeWhitespace(investigatorPrompt)).toContain(
      "Do not spawn or delegate to another agent",
    );
    expect(investigatorPrompt).not.toContain("Dispatch sub-agents");

    for (const criterion of [
      "current behavior of an external runtime, API, library, protocol, or hosted service",
      "external precedent materially affects a design choice",
      "explicitly requests external research",
      "material externally owned question",
      "internal report identifies an externally owned uncertainty",
    ]) {
      expect(normalizedPhase3).toContain(criterion);
    }

    expect(normalizedPhase3).toContain(
      "Before every internal or external spawn, add an `agent_id=pending` ledger row",
    );
    expect(normalizedPhase3).toContain(
      "classify target lifecycle capability, and run the cleanup gate",
    );
    expectSubstringsInOrder(normalizedConcurrentJoin, [
      "until source-immutability verification succeeds",
      "Then semantically validate the response and retain scope, report result, source references, and blocker state in controller memory",
      "before exact source-immutability cleanup",
      "Only after exact cleanup succeeds, apply those retained fields to lifecycle state and routing",
      "before subagent-lifecycle cleanup",
    ]);
    expect(normalizedConcurrentJoin).not.toContain(
      "until the source-immutability lifecycle finishes",
    );
    expect(normalizedConcurrentJoin).not.toContain(
      "After exact source-immutability cleanup succeeds, capture and apply",
    );
    expect(normalizedPhase3).toContain(
      "follow `subagent-lifecycle` § Slot-Limit Recovery",
    );
    expect(normalizedPhase3).toContain(
      "captured research scope, report result, source references, blocker state, lifecycle ledger, and repository anchors",
    );
    expect(normalizedPhase3).toContain(
      "applies to internal, immediate external, and late external spawn failures",
    );
    expect(normalizedPhase3).toContain(
      "Resume research outcome routing only when the shared recovery procedure succeeds",
    );
    expect(normalizedPhase3).toContain(
      "Repeated slot failure or escalation stops under that shared policy without research persistence or Phase 4",
    );
    expect(normalizedPhase3).not.toContain("retry exactly once");

    expect(normalizedPhase3).toContain(
      "If internal becomes terminal while external remains active, do not invoke the helper, emit the notice, or enter Phase 4",
    );
    expect(normalizedPhase3).toContain(
      "If external becomes terminal while internal remains active, do not invoke the helper, emit the notice, or enter Phase 4",
    );
    expect(normalizedPhase3).toContain(
      "Every started immediate sibling must reach completion, timeout, or failure",
    );
    expect(normalizedPhase3).toContain(
      "Never cancel or abandon an already-started sibling and never route early",
    );
  });

  it("guards each response-only D1-D3 leaf before consuming its result", async () => {
    const issuePrimingWorkflow = await readSkillSource(
      "issue-priming-workflow",
    );
    const phase2 = normalizeWhitespace(
      sliceBetween(
        issuePrimingWorkflow,
        "## Phase 2: Complexity Gate",
        "## Phase 3: Research (Conditional)",
      ),
    );
    const phase3 = normalizeWhitespace(
      sliceBetween(
        issuePrimingWorkflow,
        "## Phase 3: Research (Conditional)",
        "## Phase 4: Invoke Brainstorming",
      ),
    );

    for (const phase of [phase2, phase3]) {
      expect(phase).toContain("scripts/source-immutability.sh");
      expect(phase).toContain('bash "$SOURCE_IMMUTABILITY_HELPER" capture');
      expect(phase).toContain(
        'bash "$SOURCE_IMMUTABILITY_HELPER" verify --baseline',
      );
      expect(phase).toContain(
        'bash "$SOURCE_IMMUTABILITY_HELPER" cleanup --baseline',
      );
      expect(phase).toContain("zero handoffs");
      expectSubstringsInOrder(phase, [
        "capture before spawn",
        "verify before semantic validation or consumption",
        "validate and retain the response in controller memory",
        "cleanup the exact retained baseline",
        "apply the retained result",
      ]);
      expect(phase).toContain(
        "Only detected source mutation or cleanup failure is terminal",
      );
      expect(phase).toContain(
        "never reset, check out, stage, or repair source",
      );
    }

    expect(phase2).toContain(
      "ordinary unavailable, failed, malformed, or verification-rejected gate result",
    );
    expect(phase2).toContain("`RESEARCH_NEEDED`");
    expect(phase3).toContain(
      "ordinary unavailable, failed, malformed, or verification-rejected investigator result",
    );
    expect(phase3).toContain("existing outcome precedence");
  });

  it("keeps brainstorming research-brief provenance caller-owned and untrusted", async () => {
    const playBrainstorm = await readSkillSource("play-brainstorm");
    const pathSection = sliceBetween(
      playBrainstorm,
      "### Research brief path reference (preferred for controllers)",
      "### Inline research brief content (preserved for direct invocations)",
    );
    const inlineSection = sliceBetween(
      playBrainstorm,
      "### Inline research brief content (preserved for direct invocations)",
      "### Comment evidence path reference (optional)",
    );

    for (const section of [pathSection, inlineSection]) {
      const normalized = normalizeWhitespace(section);
      expect(normalized).toContain(
        "caller-produced synthesis from possibly untrusted issue prose and scoped child reports",
      );
      expect(normalized).toContain(
        "does not imply that the final brief originated from a `research-agent`",
      );
      expect(normalized).toContain("untrusted prose");
    }
    expect(playBrainstorm).not.toMatch(
      /brief originated from a research-agent run against an external issue body/i,
    );
    expect(playBrainstorm).not.toMatch(
      /\.ephemeral\/\d{4}-\d{2}-\d{2}-\d+-research\.md/,
    );
  });

  it.each([
    {
      route: "full success",
      example: FULL_RESEARCH_SUCCESS,
    },
    {
      route: "full success with external research not applicable",
      example: NOT_APPLICABLE_RESEARCH_SUCCESS,
    },
    {
      route: "research skipped inline",
      example: SKIPPED_RESEARCH,
    },
    {
      route: "internal usable partial",
      example: INTERNAL_PARTIAL,
    },
    {
      route: "internal failure without partial",
      example: INTERNAL_NO_PARTIAL,
    },
    {
      route: "useful external bounded uncertainty",
      example: USEFUL_EXTERNAL_FAILURE,
    },
    {
      route: "required external hard stop wins over internal partial",
      example: REQUIRED_EXTERNAL_FAILURE,
    },
  ])("accepts a canonical research outcome: $route", ({ example }) => {
    expect(validateResearchOutcome(example)).toEqual([]);
  });

  it.each([
    {
      family: "non-skipped research dispatches no internal child",
      example: {
        ...NOT_APPLICABLE_RESEARCH_SUCCESS,
        internalDispatchCount: 0,
      },
      error: "invalid-internal-dispatch-count",
    },
    {
      family: "non-skipped research dispatches two internal children",
      example: {
        ...NOT_APPLICABLE_RESEARCH_SUCCESS,
        internalDispatchCount: 2,
      },
      error: "invalid-internal-dispatch-count",
    },
    {
      family: "external criterion dispatches two external children",
      example: {
        ...FULL_RESEARCH_SUCCESS,
        externalDispatchCount: 2,
      },
      error: "too-many-external-dispatches",
    },
    {
      family: "unmet external criterion dispatches a child",
      example: {
        ...NOT_APPLICABLE_RESEARCH_SUCCESS,
        externalDispatchCount: 1,
        externalSettled: true,
        externalNecessity: "useful" as const,
        externalValid: true,
      },
      error: "unmet-criterion-dispatched",
    },
    {
      family: "skipped research dispatches its required internal child",
      example: {
        ...SKIPPED_RESEARCH,
        internalDispatchCount: 1,
        internalSettled: true,
      },
      error: "skipped-research-dispatched-internal-child",
    },
    {
      family: "skipped research claims full success",
      example: {
        ...SKIPPED_RESEARCH,
        claimedRoute: "full-success" as const,
      },
      error: "wrong-route:skipped-inline",
    },
    {
      family: "full success claims the skipped route",
      example: {
        ...FULL_RESEARCH_SUCCESS,
        claimedRoute: "skipped-inline" as const,
      },
      error: "wrong-route:full-success",
    },
    {
      family: "internal failure claims full success",
      example: {
        ...INTERNAL_PARTIAL,
        claimedRoute: "full-success" as const,
      },
      error: "wrong-route:internal-partial",
    },
    {
      family: "useful external failure claims full success",
      example: {
        ...USEFUL_EXTERNAL_FAILURE,
        claimedRoute: "full-success" as const,
      },
      error: "wrong-route:useful-bounded",
    },
    {
      family: "met external criterion skipped",
      example: {
        ...NOT_APPLICABLE_RESEARCH_SUCCESS,
        externalCriterionMet: true,
      },
      error: "met-criterion-skipped",
    },
    {
      family: "missing external classification",
      example: {
        ...FULL_RESEARCH_SUCCESS,
        externalNecessity: "(none)" as const,
      },
      error: "missing-external-classification",
    },
    {
      family: "research child spawns a child",
      example: { ...FULL_RESEARCH_SUCCESS, childSpawnedChild: true },
      error: "child-spawned-child",
    },
    {
      family: "research child writes an artifact",
      example: { ...FULL_RESEARCH_SUCCESS, childWroteArtifact: true },
      error: "child-wrote-artifact",
    },
    {
      family: "research child emits the notice",
      example: { ...FULL_RESEARCH_SUCCESS, childEmittedNotice: true },
      error: "child-emitted-notice",
    },
    {
      family: "internal sibling still active",
      example: { ...FULL_RESEARCH_SUCCESS, internalSettled: false },
      error: "routed-before-siblings-settled",
    },
    {
      family: "external sibling still active",
      example: { ...FULL_RESEARCH_SUCCESS, externalSettled: false },
      error: "routed-before-siblings-settled",
    },
    {
      family: "required external failure loses precedence",
      example: {
        ...REQUIRED_EXTERNAL_FAILURE,
        claimedRoute: "internal-partial" as const,
      },
      error: "wrong-route:blocked-required",
    },
    {
      family: "skipped route invokes helper",
      example: {
        ...SKIPPED_RESEARCH,
        helperInvoked: true,
      },
      error: "wrong-side-effect:helperInvoked",
    },
    {
      family: "internal failure creates artifact",
      example: {
        ...INTERNAL_PARTIAL,
        artifactCreated: true,
      },
      error: "wrong-side-effect:artifactCreated",
    },
    {
      family: "required failure invokes Phase 4",
      example: {
        ...REQUIRED_EXTERNAL_FAILURE,
        phase4Invoked: true,
      },
      error: "wrong-side-effect:phase4Invoked",
    },
    {
      family: "useful external failure omits bounded uncertainty",
      example: {
        ...USEFUL_EXTERNAL_FAILURE,
        boundedUncertainty: false,
      },
      error: "missing-bounded-uncertainty",
    },
    {
      family: "uncovered material evidence claims full success",
      example: {
        ...FULL_RESEARCH_SUCCESS,
        uncoveredMaterialExternalEvidence: true,
      },
      error: "wrong-route:useful-bounded",
    },
  ])(
    "rejects a one-dimension-invalid research outcome: $family",
    ({ example, error }) => {
      expect(validateResearchOutcome(example)).toContain(error);
    },
  );

  it("derives one bounded question for an immediate external sibling", async () => {
    const phase3 = sliceBetween(
      await readSkillSource("issue-priming-workflow"),
      "## Phase 3: Research (Conditional)",
      "## Phase 4: Invoke Brainstorming",
    );

    expect(normalizeWhitespace(phase3)).toContain(
      "For immediate external dispatch, derive one root-curated question from issue-body, comment-evidence, and gate evidence",
    );
  });

  it("validates artifact inputs and the complete tuple before lifecycle state", async () => {
    const phase3 = normalizeWhitespace(
      sliceBetween(
        await readSkillSource("issue-priming-workflow"),
        "## Phase 3: Research (Conditional)",
        "## Phase 4: Invoke Brainstorming",
      ),
    );
    const artifactValidation = phase3.indexOf(
      "Validate the worktree and guarded issue-body/comment-evidence inputs first",
    );
    const tupleValidation = phase3.indexOf(
      "Then validate every scalar and closed value before creating lifecycle state",
    );
    const pendingLedger = phase3.indexOf(
      "Before every internal or external spawn, add an `agent_id=pending` ledger row",
    );

    expect(artifactValidation).toBeGreaterThanOrEqual(0);
    expect(tupleValidation).toBeGreaterThan(artifactValidation);
    expect(pendingLedger).toBeGreaterThan(tupleValidation);
  });

  it("derives a late external question from captured internal uncertainty without raw copying", async () => {
    const phase3 = sliceBetween(
      await readSkillSource("issue-priming-workflow"),
      "## Phase 3: Research (Conditional)",
      "## Phase 4: Invoke Brainstorming",
    );

    expect(normalizeWhitespace(phase3)).toContain(
      "For late external dispatch, summarize the captured internal `External Uncertainties` question without copying raw report prose",
    );
  });

  it("requires an external report to answer its supplied question", async () => {
    const researchPrompt = normalizeWhitespace(
      await readRepoFile(
        "skills/issue-priming-workflow/references/investigator-prompt.md",
      ),
    );

    expect(researchPrompt).toContain(
      "Answer `<EXTERNAL_QUESTION_OR_NONE>` directly in sourced `External Precedent` findings and in `Implications`",
    );
  });

  it("routes uncovered immediate-sibling uncertainty as classified external failure", async () => {
    const phase3 = sliceBetween(
      await readSkillSource("issue-priming-workflow"),
      "## Phase 3: Research (Conditional)",
      "## Phase 4: Invoke Brainstorming",
    );
    const normalizedPhase3 = normalizeWhitespace(phase3);

    expect(normalizedPhase3).toContain(
      "compare every material internal external uncertainty with the supplied external question and the external report's sourced answer",
    );
    expect(normalizedPhase3).toContain(
      "classify the uncovered uncertainty `required` or `useful` and apply that external-failure route",
    );
    expect(normalizedPhase3).toContain(
      "Do not dispatch a second external child and never select full success with uncovered material external evidence",
    );
  });

  it("requires classification before every external dispatch", async () => {
    const phase3 = sliceBetween(
      await readSkillSource("issue-priming-workflow"),
      "## Phase 3: Research (Conditional)",
      "## Phase 4: Invoke Brainstorming",
    );

    expect(normalizeWhitespace(phase3)).toContain(
      "**Missing classification:** never spawn an external child until `required` or `useful` and its one-sentence reason are recorded",
    );
  });

  it("never skips external dispatch when a criterion is met", async () => {
    const phase3 = sliceBetween(
      await readSkillSource("issue-priming-workflow"),
      "## Phase 3: Research (Conditional)",
      "## Phase 4: Invoke Brainstorming",
    );

    expect(normalizeWhitespace(phase3)).toContain(
      "**Met criterion:** dispatch external research; recording not applicable is invalid",
    );
  });

  it("keeps research children from spawning, writing, or announcing", async () => {
    const researchPrompt = normalizeWhitespace(
      await readRepoFile(
        "skills/issue-priming-workflow/references/investigator-prompt.md",
      ),
    );

    expect(researchPrompt).toContain(
      "Do not spawn or delegate to another agent",
    );
    expect(researchPrompt).toContain(
      "Do not write files, invoke the research-brief helper, create an artifact, or emit the producer notice",
    );
  });

  it("delegates slot recovery to the lifecycle owner and keeps research-local state", async () => {
    const phase3 = sliceBetween(
      await readSkillSource("issue-priming-workflow"),
      "## Phase 3: Research (Conditional)",
      "## Phase 4: Invoke Brainstorming",
    );
    const normalizedPhase3 = normalizeWhitespace(phase3);

    expect(normalizedPhase3).toContain(
      "follow `subagent-lifecycle` § Slot-Limit Recovery",
    );
    expect(normalizedPhase3).toContain(
      "captured research scope, report result, source references, blocker state, lifecycle ledger, and repository anchors",
    );
    expect(normalizedPhase3).toContain(
      "applies to internal, immediate external, and late external spawn failures",
    );
    expect(normalizedPhase3).toContain(
      "Resume research outcome routing only when the shared recovery procedure succeeds",
    );
    expect(normalizedPhase3).toContain(
      "Repeated slot failure or escalation stops under that shared policy without research persistence or Phase 4",
    );
    for (const copiedGenericMechanic of [
      "surface explicit manual cleanup guidance",
      "wait for operator confirmation",
      "retry exactly once",
    ]) {
      expect(normalizedPhase3).not.toContain(copiedGenericMechanic);
    }
  });

  it("blocks routing when internal settles before immediate external", async () => {
    const phase3 = sliceBetween(
      await readSkillSource("issue-priming-workflow"),
      "## Phase 3: Research (Conditional)",
      "## Phase 4: Invoke Brainstorming",
    );

    expect(normalizeWhitespace(phase3)).toContain(
      "If internal becomes terminal while external remains active, do not invoke the helper, emit the notice, or enter Phase 4",
    );
  });

  it("blocks routing when immediate external settles before internal", async () => {
    const phase3 = sliceBetween(
      await readSkillSource("issue-priming-workflow"),
      "## Phase 3: Research (Conditional)",
      "## Phase 4: Invoke Brainstorming",
    );

    expect(normalizeWhitespace(phase3)).toContain(
      "If external becomes terminal while internal remains active, do not invoke the helper, emit the notice, or enter Phase 4",
    );
  });

  it("keeps branch policy in a lazy reference map with explicit load triggers", async () => {
    const skillSource = await readSkillSource("play-subagent-execution");
    const referenceMap = getMarkdownSection(
      skillSource,
      "Branch Policy Reference Map",
    );

    for (const { label, path } of BRANCH_POLICY_REFERENCES) {
      expect(referenceMap).toContain(label);
      expect(referenceMap).toContain(path);
      expect(normalizeWhitespace(referenceMap)).toContain("Load when");

      const referenceSource = await readRepoFile(
        `skills/play-subagent-execution/${path}`,
      );
      expect(referenceSource.trim()).not.toBe("");
    }
  });

  it("declares child-agent prompt templates in an explicit registry", async () => {
    const skillSource = await readSkillSource("play-subagent-execution");
    const registry = getMarkdownSection(
      skillSource,
      "Prompt Template Registry",
    );
    const normalizedRegistry = normalizeWhitespace(registry);

    for (const templatePath of CHILD_AGENT_PROMPT_TEMPLATES) {
      expect(registry).toContain(templatePath);
    }

    expect(normalizedRegistry).toContain(
      "D16 final whole-implementation `deep-reviewer`",
    );
    expect(registry).not.toContain("references/snapshot-manifest-recipe.md");
    expect(registry).not.toContain("scripts/write-snapshot-manifest.sh");
  });

  it("keeps reviewer and implementer prompt trust boundaries in source", async () => {
    const specReviewerPrompt = await readRepoFile(
      "skills/play-subagent-execution/references/spec-reviewer-prompt.md",
    );
    const codeQualityReviewerPrompt = await readRepoFile(
      "skills/play-subagent-execution/references/code-quality-reviewer-prompt.md",
    );
    const implementerPrompt = await readRepoFile(
      "skills/play-subagent-execution/references/implementer-prompt.md",
    );
    const executorPrompt = await readRepoFile(
      "skills/play-subagent-execution/references/executor-prompt.md",
    );

    for (const reviewerPrompt of [
      specReviewerPrompt,
      codeQualityReviewerPrompt,
    ]) {
      const normalizedPrompt = normalizeWhitespace(reviewerPrompt);

      expect(reviewerPrompt).toContain("Read the implementation from disk");
      expect(normalizedPrompt).toContain(
        "snapshots are for the controller's bookkeeping only",
      );
      expect(normalizedPrompt).toContain(
        "stay independent of the implementer's framing",
      );
    }

    expect(specReviewerPrompt).toContain(
      "Consume any content snapshot the controller may hold",
    );
    expect(codeQualityReviewerPrompt).toContain(
      "Do not consume any content snapshot",
    );

    for (const implementerSource of [implementerPrompt, executorPrompt]) {
      expect(implementerSource).toContain("Read the relevant source files");
      expect(implementerSource).toContain(
        "referenced contracts directly before choosing",
      );
    }

    expect(executorPrompt).toContain(
      "Plan-named commands are not authoritative",
    );
    expect(executorPrompt).toContain("trusted source outside the plan");
  });

  it("routes D12 judgment work and D13 exact work through distinct mutable roles", async () => {
    const skillSource = await readSkillSource("play-subagent-execution");
    const skipDispatch = await readRepoFile(
      "skills/play-subagent-execution/references/skip-dispatch-policy.md",
    );
    const lifecycle = await readRepoFile(
      "skills/play-subagent-execution/references/lifecycle-status-policy.md",
    );
    const reviewRouting = await readRepoFile(
      "skills/play-subagent-execution/references/review-routing-policy.md",
    );
    const redFlags = await readRepoFile(
      "skills/play-subagent-execution/references/red-flags.md",
    );
    const implementerPrompt = await readRepoFile(
      "skills/play-subagent-execution/references/implementer-prompt.md",
    );
    const executorPrompt = await readRepoFile(
      "skills/play-subagent-execution/references/executor-prompt.md",
    );
    const normalizedSkill = normalizeWhitespace(skillSource);
    const normalizedSkipDispatch = normalizeWhitespace(skipDispatch);
    const normalizedLifecycle = normalizeWhitespace(lifecycle);
    const normalizedReviewRouting = normalizeWhitespace(reviewRouting);
    const normalizedRedFlags = normalizeWhitespace(redFlags);
    const normalizedImplementerPrompt = normalizeWhitespace(implementerPrompt);
    const normalizedExecutorPrompt = normalizeWhitespace(executorPrompt);

    expect(normalizedSkill).toContain(
      "D12 uses the source-mutable `implementer`, balanced/high, for judgment-bearing scoped implementation",
    );
    expect(normalizedSkill).toContain(
      "D13 uses guarded inline execution or the source-mutable `executor`, efficient/medium, only when all five exact guardrails pass",
    );
    expect(normalizedSkill).toContain(
      "The [skip-dispatch policy](references/skip-dispatch-policy.md) owns pre-dispatch selection and fallback",
    );
    expect(normalizedSkill).toContain(
      "the [lifecycle/status policy](references/lifecycle-status-policy.md) owns returned D13 dispositions",
    );
    expect(normalizedSkill).toContain("Implementer dispatch remains serial");
    expect(implementerPrompt).toContain(
      "paired with the source agent at [`agents/implementer.yaml`]",
    );
    expect(normalizedImplementerPrompt).toContain(
      "Returned D12 status handling belongs to [`lifecycle-status-policy.md`](lifecycle-status-policy.md), which preserves the configured `implementer`, balanced/high pair",
    );
    expect(normalizedImplementerPrompt).not.toContain(
      "re-dispatch with a more capable model",
    );
    expect(executorPrompt).toContain(
      "paired with the source agent at [`agents/executor.yaml`]",
    );
    expect(normalizedExecutorPrompt).toContain(
      "If any operation requires judgment, policy interpretation, a clarifying question, or work outside the exact validated authorization, stop and report NEEDS_CONTEXT or BLOCKED so the controller can reclassify the task to D12",
    );
    expect(normalizedExecutorPrompt).toContain(
      "For `DONE_WITH_CONCERNS`, include a concern description and classify it as `judgment-bearing` or `purely observational`",
    );
    expect(normalizedSkipDispatch).toContain(
      "All five guardrails pass before either guarded inline execution or executor dispatch",
    );
    expect(normalizedSkipDispatch).toContain(
      "Guardrail #4 failure blocks before source mutation; any other missing guardrail reclassifies to D12 and uses `implementer-prompt.md`",
    );
    expect(normalizedSkipDispatch).toContain(
      "`executor-prompt.md` owns the dispatched child's action and report schema; `lifecycle-status-policy.md` owns every returned D13 disposition",
    );
    expect(normalizedSkipDispatch).not.toContain(
      "It stops with NEEDS_CONTEXT or BLOCKED",
    );
    expect(normalizedLifecycle).toContain(
      "For a dispatched D13 executor, `NEEDS_CONTEXT` or `BLOCKED` caused by judgment, policy interpretation, a clarifying question, missing authorization, or widened scope stops D13 and reclassifies the task to D12",
    );
    expect(normalizedLifecycle).toContain(
      "Do not redispatch D13 with more context or a more capable model",
    );
    expect(normalizedLifecycle).toContain(
      "For a D12 implementer, `NEEDS_CONTEXT` means required information was not provided; provide the missing context and redispatch D12 when the task remains within its judgment-bearing scope",
    );
    expect(normalizedLifecycle).toContain(
      "A non-boundary operational D13 `BLOCKED` also stops D13, keeps the task incomplete, and routes the blocker plus any available base/head SHA and snapshot state to D12 for judgment-bearing recovery",
    );
    expect(normalizedLifecycle).toContain(
      "Never redispatch or model-escalate D13, and never mark a non-DONE D13 result complete",
    );
    expect(normalizedLifecycle).toContain(
      "A D13 `DONE_WITH_CONCERNS` report with judgment-bearing concerns keeps the task incomplete and routes the report to D12; purely observational concerns may proceed through the selected route",
    );
    expect(normalizedLifecycle).toContain(
      "Both a D12 implementer and a dispatched D13 executor with `DONE` or `DONE_WITH_CONCERNS` enter DONE-report and snapshot capture before task completion",
    );
    expect(normalizedLifecycle).toContain(
      "D12 remains the shipped `implementer`, balanced/high; no `BLOCKED` disposition changes its role, capability, or effort",
    );
    expect(normalizedLifecycle).not.toContain(
      "re-dispatch with a more capable model",
    );
    expect(normalizedLifecycle).toContain(
      "This file is the sole normative owner of returned D12/D13 dispositions, D14/D15 result freshness and invalidation, D14-D16 guard capture and cleanup failure, and incomplete or terminal outcomes",
    );
    expect(normalizedLifecycle).toContain(
      "If revalidation escalates a `spec-only` task to `spec-and-quality` after a head-changing fix, rerun both D14 and D15 fresh against the new same task head before completion",
    );
    expect(normalizedLifecycle).toContain(
      "Every fix commit invalidates both D14 and D15 results",
    );
    expect(normalizedLifecycle).toContain(
      "Capture failure prevents spawn and returns the same task-incomplete `BLOCKED` state",
    );
    expect(normalizedLifecycle).toContain(
      "D16 detected source mutation or cleanup failure is guard-integrity terminal",
    );

    expect(normalizedReviewRouting).toContain(
      "This file owns initial executor-computed per-task review route selection only",
    );
    expect(normalizedReviewRouting).toContain(
      "After selection, [`lifecycle-status-policy.md`](lifecycle-status-policy.md) owns reviewer result disposition, freshness, fix invalidation, guard failures, and incomplete or terminal transitions",
    );
    expect(normalizedReviewRouting).not.toContain(
      "Every fix commit invalidates both D14 and D15 results",
    );
    expect(reviewRouting).not.toContain("## Guarded Review Failure");
    expect(reviewRouting).not.toContain("## Same-Head Quality Disposition");

    expect(normalizedRedFlags).toContain(
      "Non-normative warning index for likely workflow violations",
    );
    expect(normalizedRedFlags).toContain(
      "Returned D12/D13 questions, blockers, reviewer findings, fixups, re-reviews, and failures all route through the lifecycle/status policy",
    );
    expect(normalizedRedFlags).not.toContain(
      "Every fix commit invalidates both D14 and D15 results",
    );
    expect(normalizedRedFlags).not.toContain(
      "For a D13 executor, a clarifying question or `NEEDS_CONTEXT`/`BLOCKED`",
    );
    expect(normalizedSkill).toContain(
      "The guarded inline branch produces no child DONE report and no child snapshot request",
    );
    expect(normalizedSkill).toContain(
      "The dispatched-executor branch preserves the unchanged DONE-report and snapshot request/skip contract",
    );
    expect(normalizedSkill).not.toContain(
      "There is no DONE report and no snapshot request on this path",
    );
    expect(normalizedSkill).not.toContain(
      "Every fix commit invalidates both D14 and D15 results",
    );
    expect(normalizedSkill).not.toContain(
      "Capture failure prevents spawn and takes the same task-incomplete `BLOCKED` transition",
    );
    expect(normalizedSkill).toContain(
      "review routing - `references/review-routing-policy.md` | Computing initial effective per-task routes, validating reduced-route auto-handoff, or checking hard-risk triggers",
    );
    expect(normalizedSkill).toContain(
      "lifecycle/status handling - `references/lifecycle-status-policy.md` | Updating lifecycle ledger state, interpreting returned worker statuses, resolving same-head reviewer disposition, handling fixups/blockers, guard failures, or cleanup timing",
    );
    expect(normalizedSkill).not.toContain(
      "review-routing-policy.md` | Computing effective per-task routes, validating reduced-route auto-handoff, checking hard-risk triggers, or resolving same-head reviewer disposition",
    );
    expect(skillSource).not.toContain("mechanical-implementer-prompt.md");
  });

  it("keeps tier-conditional planning contracts and review-routing rules in source", async () => {
    const playPlanning = await readSkillSource("play-planning");
    const taskStructure = getMarkdownSection(playPlanning, "Task Structure");
    const planningCriteria = await readRepoFile(
      "skills/play-planning/references/planning-criteria.md",
    );
    const contractChecklist = getMarkdownSection(
      planningCriteria,
      "Task contract criteria",
    );
    const optionalModeField = sliceBetween(
      playPlanning,
      "### Optional `**Mode:**` field",
      "### Optional Review-Routing Hint Fields",
    );
    const mechanicalTaskExample = sliceBetween(
      optionalModeField,
      "Example mechanical-task header:",
      "Omit `**Mode:** mechanical`",
    );
    const normalizedTaskStructure = normalizeWhitespace(taskStructure);
    const normalizedContractChecklist = normalizeWhitespace(contractChecklist);
    const normalizedOptionalModeField = normalizeWhitespace(optionalModeField);

    expect(normalizedContractChecklist).toContain(
      "Each field is populated or marked `N/A` with a task-specific reason",
    );
    expect(normalizedContractChecklist).toContain(
      "It must not prescribe private implementation choices discoverable from the named sources",
    );
    expect(contractChecklist).toContain("trigger criteria");
    expect(contractChecklist).toContain("owner and authority");
    expect(normalizedContractChecklist).toContain(
      "affected consumers or generated outputs",
    );
    expect(normalizedContractChecklist).toContain("must-preserve behavior");
    expect(normalizedContractChecklist).toContain(
      "required state and failure behavior",
    );

    expect(normalizedOptionalModeField).toContain(
      "detailed taxonomy (positive and negative examples) lives in the [mechanical task taxonomy](../play-subagent-execution/references/skip-dispatch-policy.md#mechanical-task-taxonomy)",
    );
    expect(normalizedOptionalModeField).not.toContain(
      "SKILL.md` § Mechanical Task Taxonomy",
    );
    for (const requiredField of [
      "**Contract tier:** NO-TRIGGER",
      "**Mode:** mechanical",
      "**Risk hint:**",
      "**Review hint:**",
      "**Review rationale:**",
      "**Files:**",
      "**Purpose:**",
      "**Goal:**",
      "**Non-goals:**",
      "**Scope mapping:**",
      "**Source-of-truth references:**",
      "**Authority surfaces:**",
      "**NO-TRIGGER reason:**",
      "**Acceptance criteria:**",
      "**Risks:**",
      "**Dependencies:**",
      "**Verification expectations:**",
      "**Proof sufficiency:**",
    ]) {
      expect(mechanicalTaskExample).toContain(requiredField);
    }
    expect(normalizeWhitespace(mechanicalTaskExample)).toContain(
      "This exact token replacement is a single-file mechanical example that changes no behavior, authority, generated output, failure route, review rule, documentation navigation, or compatibility surface",
    );
    expect(mechanicalTaskExample).not.toContain("**Contract checklist:**");
    expect(mechanicalTaskExample).not.toContain("N/A");
    expect(validateNoTriggerExample(mechanicalTaskExample)).toEqual([]);

    const invalidChecklistLabel = mechanicalTaskExample.replace(
      "**Acceptance criteria:**",
      "**Contract checklist:** This label is invalid for NO-TRIGGER.\n\n**Acceptance criteria:**",
    );
    expect(validateNoTriggerExample(invalidChecklistLabel)).toEqual([
      "contract-checklist-label",
    ]);

    const invalidMissingReason = mechanicalTaskExample.replace(
      /\*\*NO-TRIGGER reason:\*\*[\s\S]*?(?=\n\*\*Acceptance criteria:\*\*)/u,
      "",
    );
    expect(validateNoTriggerExample(invalidMissingReason)).toEqual([
      "missing-task-specific-reason",
    ]);

    const invalidMissingMinimumProof = mechanicalTaskExample.replace(
      /\*\*Proof sufficiency:\*\*[\s\S]*?(?=\n\*\*Replace:\*\*)/u,
      "",
    );
    expect(validateNoTriggerExample(invalidMissingMinimumProof)).toEqual([
      "missing-minimum-proof",
    ]);

    expect(normalizedTaskStructure).toContain(
      "For `FULL` only: **Contract checklist:**",
    );
    expect(normalizedTaskStructure).toContain(
      "For `LIGHTWEIGHT` only: **Compact contract:**",
    );
    expect(normalizedTaskStructure).toContain(
      "For `NO-TRIGGER` only: **NO-TRIGGER reason:**",
    );
    expect(normalizedTaskStructure).toContain(
      "ordinary task fields, acceptance criteria, verification expectations, and proof sufficiency remain required for every tier",
    );
    expect(normalizedTaskStructure).toContain(
      "`FULL` tasks carry the complete contract checklist",
    );
    expect(normalizedTaskStructure).toContain(
      "`LIGHTWEIGHT` tasks carry every compact-contract field and the explicit reason all FULL triggers are absent",
    );
    expect(normalizedTaskStructure).toContain(
      "`NO-TRIGGER` tasks carry a task-specific reason no contract trigger applies",
    );

    expect(contractChecklist).toContain(
      "Review-routing hints remain non-authoritative inputs",
    );
    expect(normalizedContractChecklist).toContain(
      "Hard-risk triggers from `skills/play-subagent-execution/references/review-routing-policy.md` are not under-classified",
    );
    expect(normalizedContractChecklist).not.toContain(
      "Hard-risk triggers from `skills/play-subagent-execution/SKILL.md`",
    );
    expect(contractChecklist).toContain(
      "unclear cases default to `spec-and-quality`",
    );
    expect(contractChecklist).toContain(
      "foundation-producing tasks are not below `spec-only`",
    );
    expect(normalizedContractChecklist).toContain(
      "Field order is the task heading, required `**Task ID:**`, required `**Contract tier:**`, optional `**Mode:** mechanical`, optional review-routing hints, then `**Files:**`",
    );
    expect(playPlanning).toContain("references/planning-criteria.md");
    expect(playPlanning).toContain(
      "../play-subagent-execution/references/review-routing-policy.md",
    );
    expect(normalizeWhitespace(playPlanning)).toContain(
      "conditional one-level reference from this workflow",
    );

    const execution = await readSkillSource("play-subagent-execution");
    const normalizedExecution = normalizeWhitespace(execution);
    expect(normalizedExecution).toContain(
      "Both `LIGHTWEIGHT` and `NO-TRIGGER` are trusted only when this controller can identify the upstream two-gate `play-planning` return",
    );
    expect(normalizedExecution).toContain(
      "otherwise unreviewed plans without that upstream two-gate return must use a structurally complete `FULL` contract",
    );
  });

  it("keeps executor handling structural and planning-owned across contract tiers", async () => {
    const execution = await readSkillSource("play-subagent-execution");
    const normalizedExecution = normalizeWhitespace(execution);

    expect(normalizedExecution).toContain(
      "`play-planning` owns the trigger taxonomy and tier classification",
    );
    expect(normalizedExecution).toContain(
      "exactly one declared `**Contract tier:** FULL`, `LIGHTWEIGHT`, or `NO-TRIGGER`",
    );
    expect(normalizedExecution).toContain(
      "validates only its declared tier structure",
    );
    for (const lightweightField of [
      "named authority, owner, purpose, inputs and outputs",
      "material write or side-effect owner",
      "failure and cleanup behavior",
      "focused proof",
      "every actual known participant and direct producer-consumer relationship",
      "explicit reason every FULL trigger is absent",
    ]) {
      expect(normalizedExecution).toContain(lightweightField);
    }
    expect(normalizedExecution).toContain(
      "including guarded-inline D13 when it is an actual participant or direct consumer",
    );
    expect(normalizedExecution).toContain(
      "The controller consumes this same named context directly for guarded-inline D13; prompt-mediated consumers receive it through their curated prompt",
    );
    expect(normalizedExecution).toContain(
      "`NO-TRIGGER` requires a task-specific reason",
    );
    expect(normalizedExecution).toContain(
      "must not promote, demote, infer, or otherwise reclassify the tier",
    );
    expect(normalizedExecution).toContain(
      "path spelling, or runtime risk routing",
    );
    expect(normalizedExecution).toContain(
      "Both `LIGHTWEIGHT` and `NO-TRIGGER` are trusted only when this controller can identify the upstream two-gate `play-planning` return",
    );
    expect(normalizedExecution).toContain(
      "must use a structurally complete `FULL` contract",
    );
    expect(normalizedExecution).toContain(
      "Missing named authority or any known participant or direct producer-consumer relationship fails closed",
    );
  });

  it("keeps skip-dispatch upstream planning preconditions aligned with the two-gate plan return", async () => {
    const playSubagentExecution = await readSkillSource(
      "play-subagent-execution",
    );
    const skipDispatchPolicy = await readRepoFile(
      "skills/play-subagent-execution/references/skip-dispatch-policy.md",
    );
    const adr0007 = await readRepoFile(
      "docs/adr/adr-0007-review-pipeline-delineation.md",
    );
    const adr0015 = await readRepoFile(
      "docs/adr/adr-0015-skip-dispatch-for-trivial-single-task-plans.md",
    );
    const normalizedPlaySubagentExecution = normalizeWhitespace(
      playSubagentExecution,
    );
    const normalizedSkipDispatchPolicy =
      normalizeWhitespace(skipDispatchPolicy);
    const normalizedAdr0007 = normalizeWhitespace(adr0007);
    const normalizedAdr0015 = normalizeWhitespace(adr0015);

    for (const source of [
      normalizedPlaySubagentExecution,
      normalizedSkipDispatchPolicy,
      normalizedAdr0007,
      normalizedAdr0015,
    ]) {
      expect(source).toContain("two-gate `play-planning` return");
      expect(source).not.toContain("plan-review PASS");
      expect(source).not.toContain("plan-review returned PASS");
    }

    for (const liveContractSource of [
      normalizedPlaySubagentExecution,
      normalizedSkipDispatchPolicy,
      normalizedAdr0015,
    ]) {
      expect(liveContractSource).toContain(
        "both Plan Review and Implementer Executability Review passed before `Plan written to <path>.` was emitted",
      );
    }

    for (const tierAwareSource of [
      normalizedPlaySubagentExecution,
      normalizedSkipDispatchPolicy,
    ]) {
      expect(tierAwareSource).toContain("Both `LIGHTWEIGHT` and `NO-TRIGGER`");
      expect(tierAwareSource).toContain("structurally complete `FULL`");
    }
    expect(normalizedSkipDispatchPolicy).toContain(
      "declares `FULL`, `LIGHTWEIGHT`, or `NO-TRIGGER` and satisfies that tier's structure",
    );

    expect(normalizedAdr0015).toContain(
      "literal `**Contract tier:** FULL`, `LIGHTWEIGHT`, or `NO-TRIGGER` field",
    );
    expect(normalizedAdr0015).toContain(
      "validates only the declared tier's required structure",
    );
    expect(normalizedAdr0015).toContain(
      "Both reduced tiers require the reviewed two-gate provenance",
    );
    expect(normalizedAdr0015).toContain(
      "must use a structurally complete `FULL` contract",
    );
    expect(normalizedAdr0015).toContain(
      "No skip-dispatch-specific eligibility field is added",
    );
    expect(normalizedAdr0015).toContain(
      "the upstream literal Contract tier field is required",
    );

    for (const directInvocationFallbackSource of [
      normalizedPlaySubagentExecution,
      normalizedSkipDispatchPolicy,
      normalizedAdr0015,
    ]) {
      expect(directInvocationFallbackSource).toContain(
        "fall back to dispatched implementation",
      );
      expect(directInvocationFallbackSource).not.toContain(
        "treat this guardrail as PASS",
      );
      expect(directInvocationFallbackSource).not.toContain(
        "precondition is treated as satisfied",
      );
    }
  });

  it("keeps issue-priming references pointed at lazy play-subagent sources", async () => {
    const issuePrimingWorkflow = await readSkillSource(
      "issue-priming-workflow",
    );
    const phase7Reference = await readRepoFile(
      "skills/issue-priming-workflow/references/phase-7-review-handling.md",
    );
    const normalizedIssuePrimingWorkflow =
      normalizeWhitespace(issuePrimingWorkflow);
    const normalizedPhase7Reference = normalizeWhitespace(phase7Reference);

    expect(normalizedIssuePrimingWorkflow).toContain(
      "skip-dispatch path; see its [skip-dispatch policy](../play-subagent-execution/references/skip-dispatch-policy.md)",
    );
    expect(normalizedIssuePrimingWorkflow).not.toContain(
      "SKILL.md § Skip-Dispatch Path",
    );
    expect(normalizedPhase7Reference).toContain(
      "`branch-review --fix` owns fixable review feedback",
    );
    expect(normalizedIssuePrimingWorkflow).not.toContain(
      "`skills/play-subagent-execution/SKILL.md` § Edit-staleness rule",
    );
  });

  it("keeps executor-owned review route computation in source", async () => {
    const routing = await readRepoFile(
      "skills/play-subagent-execution/references/review-routing-policy.md",
    );
    const normalizedRouting = normalizeWhitespace(routing);

    expect(normalizedRouting).toContain(
      "Route computation MUST inspect the actual task diff using the captured task base/head SHAs",
    );
    expect(normalizedRouting).toContain(
      "If the changed-file/status/diff data is unavailable, stale, ambiguous, or shows an unplanned hard-risk trigger",
    );
    expect(routing).toContain("not only the plan text or hints");
    expect(routing).toContain("fail closed to `spec-and-quality`");
    expect(routing).toContain(
      "`play-subagent-execution` owns reviewer dispatch",
    );
    expect(routing).toContain("`none-final-only`");
    expect(routing).toContain(
      "Hard-risk, unclear, malformed, conflicting, or untrusted classifications",
    );
    expect(normalizedRouting).toContain(
      "If post-implementation diff inspection cannot verify that no hard-risk trigger is present, use `spec-and-quality`",
    );
    expect(routing).toContain("Hard-risk triggers force `spec-and-quality`");
    expect(routing).toContain("reviewer-routing policy");
    expect(routing).toContain("test harness or validation behavior changes");
  });

  it("keeps snapshot request classification high-risk triggers in source", async () => {
    const snapshotConsumption = await readRepoFile(
      "skills/play-subagent-execution/references/snapshot-consumption.md",
    );
    const normalizedSnapshotConsumption =
      normalizeWhitespace(snapshotConsumption);

    for (const trigger of SNAPSHOT_REQUEST_TRIGGER_CONTRACTS) {
      expect(normalizedSnapshotConsumption).toContain(trigger.skillPhrase);
    }
    expect(normalizedSnapshotConsumption).toContain(
      "Skip snapshots only for clearly localized, low-risk work",
    );
  });

  it("keeps executor plan-path intake separate from per-task implementer context", async () => {
    const playSubagentExecution = await readSkillSource(
      "play-subagent-execution",
    );
    const redFlags = await readRepoFile(
      "skills/play-subagent-execution/references/red-flags.md",
    );
    const normalizedExecution = normalizeWhitespace(playSubagentExecution);
    const normalizedRedFlags = normalizeWhitespace(redFlags);

    expect(normalizedExecution).toContain(
      "Only after the digest comparison passes does the controller read the plan from the path and proceed with task extraction",
    );
    expect(normalizedExecution).toContain(
      "Per-task implementer subagents continue to receive curated, inlined task text",
    );
    expect(normalizedExecution).toContain("they do NOT receive the path");
    expect(normalizedExecution).toContain(
      "controller state carries status, changed files, verification result, blockers, and artifact paths",
    );
    expect(normalizedExecution).toContain(
      "Large logs and side-channel artifacts stay out of implementer and reviewer prompts unless needed for failure diagnosis",
    );
    expect(normalizedRedFlags).toContain(
      "Make per-task implementer subagent read the plan file",
    );
    expect(normalizedRedFlags).toContain(
      "Skip-dispatch (see [skip-dispatch policy](skip-dispatch-policy.md))",
    );
    expect(normalizedRedFlags).not.toContain("SKILL.md § Skip-Dispatch Path");
    expect(normalizedRedFlags).toContain(
      "The controller MAY accept the plan via a `Plan: <path>` reference",
    );
  });

  it("keeps reduced-route auto-handoff and Phase 7 guarantees in source", async () => {
    const playSubagentExecution = await readSkillSource(
      "play-subagent-execution",
    );
    const issuePrimingWorkflow = await readSkillSource(
      "issue-priming-workflow",
    );
    const phase7Reference = await readRepoFile(
      "skills/issue-priming-workflow/references/phase-7-review-handling.md",
    );
    const phase6Reference = await readRepoFile(
      "skills/issue-priming-workflow/references/phase-6-auto-handoff.md",
    );
    const phase8Reference = await readRepoFile(
      "skills/issue-priming-workflow/references/phase-8-pr-handoff.md",
    );
    const autoHandoffReference = sliceBetween(
      playSubagentExecution,
      "### Auto handoff reference",
      "### Inline content",
    );
    const routingPolicy = await readRepoFile(
      "skills/play-subagent-execution/references/review-routing-policy.md",
    );
    const routingAdvantages = await readRepoFile(
      "skills/play-subagent-execution/references/advantages.md",
    );
    const exampleWorkflow = await readRepoFile(
      "skills/play-subagent-execution/references/example-workflow.md",
    );
    const routingAdr = await readRepoFile(
      "docs/adr/adr-0018-risk-based-per-task-review-routing.md",
    );
    const singleTaskPlans = getMarkdownSection(
      playSubagentExecution,
      "Single-Task Plans",
    );
    const phase6 = sliceBetween(
      issuePrimingWorkflow,
      "### Phase 6: Implement",
      "### Phase 7: Branch Review",
    );
    const phase7 = sliceBetween(
      issuePrimingWorkflow,
      "### Phase 7: Branch Review",
      "### Phase 8: Create PR",
    );
    const phase8 = sliceBetween(
      issuePrimingWorkflow,
      "### Phase 8: Create PR",
      "## Phase Flow Reference",
    );
    const normalizedRouting = normalizeWhitespace(routingPolicy);
    const normalizedRoutingAdvantages = normalizeWhitespace(routingAdvantages);
    const normalizedExampleWorkflow = normalizeWhitespace(exampleWorkflow);
    const normalizedRoutingAdr = normalizeWhitespace(routingAdr);
    const normalizedPhase6Reference = normalizeWhitespace(phase6Reference);
    const normalizedPhase6 = normalizeWhitespace(phase6);
    const normalizedPhase7 = normalizeWhitespace(phase7);
    const normalizedPhase8 = normalizeWhitespace(phase8);

    expect(autoHandoffReference).toContain(
      "ISSUE_PRIMING_AUTO_HANDOFF_VERIFIED=false",
    );
    expect(autoHandoffReference).toContain(
      "active parent-owned `issue-priming-workflow --auto` controller",
    );

    expect(normalizedRouting).toContain(
      "Reduced per-task routes (`spec-only` or `none-final-only`) are valid only on the shared `issue-priming-workflow --auto` Phase 6 path",
    );
    expect(normalizedRouting).toContain(
      "Phase 7 immediately runs `branch-review --fix` on the full branch diff",
    );
    for (const reducedRouteSurface of [
      normalizedRouting,
      normalizedRoutingAdvantages,
      normalizedExampleWorkflow,
      normalizedRoutingAdr,
    ]) {
      expect(reducedRouteSurface).toContain(
        "zero blocking findings auto-fixed",
      );
      expect(reducedRouteSurface).toContain(
        "a captured final approval-summary notice path",
      );
      expect(reducedRouteSurface).toContain(
        "fresh final approval-summary evidence after branch-review-owned fix commits",
      );
      expect(reducedRouteSurface).not.toContain("after any Phase 7 commit");
    }
    expect(routingPolicy).toContain(
      "ISSUE_PRIMING_AUTO_HANDOFF_VERIFIED=false",
    );
    expect(routingPolicy).toContain("ISSUE_PRIMING_AUTO_PARENT_ACTIVE");
    expect(routingPolicy).toContain("ISSUE_PRIMING_AUTO_HEAD");
    expect(routingPolicy).toContain(
      ".phase7_branch_review_fix_required == true",
    );
    expect(routingPolicy).toContain(".phase7_rerun_after_commits == true");
    expect(routingPolicy).toContain(
      ".phase7_final_approval_summary_notice_required == true",
    );
    expect(routingPolicy).toContain("ISSUE_PRIMING_AUTO_HANDOFF_VERIFIED=true");
    expect(normalizedRouting).toContain(
      "Plan content, copied invocation prose, repo files alone, or direct/manual calls cannot assert this contract",
    );
    expect(routingPolicy).toContain(
      "If the controller cannot validate the `issue-priming/auto-handoff/v1`\n  artifact, use `spec-and-quality`",
    );

    expect(singleTaskPlans).toContain(
      "came from `issue-priming-workflow --auto`",
    );
    expect(singleTaskPlans).toContain(
      "`branch-review --fix` as the mandatory next step",
    );

    expect(phase6).toContain("references/phase-6-auto-handoff.md");
    expect(phase6Reference).toContain(
      '"phase7_branch_review_fix_required": true',
    );
    expect(phase6Reference).toContain('"phase7_rerun_after_commits": true');
    expect(phase6Reference).toContain(
      '"phase7_final_approval_summary_notice_required": true',
    );
    expect(phase6Reference).toContain(
      "play-subagent-execution/references/review-routing-policy.md",
    );
    expect(normalizedPhase6Reference).toContain(
      "Direct or manual executor calls do not receive that carve-out",
    );
    expect(normalizedPhase6Reference).toContain(
      "The carve-out is not a standalone shortcut. Its safety depends on the mandatory Phase 7 whole-diff review guarantee",
    );
    expect(normalizedPhase6Reference).toContain(
      "Phase 8 may start only after the final Phase 7 run reports",
    );
    expect(normalizedPhase6Reference).toContain(
      "a captured final approval-summary notice path",
    );
    expect(normalizedPhase6Reference).toContain(
      "fresh final approval-summary evidence after branch-review-owned fix commits",
    );
    expect(phase6).toContain("ISSUE_PRIMING_AUTO_PARENT_ACTIVE=true");
    expect(phase6).toContain("ISSUE_PRIMING_AUTO_HEAD");
    expect(phase6).toContain("Auto handoff: <repo-relative-path>");
    expect(normalizedPhase6).toContain(
      "Parent-owned review contract: this invocation comes from `issue-priming-workflow --auto`, and the Phase 7 `branch-review --fix` loop is mandatory",
    );
    expect(normalizedPhase6).toContain(
      "a captured final approval-summary notice path",
    );
    expect(normalizedPhase6).toContain(
      "That final whole-diff review satisfies the final-review guarantee required by any reduced per-task review route",
    );

    expect(phase7).toContain("Invoke `branch-review --fix`");
    expect(normalizedPhase7).toContain(
      "If Phase 6 emitted `Risk signals written to <path>.`, invoke `branch-review --fix --risk-signals <path>` for default-base artifacts",
    );
    expect(normalizedPhase7).toContain(
      "If Phase 6 emitted detached issue-base risk signals whose reviewed range is `<full-base-sha>...HEAD`, invoke `branch-review --fix --risk-signals <path> <full-base-sha>`",
    );
    expect(normalizedPhase7).toContain(
      "If the run creates any branch-review-owned fix commit, regenerate risk signals for the new `HEAD` before rerunning `branch-review --fix --risk-signals <new-path>` with the same base-side rule",
    );
    expect(normalizedPhase7).toContain(
      "This runs the full multi-agent review on `git diff <base>...HEAD` where `<base>` is branch-review's selected base: normally the repository's default branch, or the supplied full base SHA for detached issue-base risk signals that use that same base side",
    );
    expect(normalizedPhase7).toContain(
      "After any branch-review-owned fix commit, rerun `branch-review --fix`",
    );
    expect(phase7).toContain("references/phase-7-review-handling.md");
    expect(phase7).toContain("prepare-judgment-nits");
    expect(phase7).toContain("-nits-pending.json");
    expect(normalizedPhase7).toContain(
      'no unresolved `severity: "Blocking"` entries except findings whose `critic` verdict is `INVALID` or `DOWNGRADE`',
    );
    expect(normalizedPhase7).toContain(
      'ignore `critic: "INVALID"` for continuation and never pass it to Phase 8',
    );
    expect(normalizedPhase7).toContain(
      'treat `critic: "DOWNGRADE"` as non-blocking, judgment-required feedback',
    );
    expect(normalizedPhase7).toContain(
      "After any branch-review-owned fix commit, rerun `branch-review --fix`",
    );
    expect(normalizedPhase7).toContain(
      "`skills/play-subagent-execution/references/snapshot-consumption.md` § Edit-Staleness Rule",
    );
    expect(normalizedPhase7).toContain(
      "passing only risk signals regenerated for that `HEAD` when using `--risk-signals`",
    );
    expect(phase7Reference).toContain("Review head: <40-hex-sha>.");
    expect(phase7Reference).toContain("Findings written to <path>.");
    expect(phase7Reference).toContain("PLAY_REVIEW_HELPER");
    expect(phase7Reference).toContain("validate the findings path");
    expect(phase7Reference).toContain("prepare-judgment-nits");
    expect(normalizeWhitespace(phase7Reference)).toContain(
      "For fixed nit-severity findings, branch-review-owned fix commit bodies include one trailer per addressed nit",
    );
    expect(phase7Reference).toContain(
      "Reported by branch-review at <path>:<line>",
    );
    expect(normalizeWhitespace(phase7Reference)).toContain(
      "normalizes selected `DOWNGRADE` copies to postable Nit form",
    );
    expect(phase8).toContain("references/phase-8-pr-handoff.md");
    expect(normalizedPhase8).toContain(
      "Pass judgment-required Phase 7 feedback only through `nits_file`",
    );
    expect(normalizedPhase8).toContain(
      "Phase 8 may start only after Phase 7 `branch-review --fix` completion criteria pass",
    );
    expect(normalizedPhase8).toContain(
      "no unresolved remaining `Blocking` findings except findings whose `critic` verdict is `INVALID` or `DOWNGRADE`",
    );
    expect(normalizedPhase8).toContain(
      "fresh final approval-summary evidence after any branch-review-owned fix commits",
    );
    expect(normalizeWhitespace(phase8Reference)).toContain(
      "Pass `nits_file` only when Phase 7 prepared a judgment-required-nits envelope",
    );
    expect(normalizeWhitespace(phase8Reference)).toContain(
      "Do not classify findings in Phase 8",
    );
    expect(normalizeWhitespace(phase8Reference)).toContain(
      "must not be embedded in the PR description body",
    );
  });

  it("pins issue-priming Phase 7 duplicate completion criteria to final approval-summary notice capture", async () => {
    const issuePrimingWorkflow = await readSkillSource(
      "issue-priming-workflow",
    );
    const phase7Reference = await readRepoFile(
      "skills/issue-priming-workflow/references/phase-7-review-handling.md",
    );
    const phase7 = sliceBetween(
      issuePrimingWorkflow,
      "### Phase 7: Branch Review",
      "### Phase 8: Create PR",
    );
    const eagerContinuation = normalizeWhitespace(
      sliceBetween(
        phase7,
        "Continue until a run reports zero blocking findings",
        "This runs the full multi-agent review",
      ),
    );
    const phase8Handoff = normalizeWhitespace(
      getMarkdownSection(phase7Reference, "Phase 8 Handoff"),
    );

    expect(eagerContinuation).toContain(
      "captures that final run's approval-summary notice path",
    );
    expect(eagerContinuation).toContain(
      "findings whose `critic` verdict is `INVALID` or `DOWNGRADE`",
    );
    expect(phase8Handoff).toContain(
      "fresh final approval-summary evidence after any branch-review-owned fix commits",
    );
    expect(phase8Handoff).toContain(
      "final approval-summary notice path captured from that same final run",
    );
    expect(phase8Handoff).toContain(
      "Phase 8 receives only judgment-required items",
    );
  });

  it("hands successful direct/manual execution off to play-branch-finish without copying finish choices", async () => {
    const playSubagentExecution = await readSkillSource(
      "play-subagent-execution",
    );
    const directManualHandoff = sliceBetween(
      playSubagentExecution,
      "### Direct/manual terminal handoff",
      "## Subagent Lifecycle",
    );
    const normalizedDirectManualHandoff =
      normalizeWhitespace(directManualHandoff);

    expect(normalizedDirectManualHandoff).toContain(
      "direct or manual invocation",
    );
    expect(normalizedDirectManualHandoff).toContain(
      "final whole-implementation review passes",
    );
    expect(normalizedDirectManualHandoff).toContain(
      "report implementation status and final review status before any branch-review or finish handoff",
    );
    expect(normalizedDirectManualHandoff).toContain(
      "invoke `play-branch-finish`",
    );
    expect(normalizedDirectManualHandoff).toContain(
      "`play-branch-finish` presents its authoritative finish options",
    );

    for (const copiedFinishChoicePattern of COPIED_BRANCH_FINISH_CHOICE_PATTERNS) {
      expect(directManualHandoff).not.toMatch(copiedFinishChoicePattern);
    }
  });

  it("reports direct/manual branch-level review status before play-branch-finish handoff", async () => {
    const playSubagentExecution = await readSkillSource(
      "play-subagent-execution",
    );
    const singleTaskPlans = sliceBetween(
      playSubagentExecution,
      "## Single-Task Plans",
      "### Direct/manual terminal handoff",
    );
    const directManualHandoff = sliceBetween(
      playSubagentExecution,
      "### Direct/manual terminal handoff",
      "## Subagent Lifecycle",
    );
    const normalizedSingleTaskPlans = normalizeWhitespace(singleTaskPlans);
    const normalizedDirectManualHandoff =
      normalizeWhitespace(directManualHandoff);

    expect(normalizeWhitespace(playSubagentExecution)).toContain(
      "Single-task plans skip per-task review and use the final whole-implementation reviewer plus direct/manual branch-level review status resolution",
    );
    expect(normalizeWhitespace(playSubagentExecution)).not.toContain(
      "rely on the final whole-implementation reviewer for direct/manual calls",
    );
    expect(normalizedSingleTaskPlans).toContain(
      "[Direct/manual terminal handoff](#directmanual-terminal-handoff); that section owns branch-level review status resolution and pre-finish reporting",
    );
    expect(normalizedSingleTaskPlans).not.toContain(
      "the user can still run `branch-review` manually",
    );
    expect(normalizedSingleTaskPlans).not.toContain(
      "stop before `play-branch-finish` when the active workflow requires branch-level review before PR creation",
    );
    expect(normalizedDirectManualHandoff).toContain(
      "built-in final whole-implementation review passed",
    );
    expect(normalizedDirectManualHandoff).toContain(
      "this skill did not run branch-level review",
    );
    expect(normalizedDirectManualHandoff).toContain(
      "run `branch-review` before `play-branch-finish` when the active workflow requires branch-level review before PR creation",
    );
    expect(normalizedDirectManualHandoff).toContain(
      "proceeding to `play-branch-finish` is acceptable only when that workflow does not require branch-level review",
    );
    expect(normalizedDirectManualHandoff).toContain(
      "When the active workflow requires branch-level review before PR creation, hand off to `branch-review` before any `play-branch-finish` handoff",
    );
    expect(normalizedDirectManualHandoff).toContain(
      "Use `branch-review --fix` as the branch-level gate before finish only when the owning workflow already grants auto-fix authority or the operator explicitly confirms that branch-review may auto-commit fixes",
    );
    expect(normalizedDirectManualHandoff).toContain(
      "otherwise hand off to branch-review without auto-fix authority and wait for review approval evidence",
    );
    expect(normalizedDirectManualHandoff).toContain(
      "Do not invoke `play-branch-finish` until `branch-review` returns review approval evidence or the active workflow explicitly waives branch-level review",
    );
    expect(normalizedDirectManualHandoff).toContain(
      "If that workflow does not require branch-level review, then invoke `play-branch-finish`",
    );

    const branchReviewHandoffIndex = normalizedDirectManualHandoff.indexOf(
      "hand off to `branch-review` before any `play-branch-finish` handoff",
    );
    const approvalEvidenceIndex = normalizedDirectManualHandoff.indexOf(
      "`branch-review` returns review approval evidence",
    );
    const conditionalFinishHandoffIndex = normalizedDirectManualHandoff.indexOf(
      "then invoke `play-branch-finish`",
    );
    expect(branchReviewHandoffIndex).toBeGreaterThanOrEqual(0);
    expect(approvalEvidenceIndex).toBeGreaterThanOrEqual(0);
    expect(conditionalFinishHandoffIndex).toBeGreaterThanOrEqual(0);
    expect(branchReviewHandoffIndex).toBeLessThan(approvalEvidenceIndex);
    expect(approvalEvidenceIndex).toBeLessThan(conditionalFinishHandoffIndex);

    for (const branchReviewStatusClaim of [
      "built-in final whole-implementation review passed",
      "this skill did not run branch-level review",
      "run `branch-review` before `play-branch-finish` when the active workflow requires branch-level review before PR creation",
      "proceeding to `play-branch-finish` is acceptable only when that workflow does not require branch-level review",
    ]) {
      const statusClaimIndex = normalizedDirectManualHandoff.indexOf(
        branchReviewStatusClaim,
      );

      expect(statusClaimIndex).toBeGreaterThanOrEqual(0);
      expect(statusClaimIndex).toBeLessThan(conditionalFinishHandoffIndex);
    }

    for (const copiedFinishChoicePattern of COPIED_BRANCH_FINISH_CHOICE_PATTERNS) {
      expect(directManualHandoff).not.toMatch(copiedFinishChoicePattern);
    }
  });

  it("hands review-required direct/manual completion to branch-review before finish", async () => {
    const playSubagentExecution = await readSkillSource(
      "play-subagent-execution",
    );
    const directManualHandoff = sliceBetween(
      playSubagentExecution,
      "### Direct/manual terminal handoff",
      "## Subagent Lifecycle",
    );
    const normalizedDirectManualHandoff =
      normalizeWhitespace(directManualHandoff);

    expect(normalizedDirectManualHandoff).not.toContain(
      "so the operator can run `branch-review` first",
    );
  });

  it("keeps direct/manual references aligned with branch-review status resolution", async () => {
    const playSubagentExecution = await readSkillSource(
      "play-subagent-execution",
    );
    const advantages = await readRepoFile(
      "skills/play-subagent-execution/references/advantages.md",
    );
    const exampleWorkflow = await readRepoFile(
      "skills/play-subagent-execution/references/example-workflow.md",
    );
    const redFlags = await readRepoFile(
      "skills/play-subagent-execution/references/red-flags.md",
    );
    const normalizedSkill = normalizeWhitespace(playSubagentExecution);
    const normalizedAdvantages = normalizeWhitespace(advantages);
    const normalizedExampleWorkflow = normalizeWhitespace(exampleWorkflow);
    const normalizedRedFlags = normalizeWhitespace(redFlags);

    expect(normalizedSkill).toContain(
      "[Direct/manual terminal handoff](#directmanual-terminal-handoff); that section owns branch-level review status resolution and pre-finish reporting",
    );
    expect(normalizedSkill).toContain(
      "hand off to `branch-review` before any `play-branch-finish` handoff",
    );
    expect(normalizedExampleWorkflow).toContain(
      "report implementation and final review status -> resolve branch-level review status",
    );
    expect(normalizedExampleWorkflow).toContain(
      "hand off to `branch-review --fix` before `play-branch-finish` when the active workflow requires branch-level review before PR creation",
    );
    expect(normalizedExampleWorkflow).toContain(
      "invoke `play-branch-finish` only when branch-level review is not required",
    );
    expect(normalizedAdvantages).toContain(
      "final code-quality reviewer plus direct/manual branch-level review status resolution",
    );
    expect(normalizedRedFlags).toContain(
      "resolving branch-level review status on the direct/manual path",
    );
    expect(normalizedRedFlags).toContain(
      "a review-required workflow must hand off to `branch-review` before `play-branch-finish`",
    );
    expect(normalizedRedFlags).toContain(
      "use `branch-review --fix` only with owning-workflow authority or explicit operator confirmation for auto-committed fixes",
    );

    for (const staleUnconditionalHandoff of [
      "terminal handoff to `play-branch-finish`",
      "final whole-implementation code-quality reviewer -> `play-branch-finish`",
      "invoking `play-branch-finish` on the direct/manual path",
      "run `branch-review` yourself before opening a PR if you want whole-diff coverage",
    ]) {
      expect(normalizedSkill).not.toContain(staleUnconditionalHandoff);
      expect(normalizedAdvantages).not.toContain(staleUnconditionalHandoff);
      expect(normalizedExampleWorkflow).not.toContain(
        staleUnconditionalHandoff,
      );
      expect(normalizedRedFlags).not.toContain(staleUnconditionalHandoff);
    }
  });

  it("keeps play-subagent related skills from owning branch-review", async () => {
    const playSubagentExecution = await readSkillSource(
      "play-subagent-execution",
    );
    const integrationStartIndex =
      playSubagentExecution.indexOf("## Integration");
    expect(integrationStartIndex).toBeGreaterThanOrEqual(0);

    const integrationSection = playSubagentExecution.slice(
      integrationStartIndex,
    );
    const normalizedIntegrationSection =
      normalizeWhitespace(integrationSection);

    expect(normalizedIntegrationSection).toContain("Related workflow skills");
    expect(normalizedIntegrationSection).toContain(
      "**branch-review** - External branch-level review before finish when the active workflow requires it",
    );
    expect(normalizedIntegrationSection).toContain(
      "**play-branch-finish** - Complete development after review status is resolved",
    );
    expect(normalizedIntegrationSection).not.toContain(
      "Required workflow skills",
    );
    expect(normalizedIntegrationSection).not.toContain(
      "Code review for reviewer subagents",
    );
  });

  it("makes direct/manual implementation, verification, and review summaries non-terminal", async () => {
    const playSubagentExecution = await readSkillSource(
      "play-subagent-execution",
    );
    const directManualHandoff = sliceBetween(
      playSubagentExecution,
      "### Direct/manual terminal handoff",
      "## Subagent Lifecycle",
    );
    const normalizedDirectManualHandoff =
      normalizeWhitespace(directManualHandoff);

    expect(normalizedDirectManualHandoff).toContain(
      "implementation summaries, verification summaries, and review pass reports are status reports only",
    );
    expect(normalizedDirectManualHandoff).toContain(
      "they are not terminal workflow states",
    );
    expect(normalizedDirectManualHandoff).toContain(
      "After the final whole-implementation review passes, the next action is to resolve the branch-level review status above and then either hand off for required branch review, wait until that review status is resolved, or invoke `play-branch-finish` when branch review is not required",
    );
    expect(normalizedDirectManualHandoff).toContain(
      "summary-only completion is a workflow violation",
    );
  });

  it("continues auto issue priming from Phase 6 completion to Phase 7 and Phase 8 unless blocked", async () => {
    const issuePrimingWorkflow = await readSkillSource(
      "issue-priming-workflow",
    );
    const phase6 = sliceBetween(
      issuePrimingWorkflow,
      "### Phase 6: Implement",
      "### Phase 7: Branch Review",
    );
    const normalizedPhase6 = normalizeWhitespace(phase6);

    expect(normalizedPhase6).toContain(
      "Successful `play-subagent-execution` completion returns control to this owning workflow",
    );
    expect(normalizedPhase6).toContain("Phase 6 completion is not terminal");
    expect(normalizedPhase6).toContain(
      "continue to Phase 7 and Phase 8 unless a concrete blocker stops `--auto`",
    );

    for (const copiedFinishChoicePattern of COPIED_BRANCH_FINISH_CHOICE_PATTERNS) {
      expect(issuePrimingWorkflow).not.toMatch(copiedFinishChoicePattern);
    }
  });

  it("keeps interactive issue priming from owning child skill gates after brainstorming handoff", async () => {
    const issuePrimingWorkflow = await readSkillSource(
      "issue-priming-workflow",
    );
    const phase4 = sliceBetween(
      issuePrimingWorkflow,
      "## Phase 4: Invoke Brainstorming",
      "## Phases 5-8: Autonomous Execution (`--auto` only)",
    );
    const normalizedPhase4 = normalizeWhitespace(phase4);

    expect(normalizedPhase4).toContain(
      "Without `--auto`: hand off to `play-brainstorm` and return control to the user after `play-brainstorm` completes",
    );
    expect(normalizedPhase4).toContain(
      "`play-brainstorm` owns its approved handoff to `play-planning`",
    );
    expect(normalizedPhase4).toContain(
      "do not suppress or replace child skill approval gates",
    );
  });

  it("keeps spec-and-quality concurrent same-head review semantics in source", async () => {
    const skillSource = await readSkillSource("play-subagent-execution");
    const routing = await readRepoFile(
      "skills/play-subagent-execution/references/review-routing-policy.md",
    );
    const handlingStatus = await readRepoFile(
      "skills/play-subagent-execution/references/lifecycle-status-policy.md",
    );
    const lifecycle = handlingStatus;
    const redFlags = await readRepoFile(
      "skills/play-subagent-execution/references/red-flags.md",
    );
    const exampleWorkflow = await readRepoFile(
      "skills/play-subagent-execution/references/example-workflow.md",
    );
    const advantages = await readRepoFile(
      "skills/play-subagent-execution/references/advantages.md",
    );
    const codeQualityReviewerPrompt = await readRepoFile(
      "skills/play-subagent-execution/references/code-quality-reviewer-prompt.md",
    );
    const adr0007 = await readRepoFile(
      "docs/adr/adr-0007-review-pipeline-delineation.md",
    );
    const adr0018 = await readRepoFile(
      "docs/adr/adr-0018-risk-based-per-task-review-routing.md",
    );
    const normalizedSkill = normalizeWhitespace(skillSource);
    const normalizedRouting = normalizeWhitespace(routing);
    const normalizedHandlingStatus = normalizeWhitespace(handlingStatus);
    const normalizedLifecycle = normalizeWhitespace(lifecycle);
    const normalizedRedFlags = normalizeWhitespace(redFlags);
    const normalizedExample = normalizeWhitespace(exampleWorkflow);
    const normalizedAdvantages = normalizeWhitespace(advantages);
    const normalizedCodeQualityReviewerPrompt = normalizeWhitespace(
      codeQualityReviewerPrompt,
    );
    const normalizedAdr0007 = normalizeWhitespace(adr0007);
    const normalizedAdr0018 = normalizeWhitespace(adr0018);

    expect(normalizedSkill).toContain(
      "Hard-risk and unclear multi-task tasks select `spec-and-quality`, which assigns D14 and D15 to the task",
    );
    expect(normalizedRouting).toContain(
      "`spec-and-quality`: after route computation and implementer commit, the controller selects both D14 and D15 for the task",
    );
    expect(normalizedRouting).toContain(
      "After selection, [`lifecycle-status-policy.md`](lifecycle-status-policy.md) owns reviewer result disposition, freshness, fix invalidation, guard failures, and incomplete or terminal transitions",
    );
    expect(normalizedHandlingStatus).toContain(
      "Every fix commit invalidates both D14 and D15 results, including a previously passing or provisional result; both reviews must run fresh against the new same task head",
    );
    expect(normalizedRouting).not.toContain(
      "Every fix commit invalidates both D14 and D15 results",
    );
    expect(normalizedSkill).not.toContain("quality-only rerun proven valid");
    expect(normalizedLifecycle).toContain(
      "reviewer result disposition (`pending`, `final-pass`, `final-findings`, `advisory`, `stale`, or `superseded`)",
    );
    expect(normalizedHandlingStatus).toContain(
      "A quality result may become final only after same-head spec pass and current task-head validation",
    );
    expect(normalizedHandlingStatus).toContain(
      "concurrent quality findings may be routed with the spec findings as advisory same-head context",
    );
    expect(normalizedHandlingStatus).toContain(
      "advisory, stale, and superseded quality results remain lifecycle evidence but must not mark the task complete",
    );

    expect(normalizedRedFlags).toContain(
      "Apply a stale or incomplete reviewer result instead of using the [lifecycle/status policy](lifecycle-status-policy.md)",
    );
    expect(normalizedRedFlags).not.toContain(
      "Every fix commit invalidates both D14 and D15 results",
    );
    expect(normalizedRedFlags).not.toContain("unless irrelevance is proven");
    expect(normalizedRedFlags).not.toContain(
      "unclear stale classification reruns quality",
    );
    expect(normalizedRedFlags).not.toContain(
      "Start code quality review before spec compliance is ✅",
    );

    expect(normalizedExample).toContain(
      "Parallel happy path: same-head spec and quality pass",
    );
    expect(normalizedExample).toContain("Spec-failure stale-quality path");
    expect(normalizedExample).toContain(
      "Task 2 D14 and D15 results: dispositions=stale; the fix invalidates both results",
    );
    expect(normalizedExample).toContain(
      "combined spec and code-quality finding set routed to Task 2 implementer",
    );
    expect(normalizedExample).toContain(
      "closed=yes after advisory findings captured and routed",
    );
    expect(normalizedExample).not.toContain(
      "closed=no until disposition is stale, superseded, or final",
    );
    expect(normalizedExample).toContain(
      "Cleanup gate before Task 2 code-quality re-reviewer spawn",
    );

    expect(normalizedAdvantages).toContain(
      "hard-risk and unclear tasks use same-head `spec-and-quality` review",
    );
    expect(normalizedAdvantages).toContain(
      "quality disposition is final only after same-head spec pass plus current-head validation",
    );
    expect(normalizedCodeQualityReviewerPrompt).toContain(
      "D15 and D16 are separate response-only `deep-reviewer`, frontier/xhigh, source-immutable sessions with zero handoffs",
    );
    expect(normalizedCodeQualityReviewerPrompt).toContain(
      "`lifecycle-status-policy.md` owns D15/D16 dispatch timing, same-head disposition, invalidation, and terminal transitions",
    );

    const playSubagentSurface = normalizeWhitespace(
      [
        skillSource,
        redFlags,
        exampleWorkflow,
        advantages,
        codeQualityReviewerPrompt,
      ].join("\n"),
    );
    for (const staleSerialPhrase of [
      "spec compliance review first, then code quality review",
      "run after spec compliance review passes",
      "spec compliance, then code quality",
      "Start code quality review before spec compliance is ✅",
    ]) {
      expect(playSubagentSurface).not.toContain(staleSerialPhrase);
    }

    expect(normalizedAdr0007).toContain(
      "A later refinement to the `spec-and-quality` route named here permits concurrent read-only spec-compliance and code-quality dispatch against the same committed task head while preserving the semantic spec-first gate",
    );
    expect(normalizedAdr0007).toContain(
      "the final whole-implementation reviewer remains the built-in implementation review before terminal handoff",
    );
    expect(normalizedAdr0007).toContain(
      "when the active workflow requires branch-level review before PR creation, it hands off to `branch-review` before any `play-branch-finish` handoff and waits for branch-review approval evidence or an explicit waiver",
    );
    expect(normalizedAdr0007).toContain(
      "only workflows without that requirement invoke `play-branch-finish` without branch-review approval evidence",
    );
    expect(normalizedAdr0007).not.toContain(
      "must stop for `branch-review` before `play-branch-finish`",
    );
    expect(normalizedAdr0007).not.toContain(
      "operators may run `branch-review` manually for additional whole-diff coverage",
    );
    expect(normalizedAdr0007).not.toContain("GitHub issue #344");
    expect(normalizedAdr0018).toContain(
      "`spec-and-quality` is a concurrent same-head fork/join route when practical, not a serial-order guarantee",
    );
    expect(normalizedAdr0018).toContain(
      "Quality disposition is final only after same-head spec pass and current-head validation; advisory, stale, and superseded quality results cannot complete the task",
    );
  });

  it("keeps D14 and D15 as independent guarded deep-review sessions", async () => {
    const skillSource = await readSkillSource("play-subagent-execution");
    const routing = await readRepoFile(
      "skills/play-subagent-execution/references/review-routing-policy.md",
    );
    const lifecycle = await readRepoFile(
      "skills/play-subagent-execution/references/lifecycle-status-policy.md",
    );
    const specPrompt = await readRepoFile(
      "skills/play-subagent-execution/references/spec-reviewer-prompt.md",
    );
    const qualityPrompt = await readRepoFile(
      "skills/play-subagent-execution/references/code-quality-reviewer-prompt.md",
    );
    const d15DispatchFields = getMarkdownSection(
      qualityPrompt,
      "D15 dispatch fields",
    );
    const normalizedSurface = normalizeWhitespace(
      [skillSource, routing, lifecycle].join("\n"),
    );

    for (const route of ["D14", "D15"]) {
      expect(normalizedSurface).toContain(
        `${route} is a separate response-only \`deep-reviewer\`, frontier/xhigh and source-immutable, with zero handoffs`,
      );
    }
    expect(normalizedSurface).toContain(
      "D14 and D15 inspect the same captured task head but use separate sessions, separate prompts, separate baselines, and independent GUARD-001 lifecycles",
    );
    expect(normalizedSurface).toContain(
      "capture before spawn verify before semantic validation or consumption validate and retain the response in controller memory cleanup the exact retained baseline apply the retained result only after cleanup",
    );
    expect(normalizedSurface).toContain(
      "Every fix commit invalidates both D14 and D15 results, including a previously passing or provisional result; both reviews must run fresh against the new same task head",
    );
    expect(normalizedSurface).toContain(
      "After safe cleanup, an unavailable, failed, malformed, or verification-rejected D14 or D15 keeps the task incomplete and returns `BLOCKED` naming the failed review; no verdict passes",
    );
    expect(normalizedSurface).toContain(
      "Detected source mutation or cleanup failure is guard-integrity terminal",
    );
    expect(specPrompt).toContain(
      "paired with the source agent at [`agents/deep-reviewer.yaml`]",
    );
    expect(specPrompt).toContain("D14 question:");
    expect(normalizeWhitespace(specPrompt)).toContain(
      "**D14 question:** Does the implementation at the supplied task head satisfy Task N exactly, including its extracted contract, without missing or extra behavior?",
    );
    expect(qualityPrompt).toContain(
      "paired with the source agent at [`agents/deep-reviewer.yaml`]",
    );
    expect(qualityPrompt).toContain("D15 question:");
    expect(qualityPrompt).toContain("D16 question:");
    expect(normalizeWhitespace(qualityPrompt)).toContain(
      "**D15 question:** Is Task N at the supplied task head well-built, clean, tested, and maintainable within its task-local scope?",
    );
    expect(normalizeWhitespace(qualityPrompt)).toContain(
      "**D16 question:** Is the complete implementation over the supplied whole-range base/head well-built, clean, tested, maintainable, and ready for its owning terminal handoff?",
    );
    expect(normalizeWhitespace(qualityPrompt)).toContain(
      "`lifecycle-status-policy.md` owns D15/D16 dispatch timing, same-head disposition, invalidation, and terminal transitions",
    );
    expect(normalizeWhitespace(qualityPrompt)).not.toContain(
      "Its result is provisional until same-head D14 passes",
    );
    expect(normalizeWhitespace(qualityPrompt)).not.toContain(
      "Any fix invalidates both results",
    );
    expect(d15DispatchFields).toContain(
      "WHAT_WAS_IMPLEMENTED: [from implementer's report]",
    );
    expect(d15DispatchFields).toContain(
      "PLAN_OR_REQUIREMENTS: Task N from [plan-file]",
    );
    expect(d15DispatchFields).toContain("BASE_SHA: [commit before task]");
    expect(d15DispatchFields).toContain("DESCRIPTION: [task summary]");
  });

  it("keeps D16 distinct with the narrow skip and fresh guarded review loop", async () => {
    const skillSource = await readSkillSource("play-subagent-execution");
    const lifecycle = await readRepoFile(
      "skills/play-subagent-execution/references/lifecycle-status-policy.md",
    );
    const exampleWorkflow = await readRepoFile(
      "skills/play-subagent-execution/references/example-workflow.md",
    );
    const qualityPrompt = await readRepoFile(
      "skills/play-subagent-execution/references/code-quality-reviewer-prompt.md",
    );
    const d16DispatchFields = getMarkdownSection(
      qualityPrompt,
      "D16 dispatch fields",
    );
    const normalizedSurface = normalizeWhitespace(
      [skillSource, lifecycle, exampleWorkflow].join("\n"),
    );

    expect(normalizedSurface).toContain(
      "D16 is a fresh response-only `deep-reviewer`, frontier/xhigh and source-immutable, with zero handoffs, after all tasks complete",
    );
    expect(normalizedSurface).toContain(
      "D16 reviews the whole implementation range and never reuses or collapses the D15 task-quality session",
    );
    expect(normalizedSurface).toContain(
      "The only D16 skip is the exact ADR-0016 verified `issue-priming-workflow --auto` single-task carve-out",
    );
    expect(normalizedSurface).toContain(
      "A passing retained D16 result continues to the owning-caller or direct/manual terminal path only after cleanup",
    );
    expect(normalizedSurface).toContain(
      "D16 blocking findings keep final review incomplete, route to the D12 implementer for a fix, and require a fresh D16 capture, spawn, verify, validate, cleanup, and apply cycle after the fix commit",
    );
    expect(normalizedSurface).toContain(
      "After safe cleanup, an unavailable, failed, malformed, or verification-rejected D16 keeps final review incomplete and returns `BLOCKED` to the owning caller or direct/manual terminal-status path; it never enters branch finish",
    );
    expect(normalizedSurface).toContain(
      "D16 detected source mutation or cleanup failure is guard-integrity terminal",
    );
    expect(d16DispatchFields).toContain(
      "WHOLE_IMPLEMENTATION_SUMMARY: [whole-range implementation summary]",
    );
    expect(d16DispatchFields).toContain(
      "PLAN_OR_REQUIREMENTS: [whole-plan or authoritative requirements]",
    );
    expect(d16DispatchFields).toContain(
      "ORIGINAL_BASE_SHA: [commit before the first task]",
    );
    expect(d16DispatchFields).toContain(
      "CURRENT_HEAD_SHA: [current committed implementation head]",
    );
    expect(d16DispatchFields).toContain(
      "WHOLE_IMPLEMENTATION_SCOPE: [complete changed-file and requirement scope]",
    );
    expect(d16DispatchFields).not.toContain("WHAT_WAS_IMPLEMENTED");
    expect(d16DispatchFields).not.toContain("implementer's report");
    expect(normalizeWhitespace(qualityPrompt)).toContain(
      "D16 does not require or assume a task-local implementer report and therefore supports guarded inline D13",
    );
  });

  it("keeps subagent-lifecycle owner policy in the source skill", async () => {
    const skillSource = await readSkillSource("subagent-lifecycle");
    const normalizedSkillSource = normalizeWhitespace(skillSource);
    const controllerLifecycleLedger = getMarkdownSection(
      skillSource,
      "Controller Lifecycle Ledger",
    );
    const targetLifecycleCapability = getMarkdownSection(
      skillSource,
      "Target Lifecycle Capability",
    );
    const cleanupGateBeforeSpawns = getMarkdownSection(
      skillSource,
      "Cleanup Gate Before Spawns",
    );
    const slotLimitRecovery = getMarkdownSection(
      skillSource,
      "Slot-Limit Recovery",
    );
    const capabilityEscalation = getMarkdownSection(
      skillSource,
      "Eligible Quality-Failure Capability Escalation",
    );
    const deterministicClassifier = sliceBetween(
      skillSource,
      "### Deterministic Five-Family Classifier",
      "### Declaration, Support, and Exactness",
    );
    const escalationEntry = sliceBetween(
      skillSource,
      "## Eligible Quality-Failure Capability Escalation",
      "### Deterministic Five-Family Classifier",
    );

    const normalizedEscalation = normalizeWhitespace(capabilityEscalation);
    expectSubstringsInOrder(normalizeWhitespace(escalationEntry), [
      "after a delegated attempt and its guard/lifecycle cleanup outcome settle",
      "Classify regardless of whether cleanup succeeded or eligibility is positive",
      "Successful cleanup and positive eligible-quality evidence are conditions only for validating and starting a fresh attempt",
    ]);
    for (const boundary of [
      "`eligible-quality-failure` (`eligible quality failure`)",
      "complete and current context",
      "usable authorized tools, sandbox, approval, and target operation",
      "sufficient unchanged authority",
      "successful guard/lifecycle cleanup",
      "consumable verified evidence",
      "material capability-sensitive quality gap",
      "`ineligible-context`",
      "Missing, ambiguous, stale, unreadable, or new-owner-decision context",
      "`ineligible-tool-or-permission`",
      "Absent, denied, or unusable tools, sandbox, approval, or target operation",
      "`ineligible-authority`",
      "Widened scope or insufficient source, external, or mutation authority",
      "`ineligible-integrity-or-route`",
      "Guard or cleanup mutation, stale head or evidence, unresolved route, or unsupported or undeclared exact transition",
      "first matching ineligible condition prevents eligibility",
      "not automatically eligible",
    ]) {
      expect(normalizedEscalation).toContain(boundary);
    }
    for (const validShapeField of [
      "Shape-only canonical valid example",
      "hypothetical named target `example-target-v1`",
      "hypothetical route `example-quality-route`",
      "same semantic role=`implementer`",
      "exact current tuple=`balanced/high`",
      "exact next tuple=`frontier/high`",
      "already-verified support mechanism `example-target-v1 exact-tuple registry`",
      "supports both exact current and next tuples",
      "budget=`1`",
      "classification=`eligible quality failure`",
      "attempted actions",
      "task identity, scope, acceptance contract, curated context, tools, sandbox, approval, source and external authority, network, mutation paths, output schema, guard lifecycle, and termination owner",
      "verified repository anchors",
      "unresolved success condition",
      "remaining budget",
      "terminal continuation=`existing terminal/manual route`",
      "This hypothetical example grants no ambient runtime support",
    ]) {
      expect(normalizedEscalation).toContain(validShapeField);
    }
    expectSubstringsInOrder(normalizeWhitespace(deterministicClassifier), [
      "`ineligible-context`",
      "`ineligible-tool-or-permission`",
      "`ineligible-authority`",
      "`ineligible-integrity-or-route`",
      "`eligible-quality-failure`",
    ]);
    for (const classifierRule of [
      "every remaining failure of the positive eligibility predicates",
      "absent, inconsistent, or unconsumable verified evidence",
      "remaining gap that is not capability-sensitive",
      "Blank, malformed, unavailable, failed, or timed-out results deterministically fall into `ineligible-integrity-or-route` unless an earlier predicate applies",
      "A cleanup failure enters `ineligible-integrity-or-route`",
      "Only when none of the four ineligible predicates applies and every positive predicate is satisfied",
    ]) {
      expect(normalizeWhitespace(deterministicClassifier)).toContain(
        classifierRule,
      );
    }
    for (const [family, mutation, classification] of [
      [
        "Missing context",
        "Context is missing or ambiguous",
        "`ineligible-context`",
      ],
      [
        "Omitted next effort",
        "The requested next tuple omits effort",
        "`ineligible-integrity-or-route`",
      ],
      [
        "Ambient or nearby substitution",
        "ambient, alias, fallback, or nearby pair",
        "`ineligible-integrity-or-route`",
      ],
      [
        "Invariant change",
        "another preserved invariant changes",
        "`ineligible-integrity-or-route`",
      ],
      [
        "Budget greater than `1`",
        "budget is greater than one fresh attempt",
        "`ineligible-integrity-or-route`",
      ],
      [
        "Raw evidence transfer",
        "raw prompt, transcript, log, stack trace, credential, or environment value",
        "`ineligible-integrity-or-route`",
      ],
      [
        "Duplicate or missing route",
        "duplicate or omits a D-route",
        "existing terminal/manual route",
      ],
    ] as const) {
      const row = markdownTableRow(capabilityEscalation, family);
      expect(row).toContain(mutation);
      expect(row).toContain(classification);
      expect(row).toContain("stop; do not spawn");
    }
    expectSubstringsInOrder(normalizeWhitespace(capabilityEscalation), [
      "Retain verified evidence",
      "Complete guard/lifecycle cleanup",
      "Classify the settled result",
      "Validate declaration/support/invariants/budget",
      "Spawn exactly one fresh attempt",
    ]);

    expect(controllerLifecycleLedger).toContain(
      "agent-local/controller-local state",
    );
    for (const ledgerDimension of [
      "session identity when available",
      "role and task, phase, or review scope",
      "current operational state: `active`, `waiting`, `interrupted`, or `completed`",
      "observed reuse when relevant",
      "inventory evidence when relevant",
      "captured role result",
      "current cleanup outcome: `closed=yes`, `closed=no`, or `close-unavailable: <reason>`",
    ]) {
      expect(normalizeWhitespace(controllerLifecycleLedger)).toContain(
        ledgerDimension,
      );
    }
    expect(normalizeWhitespace(controllerLifecycleLedger)).toContain(
      "`reusable` and `inventory-only` are not operational states",
    );
    expect(normalizeWhitespace(controllerLifecycleLedger)).toContain(
      "Waiting, interruption, completion, inventory, and reuse are not closure",
    );
    expect(normalizeWhitespace(controllerLifecycleLedger)).toContain(
      "Capture the role-specific result before cleanup or supersession",
    );
    expect(normalizeWhitespace(controllerLifecycleLedger)).toContain(
      "Supersession is a workflow/controller decision recorded with the captured role result after the required role-specific state is captured",
    );
    expect(normalizeWhitespace(controllerLifecycleLedger)).toContain(
      "It never replaces the session's actual operational state",
    );
    expect(normalizeWhitespace(controllerLifecycleLedger)).toContain(
      "Cleanup eligibility reads that captured supersession decision",
    );
    expect(normalizeWhitespace(controllerLifecycleLedger)).toContain(
      "do not invent a `superseded` operational state or add a separate ledger dimension",
    );

    const capabilityClasses = [
      {
        firstCell: "`automatic-close-supported`",
        evidence: "Stable identity and an exposed, usable close operation",
        cleanupClaim:
          "A close may be attempted; `closed=yes` still requires an observed successful close result",
      },
      {
        firstCell: "`inventory-only`",
        evidence:
          "Session identity or inventory, but no usable close operation",
        cleanupClaim:
          "Record inventory and `close-unavailable: inventory-only; no close operation`",
      },
      {
        firstCell: "`cleanup-unavailable`",
        evidence: "Neither reliable inventory nor a usable close operation",
        cleanupClaim:
          "Record `close-unavailable: no inventory or close operation` and give operator/UI cleanup steps",
      },
    ] as const;
    for (const capabilityClass of capabilityClasses) {
      const row = markdownTableRow(
        targetLifecycleCapability,
        capabilityClass.firstCell,
      );
      expect(row).toContain(capabilityClass.evidence);
      expect(row).toContain(capabilityClass.cleanupClaim);
    }

    const surfaceMappings = [
      {
        surface: "Local Codex",
        evidence:
          "Model-visible requests to steer, stop, or close tasks or threads do not prove identically named low-level actions",
      },
      {
        surface: "Responses API Multi-agent",
        evidence:
          "hosted inventory exists, but no hosted close action is documented",
      },
      {
        surface: "Claude Code",
        evidence:
          "Classify only from capabilities observed in the current runtime; inherit no Local Codex, Responses API, or other provider assumption",
      },
      {
        surface: "Unknown or future agent target",
        evidence:
          "Classify only from capabilities observed in that runtime; inherit no known-provider assumption",
      },
    ] as const;
    for (const surfaceMapping of surfaceMappings) {
      const row = markdownTableRow(
        targetLifecycleCapability,
        surfaceMapping.surface,
      );
      expect(row).toContain(surfaceMapping.evidence);
    }

    const responsesActionSet =
      /documented hosted action set is exactly\s+([\s\S]*?)\. `interrupt_agent`/.exec(
        targetLifecycleCapability,
      );
    expect(responsesActionSet).not.toBeNull();
    const documentedResponsesActions = [
      ...(responsesActionSet?.[1].matchAll(/`([a-z_]+)`/g) ?? []),
    ].map((match) => match[1]);
    expect(documentedResponsesActions).toEqual([
      "spawn_agent",
      "send_message",
      "followup_task",
      "wait_agent",
      "interrupt_agent",
      "list_agents",
    ]);
    expect(targetLifecycleCapability).not.toContain("close_agent");
    expect(normalizeWhitespace(targetLifecycleCapability)).toContain(
      "`interrupt_agent` stops an active turn without deleting its context and is never closure",
    );
    expect(normalizeWhitespace(targetLifecycleCapability)).toContain(
      "session identity=`resp-1`; role/scope=`researcher`/assigned scope; current operational state=`interrupted`; observed reuse=retained context available to `followup_task`; inventory evidence=session observed through `list_agents`; captured role result=partial report; current cleanup outcome=`close-unavailable: inventory-only; no close operation`",
    );
    expect(normalizeWhitespace(targetLifecycleCapability)).toContain(
      "`closed=yes` requires all three observed facts for that session: a stable identity, an exposed usable close operation, and a successful close result",
    );

    expect(cleanupGateBeforeSpawns).toContain(
      "Before every new subagent spawn",
    );
    expect(normalizeWhitespace(cleanupGateBeforeSpawns)).toContain(
      "sessions whose captured role result records a workflow/controller supersession decision",
    );
    expect(normalizeWhitespace(cleanupGateBeforeSpawns)).toContain(
      "Keep sessions open when the owning workflow still requires same-session follow-up",
    );
    expect(normalizeWhitespace(cleanupGateBeforeSpawns)).toContain(
      "Mark `closed=yes` only after observing a successful close result for that stable session identity and exposed usable close operation",
    );
    expectSubstringsInOrder(normalizeWhitespace(cleanupGateBeforeSpawns), [
      "Capture the role-specific state needed by the owning workflow",
      "before closing any session or recording its supersession decision",
      "When the target is `automatic-close-supported`, attempt to close",
      "after the required state is recorded",
      "Mark `closed=yes` only after observing a successful close result",
      "When the target is `inventory-only` or `cleanup-unavailable`, first capture the same role-specific state",
      "then record the `close-unavailable` reason",
    ]);

    expect(slotLimitRecovery).toContain("orchestration resource exhaustion");
    expect(normalizeWhitespace(slotLimitRecovery)).toContain(
      "Wait for operator confirmation that manual cleanup is complete before continuing",
    );
    expect(slotLimitRecovery).toContain(
      "Reconstruct active workflow state from the lifecycle ledger",
    );
    expect(normalizeWhitespace(slotLimitRecovery)).toContain(
      "Retry the spawn exactly once after automatic cleanup completes or after the operator confirms manual cleanup",
    );
    expect(slotLimitRecovery).toContain(
      "Repeated failures after the single retry are not permission to keep spawning",
    );
    for (const unchangedRecoveryAnchor of [
      "Run the cleanup gate for all completed or superseded sessions",
      "surface explicit operator/UI cleanup guidance",
      "sanitized open-agent inventory",
      "Wait for operator confirmation that manual cleanup is complete",
      "Reconstruct active workflow state from the lifecycle ledger",
      "Retry the spawn exactly once",
      "stop and escalate to the user with a sanitized summary",
    ]) {
      expect(normalizeWhitespace(slotLimitRecovery)).toContain(
        unchangedRecoveryAnchor,
      );
    }

    expect(normalizedSkillSource).not.toContain(
      "play-subagent-execution owns task execution",
    );
  });

  it("keeps ADR-0020 aligned with subagent-lifecycle source ownership", async () => {
    const adr = await readRepoFile(
      "docs/adr/adr-0020-subagent-lifecycle-ownership.md",
    );
    const decision = getMarkdownSection(adr, "Decision");
    const consequences = getMarkdownSection(adr, "Consequences");

    expect(decision).toContain(
      "Generic subagent lifecycle cleanup guidance is owned by the internal\n`subagent-lifecycle` skill",
    );
    for (const ownedSurface of [
      "compact controller-local ledger dimensions",
      "three target lifecycle capability classes",
      "four-surface capability map for Local Codex, Responses API Multi-agent, Claude Code, and unknown targets",
      "target-honest conditional cleanup outcomes",
      "cleanup gates before spawns",
      "slot-limit recovery and one retry after cleanup or manual confirmation",
    ]) {
      expect(normalizeWhitespace(decision)).toContain(ownedSurface);
    }
    expect(normalizeWhitespace(decision)).toContain(
      "Responses API Multi-agent's documented hosted set is exactly `spawn_agent`, `send_message`, `followup_task`, `wait_agent`, `interrupt_agent`, and `list_agents`",
    );
    expect(normalizeWhitespace(decision)).toContain(
      "Interruption stops an active turn without deleting its context; it is not closure",
    );
    expect(normalizeWhitespace(decision)).toContain(
      "`closed=yes` only when the controller observes all three session facts: stable identity, an exposed usable close operation, and a successful close result",
    );
    expect(normalizeWhitespace(decision)).toContain(
      "Supersession is a workflow/controller decision recorded with the captured role result after required role-specific state is captured",
    );
    expect(normalizeWhitespace(decision)).toContain(
      "It does not replace the session's actual operational state or add another ledger dimension. Cleanup eligibility reads that captured decision",
    );
    expect(decision).toContain(
      "`play-subagent-execution` owns task execution, per-task review routing,\nimplementer snapshot consumption, and same-session implementer fix-loop\nexceptions",
    );
    expect(decision).toContain(
      "The lifecycle ledger remains controller-local state",
    );
    expect(consequences).toContain(
      "Target capability claims remain target-honest",
    );
    expect(consequences).toContain(
      "Slot-limit failures are handled as orchestration resource exhaustion",
    );
    expect(consequences).toContain("Workflow-local exceptions remain explicit");
    expect(normalizeWhitespace(consequences)).toContain(
      "not an event-sourced lifecycle engine, retention proof system, or duplicated consumer recovery algorithm",
    );
  });

  it("keeps play-subagent-execution lifecycle delegation and local exceptions in source", async () => {
    const skillSource = await readSkillSource("play-subagent-execution");
    const lifecycleSummary = getMarkdownSection(
      skillSource,
      "Subagent Lifecycle",
    );
    const lifecycle = await readRepoFile(
      "skills/play-subagent-execution/references/lifecycle-status-policy.md",
    );
    const handlingStatus = lifecycle;
    const normalizedLifecycle = normalizeWhitespace(lifecycle);
    const normalizedHandlingStatus = normalizeWhitespace(handlingStatus);

    expect(lifecycleSummary).toContain("Use `subagent-lifecycle`");
    expect(normalizedLifecycle).toContain(
      "generic controller lifecycle ledger, target lifecycle capability classification, cleanup gate before spawns, target-honest cleanup outcomes, and slot-limit recovery",
    );
    expect(normalizedLifecycle).toContain(
      "`play-subagent-execution` owns only the execution-specific lifecycle details below",
    );
    expect(normalizedLifecycle).toContain(
      "role-specific captured state includes D12 implementer and D13 executor reports, changed files, test results, snapshot state (`requested`, `emitted`, `skipped`, or `malformed`), reviewer scope, reviewer report, concrete findings, reviewer result disposition (`pending`, `final-pass`, `final-findings`, `advisory`, `stale`, or `superseded`), routing target, re-review target, task base/head SHA, reviewed head SHA, fixup count, and blocker state",
    );
    expect(normalizedLifecycle).toContain(
      "Run the shared cleanup gate before dispatching the next implementer, reviewer, re-reviewer, or final reviewer",
    );
    expect(normalizedLifecycle).toContain(
      "same-session D14 or D15 reviewer fix loops may still route fixups back to that implementer session",
    );
    expect(normalizedLifecycle).toContain(
      "preserve the implementer session until every reviewer loop required by the task's effective route passes",
    );
    expect(skillSource).not.toContain("\n## Controller Lifecycle Ledger\n");

    expect(normalizedHandlingStatus).toContain(
      "Before acting on any returned D12 implementer or dispatched D13 executor status, update the lifecycle ledger for that session with the status and the artifacts that status actually provides",
    );
    expect(normalizedHandlingStatus).toContain(
      "For `DONE` and `DONE_WITH_CONCERNS`, capture the report, snapshot state (`requested`, `emitted`, `skipped`, or `malformed`), changed-file list, base/head SHA, and test result before dispatching reviewers",
    );
    expect(normalizedHandlingStatus).toContain(
      "When snapshot state is `skipped`, use the default DONE fields plus controller-computed git/disk reads",
    );
    expect(normalizedHandlingStatus).toContain(
      "When snapshot state is `malformed`, surface the incident and still fall back to the default DONE fields plus controller-computed git/disk reads",
    );
    expect(normalizedHandlingStatus).toContain(
      "For `NEEDS_CONTEXT` and `BLOCKED`, capture the status, report or blocker/context request, `agent_id`, and any available base/head SHA",
    );
    expect(normalizedHandlingStatus).toContain(
      "do not wait for snapshot, changed-file, or test artifacts that were not produced",
    );
    expect(normalizedHandlingStatus).toContain(
      "The cleanup gate must not close a task implementer while same-session D14 or D15 reviewer fix loops may still route fixups back to that implementer session",
    );
    expect(normalizedHandlingStatus).toContain(
      "If a spawned D12 implementer reports BLOCKED after slot-limit recovery succeeds and the blocker family already appears in the lifecycle ledger for that task",
    );
  });

  it("keeps lifecycle evidence in the play-subagent example workflow source", async () => {
    const exampleWorkflow = await readRepoFile(
      "skills/play-subagent-execution/references/example-workflow.md",
    );
    const task1Section = sliceBetween(
      exampleWorkflow,
      "Task 1: Hook lifecycle",
      "Task 2: Recovery and repair modes",
    );
    const task2Section = sliceBetween(
      exampleWorkflow,
      "Task 2: Recovery and repair modes",
      "Task 3: Low-risk example copy",
    );
    const task3Section = sliceBetween(
      exampleWorkflow,
      "Task 3: Low-risk example copy",
      "[Mark Task 3 complete]",
    );
    const targetCapabilityExamples = sliceBetween(
      exampleWorkflow,
      "[Alternative target capability examples - separate runs",
      "Done!",
    );
    const automaticCloseRun = sliceBetween(
      exampleWorkflow,
      "Target capability for this run: automatic-close-supported",
      "[Alternative target capability examples - separate runs",
    );

    expect(exampleWorkflow).toContain(
      "generic\nlifecycle ledger, target capability classes, cleanup gate, target-honest\ncleanup outcomes, and slot-limit recovery live in `subagent-lifecycle`",
    );
    expect(exampleWorkflow).toContain(
      "[Use subagent-lifecycle to detect target lifecycle capability]",
    );
    expect(exampleWorkflow).toContain("Ledger pre-dispatch");
    expect(exampleWorkflow).toContain("Ledger post-dispatch");
    expect(exampleWorkflow).toContain("agent_id=pending");
    expect(exampleWorkflow).toContain(
      "Every later implementer, reviewer, re-reviewer, and final reviewer dispatch gets its own row",
    );

    expect(normalizeWhitespace(task1Section)).toContain(
      "status=DONE, report captured, base/head SHA captured, changed files captured, snapshot state=emitted, test state captured, closed=no because reviewer fix loops may still need same-session follow-up",
    );
    expect(task1Section).toContain(
      "Parallel happy path: same-head spec and quality pass",
    );
    expect(task1Section).toContain("base/head SHA captured (head pending)");
    expect(task1Section).toContain("Lifecycle cleanup checkpoint");
    expect(task1Section).toContain("closed=yes after PASS verdict recorded");
    expect(task3Section).toContain("snapshot state=skipped");
    expect(normalizeWhitespace(task3Section)).toContain(
      "The implementer must report the default DONE fields: status, summary, tests, files changed, base SHA, and head SHA.",
    );
    expect(normalizeWhitespace(task3Section)).toContain(
      "Status: DONE - Summary: Clarified one example sentence in a neutral demo note - Tests: Not applicable beyond final render/check suite - Files changed: docs/examples/demo-note.md - Base SHA: task-3-base - Head SHA: task-3-head",
    );

    expect(task2Section).toContain("Spec-failure stale-quality path");
    expect(task2Section).toContain(
      "Cleanup gate before Task 2 spec re-review spawn",
    );
    expect(task2Section).toContain(
      "Cleanup gate before Task 2 code-quality re-reviewer spawn",
    );
    expect(task2Section).toContain(
      "Task 2 code-quality reviewer: agent_id=quality-2, status=findings-recorded",
    );
    expect(task2Section).toContain(
      "findings captured: Missing progress reporting",
    );
    expect(task2Section).toContain("routing target=Task 2 implementer");
    expect(task2Section).toContain("re-review target=spec-2-rereview");
    expect(task2Section).toContain("report refreshed");
    expect(task2Section).toContain("test state refreshed");
    expect(task2Section).toContain("snapshot state=emitted");
    expect(task2Section).toContain("[Revalidate effective review route]");
    expect(task2Section).toContain(
      "Controller compares the original Task 2 base SHA to the refreshed task head",
    );
    expect(task2Section).toContain("The route may only preserve or escalate");
    expect(task2Section).toContain("so continue to fresh D14 spec review");
    expect(task2Section).toContain("fresh D15 quality");
    expect(task2Section).toContain("findings captured: Magic number (100)");
    expect(task2Section).toContain("re-review target=quality-2-rereview");
    expect(task2Section).toContain(
      "Task 2 D14 and D15 results: dispositions=stale; the fix invalidates both results",
    );
    expect(task2Section).toContain(
      "Task 2 code-quality re-reviewer: review scope captured",
    );
    expect(task2Section).not.toContain(
      "Task 2 code-quality re-reviewer: status=PASS",
    );

    expect(normalizeWhitespace(task3Section)).toContain(
      "closed=yes after the effective route completed",
    );
    expect(exampleWorkflow).toContain(
      "Cleanup gate before fresh D16 deep-reviewer spawn",
    );
    expect(exampleWorkflow).toContain("D16 deep-reviewer");
    expect(exampleWorkflow).toContain("review scope captured");

    const automaticClosureClaims = [
      ...automaticCloseRun.matchAll(/closed=yes/g),
    ];
    expect(automaticClosureClaims.length).toBeGreaterThan(0);
    for (const claim of automaticClosureClaims) {
      const claimIndex = claim.index ?? 0;
      expect(
        normalizeWhitespace(
          automaticCloseRun.slice(Math.max(0, claimIndex - 80), claimIndex),
        ),
      ).toContain("observed close result=success");
    }

    expect(targetCapabilityExamples).toContain(
      "Responses API Multi-agent inventory-only target variant",
    );
    const exampleResponsesActions =
      /Hosted actions: ([^\n]+) — exactly these six\./.exec(
        targetCapabilityExamples,
      );
    expect(exampleResponsesActions).not.toBeNull();
    expect(
      [...(exampleResponsesActions?.[1].matchAll(/`([a-z_]+)`/g) ?? [])].map(
        (match) => match[1],
      ),
    ).toEqual([
      "spawn_agent",
      "send_message",
      "followup_task",
      "wait_agent",
      "interrupt_agent",
      "list_agents",
    ]);
    expect(targetCapabilityExamples).not.toContain("close_agent");
    expect(targetCapabilityExamples).toContain(
      "inventory-only: target exposes session inventory but no hosted close operation",
    );
    expect(targetCapabilityExamples).toContain(
      "captures each completed session's role-specific state before cleanup or supersession",
    );
    expect(targetCapabilityExamples).toContain(
      "close-unavailable: inventory-only; no close operation",
    );
    expect(normalizeWhitespace(targetCapabilityExamples)).toContain(
      "current operational state=`interrupted`; wait observation=settled after `wait_agent`; observed reuse=retained context available to `followup_task`; inventory evidence=`list_agents` returned `impl-1`",
    );
    expect(normalizeWhitespace(targetCapabilityExamples)).toContain(
      "`interrupt_agent` stopped the active turn without deleting its context; interruption is never closure",
    );
    expect(targetCapabilityExamples).toContain(
      "cleanup-unavailable: target exposes neither inventory nor close operation",
    );
    expect(targetCapabilityExamples).toContain("Slot-limit spawn failure");
    expect(targetCapabilityExamples).toContain(
      "Controller classifies a slot-limit spawn failure as orchestration resource exhaustion, not task failure",
    );
    expect(targetCapabilityExamples).toContain(
      "records `close-unavailable: no inventory or close operation`",
    );
    expect(targetCapabilityExamples).toContain(
      "waits for operator confirmation that manual cleanup is complete",
    );
    expect(targetCapabilityExamples).toContain(
      "reconstructs active task state from the lifecycle ledger and git",
    );
    expect(targetCapabilityExamples).toContain(
      "then retries the spawn exactly once",
    );
    expect(targetCapabilityExamples).toContain(
      "Repeated blocker-family branch",
    );
    expect(targetCapabilityExamples).toContain(
      "Controller runs the cleanup gate",
    );
    expect(targetCapabilityExamples).toContain("Initial blocker-family record");
    expect(targetCapabilityExamples).toContain(
      "blocker state=context-missing: needs target install path",
    );
    expect(targetCapabilityExamples).toContain(
      "close-unavailable: no inventory or close operation after BLOCKED report",
    );
  });

  it("keeps issue-priming phase 6 lifecycle cleanup before execution handoff in source", async () => {
    const issuePrimingWorkflow = await readSkillSource(
      "issue-priming-workflow",
    );
    const issuePhase6Section = sliceBetween(
      issuePrimingWorkflow,
      "### Phase 6: Implement",
      "### Phase 7: Branch Review",
    );

    expect(issuePhase6Section).toContain(
      "Before the Phase 6 handoff, run the `subagent-lifecycle` cleanup gate",
    );
    expect(normalizeWhitespace(issuePhase6Section)).toContain(
      "close them when the target is `automatic-close-supported`, or record the target-honest `close-unavailable` outcome before invoking `play-subagent-execution`",
    );
    expect(issuePhase6Section.indexOf("`subagent-lifecycle`")).toBeLessThan(
      issuePhase6Section.indexOf("Invoke `play-subagent-execution`"),
    );
  });

  it("binds parent and executor plan handoffs to the reviewed digest", async () => {
    const issuePrimingWorkflow = await readSkillSource(
      "issue-priming-workflow",
    );
    const playReviewResponse = await readSkillSource("play-review-response");
    const playSubagentExecution = await readSkillSource(
      "play-subagent-execution",
    );
    const issuePhase6Section = sliceBetween(
      issuePrimingWorkflow,
      "### Phase 6: Implement",
      "### Phase 7: Branch Review",
    );
    const reviewExecutionMode = getMarkdownSection(
      playReviewResponse,
      "Execution Mode Selection",
    );
    const executorInputs = getMarkdownSection(playSubagentExecution, "Inputs");

    for (const parent of [issuePhase6Section, reviewExecutionMode]) {
      const normalizedParent = normalizeWhitespace(parent);

      expect(normalizedParent).toContain("Reviewed digest: <sha256>");
      expect(normalizedParent).toContain("Expected digest: <sha256>");
      expect(normalizedParent).toContain("`awk '{print $1}'`");
      expect(normalizedParent).toContain("lowercase 64-hex");
      expect(normalizedParent).toContain("mismatch stops before");
    }

    const normalizedExecutorInputs = normalizeWhitespace(executorInputs);
    expect(executorInputs).toContain(
      "Plan: <repo-relative-path>\nExpected digest: <sha256>",
    );
    expect(normalizedExecutorInputs).toContain(
      "before reading, extracting, routing, or dispatching any task",
    );
    expect(normalizedExecutorInputs).toContain(
      "never replace the expected digest with the current file digest",
    );
    expect(normalizedExecutorInputs).toContain(
      "do not create a digest artifact, helper, parser, or registry",
    );
  });

  it("pins executor risk-signals as bounded non-authoritative branch-review input", async () => {
    const executor = await readSkillSource("play-subagent-execution");
    const routingReference = await readRepoFile(
      "skills/play-subagent-execution/references/review-routing-policy.md",
    );
    const helper = await readRepoFile(
      "skills/play-subagent-execution/scripts/write-risk-signals.sh",
    );
    const normalizedExecutor = normalizeWhitespace(executor);
    const normalizedRoutingReference = normalizeWhitespace(routingReference);
    const normalizedHelper = normalizeWhitespace(helper);

    expect(executor).toContain("scripts/write-risk-signals.sh");
    expect(executor).toContain("branch-review/risk-signals/v1");
    expect(executor).toContain("Risk signals written to <path>.");
    expect(normalizedExecutor).toContain(
      "risk signals are non-authoritative branch-review input",
    );
    expect(normalizedExecutor).toContain(
      "Notice is emitted only after the helper write and runtime validation succeed",
    );
    expect(normalizedExecutor).toContain(
      "after implementation and the applicable per-task/final review path",
    );
    for (const requiredEnvName of [
      "RISK_SIGNALS_REVIEWED_BASE_REF",
      "RISK_SIGNALS_REVIEWED_BASE_SHA",
      "RISK_SIGNALS_REVIEWED_HEAD_SHA",
      "RISK_SIGNALS_REVIEWED_RANGE",
      "RISK_SIGNALS_CHANGED_FILES_JSON",
      "RISK_SIGNALS_VALUES_JSON",
      "RISK_SIGNALS_CANONICAL_DOCS_MAY_BE_AFFECTED",
      "RISK_SIGNALS_END_USER_DIAGNOSTICS_MAY_BE_AFFECTED",
      "RISK_SIGNALS_CONTRACT_EXAMPLE_DISCIPLINE_CONTEXT_JSON",
    ]) {
      expect(executor).toContain(requiredEnvName);
    }
    for (const signalCategory of [
      "user_facing_behavior",
      "documentation_examples",
      "diagnostics",
      "contract",
      "generated_output",
      "governance_path",
    ]) {
      expect(executor).toContain(signalCategory);
    }
    expect(normalizedExecutor).toContain(
      "Each value is `none`, `present`, or `unknown`; ambiguous/unclear classifications must be encoded as `unknown`, not omitted",
    );
    expect(normalizedExecutor).toContain(
      "`RISK_SIGNALS_REVIEWED_RANGE` and `RISK_SIGNALS_CHANGED_FILES_JSON` must describe the same full branch range that the next branch-review invocation will validate",
    );
    expect(normalizedExecutor).toContain(
      "`RISK_SIGNALS_REVIEWED_BASE_REF` must match that range's base side",
    );
    expect(normalizedExecutor).toContain(
      "For detached issue-base reviews, use the full base SHA as both `RISK_SIGNALS_REVIEWED_BASE_REF` and the left side of `RISK_SIGNALS_REVIEWED_RANGE`",
    );
    expect(normalizedExecutor).toContain("contract_example_discipline");
    expect(normalizedExecutor).toContain(
      "extracted-plan-task-execution-context",
    );
    expect(normalizedExecutor).toContain(
      "equivalent clearly labeled section/obligation",
    );
    expect(normalizedExecutor).toContain(
      "If present obligations cannot be represented in that bounded object",
    );
    expect(normalizedExecutor).toContain(
      "If the helper fails when terminal handoff was promised or expected, report a blocker and do not emit the notice",
    );
    expect(normalizedExecutor).toContain(
      "When the helper emits `Risk signals written to <path>.`, pass that emitted path to the next branch review invocation",
    );
    expect(normalizedExecutor).toContain(
      "Default-base artifacts use the normal no-positional-base form: `branch-review --risk-signals <path>`",
    );
    expect(normalizedExecutor).toContain(
      "in an auto-fix loop, `branch-review --fix --risk-signals <path>`",
    );
    expect(normalizedExecutor).toContain(
      "Detached issue-base artifacts whose reviewed range is `<full-base-sha>...HEAD` must pass that same full base SHA as branch-review's positional base",
    );
    expect(normalizedExecutor).toContain(
      "`branch-review --risk-signals <path> <full-base-sha>`",
    );
    expect(normalizedExecutor).toContain(
      "`branch-review --fix --risk-signals <path> <full-base-sha>`",
    );
    expect(normalizedExecutor).toContain(
      "regenerate risk signals for the new `HEAD` before rerunning branch review, or omit the stale risk-signals path intentionally",
    );
    expect(normalizedExecutor).toContain(
      "This skill did not run branch-level review; run `branch-review` before `play-branch-finish` when the active workflow requires branch-level review",
    );
    expect(helper).toContain(
      'target=".ephemeral/${slug}-${RISK_SIGNALS_REVIEWED_HEAD_SHA}-risk-signals.json"',
    );
    expect(helper).toContain("LC_ALL=C tr -c 'A-Za-z0-9._-' '-'");
    expect(helper).toContain("*..*");
    expect(helper).toContain(
      "require_full_branch_range_env RISK_SIGNALS_REVIEWED_RANGE",
    );
    expect(helper).toContain("must be a full branch range ending in ...HEAD");
    expect(helper).toMatch(
      /temp_file="\.ephemeral\/\.\$\{slug\}-\$\{RISK_SIGNALS_REVIEWED_HEAD_SHA\}-risk-signals\.[^"]+-risk-signals\.json"/u,
    );
    expect(helper).toContain('prepare_write_target "$target"');
    expect(helper).toContain('write_payload "$temp_file"');
    expect(helper).toContain("validate-risk-signals");
    expect(helper).toContain("validateContractExampleDisciplineContext");
    expect(helper).toContain("--surface branch-review");
    expect(helper).toContain("--expected-schema branch-review/risk-signals/v1");
    expect(helper).toContain("--expected-reviewed-range");
    expect(helper).toContain('mv -f "$temp_file" "$target"');
    expect(helper).toContain(
      "printf 'Risk signals written to %s.\\n' \"$target\"",
    );
    expect(normalizedHelper).toContain(
      "RISK_SIGNALS_VALUES_JSON must contain exactly the six required signal keys with none, present, or unknown values",
    );
    expect(helper).not.toMatch(/\b(branch-review|play-review)\b.*--fix/);
    expect(helper).not.toMatch(/\bgh\s+(api|pr|issue)\b/);
    expect(normalizedExecutor).not.toMatch(
      /risk signals (approve|certify|determine|establish) PR-readiness/i,
    );
    expect(normalizedExecutor).not.toMatch(
      /risk signals (approve|authorize|narrow) branch review/i,
    );
    expect(normalizedExecutor).not.toContain(
      "permission to narrow branch review",
    );

    expect(normalizedRoutingReference).toContain(
      "hard-risk categories inform bounded signal values",
    );
    expect(normalizedRoutingReference).toContain(
      "branch-review independently validates and decides scope",
    );
    expect(normalizedRoutingReference).not.toContain(
      "risk signals authorize narrow review",
    );
  });

  const d17Route =
    "branch `diagnosis`: `investigator`, balanced/high, source-immutable; branch `exact-fix`: `executor`, efficient/medium, source-mutable; branch `judgment-fix`: `implementer`, balanced/high, source-mutable";

  const parserRepresentationProbes: Array<{
    name: string;
    mutate: (sources: EscalationConsumerSources) => EscalationConsumerSources;
  }> = [
    {
      name: "D17 branch slug rename on both owner projections",
      mutate: (sources) => ({
        ...sources,
        adoptionInventory: mutateAdoptionRecord(
          replaceRequired(
            sources.adoptionInventory,
            "branch `diagnosis`",
            "branch `diagnosis-next`",
          ),
          "D17",
          (record) => {
            (
              record.direct_route_clauses as Record<string, unknown>[]
            )[0].branch_id = "diagnosis-next";
          },
        ),
      }),
    },
    {
      name: "complete fourth D17 table clause and descriptor",
      mutate: (sources) => ({
        ...sources,
        adoptionInventory: mutateAdoptionRecord(
          replaceRequired(
            sources.adoptionInventory,
            d17Route,
            `${d17Route}; branch \`verification\`: \`reviewer\`, frontier/high, source-immutable`,
          ),
          "D17",
          (record) => {
            (record.direct_route_clauses as Record<string, unknown>[]).push({
              role_id: "reviewer",
              branch_id: "verification",
            });
          },
        ),
      }),
    },
    {
      name: "coherent complete D17 table clause and descriptor reorder",
      mutate: (sources) => ({
        ...sources,
        adoptionInventory: mutateAdoptionRecord(
          replaceRequired(
            sources.adoptionInventory,
            d17Route,
            "branch `exact-fix`: `executor`, efficient/medium, source-mutable; branch `diagnosis`: `investigator`, balanced/high, source-immutable; branch `judgment-fix`: `implementer`, balanced/high, source-mutable",
          ),
          "D17",
          (record) => {
            record.direct_route_clauses = [
              { role_id: "executor", branch_id: "exact-fix" },
              { role_id: "investigator", branch_id: "diagnosis" },
              { role_id: "implementer", branch_id: "judgment-fix" },
            ];
          },
        ),
      }),
    },
    {
      name: "D3 network slug change on both owner projections",
      mutate: (sources) => ({
        ...sources,
        adoptionInventory: mutateAdoptionRecord(
          replaceRequired(
            sources.adoptionInventory,
            "network-binding `dispatch-named`",
            "network-binding `dispatch-curated`",
          ),
          "D3",
          (record) => {
            record.direct_route_clauses = [
              {
                role_id: "investigator",
                network_binding: "dispatch-curated",
                evidence_qualifier: "named-network",
              },
            ];
          },
        ),
      }),
    },
    {
      name: "D13 selection slug change on both owner projections",
      mutate: (sources) => ({
        ...sources,
        adoptionInventory: mutateAdoptionRecord(
          replaceRequired(
            sources.adoptionInventory,
            "selection-mode `inline-or-delegated`",
            "selection-mode `delegated-only`",
          ),
          "D13",
          (record) => {
            record.direct_route_clauses = [
              { role_id: "executor", selection_mode: "delegated-only" },
            ];
          },
        ),
      }),
    },
  ];

  for (const probe of parserRepresentationProbes) {
    it(`accepts coherent parser representation probe: ${probe.name}`, async () => {
      const sources = await readEscalationConsumerSources();
      const mutated = probe.mutate(sources);

      expect(mutated.adoptionInventory).not.toBe(sources.adoptionInventory);
      expect(validateEscalationConsumerContracts(mutated)).toEqual([]);
    });
  }

  it("rejects one-dimension-invalid consumer escalation declarations", async () => {
    const sources = await readEscalationConsumerSources();

    expect(validateEscalationConsumerContracts(sources)).toEqual([]);

    const readableD1Before = "`assessor`, balanced/medium, source-immutable";
    const readableD1After = "`investigator`, balanced/high, source-immutable";
    const structuredD1Before =
      '"route_id":"D1","adoption_ref":"ESC-ADOPT-D1","target_ids":["claude","codex"],"target_permission":"exact-only","role_permission":"same-role-must-match","direct_route_clauses":[{"role_id":"assessor"}]';
    const structuredD1After =
      '"route_id":"D1","adoption_ref":"ESC-ADOPT-D1","target_ids":["claude","codex"],"target_permission":"exact-only","role_permission":"same-role-must-match","direct_route_clauses":[{"role_id":"investigator"}]';
    const coherentD1OwnerChange = {
      ...sources,
      adoptionInventory: replaceRequired(
        replaceRequired(
          sources.adoptionInventory,
          readableD1Before,
          readableD1After,
        ),
        structuredD1Before,
        structuredD1After,
      ),
    };
    const canonicalD1 = parseAgentRoutingPolicyOwner(
      sources.adoptionInventory,
    ).directChildRoutes.find((route) => route.id === "D1");
    const reboundD1 = parseAgentRoutingPolicyOwner(
      coherentD1OwnerChange.adoptionInventory,
    ).directChildRoutes.find((route) => route.id === "D1");
    const canonicalD1Row = markdownTableRow(sources.adoptionInventory, "D1");
    const reboundD1Row = markdownTableRow(
      coherentD1OwnerChange.adoptionInventory,
      "D1",
    );
    const canonicalD1Record = (
      parseEscalationAnchor(sources.adoptionInventory).adoptions as Record<
        string,
        unknown
      >[]
    ).find((record) => record.route_id === "D1");
    const reboundD1Record = (
      parseEscalationAnchor(coherentD1OwnerChange.adoptionInventory)
        .adoptions as Record<string, unknown>[]
    ).find((record) => record.route_id === "D1");
    const {
      direct_route_clauses: canonicalD1Clauses,
      ...canonicalD1UnchangedFields
    } = canonicalD1Record ?? {};
    const {
      direct_route_clauses: reboundD1Clauses,
      ...reboundD1UnchangedFields
    } = reboundD1Record ?? {};
    expect(canonicalD1?.clauses[0]).toMatchObject({
      role: "assessor",
      capability: "balanced",
      effort: "medium",
      sourceAuthority: "source-immutable",
    });
    expect(reboundD1?.clauses[0]).toMatchObject({
      role: "investigator",
      capability: "balanced",
      effort: "high",
      sourceAuthority: "source-immutable",
    });
    expect(canonicalD1Row).toContain(readableD1Before);
    expect(canonicalD1Row).not.toContain(readableD1After);
    expect(reboundD1Row).toContain(readableD1After);
    expect(reboundD1Row).not.toContain(readableD1Before);
    expect(canonicalD1Clauses).toEqual([{ role_id: "assessor" }]);
    expect(reboundD1Clauses).toEqual([{ role_id: "investigator" }]);
    expect(reboundD1UnchangedFields).toEqual(canonicalD1UnchangedFields);
    expect(reboundD1).toMatchObject({
      id: "D1",
      ownerSkill: canonicalD1?.ownerSkill,
      surfaceAndOwner: canonicalD1?.surfaceAndOwner,
      existingOutputOrTermination: canonicalD1?.existingOutputOrTermination,
    });
    expect(validateEscalationConsumerContracts(coherentD1OwnerChange)).toEqual(
      [],
    );

    const clauseSemanticCases: Array<{
      name: string;
      mutate: (value: EscalationConsumerSources) => EscalationConsumerSources;
      expectedError: string;
    }> = [
      {
        name: "D3 descriptor network binding",
        mutate: (value) => ({
          ...value,
          adoptionInventory: mutateAdoptionRecord(
            value.adoptionInventory,
            "D3",
            (record) => {
              record.direct_route_clauses = [
                { role_id: "investigator", network_binding: "ambient" },
              ];
            },
          ),
        }),
        expectedError:
          "Escalation adoption D3 network_binding must match direct-route clause 1",
      },
      {
        name: "D3 descriptor missing role ID",
        mutate: (value) => ({
          ...value,
          adoptionInventory: mutateAdoptionRecord(
            value.adoptionInventory,
            "D3",
            (record) => {
              record.direct_route_clauses = [
                { network_binding: "dispatch-named" },
              ];
            },
          ),
        }),
        expectedError:
          "Escalation adoption D3 direct_route_clause fields identities must match exactly; missing: role_id; unexpected: none",
      },
      {
        name: "D3 table network binding",
        mutate: (value) => ({
          ...value,
          adoptionInventory: value.adoptionInventory.replace(
            "network-binding `dispatch-named`",
            "network-binding `ambient`",
          ),
        }),
        expectedError:
          "Escalation adoption D3 network_binding must match direct-route clause 1",
      },
      {
        name: "D13 descriptor selection mode",
        mutate: (value) => ({
          ...value,
          adoptionInventory: mutateAdoptionRecord(
            value.adoptionInventory,
            "D13",
            (record) => {
              record.direct_route_clauses = [
                { role_id: "executor", selection_mode: "delegated-only" },
              ];
            },
          ),
        }),
        expectedError:
          "Escalation adoption D13 selection_mode must match direct-route clause 1",
      },
      {
        name: "D13 descriptor missing selection mode",
        mutate: (value) => ({
          ...value,
          adoptionInventory: mutateAdoptionRecord(
            value.adoptionInventory,
            "D13",
            (record) => {
              record.direct_route_clauses = [{ role_id: "executor" }];
            },
          ),
        }),
        expectedError:
          "Escalation adoption D13 selection_mode must match direct-route clause 1",
      },
      {
        name: "D13 table selection mode",
        mutate: (value) => ({
          ...value,
          adoptionInventory: value.adoptionInventory.replace(
            "selection-mode `inline-or-delegated`",
            "selection-mode `delegated-only`",
          ),
        }),
        expectedError:
          "Escalation adoption D13 selection_mode must match direct-route clause 1",
      },
      ...(["diagnosis", "exact-fix", "judgment-fix"] as const).map(
        (branchId, index) => ({
          name: `D17 descriptor ${branchId} identity`,
          mutate: (value: EscalationConsumerSources) => ({
            ...value,
            adoptionInventory: mutateAdoptionRecord(
              value.adoptionInventory,
              "D17",
              (record) => {
                const clauses = record.direct_route_clauses as Record<
                  string,
                  unknown
                >[];
                clauses[index].branch_id =
                  branchId === "diagnosis" ? "exact-fix" : "diagnosis";
              },
            ),
          }),
          expectedError: `Escalation adoption D17 branch_id must match direct-route clause ${index + 1}`,
        }),
      ),
      {
        name: "D17 descriptor branch order",
        mutate: (value) => ({
          ...value,
          adoptionInventory: mutateAdoptionRecord(
            value.adoptionInventory,
            "D17",
            (record) => {
              record.direct_route_clauses = [
                { role_id: "investigator", branch_id: "exact-fix" },
                { role_id: "executor", branch_id: "diagnosis" },
                { role_id: "implementer", branch_id: "judgment-fix" },
              ];
            },
          ),
        }),
        expectedError:
          "Escalation adoption D17 branch_id must match direct-route clause 1",
      },
      {
        name: "D1 unexpected qualifier",
        mutate: (value) => ({
          ...value,
          adoptionInventory: mutateAdoptionRecord(
            value.adoptionInventory,
            "D1",
            (record) => {
              record.direct_route_clauses = [
                { role_id: "assessor", network_binding: "dispatch-named" },
              ];
            },
          ),
        }),
        expectedError:
          "Escalation adoption D1 network_binding must match direct-route clause 1",
      },
    ];
    for (const mutation of clauseSemanticCases) {
      expect(
        validateEscalationConsumerContracts(mutation.mutate(sources)),
        mutation.name,
      ).toEqual([mutation.expectedError]);
    }

    const falseGreenControls: Array<{
      name: string;
      mutate: (value: EscalationConsumerSources) => EscalationConsumerSources;
      expectedError: string;
    }> = [
      {
        name: "table-only cardinality",
        mutate: (value) => ({
          ...value,
          adoptionInventory: replaceRequired(
            value.adoptionInventory,
            d17Route,
            `${d17Route}; branch \`verification\`: \`reviewer\`, frontier/high, source-immutable`,
          ),
        }),
        expectedError:
          "Escalation adoption D17 direct_route_clauses cardinality must match direct-route clauses: expected 4; received 3",
      },
      {
        name: "table-only role",
        mutate: (value) => ({
          ...value,
          adoptionInventory: replaceRequired(
            value.adoptionInventory,
            "`assessor`, balanced/medium, source-immutable",
            "`investigator`, balanced/high, source-immutable",
          ),
        }),
        expectedError:
          "Escalation adoption D1 direct_route_clauses must match direct-route roles in order; expected: investigator; actual: assessor",
      },
      {
        name: "table-only index order",
        mutate: (value) => ({
          ...value,
          adoptionInventory: replaceRequired(
            value.adoptionInventory,
            d17Route,
            "branch `exact-fix`: `executor`, efficient/medium, source-mutable; branch `diagnosis`: `investigator`, balanced/high, source-immutable; branch `judgment-fix`: `implementer`, balanced/high, source-mutable",
          ),
        }),
        expectedError:
          "Escalation adoption D17 direct_route_clauses must match direct-route roles in order; expected: executor, investigator, implementer; actual: investigator, executor, implementer",
      },
      {
        name: "structured clause unknown key",
        mutate: (value) => ({
          ...value,
          adoptionInventory: mutateAdoptionRecord(
            value.adoptionInventory,
            "D1",
            (record) => {
              record.direct_route_clauses = [
                { role_id: "assessor", unknown_key: "value" },
              ];
            },
          ),
        }),
        expectedError:
          "Escalation adoption D1 direct_route_clause fields identities must match exactly; missing: none; unexpected: unknown_key",
      },
      {
        name: "structured clause malformed nonempty slug",
        mutate: (value) => ({
          ...value,
          adoptionInventory: mutateAdoptionRecord(
            value.adoptionInventory,
            "D1",
            (record) => {
              record.direct_route_clauses = [{ role_id: "assessor_" }];
            },
          ),
        }),
        expectedError:
          "Escalation adoption D1 direct_route_clause role_id must be one non-empty slug: assessor_",
      },
      {
        name: "structured clause empty slug",
        mutate: (value) => ({
          ...value,
          adoptionInventory: mutateAdoptionRecord(
            value.adoptionInventory,
            "D1",
            (record) => {
              record.direct_route_clauses = [{ role_id: "" }];
            },
          ),
        }),
        expectedError:
          "Escalation adoption D1 direct_route_clause role_id must be one non-empty string",
      },
      {
        name: "coherent table and descriptor unknown role",
        mutate: (value) => ({
          ...value,
          adoptionInventory: mutateAdoptionRecord(
            replaceRequired(
              value.adoptionInventory,
              "`assessor`, balanced/medium, source-immutable",
              "`unknown-role`, balanced/medium, source-immutable",
            ),
            "D1",
            (record) => {
              record.direct_route_clauses = [{ role_id: "unknown-role" }];
            },
          ),
        }),
        expectedError:
          "Direct-route D1 clause 1 role is absent from the canonical role owner: unknown-role",
      },
    ];
    expect(falseGreenControls).toHaveLength(7);
    for (const control of falseGreenControls) {
      const mutated = control.mutate(sources);
      expect(
        mutated.adoptionInventory,
        `${control.name} mutation must occur`,
      ).not.toBe(sources.adoptionInventory);
      expect(
        validateEscalationConsumerContracts(mutated),
        control.name,
      ).toEqual([control.expectedError]);
    }

    const d4RoleIds = parseAgentSemanticRoleOwner(sources.agentSpec).map(
      (role) => role.name,
    );
    const d4RoleSet = JSON.stringify(d4RoleIds);

    const mutationCases: Array<{
      name: string;
      mutate: (value: EscalationConsumerSources) => EscalationConsumerSources;
      expectedError: string;
    }> = [
      {
        name: "exact target permission",
        mutate: (value) => ({
          ...value,
          adoptionInventory: value.adoptionInventory.replace(
            '"target_permission":"exact-only"',
            '"target_permission":"ambient"',
          ),
        }),
        expectedError:
          "escalation adoption target_permission must be exactly: exact-only",
      },
      {
        name: "D4 selected role permission",
        mutate: (value) => ({
          ...value,
          adoptionInventory: value.adoptionInventory.replace(
            '"role_permission":"selected-role-must-match"',
            '"role_permission":"same-role-must-match"',
          ),
        }),
        expectedError:
          "Escalation adoption D4 role permission is contradictory",
      },
      {
        name: "current opt-out state",
        mutate: (value) => ({
          ...value,
          adoptionInventory: value.adoptionInventory.replace(
            '"current_state":"opt-out"',
            '"current_state":"adopt"',
          ),
        }),
        expectedError:
          "escalation adoption current_state must be exactly: opt-out",
      },
      {
        name: "current opt-out transition",
        mutate: (value) => ({
          ...value,
          adoptionInventory: value.adoptionInventory.replace(
            '"transition":"none"',
            '"transition":"next"',
          ),
        }),
        expectedError: "escalation adoption transition must be exactly: none",
      },
      {
        name: "next tuple on opt-out",
        mutate: (value) => ({
          ...value,
          adoptionInventory: value.adoptionInventory.replace(
            '"next_tuple":"none"',
            '"next_tuple":"frontier/high"',
          ),
        }),
        expectedError: "escalation adoption next_tuple must be exactly: none",
      },
      {
        name: "mechanism on opt-out",
        mutate: (value) => ({
          ...value,
          adoptionInventory: value.adoptionInventory.replace(
            '"mechanism":"none"',
            '"mechanism":"retry"',
          ),
        }),
        expectedError: "escalation adoption mechanism must be exactly: none",
      },
      {
        name: "escalation budget on opt-out",
        mutate: (value) => ({
          ...value,
          adoptionInventory: value.adoptionInventory.replace(
            '"escalation_budget":"none"',
            '"escalation_budget":"one"',
          ),
        }),
        expectedError:
          "escalation adoption escalation_budget must be exactly: none",
      },
      {
        name: "reversed D13 reclassification",
        mutate: (value) => ({
          ...value,
          adoptionInventory: value.adoptionInventory.replace(
            '"relation":"D13-to-D12-reclassification"',
            '"relation":"D12-to-D13-reclassification"',
          ),
        }),
        expectedError:
          "escalation adoption relation has invalid closed value: D12-to-D13-reclassification",
      },
      {
        name: "CI retry budget contradiction",
        mutate: (value) => ({
          ...value,
          adoptionInventory: value.adoptionInventory.replace(
            '"counter":"independent-from-escalation"',
            '"counter":"consumes-escalation-budget"',
          ),
        }),
        expectedError:
          "escalation adoption counter has invalid closed value: consumes-escalation-budget",
      },
      {
        name: "non-D4 producer drift",
        mutate: (value) => ({
          ...value,
          adoptionInventory: value.adoptionInventory.replace(
            '"producer_source_path":"none"',
            '"producer_source_path":"skills/play-agent-dispatch/SKILL.md"',
          ),
        }),
        expectedError:
          "Escalation adoption D1 producer source is contradictory",
      },
      {
        name: "D12 adoption-only valid-token role substitution",
        mutate: (value) => ({
          ...value,
          adoptionInventory: mutateAdoptionRecord(
            value.adoptionInventory,
            "D12",
            (record) => {
              record.direct_route_clauses = [{ role_id: "executor" }];
            },
          ),
        }),
        expectedError:
          "Escalation adoption D12 direct_route_clauses must match direct-route roles in order; expected: implementer; actual: executor",
      },
      {
        name: "D1 adoption-only valid-token role substitution",
        mutate: (value) => ({
          ...value,
          adoptionInventory: mutateAdoptionRecord(
            value.adoptionInventory,
            "D1",
            (record) => {
              record.direct_route_clauses = [{ role_id: "investigator" }];
            },
          ),
        }),
        expectedError:
          "Escalation adoption D1 direct_route_clauses must match direct-route roles in order; expected: assessor; actual: investigator",
      },
      {
        name: "D13 adoption-only valid-token role substitution",
        mutate: (value) => ({
          ...value,
          adoptionInventory: mutateAdoptionRecord(
            value.adoptionInventory,
            "D13",
            (record) => {
              record.direct_route_clauses = [
                {
                  role_id: "implementer",
                  selection_mode: "inline-or-delegated",
                },
              ];
            },
          ),
        }),
        expectedError:
          "Escalation adoption D13 direct_route_clauses must match direct-route roles in order; expected: executor; actual: implementer",
      },
      {
        name: "missing non-D4 direct-route binding",
        mutate: (value) => ({
          ...value,
          adoptionInventory: mutateEscalationAnchor(
            value.adoptionInventory,
            (anchor) => {
              Reflect.deleteProperty(
                (anchor.adoptions as Record<string, unknown>[])[0],
                "direct_route_clauses",
              );
            },
          ),
        }),
        expectedError:
          "capability-escalation adoption record fields identities must match exactly; missing: direct_route_clauses; unexpected: none",
      },
      {
        name: "forbidden D4 direct-route binding",
        mutate: (value) => ({
          ...value,
          adoptionInventory: mutateEscalationAnchor(
            value.adoptionInventory,
            (anchor) => {
              (
                anchor.adoptions as Record<string, unknown>[]
              )[3].direct_route_clauses = [{ role_id: "investigator" }];
            },
          ),
        }),
        expectedError:
          "capability-escalation adoption record fields identities must match exactly; missing: none; unexpected: direct_route_clauses",
      },
      {
        name: "D17 direct-route role order",
        mutate: (value) => ({
          ...value,
          adoptionInventory: mutateAdoptionRecord(
            value.adoptionInventory,
            "D17",
            (record) => {
              record.direct_route_clauses = [
                { role_id: "executor", branch_id: "diagnosis" },
                { role_id: "investigator", branch_id: "exact-fix" },
                { role_id: "implementer", branch_id: "judgment-fix" },
              ];
            },
          ),
        }),
        expectedError:
          "Escalation adoption D17 direct_route_clauses must match direct-route roles in order; expected: investigator, executor, implementer; actual: executor, investigator, implementer",
      },
      {
        name: "D17 duplicate direct-route role",
        mutate: (value) => ({
          ...value,
          adoptionInventory: mutateAdoptionRecord(
            value.adoptionInventory,
            "D17",
            (record) => {
              record.direct_route_clauses = [
                { role_id: "investigator", branch_id: "diagnosis" },
                { role_id: "investigator", branch_id: "exact-fix" },
                { role_id: "implementer", branch_id: "judgment-fix" },
              ];
            },
          ),
        }),
        expectedError:
          "Escalation adoption D17 direct_route_clauses must match direct-route roles in order; expected: investigator, executor, implementer; actual: investigator, investigator, implementer",
      },
      {
        name: "D17 missing direct-route role",
        mutate: (value) => ({
          ...value,
          adoptionInventory: mutateAdoptionRecord(
            value.adoptionInventory,
            "D17",
            (record) => {
              record.direct_route_clauses = [
                { role_id: "investigator", branch_id: "diagnosis" },
                { role_id: "executor", branch_id: "exact-fix" },
              ];
            },
          ),
        }),
        expectedError:
          "Escalation adoption D17 direct_route_clauses cardinality must match direct-route clauses: expected 3; received 2",
      },
      {
        name: "D17 extra direct-route role",
        mutate: (value) => ({
          ...value,
          adoptionInventory: mutateAdoptionRecord(
            value.adoptionInventory,
            "D17",
            (record) => {
              record.direct_route_clauses = [
                { role_id: "investigator", branch_id: "diagnosis" },
                { role_id: "executor", branch_id: "exact-fix" },
                { role_id: "implementer", branch_id: "judgment-fix" },
                { role_id: "deep-reviewer", branch_id: "judgment-fix" },
              ];
            },
          ),
        }),
        expectedError:
          "Escalation adoption D17 direct_route_clauses cardinality must match direct-route clauses: expected 3; received 4",
      },
      {
        name: "D17 valid-token direct-route mismatch",
        mutate: (value) => ({
          ...value,
          adoptionInventory: mutateAdoptionRecord(
            value.adoptionInventory,
            "D17",
            (record) => {
              record.direct_route_clauses = [
                { role_id: "investigator", branch_id: "diagnosis" },
                { role_id: "executor", branch_id: "exact-fix" },
                { role_id: "deep-reviewer", branch_id: "judgment-fix" },
              ];
            },
          ),
        }),
        expectedError:
          "Escalation adoption D17 direct_route_clauses must match direct-route roles in order; expected: investigator, executor, implementer; actual: investigator, executor, deep-reviewer",
      },
      {
        name: "duplicate escalation owner",
        mutate: (value) => ({
          ...value,
          lifecycleOwner: `${value.lifecycleOwner}\n<!-- escalation-adoption-anchor\n{"declaration_id":"ESC-COMMON-OWNER","source_path":"skills/subagent-lifecycle/SKILL.md","surface_mode":"common-owner","contract_id":"capability-escalation-adoption","inventory_owner_path":"docs/guidelines/agent-routing-and-mutation-policy.md","authority_ref":"common-normative-owner"}\n-->`,
        }),
        expectedError:
          "Escalation source must contain exactly one machine-readable anchor: skills/subagent-lifecycle/SKILL.md",
      },
      {
        name: "duplicate root anchor key",
        mutate: (value) => ({
          ...value,
          prMerge: value.prMerge.replace(
            '"declaration_id":"ESC-PR-MERGE",',
            '"declaration_id":"ESC-PR-MERGE","declaration_id":"ESC-PR-MERGE",',
          ),
        }),
        expectedError:
          "Escalation anchor has duplicate key declaration_id: skills/pr-merge/SKILL.md",
      },
      {
        name: "consumer competing-authority claim",
        mutate: (value) => ({
          ...value,
          writingSkills: value.writingSkills.replace(
            '"surface_mode":"authoring-consumer"',
            '"surface_mode":"common-owner"',
          ),
        }),
        expectedError:
          "escalation projection ESC-WRITING-SKILLS surface_mode must be exactly: authoring-consumer",
      },
      {
        name: "duplicate D4 allowed role",
        mutate: (value) => ({
          ...value,
          adoptionInventory: value.adoptionInventory.replace(
            `"allowed_role_ids":${d4RoleSet}`,
            `"allowed_role_ids":${JSON.stringify([...d4RoleIds, d4RoleIds[0]])}`,
          ),
        }),
        expectedError: `Agent routing policy owner duplicate D4 allowed_role_id: ${d4RoleIds[0]}`,
      },
      {
        name: "extra D4 allowed role",
        mutate: (value) => ({
          ...value,
          adoptionInventory: value.adoptionInventory.replace(
            `"allowed_role_ids":${d4RoleSet}`,
            `"allowed_role_ids":${JSON.stringify([...d4RoleIds, "ambient"])}`,
          ),
        }),
        expectedError:
          "capability-escalation D4 allowed role IDs identities must match exactly; missing: none; unexpected: ambient",
      },
      {
        name: "missing D4 allowed role",
        mutate: (value) => ({
          ...value,
          adoptionInventory: value.adoptionInventory.replace(
            `"allowed_role_ids":${d4RoleSet}`,
            `"allowed_role_ids":${JSON.stringify(d4RoleIds.filter((role) => role !== d4RoleIds[1]))}`,
          ),
        }),
        expectedError: `capability-escalation D4 allowed role IDs identities must match exactly; missing: ${d4RoleIds[1]}; unexpected: none`,
      },
      {
        name: "nearby D4 allowed role",
        mutate: (value) => ({
          ...value,
          adoptionInventory: value.adoptionInventory.replace(
            `"allowed_role_ids":${d4RoleSet}`,
            `"allowed_role_ids":${JSON.stringify(d4RoleIds.map((role, index) => (index === 1 ? `${role}-nearby` : role)))}`,
          ),
        }),
        expectedError: `capability-escalation D4 allowed role IDs identities must match exactly; missing: ${d4RoleIds[1]}; unexpected: ${d4RoleIds[1]}-nearby`,
      },
      {
        name: "wrong D4 selection mode",
        mutate: (value) => ({
          ...value,
          adoptionInventory: value.adoptionInventory.replace(
            '"selection_mode":"planner-selected"',
            '"selection_mode":"ambient-selected"',
          ),
        }),
        expectedError: "D4 selection_mode must be exactly: planner-selected",
      },
      {
        name: "wrong D4 route-set route",
        mutate: (value) => ({
          ...value,
          adoptionInventory: value.adoptionInventory.replace(
            /("d4_route_set"\s*:\s*\{"route_id":)"D4"/u,
            '$1"D5"',
          ),
        }),
        expectedError: "D4 route_id must be exactly: D4",
      },
      {
        name: "wrong D4 route-set adoption reference",
        mutate: (value) => ({
          ...value,
          adoptionInventory: value.adoptionInventory.replace(
            /("d4_route_set"[\s\S]*?"adoption_ref":)"ESC-ADOPT-D4"/u,
            '$1"ESC-ADOPT-D5"',
          ),
        }),
        expectedError: "D4 adoption_ref must be exactly: ESC-ADOPT-D4",
      },
      {
        name: "duplicate producer projection",
        mutate: (value) => ({
          ...value,
          prMerge: `${value.prMerge}\n<!-- escalation-adoption-anchor\n{"declaration_id":"ESC-PR-MERGE","source_path":"skills/pr-merge/SKILL.md","surface_mode":"workflow-consumer","route_ids":["D17"],"adoption_refs":["ESC-ADOPT-D17"],"authority_ref":"non-owner"}\n-->`,
        }),
        expectedError:
          "Escalation source must contain exactly one machine-readable anchor: skills/pr-merge/SKILL.md",
      },
    ];

    for (const mutation of mutationCases) {
      expect(
        validateEscalationConsumerContracts(mutation.mutate(sources)),
        mutation.name,
      ).toEqual([mutation.expectedError]);
    }

    for (const sourceKey of [
      "adr",
      "agentSpec",
      "issuePriming",
      "lifecyclePolicy",
      "prMerge",
      "routingSpec",
      "writingSkills",
      "agentAuthoring",
      "lifecycleOwner",
      "adoptionInventory",
    ] as const) {
      const mutated = {
        ...sources,
        [sourceKey]: sources[sourceKey].replace(
          /"declaration_id"\s*:\s*"([^"]+)",/u,
          '"declaration_id":"$1","declaration_id":"$1",',
        ),
      };
      const errors = validateEscalationConsumerContracts(mutated);
      expect(errors, `${sourceKey} duplicate root key`).toHaveLength(1);
      expect(errors[0]).toMatch(/duplicate key declaration_id/i);
    }

    for (const [name, from, to, error] of [
      [
        "adoption record",
        '"target_permission":"exact-only","role_permission"',
        '"target_permission":"exact-only","target_permission":"exact-only","role_permission"',
        /duplicate key target_permission/i,
      ],
      [
        "D4 route set",
        '"route_id":"D4","allowed_role_ids"',
        '"route_id":"D4","route_id":"D4","allowed_role_ids"',
        /duplicate key route_id/i,
      ],
      [
        "escaped adoption record key",
        '"target_permission":"exact-only","role_permission"',
        '"target_\\u0070ermission":"exact-only","target_permission":"exact-only","role_permission"',
        /duplicate key target_permission/i,
      ],
      [
        "direct-route role binding",
        '"direct_route_clauses":[{"role_id":"assessor"}],"current_state"',
        '"direct_route_clauses":[{"role_id":"assessor"}],"direct_route_clauses":[{"role_id":"assessor"}],"current_state"',
        /duplicate key direct_route_clauses/i,
      ],
      [
        "direct-route clause descriptor",
        '"direct_route_clauses":[{"role_id":"assessor"}],"current_state"',
        '"direct_route_clauses":[{"role_id":"assessor","role_id":"assessor"}],"current_state"',
        /duplicate key role_id/i,
      ],
    ] as const) {
      const errors = validateEscalationConsumerContracts({
        ...sources,
        adoptionInventory: sources.adoptionInventory.replace(from, to),
      });
      expect(errors, `same-value nested duplicate ${name}`).toHaveLength(1);
      expect(errors[0]).toMatch(error);
    }

    for (const field of [
      "declaration_id",
      "source_path",
      "surface_mode",
      "contract_id",
      "inventory_owner_path",
      "authority_ref",
    ]) {
      const mutated = {
        ...sources,
        lifecycleOwner: mutateEscalationAnchor(
          sources.lifecycleOwner,
          (anchor) => {
            delete anchor[field];
          },
        ),
      };
      expect(
        validateEscalationConsumerContracts(mutated),
        `missing common-owner ${field}`,
      ).toEqual([
        expect.stringMatching(
          field === "declaration_id"
            ? /escalation declaration ID must be one non-empty string/i
            : field === "source_path"
              ? /source_path must match its source/i
              : /common owner fields identities must match/i,
        ),
      ]);
    }

    for (const field of [
      "declaration_id",
      "source_path",
      "surface_mode",
      "contract_id",
      "common_owner_path",
      "authority_ref",
      "adoptions",
      "d4_route_set",
    ]) {
      const mutated = {
        ...sources,
        adoptionInventory: mutateEscalationAnchor(
          sources.adoptionInventory,
          (anchor) => {
            delete anchor[field];
          },
        ),
      };
      expect(
        validateEscalationConsumerContracts(mutated),
        `missing inventory-owner ${field}`,
      ).toEqual([
        expect.stringMatching(
          field === "declaration_id"
            ? /escalation declaration ID must be one non-empty string/i
            : field === "source_path"
              ? /source_path must match its source/i
              : /inventory owner fields identities must match/i,
        ),
      ]);
    }

    for (const field of [
      "route_id",
      "adoption_ref",
      "target_ids",
      "target_permission",
      "role_permission",
      "direct_route_clauses",
      "current_state",
      "transition",
      "next_tuple",
      "mechanism",
      "escalation_budget",
      "relation",
      "counter",
      "producer_source_path",
    ]) {
      const mutated = {
        ...sources,
        adoptionInventory: mutateEscalationAnchor(
          sources.adoptionInventory,
          (anchor) => {
            const records = anchor.adoptions as Record<string, unknown>[];
            delete records[0][field];
          },
        ),
      };
      expect(
        validateEscalationConsumerContracts(mutated),
        `missing adoption-record ${field}`,
      ).toEqual([
        expect.stringMatching(
          /escalation adoption record fields identities must match/i,
        ),
      ]);
    }

    for (const field of [
      "route_id",
      "allowed_role_ids",
      "selection_mode",
      "adoption_ref",
    ]) {
      const mutated = {
        ...sources,
        adoptionInventory: mutateEscalationAnchor(
          sources.adoptionInventory,
          (anchor) => {
            delete (anchor.d4_route_set as Record<string, unknown>)[field];
          },
        ),
      };
      expect(
        validateEscalationConsumerContracts(mutated),
        `missing D4-route-set ${field}`,
      ).toEqual([
        expect.stringMatching(/D4 route-set fields identities must match/i),
      ]);
    }

    for (const field of [
      "declaration_id",
      "source_path",
      "surface_mode",
      "route_ids",
      "adoption_refs",
      "authority_ref",
    ]) {
      const mutated = {
        ...sources,
        prMerge: mutateEscalationAnchor(sources.prMerge, (anchor) => {
          delete anchor[field];
        }),
      };
      expect(
        validateEscalationConsumerContracts(mutated),
        `missing projection ${field}`,
      ).toEqual([
        expect.stringMatching(
          field === "declaration_id"
            ? /escalation declaration ID must be one non-empty string/i
            : field === "source_path"
              ? /source_path must match its source/i
              : /escalation projection fields identities must match/i,
        ),
      ]);
    }

    for (const sourceKey of [
      "adr",
      "agentAuthoring",
      "writingSkills",
      "routingSpec",
      "agentSpec",
      "issuePriming",
      "lifecyclePolicy",
      "prMerge",
    ] as const) {
      for (const [field, replacement] of [
        ["declaration_id", "ESC-UNKNOWN"],
        ["surface_mode", "common-owner"],
        ["authority_ref", "competing-owner"],
      ] as const) {
        const mutated = {
          ...sources,
          [sourceKey]: sources[sourceKey].replace(
            new RegExp(`"${field}"\\s*:\\s*"[^"]+"`, "u"),
            `"${field}":"${replacement}"`,
          ),
        };
        const errors = validateEscalationConsumerContracts(mutated);
        expect(errors, `${sourceKey} ${field}`).toHaveLength(1);
        expect(errors[0]).toMatch(
          new RegExp(`escalation projection .* ${field} must be exactly`, "i"),
        );
      }
    }
  });

  it("enforces bounded non-owning guide projections from the canonical contract", async () => {
    const sources: EscalationConsumerSources = {
      adr: await readRepoFile(
        "docs/adr/adr-0027-semantic-agent-routing-and-mutation-authority.md",
      ),
      agentSpec: await readRepoFile("docs/specs/agents.md"),
      issuePriming: await readSkillSource("issue-priming-workflow"),
      lifecyclePolicy: await readRepoFile(
        "skills/play-subagent-execution/references/lifecycle-status-policy.md",
      ),
      prMerge: await readSkillSource("pr-merge"),
      routingSpec: await readRepoFile("docs/specs/afds-workflow-routing.md"),
      writingSkills: await readRepoFile("docs/guidelines/writing-skills.md"),
      agentAuthoring: await readRepoFile(
        "docs/guidelines/agent-authoring-guide.md",
      ),
      lifecycleOwner: await readSkillSource("subagent-lifecycle"),
      adoptionInventory: await readRepoFile(
        "docs/guidelines/agent-routing-and-mutation-policy.md",
      ),
    };

    expect(validateRouteLevelOptOutGuideContracts(sources)).toEqual([]);

    const projection = (source: string, label: string): string => {
      const match = new RegExp(`<!-- ${label}\\n([\\s\\S]*?)\\n-->`, "u").exec(
        source,
      );
      expect(match, `missing ${label}`).not.toBeNull();
      return match?.[1] ?? "";
    };
    const replaceProjection = (
      source: string,
      label: string,
      declaration: string,
    ): string =>
      source.replace(
        new RegExp(`<!-- ${label}\\n[\\s\\S]*?\\n-->`, "u"),
        `<!-- ${label}\n${declaration}\n-->`,
      );
    const writingDeclaration = projection(
      sources.writingSkills,
      "guide-capability-transition-projection",
    );
    const agentDeclaration = projection(
      sources.agentAuthoring,
      "guide-capability-transition-delegation",
    );
    const mutationCases: Array<{
      name: string;
      mutate: (value: EscalationConsumerSources) => EscalationConsumerSources;
      expectedError: string;
    }> = [
      {
        name: "harmless explanatory prose rewrite",
        mutate: (value) => ({
          ...value,
          writingSkills: value.writingSkills.replace(
            "When authoring a controller",
            "When preparing a controller",
          ),
        }),
        expectedError: "",
      },
      {
        name: "unordered writing projection fields",
        mutate: (value) => ({
          ...value,
          writingSkills: replaceProjection(
            value.writingSkills,
            "guide-capability-transition-projection",
            JSON.stringify(
              (() => {
                const declaration = JSON.parse(writingDeclaration) as Record<
                  string,
                  unknown
                >;
                return {
                  d17: declaration.d17,
                  opt_out: declaration.opt_out,
                  declaration_id: declaration.declaration_id,
                  authority_ref: declaration.authority_ref,
                  d4: declaration.d4,
                  surface_mode: declaration.surface_mode,
                  source_path: declaration.source_path,
                };
              })(),
            ),
          ),
        }),
        expectedError: "",
      },
      {
        name: "coexisting contradictory writing declaration",
        mutate: (value) => ({
          ...value,
          writingSkills: `${value.writingSkills}\n<!-- guide-capability-transition-projection\n${writingDeclaration.replace('"target_permission":"exact-only"', '"target_permission":"ambient"')}\n-->`,
        }),
        expectedError:
          "writing-skills projection must contain exactly one declaration",
      },
      {
        name: "missing writing declaration",
        mutate: (value) => ({
          ...value,
          writingSkills: value.writingSkills.replace(
            /<!-- guide-capability-transition-projection\n[\s\S]*?\n-->/u,
            "",
          ),
        }),
        expectedError:
          "writing-skills projection must contain exactly one declaration",
      },
      {
        name: "malformed writing declaration",
        mutate: (value) => ({
          ...value,
          writingSkills: replaceProjection(
            value.writingSkills,
            "guide-capability-transition-projection",
            "{ malformed",
          ),
        }),
        expectedError:
          "writing-skills projection declaration is malformed JSON",
      },
      {
        name: "raw duplicate writing key",
        mutate: (value) => ({
          ...value,
          writingSkills: replaceProjection(
            value.writingSkills,
            "guide-capability-transition-projection",
            writingDeclaration.replace(
              '"declaration_id":',
              '"declaration_id":"duplicate","declaration_id":',
            ),
          ),
        }),
        expectedError:
          "writing-skills projection declaration has duplicate key",
      },
      {
        name: "missing writing field",
        mutate: (value) => ({
          ...value,
          writingSkills: replaceProjection(
            value.writingSkills,
            "guide-capability-transition-projection",
            writingDeclaration.replace(',"d17":', ',"removed_d17":'),
          ),
        }),
        expectedError:
          "writing-skills projection declaration has missing or extra field",
      },
      {
        name: "extra writing field",
        mutate: (value) => ({
          ...value,
          writingSkills: replaceProjection(
            value.writingSkills,
            "guide-capability-transition-projection",
            writingDeclaration.replace("{", '{"extra":true,'),
          ),
        }),
        expectedError:
          "writing-skills projection declaration has missing or extra field",
      },
      {
        name: "unknown writing identity",
        mutate: (value) => ({
          ...value,
          writingSkills: replaceProjection(
            value.writingSkills,
            "guide-capability-transition-projection",
            writingDeclaration.replace(
              "GUIDE-WRITING-SKILLS-CAPABILITY-TRANSITIONS",
              "GUIDE-UNKNOWN",
            ),
          ),
        }),
        expectedError:
          "writing-skills projection declaration_id is contradictory or unknown",
      },
      {
        name: "target permission contradiction",
        mutate: (value) => ({
          ...value,
          writingSkills: replaceProjection(
            value.writingSkills,
            "guide-capability-transition-projection",
            writingDeclaration.replace("exact-only", "ambient"),
          ),
        }),
        expectedError:
          "writing-skills opt-out target_permission is contradictory or unknown",
      },
      {
        name: "single target decomposition",
        mutate: (value) => ({
          ...value,
          writingSkills: replaceProjection(
            value.writingSkills,
            "guide-capability-transition-projection",
            writingDeclaration.replace("plural", "single"),
          ),
        }),
        expectedError:
          "writing-skills opt-out target_ids is contradictory or unknown",
      },
      {
        name: "opt-out per-role route identity",
        mutate: (value) => ({
          ...value,
          writingSkills: replaceProjection(
            value.writingSkills,
            "guide-capability-transition-projection",
            writingDeclaration.replace(
              '"route_identity":"route-level"',
              '"route_identity":"per-role"',
            ),
          ),
        }),
        expectedError:
          "writing-skills opt-out route_identity is contradictory or unknown",
      },
      {
        name: "ambient role permission regression",
        mutate: (value) => ({
          ...value,
          writingSkills: replaceProjection(
            value.writingSkills,
            "guide-capability-transition-projection",
            writingDeclaration.replace("canonical-direct-route", "ambient"),
          ),
        }),
        expectedError:
          "writing-skills opt-out role_permission is contradictory or unknown",
      },
      {
        name: "active opt-out transition",
        mutate: (value) => ({
          ...value,
          writingSkills: replaceProjection(
            value.writingSkills,
            "guide-capability-transition-projection",
            writingDeclaration.replace(
              '"transition":"none"',
              '"transition":"active"',
            ),
          ),
        }),
        expectedError:
          "writing-skills opt-out transition is contradictory or unknown",
      },
      {
        name: "non-D4 direct-route role omission",
        mutate: (value) => ({
          ...value,
          writingSkills: replaceProjection(
            value.writingSkills,
            "guide-capability-transition-projection",
            writingDeclaration.replace("required", "forbidden"),
          ),
        }),
        expectedError:
          "writing-skills opt-out non_d4_direct_route_role_ids is contradictory or unknown",
      },
      {
        name: "route-specific owner contradiction",
        mutate: (value) => ({
          ...value,
          writingSkills: replaceProjection(
            value.writingSkills,
            "guide-capability-transition-projection",
            writingDeclaration.replace("route-specific", "ambient"),
          ),
        }),
        expectedError:
          "writing-skills opt-out owner_clauses is contradictory or unknown",
      },
      {
        name: "D4 cardinality contradiction",
        mutate: (value) => ({
          ...value,
          writingSkills: replaceProjection(
            value.writingSkills,
            "guide-capability-transition-projection",
            writingDeclaration.replace(
              '"declaration_count":1',
              '"declaration_count":2',
            ),
          ),
        }),
        expectedError:
          "writing-skills D4 declaration_count is contradictory or unknown",
      },
      {
        name: "D4 per-role decomposition",
        mutate: (value) => ({
          ...value,
          writingSkills: replaceProjection(
            value.writingSkills,
            "guide-capability-transition-projection",
            writingDeclaration.replace("canonical-complete", "per-role"),
          ),
        }),
        expectedError: "writing-skills D4 role_set is contradictory or unknown",
      },
      {
        name: "D4 direct-route role field regression",
        mutate: (value) => ({
          ...value,
          writingSkills: replaceProjection(
            value.writingSkills,
            "guide-capability-transition-projection",
            writingDeclaration.replace(
              '"direct_route_role_ids":"forbidden"',
              '"direct_route_role_ids":"required"',
            ),
          ),
        }),
        expectedError:
          "writing-skills D4 direct_route_role_ids is contradictory or unknown",
      },
      {
        name: "D17 reordered role binding",
        mutate: (value) => ({
          ...value,
          writingSkills: replaceProjection(
            value.writingSkills,
            "guide-capability-transition-projection",
            writingDeclaration.replace("canonical-ordered", "independent"),
          ),
        }),
        expectedError:
          "writing-skills D17 direct_route_role_ids is contradictory or unknown",
      },
      {
        name: "D17 per-role binding decomposition",
        mutate: (value) => ({
          ...value,
          writingSkills: replaceProjection(
            value.writingSkills,
            "guide-capability-transition-projection",
            writingDeclaration.replace(
              '"binding":"route-level"',
              '"binding":"per-role"',
            ),
          ),
        }),
        expectedError: "writing-skills D17 binding is contradictory or unknown",
      },
      {
        name: "D17 duplicate route-level declaration",
        mutate: (value) => ({
          ...value,
          writingSkills: replaceProjection(
            value.writingSkills,
            "guide-capability-transition-projection",
            writingDeclaration.replace(
              '"d17":{"route_id":"D17","declaration_count":1',
              '"d17":{"route_id":"D17","declaration_count":2',
            ),
          ),
        }),
        expectedError:
          "writing-skills D17 declaration_count is contradictory or unknown",
      },
      {
        name: "canonical owner mismatch",
        mutate: (value) => ({
          ...value,
          writingSkills: replaceProjection(
            value.writingSkills,
            "guide-capability-transition-projection",
            writingDeclaration.replace(
              "docs/guidelines/agent-routing-and-mutation-policy.md",
              "docs/guidelines/not-the-owner.md",
            ),
          ),
        }),
        expectedError:
          "writing-skills projection authority_ref is contradictory or unknown",
      },
      {
        name: "agent delegation re-ownership",
        mutate: (value) => ({
          ...value,
          agentAuthoring: replaceProjection(
            value.agentAuthoring,
            "guide-capability-transition-delegation",
            agentDeclaration.replace(
              '"authority_ref":"non-owner"',
              '"authority_ref":"owner"',
            ),
          ),
        }),
        expectedError:
          "agent-authoring delegation authority_ref is contradictory or unknown",
      },
      {
        name: "missing agent delegation",
        mutate: (value) => ({
          ...value,
          agentAuthoring: value.agentAuthoring.replace(
            /<!-- guide-capability-transition-delegation\n[\s\S]*?\n-->/u,
            "",
          ),
        }),
        expectedError:
          "agent-authoring delegation must contain exactly one declaration",
      },
      {
        name: "duplicate agent delegation",
        mutate: (value) => ({
          ...value,
          agentAuthoring: `${value.agentAuthoring}\n<!-- guide-capability-transition-delegation\n${agentDeclaration}\n-->`,
        }),
        expectedError:
          "agent-authoring delegation must contain exactly one declaration",
      },
      {
        name: "malformed agent delegation",
        mutate: (value) => ({
          ...value,
          agentAuthoring: replaceProjection(
            value.agentAuthoring,
            "guide-capability-transition-delegation",
            "{ malformed",
          ),
        }),
        expectedError:
          "agent-authoring delegation declaration is malformed JSON",
      },
      {
        name: "raw duplicate agent delegation key",
        mutate: (value) => ({
          ...value,
          agentAuthoring: replaceProjection(
            value.agentAuthoring,
            "guide-capability-transition-delegation",
            agentDeclaration.replace(
              '"declaration_id":',
              '"declaration_id":"duplicate","declaration_id":',
            ),
          ),
        }),
        expectedError:
          "agent-authoring delegation declaration has duplicate key",
      },
      {
        name: "missing agent delegation field",
        mutate: (value) => ({
          ...value,
          agentAuthoring: replaceProjection(
            value.agentAuthoring,
            "guide-capability-transition-delegation",
            agentDeclaration.replace(',"authority_ref":"non-owner"', ""),
          ),
        }),
        expectedError:
          "agent-authoring delegation declaration has missing or extra field",
      },
      {
        name: "agent delegation route detail",
        mutate: (value) => ({
          ...value,
          agentAuthoring: replaceProjection(
            value.agentAuthoring,
            "guide-capability-transition-delegation",
            agentDeclaration.replace("{", '{"route_id":"D4",'),
          ),
        }),
        expectedError:
          "agent-authoring delegation declaration has missing or extra field",
      },
      {
        name: "agent unknown delegation mode",
        mutate: (value) => ({
          ...value,
          agentAuthoring: replaceProjection(
            value.agentAuthoring,
            "guide-capability-transition-delegation",
            agentDeclaration.replace("delegation-only", "route-owner"),
          ),
        }),
        expectedError:
          "agent-authoring delegation surface_mode is contradictory or unknown",
      },
    ];

    for (const mutation of mutationCases) {
      const actual = validateRouteLevelOptOutGuideContracts(
        mutation.mutate(sources),
      );
      expect(
        actual,
        `bounded projection oracle must reject ${mutation.name}`,
      ).toEqual(mutation.expectedError === "" ? [] : [mutation.expectedError]);
    }
  });

  it("treats D3 qualifier evidence as explicit owner data", async () => {
    const sources = await readEscalationConsumerSources();
    const explicit = withExplicitD3EvidenceQualifier(sources);

    expect(validateEscalationConsumerContracts(explicit)).toEqual([]);
    const d3 = parseAgentRoutingPolicyOwner(
      explicit.adoptionInventory,
    ).directChildRoutes.find((route) => route.id === "D3");
    expect(d3?.clauses[0]).toMatchObject({
      networkBinding: "dispatch-named",
      qualifier: "named-network",
    });
  });

  it("keeps a present D3 binding qualifier absent only when both projections omit it", async () => {
    const explicit = withExplicitD3EvidenceQualifier(
      await readEscalationConsumerSources(),
    );
    const absent = {
      ...explicit,
      adoptionInventory: mutateAdoptionRecord(
        replaceRequired(
          explicit.adoptionInventory,
          ", evidence-qualifier `named-network`",
          "",
        ),
        "D3",
        (record) => {
          (
            record.direct_route_clauses as Record<string, unknown>[]
          )[0].evidence_qualifier = undefined;
        },
      ),
    };

    expect(absent.adoptionInventory).not.toBe(explicit.adoptionInventory);
    expect(validateEscalationConsumerContracts(absent)).toEqual([]);
    expect(
      parseAgentRoutingPolicyOwner(
        absent.adoptionInventory,
      ).directChildRoutes.find((route) => route.id === "D3")?.clauses[0]
        .qualifier,
    ).toBeUndefined();
  });

  it("keeps D3 binding and qualifier independently coherent", async () => {
    const explicit = withExplicitD3EvidenceQualifier(
      await readEscalationConsumerSources(),
    );
    const bindingOnly = {
      ...explicit,
      adoptionInventory: mutateAdoptionRecord(
        replaceRequired(
          explicit.adoptionInventory,
          "network-binding `dispatch-named`",
          "network-binding `dispatch-curated`",
        ),
        "D3",
        (record) => {
          (
            record.direct_route_clauses as Record<string, unknown>[]
          )[0].network_binding = "dispatch-curated";
        },
      ),
    };
    const qualifierOnly = {
      ...explicit,
      adoptionInventory: mutateAdoptionRecord(
        replaceRequired(
          explicit.adoptionInventory,
          "evidence-qualifier `named-network`",
          "evidence-qualifier `curated-network`",
        ),
        "D3",
        (record) => {
          (
            record.direct_route_clauses as Record<string, unknown>[]
          )[0].evidence_qualifier = "curated-network";
        },
      ),
    };

    expect(validateEscalationConsumerContracts(bindingOnly)).toEqual([]);
    expect(validateEscalationConsumerContracts(qualifierOnly)).toEqual([]);
  });

  const evidenceQualifierCases: Array<{
    name: string;
    mutate: (value: EscalationConsumerSources) => EscalationConsumerSources;
    expected: string;
  }> = [
    {
      name: "table-only qualifier",
      mutate: (value) => ({
        ...value,
        adoptionInventory: replaceRequired(
          value.adoptionInventory,
          "evidence-qualifier `named-network`",
          "evidence-qualifier `curated-network`",
        ),
      }),
      expected:
        "Escalation adoption D3 evidence_qualifier must match direct-route clause 1",
    },
    {
      name: "duplicate table qualifier operand",
      mutate: (value) => ({
        ...value,
        adoptionInventory: replaceRequired(
          value.adoptionInventory,
          "evidence-qualifier `named-network`",
          "evidence-qualifier `named-network`, evidence-qualifier `named-network`",
        ),
      }),
      expected:
        "Agent routing policy owner direct-route D3 operand is duplicated: evidence_qualifier",
    },
    {
      name: "empty human qualifier value",
      mutate: (value) => ({
        ...value,
        adoptionInventory: replaceRequired(
          value.adoptionInventory,
          "evidence-qualifier `named-network`",
          "evidence-qualifier ``",
        ),
      }),
      expected:
        "Agent routing policy owner direct-route D3 evidence_qualifier must be one non-empty string",
    },
    {
      name: "malformed nonempty human qualifier slug",
      mutate: (value) => ({
        ...value,
        adoptionInventory: replaceRequired(
          value.adoptionInventory,
          "evidence-qualifier `named-network`",
          "evidence-qualifier `named_network`",
        ),
      }),
      expected:
        "Agent routing policy owner direct-route D3 evidence_qualifier must be one non-empty slug: named_network",
    },
    {
      name: "descriptor-only qualifier",
      mutate: (value) => ({
        ...value,
        adoptionInventory: mutateAdoptionRecord(
          value.adoptionInventory,
          "D3",
          (record) => {
            (
              record.direct_route_clauses as Record<string, unknown>[]
            )[0].evidence_qualifier = "curated-network";
          },
        ),
      }),
      expected:
        "Escalation adoption D3 evidence_qualifier must match direct-route clause 1",
    },
    {
      name: "missing qualifier field",
      mutate: (value) => ({
        ...value,
        adoptionInventory: mutateAdoptionRecord(
          value.adoptionInventory,
          "D3",
          (record) => {
            (
              record.direct_route_clauses as Record<string, unknown>[]
            )[0].evidence_qualifier = undefined;
          },
        ),
      }),
      expected:
        "Escalation adoption D3 evidence_qualifier must match direct-route clause 1",
    },
    {
      name: "unexpected qualifier field",
      mutate: (value) => ({
        ...value,
        adoptionInventory: mutateAdoptionRecord(
          value.adoptionInventory,
          "D3",
          (record) => {
            (
              record.direct_route_clauses as Record<string, unknown>[]
            )[0].evidence_qualifier_extra = "named-network";
          },
        ),
      }),
      expected:
        "Escalation adoption D3 direct_route_clause fields identities must match exactly; missing: none; unexpected: evidence_qualifier_extra",
    },
    {
      name: "duplicate qualifier field",
      mutate: (value) => ({
        ...value,
        adoptionInventory: replaceRequired(
          value.adoptionInventory,
          '"evidence_qualifier":"named-network"',
          '"evidence_qualifier":"named-network","evidence_qualifier":"named-network"',
        ),
      }),
      expected:
        "Escalation anchor has duplicate key evidence_qualifier: docs/guidelines/agent-routing-and-mutation-policy.md",
    },
    {
      name: "empty qualifier slug",
      mutate: (value) => ({
        ...value,
        adoptionInventory: mutateAdoptionRecord(
          value.adoptionInventory,
          "D3",
          (record) => {
            (
              record.direct_route_clauses as Record<string, unknown>[]
            )[0].evidence_qualifier = "";
          },
        ),
      }),
      expected:
        "Escalation adoption D3 direct_route_clause evidence_qualifier must be one non-empty string",
    },
    {
      name: "malformed qualifier slug",
      mutate: (value) => ({
        ...value,
        adoptionInventory: mutateAdoptionRecord(
          value.adoptionInventory,
          "D3",
          (record) => {
            (
              record.direct_route_clauses as Record<string, unknown>[]
            )[0].evidence_qualifier = "named_network";
          },
        ),
      }),
      expected:
        "Escalation adoption D3 direct_route_clause evidence_qualifier must be one non-empty slug: named_network",
    },
  ];
  for (const control of evidenceQualifierCases) {
    it(`fails closed for D3 evidence qualifier: ${control.name}`, async () => {
      const explicit = withExplicitD3EvidenceQualifier(
        await readEscalationConsumerSources(),
      );
      const mutated = control.mutate(explicit);
      expect(mutated.adoptionInventory, control.name).not.toBe(
        explicit.adoptionInventory,
      );
      expect(
        validateEscalationConsumerContracts(mutated),
        control.name,
      ).toEqual([control.expected]);
    });
  }
});
