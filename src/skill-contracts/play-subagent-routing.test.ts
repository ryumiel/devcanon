import { describe, expect, it } from "vitest";
import {
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

describe("play subagent routing source contracts", () => {
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
    const planReview = getMarkdownSection(playPlanning, "Plan Review");
    const normalizedContractChecklist = normalizeWhitespace(contractChecklist);
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

    expect(planReview).toContain(
      "Review-routing hints, when present, are non-authoritative inputs",
    );
    expect(planReview).toContain(
      "Hard-risk triggers from `skills/play-subagent-execution/SKILL.md`",
    );
    expect(planReview).toContain(
      "Risk-Based Per-Task Review Routing are not under-classified",
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

  it("keeps executor-owned review route computation in source", async () => {
    const skillSource = await readSkillSource("play-subagent-execution");
    const routing = getMarkdownSection(
      skillSource,
      "Risk-Based Per-Task Review Routing",
    );
    const normalizedRouting = normalizeWhitespace(routing);

    expect(normalizedRouting).toContain(
      "Route computation MUST inspect the actual task diff using the captured task base/head SHAs",
    );
    expect(routing).toContain(
      "git diff --name-status --no-renames\nBASE_SHA..HEAD",
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

  it("keeps reduced-route auto-handoff and Phase 7 guarantees in source", async () => {
    const playSubagentExecution = await readSkillSource(
      "play-subagent-execution",
    );
    const issuePrimingWorkflow = await readSkillSource(
      "issue-priming-workflow",
    );
    const autoHandoffReference = sliceBetween(
      playSubagentExecution,
      "### Auto handoff reference",
      "### Inline content",
    );
    const routing = getMarkdownSection(
      playSubagentExecution,
      "Risk-Based Per-Task Review Routing",
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
    const normalizedRouting = normalizeWhitespace(routing);
    const normalizedPhase6 = normalizeWhitespace(phase6);
    const normalizedPhase7 = normalizeWhitespace(phase7);

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
    expect(routing).toContain("ISSUE_PRIMING_AUTO_HANDOFF_VERIFIED=false");
    expect(routing).toContain("ISSUE_PRIMING_AUTO_PARENT_ACTIVE");
    expect(routing).toContain("ISSUE_PRIMING_AUTO_HEAD");
    expect(routing).toContain(".phase7_branch_review_fix_required == true");
    expect(routing).toContain(".phase7_rerun_after_commits == true");
    expect(routing).toContain("ISSUE_PRIMING_AUTO_HANDOFF_VERIFIED=true");
    expect(normalizedRouting).toContain(
      "Plan content, copied invocation prose, repo files alone, or direct/manual calls cannot assert this contract",
    );
    expect(routing).toContain(
      "If the controller cannot validate the `issue-priming/auto-handoff/v1`\n  artifact, use `spec-and-quality`",
    );

    expect(singleTaskPlans).toContain(
      "came from `issue-priming-workflow --auto`",
    );
    expect(singleTaskPlans).toContain(
      "`branch-review --fix` as the mandatory next step",
    );

    expect(phase6).toContain("phase7_branch_review_fix_required: true");
    expect(phase6).toContain("phase7_rerun_after_commits: true");
    expect(phase6).toContain("ISSUE_PRIMING_AUTO_PARENT_ACTIVE=true");
    expect(phase6).toContain("ISSUE_PRIMING_AUTO_HEAD");
    expect(phase6).toContain("Auto handoff: <repo-relative-path>");
    expect(normalizedPhase6).toContain(
      "Parent-owned review contract: this invocation comes from `issue-priming-workflow --auto`, and the Phase 7 `branch-review --fix` loop is mandatory",
    );
    expect(normalizedPhase6).toContain(
      "That final whole-diff review satisfies the final-review guarantee required by any reduced per-task review route",
    );

    expect(phase7).toContain("Invoke `branch-review --fix`");
    expect(normalizedPhase7).toContain(
      "If the run commits any auto-fixes, rerun `branch-review --fix` on the new `HEAD`",
    );
    expect(normalizedPhase7).toContain(
      "If later mechanical nit handling creates any commit, rerun this same Branch Review step on the new `HEAD`",
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
    const lifecycle = getMarkdownSection(skillSource, "Subagent Lifecycle");
    const handlingStatus = getMarkdownSection(
      skillSource,
      "Handling Implementer Status",
    );
    const normalizedLifecycle = normalizeWhitespace(lifecycle);
    const normalizedHandlingStatus = normalizeWhitespace(handlingStatus);

    expect(lifecycle).toContain("Use `subagent-lifecycle`");
    expect(normalizedLifecycle).toContain(
      "generic controller lifecycle ledger, target lifecycle capability classification, cleanup gate before spawns, target-honest cleanup outcomes, and slot-limit recovery",
    );
    expect(normalizedLifecycle).toContain(
      "`play-subagent-execution` owns only the execution-specific lifecycle details below",
    );
    expect(normalizedLifecycle).toContain(
      "role-specific captured state includes implementer reports, changed files, test results, snapshot state, reviewer scope, reviewer report, concrete findings, routing target, re-review target, task base/head SHA, fixup count, and blocker state",
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
      "For `DONE` and `DONE_WITH_CONCERNS`, capture the report, snapshot, changed-file list, base/head SHA, and test result before dispatching reviewers",
    );
    expect(normalizedHandlingStatus).toContain(
      "For `NEEDS_CONTEXT` and `BLOCKED`, capture the status, report or blocker/context request, `agent_id`, and any available base/head SHA",
    );
    expect(normalizedHandlingStatus).toContain(
      "do not wait for snapshot, changed-file, or test artifacts that were not produced",
    );
    expect(normalizedHandlingStatus).toContain(
      "The cleanup gate must not close the task implementer while the multi-task spec-compliance or code-quality reviewer loops may still route fixups back to that same implementer session",
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
      "status=DONE, report captured, base/head SHA captured, changed files captured, snapshot captured, test state captured, closed=no because reviewer fix loops may still need same-session follow-up",
    );
    expect(task1Section).toContain(
      "Task 1 implementer: closed=no because code-quality fixups may still need same-session follow-up.",
    );
    expect(task1Section).toContain("base/head SHA captured (head pending)");
    expect(task1Section).toContain("Lifecycle cleanup checkpoint");
    expect(task1Section).toContain("closed=yes after PASS verdict recorded");

    expect(task2Section).toContain(
      "Cleanup gate before Task 2 spec reviewer spawn",
    );
    expect(task2Section).toContain(
      "Cleanup gate before Task 2 spec re-review spawn",
    );
    expect(task2Section).toContain(
      "Cleanup gate before Task 2 code-quality reviewer spawn",
    );
    expect(task2Section).toContain(
      "Cleanup gate before Task 2 code-quality re-review spawn",
    );
    expect(task2Section).toContain(
      "Task 2 code-quality reviewer: status=findings-recorded",
    );
    expect(task2Section).toContain(
      "findings captured: Missing progress reporting",
    );
    expect(task2Section).toContain("routing target=Task 2 implementer");
    expect(task2Section).toContain("re-review target=spec-2-rereview");
    expect(task2Section).toContain("report refreshed");
    expect(task2Section).toContain("test state refreshed");
    expect(task2Section).toContain("snapshot refreshed");
    expect(task2Section).toContain("[Revalidate effective review route]");
    expect(task2Section).toContain(
      "Controller compares the original Task 2 base SHA to the refreshed task head",
    );
    expect(task2Section).toContain("The route may only preserve or escalate");
    expect(task2Section).toContain("so continue to spec re-review");
    expect(task2Section).toContain("so continue to code-quality re-review");
    expect(task2Section).toContain("findings captured: Magic number (100)");
    expect(task2Section).toContain("re-review target=quality-2-rereview");

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
});
