import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_REQUEST_TRIGGER_CONTRACTS,
  getMarkdownSection,
  normalizeWhitespace,
  readRepoFile,
  readSkillSource,
} from "../__test-helpers__/skill-contracts.js";

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

function parseDotDirectedEdges(content: string): Array<[string, string]> {
  const edges: Array<[string, string]> = [];

  for (const line of content.split("\n")) {
    const edgeClause = line.split("[", 1)[0].trim().replace(/;$/, "");
    if (!edgeClause.includes("->")) {
      continue;
    }

    const nodes = edgeClause.split("->").map((node) => node.trim());
    for (let index = 0; index < nodes.length - 1; index += 1) {
      edges.push([nodes[index], nodes[index + 1]]);
    }
  }

  return edges;
}

function dotNeighbors(
  edges: Array<[string, string]>,
  node: string,
  direction: "predecessors" | "successors",
): string[] {
  return edges
    .filter(([source, target]) =>
      direction === "successors" ? source === node : target === node,
    )
    .map(([source, target]) => (direction === "successors" ? target : source))
    .sort();
}

function dotCanReach(
  edges: Array<[string, string]>,
  source: string,
  target: string,
): boolean {
  const pending = [source];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) {
      continue;
    }
    if (current === target) {
      return true;
    }
    visited.add(current);
    pending.push(...dotNeighbors(edges, current, "successors"));
  }

  return false;
}

const CHILD_AGENT_PROMPT_TEMPLATES = [
  "references/implementer-prompt.md",
  "references/executor-prompt.md",
  "references/spec-reviewer-prompt.md",
  "references/code-quality-reviewer-prompt.md",
] as const;

const CHILD_AGENT_TEMPLATE_SENTINELS = [
  {
    path: "skills/play-subagent-execution/references/implementer-prompt.md",
    phrase: "If you have questions about:",
  },
  {
    path: "skills/play-subagent-execution/references/executor-prompt.md",
    phrase: "Executor mode is only for an exact validated authorized operation",
  },
  {
    path: "skills/play-subagent-execution/references/spec-reviewer-prompt.md",
    phrase: "The implementer finished suspiciously quickly",
  },
  {
    path: "skills/play-subagent-execution/references/code-quality-reviewer-prompt.md",
    phrase: "WHAT_WAS_IMPLEMENTED: [from implementer's report]",
  },
] as const;

