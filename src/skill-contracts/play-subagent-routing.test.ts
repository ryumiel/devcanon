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
      "After any auto-fix commit or mechanical-nit commit, rerun `branch-review --fix`",
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
    expect(
      issuePrimingWorkflow.indexOf("### Phase 7: Branch Review"),
    ).toBeLessThan(issuePrimingWorkflow.indexOf("### Phase 8: Create PR"));
    expect(normalizedPhase7).toContain("classification flow is `--auto` only");

    for (const heading of [
      "## Review Artifact Parsing",
      "## Blocker Stop Rules",
      "## Nit Classification",
      "## Mechanical Nit Commits",
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
      "Re-read the target file from disk before each edit",
    );
    expect(normalizeWhitespace(phase7Reference)).toContain(
      "Manual operators decide nit handling case by case",
    );

    expect(issuePrimingWorkflow).not.toContain("Project-Specific Overrides");
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
      "`skills/play-subagent-execution/references/snapshot-consumption.md` § Edit-Staleness Rule",
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
      expect(reducedRouteSurface).toContain("mechanical nit commits");
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
      "no additional mechanical nit commits after that review",
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
      "If the run commits any auto-fixes, regenerate risk signals for the new `HEAD` before rerunning `branch-review --fix --risk-signals <new-path>` with the same base-side rule",
    );
    expect(normalizedPhase7).toContain(
      "This runs the full multi-agent review on `git diff <base>...HEAD` where `<base>` is branch-review's selected base: normally the repository's default branch, or the supplied full base SHA for detached issue-base risk signals that use that same base side",
    );
    expect(normalizedPhase7).toContain(
      "If later mechanical nit handling creates any commit, rerun this same Branch Review step on the new `HEAD`",
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
      "After any auto-fix commit or mechanical-nit commit, rerun `branch-review --fix`",
    );
    expect(normalizedPhase7).toContain(
      "passing only risk signals regenerated for that `HEAD` when using `--risk-signals`",
    );
    expect(phase7Reference).toContain("Review head: <40-hex-sha>.");
    expect(phase7Reference).toContain("Findings written to <path>.");
    expect(phase7Reference).toContain("PLAY_REVIEW_HELPER");
    expect(phase7Reference).toContain("validate the findings path");
    expect(phase7Reference).toContain("prepare-judgment-nits");
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
      "no mechanical-nit commit after that review",
    );
    expect(normalizeWhitespace(phase8Reference)).toContain(
      "Pass `nits_file` only when Phase 7 prepared a judgment-required-nits envelope",
    );
    expect(normalizeWhitespace(phase8Reference)).toContain(
      "Do not pass mechanical nits to Phase 8",
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
        "If later mechanical nit handling creates any commit",
      ),
    );
    const mechanicalNitCommits = normalizeWhitespace(
      getMarkdownSection(phase7Reference, "Mechanical Nit Commits"),
    );

    expect(eagerContinuation).toContain(
      "captures that final run's approval-summary notice path",
    );
    expect(eagerContinuation).toContain(
      "findings whose `critic` verdict is `INVALID` or `DOWNGRADE`",
    );
    expect(mechanicalNitCommits).toContain(
      "captures that final run's approval-summary notice path",
    );
    expect(mechanicalNitCommits).toContain(
      "rerun `branch-review --fix` on the new `HEAD` and restart Phase 7",
    );
    expect(mechanicalNitCommits).toContain(
      "no additional mechanical nit commits after that review",
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
      "implementation and final review passed",
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
    expect(normalizedSingleTaskPlans).not.toContain(
      "the user can still run `branch-review` manually",
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
      "stop before `play-branch-finish` when the active workflow requires branch-level review before PR creation",
    );
    expect(normalizedExampleWorkflow).toContain(
      "report final review passed and resolve branch-level review status",
    );
    expect(normalizedExampleWorkflow).toContain(
      "stop for `branch-review` before `play-branch-finish` when the active workflow requires branch-level review before PR creation",
    );
    expect(normalizedExampleWorkflow).toContain(
      "otherwise invoke `play-branch-finish`",
    );
    expect(normalizedAdvantages).toContain(
      "final code-quality reviewer plus direct/manual branch-level review status resolution",
    );
    expect(normalizedRedFlags).toContain(
      "resolving branch-level review status on the direct/manual path",
    );
    expect(normalizedRedFlags).toContain(
      "a review-required workflow must stop for `branch-review` before `play-branch-finish`",
    );

    expect(normalizedProcessDiagrams).toContain(
      "Report implementation and final review passed; resolve branch-level review status",
    );
    expect(normalizedProcessDiagrams).toContain(
      "Active workflow requires branch-level review before PR creation?",
    );
    expect(normalizedProcessDiagrams).toContain(
      '"Active workflow requires branch-level review before PR creation?" -> "Stop for branch-review before play-branch-finish" [label="yes"]',
    );
    expect(normalizedProcessDiagrams).toContain(
      '"Active workflow requires branch-level review before PR creation?" -> "Invoke play-branch-finish" [label="no"]',
    );
    expect(normalizedProcessDiagrams).toContain(
      "If the active workflow requires branch-level review before PR creation, hand off to `branch-review` before any `play-branch-finish` handoff",
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
      "After the final whole-implementation review passes, the next action is to resolve the branch-level review status above and then either stop for required branch review or invoke `play-branch-finish`",
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
      "quality result disposition=stale; rerun quality unless irrelevance is proven",
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
      "the final whole-implementation reviewer remains the built-in implementation review before the direct/manual terminal handoff resolves branch-level review status",
    );
    expect(normalizedAdr0007).toContain(
      "Workflows that require branch-level review before PR creation must stop for `branch-review` before `play-branch-finish`",
    );
    expect(normalizedAdr0007).toContain(
      "only workflows without that requirement treat `branch-review` as optional additional coverage",
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
    expect(controllerLifecycleLedger).toContain(
      "reviewer result when relevant",
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
      "Do not infer support from another target",
    );

    expect(cleanupGateBeforeSpawns).toContain(
      "Before every new subagent spawn",
    );
    expect(normalizeWhitespace(cleanupGateBeforeSpawns)).toContain(
      "Capture the role-specific state needed by the owning workflow before closing or superseding any session",
    );
    expect(normalizeWhitespace(cleanupGateBeforeSpawns)).toContain(
      "Keep sessions open when the owning workflow still requires same-session follow-up",
    );
    expect(normalizeWhitespace(cleanupGateBeforeSpawns)).toContain(
      "Never record `closed=yes` unless the current target actually exposed stable ids plus a close operation",
    );

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
      "controller-local lifecycle ledger expectations",
      "target lifecycle capability classes",
      "target-honest cleanup outcomes",
      "cleanup gates before spawns",
      "slot-limit recovery and one retry after cleanup or manual confirmation",
    ]) {
      expect(decision).toContain(ownedSurface);
    }
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
      "role-specific captured state includes implementer reports, changed files, test results, snapshot state (`requested`, `emitted`, `skipped`, or `malformed`), reviewer scope, reviewer report, concrete findings, reviewer result disposition (`pending`, `final-pass`, `final-findings`, `advisory`, `stale`, or `superseded`), routing target, re-review target, task base/head SHA, reviewed head SHA, fixup count, and blocker state",
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
    const targetCapabilityExamples = sliceBetween(
      exampleWorkflow,
      "[Alternative target capability examples - separate runs",
      "Done!",
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
    expect(task2Section).toContain("so continue to spec re-review");
    expect(task2Section).toContain("code-quality re-review");
    expect(task2Section).toContain("findings captured: Magic number (100)");
    expect(task2Section).toContain("re-review target=quality-2-rereview");
    expect(task2Section).toContain(
      "quality result disposition=stale; rerun quality unless irrelevance is proven",
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
      "Cleanup gate before final code-quality reviewer spawn",
    );
    expect(exampleWorkflow).toContain("final-code-quality-reviewer");
    expect(exampleWorkflow).toContain("review scope captured");

    expect(targetCapabilityExamples).toContain(
      "inventory-only: target exposes session inventory but no close operation",
    );
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
