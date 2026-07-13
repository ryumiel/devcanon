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
  "references/mechanical-implementer-prompt.md",
  "references/spec-reviewer-prompt.md",
  "references/code-quality-reviewer-prompt.md",
] as const;

const CHILD_AGENT_TEMPLATE_SENTINELS = [
  {
    path: "skills/play-subagent-execution/references/implementer-prompt.md",
    phrase: "If you have questions about:",
  },
  {
    path: "skills/play-subagent-execution/references/mechanical-implementer-prompt.md",
    phrase: "Mechanical mode is only for approved verbatim artifact work",
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
    sentinel: "All five guardrails must hold for inline execution",
  },
  {
    label: "lifecycle/status handling",
    path: "references/lifecycle-status-policy.md",
    sentinel: "Before acting on any returned status",
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

const RETENTION_RESOLUTION_REQUIREMENTS = [
  [
    "retention-resolution-terminal-capture",
    "current `completed`, `timed-out`, `failed`, or `superseded` and fresh capture",
  ],
  [
    "retention-resolution-need-finished-basis",
    "`retention-resolved(basis=need-finished, evidence=...)`",
  ],
  [
    "retention-resolution-captured-proof",
    "latest `close-deferred` < value-bearing `required-state-captured` < `replacement-secured` < `retention-resolved(basis=captured-and-replaced, evidence=...)`",
  ],
] as const;

const RETENTION_RESOLUTION_MUTATIONS = [
  [
    "missing need-finished basis",
    RETENTION_RESOLUTION_REQUIREMENTS[1][1],
    "`retention-resolved(evidence=...)`",
    RETENTION_RESOLUTION_REQUIREMENTS[1][0],
  ],
  [
    "missing captured-and-replaced basis",
    "`retention-resolved(basis=captured-and-replaced, evidence=...)`",
    "`retention-resolved(evidence=...)`",
    RETENTION_RESOLUTION_REQUIREMENTS[2][0],
  ],
  [
    "stale pre-deferral capture",
    RETENTION_RESOLUTION_REQUIREMENTS[2][1],
    "value-bearing `required-state-captured` < latest `close-deferred` < `replacement-secured` < `retention-resolved(basis=captured-and-replaced, evidence=...)`",
    RETENTION_RESOLUTION_REQUIREMENTS[2][0],
  ],
  [
    "replacement before capture",
    RETENTION_RESOLUTION_REQUIREMENTS[2][1],
    "latest `close-deferred` < `replacement-secured` < value-bearing `required-state-captured` < `retention-resolved(basis=captured-and-replaced, evidence=...)`",
    RETENTION_RESOLUTION_REQUIREMENTS[2][0],
  ],
] as const;

function retentionResolutionProofErrors(section: string): string[] {
  const normalizedSection = normalizeWhitespace(section);
  return RETENTION_RESOLUTION_REQUIREMENTS.filter(
    ([, evidence]) => !normalizedSection.includes(evidence),
  ).map(([code]) => code);
}

function expectRetentionResolutionMutations(section: string): void {
  const normalizedSection = normalizeWhitespace(section);
  for (const [name, from, to, code] of RETENTION_RESOLUTION_MUTATIONS) {
    expect(
      retentionResolutionProofErrors(normalizedSection.replace(from, to)),
      name,
    ).toContain(code);
  }
}

describe("play subagent routing source contracts", () => {
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
    const normalizedPhase6 = normalizeWhitespace(phase6);
    const normalizedPhase7 = normalizeWhitespace(phase7);
    const normalizedPhase6Reference = normalizeWhitespace(phase6Reference);

    expect(phase2).toContain("payload.research = gated");
    expect(phase2).toContain("payload.research = forced");
    expect(phase2).toContain("forced by --research");
    expect(phase2).toContain("{{model:standard}}");
    expect(phase2).toContain("{{model:deep}}");
    expect(phase3).toContain("research-agent");
    expect(phase3).toContain("read-only");
    expect(phase3).toContain("{{model:standard}}");
    expect(phase3).toContain("{{model:deep}}");
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
      "cleanup gate for completed, timed-out, failed, or superseded gate and research sessions",
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
    const researchPrompt = await readRepoFile(
      "skills/issue-priming-workflow/references/research-agent-prompt.md",
    );
    const phase3 = sliceBetween(
      issuePrimingWorkflow,
      "## Phase 3: Research (Conditional)",
      "## Phase 4: Invoke Brainstorming",
    );
    const normalizedPhase3 = normalizeWhitespace(phase3);
    const lifecycleConcurrentJoin = sliceBetween(
      phase3,
      "### Lifecycle and Concurrent Join",
      "### Child Report Validation",
    );
    const lifecycleProjectionErrors = (section: string): string[] => {
      const normalizedSection = normalizeWhitespace(section);
      const errors: string[] = [];
      for (const family of [
        "successful",
        "deliberately deferred",
        "failed-attempt",
        "unavailable",
      ]) {
        if (!normalizedSection.includes(family)) {
          errors.push(`missing-${family}`);
        }
      }
      if (
        normalizedSection.includes(
          "otherwise record the honest `close-unavailable` outcome",
        )
      ) {
        errors.push("binary-cleanup-fallback");
      }
      if (
        !normalizedSection.includes(
          "complete shared cleanup projection contract",
        )
      ) {
        errors.push("owner-projection-delegation");
      }
      if (
        !normalizedSection.includes("unavailable-reason history") ||
        !normalizedSection.includes(
          "current unavailable-cleanup reason as a separate latest projection",
        )
      ) {
        errors.push("unavailable-reason-history");
      }
      return errors;
    };
    const immediateJoinRecoveryErrors = (section: string): string[] => {
      const normalizedSection = normalizeWhitespace(section);
      const errors: string[] = [];
      if (
        !normalizedSection.includes(
          "started immediate internal or external research sibling",
        ) ||
        !normalizedSection.includes(
          "do not authorize replacement or supersession as a terminal shortcut",
        )
      ) {
        errors.push("started-sibling-no-shortcut");
      }
      if (
        !normalizedSection.includes(
          "Wait, reuse, or steer the original sibling until it reaches completion, timeout, or runtime failure",
        )
      ) {
        errors.push("started-sibling-reachable-terminal");
      }
      if (
        !normalizedSection.includes("cannot be done safely, stop and escalate")
      ) {
        errors.push("unsafe-join-stops");
      }
      if (
        !normalizedSection.includes(
          "pending row that never actually started may resolve identity or record dispatch failure separately",
        )
      ) {
        errors.push("pre-start-pending-distinction");
      }
      if (
        !normalizedSection.includes(
          "Preserve the original internal-before-external dispatch order and join both started sibling rows",
        )
      ) {
        errors.push("join-order");
      }
      return errors;
    };
    const retainedRecoveryErrors = (section: string): string[] => {
      const normalizedSection = normalizeWhitespace(section);
      const errors = retentionResolutionProofErrors(normalizedSection);
      if (
        !normalizedSection.includes(
          "Preserve the historical `close-deferred` event and reason",
        )
      ) {
        errors.push("retention-resolution-history");
      }
      if (
        !normalizedSection.includes(
          "clear the current retained cleanup decision and current retention reason",
        ) ||
        !normalizedSection.includes(
          "cleanup evaluation `evaluated`, sets current cleanup decision to `none`, clears current retention and unavailable reasons, and projects `closed=no`",
        ) ||
        !normalizedSection.includes(
          "A later `closure-unavailable` or actual close event selects one of the four cleanup families",
        )
      ) {
        errors.push("retention-resolution-current-state");
      }
      if (
        !normalizedSection.includes(
          "The shared owner, not this workflow, owns any episode authorization after row capture",
        )
      ) {
        errors.push("episode-authorization-delegation");
      }
      return errors;
    };
    const recoveryEpisodeErrors = (section: string): string[] => {
      const normalizedSection = normalizeWhitespace(section);
      const errors: string[] = [];
      if (
        !normalizedSection.includes(
          "Defer recovery-episode storage and every episode transition to the shared owner",
        ) ||
        !normalizedSection.includes(
          "The owner records and validates the immutable tagged blocker snapshot, row-close references, episode manual confirmations, authorization, reconstruction, retry dispatch/result, and escalation",
        )
      ) {
        errors.push("recovery-episode-snapshot");
      }
      if (
        !normalizedSection.includes(
          "This workflow supplies only its captured research scope, report result, source references, blocker state, lifecycle ledger, and repository anchors",
        ) ||
        !normalizedSection.includes(
          "resumes workflow-local routing only after the owner returns a terminal recovery result",
        )
      ) {
        errors.push("workflow-local-recovery-dependency");
      }
      if (
        !normalizedSection.includes(
          "A shared-owner escalation stops research persistence and Phase 4",
        )
      ) {
        errors.push("owner-escalation-routing");
      }
      return errors;
    };
    const interruptedReuseRequirements = [
      "current operational state is `interrupted`",
      "`interrupted-reuse-dispatch-requested(session-id=<matching-stable-id>)`",
      "positive observed reuse capability",
      "required role-state capture newer than its latest interruption",
      "project `active`",
      "preserve history",
      "add no completion or return",
      "guarded reuse or deliberate retention requires no replacement",
      "supersession alone requires secured replacement state",
    ] as const;
    const interruptedReuseGuidanceErrors = (section: string): string[] => {
      const normalizedSection = normalizeWhitespace(section);
      return interruptedReuseRequirements.filter(
        (evidence) => !normalizedSection.includes(evidence),
      );
    };

    expect(normalizedPhase3).toContain(
      "The depth-0 root is the sole research dispatcher",
    );
    expect(normalizedPhase3).toContain(
      "Every `research-agent` is a direct depth-1 read-only leaf child",
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
    expect(normalizeWhitespace(researchPrompt)).toContain(
      "Do not spawn or delegate to another agent",
    );
    expect(researchPrompt).not.toContain("Dispatch sub-agents");

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
    expect(normalizedPhase3).toContain(
      "capture scope, report result, source references, and blocker state before cleanup",
    );
    expect(normalizedPhase3).toContain(
      "preserve the owner-defined current state `timed-out` or `failed` and the value-bearing `turn-timed-out(reason=...)` or `turn-failed(error=...)` event",
    );
    expect(normalizedPhase3).toContain(
      "When no turn returned, keep workflow return status and its history absent",
    );
    expect(normalizedPhase3).toContain(
      "Before any manual cleanup, use the owner classifications for open blockers",
    );
    for (const openStateRule of [
      "active rows wait or steer to a safe capture boundary or stop",
      "waiting rows are retained or safely replaced",
      "Pending or unknown rows resolve identity or stop without fabricated cleanup",
    ]) {
      expect(normalizedPhase3).toContain(openStateRule);
    }
    expect(normalizedPhase3).toContain(
      "only that owner records or validates episode manual confirmation, reconstruction, and retry",
    );
    expect(lifecycleProjectionErrors(lifecycleConcurrentJoin)).toEqual([]);
    expect(immediateJoinRecoveryErrors(lifecycleConcurrentJoin)).toEqual([]);
    expect(retainedRecoveryErrors(lifecycleConcurrentJoin)).toEqual([]);
    expectRetentionResolutionMutations(lifecycleConcurrentJoin);
    expect(recoveryEpisodeErrors(lifecycleConcurrentJoin)).toEqual([]);
    expect(interruptedReuseGuidanceErrors(lifecycleConcurrentJoin)).toEqual([]);
    for (const evidence of interruptedReuseRequirements) {
      expect(
        interruptedReuseGuidanceErrors(
          normalizeWhitespace(lifecycleConcurrentJoin).replace(
            evidence,
            "weakened interrupted reuse rule",
          ),
        ),
      ).toContain(evidence);
    }
    expect(
      recoveryEpisodeErrors(
        normalizeWhitespace(lifecycleConcurrentJoin).replace(
          "resumes workflow-local routing only after the owner returns a terminal recovery result",
          "resumes workflow-local routing before the owner returns a terminal recovery result",
        ),
      ),
    ).toEqual(["workflow-local-recovery-dependency"]);
    expect(
      retainedRecoveryErrors(
        normalizeWhitespace(lifecycleConcurrentJoin).replace(
          "The shared owner, not this workflow, owns any episode authorization after row capture",
          "This workflow owns episode authorization after row capture",
        ),
      ),
    ).toEqual(["episode-authorization-delegation"]);
    expect(
      immediateJoinRecoveryErrors(
        normalizeWhitespace(lifecycleConcurrentJoin).replace(
          "do not authorize replacement or supersession as a terminal shortcut",
          "authorize replacement or supersession as a terminal shortcut",
        ),
      ),
    ).toEqual(["started-sibling-no-shortcut"]);
    expect(
      immediateJoinRecoveryErrors(
        normalizeWhitespace(lifecycleConcurrentJoin).replace(
          "cannot be done safely, stop and escalate",
          "cannot be done safely, replace the sibling",
        ),
      ),
    ).toEqual(["unsafe-join-stops"]);
    expect(
      lifecycleProjectionErrors(
        normalizeWhitespace(lifecycleConcurrentJoin).replace(
          "successful, deliberately deferred, failed-attempt, and unavailable",
          "successful and unavailable",
        ),
      ),
    ).toEqual(["missing-deliberately deferred", "missing-failed-attempt"]);
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

  it("keeps the Phase 3 diagram aligned with root-owned sibling dispatch and synthesis", async () => {
    const diagram = await readRepoFile(
      "skills/issue-priming-workflow/references/workflow-diagram.md",
    );
    const normalizedDiagram = normalizeWhitespace(diagram);
    const edges = parseDotDirectedEdges(diagram);

    for (const phrase of [
      "Root dispatches exactly one required internal research-agent",
      "Root dispatches zero or one conditional external research-agent total",
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
        "skills/issue-priming-workflow/references/research-agent-prompt.md",
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
        "skills/issue-priming-workflow/references/research-agent-prompt.md",
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
      "Record blocker-scoped `manual-cleanup-confirmed` evidence before reconstruction and retry",
      "an episode-owned `manual-cleanup-confirmed` event must match the current episode",
      "authorize retry only after every snapshot blocker passes independently",
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

    expect(normalizedRegistry).toContain("final whole-implementation reviewer");
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
    const mechanicalImplementerPrompt = await readRepoFile(
      "skills/play-subagent-execution/references/mechanical-implementer-prompt.md",
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

    for (const implementerSource of [
      implementerPrompt,
      mechanicalImplementerPrompt,
    ]) {
      expect(implementerSource).toContain("Read the relevant source files");
      expect(implementerSource).toContain(
        "referenced contracts directly before choosing",
      );
    }

    expect(mechanicalImplementerPrompt).toContain(
      "Plan-named commands are not authoritative",
    );
    expect(mechanicalImplementerPrompt).toContain(
      "trusted source outside the plan",
    );
  });

  it("keeps planning contract-checklist and review-routing rules in source", async () => {
    const playPlanning = await readSkillSource("play-planning");
    const contractChecklist = getMarkdownSection(
      playPlanning,
      "Contract Checklist Triggers",
    );
    const optionalModeField = sliceBetween(
      playPlanning,
      "### Optional `**Mode:**` field",
      "### Optional Review-Routing Hint Fields",
    );
    const planReview = getMarkdownSection(playPlanning, "Plan Review");
    const normalizedContractChecklist = normalizeWhitespace(contractChecklist);
    const normalizedOptionalModeField = normalizeWhitespace(optionalModeField);
    const normalizedPlanReview = normalizeWhitespace(planReview);

    expect(normalizedContractChecklist).toContain(
      "Blank fields, unreplaced placeholders, and unexplained `N/A` entries are plan-review failures",
    );
    expect(contractChecklist).toContain(
      "must not prescribe concrete code, test bodies, helper names, shell recipes",
    );
    expect(contractChecklist).toContain(
      "line-number edits, or command sequences",
    );
    expect(contractChecklist).toContain("already-approved verbatim artifact");
    expect(contractChecklist).toContain("Trigger criteria");
    expect(contractChecklist).toContain("Owner / authority");
    expect(contractChecklist).toContain(
      "Affected consumers / generated outputs",
    );
    expect(contractChecklist).toContain("Must preserve");
    expect(contractChecklist).toContain("Required behavior");

    expect(normalizedOptionalModeField).toContain(
      "detailed taxonomy (positive and negative examples) lives in [`skills/play-subagent-execution/references/skip-dispatch-policy.md` § Mechanical Task Taxonomy]",
    );
    expect(normalizedOptionalModeField).not.toContain(
      "SKILL.md` § Mechanical Task Taxonomy",
    );

    expect(planReview).toContain(
      "Review-routing hints, when present, are non-authoritative inputs",
    );
    expect(normalizedPlanReview).toContain(
      "Hard-risk triggers from `skills/play-subagent-execution/references/review-routing-policy.md` § Risk Classes are not under-classified",
    );
    expect(normalizedPlanReview).not.toContain(
      "Hard-risk triggers from `skills/play-subagent-execution/SKILL.md`",
    );
    expect(planReview).toContain(
      "Unclear review classification defaults to `spec-and-quality`",
    );
    expect(planReview).toContain(
      "Foundation-producing tasks are not marked below `spec-only`",
    );
    expect(normalizedPlanReview).toContain(
      "Hint field ordering is heading, optional `**Mode:** mechanical`, optional review-routing hint fields, then `**Files:**`",
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
      "direct/manual terminal handoff resolves whether the active workflow requires `branch-review` before `play-branch-finish`",
    );
    expect(normalizedSingleTaskPlans).toContain(
      "report implementation status and final review status before any branch-review or finish handoff",
    );
    expect(normalizedSingleTaskPlans).toContain(
      "hand off to `branch-review` before any `play-branch-finish` handoff when the active workflow requires branch-level review before PR creation",
    );
    expect(normalizedSingleTaskPlans).toContain(
      "Use `branch-review --fix` as the branch-level gate before finish only when the owning workflow already grants auto-fix authority or the operator explicitly confirms that branch-review may auto-commit fixes",
    );
    expect(normalizedSingleTaskPlans).toContain(
      "Do not invoke `play-branch-finish` until `branch-review` returns review approval evidence or the active workflow explicitly waives branch-level review",
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
      "terminal handoff to resolve branch-level review status before any `play-branch-finish` handoff",
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
    expect(normalizedProcessDiagrams).toContain(
      "If the active workflow requires branch-level review before PR creation, hand off to `branch-review` before any `play-branch-finish` handoff",
    );
    expect(normalizedProcessDiagrams).toContain(
      "Use `branch-review --fix` as the branch-level gate only when the owning workflow already grants auto-fix authority or the operator explicitly confirms that branch-review may auto-commit fixes",
    );
    expect(normalizedProcessDiagrams).toContain(
      "Do not invoke `play-branch-finish` until `branch-review` returns review approval evidence or the active workflow explicitly waives branch-level review",
    );
    expect(normalizedProcessDiagrams).toContain(
      "If that workflow does not require branch-level review, invoke `play-branch-finish`",
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
      "Hard-risk and unclear multi-task tasks use `spec-and-quality`: dispatch spec-compliance and code-quality reviewers concurrently when practical, against the same committed task head, then join their results before final disposition",
    );
    expect(normalizedRouting).toContain(
      "`spec-and-quality`: after route computation and implementer commit, the controller may dispatch the spec-compliance reviewer and code-quality reviewer concurrently against the same captured task head",
    );
    expect(normalizedRouting).toContain(
      "The code-quality result is provisional until spec compliance passes for that same reviewed head and the task head is still current",
    );
    expect(normalizedRouting).toContain(
      "If both reviewers report findings on the same reviewed head, the controller may route the combined spec and code-quality finding set to the same implementer for one fixup round",
    );
    expect(normalizedRouting).toContain(
      "After any spec fixup commit, rerun spec compliance and rerun code quality unless the controller can prove the fixup is irrelevant to the previous quality result",
    );
    expect(normalizedRouting).toContain(
      "Unclear stale-result classification fails closed to rerunning code quality",
    );
    expect(normalizedProcessDiagrams).toContain(
      "prior quality result needs freshness disposition",
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
      "reviewer integration-result state (`pending` or `integrated`), reviewer disposition (`final-pass`, `final-findings`, `advisory`, `stale`, or `superseded`)",
    );
    expect(normalizedLifecycle).not.toContain(
      "reviewer disposition (`pending`",
    );
    expect(normalizedHandlingStatus).toContain(
      "record each controller-local integration-result state as `pending` until its report is integrated",
    );
    expect(normalizedHandlingStatus).toContain(
      "reviewer disposition remains absent until the controller classifies the integrated result",
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
      "Accept a code-quality result as final before same-head spec compliance passes and current task-head validation succeeds",
    );
    expect(normalizedRedFlags).toContain(
      "Treat advisory, stale, or superseded quality as final task approval",
    );
    expect(normalizedRedFlags).toContain(
      "unclear staleness or irrelevance classification fails closed to rerunning code quality",
    );
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
      "reviewer disposition history=[advisory(reason=same-head quality findings are non-final until spec disposition, source-state=task-2-head), stale(reason=task head advanced after fixup, source-state=task-2-fixup-head)], current reviewer disposition=stale",
    );
    expect(normalizedExample).toContain(
      "combined spec and code-quality finding set routed to Task 2 implementer",
    );
    expect(normalizedExample).toContain(
      "cleanup outcome=closed=yes after advisory findings captured and routed",
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
      "this reviewer may dispatch concurrently with spec compliance against the same task head",
    );
    expect(normalizedCodeQualityReviewerPrompt).toContain(
      "Its result is provisional until same-head spec compliance passes and current-head validation succeeds",
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
    const orderedLifecycleEvents = getMarkdownSection(
      skillSource,
      "Ordered Lifecycle Events",
    );
    const resultAndDispositionDimensions = getMarkdownSection(
      skillSource,
      "Result and Disposition Dimensions",
    );
    const cleanupProjection = getMarkdownSection(
      skillSource,
      "Cleanup Projection",
    );
    const knownSurfaceCapabilityMap = getMarkdownSection(
      skillSource,
      "Known-Surface Capability Map",
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
    expect(controllerLifecycleLedger).toContain(
      "one `agent_id` or `agent_id=pending`",
    );
    expect(controllerLifecycleLedger).toContain("role-specific captured state");
    expect(normalizeWhitespace(controllerLifecycleLedger)).toContain(
      "the latest reviewer disposition projection plus append-only classification history with each disposition's concise reason and source-state anchor",
    );
    expect(normalizeWhitespace(controllerLifecycleLedger)).toContain(
      "the current unavailable-cleanup reason only while the latest cleanup decision is unavailable, plus append-only concrete reason history for every `closure-unavailable` event",
    );
    expect(controllerLifecycleLedger).toContain(
      "fixup count or blocker state when relevant",
    );
    expect(normalizeWhitespace(controllerLifecycleLedger)).toContain(
      "one cleanup outcome: `closed=yes`, `closed=no`, or `close-unavailable: <reason>`",
    );
    expect(normalizeWhitespace(controllerLifecycleLedger)).toContain(
      "Role-specific captured state is whatever the owning workflow needs before it can safely close, supersede, or replace that role",
    );
    expect(normalizeWhitespace(controllerLifecycleLedger)).toContain(
      "Operational state, reuse state, target capability class, and cleanup outcome are independent ledger dimensions",
    );
    expect(normalizeWhitespace(controllerLifecycleLedger)).toContain(
      "`pending`, `active`, `waiting`, `interrupted`, `completed`, `timed-out`, `failed`, or `superseded`",
    );
    expect(normalizeWhitespace(controllerLifecycleLedger)).toContain(
      "A pre-dispatch row has operational state `pending` and `agent_id=pending`",
    );
    expect(normalizeWhitespace(controllerLifecycleLedger)).toContain(
      "Interruption and supersession never imply completion or closure",
    );
    expect(normalizeWhitespace(controllerLifecycleLedger)).toContain(
      "Reuse state may be `reusable`; `inventory-only` is a capability class, not an operational state",
    );
    expect(controllerLifecycleLedger).toContain(
      "cleanup evaluation state: `not-evaluated` or `evaluated`",
    );
    expect(normalizeWhitespace(controllerLifecycleLedger)).toContain(
      "do not append `closure-unavailable` merely because `agent_id=pending` is temporary",
    );

    expect(normalizeWhitespace(orderedLifecycleEvents)).toContain(
      "ordered, append-only lifecycle-event history",
    );
    expect(normalizeWhitespace(orderedLifecycleEvents)).toContain(
      "identity-assigned",
    );
    for (const event of [
      "dispatch-requested",
      "followup-dispatch-requested",
      "interrupted-reuse-dispatch-requested",
      "waiting",
      "interrupted",
      "required-state-captured",
      "replacement-secured",
      "turn-completed",
      "superseded",
      "turn-timed-out",
      "turn-failed",
      "close-attempted",
      "close-deferred",
      "retention-resolved",
      "close-failed",
      "close-succeeded",
      "closure-unavailable",
    ]) {
      expect(orderedLifecycleEvents).toContain(`\`${event}\``);
    }
    expect(normalizeWhitespace(orderedLifecycleEvents)).toContain(
      "State changes never erase prior events",
    );
    expect(normalizeWhitespace(orderedLifecycleEvents)).toContain(
      "`followup-dispatch-requested(session-id=...)` requires a `completed` row, matching stable identity, positive observed reuse, and value-bearing capture newer than the latest `turn-completed` or capture-invalidating mutation; capture precedes dispatch",
    );
    expect(normalizeWhitespace(orderedLifecycleEvents)).toContain(
      "`interrupted-reuse-dispatch-requested(session-id=...)` is legal only when the row is currently `interrupted`, the supplied id matches its stable identity, observed reuse capability is positive, and required role-state capture is strictly newer than its latest `interrupted` event",
    );
    expect(normalizeWhitespace(orderedLifecycleEvents)).toContain(
      "Append the interrupted-reuse event without erasing history or detail and project `active`",
    );
    expect(normalizeWhitespace(orderedLifecycleEvents)).toContain(
      "Project `waiting` only after an observed `waiting` event. This re-entry never fabricates `turn-completed`, a workflow return status, or any other return fact",
    );
    expect(normalizeWhitespace(orderedLifecycleEvents)).toContain(
      "Any `active`, `waiting`, or `interrupted` row may be superseded only after its latest open-state transition by ordered `required-state-captured`, `replacement-secured`, and `superseded` events",
    );
    expect(normalizeWhitespace(orderedLifecycleEvents)).toContain(
      "Cleanup never authorizes it",
    );
    expect(normalizeWhitespace(orderedLifecycleEvents)).toContain(
      "Record the concrete workflow-owned retention reason as event-associated detail on each `close-deferred`; an event name without its reason is incomplete",
    );
    expect(normalizeWhitespace(orderedLifecycleEvents)).toContain(
      "A normal returned turn appends `turn-completed` and sets current operational state to `completed`",
    );
    expect(normalizeWhitespace(orderedLifecycleEvents)).toContain(
      "A runtime timeout appends `turn-timed-out` and sets current operational state to `timed-out`; a runtime/session failure appends `turn-failed` and sets it to `failed`",
    );
    expect(normalizeWhitespace(orderedLifecycleEvents)).toContain(
      "These are runtime terminal outcomes, not task failure, reviewer findings, or a workflow-returned `BLOCKED`",
    );
    expect(normalizeWhitespace(orderedLifecycleEvents)).toContain(
      "The abnormal turn appends no workflow return value",
    );
    expect(normalizeWhitespace(orderedLifecycleEvents)).toContain(
      "Workflow return status and its history remain absent only when the session has never returned; an abnormal same-session follow-up preserves all prior return statuses, reviewer dispositions, their histories, and their latest projections",
    );
    expect(normalizeWhitespace(orderedLifecycleEvents)).toContain(
      "That capture requirement follows the abnormal event through later operational projections such as `superseded`",
    );
    expect(normalizeWhitespace(orderedLifecycleEvents)).toContain(
      "Every `closure-unavailable` event carries its concrete reason as event-associated detail and appends that value to unavailable-reason history",
    );
    expect(normalizeWhitespace(orderedLifecycleEvents)).toContain(
      "Use `retention-resolved(basis=need-finished, evidence=...)` only when the deferred need finished",
    );
    expect(normalizeWhitespace(orderedLifecycleEvents)).toContain(
      "latest `close-deferred` < value-bearing `required-state-captured` < `replacement-secured` < `retention-resolved`",
    );
    expect(normalizeWhitespace(orderedLifecycleEvents)).toContain(
      "`retention-resolved` is a lifecycle decision event, not a fifth cleanup projection family, cleanup outcome, or proof of closure",
    );
    expect(normalizeWhitespace(orderedLifecycleEvents)).toContain(
      "Its current projection keeps cleanup `evaluated`, decision `none`, clears current retention and unavailable reasons, and sets `closed=no`",
    );

    expect(normalizeWhitespace(resultAndDispositionDimensions)).toContain(
      "Workflow return status is absent before a return is observed and required after it is observed",
    );
    expect(normalizeWhitespace(resultAndDispositionDimensions)).toContain(
      "Reviewer disposition is absent before classification and required after classification",
    );
    expect(normalizeWhitespace(resultAndDispositionDimensions)).toContain(
      "Every `turn-completed` carries the observed status as event-associated detail and appends that value to status history; the latest value is the current projection",
    );
    expect(normalizeWhitespace(resultAndDispositionDimensions)).toContain(
      "Every classification or reclassification appends the disposition plus a concise reason and source-state anchor; the latest value is the current projection",
    );
    expect(normalizeWhitespace(resultAndDispositionDimensions)).toContain(
      "Completed-session follow-up uses the exact `followup-dispatch-requested` guard above, never the interrupted-reuse event. It projects `active`, preserves history, and fabricates no completion or return; only an observed wait projects `waiting`",
    );

    expect(targetLifecycleCapability).toContain("automatic-close-supported");
    expect(targetLifecycleCapability).toContain(
      "close/session-cleanup operation exist",
    );
    expect(targetLifecycleCapability).toContain("inventory-only");
    expect(targetLifecycleCapability).toContain(
      "close-unavailable: inventory-only; no close operation",
    );
    expect(targetLifecycleCapability).toContain("cleanup-unavailable");
    expect(targetLifecycleCapability).toContain(
      "close-unavailable: no inventory or close operation",
    );
    expect(normalizeWhitespace(targetLifecycleCapability)).toContain(
      "`inventory-only` applies when reliable inventory or a tracked stable identity exists without usable closure",
    );
    expect(normalizeWhitespace(targetLifecycleCapability)).toContain(
      "An exposed close operation without stable identity is unusable",
    );
    expect(normalizeWhitespace(targetLifecycleCapability)).toContain(
      "selects `inventory-only` only when other reliable inventory or tracked stable-identity evidence remains; otherwise it selects `cleanup-unavailable`",
    );
    expect(normalizeWhitespace(targetLifecycleCapability)).toContain(
      "Do not infer support from another target",
    );
    expect(normalizeWhitespace(targetLifecycleCapability)).toContain(
      "Treat `close_agent` as conditional",
    );

    const normalizedSurfaceMap = normalizeWhitespace(knownSurfaceCapabilityMap);
    for (const surface of [
      "Local Codex",
      "Responses API Multi-agent",
      "Claude Code",
      "Unknown targets",
    ]) {
      expect(knownSurfaceCapabilityMap).toContain(surface);
    }
    expect(normalizedSurfaceMap).toContain(
      "model-visible requests to steer, wait, stop, and close threads",
    );
    expect(normalizedSurfaceMap).toContain(
      "Do not promise a low-level action name",
    );
    expect(normalizedSurfaceMap).toContain(
      "Active runtime detection decides whether closure is supported",
    );

    expect(normalizedSurfaceMap).toContain(
      "detect the actions exposed by the active runtime instead of treating a remembered action list as a closed schema",
    );
    expect(normalizedSurfaceMap).toContain(
      "`interrupt_agent` is interruption, not closure",
    );
    expect(normalizedSurfaceMap).toContain(
      "`followup_task` may reuse retained context; and `list_agents` may provide inventory",
    );
    expect(normalizedSurfaceMap).toContain(
      "No hosted close action is promised",
    );
    expect(normalizedSurfaceMap).toContain(
      "detect actual identity, inventory, interruption, reuse, and closure controls",
    );
    expect(normalizedSurfaceMap).toContain(
      "inherits no Codex or Responses API assumptions",
    );
    expect(normalizedSurfaceMap).toContain(
      "Unknown targets inherit no known-surface assumptions",
    );
    expect(normalizedSurfaceMap).toContain(
      "Use detected capabilities; otherwise classify them as `cleanup-unavailable`",
    );

    expect(cleanupGateBeforeSpawns).toContain(
      "Before every new subagent spawn",
    );
    expect(normalizeWhitespace(cleanupGateBeforeSpawns)).toContain(
      "Capture the role-specific state needed by the owning workflow before closing or superseding any session",
    );
    expect(normalizeWhitespace(cleanupGateBeforeSpawns)).toContain(
      "When the owning workflow still requires same-session follow-up, append `close-deferred`, record its concrete workflow-owned reason, and project `closed=no` without appending attempt or failure events for that decision",
    );
    expect(normalizeWhitespace(cleanupGateBeforeSpawns)).toContain(
      "Never record `closed=yes` unless the current target actually exposed stable ids plus a usable close operation",
    );

    expect(normalizeWhitespace(cleanupProjection)).toContain(
      "Establish the evaluation state, captured role facts, capability tuple, observed events, and any proposed retention reason before projecting cleanup",
    );
    expect(normalizeWhitespace(cleanupProjection)).toContain(
      "`not-evaluated` permits `closed=no` only as an open-session observation and does not project a cleanup decision or any closure event",
    );
    expect(normalizeWhitespace(cleanupProjection)).toContain(
      "The cleanup gate transitions the row to `evaluated`",
    );
    expect(normalizeWhitespace(cleanupProjection)).toContain(
      "Evaluation never returns to `not-evaluated`",
    );
    expect(normalizeWhitespace(cleanupProjection)).toContain(
      "Observed `close-succeeded` is terminal and dominant for that session row",
    );
    expect(normalizeWhitespace(cleanupProjection)).toContain(
      "Later loss of identity, inventory, or operation capability does not change `closed=yes` and must not append `closure-unavailable`",
    );
    expect(normalizeWhitespace(cleanupProjection)).toContain(
      "An evaluated session without stable identity or without an exposed, usable close operation appends `closure-unavailable`",
    );
    expect(normalizeWhitespace(cleanupProjection)).toContain(
      "An exposed-but-unusable close operation follows this unavailable path, not `closed=no`",
    );
    expect(normalizeWhitespace(cleanupProjection)).toContain(
      "appends the reason to unavailable-reason history, and projects `close-unavailable: <reason>` with that same current reason",
    );
    expect(normalizeWhitespace(cleanupProjection)).toContain(
      "An evaluated session deliberately retained for same-session follow-up appends `close-deferred` with its concrete workflow-owned reason as event-associated detail, records that reason as the current retention reason, and projects `closed=no`",
    );
    expect(normalizeWhitespace(cleanupProjection)).toContain(
      "That decision does not append `close-attempted` or `close-failed`; deferral is not a fabricated close attempt",
    );
    expect(normalizeWhitespace(cleanupProjection)).toContain(
      "whose real close attempt fails appends `close-attempted` and `close-failed`, then projects `closed=no`",
    );
    expect(normalizeWhitespace(cleanupProjection)).toContain(
      "whose real close attempt succeeds appends `close-attempted` and `close-succeeded`, then projects `closed=yes`",
    );
    expect(normalizeWhitespace(cleanupProjection)).toContain(
      "After `retention-resolved`, a later real attempt appends to history without erasing `close-deferred`, its associated reason, or the resolution evidence",
    );
    expect(normalizeWhitespace(cleanupProjection)).toContain(
      "The current retention reason no longer applies after that event, but the historical `close-deferred` reason remains recoverable",
    );
    expect(normalizeWhitespace(cleanupProjection)).toContain(
      "a later retention or close attempt clears the current unavailable-cleanup reason while preserving every prior `closure-unavailable` reason in append-only history",
    );
    expect(normalizeWhitespace(cleanupProjection)).toContain(
      "An evaluated deferred session with a valid resolution event keeps evaluation `evaluated`, sets the current cleanup decision to `none`, clears current retention and unavailable reasons, and projects `closed=no`",
    );
    expect(normalizeWhitespace(cleanupProjection)).toContain(
      "An evaluated row with no applicable decision and reason is invalid or ambiguous except for the exact evidenced post-`retention-resolved` projection above",
    );
    expect(normalizeWhitespace(cleanupGateBeforeSpawns)).toContain(
      "When no spawn has reported slot or session exhaustion, the controller may continue after recording a deferred family (`close-deferred` plus `closed=no`), unavailable family (`closure-unavailable` plus `close-unavailable: <reason>`), failed-attempt family (`close-attempted`, `close-failed`, and `closed=no`), or successful-close family",
    );

    expect(normalizeWhitespace(slotLimitRecovery)).toContain(
      "orchestration resource exhaustion",
    );
    expect(normalizeWhitespace(slotLimitRecovery)).toContain(
      "Recovery uses two controller-local ledger levels",
    );
    expect(normalizeWhitespace(slotLimitRecovery)).toContain(
      "Session rows continue to own session identity, operational and reuse state, capture, row events, retention, cleanup evaluation and projection, and close attempt/result history",
    );
    expect(normalizeWhitespace(slotLimitRecovery)).toContain(
      "A controller-level recovery episode record owns the sanitized recovery-origin identity, episode identity, immutable tagged blocker snapshot, ordered episode events, authorization projection, reconstruction, retry dispatch/result, and escalation",
    );
    expect(normalizeWhitespace(slotLimitRecovery)).toContain(
      "Episode facts never live on or fabricate a session row, and episode events never change a row cleanup projection or row history",
    );
    expect(normalizeWhitespace(slotLimitRecovery)).toContain(
      "One recovery origin identifies the failed spawn attempt. At most one episode may exist for that origin; a later unrelated failed spawn uses a distinct origin",
    );
    expect(normalizeWhitespace(slotLimitRecovery)).toContain(
      "A blocker is exactly `ledger-row:<row-id>` or `inventory-only:<inventory-id>`",
    );
    expect(normalizeWhitespace(slotLimitRecovery)).toContain(
      "Inventory evidence attached to a row does not create a second blocker",
    );
    expect(normalizeWhitespace(slotLimitRecovery)).toContain(
      "append the episode event `slot-recovery-started` and project `authorizing`",
    );
    expect(normalizeWhitespace(slotLimitRecovery)).toContain(
      "Pure inventory blockers never enter row eligibility, retention, cleanup, or close logic",
    );
    expect(normalizeWhitespace(slotLimitRecovery)).toContain(
      "A row blocker accepts either an exact current-episode reference to that row's value-bearing `close-succeeded` event by row and stable event identity, or an episode `manual-cleanup-confirmed` event",
    );
    expect(normalizeWhitespace(slotLimitRecovery)).toContain(
      "Require bidirectional membership and tag equality between the observed inventory and proposed snapshot",
    );
    expect(normalizeWhitespace(slotLimitRecovery)).toContain(
      "Treat every accepted snapshot, authorization, and episode event as an immutable controller-owned copy",
    );
    expect(normalizeWhitespace(slotLimitRecovery)).toContain(
      "Before every transition, require the episode record and recovery-origin index to agree bidirectionally and uniquely",
    );
    expect(normalizeWhitespace(slotLimitRecovery)).toContain(
      "An inventory blocker accepts only the episode manual-confirmation event; row close evidence cannot authorize it",
    );
    expect(normalizeWhitespace(slotLimitRecovery)).toContain(
      "Reject duplicate, stale, non-snapshot, cross-kind, incomplete, or inventory-close evidence before mutation",
    );
    expect(normalizeWhitespace(slotLimitRecovery)).toContain(
      "Keep the first accepted evidence unchanged when a later authorization fails",
    );
    expect(normalizeWhitespace(slotLimitRecovery)).toContain(
      "Append `recovery-state-reconstructed` and project `ready`",
    );
    expect(normalizeWhitespace(slotLimitRecovery)).toContain(
      "From `ready`, append exactly one `slot-retry-dispatched`, consume the authorization once, and project `retry-dispatched`",
    );
    expect(normalizeWhitespace(slotLimitRecovery)).toContain(
      "Append exactly one `slot-retry-succeeded` and project terminal `retry-succeeded`, or append `slot-retry-failed`, store only a closed structured escalation",
    );
    expect(normalizeWhitespace(slotLimitRecovery)).toContain(
      "Reject extra fields, free-form text, non-snapshot blockers, malformed identities, and escalation metadata on success",
    );
    expect(normalizeWhitespace(slotLimitRecovery)).toContain(
      "Failure forbids another episode or retry for the same origin; a distinct recovery origin remains eligible for a later unrelated failure",
    );

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
    expect(normalizeWhitespace(decision)).toContain(
      "This ADR owns the durable lifecycle ownership and recovery decision; the source skill owns the reusable controller procedure",
    );
    expect(normalizeWhitespace(decision)).toContain(
      "Examples, tests, and generated target previews are evidence of that contract, not authority",
    );
    for (const ownedSurface of [
      "controller-local lifecycle ledger expectations",
      "target lifecycle capability classes",
      "surface-specific capability mapping",
      "ordered append-only lifecycle-event history",
      "append-only value-bearing cleanup-decision reason histories",
      "append-only value-bearing return-status and reviewer-disposition histories",
      "total usable-control capability classification",
      "independent operational, reuse, capability, and cleanup-state semantics",
      "target-honest cleanup outcomes",
      "cleanup gates before spawns",
      "normal-gate continuation separately from slot-recovery retry authorization",
      "resolved same-session retention as an append-only decision event",
      "provider-neutral timeout and runtime-failure terminal outcomes",
      "classification and safe capture of open capacity-blocking rows",
      "session-row ownership of identity, operational and reuse state",
      "separate controller-level recovery episodes",
      "exact `ledger-row:<row-id>` and `inventory-only:<inventory-id>` authorization",
      "terminal retry success or sanitized failure",
    ]) {
      expect(decision).toContain(ownedSurface);
    }
    expect(decision).toContain(
      "`play-subagent-execution` owns task execution, per-task review routing,\nimplementer snapshot consumption, and same-session implementer fix-loop\nexceptions",
    );
    expect(decision).toContain(
      "Both ledger levels remain controller-local state",
    );
    expect(consequences).toContain(
      "Target capability claims remain target-honest",
    );
    expect(consequences).toContain(
      "Slot-limit failures are handled as orchestration resource exhaustion",
    );
    expect(consequences).toContain("Workflow-local exceptions remain explicit");
    expect(normalizeWhitespace(consequences)).toContain(
      "Evaluated deliberate retention records `close-deferred`, `closed=no`, and a concrete workflow-owned reason without fabricating an attempt or failure",
    );
    expect(normalizeWhitespace(consequences)).toContain(
      "the reason remains event-associated append-only history after the current decision advances",
    );
    expect(retentionResolutionProofErrors(consequences)).toEqual([]);
    expectRetentionResolutionMutations(consequences);
    expect(normalizeWhitespace(consequences)).toContain(
      "Resolution preserves the historical deferral and clears current retention",
    );
    expect(normalizeWhitespace(consequences)).toContain(
      "Its sole current projection is evaluated, decision `none`, no current retention or unavailable reason, and `closed=no`",
    );
    expect(normalizeWhitespace(consequences)).toContain(
      "A capacity-blocking retained session requires the basis and proof above before actual or operator-confirmed cleanup; otherwise stop and escalate",
    );
    expect(normalizeWhitespace(consequences)).toContain(
      "workflow return status and reviewer disposition survive same-session operational re-entry to active or waiting state",
    );
    expect(normalizeWhitespace(consequences)).toContain(
      "Every observed return status and reviewer disposition remains in append-only value-bearing history while a separate latest value serves as the current projection",
    );
    expect(normalizeWhitespace(consequences)).toContain(
      "Runtime `timed-out` and `failed` are operational terminal outcomes with sanitized detail, not task or reviewer verdicts",
    );
    expect(normalizeWhitespace(consequences)).toContain(
      "They add no return status; sessions with prior returned turns preserve their return and disposition histories and projections, while never-returned sessions keep them absent",
    );
    expect(normalizeWhitespace(consequences)).toContain(
      "Every unavailable-cleanup decision preserves its concrete reason in append-only event history",
    );
    expect(normalizeWhitespace(consequences)).toContain(
      "Active, waiting, interrupted, pending, and unknown-identity capacity blockers require state-specific classification before cleanup",
    );
    expect(normalizeWhitespace(consequences)).toContain(
      "Session rows never own recovery origins, episode identities, blocker snapshots, episode authorization, reconstruction, retry, or escalation",
    );
    expect(normalizeWhitespace(consequences)).toContain(
      "Episode authorization and terminal results leave row histories and cleanup projections unchanged",
    );
    expect(normalizeWhitespace(consequences)).toContain(
      "A row's `close-succeeded` remains a row event referenced by exact row/event identity",
    );
    expect(normalizeWhitespace(consequences)).toContain(
      "Reconstruction requires complete authorization; dispatch requires reconstruction and consumes authorization exactly once; a retry result requires dispatch and is terminal",
    );
    expect(normalizeWhitespace(consequences)).toContain(
      "Known-surface mappings are detection-first capability guidance, not frozen provider action schemas; interruption and inventory never imply closure",
    );
    expect(normalizeWhitespace(consequences)).toContain(
      "Once a spawn reports slot exhaustion, retry remains blocked until actual closure or operator-confirmed manual cleanup",
    );
    expect(normalizeWhitespace(consequences)).toContain(
      "Interruption, supersession, completion, reuse, capability, and cleanup remain separate facts",
    );
  });

  it("rejects lifecycle examples that conflate one contract dimension", () => {
    type LifecycleExample = {
      surface: "local-codex" | "responses-api" | "claude-code" | "unknown";
      operationalState:
        | "pending"
        | "active"
        | "waiting"
        | "interrupted"
        | "completed"
        | "timed-out"
        | "failed"
        | "superseded";
      agentId: string;
      capability:
        | "automatic-close-supported"
        | "inventory-only"
        | "cleanup-unavailable";
      cleanup: "closed=yes" | "closed=no" | "close-unavailable";
      reusable: boolean;
      completionEvent: boolean;
      closeOperationExposed: boolean;
      closeSucceeded: boolean;
      interruptionPreservesContext: boolean;
      apiActions: string[];
      inheritedControls: boolean;
      promisedLowLevelCodexClose: boolean;
      events: string[];
      workflowReturnStatus: string | null;
      workflowReturnHistory: string[];
      reviewerDispositionClassified: boolean;
      reviewerDisposition: string | null;
      reviewerDispositionHistory: Array<{
        disposition: string;
        reason: string;
        sourceState: string;
      }>;
      runtimeTerminalDetails: Array<{
        event: "turn-timed-out" | "turn-failed";
        reason: string;
      }>;
      abnormalTerminalStateCaptured: boolean;
      reliableInventory: boolean;
      trackedStableIdentity: boolean;
      closeOperationUsable: boolean;
      closeInvocationObserved: boolean;
      closeAttempted: boolean;
      closeFailed: boolean;
      cleanupEvaluation: "not-evaluated" | "evaluated";
      cleanupDecision: "none" | "retained" | "unavailable" | "attempted";
      retentionReason: string | null;
      deferredEventReasons: string[];
      retentionResolutionDetails: {
        basis: "need-finished" | "captured-and-replaced";
        evidence: string;
      }[];
      closeUnavailableReason: string | null;
      unavailableEventReasons: string[];
    };

    const observedApiActions = [
      "spawn_agent",
      "send_message",
      "followup_task",
      "wait_agent",
      "interrupt_agent",
      "list_agents",
    ];
    const unevaluatedCleanup = {
      cleanup: "closed=no",
      cleanupEvaluation: "not-evaluated",
      cleanupDecision: "none",
      closeUnavailableReason: null,
      unavailableEventReasons: [],
    } satisfies Partial<LifecycleExample>;
    const valid: LifecycleExample = {
      surface: "responses-api",
      operationalState: "completed",
      agentId: "agent-1",
      capability: "inventory-only",
      cleanup: "close-unavailable",
      reusable: true,
      completionEvent: true,
      closeOperationExposed: false,
      closeSucceeded: false,
      interruptionPreservesContext: true,
      apiActions: observedApiActions,
      inheritedControls: false,
      promisedLowLevelCodexClose: false,
      events: [
        "dispatch-requested",
        "identity-assigned",
        "turn-completed",
        "required-state-captured",
        "closure-unavailable",
      ],
      workflowReturnStatus: "DONE",
      workflowReturnHistory: ["DONE"],
      reviewerDispositionClassified: false,
      reviewerDisposition: null,
      reviewerDispositionHistory: [],
      runtimeTerminalDetails: [],
      abnormalTerminalStateCaptured: false,
      reliableInventory: false,
      trackedStableIdentity: true,
      closeOperationUsable: false,
      closeInvocationObserved: false,
      closeAttempted: false,
      closeFailed: false,
      cleanupEvaluation: "evaluated",
      cleanupDecision: "unavailable",
      retentionReason: null,
      deferredEventReasons: [],
      retentionResolutionDetails: [],
      closeUnavailableReason: "inventory-only; no close operation",
      unavailableEventReasons: ["inventory-only; no close operation"],
    };
    const interruptedOpen: LifecycleExample = {
      ...valid,
      ...unevaluatedCleanup,
      operationalState: "interrupted",
      events: ["dispatch-requested", "identity-assigned", "interrupted"],
      workflowReturnStatus: null,
      workflowReturnHistory: [],
      completionEvent: false,
    };
    function invalidDimensions(example: LifecycleExample): string[] {
      const errors: string[] = [];
      if (
        (example.operationalState === "pending") !==
        (example.agentId === "pending")
      ) {
        errors.push("pending-identity");
        return errors;
      }
      if (
        example.surface === "responses-api" &&
        example.apiActions.includes("interrupt_agent") &&
        !example.interruptionPreservesContext
      ) {
        errors.push("responses-api-interruption-semantics");
        return errors;
      }
      if (
        example.operationalState === "interrupted" &&
        example.cleanup === "closed=yes"
      ) {
        errors.push("interruption-is-not-closure");
        return errors;
      }
      if (
        example.capability === "inventory-only" &&
        example.operationalState === "completed" &&
        !example.completionEvent
      ) {
        errors.push("capability-is-not-operation");
        return errors;
      }
      if (
        (example.surface === "claude-code" || example.surface === "unknown") &&
        example.inheritedControls
      ) {
        errors.push("cross-surface-inheritance");
        return errors;
      }
      if (
        example.surface === "local-codex" &&
        example.promisedLowLevelCodexClose
      ) {
        errors.push("codex-low-level-close-promise");
        return errors;
      }
      for (const [earlier, later] of [
        ["dispatch-requested", "identity-assigned"],
        ["identity-assigned", "turn-completed"],
      ] as const) {
        const earlierIndex = example.events.indexOf(earlier);
        const laterIndex = example.events.indexOf(later);
        if (
          earlierIndex >= 0 &&
          laterIndex >= 0 &&
          earlierIndex >= laterIndex
        ) {
          errors.push("event-history");
          return errors;
        }
      }
      if (
        example.events.some((event) =>
          event.startsWith("operational-classified"),
        )
      ) {
        errors.push("unsupported-operational-classification");
        return errors;
      }
      const operationalStateByEvent = new Map<
        string,
        LifecycleExample["operationalState"]
      >([
        ["dispatch-requested", "pending"],
        ["identity-assigned", "active"],
        ["followup-dispatch-requested", "active"],
        ["interrupted-reuse-dispatch-requested", "active"],
        ["waiting", "waiting"],
        ["interrupted", "interrupted"],
        ["turn-completed", "completed"],
        ["turn-timed-out", "timed-out"],
        ["turn-failed", "failed"],
        ["superseded", "superseded"],
      ]);
      const closureEvents = new Set([
        "close-deferred",
        "retention-resolved",
        "closure-unavailable",
        "close-attempted",
        "close-failed",
        "close-succeeded",
      ]);
      const supersededIndex = example.events.lastIndexOf("superseded");
      if (supersededIndex >= 0) {
        const beforeSupersession = example.events.slice(0, supersededIndex);
        const currentOpenIntervalStart = Math.max(
          ...[
            "identity-assigned",
            "followup-dispatch-requested",
            "interrupted-reuse-dispatch-requested",
          ].map((event) => beforeSupersession.lastIndexOf(event)),
        );
        const latestOpenTransitionIndex = Math.max(
          currentOpenIntervalStart,
          ...["waiting", "interrupted"].map((event) =>
            beforeSupersession.lastIndexOf(event),
          ),
        );
        const latestTerminalIndex = Math.max(
          ...["turn-completed", "turn-timed-out", "turn-failed"].map((event) =>
            beforeSupersession.lastIndexOf(event),
          ),
        );
        if (currentOpenIntervalStart > latestTerminalIndex) {
          const captureIndex = example.events.lastIndexOf(
            "required-state-captured",
            supersededIndex - 1,
          );
          if (captureIndex <= latestOpenTransitionIndex) {
            errors.push("supersession-capture-stale");
            return errors;
          }
          const replacementIndex = example.events.lastIndexOf(
            "replacement-secured",
            supersededIndex - 1,
          );
          if (replacementIndex <= captureIndex) {
            errors.push("supersession-replacement-stale");
            return errors;
          }
          if (
            beforeSupersession
              .slice(currentOpenIntervalStart + 1)
              .some((event) => closureEvents.has(event))
          ) {
            errors.push("cleanup-before-supersession");
            return errors;
          }
        }
      }
      let projectedOperationalState:
        | LifecycleExample["operationalState"]
        | undefined;
      for (const event of example.events) {
        projectedOperationalState =
          operationalStateByEvent.get(event) ?? projectedOperationalState;
      }
      if (projectedOperationalState !== example.operationalState) {
        errors.push("operational-state-projection");
        return errors;
      }
      const latestTerminalTransition = Math.max(
        ...[
          "turn-completed",
          "turn-timed-out",
          "turn-failed",
          "superseded",
        ].map((event) => example.events.lastIndexOf(event)),
      );
      const currentOpenIntervalStart = Math.max(
        ...[
          "identity-assigned",
          "followup-dispatch-requested",
          "interrupted-reuse-dispatch-requested",
        ].map((event) => example.events.lastIndexOf(event)),
      );
      if (
        (projectedOperationalState === "active" ||
          projectedOperationalState === "waiting" ||
          projectedOperationalState === "interrupted") &&
        currentOpenIntervalStart > latestTerminalTransition &&
        example.events
          .slice(currentOpenIntervalStart + 1)
          .some((event) => closureEvents.has(event))
      ) {
        errors.push("cleanup-ineligible-operational-state");
        return errors;
      }
      const returnedTurnCount = example.events.filter(
        (event) => event === "turn-completed",
      ).length;
      if (
        example.workflowReturnHistory.length !== returnedTurnCount ||
        example.workflowReturnStatus !==
          (example.workflowReturnHistory.at(-1) ?? null)
      ) {
        errors.push("workflow-result-history");
        return errors;
      }
      for (const [followupIndex, event] of example.events.entries()) {
        if (event !== "followup-dispatch-requested") continue;
        const priorEvents = example.events.slice(0, followupIndex);
        const latestCompleted = priorEvents.lastIndexOf("turn-completed");
        const latestTerminal = Math.max(
          ...[
            "turn-completed",
            "turn-timed-out",
            "turn-failed",
            "superseded",
          ].map((terminal) => priorEvents.lastIndexOf(terminal)),
        );
        const latestOperationalTransition = Math.max(
          ...[
            "identity-assigned",
            "followup-dispatch-requested",
            "interrupted-reuse-dispatch-requested",
            "waiting",
            "interrupted",
            "turn-completed",
            "turn-timed-out",
            "turn-failed",
            "superseded",
          ].map((transition) => priorEvents.lastIndexOf(transition)),
        );
        if (
          latestCompleted < 0 ||
          latestTerminal !== latestCompleted ||
          latestOperationalTransition !== latestCompleted ||
          !example.reusable ||
          !example.trackedStableIdentity ||
          example.agentId === "pending" ||
          !/^[A-Za-z0-9._-]+$/.test(example.agentId)
        ) {
          errors.push("completed-followup-ineligible");
          return errors;
        }
        const latestCaptureInvalidatingMutation = Math.max(
          latestTerminal,
          ...[
            "identity-assigned",
            "followup-dispatch-requested",
            "interrupted-reuse-dispatch-requested",
            "waiting",
            "interrupted",
          ].map((mutation) => priorEvents.lastIndexOf(mutation)),
        );
        if (
          priorEvents.lastIndexOf("required-state-captured") <=
          latestCaptureInvalidatingMutation
        ) {
          errors.push("completed-followup-capture-stale");
          return errors;
        }
      }
      const completedIndexes = example.events.flatMap((event, index) =>
        event === "turn-completed" ? [index] : [],
      );
      for (const [turnIndex, completedIndex] of completedIndexes.entries()) {
        const intervalEnd =
          completedIndexes[turnIndex + 1] ?? example.events.length;
        const normalCaptureIndex = example.events.findIndex(
          (event, index) =>
            index > completedIndex &&
            index < intervalEnd &&
            event === "required-state-captured",
        );
        const normalCleanupIndex = example.events.findIndex(
          (event, index) =>
            index > completedIndex &&
            index < intervalEnd &&
            (event === "superseded" || closureEvents.has(event)),
        );
        if (
          normalCaptureIndex <= completedIndex ||
          (normalCleanupIndex >= 0 && normalCleanupIndex <= normalCaptureIndex)
        ) {
          errors.push("normal-terminal-capture");
          return errors;
        }
      }
      const runtimeTerminalEvents = example.events.filter(
        (event): event is "turn-timed-out" | "turn-failed" =>
          event === "turn-timed-out" || event === "turn-failed",
      );
      if (
        runtimeTerminalEvents.length !==
          example.runtimeTerminalDetails.length ||
        runtimeTerminalEvents.some(
          (event, index) =>
            example.runtimeTerminalDetails[index]?.event !== event ||
            example.runtimeTerminalDetails[index]?.reason.trim().length === 0,
        )
      ) {
        errors.push("runtime-terminal-history");
        return errors;
      }
      const terminalIndex = Math.max(
        example.events.lastIndexOf("turn-timed-out"),
        example.events.lastIndexOf("turn-failed"),
      );
      const abnormalSupersededIndex = example.events.lastIndexOf("superseded");
      const abnormalOrder = [
        terminalIndex,
        example.events.lastIndexOf("required-state-captured"),
        example.events.lastIndexOf("abnormal-context-captured"),
        ...(abnormalSupersededIndex > terminalIndex
          ? [abnormalSupersededIndex]
          : []),
        example.events.findIndex(
          (event, index) => index > terminalIndex && closureEvents.has(event),
        ),
      ];
      if (
        runtimeTerminalEvents.length > 0 &&
        example.cleanupEvaluation === "evaluated" &&
        (!example.abnormalTerminalStateCaptured ||
          abnormalOrder.some(
            (order, index) => index > 0 && order <= abnormalOrder[index - 1],
          ))
      ) {
        errors.push("abnormal-terminal-capture");
        return errors;
      }
      if (
        example.reviewerDispositionClassified !==
        (example.reviewerDisposition !== null)
      ) {
        errors.push("reviewer-disposition");
        return errors;
      }
      if (
        example.events.filter(
          (event) => event === "reviewer-disposition-classified",
        ).length !== example.reviewerDispositionHistory.length ||
        example.reviewerDisposition !==
          (example.reviewerDispositionHistory.at(-1)?.disposition ?? null) ||
        example.reviewerDispositionHistory.some(
          ({ reason, sourceState }) =>
            reason.trim().length === 0 || sourceState.trim().length === 0,
        )
      ) {
        errors.push("reviewer-disposition-history");
        return errors;
      }
      const expectedCapability =
        example.trackedStableIdentity &&
        example.closeOperationExposed &&
        example.closeOperationUsable
          ? "automatic-close-supported"
          : example.reliableInventory || example.trackedStableIdentity
            ? "inventory-only"
            : "cleanup-unavailable";
      if (
        !example.closeSucceeded &&
        example.capability !== expectedCapability
      ) {
        errors.push("capability-classification");
        return errors;
      }
      if (
        example.cleanupEvaluation === "not-evaluated" &&
        (example.cleanup !== "closed=no" ||
          example.cleanupDecision !== "none" ||
          example.retentionReason !== null ||
          example.deferredEventReasons.length > 0 ||
          example.retentionResolutionDetails.length > 0 ||
          example.closeUnavailableReason !== null ||
          example.unavailableEventReasons.length > 0 ||
          example.events.some((event) => closureEvents.has(event)))
      ) {
        errors.push("cleanup-evaluation-state");
        return errors;
      }
      const firstCloseSucceededIndex =
        example.events.indexOf("close-succeeded");
      const laterClosureControlIndex = example.events.findIndex(
        (event, index) =>
          index > firstCloseSucceededIndex && closureEvents.has(event),
      );
      if (firstCloseSucceededIndex >= 0 && laterClosureControlIndex >= 0) {
        errors.push("terminal-close-contradiction");
        return errors;
      }
      if (example.cleanupEvaluation === "evaluated") {
        const deferredCount = example.events.filter(
          (event) => event === "close-deferred",
        ).length;
        if (
          example.deferredEventReasons.length !== deferredCount ||
          example.deferredEventReasons.some(
            (reason) => reason.trim().length === 0,
          )
        ) {
          errors.push("deferred-reason-history");
          return errors;
        }
        const retentionResolvedCount = example.events.filter(
          (event) => event === "retention-resolved",
        ).length;
        if (
          example.retentionResolutionDetails.length !==
            retentionResolvedCount ||
          example.retentionResolutionDetails.some(
            (detail) => detail.evidence.trim().length === 0,
          )
        ) {
          errors.push("retention-resolution-history");
          return errors;
        }
        let unresolvedDeferral = false;
        let latestDeferralIndex = -1;
        let resolutionDetailIndex = 0;
        for (const [eventIndex, event] of example.events.entries()) {
          if (event === "close-deferred") {
            unresolvedDeferral = true;
            latestDeferralIndex = eventIndex;
          } else if (event === "retention-resolved") {
            if (!unresolvedDeferral) {
              errors.push("retention-resolution-without-deferral");
              return errors;
            }
            const detail =
              example.retentionResolutionDetails[resolutionDetailIndex];
            resolutionDetailIndex += 1;
            if (detail?.basis === "captured-and-replaced") {
              const captureIndex = example.events.lastIndexOf(
                "required-state-captured",
                eventIndex - 1,
              );
              const replacementIndex = example.events.lastIndexOf(
                "replacement-secured",
                eventIndex - 1,
              );
              if (
                captureIndex <= latestDeferralIndex ||
                replacementIndex <= captureIndex
              ) {
                errors.push("retention-resolution-proof");
                return errors;
              }
            }
            unresolvedDeferral = false;
          } else if (
            unresolvedDeferral &&
            (event === "close-attempted" || event === "closure-unavailable")
          ) {
            errors.push("retention-resolution-missing");
            return errors;
          }
        }
        const unavailableCount = example.events.filter(
          (event) => event === "closure-unavailable",
        ).length;
        if (
          example.unavailableEventReasons.length !== unavailableCount ||
          example.unavailableEventReasons.some(
            (reason) => reason.trim().length === 0,
          )
        ) {
          errors.push("unavailable-reason-history");
          return errors;
        }
      }
      if (example.cleanupEvaluation === "evaluated") {
        let unmatchedAttempt = false;
        for (const event of example.events) {
          if (event === "close-attempted") {
            if (unmatchedAttempt) {
              errors.push("close-attempt-result-pairing");
              return errors;
            }
            unmatchedAttempt = true;
          } else if (event === "close-failed" || event === "close-succeeded") {
            if (!unmatchedAttempt) {
              errors.push("close-attempt-result-pairing");
              return errors;
            }
            unmatchedAttempt = false;
          } else if (
            unmatchedAttempt &&
            (event === "close-deferred" || event === "closure-unavailable")
          ) {
            errors.push("close-attempt-result-pairing");
            return errors;
          }
        }
        if (unmatchedAttempt) {
          errors.push("cleanup-result-missing");
          return errors;
        }
      }
      if (
        example.cleanupEvaluation === "evaluated" &&
        (example.closeAttempted !==
          example.events.includes("close-attempted") ||
          example.closeFailed !== example.events.includes("close-failed") ||
          example.closeSucceeded !== example.events.includes("close-succeeded"))
      ) {
        errors.push("cleanup-event-history");
        return errors;
      }
      if (
        example.cleanupEvaluation === "evaluated" &&
        example.closeAttempted &&
        !example.closeInvocationObserved
      ) {
        errors.push("fabricated-close-attempt");
        return errors;
      }
      if (example.cleanupEvaluation === "evaluated") {
        const lastDeferred = example.events.lastIndexOf("close-deferred");
        const lastUnavailable = example.events.lastIndexOf(
          "closure-unavailable",
        );
        const lastAttempt = example.events.lastIndexOf("close-attempted");
        const lastRetentionResolved =
          example.events.lastIndexOf("retention-resolved");
        const latestDecisionIndex = Math.max(
          lastDeferred,
          lastUnavailable,
          lastAttempt,
        );
        if (latestDecisionIndex < 0) {
          errors.push("cleanup-decision");
          return errors;
        }

        const expectedDecision =
          lastRetentionResolved > latestDecisionIndex
            ? "none"
            : latestDecisionIndex === lastAttempt
              ? "attempted"
              : latestDecisionIndex === lastDeferred
                ? "retained"
                : "unavailable";
        if (example.cleanupDecision !== expectedDecision) {
          errors.push("cleanup-decision");
          return errors;
        }

        if (expectedDecision === "none") {
          if (
            example.retentionReason !== null ||
            example.closeUnavailableReason !== null
          ) {
            errors.push("retention-resolution-projection");
            return errors;
          }
          if (example.cleanup !== "closed=no") {
            errors.push("cleanup-projection");
            return errors;
          }
        } else if (expectedDecision === "retained") {
          if (
            example.retentionReason === null ||
            example.retentionReason.trim().length === 0
          ) {
            errors.push("retention-reason");
            return errors;
          }
          if (example.retentionReason !== example.deferredEventReasons.at(-1)) {
            errors.push("retention-reason-projection");
            return errors;
          }
          if (example.closeUnavailableReason !== null) {
            errors.push("stale-cleanup-fields");
            return errors;
          }
          if (example.cleanup !== "closed=no") {
            errors.push("cleanup-projection");
            return errors;
          }
        } else if (expectedDecision === "unavailable") {
          if (example.retentionReason !== null) {
            errors.push("stale-cleanup-fields");
            return errors;
          }
          if (
            example.closeUnavailableReason === null ||
            example.closeUnavailableReason.trim().length === 0
          ) {
            errors.push("close-unavailable-reason");
            return errors;
          }
          if (
            example.closeUnavailableReason !==
            example.unavailableEventReasons.at(-1)
          ) {
            errors.push("close-unavailable-reason-projection");
            return errors;
          }
          if (
            example.trackedStableIdentity &&
            example.closeOperationExposed &&
            example.closeOperationUsable
          ) {
            errors.push("cleanup-decision");
            return errors;
          }
          if (example.cleanup !== "close-unavailable") {
            errors.push("cleanup-projection");
            return errors;
          }
        } else {
          if (
            example.retentionReason !== null ||
            example.closeUnavailableReason !== null
          ) {
            errors.push("stale-cleanup-fields");
            return errors;
          }
          const lastFailed = example.events.lastIndexOf("close-failed");
          const lastSucceeded = example.events.lastIndexOf("close-succeeded");
          const latestResultIndex = Math.max(lastFailed, lastSucceeded);
          if (latestResultIndex <= lastAttempt) {
            errors.push("cleanup-result-missing");
            return errors;
          }
          const expectedCleanup =
            latestResultIndex === lastSucceeded ? "closed=yes" : "closed=no";
          if (example.cleanup !== expectedCleanup) {
            errors.push("cleanup-projection");
            return errors;
          }
        }
      }
      if (
        example.closeFailed &&
        (!example.closeAttempted || !example.events.includes("close-failed"))
      ) {
        errors.push("close-failure-history");
        return errors;
      }
      if (
        example.operationalState === "completed" &&
        !example.completionEvent
      ) {
        errors.push("completion-event");
        return errors;
      }
      if (
        example.cleanup === "closed=yes" &&
        (example.agentId === "pending" || !example.closeSucceeded)
      ) {
        errors.push("closure-proof");
      }
      return errors;
    }

    expect(invalidDimensions(valid)).toEqual([]);
    const normalEventText = valid.events.join("|");
    for (const [from, to] of [
      ["required-state-captured|", ""],
      [
        "turn-completed|required-state-captured",
        "required-state-captured|turn-completed",
      ],
      [
        "required-state-captured|closure-unavailable",
        "closure-unavailable|required-state-captured",
      ],
    ]) {
      expect(
        invalidDimensions({
          ...valid,
          events: normalEventText.replace(from, to).split("|"),
        }),
      ).toEqual(["normal-terminal-capture"]);
    }
    expect(
      invalidDimensions({
        ...interruptedOpen,
        events: [...interruptedOpen.events, "closure-unavailable"],
      }),
    ).toEqual(["cleanup-ineligible-operational-state"]);
    expect(
      invalidDimensions({
        ...valid,
        events: [...valid.events, "operational-classified(active)"],
      }),
    ).toEqual(["unsupported-operational-classification"]);
    expect(
      invalidDimensions({ ...valid, unavailableEventReasons: [] }),
    ).toEqual(["unavailable-reason-history"]);
    expect(
      invalidDimensions({
        ...valid,
        closeUnavailableReason: "different current unavailable reason",
      }),
    ).toEqual(["close-unavailable-reason-projection"]);
    expect(
      invalidDimensions({
        ...valid,
        retentionReason: "stale retention reason",
      }),
    ).toEqual(["stale-cleanup-fields"]);

    const supersessionEvents = (...events: string[]): string[] => [
      "dispatch-requested",
      "identity-assigned",
      ...events,
      "closure-unavailable",
    ];
    const abnormalEvents = (
      terminal: "turn-timed-out" | "turn-failed",
      supersede = false,
    ): string[] => [
      "dispatch-requested",
      "identity-assigned",
      terminal,
      "required-state-captured",
      "abnormal-context-captured",
      ...(supersede ? ["superseded"] : []),
      "closure-unavailable",
    ];
    const superseded: LifecycleExample = {
      ...valid,
      operationalState: "superseded",
      reusable: false,
      capability: "cleanup-unavailable",
      events: supersessionEvents(
        "interrupted",
        "required-state-captured",
        "replacement-secured",
        "superseded",
      ),
      trackedStableIdentity: false,
      workflowReturnStatus: null,
      workflowReturnHistory: [],
      completionEvent: false,
    };

    const invalidFamilies: Array<[string, string, LifecycleExample]> = [
      [
        "interrupted becomes closed",
        "interruption-is-not-closure",
        { ...interruptedOpen, cleanup: "closed=yes" },
      ],
      [
        "Responses API interruption is treated as destructive closure",
        "responses-api-interruption-semantics",
        { ...interruptedOpen, interruptionPreservesContext: false },
      ],
      [
        "Local Codex promises a low-level close action",
        "codex-low-level-close-promise",
        {
          ...valid,
          surface: "local-codex",
          apiActions: [],
          promisedLowLevelCodexClose: true,
        },
      ],
      [
        "Claude Code inherits another provider's controls",
        "cross-surface-inheritance",
        {
          ...valid,
          surface: "claude-code",
          apiActions: [],
          inheritedControls: true,
        },
      ],
      [
        "an unknown target inherits another provider's controls",
        "cross-surface-inheritance",
        {
          ...valid,
          surface: "unknown",
          apiActions: [],
          inheritedControls: true,
        },
      ],
      [
        "inventory-only becomes operational completion",
        "capability-is-not-operation",
        {
          ...valid,
          operationalState: "completed",
          completionEvent: false,
        },
      ],
      [
        "a pending row fabricates a stable id",
        "pending-identity",
        { ...valid, operationalState: "pending", agentId: "fabricated-1" },
      ],
      [
        "a pending row omits its pending identity",
        "pending-identity",
        { ...valid, operationalState: "pending", agentId: "" },
      ],
      [
        "a superseded row becomes completed without a completion event",
        "operational-state-projection",
        {
          ...superseded,
          operationalState: "completed",
        },
      ],
    ];

    for (const [name, expectedError, example] of invalidFamilies) {
      expect(invalidDimensions(example), name).toEqual([expectedError]);
    }
    expect(
      invalidDimensions({
        ...valid,
        apiActions: [...observedApiActions, "newly_exposed_close_action"],
      }),
      "a newly exposed action name does not change capability by itself",
    ).toEqual([]);
    expect(
      invalidDimensions({
        ...valid,
        apiActions: [...observedApiActions, "newly_exposed_close_action"],
        closeOperationExposed: true,
        closeOperationUsable: true,
      }),
      "an action name does not replace detected capability classification",
    ).toEqual(["capability-classification"]);

    const pending: LifecycleExample = {
      ...valid,
      ...unevaluatedCleanup,
      operationalState: "pending",
      agentId: "pending",
      reusable: false,
      events: ["dispatch-requested"],
      capability: "cleanup-unavailable",
      trackedStableIdentity: false,
      completionEvent: false,
      workflowReturnStatus: null,
      workflowReturnHistory: [],
    };
    expect(invalidDimensions(pending)).toEqual([]);
    expect(invalidDimensions(superseded)).toEqual([]);
    const supersededEventText = superseded.events.join("|");
    for (const [from, to, expectedError] of [
      ["required-state-captured|", "", "supersession-capture-stale"],
      [
        "interrupted|required-state-captured",
        "required-state-captured|interrupted",
        "supersession-capture-stale",
      ],
      ["replacement-secured|", "", "supersession-replacement-stale"],
      [
        "required-state-captured|replacement-secured",
        "replacement-secured|required-state-captured",
        "supersession-replacement-stale",
      ],
      [
        "required-state-captured|replacement-secured",
        "required-state-captured|interrupted-reuse-dispatch-requested|replacement-secured",
        "supersession-capture-stale",
      ],
      [
        "superseded|closure-unavailable",
        "closure-unavailable|superseded",
        "cleanup-before-supersession",
      ],
    ] as const) {
      const events = supersededEventText.replace(from, to).split("|");
      expect(
        invalidDimensions({ ...superseded, events }),
        expectedError,
      ).toEqual([expectedError]);
    }
    const priorCleanupFollowup: LifecycleExample = {
      ...superseded,
      events: supersessionEvents(
        "turn-completed",
        "required-state-captured",
        "closure-unavailable",
        "followup-dispatch-requested",
        "required-state-captured",
        "replacement-secured",
        "superseded",
      ),
      workflowReturnStatus: "DONE",
      workflowReturnHistory: ["DONE"],
      completionEvent: true,
      reusable: true,
      trackedStableIdentity: true,
      capability: "inventory-only",
      unavailableEventReasons: Array(2).fill(
        "inventory-only; no close operation",
      ),
    };
    expect(invalidDimensions(priorCleanupFollowup)).toEqual([]);

    const timedOut: LifecycleExample = {
      ...valid,
      operationalState: "timed-out",
      reusable: false,
      events: abnormalEvents("turn-timed-out"),
      workflowReturnStatus: null,
      workflowReturnHistory: [],
      completionEvent: false,
      runtimeTerminalDetails: [
        {
          event: "turn-timed-out",
          reason: "runtime deadline elapsed before a return was observed",
        },
      ],
      abnormalTerminalStateCaptured: true,
    };
    expect(invalidDimensions(timedOut)).toEqual([]);
    expect(timedOut.workflowReturnStatus).toBeNull();
    expect(timedOut.workflowReturnHistory).toEqual([]);
    const runtimeFailed: LifecycleExample = {
      ...timedOut,
      operationalState: "failed",
      events: timedOut.events.map((event) =>
        event === "turn-timed-out" ? "turn-failed" : event,
      ),
      runtimeTerminalDetails: [
        {
          event: "turn-failed",
          reason: "session transport ended before a return was observed",
        },
      ],
    };
    expect(invalidDimensions(runtimeFailed)).toEqual([]);
    for (const abnormal of [timedOut, runtimeFailed]) {
      const terminal = abnormal.runtimeTerminalDetails[0]?.event ?? "";
      const eventText = abnormal.events.join("|");
      for (const [from, to] of [
        ["required-state-captured|", ""],
        [
          `${terminal}|required-state-captured`,
          `required-state-captured|${terminal}`,
        ],
        [
          "required-state-captured|abnormal-context-captured",
          "abnormal-context-captured|required-state-captured",
        ],
        [
          "abnormal-context-captured|closure-unavailable",
          "closure-unavailable|abnormal-context-captured",
        ],
      ]) {
        expect(
          invalidDimensions({
            ...abnormal,
            events: eventText.replace(from, to).split("|"),
          }),
        ).toEqual(["abnormal-terminal-capture"]);
      }
    }
    expect(
      invalidDimensions({
        ...timedOut,
        abnormalTerminalStateCaptured: false,
      }),
    ).toEqual(["abnormal-terminal-capture"]);
    expect(
      invalidDimensions({ ...runtimeFailed, runtimeTerminalDetails: [] }),
    ).toEqual(["runtime-terminal-history"]);
    const timedOutThenSuperseded: LifecycleExample = {
      ...timedOut,
      operationalState: "superseded",
      events: abnormalEvents("turn-timed-out", true),
    };
    expect(invalidDimensions(timedOutThenSuperseded)).toEqual([]);
    expect(
      invalidDimensions({
        ...timedOutThenSuperseded,
        abnormalTerminalStateCaptured: false,
      }),
    ).toEqual(["abnormal-terminal-capture"]);
    const failedThenSuperseded: LifecycleExample = {
      ...runtimeFailed,
      operationalState: "superseded",
      events: abnormalEvents("turn-failed", true),
    };
    expect(invalidDimensions(failedThenSuperseded)).toEqual([]);
    expect(
      invalidDimensions({
        ...failedThenSuperseded,
        abnormalTerminalStateCaptured: false,
      }),
    ).toEqual(["abnormal-terminal-capture"]);

    expect(
      invalidDimensions({
        ...interruptedOpen,
        events: interruptedOpen.events.filter(
          (event) => event !== "interrupted",
        ),
      }),
    ).toEqual(["operational-state-projection"]);
    expect(invalidDimensions({ ...valid, operationalState: "active" })).toEqual(
      ["operational-state-projection"],
    );
    expect(
      invalidDimensions({ ...valid, events: interruptedOpen.events }),
    ).toEqual(["operational-state-projection"]);
    const reopen = (example: LifecycleExample): LifecycleExample => ({
      ...example,
      operationalState: "active",
      events: [...example.events, "followup-dispatch-requested"],
    });
    const followupActive = reopen(valid);
    expect(invalidDimensions(followupActive)).toEqual([]);
    expect(followupActive).toMatchObject({
      cleanupEvaluation: "evaluated",
      cleanupDecision: "unavailable",
      closeUnavailableReason: "inventory-only; no close operation",
      unavailableEventReasons: ["inventory-only; no close operation"],
    });
    expect(
      invalidDimensions({
        ...followupActive,
        completionEvent: false,
        events: followupActive.events.map((event) =>
          event === "turn-completed" ? "interrupted" : event,
        ),
        workflowReturnStatus: null,
        workflowReturnHistory: [],
      }),
    ).toEqual(["completed-followup-ineligible"]);
    for (const latestTerminal of ["turn-timed-out", "turn-failed"] as const) {
      expect(
        invalidDimensions({
          ...followupActive,
          completionEvent: false,
          events: followupActive.events.flatMap((event) =>
            event === "turn-completed"
              ? [latestTerminal]
              : event === "required-state-captured"
                ? [event, "abnormal-context-captured"]
                : [event],
          ),
          workflowReturnStatus: null,
          workflowReturnHistory: [],
          runtimeTerminalDetails: [
            { event: latestTerminal, reason: "turn did not return" },
          ],
          abnormalTerminalStateCaptured: true,
        }),
      ).toEqual(["completed-followup-ineligible"]);
    }
    expect(invalidDimensions({ ...followupActive, reusable: false })).toEqual([
      "completed-followup-ineligible",
    ]);
    expect(
      invalidDimensions({ ...followupActive, trackedStableIdentity: false }),
    ).toEqual(["completed-followup-ineligible"]);
    expect(
      invalidDimensions({ ...followupActive, agentId: "unstable identity" }),
    ).toEqual(["completed-followup-ineligible"]);
    expect(
      invalidDimensions({
        ...followupActive,
        events: [
          ...followupActive.events,
          "required-state-captured",
          "followup-dispatch-requested",
        ],
      }),
    ).toEqual(["completed-followup-ineligible"]);
    expect(
      invalidDimensions({ ...followupActive, workflowReturnStatus: null }),
    ).toEqual(["workflow-result-history"]);
    const returnedReviewer: LifecycleExample = {
      ...valid,
      reviewerDispositionClassified: true,
      reviewerDisposition: "advisory",
      reviewerDispositionHistory: [
        {
          disposition: "advisory",
          reason: "findings are useful but not final",
          sourceState: "reviewed task-head-1",
        },
      ],
      events: [...valid.events, "reviewer-disposition-classified"],
    };
    const followupReviewerActive = reopen(returnedReviewer);
    expect(invalidDimensions(followupReviewerActive)).toEqual([]);
    const followupReviewerWaiting: LifecycleExample = {
      ...followupReviewerActive,
      operationalState: "waiting",
      events: [...followupReviewerActive.events, "waiting"],
    };
    expect(invalidDimensions(followupReviewerWaiting)).toEqual([]);
    const returnedFollowupTimedOut: LifecycleExample = {
      ...followupReviewerActive,
      operationalState: "timed-out",
      events: [
        ...followupReviewerActive.events,
        "turn-timed-out",
        "required-state-captured",
        "abnormal-context-captured",
        "closure-unavailable",
      ],
      unavailableEventReasons: [
        ...followupReviewerActive.unavailableEventReasons,
        "inventory-only; no close operation",
      ],
      runtimeTerminalDetails: [
        {
          event: "turn-timed-out",
          reason: "follow-up runtime deadline elapsed before another return",
        },
      ],
      abnormalTerminalStateCaptured: true,
    };
    expect(invalidDimensions(returnedFollowupTimedOut)).toEqual([]);
    expect(returnedFollowupTimedOut.workflowReturnHistory).toEqual(["DONE"]);
    expect(returnedFollowupTimedOut.reviewerDispositionHistory).toEqual(
      returnedReviewer.reviewerDispositionHistory,
    );
    expect(
      invalidDimensions({
        ...returnedFollowupTimedOut,
        workflowReturnStatus: null,
        workflowReturnHistory: [],
      }),
    ).toEqual(["workflow-result-history"]);
    const returnedFollowupFailed: LifecycleExample = {
      ...returnedFollowupTimedOut,
      operationalState: "failed",
      events: returnedFollowupTimedOut.events.map((event) =>
        event === "turn-timed-out" ? "turn-failed" : event,
      ),
      runtimeTerminalDetails: [
        {
          event: "turn-failed",
          reason: "follow-up session transport ended before another return",
        },
      ],
    };
    expect(invalidDimensions(returnedFollowupFailed)).toEqual([]);
    expect(
      invalidDimensions({
        ...returnedFollowupFailed,
        reviewerDispositionClassified: false,
        reviewerDisposition: null,
        reviewerDispositionHistory: [],
      }),
    ).toEqual(["reviewer-disposition-history"]);
    expect(
      invalidDimensions({
        ...followupReviewerActive,
        reviewerDispositionClassified: false,
        reviewerDisposition: null,
      }),
    ).toEqual(["reviewer-disposition-history"]);
    const secondReturnedTurn: LifecycleExample = {
      ...followupActive,
      operationalState: "completed",
      workflowReturnStatus: "DONE_WITH_CONCERNS",
      workflowReturnHistory: ["DONE", "DONE_WITH_CONCERNS"],
      events: [
        ...followupActive.events,
        "turn-completed",
        "required-state-captured",
      ],
    };
    expect(invalidDimensions(secondReturnedTurn)).toEqual([]);
    expect(
      invalidDimensions({
        ...secondReturnedTurn,
        events: secondReturnedTurn.events.filter(
          (event, index) =>
            event !== "required-state-captured" ||
            index !== secondReturnedTurn.events.indexOf(event),
        ),
      }),
    ).toEqual(["completed-followup-capture-stale"]);
    expect(
      invalidDimensions({
        ...secondReturnedTurn,
        workflowReturnHistory: ["DONE_WITH_CONCERNS"],
      }),
    ).toEqual(["workflow-result-history"]);
    const staleReviewer: LifecycleExample = {
      ...followupReviewerWaiting,
      reviewerDisposition: "stale",
      reviewerDispositionHistory: [
        ...followupReviewerWaiting.reviewerDispositionHistory,
        {
          disposition: "stale",
          reason: "a newer task head replaced the reviewed source",
          sourceState: "task-head-2",
        },
      ],
      events: [
        ...followupReviewerWaiting.events,
        "reviewer-disposition-classified",
      ],
    };
    expect(invalidDimensions(staleReviewer)).toEqual([]);
    expect(
      invalidDimensions({
        ...staleReviewer,
        reviewerDispositionHistory:
          staleReviewer.reviewerDispositionHistory.slice(1),
      }),
    ).toEqual(["reviewer-disposition-history"]);
    const followupWaiting: LifecycleExample = {
      ...followupActive,
      operationalState: "waiting",
      events: [...followupActive.events, "waiting"],
    };
    expect(invalidDimensions(followupWaiting)).toEqual([]);
    expect(followupWaiting.cleanupDecision).toBe("unavailable");
    for (const openRow of [followupActive, followupWaiting]) {
      expect(
        invalidDimensions({
          ...openRow,
          events: [...openRow.events, "closure-unavailable"],
        }),
      ).toEqual(["cleanup-ineligible-operational-state"]);
    }
    const reevaluatedAfterCapabilityChange: LifecycleExample = {
      ...valid,
      capability: "automatic-close-supported",
      cleanup: "closed=yes",
      closeOperationExposed: true,
      closeOperationUsable: true,
      closeInvocationObserved: true,
      closeAttempted: true,
      closeSucceeded: true,
      events: [...valid.events, "close-attempted", "close-succeeded"],
      cleanupEvaluation: "evaluated",
      cleanupDecision: "attempted",
      closeUnavailableReason: null,
    };
    expect(invalidDimensions(reevaluatedAfterCapabilityChange)).toEqual([]);
    expect(reevaluatedAfterCapabilityChange.closeUnavailableReason).toBeNull();
    expect(reevaluatedAfterCapabilityChange.unavailableEventReasons).toEqual([
      "inventory-only; no close operation",
    ]);
    expect(
      invalidDimensions({
        ...reevaluatedAfterCapabilityChange,
        unavailableEventReasons: [],
      }),
    ).toEqual(["unavailable-reason-history"]);
    expect(
      invalidDimensions({
        ...reevaluatedAfterCapabilityChange,
        closeUnavailableReason: "inventory-only; no close operation",
      }),
    ).toEqual(["stale-cleanup-fields"]);
    const capabilityLossAfterSuccess: LifecycleExample = {
      ...reevaluatedAfterCapabilityChange,
      trackedStableIdentity: false,
      reliableInventory: false,
      closeOperationExposed: false,
      closeOperationUsable: false,
    };
    expect(invalidDimensions(capabilityLossAfterSuccess)).toEqual([]);
    expect(
      invalidDimensions({
        ...capabilityLossAfterSuccess,
        events: [
          ...capabilityLossAfterSuccess.events,
          "capability-loss-observed",
        ],
      }),
    ).toEqual([]);
    expect(
      invalidDimensions({
        ...capabilityLossAfterSuccess,
        cleanup: "close-unavailable",
      }),
    ).toEqual(["cleanup-projection"]);
    expect(
      invalidDimensions({
        ...capabilityLossAfterSuccess,
        events: [...capabilityLossAfterSuccess.events, "closure-unavailable"],
      }),
    ).toEqual(["terminal-close-contradiction"]);
    for (const laterClosureEvent of [
      "close-attempted",
      "close-failed",
      "close-succeeded",
    ]) {
      expect(
        invalidDimensions({
          ...capabilityLossAfterSuccess,
          events: [...capabilityLossAfterSuccess.events, laterClosureEvent],
        }),
        `later ${laterClosureEvent}`,
      ).toEqual(["terminal-close-contradiction"]);
    }
    expect(
      invalidDimensions({
        ...reevaluatedAfterCapabilityChange,
        cleanupEvaluation: "not-evaluated",
      }),
    ).toEqual(["cleanup-evaluation-state"]);
    expect(
      invalidDimensions({
        ...interruptedOpen,
        events: [...interruptedOpen.events, "turn-completed"],
        workflowReturnStatus: "DONE",
        workflowReturnHistory: ["DONE"],
        completionEvent: true,
      }),
    ).toEqual(["operational-state-projection"]);
    for (const [events, staleState] of [
      [["dispatch-requested"], "active"],
      [["dispatch-requested", "identity-assigned"], "pending"],
      [["dispatch-requested", "identity-assigned", "waiting"], "active"],
      [
        [
          "dispatch-requested",
          "identity-assigned",
          "required-state-captured",
          "replacement-secured",
          "superseded",
        ],
        "active",
      ],
    ] as const) {
      expect(
        invalidDimensions({
          ...pending,
          agentId: staleState === "pending" ? "pending" : "agent-1",
          events: [...events],
          operationalState: staleState,
        }),
      ).toContain("operational-state-projection");
    }
    expect(invalidDimensions({ ...valid, workflowReturnStatus: null })).toEqual(
      ["workflow-result-history"],
    );
    expect(
      invalidDimensions({
        ...valid,
        reviewerDispositionClassified: true,
        reviewerDisposition: null,
      }),
    ).toEqual(["reviewer-disposition"]);

    const inventoryBacked: LifecycleExample = {
      ...valid,
      agentId: "untracked",
      reliableInventory: true,
      trackedStableIdentity: false,
    };
    expect(invalidDimensions(inventoryBacked)).toEqual([]);
    expect(
      invalidDimensions({
        ...valid,
        agentId: "untracked",
        capability: "cleanup-unavailable",
        reliableInventory: false,
        trackedStableIdentity: false,
        closeOperationExposed: true,
        closeOperationUsable: false,
      }),
    ).toEqual([]);
    expect(
      invalidDimensions({
        ...valid,
        closeOperationExposed: true,
        closeOperationUsable: false,
        cleanup: "closed=no",
      }),
    ).toEqual(["cleanup-projection"]);

    const failedClose: LifecycleExample = {
      ...valid,
      capability: "automatic-close-supported",
      cleanup: "closed=no",
      closeOperationExposed: true,
      closeOperationUsable: true,
      closeInvocationObserved: true,
      closeAttempted: true,
      closeFailed: true,
      cleanupDecision: "attempted",
      closeUnavailableReason: null,
      unavailableEventReasons: [],
      events: [
        ...valid.events.filter((event) => event !== "closure-unavailable"),
        "close-attempted",
        "close-failed",
      ],
    };
    expect(invalidDimensions(failedClose)).toEqual([]);
    expect(
      invalidDimensions({ ...failedClose, cleanup: "close-unavailable" }),
    ).toEqual(["cleanup-projection"]);
    const retainedForFollowup: LifecycleExample = {
      ...valid,
      capability: "automatic-close-supported",
      cleanup: "closed=no",
      closeOperationExposed: true,
      closeOperationUsable: true,
      cleanupDecision: "retained",
      retentionReason: "spec reviewer may route a same-session fixup",
      deferredEventReasons: ["spec reviewer may route a same-session fixup"],
      closeUnavailableReason: null,
      unavailableEventReasons: [],
      events: [
        ...valid.events.filter((event) => event !== "closure-unavailable"),
        "close-deferred",
      ],
    };
    expect(invalidDimensions(retainedForFollowup)).toEqual([]);
    const resolvedRetention: LifecycleExample = {
      ...retainedForFollowup,
      cleanupDecision: "none",
      retentionReason: null,
      retentionResolutionDetails: [
        {
          basis: "need-finished",
          evidence: "same-session fixup need finished",
        },
      ],
      events: [...retainedForFollowup.events, "retention-resolved"],
    };
    expect(invalidDimensions(resolvedRetention)).toEqual([]);
    expect(resolvedRetention.cleanupEvaluation).toBe("evaluated");
    expect(resolvedRetention.cleanupDecision).toBe("none");
    expect(resolvedRetention.cleanup).toBe("closed=no");
    expect(resolvedRetention.closeUnavailableReason).toBeNull();
    expect(resolvedRetention.events).toContain("close-deferred");
    expect(resolvedRetention.deferredEventReasons).toEqual([
      "spec reviewer may route a same-session fixup",
    ]);
    expect(
      invalidDimensions({
        ...resolvedRetention,
        events: retainedForFollowup.events,
      }),
    ).toEqual(["retention-resolution-history"]);
    expect(
      invalidDimensions({
        ...resolvedRetention,
        cleanupDecision: "retained",
      }),
    ).toEqual(["cleanup-decision"]);
    expect(
      invalidDimensions({
        ...resolvedRetention,
        retentionReason: "stale same-session fixup reason",
      }),
    ).toEqual(["retention-resolution-projection"]);
    expect(
      invalidDimensions({
        ...resolvedRetention,
        cleanup: "close-unavailable",
        closeUnavailableReason: "stale unavailable projection",
      }),
    ).toEqual(["retention-resolution-projection"]);
    const unavailableThenResolved: LifecycleExample = {
      ...valid,
      cleanup: "closed=no",
      cleanupDecision: "none",
      retentionReason: null,
      deferredEventReasons: ["same-session reviewer follow-up required"],
      retentionResolutionDetails: [
        {
          basis: "captured-and-replaced",
          evidence: "reviewer state captured and replaced",
        },
      ],
      closeUnavailableReason: null,
      events: [
        ...valid.events,
        "close-deferred",
        "required-state-captured",
        "replacement-secured",
        "retention-resolved",
      ],
    };
    expect(invalidDimensions(unavailableThenResolved)).toEqual([]);
    expect(unavailableThenResolved.unavailableEventReasons).toEqual([
      "inventory-only; no close operation",
    ]);
    expect(
      invalidDimensions({
        ...unavailableThenResolved,
        cleanup: "close-unavailable",
        closeUnavailableReason: "inventory-only; no close operation",
      }),
    ).toEqual(["retention-resolution-projection"]);
    expect(
      invalidDimensions({
        ...resolvedRetention,
        events: resolvedRetention.events.filter(
          (event) => event !== "close-deferred",
        ),
        deferredEventReasons: [],
      }),
    ).toEqual(["retention-resolution-without-deferral"]);
    expect(
      invalidDimensions({
        ...retainedForFollowup,
        cleanupDecision: "attempted",
        retentionReason: null,
        deferredEventReasons: [],
        closeInvocationObserved: false,
        closeAttempted: true,
        closeFailed: true,
        events: [
          ...retainedForFollowup.events.filter(
            (event) => event !== "close-deferred",
          ),
          "close-attempted",
          "close-failed",
        ],
      }),
    ).toEqual(["fabricated-close-attempt"]);
    expect(
      invalidDimensions({
        ...retainedForFollowup,
        cleanupEvaluation: "not-evaluated",
      }),
    ).toEqual(["cleanup-evaluation-state"]);
    expect(
      invalidDimensions({ ...retainedForFollowup, retentionReason: null }),
    ).toEqual(["retention-reason"]);
    expect(
      invalidDimensions({
        ...retainedForFollowup,
        retentionReason: "different current retention reason",
      }),
    ).toEqual(["retention-reason-projection"]);
    const laterFailedClose: LifecycleExample = {
      ...resolvedRetention,
      cleanupDecision: "attempted",
      closeInvocationObserved: true,
      closeAttempted: true,
      closeFailed: true,
      events: [...resolvedRetention.events, "close-attempted", "close-failed"],
    };
    expect(invalidDimensions(laterFailedClose)).toEqual([]);
    expect(
      invalidDimensions({
        ...laterFailedClose,
        events: laterFailedClose.events.filter(
          (event) => event !== "retention-resolved",
        ),
        retentionResolutionDetails: [],
      }),
    ).toEqual(["retention-resolution-missing"]);
    const unavailableAfterResolution: LifecycleExample = {
      ...resolvedRetention,
      capability: "inventory-only",
      cleanup: "close-unavailable",
      cleanupDecision: "unavailable",
      closeOperationExposed: false,
      closeOperationUsable: false,
      closeUnavailableReason: "inventory-only; no close operation",
      unavailableEventReasons: ["inventory-only; no close operation"],
      events: [...resolvedRetention.events, "closure-unavailable"],
    };
    expect(invalidDimensions(unavailableAfterResolution)).toEqual([]);
    expect(unavailableAfterResolution.events).toContain("retention-resolved");
    expect(laterFailedClose.events).toContain("close-deferred");
    expect(laterFailedClose.deferredEventReasons).toEqual([
      "spec reviewer may route a same-session fixup",
    ]);
    expect(
      invalidDimensions({ ...laterFailedClose, deferredEventReasons: [] }),
    ).toEqual(["deferred-reason-history"]);
    expect(
      invalidDimensions({
        ...laterFailedClose,
        cleanupDecision: "retained",
        retentionReason: "stale same-session fixup reason",
      }),
    ).toEqual(["cleanup-decision"]);
    expect(
      invalidDimensions({
        ...laterFailedClose,
        retentionReason: "stale same-session fixup reason",
      }),
    ).toEqual(["stale-cleanup-fields"]);
    expect(
      invalidDimensions({
        ...laterFailedClose,
        events: [...laterFailedClose.events, "close-deferred"],
        deferredEventReasons: [
          ...laterFailedClose.deferredEventReasons,
          "new same-session follow-up reason",
        ],
      }),
    ).toEqual(["cleanup-decision"]);
    expect(
      invalidDimensions({
        ...retainedForFollowup,
        closeUnavailableReason: "stale unavailable reason",
      }),
    ).toEqual(["stale-cleanup-fields"]);
    expect(
      invalidDimensions({
        ...valid,
        events: valid.events.filter((event) => event !== "closure-unavailable"),
        unavailableEventReasons: [],
      }),
    ).toEqual(["cleanup-decision"]);
    expect(
      invalidDimensions({
        ...failedClose,
        events: failedClose.events.filter(
          (event) => event !== "close-attempted",
        ),
      }),
    ).toEqual(["close-attempt-result-pairing"]);
    expect(
      invalidDimensions({
        ...failedClose,
        events: [...valid.events, "close-failed", "close-attempted"],
        unavailableEventReasons: ["inventory-only; no close operation"],
      }),
    ).toEqual(["close-attempt-result-pairing"]);
    expect(
      invalidDimensions({
        ...failedClose,
        cleanup: "closed=yes",
        closeSucceeded: true,
        events: [...failedClose.events, "close-succeeded"],
      }),
    ).toEqual(["close-attempt-result-pairing"]);
    const succeededOnRetry: LifecycleExample = {
      ...failedClose,
      cleanup: "closed=yes",
      closeSucceeded: true,
      events: [...failedClose.events, "close-attempted", "close-succeeded"],
    };
    expect(invalidDimensions(succeededOnRetry)).toEqual([]);
    expect(
      invalidDimensions({
        ...failedClose,
        cleanup: "closed=yes",
        closeSucceeded: true,
      }),
    ).toEqual(["cleanup-event-history"]);
    expect(
      invalidDimensions({
        ...retainedForFollowup,
        cleanup: "closed=yes",
        closeSucceeded: true,
        events: [...retainedForFollowup.events, "close-succeeded"],
      }),
    ).toEqual(["close-attempt-result-pairing"]);
    expect(
      invalidDimensions({
        ...failedClose,
        cleanupDecision: "retained",
        retentionReason: "same-session follow-up remains necessary",
        deferredEventReasons: ["same-session follow-up remains necessary"],
        events: [...failedClose.events, "close-deferred", "close-failed"],
      }),
    ).toEqual(["close-attempt-result-pairing"]);
    expect(
      invalidDimensions({
        ...failedClose,
        capability: "inventory-only",
        cleanup: "close-unavailable",
        cleanupDecision: "unavailable",
        closeOperationExposed: false,
        closeOperationUsable: false,
        closeUnavailableReason: "close operation no longer exposed",
        unavailableEventReasons: ["close operation no longer exposed"],
        events: [...failedClose.events, "closure-unavailable", "close-failed"],
      }),
    ).toEqual(["close-attempt-result-pairing"]);
    expect(
      invalidDimensions({
        ...succeededOnRetry,
        events: [...succeededOnRetry.events, "close-deferred"],
        deferredEventReasons: [
          ...succeededOnRetry.deferredEventReasons,
          "invalid post-success retention reason",
        ],
      }),
    ).toEqual(["terminal-close-contradiction"]);
  });

  it("classifies every open capacity blocker before cleanup", () => {
    type OpenBlocker = {
      state: "pending" | "active" | "waiting" | "interrupted";
      identity: "pending" | "stable" | "unknown";
      classified: boolean;
      requiredStateCaptured: boolean;
      safeCaptureBoundaryAvailable: boolean;
      waitOrSteerSupported: boolean;
      reusable: boolean;
      replacementStateSecured: boolean;
      action:
        | "wait-or-steer-to-capture"
        | "defer-and-retain"
        | "reuse"
        | "supersede-after-replacement"
        | "resolve-identity"
        | "stop-and-escalate"
        | "close-another-row";
    };

    function openBlockerErrors(blocker: OpenBlocker): string[] {
      if (!blocker.classified) {
        return ["capacity-blocker-unclassified"];
      }
      if (blocker.state === "pending" || blocker.identity === "unknown") {
        return blocker.action === "resolve-identity" ||
          blocker.action === "stop-and-escalate"
          ? []
          : ["pending-identity-cleanup"];
      }
      if (blocker.state === "active") {
        if (blocker.action === "stop-and-escalate") {
          return [];
        }
        if (
          blocker.safeCaptureBoundaryAvailable &&
          blocker.requiredStateCaptured
        ) {
          return blocker.action === "defer-and-retain" ||
            (blocker.action === "supersede-after-replacement" &&
              blocker.replacementStateSecured)
            ? []
            : ["active-resolution"];
        }
        if (blocker.waitOrSteerSupported) {
          return blocker.action === "wait-or-steer-to-capture"
            ? []
            : ["active-capture-boundary"];
        }
        return ["unsafe-active-cleanup"];
      }
      if (!blocker.requiredStateCaptured) {
        return ["open-state-not-captured"];
      }
      if (blocker.action === "supersede-after-replacement") {
        return blocker.replacementStateSecured
          ? []
          : ["replacement-not-secured"];
      }
      if (blocker.state === "waiting") {
        return blocker.action === "defer-and-retain"
          ? []
          : ["waiting-resolution"];
      }
      if (blocker.state === "interrupted") {
        return (blocker.reusable && blocker.action === "reuse") ||
          blocker.action === "defer-and-retain"
          ? []
          : ["interrupted-resolution"];
      }
      return [];
    }

    const active: OpenBlocker = {
      state: "active",
      identity: "stable",
      classified: true,
      requiredStateCaptured: false,
      safeCaptureBoundaryAvailable: false,
      waitOrSteerSupported: true,
      reusable: false,
      replacementStateSecured: false,
      action: "wait-or-steer-to-capture",
    };
    const waiting: OpenBlocker = {
      ...active,
      state: "waiting",
      requiredStateCaptured: true,
      action: "defer-and-retain",
    };
    const interrupted: OpenBlocker = {
      ...waiting,
      state: "interrupted",
      reusable: true,
      action: "reuse",
    };
    const pendingBlocker: OpenBlocker = {
      ...active,
      state: "pending",
      identity: "pending",
      action: "resolve-identity",
    };
    for (const blocker of [active, waiting, interrupted, pendingBlocker]) {
      expect(openBlockerErrors(blocker)).toEqual([]);
    }
    for (const action of ["reuse", "defer-and-retain"] as const) {
      expect(
        openBlockerErrors({
          ...interrupted,
          replacementStateSecured: false,
          action,
        }),
      ).toEqual([]);
    }
    expect(openBlockerErrors({ ...active, classified: false })).toEqual([
      "capacity-blocker-unclassified",
    ]);
    expect(
      openBlockerErrors({ ...active, action: "stop-and-escalate" }),
    ).toEqual([]);
    expect(
      openBlockerErrors({
        ...active,
        safeCaptureBoundaryAvailable: true,
        requiredStateCaptured: true,
        action: "defer-and-retain",
      }),
    ).toEqual([]);
    expect(
      openBlockerErrors({
        ...waiting,
        replacementStateSecured: true,
        action: "supersede-after-replacement",
      }),
    ).toEqual([]);
    expect(
      openBlockerErrors({
        ...interrupted,
        replacementStateSecured: true,
        action: "supersede-after-replacement",
      }),
    ).toEqual([]);
    expect(
      openBlockerErrors({
        ...active,
        waitOrSteerSupported: false,
        action: "close-another-row",
      }),
    ).toEqual(["unsafe-active-cleanup"]);
    expect(
      openBlockerErrors({ ...waiting, requiredStateCaptured: false }),
    ).toEqual(["open-state-not-captured"]);
    expect(
      openBlockerErrors({
        ...interrupted,
        action: "supersede-after-replacement",
        replacementStateSecured: false,
      }),
    ).toEqual(["replacement-not-secured"]);
    expect(
      openBlockerErrors({ ...pendingBlocker, action: "close-another-row" }),
    ).toEqual(["pending-identity-cleanup"]);
  });

  it("canonically folds row lifecycle and controller recovery episodes", () => {
    type BlockerRef = Readonly<{
      kind: "ledger-row" | "inventory-only";
      identity: string;
    }>;
    type RowEvent = Readonly<{
      eventId: string;
      kind:
        | "close-attempted"
        | "close-failed"
        | "close-succeeded"
        | "closure-unavailable";
      order: number;
      sessionId: string;
      reason?: string;
    }>;
    type PreparationEvent = Readonly<{
      kind:
        | "operational-state"
        | "required-state-captured"
        | "abnormal-context-captured"
        | "close-deferred"
        | "replacement-secured"
        | "retention-resolved";
      order: number;
      state?:
        | "active"
        | "waiting"
        | "interrupted"
        | "completed"
        | "timed-out"
        | "failed"
        | "superseded";
      evidence?: string;
      reason?: string;
      basis?: "need-finished" | "captured-and-replaced";
    }>;
    type RowRecord = Readonly<{
      rowId: string;
      identityState: "stable" | "pending" | "unknown";
      sessionId: string | null;
      inventoryEvidenceId?: string;
      history: readonly RowEvent[];
      preparationHistory: readonly PreparationEvent[];
      projection: "closed=no" | "closed=yes" | "close-unavailable";
    }>;
    type Authorization = Readonly<
      | {
          kind: "row-close";
          episodeId: string;
          blocker: BlockerRef;
          rowId: string;
          rowEventId: string;
          sessionId: string;
        }
      | {
          kind: "manual";
          episodeId: string;
          blocker: BlockerRef;
          provenance: string;
          observedAt: string;
        }
    >;
    type EpisodeEvent = Readonly<{
      kind:
        | "slot-recovery-started"
        | "manual-cleanup-confirmed"
        | "recovery-state-reconstructed"
        | "slot-retry-dispatched"
        | "slot-retry-succeeded"
        | "slot-retry-failed";
      order: number;
      blocker?: BlockerRef;
      provenance?: string;
      observedAt?: string;
    }>;
    type RetryFailureEscalation = Readonly<{
      inventory: "available" | "unavailable";
      remainingBlockers: readonly BlockerRef[];
    }>;
    type Episode = Readonly<{
      originId: string;
      episodeId: string;
      snapshot: readonly BlockerRef[];
      state:
        | "authorizing"
        | "ready"
        | "retry-dispatched"
        | "retry-succeeded"
        | "retry-failed";
      events: readonly EpisodeEvent[];
      authorizations: readonly Authorization[];
      escalation?: RetryFailureEscalation;
    }>;
    type Ledger = Readonly<{
      order: number;
      rows: readonly RowRecord[];
      episodes: readonly Episode[];
      originEpisodes: readonly Readonly<{
        originId: string;
        episodeId: string;
      }>[];
      retryDispatches: number;
    }>;
    type Operation =
      | {
          kind: "start";
          originId: string;
          episodeId: string;
          observedBlockers: BlockerRef[];
          snapshot: BlockerRef[];
        }
      | {
          kind: "record-row-close";
          rowId: string;
          sessionId: string;
          attemptEventId: string;
          successEventId: string;
        }
      | { kind: "authorize"; episodeId: string; evidence: Authorization }
      | {
          kind: "reconstruct";
          episodeId: string;
          lifecycleAnchor: string;
          repositoryAnchor: string;
        }
      | { kind: "dispatch"; episodeId: string }
      | {
          kind: "result";
          episodeId: string;
          result: "succeeded" | "failed";
          escalation?: RetryFailureEscalation;
        };
    type FoldResult = {
      input: unknown;
      ledger?: Ledger;
      error?: string;
    };

    const blockerKey = (blocker: BlockerRef): string =>
      `${blocker.kind}:${blocker.identity}`;
    const validBlockerKind = (blocker: unknown): blocker is BlockerRef =>
      typeof blocker === "object" &&
      blocker !== null &&
      "kind" in blocker &&
      (blocker.kind === "ledger-row" || blocker.kind === "inventory-only");
    const validAuthorizationKind = (
      authorization: unknown,
    ): authorization is Authorization =>
      typeof authorization === "object" &&
      authorization !== null &&
      "kind" in authorization &&
      (authorization.kind === "row-close" || authorization.kind === "manual");
    const sanitizedIdentity = (value: unknown): value is string =>
      typeof value === "string" && /^[A-Za-z0-9._-]+$/.test(value);
    const validProvenance = (value: unknown): value is string =>
      typeof value === "string" &&
      value === value.trim() &&
      value.length > 0 &&
      value.length <= 160 &&
      /^[A-Za-z0-9 ._:/@+-]+$/.test(value);
    const validTime = (value: unknown): value is string => {
      if (
        typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)
      ) {
        return false;
      }
      const parsed = Date.parse(value);
      return (
        !Number.isNaN(parsed) &&
        new Date(parsed).toISOString() === value.replace(/Z$/, ".000Z")
      );
    };
    const validEscalation = (
      escalation: unknown,
      snapshot: readonly BlockerRef[],
    ): escalation is RetryFailureEscalation => {
      if (typeof escalation !== "object" || escalation === null) return false;
      const keys = Object.keys(escalation).sort();
      if (keys.join(",") !== "inventory,remainingBlockers") return false;
      const candidate = escalation as Record<string, unknown>;
      if (
        candidate.inventory !== "available" &&
        candidate.inventory !== "unavailable"
      ) {
        return false;
      }
      if (!Array.isArray(candidate.remainingBlockers)) return false;
      const remaining = candidate.remainingBlockers as unknown[];
      if (
        remaining.some(
          (blocker) =>
            !isRecord(blocker) ||
            !exactKeys(blocker, ["kind", "identity"]) ||
            !validBlockerKind(blocker) ||
            typeof blocker.identity !== "string" ||
            !sanitizedIdentity(blocker.identity) ||
            !snapshot.some(
              (member) => blockerKey(member) === blockerKey(blocker),
            ),
        )
      ) {
        return false;
      }
      const keysSeen = remaining.map((blocker) =>
        blockerKey(blocker as BlockerRef),
      );
      return new Set(keysSeen).size === keysSeen.length;
    };
    const freezeBlocker = (blocker: BlockerRef): BlockerRef =>
      Object.freeze({ kind: blocker.kind, identity: blocker.identity });
    const freezeAuthorization = (
      authorization: Authorization,
    ): Authorization =>
      authorization.kind === "row-close"
        ? Object.freeze({
            kind: authorization.kind,
            episodeId: authorization.episodeId,
            blocker: freezeBlocker(authorization.blocker),
            rowId: authorization.rowId,
            rowEventId: authorization.rowEventId,
            sessionId: authorization.sessionId,
          })
        : Object.freeze({
            kind: authorization.kind,
            episodeId: authorization.episodeId,
            blocker: freezeBlocker(authorization.blocker),
            provenance: authorization.provenance,
            observedAt: authorization.observedAt,
          });
    const freezeEvent = (event: EpisodeEvent): EpisodeEvent =>
      Object.freeze({
        kind: event.kind,
        order: event.order,
        ...(event.blocker === undefined
          ? {}
          : { blocker: freezeBlocker(event.blocker) }),
        ...(event.provenance === undefined
          ? {}
          : { provenance: event.provenance }),
        ...(event.observedAt === undefined
          ? {}
          : { observedAt: event.observedAt }),
      });
    const freezeEscalation = (
      escalation: RetryFailureEscalation,
    ): RetryFailureEscalation =>
      Object.freeze({
        inventory: escalation.inventory,
        remainingBlockers: Object.freeze(
          escalation.remainingBlockers.map(freezeBlocker),
        ),
      });
    const freezeRow = (row: RowRecord): RowRecord =>
      Object.freeze({
        ...row,
        history: Object.freeze(
          row.history.map((event) => Object.freeze({ ...event })),
        ),
        preparationHistory: Object.freeze(
          row.preparationHistory.map((event) => Object.freeze({ ...event })),
        ),
      });
    const freezeEpisode = (episode: Episode): Episode =>
      Object.freeze({
        ...episode,
        snapshot: Object.freeze(episode.snapshot.map(freezeBlocker)),
        events: Object.freeze(episode.events.map(freezeEvent)),
        authorizations: Object.freeze(
          episode.authorizations.map(freezeAuthorization),
        ),
        ...(episode.escalation === undefined
          ? {}
          : { escalation: freezeEscalation(episode.escalation) }),
      });
    const freezeLedger = (ledger: Ledger): Ledger =>
      Object.freeze({
        ...ledger,
        rows: Object.freeze(ledger.rows.map(freezeRow)),
        episodes: Object.freeze(ledger.episodes.map(freezeEpisode)),
        originEpisodes: Object.freeze(
          ledger.originEpisodes.map((entry) => Object.freeze({ ...entry })),
        ),
      });
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null && !Array.isArray(value);
    const exactKeys = (
      value: Record<string, unknown>,
      required: string[],
      optional: string[] = [],
    ): boolean => {
      const keys = Object.keys(value);
      return (
        required.every((key) => keys.includes(key)) &&
        keys.every((key) => required.includes(key) || optional.includes(key))
      );
    };
    const validLedgerEnvelope = (value: unknown): value is Ledger => {
      if (
        !isRecord(value) ||
        !exactKeys(value, [
          "order",
          "rows",
          "episodes",
          "originEpisodes",
          "retryDispatches",
        ]) ||
        !Number.isInteger(value.order) ||
        (value.order as number) < 0 ||
        !Number.isInteger(value.retryDispatches) ||
        (value.retryDispatches as number) < 0 ||
        !Array.isArray(value.rows) ||
        !Array.isArray(value.episodes) ||
        !Array.isArray(value.originEpisodes)
      ) {
        return false;
      }
      return (
        value.rows.every(
          (row) =>
            isRecord(row) &&
            exactKeys(
              row,
              [
                "rowId",
                "identityState",
                "sessionId",
                "history",
                "preparationHistory",
                "projection",
              ],
              ["inventoryEvidenceId"],
            ) &&
            Array.isArray(row.history) &&
            row.history.every(isRecord) &&
            Array.isArray(row.preparationHistory) &&
            row.preparationHistory.every(isRecord),
        ) &&
        value.episodes.every(
          (episode) =>
            isRecord(episode) &&
            exactKeys(
              episode,
              [
                "originId",
                "episodeId",
                "snapshot",
                "state",
                "events",
                "authorizations",
              ],
              ["escalation"],
            ) &&
            Array.isArray(episode.snapshot) &&
            episode.snapshot.every(isRecord) &&
            Array.isArray(episode.events) &&
            episode.events.every(isRecord) &&
            Array.isArray(episode.authorizations) &&
            episode.authorizations.every(isRecord),
        ) &&
        value.originEpisodes.every(
          (entry) =>
            isRecord(entry) &&
            exactKeys(entry, ["originId", "episodeId"]) &&
            typeof entry.originId === "string" &&
            typeof entry.episodeId === "string",
        )
      );
    };
    const validOperationEnvelope = (value: unknown): value is Operation => {
      if (!isRecord(value) || typeof value.kind !== "string") return false;
      switch (value.kind) {
        case "start":
          return (
            exactKeys(value, [
              "kind",
              "originId",
              "episodeId",
              "observedBlockers",
              "snapshot",
            ]) &&
            typeof value.originId === "string" &&
            typeof value.episodeId === "string" &&
            Array.isArray(value.observedBlockers) &&
            Array.isArray(value.snapshot)
          );
        case "record-row-close":
          return (
            exactKeys(value, [
              "kind",
              "rowId",
              "sessionId",
              "attemptEventId",
              "successEventId",
            ]) &&
            typeof value.rowId === "string" &&
            typeof value.sessionId === "string" &&
            typeof value.attemptEventId === "string" &&
            typeof value.successEventId === "string"
          );
        case "authorize":
          return (
            exactKeys(value, ["kind", "episodeId", "evidence"]) &&
            typeof value.episodeId === "string" &&
            isRecord(value.evidence)
          );
        case "reconstruct":
          return (
            exactKeys(value, [
              "kind",
              "episodeId",
              "lifecycleAnchor",
              "repositoryAnchor",
            ]) &&
            typeof value.episodeId === "string" &&
            typeof value.lifecycleAnchor === "string" &&
            typeof value.repositoryAnchor === "string"
          );
        case "dispatch":
          return (
            exactKeys(value, ["kind", "episodeId"]) &&
            typeof value.episodeId === "string"
          );
        case "result":
          return (
            exactKeys(value, ["kind", "episodeId", "result"], ["escalation"]) &&
            typeof value.episodeId === "string" &&
            typeof value.result === "string"
          );
        default:
          return false;
      }
    };
    const fail = (ledger: Ledger, error: string): FoldResult => ({
      input: ledger,
      ledger,
      error,
    });
    const failUnknown = (input: unknown, error: string): FoldResult => ({
      input,
      error,
    });
    const indexesConsistent = (ledger: Ledger): boolean =>
      ledger.episodes.length === ledger.originEpisodes.length &&
      new Set(ledger.episodes.map((episode) => episode.episodeId)).size ===
        ledger.episodes.length &&
      new Set(ledger.originEpisodes.map((entry) => entry.originId)).size ===
        ledger.originEpisodes.length &&
      new Set(ledger.originEpisodes.map((entry) => entry.episodeId)).size ===
        ledger.originEpisodes.length &&
      ledger.episodes.every(
        (episode) =>
          ledger.originEpisodes.filter(
            (entry) =>
              entry.originId === episode.originId &&
              entry.episodeId === episode.episodeId,
          ).length === 1,
      ) &&
      ledger.originEpisodes.every(
        (entry) =>
          ledger.episodes.filter(
            (episode) =>
              episode.originId === entry.originId &&
              episode.episodeId === entry.episodeId,
          ).length === 1,
      );
    const rowBeforeOrder = (row: RowRecord, cutoffOrder: number): RowRecord => {
      const history = row.history.filter((event) => event.order < cutoffOrder);
      return {
        ...row,
        history,
        preparationHistory: row.preparationHistory.filter(
          (event) => event.order < cutoffOrder,
        ),
        projection: history.some((event) => event.kind === "close-succeeded")
          ? "closed=yes"
          : history.at(-1)?.kind === "closure-unavailable"
            ? "close-unavailable"
            : "closed=no",
      };
    };
    const rowsConsistent = (ledger: Ledger): boolean => {
      const rowIds = new Set<string>();
      const sessions = new Set<string>();
      const eventIds = new Set<string>();
      for (const row of ledger.rows) {
        if (
          !sanitizedIdentity(row.rowId) ||
          rowIds.has(row.rowId) ||
          (row.identityState !== "stable" &&
            row.identityState !== "pending" &&
            row.identityState !== "unknown") ||
          (row.identityState === "stable"
            ? !sanitizedIdentity(row.sessionId) || sessions.has(row.sessionId)
            : row.sessionId !== null) ||
          (row.inventoryEvidenceId !== undefined &&
            !sanitizedIdentity(row.inventoryEvidenceId)) ||
          (row.projection !== "closed=no" &&
            row.projection !== "closed=yes" &&
            row.projection !== "close-unavailable")
        ) {
          return false;
        }
        rowIds.add(row.rowId);
        if (row.identityState === "stable")
          sessions.add(row.sessionId as string);
        let previousOrder = 0;
        let sawSuccess = false;
        for (let index = 0; index < row.history.length; index += 1) {
          const event = row.history[index];
          if (
            !isRecord(event) ||
            !exactKeys(
              event,
              event.kind === "closure-unavailable"
                ? ["eventId", "kind", "order", "sessionId", "reason"]
                : ["eventId", "kind", "order", "sessionId"],
            ) ||
            ![
              "close-attempted",
              "close-failed",
              "close-succeeded",
              "closure-unavailable",
            ].includes(event.kind) ||
            !sanitizedIdentity(event.eventId) ||
            eventIds.has(event.eventId) ||
            !Number.isInteger(event.order) ||
            event.order <= previousOrder ||
            event.order > ledger.order ||
            event.sessionId !== row.sessionId ||
            row.identityState !== "stable" ||
            (event.kind === "closure-unavailable" &&
              !validProvenance(event.reason)) ||
            sawSuccess
          ) {
            return false;
          }
          if (
            (event.kind === "close-succeeded" ||
              event.kind === "close-failed") &&
            row.history[index - 1]?.kind !== "close-attempted"
          ) {
            return false;
          }
          if (
            event.kind === "close-attempted" &&
            row.history[index + 1]?.kind !== "close-succeeded" &&
            row.history[index + 1]?.kind !== "close-failed"
          ) {
            return false;
          }
          eventIds.add(event.eventId);
          previousOrder = event.order;
          sawSuccess ||= event.kind === "close-succeeded";
        }
        const derivedProjection = sawSuccess
          ? "closed=yes"
          : row.history.at(-1)?.kind === "closure-unavailable"
            ? "close-unavailable"
            : "closed=no";
        if (row.projection !== derivedProjection) return false;
        const successfulCloseIndex = row.history.findIndex(
          (event) => event.kind === "close-succeeded",
        );
        const successfulCloseAttemptOrder =
          successfulCloseIndex < 0
            ? undefined
            : row.history[successfulCloseIndex - 1]?.order;
        previousOrder = 0;
        for (const event of row.preparationHistory) {
          if (
            !isRecord(event) ||
            typeof event.kind !== "string" ||
            !Number.isInteger(event.order) ||
            event.order <= previousOrder ||
            event.order > ledger.order ||
            (successfulCloseAttemptOrder !== undefined &&
              event.order >= successfulCloseAttemptOrder)
          ) {
            return false;
          }
          const requiredByKind: Record<string, string[]> = {
            "operational-state": ["kind", "order", "state"],
            "required-state-captured": ["kind", "order", "evidence"],
            "abnormal-context-captured": ["kind", "order", "evidence"],
            "close-deferred": ["kind", "order", "reason"],
            "replacement-secured": ["kind", "order", "evidence"],
            "retention-resolved": ["kind", "order", "basis", "evidence"],
          };
          const required = requiredByKind[event.kind];
          if (required === undefined || !exactKeys(event, required))
            return false;
          if (
            ("evidence" in event && !validProvenance(event.evidence)) ||
            ("reason" in event && !validProvenance(event.reason)) ||
            (event.kind === "operational-state" &&
              ![
                "active",
                "waiting",
                "interrupted",
                "completed",
                "timed-out",
                "failed",
                "superseded",
              ].includes(event.state as string)) ||
            (event.kind === "retention-resolved" &&
              event.basis !== "need-finished" &&
              event.basis !== "captured-and-replaced")
          ) {
            return false;
          }
          previousOrder = event.order;
        }
        for (const event of row.history) {
          if (
            (event.kind === "close-attempted" ||
              event.kind === "closure-unavailable") &&
            rowPreparationError(rowBeforeOrder(row, event.order), false) !==
              undefined
          ) {
            return false;
          }
        }
      }
      return true;
    };
    const rowPreparationError = (
      row: RowRecord,
      requireManualPath: boolean,
    ): string | undefined => {
      if (row.identityState !== "stable" || !sanitizedIdentity(row.sessionId)) {
        return "row-preparation-identity";
      }
      const operational = [...row.preparationHistory]
        .reverse()
        .find((event) => event.kind === "operational-state");
      if (
        operational === undefined ||
        !["completed", "timed-out", "failed", "superseded"].includes(
          operational.state as string,
        )
      ) {
        return "row-preparation-operational-state";
      }
      const capture = [...row.preparationHistory]
        .reverse()
        .find((event) => event.kind === "required-state-captured");
      if (capture === undefined || capture.order <= operational.order) {
        return "row-preparation-capture-stale";
      }
      let abnormalContextOrder = 0;
      const latestAbnormal = [...row.preparationHistory]
        .reverse()
        .find(
          (event) =>
            event.kind === "operational-state" &&
            (event.state === "timed-out" || event.state === "failed"),
        );
      if (latestAbnormal !== undefined) {
        const context = [...row.preparationHistory]
          .reverse()
          .find((event) => event.kind === "abnormal-context-captured");
        if (context === undefined || context.order <= latestAbnormal.order) {
          return "row-preparation-abnormal-context";
        }
        abnormalContextOrder = context.order;
      }
      const deferral = [...row.preparationHistory]
        .reverse()
        .find((event) => event.kind === "close-deferred");
      let retentionResolutionOrder = 0;
      if (deferral !== undefined) {
        const resolution = [...row.preparationHistory]
          .reverse()
          .find((event) => event.kind === "retention-resolved");
        if (resolution === undefined || resolution.order <= deferral.order) {
          return "row-preparation-retention-unresolved";
        }
        if (resolution.basis === "captured-and-replaced") {
          const replacement = [...row.preparationHistory]
            .reverse()
            .find((event) => event.kind === "replacement-secured");
          if (
            capture.order <= deferral.order ||
            replacement === undefined ||
            replacement.order <= capture.order ||
            resolution.order <= replacement.order
          ) {
            return "row-preparation-retention-proof";
          }
        }
        retentionResolutionOrder = resolution.order;
      }
      if (requireManualPath) {
        const latestCleanup = row.history.at(-1);
        const manualPath =
          (latestCleanup?.kind === "close-failed" &&
            row.projection === "closed=no") ||
          (latestCleanup?.kind === "closure-unavailable" &&
            validProvenance(latestCleanup.reason) &&
            row.projection === "close-unavailable")
            ? latestCleanup
            : undefined;
        if (manualPath === undefined) {
          return "row-preparation-manual-path";
        }
        if (
          manualPath.order <=
          Math.max(
            operational.order,
            capture.order,
            abnormalContextOrder,
            retentionResolutionOrder,
          )
        ) {
          return "row-preparation-manual-path-stale";
        }
      }
      return undefined;
    };
    const rowCloseAuthorizationValid = (
      ledger: Ledger,
      episode: Episode,
      authorization: Extract<Authorization, { kind: "row-close" }>,
    ): boolean => {
      const row = ledger.rows.find(
        (candidate) => candidate.rowId === authorization.rowId,
      );
      if (
        row === undefined ||
        authorization.blocker.kind !== "ledger-row" ||
        authorization.blocker.identity !== row.rowId ||
        authorization.sessionId !== row.sessionId
      ) {
        return false;
      }
      const successIndex = row.history.findIndex(
        (event) =>
          event.eventId === authorization.rowEventId &&
          event.kind === "close-succeeded",
      );
      const success = row.history[successIndex];
      const attempt = row.history[successIndex - 1];
      const reconstruction = episode.events.find(
        (event) => event.kind === "recovery-state-reconstructed",
      );
      return (
        success !== undefined &&
        success.sessionId === row.sessionId &&
        success.order > episode.events[0].order &&
        attempt?.kind === "close-attempted" &&
        attempt.sessionId === row.sessionId &&
        attempt.order < success.order &&
        (reconstruction === undefined ||
          success.order < reconstruction.order) &&
        row.projection === "closed=yes"
      );
    };
    const ledgerConsistent = (ledger: Ledger): boolean => {
      if (!indexesConsistent(ledger) || !rowsConsistent(ledger)) return false;
      let dispatchCount = 0;
      for (const episode of ledger.episodes) {
        if (
          !sanitizedIdentity(episode.originId) ||
          !sanitizedIdentity(episode.episodeId) ||
          episode.snapshot.length === 0 ||
          episode.snapshot.some(
            (blocker) =>
              !exactKeys(blocker as unknown as Record<string, unknown>, [
                "kind",
                "identity",
              ]) ||
              !validBlockerKind(blocker) ||
              !sanitizedIdentity(blocker.identity),
          ) ||
          new Set(episode.snapshot.map(blockerKey)).size !==
            episode.snapshot.length ||
          episode.snapshot.some(
            (blocker) =>
              (blocker.kind === "ledger-row" &&
                !ledger.rows.some((row) => row.rowId === blocker.identity)) ||
              (blocker.kind === "inventory-only" &&
                ledger.rows.some(
                  (row) => row.inventoryEvidenceId === blocker.identity,
                )),
          ) ||
          episode.events.length === 0 ||
          episode.events[0].kind !== "slot-recovery-started" ||
          episode.events.some(
            (event, index) =>
              ![
                "slot-recovery-started",
                "manual-cleanup-confirmed",
                "recovery-state-reconstructed",
                "slot-retry-dispatched",
                "slot-retry-succeeded",
                "slot-retry-failed",
              ].includes(event.kind) ||
              !exactKeys(
                event as unknown as Record<string, unknown>,
                event.kind === "manual-cleanup-confirmed"
                  ? ["kind", "order", "blocker", "provenance", "observedAt"]
                  : ["kind", "order"],
              ) ||
              !Number.isInteger(event.order) ||
              event.order <= 0 ||
              event.order > ledger.order ||
              (index > 0 && event.order <= episode.events[index - 1].order),
          )
        ) {
          return false;
        }
        const authorizationKeys = new Set<string>();
        for (const authorization of episode.authorizations) {
          if (
            !validAuthorizationKind(authorization) ||
            !exactKeys(
              authorization as unknown as Record<string, unknown>,
              authorization.kind === "row-close"
                ? [
                    "kind",
                    "episodeId",
                    "blocker",
                    "rowId",
                    "rowEventId",
                    "sessionId",
                  ]
                : ["kind", "episodeId", "blocker", "provenance", "observedAt"],
            ) ||
            authorization.episodeId !== episode.episodeId ||
            !validBlockerKind(authorization.blocker) ||
            !sanitizedIdentity(authorization.blocker.identity) ||
            !episode.snapshot.some(
              (blocker) =>
                blockerKey(blocker) === blockerKey(authorization.blocker),
            ) ||
            authorizationKeys.has(blockerKey(authorization.blocker))
          ) {
            return false;
          }
          authorizationKeys.add(blockerKey(authorization.blocker));
          if (authorization.kind === "row-close") {
            const row = ledger.rows.find(
              (candidate) => candidate.rowId === authorization.rowId,
            );
            if (
              row === undefined ||
              rowPreparationError(row, false) !== undefined ||
              !rowCloseAuthorizationValid(ledger, episode, authorization)
            ) {
              return false;
            }
          } else if (
            authorization.kind !== "manual" ||
            !validProvenance(authorization.provenance) ||
            !validTime(authorization.observedAt)
          ) {
            return false;
          } else if (authorization.blocker.kind === "ledger-row") {
            const row = ledger.rows.find(
              (candidate) => candidate.rowId === authorization.blocker.identity,
            );
            const matchingConfirmations = episode.events.filter(
              (event) =>
                event.kind === "manual-cleanup-confirmed" &&
                event.blocker !== undefined &&
                validBlockerKind(event.blocker) &&
                blockerKey(event.blocker) ===
                  blockerKey(authorization.blocker) &&
                event.provenance === authorization.provenance &&
                event.observedAt === authorization.observedAt,
            );
            const confirmation = matchingConfirmations[0];
            const historicalRow =
              confirmation === undefined || row === undefined
                ? undefined
                : rowBeforeOrder(row, confirmation.order);
            if (
              matchingConfirmations.length !== 1 ||
              historicalRow === undefined ||
              rowPreparationError(historicalRow, true) !== undefined
            ) {
              return false;
            }
          }
        }
        const manualAuthorizations = episode.authorizations.filter(
          (authorization) => authorization.kind === "manual",
        );
        const manualEvents = episode.events.filter(
          (event) => event.kind === "manual-cleanup-confirmed",
        );
        const reconstructionEvent = episode.events.find(
          (event) => event.kind === "recovery-state-reconstructed",
        );
        if (
          manualEvents.length !== manualAuthorizations.length ||
          new Set(
            manualEvents.map((event) =>
              event.blocker === undefined
                ? "missing"
                : blockerKey(event.blocker),
            ),
          ).size !== manualEvents.length ||
          manualEvents.some(
            (event) =>
              event.blocker === undefined ||
              !validBlockerKind(event.blocker) ||
              !sanitizedIdentity(event.blocker.identity) ||
              event.provenance === undefined ||
              event.observedAt === undefined ||
              !manualAuthorizations.some(
                (authorization) =>
                  blockerKey(authorization.blocker) ===
                    blockerKey(event.blocker as BlockerRef) &&
                  authorization.kind === "manual" &&
                  authorization.provenance === event.provenance &&
                  authorization.observedAt === event.observedAt,
              ),
          ) ||
          (reconstructionEvent !== undefined &&
            manualEvents.some(
              (event) => event.order >= reconstructionEvent.order,
            ))
        ) {
          return false;
        }
        const structuralEvents = episode.events.filter(
          (event) => event.kind !== "manual-cleanup-confirmed",
        );
        if (
          structuralEvents.some(
            (event) =>
              event.blocker !== undefined ||
              event.provenance !== undefined ||
              event.observedAt !== undefined,
          )
        ) {
          return false;
        }
        const structuralKinds = structuralEvents.map((event) => event.kind);
        const fullAuthorization =
          episode.authorizations.length === episode.snapshot.length;
        const expectedByState: Record<
          Episode["state"],
          EpisodeEvent["kind"][]
        > = {
          authorizing: ["slot-recovery-started"],
          ready: ["slot-recovery-started", "recovery-state-reconstructed"],
          "retry-dispatched": [
            "slot-recovery-started",
            "recovery-state-reconstructed",
            "slot-retry-dispatched",
          ],
          "retry-succeeded": [
            "slot-recovery-started",
            "recovery-state-reconstructed",
            "slot-retry-dispatched",
            "slot-retry-succeeded",
          ],
          "retry-failed": [
            "slot-recovery-started",
            "recovery-state-reconstructed",
            "slot-retry-dispatched",
            "slot-retry-failed",
          ],
        };
        const expectedStructuralKinds = expectedByState[episode.state];
        if (
          expectedStructuralKinds === undefined ||
          structuralKinds.join(",") !== expectedStructuralKinds.join(",") ||
          (episode.state !== "authorizing" && !fullAuthorization) ||
          (episode.state === "retry-failed"
            ? !validEscalation(episode.escalation, episode.snapshot)
            : episode.escalation !== undefined)
        ) {
          return false;
        }
        dispatchCount += structuralKinds.filter(
          (kind) => kind === "slot-retry-dispatched",
        ).length;
      }
      return dispatchCount === ledger.retryDispatches;
    };
    const replaceEpisode = (
      ledger: Ledger,
      replacement: Episode,
      order = ledger.order + 1,
      retryIncrement = 0,
    ): Ledger =>
      freezeLedger({
        ...ledger,
        order,
        episodes: ledger.episodes.map((episode) =>
          episode.episodeId === replacement.episodeId ? replacement : episode,
        ),
        retryDispatches: ledger.retryDispatches + retryIncrement,
      });

    function fold(ledgerInput: unknown, operationInput: unknown): FoldResult {
      if (!validLedgerEnvelope(ledgerInput)) {
        return failUnknown(ledgerInput, "invalid-ledger-shape");
      }
      const ledger = ledgerInput;
      if (!ledgerConsistent(ledger)) {
        return failUnknown(ledgerInput, "inconsistent-recovery-ledger");
      }
      if (!validOperationEnvelope(operationInput)) {
        return {
          input: operationInput,
          ledger,
          error: "invalid-operation-shape",
        };
      }
      const operation = operationInput;

      if (operation.kind === "start") {
        if (!sanitizedIdentity(operation.originId)) {
          return fail(ledger, "invalid-recovery-origin");
        }
        if (!sanitizedIdentity(operation.episodeId)) {
          return fail(ledger, "invalid-recovery-episode");
        }
        const existing = ledger.originEpisodes.find(
          (entry) => entry.originId === operation.originId,
        );
        if (existing !== undefined) {
          const episode = ledger.episodes.find(
            (candidate) => candidate.episodeId === existing.episodeId,
          );
          return fail(
            ledger,
            episode?.state === "retry-failed"
              ? "terminal-failure-origin-closed"
              : "recovery-origin-already-used",
          );
        }
        if (
          ledger.episodes.some(
            (episode) => episode.episodeId === operation.episodeId,
          )
        ) {
          return fail(ledger, "recovery-episode-already-used");
        }
        if (operation.observedBlockers.length === 0) {
          return fail(ledger, "empty-observed-blocker-inventory");
        }
        if (operation.snapshot.length === 0) {
          return fail(ledger, "empty-blocker-snapshot");
        }
        if (
          operation.observedBlockers.some(
            (blocker) => !validBlockerKind(blocker),
          )
        ) {
          return fail(ledger, "invalid-observed-blocker-kind");
        }
        if (operation.snapshot.some((blocker) => !validBlockerKind(blocker))) {
          return fail(ledger, "invalid-snapshot-blocker-kind");
        }
        if (
          operation.observedBlockers.some(
            (blocker) => !sanitizedIdentity(blocker.identity),
          )
        ) {
          return fail(ledger, "unsanitized-observed-blocker");
        }
        if (
          operation.snapshot.some(
            (blocker) => !sanitizedIdentity(blocker.identity),
          )
        ) {
          return fail(ledger, "unsanitized-snapshot-blocker");
        }
        const observedKeys = operation.observedBlockers.map(blockerKey);
        const snapshotKeys = operation.snapshot.map(blockerKey);
        if (new Set(observedKeys).size !== observedKeys.length) {
          return fail(ledger, "duplicate-observed-blocker");
        }
        if (new Set(snapshotKeys).size !== snapshotKeys.length) {
          return fail(ledger, "duplicate-snapshot-blocker");
        }
        for (const blocker of operation.observedBlockers) {
          if (blocker.kind !== "ledger-row") continue;
          const row = ledger.rows.find(
            (candidate) => candidate.rowId === blocker.identity,
          );
          if (row === undefined) {
            return fail(ledger, "observed-ledger-row-missing");
          }
        }
        for (const blocker of operation.observedBlockers) {
          if (blocker.kind !== "inventory-only") continue;
          if (
            ledger.rows.some(
              (row) => row.inventoryEvidenceId === blocker.identity,
            )
          ) {
            return fail(ledger, "attached-inventory-double-counted");
          }
        }
        if (
          observedKeys.length !== snapshotKeys.length ||
          observedKeys.some((key) => !snapshotKeys.includes(key)) ||
          snapshotKeys.some((key) => !observedKeys.includes(key))
        ) {
          return fail(ledger, "observed-snapshot-membership-or-tag-mismatch");
        }
        const episode: Episode = {
          originId: operation.originId,
          episodeId: operation.episodeId,
          snapshot: operation.snapshot,
          state: "authorizing",
          events: [{ kind: "slot-recovery-started", order: ledger.order + 1 }],
          authorizations: [],
        };
        return {
          input: ledger,
          ledger: freezeLedger({
            ...ledger,
            order: ledger.order + 1,
            episodes: [...ledger.episodes, episode],
            originEpisodes: [
              ...ledger.originEpisodes,
              {
                originId: operation.originId,
                episodeId: operation.episodeId,
              },
            ],
          }),
        };
      }

      if (operation.kind === "record-row-close") {
        const rowMatches = ledger.rows.filter(
          (candidate) => candidate.rowId === operation.rowId,
        );
        const row = rowMatches.length === 1 ? rowMatches[0] : undefined;
        if (
          row?.projection === "closed=yes" ||
          row?.history.some((event) => event.kind === "close-succeeded")
        ) {
          return fail(ledger, "post-close-success-row-event");
        }
        if (
          row === undefined ||
          row.sessionId !== operation.sessionId ||
          !sanitizedIdentity(operation.attemptEventId) ||
          !sanitizedIdentity(operation.successEventId) ||
          operation.attemptEventId === operation.successEventId
        ) {
          return fail(ledger, "invalid-row-close-record");
        }
        const preparationError = rowPreparationError(row, false);
        if (preparationError !== undefined) {
          return fail(ledger, preparationError);
        }
        if (
          ledger.rows.some((candidate) =>
            candidate.history.some(
              (event) =>
                event.eventId === operation.attemptEventId ||
                event.eventId === operation.successEventId,
            ),
          )
        ) {
          return fail(ledger, "duplicate-row-event-identity");
        }
        const nextRows = ledger.rows.map((candidate) =>
          candidate.rowId === row.rowId
            ? {
                ...candidate,
                history: [
                  ...candidate.history,
                  {
                    eventId: operation.attemptEventId,
                    kind: "close-attempted" as const,
                    order: ledger.order + 1,
                    sessionId: operation.sessionId,
                  },
                  {
                    eventId: operation.successEventId,
                    kind: "close-succeeded" as const,
                    order: ledger.order + 2,
                    sessionId: operation.sessionId,
                  },
                ],
                projection: "closed=yes" as const,
              }
            : candidate,
        );
        return {
          input: ledger,
          ledger: freezeLedger({
            ...ledger,
            order: ledger.order + 2,
            rows: nextRows,
          }),
        };
      }

      const episode = ledger.episodes.find(
        (candidate) => candidate.episodeId === operation.episodeId,
      );
      if (episode === undefined) {
        return fail(ledger, "recovery-episode-not-found");
      }

      if (operation.kind === "authorize") {
        const evidence = operation.evidence as unknown;
        if (episode.state !== "authorizing") {
          return fail(ledger, "episode-not-authorizing");
        }
        if (!validAuthorizationKind(evidence)) {
          return fail(ledger, "invalid-authorization-kind");
        }
        const allowedEvidenceKeys =
          evidence.kind === "row-close"
            ? [
                "kind",
                "episodeId",
                "blocker",
                "rowId",
                "rowEventId",
                "sessionId",
              ]
            : ["kind", "episodeId", "blocker", "provenance", "observedAt"];
        if (
          !Object.keys(evidence).every((key) =>
            allowedEvidenceKeys.includes(key),
          )
        ) {
          return fail(ledger, "invalid-authorization-shape");
        }
        if (evidence.episodeId !== episode.episodeId) {
          return fail(ledger, "stale-episode-evidence");
        }
        if (
          !validBlockerKind(evidence.blocker) ||
          !sanitizedIdentity(evidence.blocker.identity)
        ) {
          return fail(ledger, "invalid-authorization-blocker");
        }
        const evidenceKey = blockerKey(evidence.blocker);
        const blocker = episode.snapshot.find(
          (candidate) => blockerKey(candidate) === evidenceKey,
        );
        if (blocker === undefined) {
          return fail(
            ledger,
            episode.snapshot.some(
              (candidate) => candidate.identity === evidence.blocker.identity,
            )
              ? "cross-kind-evidence"
              : "non-snapshot-evidence",
          );
        }
        if (blocker.kind === "ledger-row") {
          const rowMatches = ledger.rows.filter(
            (candidate) => candidate.rowId === blocker.identity,
          );
          if (rowMatches.length !== 1) {
            return fail(ledger, "row-preparation-identity");
          }
          const preparationError = rowPreparationError(
            rowMatches[0],
            evidence.kind === "manual",
          );
          if (preparationError !== undefined) {
            return fail(ledger, preparationError);
          }
        }
        if (
          evidence.kind === "row-close" &&
          blocker.kind === "inventory-only"
        ) {
          return fail(ledger, "inventory-close-evidence");
        }
        if (evidence.kind === "row-close") {
          if (
            !sanitizedIdentity(evidence.rowId) ||
            !sanitizedIdentity(evidence.rowEventId) ||
            !sanitizedIdentity(evidence.sessionId)
          ) {
            return fail(ledger, "invalid-row-close-evidence-shape");
          }
          const row = ledger.rows.find(
            (candidate) => candidate.rowId === evidence.rowId,
          );
          if (
            blocker.kind !== "ledger-row" ||
            evidence.rowId !== blocker.identity
          ) {
            return fail(ledger, "cross-kind-evidence");
          }
          if (row === undefined || row.sessionId !== evidence.sessionId) {
            return fail(ledger, "row-close-session-ownership");
          }
          const successIndex = row.history.findIndex(
            (event) =>
              event.eventId === evidence.rowEventId &&
              event.kind === "close-succeeded",
          );
          if (successIndex < 0) {
            return fail(ledger, "row-close-event-missing");
          }
          const success = row.history[successIndex];
          const attempt = row.history[successIndex - 1];
          if (
            success === undefined ||
            success.sessionId !== row.sessionId ||
            success.order <= episode.events[0].order ||
            attempt?.kind !== "close-attempted" ||
            attempt.sessionId !== row.sessionId ||
            attempt.order >= success.order ||
            row.projection !== "closed=yes"
          ) {
            return fail(ledger, "contradictory-or-stale-row-close-history");
          }
        } else {
          if (!validProvenance(evidence.provenance)) {
            return fail(ledger, "unsafe-manual-provenance");
          }
          if (!validTime(evidence.observedAt)) {
            return fail(ledger, "invalid-manual-observation-time");
          }
        }
        if (
          episode.authorizations.some(
            (authorization) =>
              blockerKey(authorization.blocker) === evidenceKey,
          )
        ) {
          return fail(ledger, "blocker-already-authorized");
        }
        const authorization = freezeAuthorization(evidence);
        const event =
          authorization.kind === "manual"
            ? [
                freezeEvent({
                  kind: "manual-cleanup-confirmed",
                  order: ledger.order + 1,
                  blocker,
                  provenance: authorization.provenance,
                  observedAt: authorization.observedAt,
                }),
              ]
            : [];
        return {
          input: ledger,
          ledger: replaceEpisode(ledger, {
            ...episode,
            events: [...episode.events, ...event],
            authorizations: [...episode.authorizations, authorization],
          }),
        };
      }

      if (operation.kind === "reconstruct") {
        if (episode.state !== "authorizing") {
          return fail(
            ledger,
            episode.state === "retry-dispatched" ||
              episode.state === "retry-succeeded" ||
              episode.state === "retry-failed"
              ? "episode-consumed-or-terminal"
              : "episode-not-authorizing",
          );
        }
        if (episode.authorizations.length !== episode.snapshot.length) {
          return fail(ledger, "blocker-authorization-incomplete");
        }
        if (
          operation.lifecycleAnchor.trim().length === 0 ||
          operation.repositoryAnchor.trim().length === 0
        ) {
          return fail(ledger, "reconstruction-anchors-missing");
        }
        return {
          input: ledger,
          ledger: replaceEpisode(ledger, {
            ...episode,
            state: "ready",
            events: [
              ...episode.events,
              {
                kind: "recovery-state-reconstructed",
                order: ledger.order + 1,
              },
            ],
          }),
        };
      }

      if (operation.kind === "dispatch") {
        if (episode.state !== "ready") {
          return fail(
            ledger,
            episode.state === "authorizing"
              ? "reconstruction-required"
              : "retry-already-dispatched-or-terminal",
          );
        }
        return {
          input: ledger,
          ledger: replaceEpisode(
            ledger,
            {
              ...episode,
              state: "retry-dispatched",
              events: [
                ...episode.events,
                { kind: "slot-retry-dispatched", order: ledger.order + 1 },
              ],
            },
            ledger.order + 1,
            1,
          ),
        };
      }

      if (operation.result !== "succeeded" && operation.result !== "failed") {
        return fail(ledger, "invalid-retry-result-kind");
      }
      if (episode.state !== "retry-dispatched") {
        return fail(
          ledger,
          episode.state === "retry-succeeded" ||
            episode.state === "retry-failed"
            ? "retry-result-already-recorded"
            : "retry-result-without-dispatch",
        );
      }
      if (
        operation.result === "failed" &&
        !validEscalation(operation.escalation, episode.snapshot)
      ) {
        return fail(ledger, "invalid-retry-failure-escalation");
      }
      if (
        operation.result === "succeeded" &&
        operation.escalation !== undefined
      ) {
        return fail(ledger, "success-escalation-forbidden");
      }
      return {
        input: ledger,
        ledger: replaceEpisode(ledger, {
          ...episode,
          state:
            operation.result === "succeeded"
              ? "retry-succeeded"
              : "retry-failed",
          events: [
            ...episode.events,
            {
              kind:
                operation.result === "succeeded"
                  ? "slot-retry-succeeded"
                  : "slot-retry-failed",
              order: ledger.order + 1,
            },
          ],
          ...(operation.result === "failed"
            ? {
                escalation: freezeEscalation(
                  operation.escalation as RetryFailureEscalation,
                ),
              }
            : {}),
        }),
      };
    }

    const row = (rowId: string, sessionId: string): RowRecord => ({
      rowId,
      identityState: "stable",
      sessionId,
      ...(rowId === "row-1"
        ? { inventoryEvidenceId: "attached-inventory" }
        : {}),
      history: [],
      preparationHistory: [
        { kind: "operational-state", order: 1, state: "completed" },
        {
          kind: "required-state-captured",
          order: 2,
          evidence: "row state captured",
        },
      ],
      projection: "closed=no",
    });
    const emptyLedger = (): Ledger => {
      const failedManualRow: RowRecord = {
        ...row("manual-failed-row", "session-manual-failed"),
        history: [
          {
            eventId: "manual-failed-attempt",
            kind: "close-attempted",
            order: 3,
            sessionId: "session-manual-failed",
          },
          {
            eventId: "manual-failed-result",
            kind: "close-failed",
            order: 4,
            sessionId: "session-manual-failed",
          },
        ],
      };
      const unavailableManualRow: RowRecord = {
        ...row("manual-unavailable-row", "session-manual-unavailable"),
        history: [
          {
            eventId: "manual-unavailable-result",
            kind: "closure-unavailable",
            order: 3,
            sessionId: "session-manual-unavailable",
            reason: "no usable close operation",
          },
        ],
        projection: "close-unavailable",
      };
      return freezeLedger({
        order: 4,
        rows: [
          row("row-1", "session-1"),
          row("same", "session-same"),
          failedManualRow,
          unavailableManualRow,
        ],
        episodes: [],
        originEpisodes: [],
        retryDispatches: 0,
      });
    };
    const ledgerRow = (identity = "row-1"): BlockerRef => ({
      kind: "ledger-row",
      identity,
    });
    const inventory = (identity = "inventory-1"): BlockerRef => ({
      kind: "inventory-only",
      identity,
    });
    const start = (
      originId: string,
      episodeId: string,
      blockers: BlockerRef[],
      observedBlockers = blockers,
    ): Extract<Operation, { kind: "start" }> => ({
      kind: "start",
      originId,
      episodeId,
      observedBlockers,
      snapshot: blockers,
    });
    const manual = (
      episodeId: string,
      blocker: BlockerRef,
      provenance = "operator UI",
    ): Extract<Authorization, { kind: "manual" }> => ({
      kind: "manual",
      episodeId,
      blocker,
      provenance,
      observedAt: "2026-07-12T00:00:00Z",
    });
    const closeEvidence = (
      episodeId: string,
      blocker = ledgerRow(),
      overrides: Partial<Extract<Authorization, { kind: "row-close" }>> = {},
    ): Extract<Authorization, { kind: "row-close" }> => ({
      kind: "row-close",
      episodeId,
      blocker,
      rowId: blocker.identity,
      rowEventId: `close-success-${blocker.identity}`,
      sessionId: blocker.identity === "same" ? "session-same" : "session-1",
      ...overrides,
    });
    const apply = (ledger: Ledger, operation: Operation): Ledger => {
      const result = fold(ledger, operation);
      expect(result.error).toBeUndefined();
      expect(result.ledger).toBeDefined();
      return result.ledger as Ledger;
    };
    const prepare = (
      blockers: BlockerRef[],
      originId = "origin-1",
      episodeId = "episode-1",
    ): Ledger => {
      let ledger = apply(
        emptyLedger(),
        start(originId, episodeId, blockers, blockers),
      );
      for (const blocker of blockers) {
        if (blocker.kind === "ledger-row") {
          ledger = apply(ledger, {
            kind: "record-row-close",
            rowId: blocker.identity,
            sessionId:
              blocker.identity === "same" ? "session-same" : "session-1",
            attemptEventId: `close-attempt-${blocker.identity}`,
            successEventId: `close-success-${blocker.identity}`,
          });
          ledger = apply(ledger, {
            kind: "authorize",
            episodeId,
            evidence: closeEvidence(episodeId, blocker),
          });
        } else {
          ledger = apply(ledger, {
            kind: "authorize",
            episodeId,
            evidence: manual(episodeId, blocker),
          });
        }
      }
      return ledger;
    };
    const reconstruct = (episodeId: string): Operation => ({
      kind: "reconstruct",
      episodeId,
      lifecycleAnchor: "captured lifecycle ledger",
      repositoryAnchor: "main@abc123",
    });
    const dispatch = (episodeId: string): Operation => ({
      kind: "dispatch",
      episodeId,
    });
    const result = (
      episodeId: string,
      retryResult: "succeeded" | "failed",
    ): Operation => ({
      kind: "result",
      episodeId,
      result: retryResult,
      ...(retryResult === "failed"
        ? {
            escalation: {
              inventory: "unavailable" as const,
              remainingBlockers: [],
            },
          }
        : {}),
    });
    const expectRejected = (
      ledger: Ledger,
      operation: Operation,
      error: string,
    ): void => {
      const before = ledger;
      const folded = fold(ledger, operation);
      expect(folded.error).toBe(error);
      expect(folded.ledger).toBe(before);
    };
    const expectInvalidLedger = (input: unknown): void => {
      const folded = fold(input, dispatch("episode-1"));
      expect(folded.error).toBe("inconsistent-recovery-ledger");
      expect(folded.input).toBe(input);
      expect(folded.ledger).toBeUndefined();
    };
    for (const malformedLedger of [
      null,
      7,
      {},
      { ...emptyLedger(), rows: null },
      { ...emptyLedger(), extra: true },
      { ...emptyLedger(), rows: [null] },
      {
        ...emptyLedger(),
        episodes: [null],
        originEpisodes: [{ originId: "origin-1", episodeId: "episode-1" }],
      },
    ]) {
      expect(() => fold(malformedLedger, dispatch("episode-1"))).not.toThrow();
      const folded = fold(malformedLedger, dispatch("episode-1"));
      expect(folded.error).toBe("invalid-ledger-shape");
      expect(folded.input).toBe(malformedLedger);
      expect(folded.ledger).toBeUndefined();
    }
    const validBoundaryLedger = emptyLedger();
    for (const malformedOperation of [
      null,
      {},
      { ...start("origin-x", "episode-x", [inventory()]), extra: true },
      {
        kind: "start",
        originId: "origin-x",
        episodeId: "episode-x",
        observedBlockers: null,
        snapshot: [],
      },
      {
        kind: "record-row-close",
        rowId: "row-1",
        sessionId: 7,
        attemptEventId: "attempt-x",
        successEventId: "success-x",
      },
      { kind: "authorize", episodeId: "episode-x", evidence: null },
      {
        kind: "reconstruct",
        episodeId: "episode-x",
        lifecycleAnchor: 7,
        repositoryAnchor: "main",
      },
      { kind: "dispatch", episodeId: "episode-x", extra: true },
      { kind: "result", episodeId: "episode-x", result: 7 },
    ]) {
      expect(() => fold(validBoundaryLedger, malformedOperation)).not.toThrow();
      const folded = fold(validBoundaryLedger, malformedOperation);
      expect(folded.error).toBe("invalid-operation-shape");
      expect(folded.input).toBe(malformedOperation);
      expect(folded.ledger).toBe(validBoundaryLedger);
    }
    const forgeRows = (
      ledger: Ledger,
      mutate: (rows: RowRecord[]) => RowRecord[],
      order = ledger.order,
    ): Ledger =>
      freezeLedger({
        ...ledger,
        order,
        rows: mutate(ledger.rows.map((row) => ({ ...row }))),
      });
    expectInvalidLedger(
      forgeRows(emptyLedger(), (rows) =>
        rows.map((row) =>
          row.rowId === "same" ? { ...row, rowId: "row-1" } : row,
        ),
      ),
    );
    expectInvalidLedger(
      forgeRows(emptyLedger(), (rows) =>
        rows.map((row) =>
          row.rowId === "same" ? { ...row, sessionId: "session-1" } : row,
        ),
      ),
    );
    expectInvalidLedger(
      forgeRows(emptyLedger(), (rows) =>
        rows.map((row) =>
          row.rowId === "row-1" ? { ...row, projection: "closed=yes" } : row,
        ),
      ),
    );
    for (const forgedRow of [
      {
        history: [
          {
            eventId: "unpaired-failed",
            kind: "close-failed",
            order: 3,
            sessionId: "session-1",
          },
        ],
        projection: "closed=no" as const,
      },
      {
        history: [
          {
            eventId: "missing-unavailable-reason",
            kind: "closure-unavailable",
            order: 3,
            sessionId: "session-1",
          } as unknown as RowEvent,
        ],
        projection: "close-unavailable" as const,
      },
      {
        history: [
          {
            eventId: "mismatched-unavailable-projection",
            kind: "closure-unavailable",
            order: 3,
            sessionId: "session-1",
            reason: "no usable close operation",
          },
        ],
        projection: "closed=no" as const,
      },
    ] as Array<Pick<RowRecord, "history" | "projection">>) {
      expectInvalidLedger(
        forgeRows(emptyLedger(), (rows) =>
          rows.map((row) =>
            row.rowId === "row-1" ? { ...row, ...forgedRow } : row,
          ),
        ),
      );
    }
    const closedOnce = apply(emptyLedger(), {
      kind: "record-row-close",
      rowId: "row-1",
      sessionId: "session-1",
      attemptEventId: "integrity-attempt-1",
      successEventId: "integrity-success-1",
    });
    const mutateClosedHistory = (
      mutate: (history: RowEvent[]) => RowEvent[],
      order = closedOnce.order,
    ): Ledger =>
      forgeRows(
        closedOnce,
        (rows) =>
          rows.map((row) =>
            row.rowId === "row-1"
              ? { ...row, history: mutate([...row.history]) }
              : row,
          ),
        order,
      );
    expectInvalidLedger(
      mutateClosedHistory((history) => [
        { ...history[0], extra: true } as unknown as RowEvent,
        history[1],
      ]),
    );
    expectInvalidLedger(
      mutateClosedHistory((history) => [
        history[0],
        { ...history[1], eventId: history[0].eventId },
      ]),
    );
    expectInvalidLedger(
      mutateClosedHistory((history) => [
        history[0],
        { ...history[1], order: history[0].order },
      ]),
    );
    expectInvalidLedger(
      mutateClosedHistory((history) => [
        history[0],
        { ...history[1], sessionId: "session-other" },
      ]),
    );
    expectInvalidLedger(
      mutateClosedHistory((history) => [
        history[0],
        { ...history[1], kind: "close-attempted" },
      ]),
    );
    expectInvalidLedger(
      mutateClosedHistory(
        (history) => [
          ...history,
          {
            eventId: "integrity-late-event",
            kind: "close-attempted",
            order: closedOnce.order + 1,
            sessionId: "session-1",
          },
        ],
        closedOnce.order + 1,
      ),
    );
    expectInvalidLedger(
      forgeRows(
        closedOnce,
        (rows) =>
          rows.map((row) =>
            row.rowId === "row-1"
              ? {
                  ...row,
                  preparationHistory: [
                    ...row.preparationHistory,
                    {
                      kind: "operational-state" as const,
                      order: closedOnce.order + 1,
                      state: "completed",
                    },
                  ],
                }
              : row,
          ),
        closedOnce.order + 1,
      ),
    );
    expectInvalidLedger(
      forgeRows(closedOnce, (rows) =>
        rows.map((row) =>
          row.rowId === "row-1"
            ? {
                ...row,
                preparationHistory: row.preparationHistory.map((event) =>
                  event.kind === "required-state-captured"
                    ? { ...event, order: closedOnce.order - 1 }
                    : event,
                ),
              }
            : row,
        ),
      ),
    );
    const unavailableBeforeCapture = forgeRows(
      emptyLedger(),
      (rows) =>
        rows.map((row) =>
          row.rowId === "manual-unavailable-row"
            ? {
                ...row,
                preparationHistory: row.preparationHistory.map((event) =>
                  event.kind === "required-state-captured"
                    ? { ...event, order: 4 }
                    : event,
                ),
              }
            : row,
        ),
      4,
    );
    expectInvalidLedger(unavailableBeforeCapture);

    const reevaluatedUnavailable = forgeRows(
      emptyLedger(),
      (rows) =>
        rows.map((row) =>
          row.rowId === "manual-unavailable-row"
            ? {
                ...row,
                preparationHistory: [
                  ...row.preparationHistory,
                  {
                    kind: "operational-state" as const,
                    order: 4,
                    state: "completed",
                  },
                  {
                    kind: "required-state-captured" as const,
                    order: 5,
                    evidence: "state recaptured before reevaluation",
                  },
                ],
                history: [
                  ...row.history,
                  {
                    eventId: "manual-unavailable-reevaluated",
                    kind: "closure-unavailable" as const,
                    order: 6,
                    sessionId: "session-manual-unavailable",
                    reason: "close operation still unavailable",
                  },
                ],
              }
            : row,
        ),
      6,
    );
    expect(
      fold(
        reevaluatedUnavailable,
        start("origin-reevaluated", "episode-reevaluated", [inventory()]),
      ).error,
    ).toBeUndefined();
    const closedTwice = apply(closedOnce, {
      kind: "record-row-close",
      rowId: "same",
      sessionId: "session-same",
      attemptEventId: "integrity-attempt-2",
      successEventId: "integrity-success-2",
    });
    expectInvalidLedger(
      forgeRows(closedTwice, (rows) =>
        rows.map((row) =>
          row.rowId === "same"
            ? {
                ...row,
                history: row.history.map((event, index) =>
                  index === 0
                    ? { ...event, eventId: "integrity-attempt-1" }
                    : event,
                ),
              }
            : row,
        ),
      ),
    );
    const finish = (
      blockers: BlockerRef[],
      originId = "origin-1",
      episodeId = "episode-1",
      retryResult: "succeeded" | "failed" = "succeeded",
    ): Ledger => {
      let ledger = prepare(blockers, originId, episodeId);
      const rowsAfterCleanup = ledger.rows;
      ledger = apply(ledger, reconstruct(episodeId));
      ledger = apply(ledger, dispatch(episodeId));
      ledger = apply(ledger, result(episodeId, retryResult));
      expect(ledger.rows).toEqual(rowsAfterCleanup);
      return ledger;
    };

    for (const blockers of [
      [ledgerRow()],
      [inventory()],
      [ledgerRow(), inventory()],
    ]) {
      const ledger = finish(blockers);
      expect(ledger.episodes[0]?.state).toBe("retry-succeeded");
      expect(ledger.retryDispatches).toBe(1);
      expect(ledger.rows.flatMap((candidate) => candidate.history)).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "slot-recovery-started" }),
          expect.objectContaining({ kind: "manual-cleanup-confirmed" }),
        ]),
      );
    }
    const mixed = finish([ledgerRow(), inventory()]);
    expect(mixed.episodes[0]?.events.map((event) => event.kind)).toEqual([
      "slot-recovery-started",
      "manual-cleanup-confirmed",
      "recovery-state-reconstructed",
      "slot-retry-dispatched",
      "slot-retry-succeeded",
    ]);
    expect(
      mixed.episodes[0]?.events.find(
        (event) => event.kind === "manual-cleanup-confirmed",
      ),
    ).toMatchObject({
      blocker: inventory(),
      provenance: "operator UI",
      observedAt: "2026-07-12T00:00:00Z",
    });
    const equal = finish(
      [ledgerRow("same"), inventory("same")],
      "origin-equal",
      "episode-equal",
    );
    expect(equal.episodes[0]?.authorizations).toHaveLength(2);
    expect(finish([inventory()]).rows).toEqual(emptyLedger().rows);

    let mixedBoundary = apply(
      emptyLedger(),
      start("origin-boundary", "episode-boundary", [ledgerRow(), inventory()]),
    );
    mixedBoundary = apply(mixedBoundary, {
      kind: "record-row-close",
      rowId: "row-1",
      sessionId: "session-1",
      attemptEventId: "boundary-close-attempt",
      successEventId: "boundary-close-success",
    });
    const rowsAfterCleanup = mixedBoundary.rows;
    mixedBoundary = apply(mixedBoundary, {
      kind: "authorize",
      episodeId: "episode-boundary",
      evidence: closeEvidence("episode-boundary", ledgerRow(), {
        rowEventId: "boundary-close-success",
      }),
    });
    mixedBoundary = apply(mixedBoundary, {
      kind: "authorize",
      episodeId: "episode-boundary",
      evidence: manual("episode-boundary", inventory()),
    });
    mixedBoundary = apply(mixedBoundary, reconstruct("episode-boundary"));
    mixedBoundary = apply(mixedBoundary, dispatch("episode-boundary"));
    mixedBoundary = apply(
      mixedBoundary,
      result("episode-boundary", "succeeded"),
    );
    expect(mixedBoundary.rows).toEqual(rowsAfterCleanup);

    const failed = finish(
      [inventory()],
      "origin-failed",
      "episode-failed",
      "failed",
    );
    expect(failed.episodes[0]).toMatchObject({
      state: "retry-failed",
      escalation: { inventory: "unavailable", remainingBlockers: [] },
    });
    expect(
      apply(
        failed,
        start("origin-distinct", "episode-distinct", [inventory()]),
      ).episodes.at(-1)?.state,
    ).toBe("authorizing");

    const baseStart = start("origin-1", "episode-1", [inventory()]);
    const unknownTag = {
      kind: "unknown",
      identity: "inventory-1",
    } as unknown as BlockerRef;
    const missingTag = {
      identity: "inventory-1",
    } as unknown as BlockerRef;
    expectRejected(
      emptyLedger(),
      {
        ...baseStart,
        observedBlockers: [unknownTag],
      },
      "invalid-observed-blocker-kind",
    );
    expectRejected(
      emptyLedger(),
      {
        ...baseStart,
        observedBlockers: [missingTag],
      },
      "invalid-observed-blocker-kind",
    );
    expectRejected(
      emptyLedger(),
      { ...baseStart, snapshot: [unknownTag] },
      "invalid-snapshot-blocker-kind",
    );
    const invalidIdentityBlockers = [
      { kind: "inventory-only" },
      { kind: "inventory-only", identity: null },
      { kind: "inventory-only", identity: 42 },
    ] as unknown as BlockerRef[];
    for (const invalidIdentity of invalidIdentityBlockers) {
      expectRejected(
        emptyLedger(),
        { ...baseStart, observedBlockers: [invalidIdentity] },
        "unsanitized-observed-blocker",
      );
      expectRejected(
        emptyLedger(),
        { ...baseStart, snapshot: [invalidIdentity] },
        "unsanitized-snapshot-blocker",
      );
    }
    expectRejected(
      emptyLedger(),
      { ...baseStart, originId: "unsafe origin" },
      "invalid-recovery-origin",
    );
    expectRejected(
      emptyLedger(),
      { ...baseStart, episodeId: "unsafe episode" },
      "invalid-recovery-episode",
    );
    expectRejected(
      emptyLedger(),
      { ...baseStart, snapshot: [] },
      "empty-blocker-snapshot",
    );
    expectRejected(
      emptyLedger(),
      { ...baseStart, observedBlockers: [] },
      "empty-observed-blocker-inventory",
    );
    expectRejected(
      emptyLedger(),
      { ...baseStart, snapshot: [inventory(), inventory()] },
      "duplicate-snapshot-blocker",
    );
    expectRejected(
      emptyLedger(),
      { ...baseStart, observedBlockers: [inventory(), inventory()] },
      "duplicate-observed-blocker",
    );
    expectRejected(
      emptyLedger(),
      {
        ...baseStart,
        snapshot: [inventory("unsafe identity")],
      },
      "unsanitized-snapshot-blocker",
    );
    expectRejected(
      emptyLedger(),
      {
        ...baseStart,
        observedBlockers: [inventory("unsafe identity")],
      },
      "unsanitized-observed-blocker",
    );
    const validRetagStart = start("origin-retag", "episode-retag", [
      ledgerRow(),
    ]);
    expectRejected(
      emptyLedger(),
      {
        ...validRetagStart,
        snapshot: [{ ...validRetagStart.snapshot[0], kind: "inventory-only" }],
      },
      "observed-snapshot-membership-or-tag-mismatch",
    );
    expectRejected(
      emptyLedger(),
      start(
        "origin-omit",
        "episode-omit",
        [ledgerRow()],
        [ledgerRow(), inventory()],
      ),
      "observed-snapshot-membership-or-tag-mismatch",
    );
    expectRejected(
      emptyLedger(),
      start("origin-attached", "episode-attached", [
        ledgerRow(),
        inventory("attached-inventory"),
      ]),
      "attached-inventory-double-counted",
    );
    expectRejected(
      emptyLedger(),
      start("origin-missing-row", "episode-missing-row", [
        ledgerRow("missing-row"),
      ]),
      "observed-ledger-row-missing",
    );

    const authorizing = apply(
      emptyLedger(),
      start("origin-1", "episode-1", [ledgerRow(), inventory()]),
    );
    for (const malformedNestedLedger of [
      {
        ...authorizing,
        episodes: authorizing.episodes.map((episode) => ({
          ...episode,
          events: [null],
        })),
      },
      {
        ...authorizing,
        episodes: authorizing.episodes.map((episode) => ({
          ...episode,
          authorizations: [null],
        })),
      },
      {
        ...authorizing,
        rows: authorizing.rows.map((row) =>
          row.rowId === "row-1" ? { ...row, preparationHistory: [null] } : row,
        ),
      },
    ]) {
      expect(() =>
        fold(malformedNestedLedger, dispatch("episode-1")),
      ).not.toThrow();
      const folded = fold(malformedNestedLedger, dispatch("episode-1"));
      expect(folded.error).toBe("invalid-ledger-shape");
      expect(folded.input).toBe(malformedNestedLedger);
      expect(folded.ledger).toBeUndefined();
    }
    let preparedManualFailed = apply(
      emptyLedger(),
      start("origin-manual-failed", "episode-manual-failed", [
        ledgerRow("manual-failed-row"),
      ]),
    );
    preparedManualFailed = apply(preparedManualFailed, {
      kind: "authorize",
      episodeId: "episode-manual-failed",
      evidence: manual("episode-manual-failed", ledgerRow("manual-failed-row")),
    });
    expect(preparedManualFailed.episodes[0]?.authorizations).toHaveLength(1);
    let preparedManualUnavailable = apply(
      emptyLedger(),
      start("origin-manual-unavailable", "episode-manual-unavailable", [
        ledgerRow("manual-unavailable-row"),
      ]),
    );
    preparedManualUnavailable = apply(preparedManualUnavailable, {
      kind: "authorize",
      episodeId: "episode-manual-unavailable",
      evidence: manual(
        "episode-manual-unavailable",
        ledgerRow("manual-unavailable-row"),
      ),
    });
    expect(preparedManualUnavailable.episodes[0]?.authorizations).toHaveLength(
      1,
    );
    expect(
      apply(
        preparedManualUnavailable,
        reconstruct("episode-manual-unavailable"),
      ).episodes[0]?.state,
    ).toBe("ready");
    const manualThenAutomaticClose = apply(preparedManualFailed, {
      kind: "record-row-close",
      rowId: "manual-failed-row",
      sessionId: "session-manual-failed",
      attemptEventId: "manual-followup-attempt",
      successEventId: "manual-followup-success",
    });
    const manualThenAutomaticReconstructed = apply(
      manualThenAutomaticClose,
      reconstruct("episode-manual-failed"),
    );
    expect(manualThenAutomaticReconstructed.episodes[0]?.state).toBe("ready");
    expect(
      manualThenAutomaticReconstructed.rows.find(
        (row) => row.rowId === "manual-failed-row",
      )?.projection,
    ).toBe("closed=yes");
    const preparationLedger = (
      history: PreparationEvent[],
      identityState: RowRecord["identityState"] = "stable",
    ): Ledger => {
      const base = emptyLedger();
      return freezeLedger({
        ...base,
        order: Math.max(base.order, history.at(-1)?.order ?? 0),
        rows: base.rows.map((row) =>
          row.rowId === "row-1"
            ? {
                ...row,
                identityState,
                sessionId: identityState === "stable" ? "session-1" : null,
                preparationHistory: history,
              }
            : row,
        ),
      });
    };
    const cleanupPathLedger = (
      preparationHistory: PreparationEvent[],
      history: RowEvent[],
      projection: RowRecord["projection"],
    ): Ledger => {
      const base = emptyLedger();
      return freezeLedger({
        ...base,
        order: Math.max(
          base.order,
          preparationHistory.at(-1)?.order ?? 0,
          history.at(-1)?.order ?? 0,
        ),
        rows: base.rows.map((row) =>
          row.rowId === "row-1"
            ? { ...row, preparationHistory, history, projection }
            : row,
        ),
      });
    };
    const preparationRecordedAfterAttempt = cleanupPathLedger(
      [
        { kind: "operational-state", order: 1, state: "completed" },
        {
          kind: "required-state-captured",
          order: 4,
          evidence: "captured after the attempt",
        },
      ],
      [
        {
          eventId: "post-attempt-capture-attempt",
          kind: "close-attempted",
          order: 3,
          sessionId: "session-1",
        },
        {
          eventId: "post-attempt-capture-failure",
          kind: "close-failed",
          order: 5,
          sessionId: "session-1",
        },
      ],
      "closed=no",
    );
    expectInvalidLedger(preparationRecordedAfterAttempt);
    const expectManualPreparationFailure = (
      history: PreparationEvent[],
      error: string,
      identityState: RowRecord["identityState"] = "stable",
    ): void => {
      const started = apply(
        preparationLedger(history, identityState),
        start("origin-prep", "episode-prep", [ledgerRow()]),
      );
      expectRejected(
        started,
        {
          kind: "authorize",
          episodeId: "episode-prep",
          evidence: manual("episode-prep", ledgerRow()),
        },
        error,
      );
    };
    const resolvedPreparation = preparationLedger([
      { kind: "operational-state", order: 1, state: "completed" },
      {
        kind: "required-state-captured",
        order: 2,
        evidence: "captured",
      },
      { kind: "close-deferred", order: 3, reason: "followup needed" },
      {
        kind: "retention-resolved",
        order: 4,
        basis: "need-finished",
        evidence: "followup finished",
      },
    ]);
    const resolvedPath = freezeLedger({
      ...resolvedPreparation,
      order: 5,
      rows: resolvedPreparation.rows.map((row) =>
        row.rowId === "row-1"
          ? {
              ...row,
              history: [
                {
                  eventId: "resolved-unavailable",
                  kind: "closure-unavailable" as const,
                  order: 5,
                  sessionId: "session-1",
                  reason: "no usable close operation",
                },
              ],
              projection: "close-unavailable" as const,
            }
          : row,
      ),
    });
    let resolvedManual = apply(
      resolvedPath,
      start("origin-resolved", "episode-resolved", [ledgerRow()]),
    );
    resolvedManual = apply(resolvedManual, {
      kind: "authorize",
      episodeId: "episode-resolved",
      evidence: manual("episode-resolved", ledgerRow()),
    });
    expect(resolvedManual.episodes[0]?.authorizations).toHaveLength(1);
    const failedPreparation = (contextOrder: number): PreparationEvent[] => [
      { kind: "operational-state", order: 1, state: "failed" },
      {
        kind: "required-state-captured",
        order: 2,
        evidence: "failed row state captured",
      },
      {
        kind: "abnormal-context-captured",
        order: contextOrder,
        evidence: "failure context captured",
      },
    ];
    const failedCleanup = (attemptOrder: number): RowEvent[] => [
      {
        eventId: `failed-path-attempt-${attemptOrder}`,
        kind: "close-attempted",
        order: attemptOrder,
        sessionId: "session-1",
      },
      {
        eventId: `failed-path-result-${attemptOrder}`,
        kind: "close-failed",
        order: attemptOrder + 1,
        sessionId: "session-1",
      },
    ];
    const freshlyPreparedRetry = cleanupPathLedger(
      [
        { kind: "operational-state", order: 1, state: "completed" },
        {
          kind: "required-state-captured",
          order: 2,
          evidence: "initial attempt state captured",
        },
        { kind: "operational-state", order: 5, state: "completed" },
        {
          kind: "required-state-captured",
          order: 6,
          evidence: "retry state freshly captured",
        },
      ],
      failedCleanup(3),
      "closed=no",
    );
    const retryClosed = apply(freshlyPreparedRetry, {
      kind: "record-row-close",
      rowId: "row-1",
      sessionId: "session-1",
      attemptEventId: "fresh-retry-attempt",
      successEventId: "fresh-retry-success",
    });
    const retryValidated = apply(
      retryClosed,
      start("origin-fresh-retry", "episode-fresh-retry", [inventory()]),
    );
    expect(
      retryValidated.rows.find((row) => row.rowId === "row-1")?.projection,
    ).toBe("closed=yes");
    const pathBeforeContext = cleanupPathLedger(
      [
        { kind: "operational-state", order: 1, state: "completed" },
        {
          kind: "required-state-captured",
          order: 2,
          evidence: "initial row state captured",
        },
        { kind: "operational-state", order: 5, state: "failed" },
        {
          kind: "required-state-captured",
          order: 6,
          evidence: "later failure state captured",
        },
        {
          kind: "abnormal-context-captured",
          order: 7,
          evidence: "later failure context captured",
        },
      ],
      failedCleanup(3),
      "closed=no",
    );
    const beforeContextStarted = apply(
      pathBeforeContext,
      start("origin-before-context", "episode-before-context", [ledgerRow()]),
    );
    expectRejected(
      beforeContextStarted,
      {
        kind: "authorize",
        episodeId: "episode-before-context",
        evidence: manual("episode-before-context", ledgerRow()),
      },
      "row-preparation-manual-path-stale",
    );
    let pathAfterContext = apply(
      cleanupPathLedger(failedPreparation(3), failedCleanup(4), "closed=no"),
      start("origin-after-context", "episode-after-context", [ledgerRow()]),
    );
    pathAfterContext = apply(pathAfterContext, {
      kind: "authorize",
      episodeId: "episode-after-context",
      evidence: manual("episode-after-context", ledgerRow()),
    });
    expect(pathAfterContext.episodes[0]?.authorizations).toHaveLength(1);
    for (const [family, history] of [
      [
        "failed",
        [
          ...failedCleanup(3),
          {
            eventId: "success-after-failure-attempt",
            kind: "close-attempted" as const,
            order: 5,
            sessionId: "session-1",
          },
          {
            eventId: "success-after-failure-result",
            kind: "close-succeeded" as const,
            order: 6,
            sessionId: "session-1",
          },
        ],
      ],
      [
        "unavailable",
        [
          {
            eventId: "historical-unavailable",
            kind: "closure-unavailable" as const,
            order: 3,
            sessionId: "session-1",
            reason: "close operation temporarily unavailable",
          },
          {
            eventId: "success-after-unavailable-attempt",
            kind: "close-attempted" as const,
            order: 4,
            sessionId: "session-1",
          },
          {
            eventId: "success-after-unavailable-result",
            kind: "close-succeeded" as const,
            order: 5,
            sessionId: "session-1",
          },
        ],
      ],
    ] as const) {
      const terminalStarted = apply(
        cleanupPathLedger(
          row("row-1", "session-1").preparationHistory as PreparationEvent[],
          [...history],
          "closed=yes",
        ),
        start(`origin-terminal-${family}`, `episode-terminal-${family}`, [
          ledgerRow(),
        ]),
      );
      expectRejected(
        terminalStarted,
        {
          kind: "authorize",
          episodeId: `episode-terminal-${family}`,
          evidence: manual(`episode-terminal-${family}`, ledgerRow()),
        },
        "row-preparation-manual-path",
      );
    }
    for (const state of ["active", "waiting", "interrupted"] as const) {
      expectManualPreparationFailure(
        [
          { kind: "operational-state", order: 1, state },
          {
            kind: "required-state-captured",
            order: 2,
            evidence: "state captured",
          },
        ],
        "row-preparation-operational-state",
      );
    }
    for (const identityState of ["pending", "unknown"] as const) {
      expectManualPreparationFailure(
        row("row-1", "session-1").preparationHistory as PreparationEvent[],
        "row-preparation-identity",
        identityState,
      );
    }
    expectManualPreparationFailure(
      [
        { kind: "required-state-captured", order: 1, evidence: "stale" },
        { kind: "operational-state", order: 2, state: "completed" },
      ],
      "row-preparation-capture-stale",
    );
    expectManualPreparationFailure(
      [{ kind: "operational-state", order: 1, state: "completed" }],
      "row-preparation-capture-stale",
    );
    expectManualPreparationFailure(
      [
        { kind: "operational-state", order: 1, state: "failed" },
        {
          kind: "required-state-captured",
          order: 2,
          evidence: "failure captured",
        },
      ],
      "row-preparation-abnormal-context",
    );
    for (const state of ["failed", "timed-out"] as const) {
      expectManualPreparationFailure(
        [
          { kind: "operational-state", order: 1, state },
          { kind: "operational-state", order: 2, state: "superseded" },
          {
            kind: "required-state-captured",
            order: 3,
            evidence: `${state} row state captured after supersession`,
          },
        ],
        "row-preparation-abnormal-context",
      );
      expectManualPreparationFailure(
        [
          {
            kind: "abnormal-context-captured",
            order: 1,
            evidence: `stale ${state} context`,
          },
          { kind: "operational-state", order: 2, state },
          { kind: "operational-state", order: 3, state: "superseded" },
          {
            kind: "required-state-captured",
            order: 4,
            evidence: `${state} row state captured after supersession`,
          },
        ],
        "row-preparation-abnormal-context",
      );
    }
    const supersededContextAfterCleanup = cleanupPathLedger(
      [
        { kind: "operational-state", order: 1, state: "completed" },
        {
          kind: "required-state-captured",
          order: 2,
          evidence: "initial row state captured",
        },
        { kind: "operational-state", order: 5, state: "failed" },
        { kind: "operational-state", order: 6, state: "superseded" },
        {
          kind: "required-state-captured",
          order: 7,
          evidence: "failed row state captured after supersession",
        },
        {
          kind: "abnormal-context-captured",
          order: 8,
          evidence: "failure context captured after supersession",
        },
      ],
      failedCleanup(3),
      "closed=no",
    );
    const supersededContextStarted = apply(
      supersededContextAfterCleanup,
      start("origin-superseded-context", "episode-superseded-context", [
        ledgerRow(),
      ]),
    );
    expectRejected(
      supersededContextStarted,
      {
        kind: "authorize",
        episodeId: "episode-superseded-context",
        evidence: manual("episode-superseded-context", ledgerRow()),
      },
      "row-preparation-manual-path-stale",
    );
    expectManualPreparationFailure(
      [
        { kind: "operational-state", order: 1, state: "completed" },
        {
          kind: "required-state-captured",
          order: 2,
          evidence: "captured",
        },
        { kind: "close-deferred", order: 3, reason: "followup needed" },
      ],
      "row-preparation-retention-unresolved",
    );
    expectManualPreparationFailure(
      [
        { kind: "operational-state", order: 1, state: "completed" },
        {
          kind: "required-state-captured",
          order: 2,
          evidence: "captured",
        },
        { kind: "close-deferred", order: 3, reason: "followup needed" },
        {
          kind: "retention-resolved",
          order: 4,
          basis: "captured-and-replaced",
          evidence: "invalid proof",
        },
      ],
      "row-preparation-retention-proof",
    );
    expectManualPreparationFailure(
      [
        {
          kind: "retention-resolved",
          order: 1,
          basis: "need-finished",
          evidence: "stale resolution",
        },
        { kind: "operational-state", order: 2, state: "completed" },
        {
          kind: "required-state-captured",
          order: 3,
          evidence: "captured",
        },
        { kind: "close-deferred", order: 4, reason: "followup needed" },
      ],
      "row-preparation-retention-unresolved",
    );
    expectManualPreparationFailure(
      [
        { kind: "operational-state", order: 1, state: "completed" },
        {
          kind: "required-state-captured",
          order: 2,
          evidence: "captured",
        },
      ],
      "row-preparation-manual-path",
    );
    const stalePathBase = preparationLedger([
      { kind: "operational-state", order: 1, state: "completed" },
      {
        kind: "required-state-captured",
        order: 2,
        evidence: "captured before cleanup path",
      },
      { kind: "operational-state", order: 4, state: "completed" },
      {
        kind: "required-state-captured",
        order: 5,
        evidence: "recaptured after cleanup path",
      },
    ]);
    const stalePathLedger = freezeLedger({
      ...stalePathBase,
      rows: stalePathBase.rows.map((row) =>
        row.rowId === "row-1"
          ? {
              ...row,
              history: [
                {
                  eventId: "stale-unavailable",
                  kind: "closure-unavailable" as const,
                  order: 3,
                  sessionId: "session-1",
                  reason: "no usable close operation",
                },
              ],
              projection: "close-unavailable" as const,
            }
          : row,
      ),
    });
    const stalePathStarted = apply(
      stalePathLedger,
      start("origin-stale-path", "episode-stale-path", [ledgerRow()]),
    );
    expectRejected(
      stalePathStarted,
      {
        kind: "authorize",
        episodeId: "episode-stale-path",
        evidence: manual("episode-stale-path", ledgerRow()),
      },
      "row-preparation-manual-path-stale",
    );
    const unpreparedClose = apply(
      preparationLedger([
        { kind: "operational-state", order: 1, state: "active" },
        {
          kind: "required-state-captured",
          order: 2,
          evidence: "active captured",
        },
      ]),
      start("origin-close-prep", "episode-close-prep", [ledgerRow()]),
    );
    expectRejected(
      unpreparedClose,
      {
        kind: "record-row-close",
        rowId: "row-1",
        sessionId: "session-1",
        attemptEventId: "close-prep-attempt",
        successEventId: "close-prep-success",
      },
      "row-preparation-operational-state",
    );
    expectRejected(
      authorizing,
      start("origin-2", "episode-1", [inventory()]),
      "recovery-episode-already-used",
    );
    expectRejected(
      emptyLedger(),
      dispatch("missing-episode"),
      "recovery-episode-not-found",
    );
    expectRejected(
      authorizing,
      {
        kind: "record-row-close",
        rowId: "row-1",
        sessionId: "session-1",
        attemptEventId: "unsafe event",
        successEventId: "close-success-row-1",
      },
      "invalid-row-close-record",
    );
    for (const evidence of [
      { kind: "unknown" },
      {},
      { kind: 7 },
    ] as unknown as Authorization[]) {
      expectRejected(
        authorizing,
        { kind: "authorize", episodeId: "episode-1", evidence },
        "invalid-authorization-kind",
      );
    }
    expectRejected(
      authorizing,
      {
        kind: "authorize",
        episodeId: "episode-1",
        evidence: {
          ...manual("episode-1", inventory()),
          extra: true,
        } as unknown as Authorization,
      },
      "invalid-authorization-shape",
    );
    expectRejected(
      authorizing,
      {
        kind: "authorize",
        episodeId: "episode-1",
        evidence: {
          kind: "manual",
          episodeId: "episode-1",
          provenance: "operator UI",
          observedAt: "2026-07-12T00:00:00Z",
        } as unknown as Authorization,
      },
      "invalid-authorization-blocker",
    );
    for (const provenance of [undefined, null, 7]) {
      expectRejected(
        authorizing,
        {
          kind: "authorize",
          episodeId: "episode-1",
          evidence: {
            ...manual("episode-1", inventory()),
            provenance,
          } as unknown as Authorization,
        },
        "unsafe-manual-provenance",
      );
    }
    for (const observedAt of [undefined, null, 7]) {
      expectRejected(
        authorizing,
        {
          kind: "authorize",
          episodeId: "episode-1",
          evidence: {
            ...manual("episode-1", inventory()),
            observedAt,
          } as unknown as Authorization,
        },
        "invalid-manual-observation-time",
      );
    }
    expectRejected(
      authorizing,
      {
        kind: "authorize",
        episodeId: "episode-1",
        evidence: {
          kind: "row-close",
          episodeId: "episode-1",
          blocker: ledgerRow(),
          rowId: "row-1",
          sessionId: "session-1",
        } as unknown as Authorization,
      },
      "invalid-row-close-evidence-shape",
    );
    expectRejected(
      authorizing,
      {
        kind: "authorize",
        episodeId: "episode-1",
        evidence: manual("episode-1", inventory("other")),
      },
      "non-snapshot-evidence",
    );
    expectRejected(
      authorizing,
      {
        kind: "authorize",
        episodeId: "episode-1",
        evidence: manual("episode-1", inventory("row-1")),
      },
      "cross-kind-evidence",
    );
    expectRejected(
      authorizing,
      {
        kind: "authorize",
        episodeId: "episode-1",
        evidence: closeEvidence("episode-1", ledgerRow(), {
          rowId: "same",
          sessionId: "session-same",
        }),
      },
      "cross-kind-evidence",
    );
    expectRejected(
      authorizing,
      {
        kind: "authorize",
        episodeId: "episode-1",
        evidence: closeEvidence("episode-1", inventory()),
      },
      "inventory-close-evidence",
    );
    expectRejected(
      authorizing,
      {
        kind: "authorize",
        episodeId: "episode-1",
        evidence: manual("episode-0", inventory()),
      },
      "stale-episode-evidence",
    );
    expectRejected(
      authorizing,
      {
        kind: "authorize",
        episodeId: "episode-1",
        evidence: manual("episode-1", inventory(), "operator\nraw-secret"),
      },
      "unsafe-manual-provenance",
    );
    for (const observedAt of [
      "not-a-time",
      "2026-13-12T00:00:00Z",
      "2026-02-30T00:00:00Z",
      "2026-07-12T25:00:00Z",
      "2026-07-12T00:00:00.000Z",
      "2026-07-12T00:00:00+00:00",
    ]) {
      expectRejected(
        authorizing,
        {
          kind: "authorize",
          episodeId: "episode-1",
          evidence: {
            ...manual("episode-1", inventory()),
            observedAt,
          },
        },
        "invalid-manual-observation-time",
      );
    }
    expectRejected(
      authorizing,
      {
        kind: "authorize",
        episodeId: "episode-1",
        evidence: closeEvidence("episode-1"),
      },
      "row-close-event-missing",
    );

    let rowReady = apply(authorizing, {
      kind: "record-row-close",
      rowId: "row-1",
      sessionId: "session-1",
      attemptEventId: "close-attempt-row-1",
      successEventId: "close-success-row-1",
    });
    rowReady = apply(rowReady, {
      kind: "authorize",
      episodeId: "episode-1",
      evidence: closeEvidence("episode-1"),
    });
    expectRejected(
      rowReady,
      {
        kind: "record-row-close",
        rowId: "same",
        sessionId: "session-same",
        attemptEventId: "close-attempt-row-1",
        successEventId: "close-success-same",
      },
      "duplicate-row-event-identity",
    );
    const rowsBeforeSecondClose = rowReady.rows;
    const episodesBeforeSecondClose = rowReady.episodes;
    const secondClose = fold(rowReady, {
      kind: "record-row-close",
      rowId: "row-1",
      sessionId: "session-1",
      attemptEventId: "second-close-attempt",
      successEventId: "second-close-success",
    });
    expect(secondClose.error).toBe("post-close-success-row-event");
    expect(secondClose.ledger).toBe(rowReady);
    expect(secondClose.ledger?.rows).toEqual(rowsBeforeSecondClose);
    expect(secondClose.ledger?.episodes).toEqual(episodesBeforeSecondClose);
    expectRejected(
      rowReady,
      {
        kind: "authorize",
        episodeId: "episode-1",
        evidence: closeEvidence("episode-1"),
      },
      "blocker-already-authorized",
    );
    expectRejected(
      rowReady,
      reconstruct("episode-1"),
      "blocker-authorization-incomplete",
    );
    expectRejected(rowReady, dispatch("episode-1"), "reconstruction-required");

    const contradictory = freezeLedger({
      ...authorizing,
      rows: authorizing.rows.map((candidate) =>
        candidate.rowId === "row-1"
          ? {
              ...candidate,
              projection: "closed=yes",
              history: [
                {
                  eventId: "close-success-row-1",
                  kind: "close-succeeded",
                  order: authorizing.order + 1,
                  sessionId: "session-1",
                },
              ],
            }
          : candidate,
      ),
      order: authorizing.order + 1,
    });
    expectInvalidLedger(contradictory);
    const wrongSession = freezeLedger({
      ...rowReady,
      episodes: rowReady.episodes.map((episode) => ({
        ...episode,
        authorizations: [],
      })),
      rows: rowReady.rows.map((candidate) =>
        candidate.rowId === "row-1"
          ? { ...candidate, sessionId: "different-session" }
          : candidate,
      ),
    });
    expectInvalidLedger(wrongSession);

    const readyForManual = apply(rowReady, {
      kind: "authorize",
      episodeId: "episode-1",
      evidence: manual("episode-1", inventory()),
    });
    expectRejected(
      readyForManual,
      {
        kind: "reconstruct",
        episodeId: "episode-1",
        lifecycleAnchor: "",
        repositoryAnchor: "main@abc123",
      },
      "reconstruction-anchors-missing",
    );
    const ready = apply(readyForManual, reconstruct("episode-1"));
    expectRejected(
      ready,
      {
        kind: "authorize",
        episodeId: "episode-1",
        evidence: manual("episode-1", inventory()),
      },
      "episode-not-authorizing",
    );
    expectRejected(ready, reconstruct("episode-1"), "episode-not-authorizing");
    expectRejected(
      ready,
      result("episode-1", "succeeded"),
      "retry-result-without-dispatch",
    );
    const dispatched = apply(ready, dispatch("episode-1"));
    for (const invalidResult of ["unknown"]) {
      expectRejected(
        dispatched,
        {
          kind: "result",
          episodeId: "episode-1",
          result: invalidResult,
        } as unknown as Operation,
        "invalid-retry-result-kind",
      );
    }
    expectRejected(
      dispatched,
      dispatch("episode-1"),
      "retry-already-dispatched-or-terminal",
    );
    expectRejected(
      dispatched,
      reconstruct("episode-1"),
      "episode-consumed-or-terminal",
    );
    const succeeded = apply(dispatched, result("episode-1", "succeeded"));
    const forgeEpisode = (
      ledger: Ledger,
      forged: Episode,
      order = ledger.order,
    ): Ledger =>
      freezeLedger({
        ...ledger,
        order,
        episodes: ledger.episodes.map((episode) =>
          episode.episodeId === forged.episodeId ? forged : episode,
        ),
      });
    const expectInconsistent = (ledger: Ledger): void =>
      expectInvalidLedger(ledger);
    const expectRestoredAuthorizationRejected = (
      ledger: Ledger,
      episodeId: string,
    ): void => {
      for (const operation of [reconstruct(episodeId), dispatch(episodeId)]) {
        const folded = fold(ledger, operation);
        expect(folded.error).toBe("inconsistent-recovery-ledger");
        expect(folded.input).toBe(ledger);
        expect(folded.ledger).toBeUndefined();
      }
    };
    const restoredRowCloseWithInvalidPreparation = forgeRows(rowReady, (rows) =>
      rows.map((row) =>
        row.rowId === "row-1"
          ? {
              ...row,
              preparationHistory: row.preparationHistory.map((event) =>
                event.kind === "operational-state"
                  ? { ...event, state: "active" }
                  : event,
              ),
            }
          : row,
      ),
    );
    expectRestoredAuthorizationRejected(
      restoredRowCloseWithInvalidPreparation,
      "episode-1",
    );
    const restoredManualWithMissingPreparation = forgeRows(
      preparedManualFailed,
      (rows) =>
        rows.map((row) =>
          row.rowId === "manual-failed-row"
            ? {
                ...row,
                preparationHistory: row.preparationHistory.filter(
                  (event) => event.kind !== "required-state-captured",
                ),
              }
            : row,
        ),
    );
    expectRestoredAuthorizationRejected(
      restoredManualWithMissingPreparation,
      "episode-manual-failed",
    );
    const restoredManualWithPostAttemptCapture = forgeRows(
      preparedManualFailed,
      (rows) =>
        rows.map((row) =>
          row.rowId === "manual-failed-row"
            ? {
                ...row,
                history: row.history.map((event) =>
                  event.kind === "close-failed"
                    ? { ...event, order: 5 }
                    : event,
                ),
                preparationHistory: row.preparationHistory.map((event) =>
                  event.kind === "required-state-captured"
                    ? { ...event, order: 4 }
                    : event,
                ),
              }
            : row,
        ),
    );
    expectRestoredAuthorizationRejected(
      restoredManualWithPostAttemptCapture,
      "episode-manual-failed",
    );
    const restoredManualWithStaleCleanupPath = forgeRows(
      preparedManualFailed,
      (rows) =>
        rows.map((row) =>
          row.rowId === "manual-failed-row"
            ? {
                ...row,
                preparationHistory: row.preparationHistory.map((event) =>
                  event.kind === "required-state-captured"
                    ? { ...event, order: 5 }
                    : event,
                ),
              }
            : row,
        ),
    );
    expectRestoredAuthorizationRejected(
      restoredManualWithStaleCleanupPath,
      "episode-manual-failed",
    );
    const rowAuthorization = readyForManual.episodes[0]?.authorizations[0];
    expectInconsistent(
      forgeEpisode(readyForManual, {
        ...(readyForManual.episodes[0] as Episode),
        authorizations: [
          rowAuthorization as Authorization,
          rowAuthorization as Authorization,
        ],
      }),
    );
    expectInconsistent(
      forgeEpisode(readyForManual, {
        ...(readyForManual.episodes[0] as Episode),
        state: "ready",
      }),
    );
    expectInconsistent(
      forgeEpisode(ready, {
        ...(ready.episodes[0] as Episode),
        state: "retry-dispatched",
      }),
    );
    expectInconsistent(
      forgeEpisode(dispatched, {
        ...(dispatched.episodes[0] as Episode),
        state: "retry-succeeded",
      }),
    );
    expectInconsistent(
      forgeEpisode(succeeded, {
        ...(succeeded.episodes[0] as Episode),
        events: (succeeded.episodes[0] as Episode).events.map((event, index) =>
          index === (succeeded.episodes[0] as Episode).events.length - 1
            ? { ...event, kind: "slot-retry-failed" }
            : event,
        ),
      }),
    );
    expectInconsistent(
      forgeEpisode(
        succeeded,
        {
          ...(succeeded.episodes[0] as Episode),
          events: [
            ...(succeeded.episodes[0] as Episode).events,
            {
              kind: "slot-retry-failed",
              order: succeeded.order + 1,
            },
          ],
        },
        succeeded.order + 1,
      ),
    );
    expectInconsistent(
      forgeEpisode(readyForManual, {
        ...(readyForManual.episodes[0] as Episode),
        events: (readyForManual.episodes[0] as Episode).events.map((event) =>
          event.kind === "manual-cleanup-confirmed"
            ? { ...event, provenance: "different operator" }
            : event,
        ),
      }),
    );
    expectInconsistent(
      forgeEpisode(authorizing, {
        ...(authorizing.episodes[0] as Episode),
        snapshot: [unknownTag],
      }),
    );
    expectInconsistent(
      forgeEpisode(authorizing, {
        ...(authorizing.episodes[0] as Episode),
        authorizations: [manual("episode-1", inventory("other"))],
      }),
    );
    expectInconsistent(
      freezeLedger({
        ...rowReady,
        rows: rowReady.rows.map((row) =>
          row.rowId === "row-1" ? { ...row, history: [] } : row,
        ),
      }),
    );
    expectRejected(
      succeeded,
      result("episode-1", "succeeded"),
      "retry-result-already-recorded",
    );
    expectRejected(
      succeeded,
      result("episode-1", "failed"),
      "retry-result-already-recorded",
    );
    expectRejected(
      authorizing,
      start("origin-1", "episode-other", [inventory()]),
      "recovery-origin-already-used",
    );
    expectRejected(
      failed,
      start("origin-failed", "episode-after-failure", [inventory()]),
      "terminal-failure-origin-closed",
    );
    expectRejected(
      dispatched,
      {
        kind: "result",
        episodeId: "episode-1",
        result: "failed",
        escalation: {
          inventory: "unavailable",
          remainingBlockers: [],
          token: "raw-secret",
        } as unknown as RetryFailureEscalation,
      },
      "invalid-retry-failure-escalation",
    );
    expectRejected(
      dispatched,
      {
        kind: "result",
        episodeId: "episode-1",
        result: "failed",
        escalation: {
          inventory: "available",
          remainingBlockers: [
            { ...inventory(), extra: true } as unknown as BlockerRef,
          ],
        },
      },
      "invalid-retry-failure-escalation",
    );
    expectRejected(
      dispatched,
      {
        kind: "result",
        episodeId: "episode-1",
        result: "failed",
        escalation: {
          inventory: "password=raw-secret",
          remainingBlockers: [],
        } as unknown as RetryFailureEscalation,
      },
      "invalid-retry-failure-escalation",
    );
    expectRejected(
      dispatched,
      {
        kind: "result",
        episodeId: "episode-1",
        result: "failed",
        escalation: {
          inventory: "available",
          remainingBlockers: [inventory("unsafe identity")],
        },
      },
      "invalid-retry-failure-escalation",
    );
    expectRejected(
      dispatched,
      {
        kind: "result",
        episodeId: "episode-1",
        result: "failed",
        escalation: {
          inventory: "available",
          remainingBlockers: [inventory("other")],
        },
      },
      "invalid-retry-failure-escalation",
    );
    expectRejected(
      dispatched,
      {
        kind: "result",
        episodeId: "episode-1",
        result: "failed",
        escalation: {
          inventory: "available",
          remainingBlockers: [unknownTag],
        },
      },
      "invalid-retry-failure-escalation",
    );
    expectRejected(
      dispatched,
      {
        kind: "result",
        episodeId: "episode-1",
        result: "succeeded",
        escalation: { inventory: "unavailable", remainingBlockers: [] },
      },
      "success-escalation-forbidden",
    );

    const persistedNestedExtra = Object.freeze({
      ...failed,
      episodes: Object.freeze(
        failed.episodes.map((episode) =>
          Object.freeze({
            ...episode,
            escalation: Object.freeze({
              inventory: "available" as const,
              remainingBlockers: Object.freeze([
                Object.freeze({ ...inventory(), extra: true }),
              ]),
            }),
          }),
        ),
      ),
    }) as unknown as Ledger;
    expectInconsistent(persistedNestedExtra);

    const inconsistent = Object.freeze({
      ...authorizing,
      originEpisodes: Object.freeze([
        Object.freeze({
          originId: "wrong-origin",
          episodeId: "episode-1",
        }),
      ]),
    });
    expectInvalidLedger(inconsistent);

    const mutableSnapshot = [
      { kind: "inventory-only" as const, identity: "inventory-1" },
    ];
    const mutableStart = apply(
      emptyLedger(),
      start("origin-alias", "episode-alias", mutableSnapshot),
    );
    mutableSnapshot[0].identity = "mutated";
    expect(mutableStart.episodes[0]?.snapshot[0]?.identity).toBe("inventory-1");
    expect(() => {
      (
        mutableStart.episodes[0]?.snapshot as unknown as Array<{
          identity: string;
        }>
      )[0].identity = "mutated-return";
    }).toThrow();

    const mutableEvidence = {
      kind: "manual" as const,
      episodeId: "episode-alias",
      blocker: { kind: "inventory-only" as const, identity: "inventory-1" },
      provenance: "operator UI",
      observedAt: "2026-07-12T00:00:00Z",
    };
    const immutableAuthorization = apply(mutableStart, {
      kind: "authorize",
      episodeId: "episode-alias",
      evidence: mutableEvidence,
    });
    mutableEvidence.provenance = "mutated";
    expect(immutableAuthorization.episodes[0]?.authorizations[0]).toMatchObject(
      { provenance: "operator UI" },
    );
    expect(() => {
      (
        immutableAuthorization.episodes[0]?.authorizations as unknown as Array<{
          blocker: { identity: string };
        }>
      )[0].blocker.identity = "mutated-return";
    }).toThrow();
  });

  it("folds row-owned lifecycle history without episode facts", () => {
    type State =
      | "pending"
      | "active"
      | "waiting"
      | "interrupted"
      | "completed"
      | "timed-out"
      | "failed"
      | "superseded";
    type Event = {
      order: number;
      kind:
        | "dispatch-requested"
        | "identity-assigned"
        | "reuse-capability-observed"
        | "waiting"
        | "interrupted"
        | "required-state-captured"
        | "replacement-secured"
        | "turn-completed"
        | "turn-timed-out"
        | "turn-failed"
        | "followup-dispatch-requested"
        | "interrupted-reuse-dispatch-requested"
        | "superseded"
        | "close-deferred"
        | "retention-resolved"
        | "close-attempted"
        | "close-failed"
        | "close-succeeded"
        | "closure-unavailable";
      sessionId?: string;
      reuseSupported?: boolean;
      evidence?: string;
      reason?: string;
      resolutionBasis?: "need-finished" | "captured-and-replaced";
    };
    type Projection = {
      decision: "none" | "retained" | "attempted" | "unavailable";
      outcome: "closed=no" | "closed=yes" | "close-unavailable";
      retentionReason: string | null;
      unavailableReason: string | null;
    };
    type Row = {
      state: State | null;
      sessionId: string | null;
      reusable: boolean;
      transitionOrder: number;
      captureOrder: number;
      terminalOrder: number;
      abnormalOrder: number;
      abnormalCaptureOrder: number;
      replacementOrder: number;
      retained: boolean;
      deferralOrder: number;
      outstandingClose: boolean;
      terminalClose: boolean;
      history: Event["kind"][];
      retentionReasons: string[];
      unavailableReasons: string[];
      projection: Projection;
    };
    type Result = { row: Row; error?: string };

    const created = (): Row => ({
      state: null,
      sessionId: null,
      reusable: false,
      transitionOrder: 0,
      captureOrder: 0,
      terminalOrder: 0,
      abnormalOrder: 0,
      abnormalCaptureOrder: 0,
      replacementOrder: 0,
      retained: false,
      deferralOrder: 0,
      outstandingClose: false,
      terminalClose: false,
      history: [],
      retentionReasons: [],
      unavailableReasons: [],
      projection: {
        decision: "none",
        outcome: "closed=no",
        retentionReason: null,
        unavailableReason: null,
      },
    });
    const terminalStates = new Set<State>([
      "completed",
      "timed-out",
      "failed",
      "superseded",
    ]);
    const fail = (row: Row, error: string): Result => ({ row, error });
    const captured = (event: Event): boolean =>
      event.evidence !== undefined && event.evidence.trim().length > 0;
    const eligible = (row: Row): string | undefined => {
      if (row.state === null || !terminalStates.has(row.state)) {
        return "cleanup-ineligible-operational-state";
      }
      if (row.captureOrder <= row.transitionOrder) {
        return "required-state-capture-stale";
      }
      if (
        row.abnormalOrder > 0 &&
        row.abnormalCaptureOrder < row.abnormalOrder
      ) {
        return "abnormal-context-stale";
      }
      return undefined;
    };

    function foldRows(events: Event[]): Result {
      let row = created();
      let previousOrder = 0;
      for (const event of events) {
        if (event.order <= previousOrder) {
          return fail(row, "unordered-row-events");
        }
        previousOrder = event.order;
        if (row.terminalClose) {
          return fail(row, "post-close-success-row-event");
        }
        if (
          row.outstandingClose &&
          event.kind !== "close-failed" &&
          event.kind !== "close-succeeded"
        ) {
          return fail(row, "cleanup-attempt-overlap");
        }
        const next = {
          ...row,
          history: [...row.history, event.kind],
          retentionReasons: [...row.retentionReasons],
          unavailableReasons: [...row.unavailableReasons],
        };
        switch (event.kind) {
          case "dispatch-requested":
            if (row.state !== null) return fail(row, "illegal-dispatch");
            next.state = "pending";
            next.transitionOrder = event.order;
            break;
          case "identity-assigned":
            if (
              row.state !== "pending" ||
              event.sessionId === undefined ||
              !/^[A-Za-z0-9._-]+$/.test(event.sessionId)
            ) {
              return fail(row, "illegal-identity-assignment");
            }
            next.sessionId = event.sessionId;
            next.state = "active";
            next.transitionOrder = event.order;
            break;
          case "reuse-capability-observed":
            if (
              row.sessionId === null ||
              event.reuseSupported === undefined ||
              !captured(event)
            ) {
              return fail(row, "reuse-capability-evidence");
            }
            next.reusable = event.reuseSupported;
            break;
          case "waiting":
            if (row.state !== "active") return fail(row, "illegal-wait");
            next.state = "waiting";
            next.transitionOrder = event.order;
            break;
          case "interrupted":
            if (row.state !== "active" && row.state !== "waiting") {
              return fail(row, "illegal-interruption");
            }
            next.state = "interrupted";
            next.transitionOrder = event.order;
            break;
          case "required-state-captured":
            if (!captured(event) || row.state === "pending") {
              return fail(row, "required-state-capture-evidence");
            }
            next.captureOrder = event.order;
            if (row.abnormalOrder > 0) {
              next.abnormalCaptureOrder = event.order;
            }
            break;
          case "replacement-secured":
            if (!captured(event)) return fail(row, "replacement-evidence");
            next.replacementOrder = event.order;
            break;
          case "turn-completed":
          case "turn-timed-out":
          case "turn-failed":
            if (
              row.state !== "active" &&
              row.state !== "waiting" &&
              row.state !== "interrupted"
            ) {
              return fail(row, "illegal-terminal-transition");
            }
            next.state =
              event.kind === "turn-completed"
                ? "completed"
                : event.kind === "turn-timed-out"
                  ? "timed-out"
                  : "failed";
            next.transitionOrder = event.order;
            next.terminalOrder = event.order;
            if (event.kind !== "turn-completed") {
              next.abnormalOrder = event.order;
              next.abnormalCaptureOrder = 0;
            }
            break;
          case "followup-dispatch-requested":
            if (
              row.state !== "completed" ||
              !row.reusable ||
              event.sessionId !== row.sessionId ||
              row.captureOrder <= row.terminalOrder
            ) {
              return fail(row, "illegal-completed-reentry");
            }
            next.state = "active";
            next.transitionOrder = event.order;
            break;
          case "interrupted-reuse-dispatch-requested":
            if (
              row.state !== "interrupted" ||
              !row.reusable ||
              event.sessionId !== row.sessionId ||
              row.captureOrder <= row.transitionOrder
            ) {
              return fail(row, "illegal-interrupted-reentry");
            }
            next.state = "active";
            next.transitionOrder = event.order;
            break;
          case "superseded":
            if (
              row.state === null ||
              row.state === "pending" ||
              row.captureOrder <= row.transitionOrder ||
              ((row.state === "active" ||
                row.state === "waiting" ||
                row.state === "interrupted") &&
                row.replacementOrder <= row.captureOrder)
            ) {
              return fail(row, "unsafe-supersession");
            }
            next.state = "superseded";
            next.transitionOrder = event.order;
            next.reusable = false;
            break;
          case "close-deferred": {
            const error = eligible(row);
            if (error !== undefined) return fail(row, error);
            if (
              event.reason === undefined ||
              event.reason.trim().length === 0
            ) {
              return fail(row, "close-deferred-reason");
            }
            next.retained = true;
            next.deferralOrder = event.order;
            next.retentionReasons.push(event.reason);
            next.projection = {
              decision: "retained",
              outcome: "closed=no",
              retentionReason: event.reason,
              unavailableReason: null,
            };
            break;
          }
          case "retention-resolved": {
            const error = eligible(row);
            if (error !== undefined) return fail(row, error);
            if (!row.retained || !captured(event)) {
              return fail(row, "retention-resolution-evidence");
            }
            if (
              event.resolutionBasis !== "need-finished" &&
              (event.resolutionBasis !== "captured-and-replaced" ||
                row.captureOrder <= row.deferralOrder ||
                row.replacementOrder <= row.captureOrder)
            ) {
              return fail(row, "retention-resolution-proof");
            }
            next.retained = false;
            next.projection = {
              decision: "none",
              outcome: "closed=no",
              retentionReason: null,
              unavailableReason: null,
            };
            break;
          }
          case "close-attempted": {
            const error = eligible(row);
            if (error !== undefined) return fail(row, error);
            if (row.retained) return fail(row, "retention-unresolved");
            if (event.sessionId !== row.sessionId) {
              return fail(row, "close-session-mismatch");
            }
            next.outstandingClose = true;
            next.projection = {
              decision: "attempted",
              outcome: "closed=no",
              retentionReason: null,
              unavailableReason: null,
            };
            break;
          }
          case "close-failed":
          case "close-succeeded":
            if (!row.outstandingClose || event.sessionId !== row.sessionId) {
              return fail(row, "unpaired-close-result");
            }
            next.outstandingClose = false;
            next.terminalClose = event.kind === "close-succeeded";
            next.projection = {
              decision: "attempted",
              outcome:
                event.kind === "close-succeeded" ? "closed=yes" : "closed=no",
              retentionReason: null,
              unavailableReason: null,
            };
            break;
          case "closure-unavailable": {
            const error = eligible(row);
            if (error !== undefined) return fail(row, error);
            if (row.retained) return fail(row, "retention-unresolved");
            if (
              event.reason === undefined ||
              event.reason.trim().length === 0
            ) {
              return fail(row, "closure-unavailable-reason");
            }
            next.unavailableReasons.push(event.reason);
            next.projection = {
              decision: "unavailable",
              outcome: "close-unavailable",
              retentionReason: null,
              unavailableReason: event.reason,
            };
            break;
          }
        }
        row = next;
      }
      return row.outstandingClose
        ? fail(row, "unpaired-close-attempt")
        : { row };
    }

    const base = (): Event[] => [
      { order: 1, kind: "dispatch-requested" },
      {
        order: 2,
        kind: "identity-assigned",
        sessionId: "session-1",
      },
      { order: 3, kind: "turn-completed" },
      {
        order: 4,
        kind: "required-state-captured",
        evidence: "result captured",
      },
    ];
    const close = (result: "close-failed" | "close-succeeded"): Event[] => [
      ...base(),
      {
        order: 5,
        kind: "close-attempted",
        sessionId: "session-1",
      },
      {
        order: 6,
        kind: result,
        sessionId: "session-1",
      },
    ];

    expect(foldRows(close("close-succeeded"))).toMatchObject({
      row: {
        projection: { outcome: "closed=yes" },
        history: expect.arrayContaining(["close-attempted", "close-succeeded"]),
      },
    });
    expect(foldRows(close("close-failed"))).toMatchObject({
      row: { projection: { outcome: "closed=no" } },
    });
    expect(
      foldRows([
        ...base(),
        {
          order: 5,
          kind: "closure-unavailable",
          reason: "no usable close operation",
        },
      ]),
    ).toMatchObject({
      row: {
        projection: {
          outcome: "close-unavailable",
          unavailableReason: "no usable close operation",
        },
      },
    });

    const completedReentry = foldRows([
      ...base(),
      {
        order: 5,
        kind: "reuse-capability-observed",
        reuseSupported: true,
        evidence: "target supports reuse",
      },
      {
        order: 6,
        kind: "followup-dispatch-requested",
        sessionId: "session-1",
      },
      { order: 7, kind: "waiting" },
    ]);
    expect(completedReentry).toMatchObject({
      row: { state: "waiting", reusable: true },
    });
    expect(
      foldRows([
        ...base().slice(0, 3),
        {
          order: 4,
          kind: "reuse-capability-observed",
          reuseSupported: true,
          evidence: "target supports reuse",
        },
        {
          order: 5,
          kind: "followup-dispatch-requested",
          sessionId: "session-1",
        },
      ]).error,
    ).toBe("illegal-completed-reentry");

    const interruptedReentry = foldRows([
      { order: 1, kind: "dispatch-requested" },
      {
        order: 2,
        kind: "identity-assigned",
        sessionId: "session-1",
      },
      {
        order: 3,
        kind: "reuse-capability-observed",
        reuseSupported: true,
        evidence: "target supports reuse",
      },
      { order: 4, kind: "interrupted" },
      {
        order: 5,
        kind: "required-state-captured",
        evidence: "interrupted state captured",
      },
      {
        order: 6,
        kind: "interrupted-reuse-dispatch-requested",
        sessionId: "session-1",
      },
    ]);
    expect(interruptedReentry).toMatchObject({
      row: { state: "active", reusable: true },
    });

    expect(
      foldRows([
        ...base(),
        {
          order: 5,
          kind: "close-deferred",
          reason: "same-session fixup",
        },
        {
          order: 6,
          kind: "retention-resolved",
          resolutionBasis: "need-finished",
          evidence: "fixup finished",
        },
      ]),
    ).toMatchObject({
      row: {
        projection: {
          decision: "none",
          outcome: "closed=no",
          retentionReason: null,
        },
        retentionReasons: ["same-session fixup"],
      },
    });
    expect(
      foldRows([
        { order: 1, kind: "dispatch-requested" },
        {
          order: 2,
          kind: "identity-assigned",
          sessionId: "session-1",
        },
        { order: 3, kind: "waiting" },
        {
          order: 4,
          kind: "required-state-captured",
          evidence: "waiting state captured",
        },
        {
          order: 5,
          kind: "replacement-secured",
          evidence: "replacement ready",
        },
        { order: 6, kind: "superseded" },
      ]),
    ).toMatchObject({ row: { state: "superseded" } });
    expect(
      foldRows([
        { order: 1, kind: "dispatch-requested" },
        {
          order: 2,
          kind: "identity-assigned",
          sessionId: "session-1",
        },
        { order: 3, kind: "turn-failed" },
        {
          order: 4,
          kind: "required-state-captured",
          evidence: "failure context captured",
        },
      ]),
    ).toMatchObject({
      row: { state: "failed", abnormalCaptureOrder: 4 },
    });
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
      "role-specific captured state includes implementer reports, changed files, test results, snapshot state (`requested`, `emitted`, `skipped`, or `malformed`), reviewer scope, reviewer report, concrete findings, reviewer integration-result state (`pending` or `integrated`), reviewer disposition (`final-pass`, `final-findings`, `advisory`, `stale`, or `superseded`), routing target, re-review target, task base/head SHA, reviewed head SHA, fixup count, and blocker state",
    );
    expect(normalizedLifecycle).toContain(
      "Run the shared cleanup gate before dispatching the next implementer, reviewer, re-reviewer, or final reviewer",
    );
    expect(normalizedLifecycle).toContain(
      "same-session spec-compliance or code-quality reviewer fix loops may still route fixups back to that implementer session",
    );
    expect(normalizedLifecycle).toContain(
      "preserve the implementer session until every reviewer loop required by the task's effective route passes",
    );
    expect(normalizedLifecycle).toContain(
      "append `retention-resolved(basis=need-finished, evidence=...)` if the need finished",
    );
    expect(normalizedLifecycle).toContain(
      "ordered latest `close-deferred` < value-bearing `required-state-captured` < `replacement-secured` < `retention-resolved(basis=captured-and-replaced, evidence=...)`",
    );
    expect(normalizedLifecycle).toContain(
      "canonical immediate projection keeps cleanup evaluation `evaluated`, sets current cleanup decision to `none`, clears current retention and unavailable reasons, and projects `closed=no`",
    );
    expect(normalizedLifecycle).toContain(
      "defer recovery-episode storage, authorization, reconstruction, retry dispatch/result, and sanitized escalation to `subagent-lifecycle`",
    );
    expect(normalizedLifecycle).toContain(
      "This workflow contributes only its captured task, reviewer, snapshot, blocker-family, and repository-anchor fields",
    );
    expect(normalizedLifecycle).toContain(
      "do not route the same recovery origin back through this workflow's BLOCKED handling as a new recovery attempt",
    );
    expect(normalizedLifecycle).toContain(
      "Row lifecycle events and cleanup projections remain row-owned and unchanged by episode transitions",
    );
    expect(skillSource).not.toContain("\n## Controller Lifecycle Ledger\n");

    expect(normalizedHandlingStatus).toContain(
      "Before acting on any returned status, update the lifecycle ledger for that session with the status and the artifacts that status actually provides",
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
      "The cleanup gate must not close a task implementer while same-session spec-compliance or code-quality reviewer fix loops may still route fixups back to that implementer session",
    );
    expect(normalizedHandlingStatus).toContain(
      "If a spawned implementer reports BLOCKED after slot-limit recovery succeeds and the blocker family already appears in the lifecycle ledger for that task",
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
    const task3PreSpawnCleanup = sliceBetween(
      task3Section,
      "[Cleanup gate before Task 3 implementer spawn]",
      "[Snapshot classification]",
    );
    const targetCapabilityExamples = sliceBetween(
      exampleWorkflow,
      "[Alternative target capability examples - separate runs",
      "Done!",
    );
    const abnormalTerminalVariants = sliceBetween(
      targetCapabilityExamples,
      "[Abnormal terminal lifecycle variants - separate runs]",
      "[Normal cleanup gate projection variants - separate runs]",
    );
    const followupTimeoutVariant = sliceBetween(
      abnormalTerminalVariants,
      "Returned reviewer follow-up timeout:",
      "Returned reviewer follow-up failure:",
    );
    const followupFailureVariant = sliceBetween(
      abnormalTerminalVariants,
      "Returned reviewer follow-up failure:",
      "Timed-out then superseded:",
    );
    const timedOutSupersededVariant = sliceBetween(
      abnormalTerminalVariants,
      "Timed-out then superseded:",
      "Failed then superseded:",
    );
    const failedSupersededVariant = abnormalTerminalVariants.slice(
      abnormalTerminalVariants.indexOf("Failed then superseded:"),
    );
    const normalGateVariants = sliceBetween(
      targetCapabilityExamples,
      "[Normal cleanup gate projection variants - separate runs]",
      "[Open capacity-blocker classification variants - separate runs]",
    );
    const openCapacityVariants = sliceBetween(
      targetCapabilityExamples,
      "[Open capacity-blocker classification variants - separate runs]",
      "[Isolated lifecycle supersession hypothetical - separate run, not an executor route]",
    );
    const inventoryOnlyVariant = sliceBetween(
      targetCapabilityExamples,
      "[Inventory-only target variant]",
      "[Tracked-ID-only inventory-only target variant]",
    );
    const trackedInventoryVariant = sliceBetween(
      targetCapabilityExamples,
      "[Tracked-ID-only inventory-only target variant]",
      "[Unavailable-to-close reevaluation - separate run]",
    );
    const unavailableReevaluationVariant = sliceBetween(
      targetCapabilityExamples,
      "[Unavailable-to-close reevaluation - separate run]",
      "[Automatic-close retry projection - separate run]",
    );
    const slotLimitAutomaticCloseFailure = sliceBetween(
      targetCapabilityExamples,
      "[Slot-limit pure inventory-only blocker and terminal retry failure - separate run]",
      "[Slot-limit mixed tagged blockers - separate run]",
    );
    const slotLimitMixedBlockers = sliceBetween(
      targetCapabilityExamples,
      "[Slot-limit mixed tagged blockers - separate run]",
      "[Slot-limit spawn failure on cleanup-unavailable target - separate run]",
    );
    const slotLimitRetainedSession = sliceBetween(
      targetCapabilityExamples,
      "[Slot-limit row-only blocker and terminal retry success - separate run]",
      "[Resolved-retention cleanup projection variants - separate runs]",
    );
    const resolvedRetentionVariants = sliceBetween(
      targetCapabilityExamples,
      "[Resolved-retention cleanup projection variants - separate runs]",
      "[Slot-limit pure inventory-only blocker and terminal retry failure - separate run]",
    );
    const resolvedRetentionUnavailable = sliceBetween(
      resolvedRetentionVariants,
      "Unavailable after resolution:",
      "Successful close after resolution:",
    );
    const resolvedRetentionSuccess = resolvedRetentionVariants.slice(
      resolvedRetentionVariants.indexOf("Successful close after resolution:"),
    );
    const slotLimitUnavailable = sliceBetween(
      targetCapabilityExamples,
      "[Slot-limit spawn failure on cleanup-unavailable target - separate run]",
      "[Repeated blocker-family branch in the cleanup-unavailable run]",
    );
    const taggedRecoveryReferenceErrors = (example: string): string[] => {
      const errors: string[] = [];
      const tagged = /^(ledger-row|inventory-only):[A-Za-z0-9._-]+$/;
      for (const match of example.matchAll(/blockers=\[([^\]]*)\]/g)) {
        const blockers = (match[1] ?? "")
          .split(",")
          .map((value) => value.trim());
        if (
          blockers.length === 0 ||
          blockers.some((value) => !tagged.test(value))
        ) {
          errors.push("untagged-snapshot-blocker");
        }
      }
      for (const match of example.matchAll(/blocker=([^,)]+)/g)) {
        if (!tagged.test((match[1] ?? "").trim())) {
          errors.push("untagged-authorization-blocker");
        }
      }
      return [...new Set(errors)];
    };
    const checkpointRow = (
      source: string,
      checkpoint: string,
      role: string,
    ): string => {
      const lines = source.split("\n");
      for (const [checkpointIndex, line] of lines.entries()) {
        if (line !== checkpoint) {
          continue;
        }
        const segment = lines.slice(checkpointIndex + 1);
        const nextCheckpoint = segment.findIndex((candidate) =>
          candidate.startsWith("["),
        );
        const checkpointLines =
          nextCheckpoint < 0 ? segment : segment.slice(0, nextCheckpoint);
        const rowStart = checkpointLines.findIndex((candidate) =>
          candidate.startsWith(`${role}:`),
        );
        if (rowStart < 0) {
          continue;
        }
        const rowLines = [checkpointLines[rowStart]];
        for (const candidate of checkpointLines.slice(rowStart + 1)) {
          if (
            /^(?:Task \d+ .+|final-code-quality-reviewer):/u.test(candidate)
          ) {
            break;
          }
          rowLines.push(candidate);
        }
        return normalizeWhitespace(rowLines.join("\n"));
      }
      throw new Error(`${checkpoint} row for ${role} not found`);
    };
    const normalReturnedCaptureErrors = (source: string): string[] => {
      const turns = [...source.matchAll(/turn-completed\(status=[^)]+\)/gu)];
      for (const [turnNumber, turn] of turns.entries()) {
        const turnIndex = turn.index ?? -1;
        const intervalEnd = turns[turnNumber + 1]?.index ?? source.length;
        const interval = source.slice(turnIndex + turn[0].length, intervalEnd);
        const capture = interval.match(
          /required-state-captured\(evidence=[^)]+\)/u,
        );
        const cleanupIndexes = [
          interval.indexOf("close-deferred"),
          interval.indexOf("close-attempted"),
          interval.indexOf("closure-unavailable"),
        ].filter((index) => index >= 0);
        if (
          capture?.index === undefined ||
          (cleanupIndexes.length > 0 &&
            Math.min(...cleanupIndexes) <= capture.index)
        ) {
          return ["normal-return-capture"];
        }
      }
      return [];
    };
    const expectSuccessfulCleanupRow = (row: string): void => {
      expect(normalReturnedCaptureErrors(row)).toEqual([]);
      expect(row).toContain("cleanup evaluation=evaluated");
      expect(row).toContain("close-attempted");
      expect(row).toContain("close-succeeded");
      expect(row).toContain("cleanup outcome=closed=yes");
      expect(row.indexOf("close-attempted")).toBeLessThan(
        row.indexOf("close-succeeded"),
      );
    };
    const expectDeferredCleanupRow = (row: string): void => {
      expect(normalReturnedCaptureErrors(row)).toEqual([]);
      expect(row).toContain("cleanup evaluation=evaluated");
      expect(row).toContain("close-deferred");
      expect(
        row.includes("close-deferred(reason=") ||
          row.includes("close-deferred reason history=["),
      ).toBe(true);
      expect(row).toContain("retention reason=");
      expect(row).toContain("cleanup outcome=closed=no");
      expect(row).not.toContain("close-attempted");
      expect(row).not.toContain("close-failed");
    };
    const historicalDeferralErrors = (
      row: string,
      expectedReasons: string[],
    ): string[] => {
      const errors: string[] = [];
      const deferredIndex = row.indexOf("close-deferred reason history=[");
      const resolvedIndex = row.indexOf("event=retention-resolved(");
      const attemptedIndex = row.indexOf("close-attempted");
      if (
        deferredIndex < 0 ||
        expectedReasons.some((reason) => !row.includes(reason))
      ) {
        errors.push("deferral-reason-history");
      }
      if (
        !row.includes("post-resolution cleanup evaluation=evaluated") ||
        !row.includes("current cleanup decision=none") ||
        !row.includes("current retention reason=absent") ||
        !row.includes("current unavailable-cleanup reason=absent") ||
        !row.includes("cleanup outcome=closed=no")
      ) {
        errors.push("current-cleanup-projection");
      }
      if (
        !/event=retention-resolved\(basis=need-finished, evidence=[^)]+\)/u.test(
          row,
        )
      ) {
        errors.push("retention-resolution-evidence");
      }
      if (
        deferredIndex < 0 ||
        resolvedIndex < 0 ||
        attemptedIndex < 0 ||
        deferredIndex >= resolvedIndex ||
        resolvedIndex >= attemptedIndex
      ) {
        errors.push("append-only-event-order");
      }
      return errors;
    };
    const normalGateProjectionErrors = (checkpoint: string): string[] => {
      const normalizedCheckpoint = normalizeWhitespace(checkpoint);
      const errors: string[] = [];
      for (const family of [
        "successful closure",
        "deliberate deferral with reason",
        "failed-attempt `closed=no`",
        "unavailable closure with reason",
      ]) {
        if (!normalizedCheckpoint.includes(family)) {
          errors.push(`missing-${family}`);
        }
      }
      return errors;
    };
    const actualTask3GateErrors = (checkpoint: string): string[] => {
      const normalizedCheckpoint = normalizeWhitespace(checkpoint);
      const errors: string[] = [];
      if (
        !normalizedCheckpoint.includes("every Task 2 row") ||
        !normalizedCheckpoint.includes("event=close-succeeded") ||
        !normalizedCheckpoint.includes("cleanup outcome=closed=yes")
      ) {
        errors.push("actual-task2-close-state");
      }
      for (const unreachableFamily of [
        "close-deferred",
        "close-failed",
        "close-unavailable",
      ]) {
        if (normalizedCheckpoint.includes(unreachableFamily)) {
          errors.push("mixed-actual-and-variant-trace");
          break;
        }
      }
      return errors;
    };
    const manualConfirmationErrors = (
      section: string,
      rowId: string,
      episodeId: string,
      honestOutcome: string,
    ): string[] => {
      const normalizedSection = normalizeWhitespace(section);
      const errors: string[] = [];
      const confirmation = "event=manual-cleanup-confirmed(";
      const confirmationIndex = normalizedSection.indexOf(confirmation);
      const confirmationEnd =
        confirmationIndex < 0
          ? -1
          : normalizedSection.indexOf(")", confirmationIndex);
      const confirmationEvent =
        confirmationIndex < 0 || confirmationEnd < 0
          ? ""
          : normalizedSection.slice(confirmationIndex, confirmationEnd + 1);
      const reconstructionIndex = normalizedSection.indexOf("reconstruct");
      const retryIndex = Math.max(
        normalizedSection.lastIndexOf("retry"),
        normalizedSection.lastIndexOf("retries"),
      );
      if (confirmationIndex < 0) errors.push("manual-confirmation-absent");
      if (
        confirmationIndex >= 0 &&
        !confirmationEvent.includes(`episode=${episodeId}`)
      ) {
        errors.push("manual-confirmation-episode");
      }
      if (
        confirmationIndex >= 0 &&
        !confirmationEvent.includes(`blocker=${rowId}`)
      ) {
        errors.push("manual-confirmation-scope");
      }
      if (!normalizedSection.includes(honestOutcome)) {
        errors.push("honest-outcome-lost");
      }
      if (
        confirmationIndex < 0 ||
        reconstructionIndex < 0 ||
        retryIndex < 0 ||
        confirmationIndex >= reconstructionIndex ||
        reconstructionIndex >= retryIndex
      ) {
        errors.push("manual-confirmation-order");
      }
      if (normalizedSection.includes("closed=yes")) {
        errors.push("manual-confirmation-fabricates-close");
      }
      return errors;
    };
    const pendingIntegrationErrors = (row: string): string[] => {
      const errors: string[] = [];
      if (!row.includes("controller-local integration-result state=pending")) {
        errors.push("integration-pending");
      }
      if (
        !row.includes("reviewer disposition absent") ||
        row.includes("current reviewer disposition=") ||
        row.includes("reviewer disposition history=[") ||
        row.includes("reviewer-disposition-classified")
      ) {
        errors.push("pending-disposition-boundary");
      }
      return errors;
    };
    const returnHistoryErrors = (row: string): string[] => {
      const errors: string[] = [];
      if (
        !row.includes(
          "turn-completed status history=[DONE, DONE_WITH_CONCERNS]",
        )
      ) {
        errors.push("turn-status-history");
      }
      if (!row.includes("workflow return history=[DONE, DONE_WITH_CONCERNS]")) {
        errors.push("workflow-return-history");
      }
      if (!row.includes("current workflow return status=DONE_WITH_CONCERNS")) {
        errors.push("workflow-return-projection");
      }
      return errors;
    };
    const dispositionHistoryErrors = (row: string): string[] => {
      const errors: string[] = [];
      if (!row.includes("reviewer disposition history=[advisory(")) {
        errors.push("advisory-history");
      }
      if (!row.includes(", stale(")) errors.push("stale-history");
      if (!row.includes("current reviewer disposition=stale")) {
        errors.push("reviewer-disposition-projection");
      }
      return errors;
    };
    const abnormalTerminalErrors = (section: string): string[] => {
      const errors: string[] = [];
      if (
        !section.includes("operational state=timed-out") ||
        !section.includes("turn-timed-out(reason=")
      ) {
        errors.push("timeout-detail");
      }
      if (
        !section.includes("operational state=failed") ||
        !section.includes("turn-failed(error=")
      ) {
        errors.push("failure-detail");
      }
      if (
        !section.includes("workflow return status absent") ||
        !section.includes("workflow return history absent")
      ) {
        errors.push("absent-return-history");
      }
      if (!section.includes("detail captured before cleanup")) {
        errors.push("abnormal-state-capture");
      }
      return errors;
    };
    const abnormalFollowupHistoryErrors = (
      section: string,
      terminal: "timed-out" | "failed",
      disposition: "advisory" | "final-findings",
    ): string[] => {
      const errors: string[] = [];
      const terminalEvent =
        terminal === "timed-out"
          ? "turn-timed-out(reason="
          : "turn-failed(error=";
      if (
        !section.includes("turn-completed(status=findings-recorded)") ||
        !section.includes("followup-dispatch-requested") ||
        !section.includes(terminalEvent) ||
        !section.includes(`current operational state=${terminal}`)
      ) {
        errors.push("followup-terminal-history");
      }
      if (
        !section.includes("workflow return history=[findings-recorded]") ||
        !section.includes("current workflow return status=findings-recorded") ||
        !section.includes("adds no new return value")
      ) {
        errors.push("followup-return-preservation");
      }
      if (
        !section.includes(`reviewer disposition history=[${disposition}(`) ||
        !section.includes(`current reviewer disposition=${disposition}`)
      ) {
        errors.push("followup-disposition-preservation");
      }
      if (!section.includes("captured before cleanup")) {
        errors.push("followup-abnormal-capture");
      }
      return errors;
    };
    const completedFollowupGuardErrors = (
      section: string,
      sessionId: string,
    ): string[] => {
      const errors: string[] = [];
      const followupIndex = section.indexOf(
        `followup-dispatch-requested(session-id=${sessionId})`,
      );
      const completedIndex = section.lastIndexOf(
        "turn-completed(",
        followupIndex,
      );
      const captureIndex = [
        ...section.matchAll(/required-state-captured\(evidence=[^)]+\)/gu),
      ]
        .map((match) => match.index ?? -1)
        .filter((index) => index < followupIndex)
        .at(-1);
      if (!section.includes(`agent_id=${sessionId} is stable`)) {
        errors.push("followup-stable-identity");
      }
      if (
        !section.includes("prior operational state=completed") ||
        !section.includes("turn-completed(")
      ) {
        errors.push("followup-completed-evidence");
      }
      if (
        !section.includes("observed same-session reuse capability=positive")
      ) {
        errors.push("followup-reuse-capability");
      }
      if (
        !section.includes(
          `followup-dispatch-requested(session-id=${sessionId})`,
        )
      ) {
        errors.push("followup-matching-identity");
      }
      if (captureIndex === undefined || captureIndex <= completedIndex) {
        errors.push("followup-capture-order");
      }
      return errors;
    };
    const abnormalSupersessionErrors = (
      section: string,
      terminalEvent: "turn-timed-out" | "turn-failed",
    ): string[] => {
      const errors: string[] = [];
      const terminalIndex = section.indexOf(`events retain ${terminalEvent}(`);
      const requiredCaptureIndex = section.indexOf("required-state-captured(");
      const abnormalCaptureIndex = section.indexOf(
        "abnormal-context-captured(",
      );
      const supersededIndex = section.lastIndexOf("then superseded");
      if (
        terminalIndex < 0 ||
        requiredCaptureIndex <= terminalIndex ||
        abnormalCaptureIndex <= requiredCaptureIndex ||
        supersededIndex <= abnormalCaptureIndex ||
        !section.includes("current operational state=superseded")
      ) {
        errors.push("abnormal-supersession-history");
      }
      if (
        !section.includes("abnormal capture state=captured") ||
        !section.includes("cleanup eligibility=eligible") ||
        !section.includes("cleanup evaluation=not-evaluated") ||
        !section.includes("cleanup outcome=closed=no") ||
        !section.includes("Only afterward may the cleanup gate evaluate it")
      ) {
        errors.push("abnormal-supersession-capture-gate");
      }
      return errors;
    };
    const unavailableReasonHistoryErrors = (
      section: string,
      reason: string,
    ): string[] => {
      const errors = normalReturnedCaptureErrors(section);
      if (!section.includes(`closure-unavailable(reason=${reason})`)) {
        errors.push("unavailable-event-reason");
      }
      if (!section.includes(`unavailable-reason history=[${reason}]`)) {
        errors.push("unavailable-reason-history");
      }
      if (!section.includes(`current unavailable-cleanup reason=${reason}`)) {
        errors.push("current-unavailable-reason");
      }
      return errors;
    };
    const unavailableReevaluationErrors = (section: string): string[] => {
      const errors = unavailableReasonHistoryErrors(
        section,
        "stable identity missing",
      );
      if (
        !section.includes("event=close-attempted then event=close-succeeded") ||
        !section.includes("cleanup outcome=closed=yes")
      ) {
        errors.push("reevaluated-close-projection");
      }
      if (
        !section.includes("current unavailable-cleanup reason is cleared") ||
        !section.includes(
          "unavailable-reason history=[stable identity missing] remain append-only",
        )
      ) {
        errors.push("reevaluation-history-preservation");
      }
      return errors;
    };
    const executorInterruptedReuseRequirements = [
      "agent_id=support-1 is stable",
      "observed reuse capability=positive",
      "current operational state=interrupted",
      "events end with interrupted then required-state-captured, so capture is newer than interruption",
      "event=interrupted-reuse-dispatch-requested(session-id=support-1)",
      "projects current operational state=active",
      "preserves all prior events",
      "adds no turn-completed event or workflow return",
      "guarded reuse or deliberate retention requires no replacement",
      "supersession alone requires event=replacement-secured first",
    ] as const;
    const openCapacityErrors = (section: string): string[] => {
      const errors: string[] = [];
      for (const [name, evidence] of [
        [
          "active",
          "Active row: wait or steer to a safe boundary and capture required state. After fresh capture, deliberate retention requires no replacement; supersession requires current event=replacement-secured",
        ],
        [
          "waiting",
          "Waiting row: capture the open question and context, then retain or safely replace",
        ],
        [
          "pending",
          "Pending or unknown row: resolve identity or stop; do not fabricate cleanup or close another row",
        ],
      ] as const) {
        if (!section.includes(evidence)) errors.push(`missing-${name}`);
      }
      for (const evidence of executorInterruptedReuseRequirements) {
        if (!section.includes(evidence)) errors.push(evidence);
      }
      return errors;
    };

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
      "operational state=pending, events=[dispatch-requested]",
    );
    expect(exampleWorkflow).toContain(
      "operational state=active, events=[dispatch-requested, identity-assigned]",
    );
    expect(exampleWorkflow).toContain(
      "operational state=completed, event=turn-completed(status=DONE)",
    );
    expect(exampleWorkflow).not.toContain("event=turn-completed,");
    expect(exampleWorkflow).not.toContain("event=turn-completed appended");
    expect(exampleWorkflow).toContain("operational state=superseded");
    expect(exampleWorkflow).toContain("event=superseded");
    expect(exampleWorkflow).toContain("prior events retained");
    expect(exampleWorkflow).not.toMatch(
      /:\s+status=(?:DONE|findings-recorded)/,
    );
    expect(exampleWorkflow).toContain(
      "Every later implementer, reviewer, re-reviewer, and final reviewer dispatch gets its own row",
    );
    expect(exampleWorkflow).toContain(
      "cleanup evaluation is `not-evaluated` only before that row's first cleanup gate",
    );
    expect(exampleWorkflow).toContain(
      "Every cleanup gate transitions each examined row to `evaluated`",
    );
    expect(normalizeWhitespace(task1Section)).toContain(
      "operational state=completed, event=turn-completed(status=DONE) appended after dispatch-requested and identity-assigned, event=required-state-captured(evidence=report, base/head SHA, changed files, snapshot state, and test state captured), workflow return history=[DONE], current workflow return status=DONE, cleanup evaluation=not-evaluated, cleanup outcome=closed=no because reviewer fix loops may still need same-session follow-up",
    );
    expect(task1Section).toContain(
      "Parallel happy path: same-head spec and quality pass",
    );
    expect(task1Section).toContain("base/head SHA captured (head pending)");
    expect(task1Section).toContain("Lifecycle cleanup checkpoint");
    expect(task1Section).toContain("cleanup outcome=closed=yes");
    for (const role of [
      "Task 1 implementer",
      "Task 1 spec reviewer",
      "Task 1 code-quality reviewer",
    ]) {
      expectSuccessfulCleanupRow(
        checkpointRow(task1Section, "[Lifecycle cleanup checkpoint]", role),
      );
    }
    const task1ImplementerCleanup = checkpointRow(
      task1Section,
      "[Lifecycle cleanup checkpoint]",
      "Task 1 implementer",
    );
    expect(
      historicalDeferralErrors(task1ImplementerCleanup, [
        "same implementer session must remain available for reviewer fixups",
      ]),
    ).toEqual([]);
    expect(
      historicalDeferralErrors(
        task1ImplementerCleanup.replace(
          "event=retention-resolved(basis=need-finished, evidence=reviewer loops passed and same-session follow-up finished)",
          "event=retention-resolved(basis=need-finished, evidence=)",
        ),
        ["same implementer session must remain available for reviewer fixups"],
      ),
    ).toEqual(["retention-resolution-evidence"]);
    expect(task3Section).toContain("snapshot state=skipped");
    expect(actualTask3GateErrors(task3PreSpawnCleanup)).toEqual([]);
    expect(
      actualTask3GateErrors(
        task3PreSpawnCleanup.replace(
          "event=close-succeeded",
          "event=close-failed",
        ),
      ),
    ).toEqual(["actual-task2-close-state", "mixed-actual-and-variant-trace"]);
    expect(normalGateProjectionErrors(normalGateVariants)).toEqual([]);
    expect(
      normalGateProjectionErrors(
        normalizeWhitespace(normalGateVariants).replace(
          "deliberate deferral with reason, failed-attempt `closed=no`, ",
          "",
        ),
      ),
    ).toEqual([
      "missing-deliberate deferral with reason",
      "missing-failed-attempt `closed=no`",
    ]);
    expect(normalizeWhitespace(task3Section)).toContain(
      "The implementer must report the default DONE fields: status, summary, tests, files changed, base SHA, and head SHA.",
    );
    expect(normalizeWhitespace(task3Section)).toContain(
      "Status: DONE - Summary: Clarified one example sentence in a neutral demo note - Tests: Not applicable beyond final render/check suite - Files changed: docs/examples/demo-note.md - Base SHA: task-3-base - Head SHA: task-3-head",
    );

    expect(task2Section).toContain("Spec-failure stale-quality path");
    expect(normalReturnedCaptureErrors(task2Section)).toEqual([]);
    expect(
      normalReturnedCaptureErrors(
        task2Section.replace(
          "event=required-state-captured(evidence=report, base/head SHA, changed files, snapshot state, and test state captured)",
          "required state omitted",
        ),
      ),
    ).toEqual(["normal-return-capture"]);
    for (const reviewer of [
      "Task 2 spec reviewer",
      "Task 2 code-quality reviewer",
    ]) {
      const pendingIntegrationRow = checkpointRow(
        task2Section,
        "[Same-head integration checkpoint before classification]",
        reviewer,
      );
      expect(pendingIntegrationErrors(pendingIntegrationRow)).toEqual([]);
      expect(
        pendingIntegrationErrors(
          pendingIntegrationRow.replace(
            "reviewer disposition absent",
            "current reviewer disposition=pending",
          ),
        ),
      ).toEqual(["pending-disposition-boundary"]);
    }
    expect(task2Section).toContain(
      "Cleanup gate before Task 2 spec re-review spawn",
    );
    expect(task2Section).toContain(
      "Cleanup gate before Task 2 code-quality re-reviewer spawn",
    );
    expect(task2Section).toContain(
      "Task 2 code-quality reviewer: agent_id=quality-2, operational state=completed, event=turn-completed(status=findings-recorded), event=required-state-captured(evidence=review scope, report, concrete findings, base/head SHA, and integrated state captured) retained, workflow return history=[findings-recorded], current workflow return status=findings-recorded",
    );
    expect(task2Section).toContain(
      "findings captured: Missing progress reporting",
    );
    expect(task2Section).toContain("routing target=Task 2 implementer");
    expect(task2Section).toContain("re-review target=spec-2-rereview");
    expect(normalizeWhitespace(task2Section)).toContain("report refreshed");
    expect(normalizeWhitespace(task2Section)).toContain("test state refreshed");
    expect(normalizeWhitespace(task2Section)).toContain(
      "snapshot state=emitted",
    );
    expect(task2Section).toContain("[Revalidate effective review route]");
    expect(task2Section).toContain(
      "Controller compares the original Task 2 base SHA to the refreshed task head",
    );
    expect(task2Section).toContain("The route may only preserve or escalate");
    expect(task2Section).toContain("so continue to spec re-review");
    expect(task2Section).toContain("code-quality re-review");
    expect(task2Section).toContain("findings captured: Magic number (100)");
    expect(task2Section).toContain("re-review target=quality-2-rereview");
    expect(task2Section).toContain(
      "event=followup-dispatch-requested(session-id=impl-2) appended after the first returned-turn capture; all prior events retained",
    );
    expect(normalizeWhitespace(task2Section)).toContain(
      "event=turn-completed(status=DONE_WITH_CONCERNS) appended, then event=required-state-captured(evidence=refreshed report, base/head SHA, changed files, snapshot state, and test state captured), workflow return history=[DONE, DONE_WITH_CONCERNS], current workflow return status=DONE_WITH_CONCERNS",
    );
    expect(task2Section).toContain(
      "reviewer disposition history=[advisory(reason=same-head quality findings are non-final until spec disposition, source-state=task-2-head), stale(reason=task head advanced after fixup, source-state=task-2-fixup-head)], current reviewer disposition=stale",
    );
    expect(task2Section).not.toContain(
      "Task 2 code-quality reviewer: operational state=superseded",
    );
    expect(task2Section).toContain(
      "workflow return history=[findings-recorded]",
    );
    expect(task2Section).not.toContain("quality-backup-1");
    expect(task2Section).not.toContain("backup reviewer");
    expect(task2Section).not.toContain(
      "Independent actual session supersession",
    );
    expect(task2Section).toContain(
      "Task 2 code-quality re-reviewer: operational state=completed, event=turn-completed(status=DONE), event=required-state-captured(evidence=review scope, base/head SHA, reviewed head SHA, and report captured), workflow return history=[DONE], current workflow return status=DONE",
    );
    expect(task2Section).not.toContain(
      "Task 2 code-quality re-reviewer: status=PASS",
    );

    const firstTask2Return = checkpointRow(
      task2Section,
      "[Lifecycle ledger update]",
      "Task 2 implementer",
    );
    expect(firstTask2Return).toContain("operational state=completed");
    expect(firstTask2Return).toContain("workflow return status=DONE");
    expect(firstTask2Return).toContain("event=turn-completed(status=DONE)");
    expect(firstTask2Return).toContain("workflow return history=[DONE]");
    expect(firstTask2Return).toContain("cleanup evaluation=not-evaluated");
    expect(firstTask2Return).toContain("cleanup outcome=closed=no");
    expect(firstTask2Return).not.toMatch(
      /close-(?:deferred|attempted|failed|succeeded)/u,
    );
    expectDeferredCleanupRow(
      checkpointRow(
        task2Section,
        "[Cleanup gate before Task 2 reviewer spawn]",
        "Task 2 implementer",
      ),
    );

    for (const role of [
      "Task 2 implementer",
      "Task 2 spec reviewer",
      "Task 2 spec re-reviewer",
      "Task 2 code-quality reviewer",
      "Task 2 code-quality re-reviewer",
    ]) {
      expectSuccessfulCleanupRow(
        checkpointRow(task2Section, "[Lifecycle cleanup checkpoint]", role),
      );
    }
    const task2ImplementerCleanup = checkpointRow(
      task2Section,
      "[Lifecycle cleanup checkpoint]",
      "Task 2 implementer",
    );
    const task2DeferralReasons = [
      "same implementer session must remain available for reviewer fixups",
      "routed same-head findings need same-session fixup",
      "spec re-review and any required code-quality re-review or disposition are pending",
      "spec and required quality dispositions are not yet final",
      "code-quality findings may still require same-session follow-up",
    ];
    expect(
      historicalDeferralErrors(task2ImplementerCleanup, task2DeferralReasons),
    ).toEqual([]);
    expect(
      historicalDeferralErrors(
        task2ImplementerCleanup.replace(
          "event=retention-resolved(basis=need-finished, evidence=all required reviewer loops passed and same-session fixup need finished)",
          "event=retention-resolved(basis=need-finished, evidence=)",
        ),
        task2DeferralReasons,
      ),
    ).toEqual(["retention-resolution-evidence"]);
    expect(returnHistoryErrors(task2ImplementerCleanup)).toEqual([]);
    expect(
      returnHistoryErrors(
        task2ImplementerCleanup.replaceAll(
          "DONE, DONE_WITH_CONCERNS",
          "DONE_WITH_CONCERNS",
        ),
      ),
    ).toEqual(["turn-status-history", "workflow-return-history"]);
    expect(
      historicalDeferralErrors(
        task2ImplementerCleanup.replace(
          /close-deferred reason history=\[[^\]]+\] retained, /u,
          "",
        ),
        task2DeferralReasons,
      ),
    ).toEqual(["deferral-reason-history", "append-only-event-order"]);

    const activeFollowupRow = checkpointRow(
      task2Section,
      "[Same-session follow-up dispatch]",
      "Task 2 implementer",
    );
    expect(activeFollowupRow).toContain("operational state=active");
    expect(activeFollowupRow).toContain("workflow return status=DONE");
    expectDeferredCleanupRow(activeFollowupRow);
    expect(activeFollowupRow).toContain("workflow return history=[DONE]");
    expect(completedFollowupGuardErrors(activeFollowupRow, "impl-2")).toEqual(
      [],
    );
    for (const [from, to, error] of [
      [
        "followup-dispatch-requested(session-id=impl-2)",
        "followup-dispatch-requested",
        "followup-matching-identity",
      ],
      ["session-id=impl-2", "session-id=other", "followup-matching-identity"],
      [
        "observed same-session reuse capability=positive",
        "reuse capability absent",
        "followup-reuse-capability",
      ],
      [
        "observed same-session reuse capability=positive",
        "observed same-session reuse capability=negative",
        "followup-reuse-capability",
      ],
    ] as const) {
      expect(
        completedFollowupGuardErrors(
          activeFollowupRow.replace(from, to),
          "impl-2",
        ),
      ).toContain(error);
    }
    expectDeferredCleanupRow(
      checkpointRow(
        task2Section,
        "[Cleanup gate before Task 2 spec re-review spawn]",
        "Task 2 implementer",
      ),
    );
    const task2QualityCleanup = checkpointRow(
      task2Section,
      "[Lifecycle cleanup checkpoint]",
      "Task 2 code-quality reviewer",
    );
    expect(dispositionHistoryErrors(task2QualityCleanup)).toEqual([]);
    expect(
      dispositionHistoryErrors(
        task2QualityCleanup.replace(
          "reviewer disposition history=[advisory(",
          "reviewer disposition history=[(",
        ),
      ),
    ).toEqual(["advisory-history"]);
    expectSuccessfulCleanupRow(
      checkpointRow(
        task2Section,
        "[Cleanup gate before Task 2 code-quality re-reviewer spawn]",
        "Task 2 spec re-reviewer",
      ),
    );
    expectDeferredCleanupRow(
      checkpointRow(
        task2Section,
        "[Cleanup gate before Task 2 code-quality re-reviewer spawn]",
        "Task 2 implementer",
      ),
    );

    expect(normalizeWhitespace(task3Section)).toContain(
      "cleanup outcome=closed=yes after the effective route completed",
    );
    expectSuccessfulCleanupRow(
      checkpointRow(
        task3Section,
        "[Lifecycle cleanup checkpoint]",
        "Task 3 implementer",
      ),
    );
    expect(exampleWorkflow).toContain(
      "Cleanup gate before final code-quality reviewer spawn",
    );
    expect(exampleWorkflow).toContain("final-code-quality-reviewer");
    expect(exampleWorkflow).toContain("review scope captured");
    const finalReviewerPreDispatch = checkpointRow(
      exampleWorkflow,
      "[Cleanup gate before final code-quality reviewer spawn]",
      "final-code-quality-reviewer",
    );
    expect(finalReviewerPreDispatch).toContain(
      "cleanup evaluation=not-evaluated",
    );
    expect(finalReviewerPreDispatch).toContain("cleanup outcome=closed=no");
    expect(finalReviewerPreDispatch).not.toContain("workflow return status=");
    expect(finalReviewerPreDispatch).not.toContain("reviewer disposition=");
    expectSuccessfulCleanupRow(
      checkpointRow(
        exampleWorkflow,
        "[Lifecycle cleanup checkpoint]",
        "final-code-quality-reviewer",
      ),
    );

    expect(targetCapabilityExamples).toContain(
      "inventory-only: target exposes session inventory but no close operation",
    );
    expect(abnormalTerminalErrors(abnormalTerminalVariants)).toEqual([]);
    expect(
      abnormalTerminalErrors(
        abnormalTerminalVariants.replaceAll(
          "turn-timed-out(reason=",
          "turn-timed-out(detail=",
        ),
      ),
    ).toEqual(["timeout-detail"]);
    expect(
      abnormalFollowupHistoryErrors(
        followupTimeoutVariant,
        "timed-out",
        "advisory",
      ),
    ).toEqual([]);
    expect(
      completedFollowupGuardErrors(followupTimeoutVariant, "reviewer-timeout"),
    ).toEqual([]);
    expect(
      abnormalFollowupHistoryErrors(
        followupFailureVariant,
        "failed",
        "final-findings",
      ),
    ).toEqual([]);
    expect(
      completedFollowupGuardErrors(followupFailureVariant, "reviewer-failure"),
    ).toEqual([]);
    expect(
      abnormalFollowupHistoryErrors(
        followupTimeoutVariant.replace(
          "workflow return history=[findings-recorded]",
          "workflow return history=[]",
        ),
        "timed-out",
        "advisory",
      ),
    ).toEqual(["followup-return-preservation"]);
    expect(
      abnormalFollowupHistoryErrors(
        followupFailureVariant.replace(
          "reviewer disposition history=[final-findings(",
          "reviewer disposition history=[(",
        ),
        "failed",
        "final-findings",
      ),
    ).toEqual(["followup-disposition-preservation"]);
    expect(
      abnormalSupersessionErrors(timedOutSupersededVariant, "turn-timed-out"),
    ).toEqual([]);
    expect(
      abnormalSupersessionErrors(failedSupersededVariant, "turn-failed"),
    ).toEqual([]);
    const abnormalMutation = (events: string[]): string =>
      `events retain ${events.join(" then ")} current operational state=superseded abnormal capture state=captured cleanup eligibility=eligible cleanup evaluation=not-evaluated cleanup outcome=closed=no Only afterward may the cleanup gate evaluate it`;
    for (const terminal of ["turn-timed-out", "turn-failed"] as const) {
      const terminalEvent = `${terminal}(`;
      const requiredCapture = "required-state-captured(";
      const abnormalCapture = "abnormal-context-captured(";
      for (const events of [
        [terminalEvent, abnormalCapture, "superseded"],
        [terminalEvent, requiredCapture, "superseded"],
        [requiredCapture, terminalEvent, abnormalCapture, "superseded"],
        [abnormalCapture, terminalEvent, requiredCapture, "superseded"],
        [terminalEvent, "superseded", requiredCapture, abnormalCapture],
      ]) {
        expect(
          abnormalSupersessionErrors(abnormalMutation(events), terminal),
        ).toContain("abnormal-supersession-history");
      }
    }
    expect(
      unavailableReasonHistoryErrors(
        normalGateVariants,
        "no usable close operation",
      ),
    ).toEqual([]);
    expect(
      unavailableReasonHistoryErrors(
        inventoryOnlyVariant,
        "inventory-only; no close operation",
      ),
    ).toEqual([]);
    expect(
      unavailableReasonHistoryErrors(
        trackedInventoryVariant,
        "tracked stable identity; no close operation",
      ),
    ).toEqual([]);
    expect(
      unavailableReevaluationErrors(unavailableReevaluationVariant),
    ).toEqual([]);
    expect(
      unavailableReevaluationErrors(
        unavailableReevaluationVariant.replace(
          "unavailable-reason history=[stable identity missing] remain append-only",
          "unavailable-reason history=[]",
        ),
      ),
    ).toEqual(["reevaluation-history-preservation"]);
    expect(
      unavailableReasonHistoryErrors(
        slotLimitUnavailable,
        "no inventory or close operation",
      ),
    ).toEqual([]);
    expect(
      unavailableReasonHistoryErrors(
        slotLimitUnavailable.replace(
          "event=required-state-captured(evidence=completed role state and source anchors captured)",
          "required state omitted",
        ),
        "no inventory or close operation",
      ),
    ).toEqual(["normal-return-capture"]);
    expect(
      unavailableReasonHistoryErrors(
        trackedInventoryVariant.replace(
          "unavailable-reason history=[tracked stable identity; no close operation]",
          "unavailable-reason history=[]",
        ),
        "tracked stable identity; no close operation",
      ),
    ).toEqual(["unavailable-reason-history"]);
    expect(openCapacityErrors(openCapacityVariants)).toEqual([]);
    for (const evidence of executorInterruptedReuseRequirements) {
      expect(
        openCapacityErrors(
          openCapacityVariants.replace(
            evidence,
            "weakened interrupted reuse example",
          ),
        ),
      ).toContain(evidence);
    }
    expect(
      openCapacityErrors(
        openCapacityVariants.replace(
          "Active row: wait or steer to a safe boundary and capture required state. After fresh capture, deliberate retention requires no replacement; supersession requires current event=replacement-secured. ",
          "Active row: clean up manually. ",
        ),
      ),
    ).toEqual(["missing-active"]);
    expect(
      openCapacityErrors(
        openCapacityVariants.replace(
          "supersession requires current event=replacement-secured",
          "supersession needs no replacement",
        ),
      ),
    ).toContain("missing-active");
    expect(targetCapabilityExamples).toContain(
      "Isolated lifecycle supersession hypothetical - separate run, not an executor route",
    );
    expect(targetCapabilityExamples).toContain(
      "owning workflow authorizes one generic scoped support session",
    );
    expect(targetCapabilityExamples).toContain(
      "Pre-dispatch: agent_id=pending, role=scoped-support, operational state=pending, events=[dispatch-requested]",
    );
    expect(targetCapabilityExamples).toContain(
      "Post-dispatch: agent_id=support-1, role=scoped-support, operational state=active, events=[dispatch-requested, identity-assigned]",
    );
    expect(targetCapabilityExamples).toContain(
      "appends event=required-state-captured(evidence=assigned scope, source-state anchor, and replacement routing reason), then event=replacement-secured(evidence=replacement session is ready), then event=superseded",
    );
    expect(targetCapabilityExamples).toContain(
      "sets current operational state=superseded, preserves dispatch-requested and identity-assigned, and records no turn-completed event or workflow return status",
    );
    expect(targetCapabilityExamples).toContain(
      "Only afterward does the cleanup gate set cleanup evaluation=evaluated; with stable identity and usable closure, it appends event=close-attempted then event=close-succeeded and projects cleanup outcome=closed=yes",
    );
    expect(targetCapabilityExamples).toContain(
      "inventory-only: no inventory operation is exposed, but the controller retains tracked stable agent ids and no usable close operation",
    );
    expect(targetCapabilityExamples).toContain("event=closure-unavailable");
    expect(targetCapabilityExamples).toContain(
      "event=close-attempted, event=close-failed, cleanup outcome=closed=no",
    );
    expect(targetCapabilityExamples).toContain(
      "event=close-succeeded, cleanup outcome=closed=yes",
    );
    expect(slotLimitRetainedSession).toContain(
      "resolves whether same-session follow-up remains required",
    );
    expect(slotLimitRetainedSession).toContain(
      "event=required-state-captured(evidence=reviewer fixup state captured)",
    );
    expect(slotLimitRetainedSession).toContain(
      "event=replacement-secured(evidence=replacement handoff prepared)",
    );
    expect(slotLimitRetainedSession).toContain(
      "event=retention-resolved(basis=captured-and-replaced, evidence=reviewer fixup state captured and replacement handoff prepared)",
    );
    expect(slotLimitRetainedSession).toContain(
      "preserves the historical close-deferred event and its associated reason",
    );
    expect(slotLimitRetainedSession).toContain(
      "event=recovery-state-reconstructed, event=slot-retry-dispatched, and exactly one event=slot-retry-succeeded",
    );
    expect(slotLimitRetainedSession).toContain(
      "stops and escalates without dispatching",
    );
    expect(slotLimitMixedBlockers).toContain(
      "blockers=[ledger-row:impl-mixed, inventory-only:orphan-mixed]",
    );
    expect(slotLimitMixedBlockers).toContain(
      "does not fabricate a row for `inventory-only:orphan-mixed`",
    );
    const mixedAttempt =
      "event=close-attempted(event-id=impl-mixed-close-attempt-1, session-id=impl-mixed-session)";
    const mixedSuccess =
      "event=close-succeeded(event-id=impl-mixed-close-success-1, session-id=impl-mixed-session)";
    expect(slotLimitMixedBlockers).toContain(mixedAttempt);
    expect(slotLimitMixedBlockers).toContain(mixedSuccess);
    expect(slotLimitMixedBlockers.indexOf(mixedAttempt)).toBeLessThan(
      slotLimitMixedBlockers.indexOf(mixedSuccess),
    );
    const mixedClosedYes = "projects cleanup outcome=closed=yes";
    expect(slotLimitMixedBlockers).toContain(mixedClosedYes);
    expect(slotLimitMixedBlockers.indexOf(mixedSuccess)).toBeLessThan(
      slotLimitMixedBlockers.indexOf(mixedClosedYes),
    );
    const mixedCloseReferenceErrors = (example: string): string[] => {
      const errors: string[] = [];
      if (
        !example.includes(
          "Row `impl-mixed`, owned by session `impl-mixed-session`",
        ) ||
        !example.includes(mixedSuccess)
      ) {
        errors.push("row-close-identity");
      }
      if (
        !example.includes(
          "reference(blocker=ledger-row:impl-mixed, row-id=impl-mixed, session-id=impl-mixed-session, close-succeeded-event-id=impl-mixed-close-success-1)",
        )
      ) {
        errors.push("row-close-reference");
      }
      return errors;
    };
    expect(mixedCloseReferenceErrors(slotLimitMixedBlockers)).toEqual([]);
    expect(
      mixedCloseReferenceErrors(
        slotLimitMixedBlockers.replace(
          "close-succeeded-event-id=impl-mixed-close-success-1)",
          "close-succeeded-event-id=impl-mixed-close-success-0)",
        ),
      ),
    ).toEqual(["row-close-reference"]);
    expect(slotLimitMixedBlockers).toContain(
      "blocker=inventory-only:orphan-mixed",
    );
    expect(slotLimitMixedBlockers).toContain(
      "All episode transitions leave the row cleanup projection closed=yes and its row history unchanged",
    );
    expect(slotLimitMixedBlockers).toContain(
      "Row close evidence cannot substitute for the inventory-only confirmation",
    );
    expect(slotLimitMixedBlockers).toContain(
      "Only after both exact tagged blockers authorize",
    );
    for (const example of [
      slotLimitRetainedSession,
      slotLimitAutomaticCloseFailure,
      slotLimitMixedBlockers,
      slotLimitUnavailable,
    ]) {
      expect(taggedRecoveryReferenceErrors(example)).toEqual([]);
    }
    expect(
      taggedRecoveryReferenceErrors(
        slotLimitAutomaticCloseFailure.replace(
          "blockers=[inventory-only:orphan-inventory]",
          "blockers=[orphan-inventory]",
        ),
      ),
    ).toContain("untagged-snapshot-blocker");
    expect(
      taggedRecoveryReferenceErrors(
        slotLimitAutomaticCloseFailure.replace(
          "blocker=inventory-only:orphan-inventory",
          "blocker=orphan-inventory",
        ),
      ),
    ).toContain("untagged-authorization-blocker");
    expect(
      manualConfirmationErrors(
        slotLimitRetainedSession,
        "ledger-row:impl-retained",
        "episode-row-1",
        "leaves the row projection unchanged at closed=no",
      ),
    ).toEqual([]);
    const retainedSlotRecoveryErrors = (example: string): string[] => {
      const errors: string[] = [];
      const resolutionIndex = example.indexOf("event=retention-resolved(");
      const deferralIndex = example.indexOf("event=close-deferred(reason=");
      const captureIndex = example.indexOf(
        "event=required-state-captured(evidence=reviewer fixup state captured)",
      );
      const replacementIndex = example.indexOf(
        "event=replacement-secured(evidence=replacement handoff prepared)",
      );
      const capturedResolutionIndex = example.indexOf(
        "event=retention-resolved(basis=captured-and-replaced, evidence=reviewer fixup state captured and replacement handoff prepared)",
      );
      const afterResolution =
        resolutionIndex < 0 ? "" : example.slice(resolutionIndex);
      if (
        !example.includes("event=close-deferred(reason=") ||
        !example.includes("close-deferred reason history=[")
      ) {
        errors.push("retention-resolution-without-deferral");
      }
      if (
        !example.includes(
          "preserves the historical close-deferred event and its associated reason",
        )
      ) {
        errors.push("retained-reason-history");
      }
      if (
        capturedResolutionIndex < 0 ||
        deferralIndex >= captureIndex ||
        captureIndex >= replacementIndex ||
        replacementIndex >= capturedResolutionIndex
      ) {
        errors.push("retention-resolution-evidence");
      }
      if (
        !afterResolution.includes("keeps cleanup evaluation=evaluated") ||
        !afterResolution.includes("sets current cleanup decision=none") ||
        !afterResolution.includes("current retention reason=absent") ||
        !afterResolution.includes(
          "current unavailable-cleanup reason=absent",
        ) ||
        !afterResolution.includes("cleanup outcome=closed=no") ||
        afterResolution.includes("current cleanup decision=retained") ||
        afterResolution.includes(
          "current retention reason=reviewer fixups require same-session follow-up",
        )
      ) {
        errors.push("stale-current-retention");
      }
      const attemptIndex = example.indexOf("event=close-attempted");
      const failureIndex = example.indexOf("event=close-failed");
      const confirmationIndex = example.indexOf(
        "event=manual-cleanup-confirmed(",
      );
      const reconstructIndex = example.indexOf(
        "event=recovery-state-reconstructed",
      );
      if (
        resolutionIndex < 0 ||
        attemptIndex <= resolutionIndex ||
        failureIndex <= attemptIndex ||
        confirmationIndex <= failureIndex ||
        reconstructIndex <= confirmationIndex
      ) {
        errors.push("retention-resolution-order");
      }
      if (
        !example.includes(
          "event=slot-recovery-started(origin=origin-row-1, episode=episode-row-1, blockers=[ledger-row:impl-retained])",
        ) ||
        !example.includes(
          "event=manual-cleanup-confirmed(episode=episode-row-1, blocker=ledger-row:impl-retained",
        ) ||
        /event=close-(?:attempted|succeeded|failed)\(episode=/u.test(example)
      ) {
        errors.push("current-episode-evidence");
      }
      if (
        !example.includes(
          "this exact tagged authorization is not row closure proof",
        ) ||
        !example.includes("leaves the row projection unchanged at closed=no") ||
        !example.includes("event=slot-retry-dispatched") ||
        !example.includes("exactly one event=slot-retry-succeeded")
      ) {
        errors.push("manual-confirmation-retry-boundary");
      }
      if (
        !example.includes(
          "The consumed origin `origin-row-1` cannot dispatch again or start another episode",
        )
      ) {
        errors.push("stale-episode-rejected");
      }
      if (!example.includes("stops and escalates without dispatching")) {
        errors.push("unresolved-retention-escalation");
      }
      return errors;
    };
    expect(retainedSlotRecoveryErrors(slotLimitRetainedSession)).toEqual([]);
    expect(
      retainedSlotRecoveryErrors(
        slotLimitRetainedSession.replace(
          "historical event=close-deferred(reason=reviewer fixups require same-session follow-up)",
          "historical deferral omitted(reason=reviewer fixups require same-session follow-up)",
        ),
      ),
    ).toEqual(["retention-resolution-without-deferral"]);
    expect(
      retainedSlotRecoveryErrors(
        slotLimitRetainedSession.replace(
          "event=retention-resolved(basis=captured-and-replaced, evidence=reviewer fixup state captured and replacement handoff prepared)",
          "event=retention-resolved(basis=captured-and-replaced, evidence=)",
        ),
      ),
    ).toEqual(["retention-resolution-evidence"]);
    expect(
      retainedSlotRecoveryErrors(
        slotLimitRetainedSession.replace(
          "sets current cleanup decision=none",
          "keeps current cleanup decision=retained",
        ),
      ),
    ).toEqual(["stale-current-retention"]);
    expect(
      retainedSlotRecoveryErrors(
        slotLimitRetainedSession.replace(
          "event=manual-cleanup-confirmed(episode=episode-row-1",
          "event=manual-cleanup-confirmed(episode=episode-row-0",
        ),
      ),
    ).toEqual(["current-episode-evidence"]);
    expect(
      retainedSlotRecoveryErrors(
        slotLimitRetainedSession.replace(
          "event=close-attempted followed by event=close-failed",
          "event=close-attempted(episode=episode-row-1) followed by event=close-failed",
        ),
      ),
    ).toEqual(["current-episode-evidence"]);
    expect(
      retainedSlotRecoveryErrors(
        slotLimitRetainedSession.replace(
          "stops and escalates without dispatching",
          "dispatches anyway",
        ),
      ),
    ).toEqual(["unresolved-retention-escalation"]);
    const resolvedProjectionErrors = (
      example: string,
      family: "unavailable" | "success",
    ): string[] => {
      const errors: string[] = [];
      const resolutionIndex = example.indexOf("event=retention-resolved(");
      const afterResolution =
        resolutionIndex < 0 ? "" : example.slice(resolutionIndex);
      const laterFamilyIndex = afterResolution.indexOf("The later");
      const resolutionProjection =
        laterFamilyIndex < 0
          ? afterResolution
          : afterResolution.slice(0, laterFamilyIndex);
      if (
        !example.includes("event=close-deferred(reason=") ||
        resolutionIndex < 0 ||
        !resolutionProjection.includes(
          "cleanup evaluation remains evaluated",
        ) ||
        !resolutionProjection.includes("current cleanup decision=none") ||
        !resolutionProjection.includes("current retention reason=absent") ||
        !resolutionProjection.includes(
          "current unavailable-cleanup reason=absent",
        ) ||
        !resolutionProjection.includes("cleanup outcome=closed=no") ||
        resolutionProjection.includes("current cleanup decision=retained")
      ) {
        errors.push("resolved-projection-history");
      }
      if (
        !afterResolution.includes("preserving the close-deferred reason") ||
        !afterResolution.includes("retention-resolved evidence")
      ) {
        errors.push("resolved-projection-preservation");
      }
      if (
        (family === "unavailable" &&
          (!resolutionProjection.includes(
            "basis=captured-and-replaced, evidence=follow-up state captured and follow-up need safely replaced",
          ) ||
            example.indexOf("event=required-state-captured(") <=
              example.indexOf("event=close-deferred(") ||
            example.indexOf("event=replacement-secured(") <=
              example.indexOf("event=required-state-captured(") ||
            resolutionIndex <=
              example.indexOf("event=replacement-secured("))) ||
        (family === "success" &&
          !resolutionProjection.includes(
            "basis=need-finished, evidence=follow-up finished",
          ))
      ) {
        errors.push("retention-resolution-predicate");
      }
      if (
        family === "unavailable" &&
        (!afterResolution.includes("event=closure-unavailable(reason=") ||
          !afterResolution.includes("unavailable-reason history=[") ||
          !afterResolution.includes(
            "cleanup outcome=close-unavailable: no usable close operation",
          ))
      ) {
        errors.push("resolved-unavailable-family");
      }
      if (
        family === "success" &&
        (!afterResolution.includes(
          "event=close-attempted then event=close-succeeded",
        ) ||
          !afterResolution.includes("cleanup outcome=closed=yes"))
      ) {
        errors.push("resolved-success-family");
      }
      return errors;
    };
    expect(
      resolvedProjectionErrors(resolvedRetentionUnavailable, "unavailable"),
    ).toEqual([]);
    expect(
      resolvedProjectionErrors(resolvedRetentionSuccess, "success"),
    ).toEqual([]);
    expect(
      resolvedProjectionErrors(
        resolvedRetentionUnavailable.replace(
          "follow-up state captured and follow-up need safely replaced",
          "follow-up state captured",
        ),
        "unavailable",
      ),
    ).toEqual(["retention-resolution-predicate"]);
    expect(
      resolvedProjectionErrors(
        resolvedRetentionUnavailable.replace(
          "current cleanup decision=none",
          "current cleanup decision=retained",
        ),
        "unavailable",
      ),
    ).toEqual(["resolved-projection-history"]);
    expect(
      resolvedProjectionErrors(
        resolvedRetentionSuccess.replace(
          "event=close-attempted then event=close-succeeded",
          "event=close-succeeded",
        ),
        "success",
      ),
    ).toEqual(["resolved-success-family"]);
    const terminalInventoryFailureErrors = (example: string): string[] => {
      const errors: string[] = [];
      const reconstructIndex = example.indexOf(
        "event=recovery-state-reconstructed",
      );
      const dispatchIndex = example.indexOf("event=slot-retry-dispatched");
      const failureIndex = example.indexOf("event=slot-retry-failed");
      if (
        reconstructIndex < 0 ||
        dispatchIndex <= reconstructIndex ||
        failureIndex < 0 ||
        dispatchIndex >= failureIndex
      ) {
        errors.push("terminal-retry-order");
      }
      if (
        !example.includes(
          "event=slot-recovery-started(origin=origin-inventory-1, episode=episode-inventory-1, blockers=[inventory-only:orphan-inventory])",
        ) ||
        !example.includes(
          "event=manual-cleanup-confirmed(episode=episode-inventory-1, blocker=inventory-only:orphan-inventory",
        )
      ) {
        errors.push("exact-inventory-binding");
      }
      if (
        !example.includes(
          "No session row is created for that pure inventory blocker",
        ) ||
        /Row `orphan-inventory`|ledger-row:orphan-inventory/u.test(example)
      ) {
        errors.push("fabricated-inventory-row");
      }
      if (
        !example.includes(
          'stored episode escalation={"inventory":"unavailable","remainingBlockers":["inventory-only:orphan-inventory"]}',
        ) ||
        !example.includes(
          "The closed stored payload contains no extra fields, prompts, transcripts, logs, stack traces",
        )
      ) {
        errors.push("closed-stored-escalation");
      }
      if (
        !example.includes(
          "The consumed origin `origin-inventory-1` cannot retry or start another recovery episode",
        )
      ) {
        errors.push("consumed-origin-reuse");
      }
      return errors;
    };
    expect(
      terminalInventoryFailureErrors(slotLimitAutomaticCloseFailure),
    ).toEqual([]);
    expect(
      manualConfirmationErrors(
        slotLimitAutomaticCloseFailure,
        "inventory-only:orphan-inventory",
        "episode-inventory-1",
        "a row close event cannot authorize this blocker",
      ),
    ).toEqual([]);
    expect(
      manualConfirmationErrors(
        slotLimitAutomaticCloseFailure.replace(
          "event=manual-cleanup-confirmed(episode=episode-inventory-1, blocker=inventory-only:orphan-inventory",
          "event=manual-cleanup-confirmed(episode=episode-inventory-1, blocker=ledger-row:orphan-inventory",
        ),
        "inventory-only:orphan-inventory",
        "episode-inventory-1",
        "a row close event cannot authorize this blocker",
      ),
    ).toEqual(["manual-confirmation-scope"]);
    expect(
      manualConfirmationErrors(
        slotLimitAutomaticCloseFailure.replace(
          "event=manual-cleanup-confirmed(episode=episode-inventory-1",
          "event=manual-cleanup-confirmed(episode=episode-inventory-0",
        ),
        "inventory-only:orphan-inventory",
        "episode-inventory-1",
        "a row close event cannot authorize this blocker",
      ),
    ).toEqual(["manual-confirmation-episode"]);
    expect(
      manualConfirmationErrors(
        slotLimitAutomaticCloseFailure.replace(
          "event=manual-cleanup-confirmed",
          "event=manual-cleanup-observed",
        ),
        "inventory-only:orphan-inventory",
        "episode-inventory-1",
        "a row close event cannot authorize this blocker",
      ),
    ).toEqual(["manual-confirmation-absent", "manual-confirmation-order"]);
    expect(
      manualConfirmationErrors(
        slotLimitUnavailable,
        "ledger-row:impl-unavailable",
        "episode-unavailable-1",
        "row's unavailable projection and histories remain unchanged",
      ),
    ).toEqual([]);
    expect(
      terminalInventoryFailureErrors(
        slotLimitAutomaticCloseFailure.replace(
          "event=recovery-state-reconstructed, event=slot-retry-dispatched, and exactly one event=slot-retry-failed",
          "event=slot-retry-failed, event=slot-retry-dispatched",
        ),
      ),
    ).toEqual(["terminal-retry-order"]);
    expect(
      terminalInventoryFailureErrors(
        slotLimitAutomaticCloseFailure.replace(
          "exactly one event=slot-retry-failed",
          "retry result is omitted",
        ),
      ),
    ).toEqual(["terminal-retry-order"]);
    expect(
      terminalInventoryFailureErrors(
        slotLimitAutomaticCloseFailure.replace(
          "No session row is created for that pure inventory blocker",
          "Row `orphan-inventory` is created for the inventory blocker",
        ),
      ),
    ).toEqual(["fabricated-inventory-row"]);
    expect(
      terminalInventoryFailureErrors(
        slotLimitAutomaticCloseFailure.replace(
          "The consumed origin `origin-inventory-1` cannot retry or start another recovery episode",
          "The consumed origin may retry again",
        ),
      ),
    ).toEqual(["consumed-origin-reuse"]);
    expect(
      terminalInventoryFailureErrors(
        slotLimitAutomaticCloseFailure.replace(
          'stored episode escalation={"inventory":"unavailable","remainingBlockers":["inventory-only:orphan-inventory"]}',
          'stored episode escalation={"inventory":"unavailable","remainingBlockers":["inventory-only:orphan-inventory"],"role":"reviewer"}',
        ),
      ),
    ).toEqual(["closed-stored-escalation"]);
    expect(targetCapabilityExamples).toContain(
      "first captures each completed session's role-specific state",
    );
    expect(targetCapabilityExamples).toContain(
      "close-unavailable: inventory-only; no close operation",
    );
    expect(targetCapabilityExamples).toContain(
      "cleanup-unavailable: target exposes neither inventory nor close operation",
    );
    expect(targetCapabilityExamples).toContain("Slot-limit spawn failure");
    expect(targetCapabilityExamples).toContain(
      "Controller classifies a slot-limit spawn failure as orchestration resource exhaustion, not task failure",
    );
    expect(slotLimitUnavailable).toContain(
      "event=closure-unavailable(reason=no inventory or close operation)",
    );
    expect(slotLimitUnavailable).toContain(
      "event=slot-recovery-started(origin=origin-unavailable-1, episode=episode-unavailable-1, blockers=[ledger-row:impl-unavailable])",
    );
    expect(slotLimitUnavailable).toContain(
      "event=manual-cleanup-confirmed(episode=episode-unavailable-1, blocker=ledger-row:impl-unavailable",
    );
    expect(slotLimitUnavailable).toContain(
      "Evidence from another episode, an untagged blocker, or an inventory-only confirmation cannot authorize this row blocker",
    );
    expect(slotLimitUnavailable).toContain(
      "event=recovery-state-reconstructed, event=slot-retry-dispatched, and event=slot-retry-succeeded",
    );
    expect(targetCapabilityExamples).toContain(
      "Repeated blocker-family branch",
    );
    expect(targetCapabilityExamples).toContain("Initial blocker-family record");
    expect(targetCapabilityExamples).toContain(
      "blocker state=context-missing: needs target install path",
    );
    expect(targetCapabilityExamples).toContain(
      "close-unavailable: no inventory or close operation after the BLOCKED report",
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
    const phase6Reference = await readRepoFile(
      "skills/issue-priming-workflow/references/phase-6-auto-handoff.md",
    );
    const phase6RecoveryParityErrors = (surface: string): string[] => {
      const normalizedSurface = normalizeWhitespace(surface);
      const errors: string[] = [];
      const snapshotPattern =
        /its (\S+) (\S+) (\S+) capacity-blocker snapshot/u;
      const snapshot = normalizedSurface.match(snapshotPattern);
      if (snapshot?.[1] !== "complete") errors.push("snapshot-completeness");
      if (snapshot?.[2] !== "immutable") errors.push("snapshot-immutability");
      if (snapshot?.[3] !== "exact-tag") errors.push("snapshot-exact-tag");

      const authorizationPattern =
        /Require (\S+) tagged snapshot blocker to pass the shared owner's (\S+) (\S+) authorization before reconstruction/u;
      const authorization = normalizedSurface.match(authorizationPattern);
      if (authorization?.[1] !== "every") {
        errors.push("every-blocker-authorization");
      }
      if (authorization?.[2] !== "kind-specific") {
        errors.push("kind-specific-evidence");
      }
      if (authorization?.[3] !== "current-episode") {
        errors.push("current-episode-binding");
      }
      if (!normalizedSurface.includes("authorizes only its exact blocker")) {
        errors.push("exact-blocker-manual-scope");
      }
      if (!normalizedSurface.includes("never the retry by itself")) {
        errors.push("manual-never-authorizes-retry");
      }
      if (
        !normalizedSurface.includes(
          "Complete all-blocker authorization is required before reconstruction",
        )
      ) {
        errors.push("complete-authorization-before-reconstruction");
      }
      if (
        !normalizedSurface.includes(
          "The shared owner finishes reconstruction before retry dispatch",
        )
      ) {
        errors.push("reconstruction-before-dispatch");
      }
      if (
        !normalizedSurface.includes(
          "The owner consumes exactly one retry dispatch",
        )
      ) {
        errors.push("exactly-one-dispatch");
      }
      if (
        !normalizedSurface.includes(
          "After that dispatch, the owner records exactly one terminal retry result",
        )
      ) {
        errors.push("exactly-one-terminal-result-after-dispatch");
      }
      return errors;
    };

    const phase6ParityMutations = [
      {
        error: "snapshot-completeness",
        from: "complete immutable exact-tag capacity-blocker snapshot",
        to: "partial immutable exact-tag capacity-blocker snapshot",
      },
      {
        error: "snapshot-immutability",
        from: "complete immutable exact-tag capacity-blocker snapshot",
        to: "complete mutable exact-tag capacity-blocker snapshot",
      },
      {
        error: "snapshot-exact-tag",
        from: "complete immutable exact-tag capacity-blocker snapshot",
        to: "complete immutable untagged capacity-blocker snapshot",
      },
      {
        error: "every-blocker-authorization",
        from: "Require every tagged snapshot blocker",
        to: "Require some tagged snapshot blocker",
      },
      {
        error: "kind-specific-evidence",
        from: "shared owner's kind-specific current-episode authorization",
        to: "shared owner's generic current-episode authorization",
      },
      {
        error: "current-episode-binding",
        from: "shared owner's kind-specific current-episode authorization",
        to: "shared owner's kind-specific stale-episode authorization",
      },
      {
        error: "exact-blocker-manual-scope",
        from: "authorizes only its exact blocker",
        to: "authorizes a different blocker",
      },
      {
        error: "manual-never-authorizes-retry",
        from: "never the retry by itself",
        to: "also the retry by itself",
      },
      {
        error: "complete-authorization-before-reconstruction",
        from: "Complete all-blocker authorization is required before reconstruction",
        to: "Reconstruction may begin before complete all-blocker authorization",
      },
      {
        error: "reconstruction-before-dispatch",
        from: "The shared owner finishes reconstruction before retry dispatch",
        to: "The shared owner may dispatch before reconstruction finishes",
      },
      {
        error: "exactly-one-dispatch",
        from: "The owner consumes exactly one retry dispatch",
        to: "The owner may consume two retry dispatches",
      },
      {
        error: "exactly-one-terminal-result-after-dispatch",
        from: "After that dispatch, the owner records exactly one terminal retry result",
        to: "After that dispatch, the owner may record multiple terminal retry results",
      },
    ] as const;

    for (const surface of [issuePhase6Section, phase6Reference]) {
      const normalizedSurface = normalizeWhitespace(surface);
      expect(phase6RecoveryParityErrors(surface)).toEqual([]);
      for (const mutation of phase6ParityMutations) {
        expect(normalizedSurface).toContain(mutation.from);
        expect(
          phase6RecoveryParityErrors(
            normalizedSurface.replace(mutation.from, mutation.to),
          ),
        ).toEqual([mutation.error]);
      }
      expect(normalizedSurface).toContain(
        "successful, unavailable, deliberately deferred, or failed-attempt cleanup history",
      );
      expect(normalizedSurface).toContain(
        "capture role-specific state, evaluate and record cleanup, then hand off",
      );
      expect(normalizedSurface).toContain(
        "Missing captured role state blocks the handoff",
      );
      expect(normalizedSurface).toContain(
        "slot-limit recovery remains blocked until actual closure or operator-confirmed manual cleanup",
      );
      expect(retentionResolutionProofErrors(normalizedSurface)).toEqual([]);
      expectRetentionResolutionMutations(normalizedSurface);
      expect(normalizedSurface.toLowerCase()).toContain(
        "preserve the historical `close-deferred` reason",
      );
      expect(
        normalizedSurface.includes(
          "cleanup evaluation remains `evaluated`, current cleanup decision is `none`, current retention and unavailable reasons are absent, and cleanup is `closed=no`",
        ),
      ).toBe(true);
      expect(normalizedSurface).toContain(
        "operator-confirmed manual cleanup bound to the current recovery episode and its",
      );
      expect(normalizedSurface).toContain(
        "Earlier episode evidence never authorizes the current retry",
      );
      expect(normalizedSurface).toContain(
        "A current-episode, blocker-scoped `manual-cleanup-confirmed` event",
      );
      expect(normalizedSurface).toContain(
        "authorizes only its exact blocker, never the retry by itself",
      );
      expect(normalizedSurface).toContain(
        "An unresolved need stops and escalates without retrying",
      );
      expect(normalizedSurface).toContain(
        "completed, timed-out, failed, or superseded gate and research sessions",
      );
      expect(normalizedSurface).toContain(
        "For timed-out or failed rows, preserve the value-bearing runtime terminal event, keep return status/history absent when no turn returned, and capture the gate or research error/blocker detail before cleanup",
      );
    }

    expect(issuePhase6Section).toContain(
      "Before the Phase 6 handoff, run the `subagent-lifecycle` cleanup gate",
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