const BRANCH_POLICY_REFERENCES = [
  {
    label: "review routing",
    path: "references/review-routing-policy.md",
    sentinel: "Route computation MUST inspect the actual task diff",
  },
  {
    label: "skip-dispatch behavior",
    path: "references/skip-dispatch-policy.md",
    sentinel:
      "guardrails pass before either guarded inline execution or executor dispatch",
  },
  {
    label: "lifecycle/status handling",
    path: "references/lifecycle-status-policy.md",
    sentinel: "Before acting on any returned D12 implementer",
  },
  {
    label: "snapshot consumption",
    path: "references/snapshot-consumption.md",
    sentinel: "Skip snapshots only for clearly localized, low-risk work",
  },
  {
    label: "diagrams",
    path: "references/process-diagrams.md",
    sentinel: "digraph process",
  },
  {
    label: "examples",
    path: "references/example-workflow.md",
    sentinel: "Parallel happy path: same-head spec and quality pass",
  },
  {
    label: "rationale",
    path: "references/advantages.md",
    sentinel: "Quality gates",
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

  it("keeps the Phase 3 diagram aligned with root-owned sibling dispatch and synthesis", async () => {
    const diagram = await readRepoFile(
      "skills/issue-priming-workflow/references/workflow-diagram.md",
    );
    const normalizedDiagram = normalizeWhitespace(diagram);
    const edges = parseDotDirectedEdges(diagram);

    for (const phrase of [
      "Root dispatches exactly one required internal investigator",
      "Root dispatches zero or one conditional external investigator total",
      "Immediate external criterion met before internal report?",
      "Late external criterion met after internal External Uncertainties?",
      "Join all applicable direct children",
      "Root synthesizes final research brief",
      "Root persists final research brief",
    ]) {
      expect(normalizedDiagram).toContain(phrase);
    }

    expect(
      dotNeighbors(edges, "immediate_external_decide", "successors"),
    ).toEqual(["immediate_fork", "late_internal_research"]);
    expect(dotNeighbors(edges, "immediate_fork", "successors")).toEqual([
      "immediate_external_research",
      "immediate_internal_research",
    ]);
    expect(
      dotNeighbors(edges, "immediate_internal_research", "successors"),
    ).toEqual(["immediate_join"]);
    expect(
      dotNeighbors(edges, "immediate_external_research", "successors"),
    ).toEqual(["immediate_join"]);
    expect(dotNeighbors(edges, "immediate_join", "predecessors")).toEqual([
      "immediate_external_research",
      "immediate_internal_research",
    ]);
    expect(dotNeighbors(edges, "immediate_join", "successors")).toEqual([
      "research_join",
    ]);

    expect(
      dotNeighbors(edges, "late_internal_research", "predecessors"),
    ).toEqual(["immediate_external_decide"]);
    expect(dotNeighbors(edges, "late_internal_research", "successors")).toEqual(
      ["late_external_decide"],
    );
    expect(dotNeighbors(edges, "late_external_decide", "successors")).toEqual([
      "late_external_research",
      "research_join",
    ]);
    expect(
      dotNeighbors(edges, "late_external_research", "predecessors"),
    ).toEqual(["late_external_decide"]);
    expect(dotNeighbors(edges, "late_external_research", "successors")).toEqual(
      ["research_join"],
    );

    expect(dotCanReach(edges, "immediate_fork", "late_external_research")).toBe(
      false,
    );
    expect(
      dotCanReach(
        edges,
        "late_internal_research",
        "immediate_external_research",
      ),
    ).toBe(false);
    expect(dotNeighbors(edges, "internal_research", "successors")).toEqual([]);
    expect(dotNeighbors(edges, "research_join", "predecessors")).toEqual([
      "immediate_join",
      "late_external_decide",
      "late_external_research",
    ]);
    expect(dotNeighbors(edges, "research_join", "successors")).toEqual([
      "research_outcome",
    ]);
    expect(dotNeighbors(edges, "research_outcome", "successors")).toEqual([
      "research_internal_inline",
      "research_required_stop",
      "research_synthesize",
    ]);
    expect(dotNeighbors(edges, "research_synthesize", "successors")).toEqual([
      "research_persist",
    ]);
    expect(dotNeighbors(edges, "research_persist", "successors")).toEqual([
      "brainstorm",
    ]);
    expect(
      dotNeighbors(edges, "research_internal_inline", "successors"),
    ).toEqual(["brainstorm"]);
    expect(dotNeighbors(edges, "research_required_stop", "successors")).toEqual(
      [],
    );
    expect(
      dotCanReach(edges, "research_required_stop", "research_persist"),
    ).toBe(false);
    expect(dotCanReach(edges, "research_required_stop", "brainstorm")).toBe(
      false,
    );
    expect(
      dotCanReach(edges, "research_internal_inline", "research_persist"),
    ).toBe(false);
    expect(
      dotCanReach(
        edges,
        "immediate_internal_research",
        "late_external_research",
      ),
    ).toBe(false);
    expect(
      dotCanReach(
        edges,
        "late_external_research",
        "immediate_external_research",
      ),
    ).toBe(false);
    expect(
      dotNeighbors(edges, "immediate_internal_research", "predecessors"),
    ).toEqual(["immediate_fork"]);
    expect(
      dotNeighbors(edges, "immediate_external_research", "predecessors"),
    ).toEqual(["immediate_fork"]);
    expect(dotNeighbors(edges, "immediate_fork", "predecessors")).toEqual([
      "immediate_external_decide",
    ]);
    expect(
      dotNeighbors(edges, "immediate_external_decide", "predecessors"),
    ).toEqual(["external_policy"]);
    expect(dotNeighbors(edges, "external_policy", "predecessors")).toEqual([
      "decide",
    ]);
    expect(dotNeighbors(edges, "external_policy", "successors")).toEqual([
      "immediate_external_decide",
    ]);
    expect(dotNeighbors(edges, "decide", "successors")).toEqual([
      "brainstorm",
      "external_policy",
    ]);
    expect(dotCanReach(edges, "immediate_join", "late_internal_research")).toBe(
      false,
    );
    expect(dotCanReach(edges, "late_external_decide", "immediate_join")).toBe(
      false,
    );
    expect(dotNeighbors(edges, "late_external_decide", "predecessors")).toEqual(
      ["late_internal_research"],
    );
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

    for (const { label, path, sentinel } of BRANCH_POLICY_REFERENCES) {
      expect(referenceMap).toContain(label);
      expect(referenceMap).toContain(path);
      expect(normalizeWhitespace(referenceMap)).toContain("Load when");

      const referenceSource = await readRepoFile(
        `skills/play-subagent-execution/${path}`,
      );
      expect(referenceSource).toContain(sentinel);
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

  it("keeps full child-agent dispatch prompt bodies out of SKILL.md", async () => {
    const skillSource = await readSkillSource("play-subagent-execution");

    for (const { path, phrase } of CHILD_AGENT_TEMPLATE_SENTINELS) {
      const templateSource = await readRepoFile(path);

      expect(templateSource).toContain(phrase);
      expect(skillSource).not.toContain(phrase);
    }
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
    const processDiagrams = await readRepoFile(
      "skills/play-subagent-execution/references/process-diagrams.md",
    );
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
    const normalizedProcessDiagrams = normalizeWhitespace(processDiagrams);
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
    expect(normalizedProcessDiagrams).toContain(
      "Inline branch: no child DONE report or snapshot request",
    );
    expect(normalizedProcessDiagrams).toContain(
      "Dispatched D13: capture DONE report and snapshot state",
    );
    expect(processDiagrams).toContain(
      '[label="DONE or purely observational DONE_WITH_CONCERNS"]',
    );
    expect(processDiagrams).toContain(
      '[label="judgment-bearing concerns: route D12 via lifecycle/status policy"]',
    );
    expect(processDiagrams).not.toContain(
      '[label="DONE or DONE_WITH_CONCERNS"]',
    );
    expect(processDiagrams).not.toContain(
      '"Dispatched D13: capture DONE report and snapshot state" -> "Mark task complete" [label="single-task plan"]',
    );
    expect(normalizedProcessDiagrams).toContain(
      "These diagrams are non-normative summaries of the controller flow",
    );
    expect(normalizedProcessDiagrams).toContain(
      "Capture-to-spawn arrows are labeled `capture succeeds`; omitted capture, cleanup, verification, returned-status, and terminal failure edges are deliberate and are governed by [`lifecycle-status-policy.md`](lifecycle-status-policy.md)",
    );
    for (const edge of [
      '"Capture separate D14 and D15 baselines" -> "Dispatch spec and quality reviewers for same task head" [label="capture succeeds"]',
      '"Capture D14 baseline" -> "Dispatch spec reviewer" [label="capture succeeds"]',
      '"Fresh D16 capture" -> "Dispatch final whole-implementation code-quality reviewer" [label="capture succeeds"]',
    ]) {
      expect(processDiagrams).toContain(edge);
    }
    expect(processDiagrams).not.toContain("captures succeeded?");
    expect(processDiagrams).not.toContain("capture succeeded?");
    expect(processDiagrams).not.toContain("no: capture failure");
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
    expect(normalizedProcessDiagrams).not.toContain(
      "controller executes the file change inline instead of dispatching an implementer subagent",
    );
    expect(skillSource).not.toContain("mechanical-implementer-prompt.md");
  });

  it("keeps planning contract-checklist and review-routing rules in source", async () => {
    const playPlanning = await readSkillSource("play-planning");
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
      "detailed taxonomy (positive and negative examples) lives in [`skills/play-subagent-execution/references/skip-dispatch-policy.md` § Mechanical Task Taxonomy]",
    );
    expect(normalizedOptionalModeField).not.toContain(
      "SKILL.md` § Mechanical Task Taxonomy",
    );
    for (const requiredField of [
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
      "**Contract checklist:**",
      "**Acceptance criteria:**",
      "**Risks:**",
      "**Dependencies:**",
      "**Verification expectations:**",
      "**Proof sufficiency:**",
    ]) {
      expect(mechanicalTaskExample).toContain(requiredField);
    }

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
      "Field order is the task heading, optional `**Mode:** mechanical`, optional review-routing hints, then `**Files:**`",
    );
    expect(playPlanning).toContain("references/planning-criteria.md");
    expect(playPlanning).toContain(
      "../play-subagent-execution/references/review-routing-policy.md",
    );
    expect(normalizeWhitespace(playPlanning)).toContain(
      "conditional one-level reference from this workflow",
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
      "The controller then reads the plan from the path and proceeds with task extraction",
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
    const processDiagrams = await readRepoFile(
      "skills/play-subagent-execution/references/process-diagrams.md",
    );
    const redFlags = await readRepoFile(
      "skills/play-subagent-execution/references/red-flags.md",
    );
    const normalizedSkill = normalizeWhitespace(playSubagentExecution);
    const normalizedAdvantages = normalizeWhitespace(advantages);
    const normalizedExampleWorkflow = normalizeWhitespace(exampleWorkflow);
    const normalizedProcessDiagrams = normalizeWhitespace(processDiagrams);
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

    expect(normalizedProcessDiagrams).toContain(
      "Report implementation and final review status; resolve branch-level review status",
    );
    expect(normalizedProcessDiagrams).toContain(
      "Active workflow requires branch-level review before PR creation?",
    );
    expect(normalizedProcessDiagrams).toContain(
      '"Active workflow requires branch-level review before PR creation?" -> "Hand off to branch-review before play-branch-finish" [label="yes"]',
    );
    expect(normalizedProcessDiagrams).toContain(
      '"Branch-review approval evidence or explicit waiver present?" -> "Invoke play-branch-finish" [label="yes"]',
    );
    expect(normalizedProcessDiagrams).toContain(
      '"Active workflow requires branch-level review before PR creation?" -> "Invoke play-branch-finish" [label="no"]',
    );
    expect(normalizedProcessDiagrams).not.toContain(
      "Report implementation and final review passed; invoke play-branch-finish",
    );
    expect(normalizedProcessDiagrams).not.toContain(
      "then invokes `play-branch-finish`",
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
    const processDiagrams = await readRepoFile(
      "skills/play-subagent-execution/references/process-diagrams.md",
    );
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
    const normalizedProcessDiagrams = normalizeWhitespace(processDiagrams);
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
    expect(normalizedProcessDiagrams).toContain(
      "Dispatch spec and quality reviewers for same task head",
    );
    expect(normalizedProcessDiagrams).toContain(
      '"Spec-only review passes?" -> "Mark task complete" [label="yes"]',
    );
    expect(normalizedProcessDiagrams).toContain(
      "Join same-head review results",
    );
    expect(normalizedProcessDiagrams).toContain(
      "Quality result final for same reviewed head?",
    );
    expect(normalizedProcessDiagrams).toContain(
      '"Quality result final for same reviewed head?" -> "Resolve quality disposition or rerun quality" [label="no"]',
    );
    expect(normalizedProcessDiagrams).toContain(
      '"Resolve quality disposition or rerun quality" -> "Join same-head review results"',
    );
    expect(normalizedProcessDiagrams).toContain(
      '"Quality findings present?" -> "Implementer fixes findings" [label="yes"]',
    );
    expect(normalizedProcessDiagrams).toContain(
      '"Quality findings present?" -> "Mark task complete" [label="no"]',
    );
    expect(normalizedProcessDiagrams).toContain(
      "Spec passes for reviewed head?",
    );
    expect(normalizedProcessDiagrams).not.toContain(
      '"Quality result final for same reviewed head?" -> "Implementer fixes findings" [label="no"]',
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
    const processDiagrams = await readRepoFile(
      "skills/play-subagent-execution/references/process-diagrams.md",
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
      [skillSource, lifecycle, processDiagrams, exampleWorkflow].join("\n"),
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
});
