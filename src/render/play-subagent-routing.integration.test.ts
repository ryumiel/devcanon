import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  expectOrdered,
  getSkillOutput,
  normalizeWhitespace,
} from "../__test-helpers__/render.js";
import { loadConfig } from "../config/load.js";
import { parseFrontmatter } from "./frontmatter.js";
import { renderAll } from "./pipeline.js";

describe("play-subagent planning and routing contracts", () => {
  it("pins reviewer prompt snapshot trust-boundary language", async () => {
    const repoRoot = process.cwd();
    const specReviewerPrompt = await readFile(
      path.join(
        repoRoot,
        "skills/play-subagent-execution/references/spec-reviewer-prompt.md",
      ),
      "utf-8",
    );
    const codeQualityReviewerPrompt = await readFile(
      path.join(
        repoRoot,
        "skills/play-subagent-execution/references/code-quality-reviewer-prompt.md",
      ),
      "utf-8",
    );

    for (const prompt of [specReviewerPrompt, codeQualityReviewerPrompt]) {
      expect(prompt).toContain("Read the implementation from disk");
      expect(prompt).toContain(
        "snapshots are for the controller's bookkeeping only",
      );
    }
    expect(specReviewerPrompt).toContain("Consume any content snapshot");
    expect(codeQualityReviewerPrompt).toContain(
      "Do not consume any content snapshot",
    );
  });

  it("documents planning composition and execution boundary contracts", async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    const { outputs } = await renderAll(config, false);
    const playSubagentExecutionBody = parseFrontmatter(
      getSkillOutput(outputs, "play-subagent-execution", "codex").content,
    ).body;
    const playPlanningBody = parseFrontmatter(
      getSkillOutput(outputs, "play-planning", "codex").content,
    ).body;
    const issuePrimingWorkflowBody = parseFrontmatter(
      getSkillOutput(outputs, "issue-priming-workflow", "codex").content,
    ).body;
    expect(playPlanningBody).toContain("## Cohesive Task Composition");
    expect(playPlanningBody).toContain(
      "share the same subsystem or file family",
    );
    expect(playPlanningBody).toContain(
      "Do not replace executable checkbox steps with vague high-level subtasks",
    );
    expect(playPlanningBody).toContain(
      "Do not hide dependent implementation units merely to avoid multi-task review",
    );
    const reviewHintSectionStart = playPlanningBody.indexOf(
      "### Optional Review-Routing Hint Fields",
    );
    const reviewHintSectionEnd = playPlanningBody.indexOf("## No Placeholders");
    expect(reviewHintSectionStart).toBeGreaterThanOrEqual(0);
    expect(reviewHintSectionEnd).toBeGreaterThan(reviewHintSectionStart);
    const reviewHintSection = playPlanningBody.slice(
      reviewHintSectionStart,
      reviewHintSectionEnd,
    );
    expect(reviewHintSection).toContain("**Execution:** single | composed");
    expect(reviewHintSection).toContain("**Risk hint:** low | medium | high");
    expect(reviewHintSection).toContain(
      "**Review hint:** none-final-only | spec-only | spec-and-quality",
    );
    expect(reviewHintSection).toContain("**Review rationale:**");
    expect(reviewHintSection).toContain("non-authoritative hints only");

    const planReviewSectionStart = playPlanningBody.indexOf("## Plan Review");
    const planReviewSectionEnd = playPlanningBody.indexOf(
      "## Execution Handoff",
    );
    expect(planReviewSectionStart).toBeGreaterThanOrEqual(0);
    expect(planReviewSectionEnd).toBeGreaterThan(planReviewSectionStart);
    const planReviewSection = playPlanningBody.slice(
      planReviewSectionStart,
      planReviewSectionEnd,
    );
    expect(planReviewSection).toContain(
      "High-risk triggers from `skills/play-subagent-execution/SKILL.md` §",
    );
    expect(planReviewSection).toContain(
      "Risk-Based Per-Task Review Routing are not under-classified",
    );
    expect(planReviewSection).toContain(
      "Unclear review classification defaults to `spec-and-quality`",
    );
    expect(planReviewSection).toContain(
      "Hint field ordering is heading, optional `**Mode:** mechanical`, optional",
    );

    const executionHandoffSectionStart = playPlanningBody.indexOf(
      "## Execution Handoff",
    );
    expect(executionHandoffSectionStart).toBeGreaterThanOrEqual(0);
    const executionHandoffSection = playPlanningBody.slice(
      executionHandoffSectionStart,
    );
    expect(executionHandoffSection).toContain(
      "I invoke play-subagent-execution for fresh subagents per task and executor-owned risk-based review routing",
    );
    expect(executionHandoffSection).toContain(
      "Fresh subagent per task + executor-owned risk-based per-task review routing",
    );
    expect(executionHandoffSection).toContain(
      "Reduced routes require the verified shared `issue-priming-workflow --auto` Phase 6 path",
    );
    expect(executionHandoffSection).not.toContain(
      "Fresh subagent per task + two-stage review",
    );

    const planningHintStart = playPlanningBody.indexOf(
      "Example mechanical-task header:",
    );
    const planningHintEnd = playPlanningBody.indexOf(
      "Omit the field for any task with judgment",
    );
    expect(planningHintStart).toBeGreaterThanOrEqual(0);
    expect(planningHintEnd).toBeGreaterThan(planningHintStart);
    const planningHintExample = playPlanningBody.slice(
      planningHintStart,
      planningHintEnd,
    );
    const modeIndex = planningHintExample.indexOf("**Mode:** mechanical");
    const executionIndex = planningHintExample.indexOf("**Execution:** single");
    expect(planningHintExample).toContain("### Task N: Rename Example Token");
    expect(planningHintExample).toContain(
      "Exact single-file identifier replacement with no hard-risk trigger",
    );
    expect(planningHintExample).toContain("- Modify: `examples/demo-note.md`");
    expect(planningHintExample).toContain("**Replace:** `OldExampleToken`");
    expect(planningHintExample).toContain("**With:** `NewExampleToken`");
    const riskIndex = planningHintExample.indexOf("**Risk hint:** low");
    const reviewIndex = planningHintExample.indexOf(
      "**Review hint:** none-final-only",
    );
    const rationaleIndex = planningHintExample.indexOf("**Review rationale:**");
    const filesIndex = planningHintExample.indexOf("**Files:**");
    expect(modeIndex).toBeGreaterThanOrEqual(0);
    expect(modeIndex).toBeLessThan(executionIndex);
    expect(executionIndex).toBeLessThan(riskIndex);
    expect(riskIndex).toBeLessThan(reviewIndex);
    expect(reviewIndex).toBeLessThan(rationaleIndex);
    expect(rationaleIndex).toBeLessThan(filesIndex);

    expect(playSubagentExecutionBody).toContain(
      "high-assurance serial execution",
    );
    expect(playSubagentExecutionBody).toContain(
      "preserves the task boundaries authored in the plan",
    );
    expect(playSubagentExecutionBody).toContain("does not regroup");
    expect(playSubagentExecutionBody).toContain(
      "adjacent tasks or runtime-batch by default",
    );
    expect(playSubagentExecutionBody).toContain("runtime batching would be a");
    expect(playSubagentExecutionBody).toContain(
      "separate policy change, not an implicit optimization",
    );
    expect(playSubagentExecutionBody).toContain(
      "bounded fast paths for single-task and mechanical cases",
    );
    const processSectionStart =
      playSubagentExecutionBody.indexOf("## The Process");
    const processSectionEnd =
      playSubagentExecutionBody.indexOf("## Model Selection");
    expect(processSectionStart).toBeGreaterThanOrEqual(0);
    expect(processSectionEnd).toBeGreaterThan(processSectionStart);
    const processSection = playSubagentExecutionBody.slice(
      processSectionStart,
      processSectionEnd,
    );
    expect(processSection).toContain("Compute effective review route");
    expect(processSection).toContain(
      '"Implementer agent implements, tests, commits, self-reviews" -> "Compute effective review route" [label="multi-task plan"]',
    );
    expect(processSection).toContain(
      '"Compute effective review route" -> "Dispatch the spec-compliance-reviewer agent (references/spec-reviewer-prompt.md)" [label="spec-and-quality or spec-only"]',
    );
    expect(processSection).toContain(
      '"Compute effective review route" -> "Mark task complete in TodoWrite" [label="none-final-only"]',
    );
    expect(processSection).toContain(
      '"Spec-compliance-reviewer agent confirms code matches spec?" -> "Mark task complete in TodoWrite" [label="yes, spec-only"]',
    );
    expect(processSection).toContain(
      '"Spec-compliance-reviewer agent confirms code matches spec?" -> "Dispatch the code-quality-reviewer agent (references/code-quality-reviewer-prompt.md)" [label="yes, spec-and-quality"]',
    );
    expect(processSection).toContain(
      '"Dispatch the code-quality-reviewer agent for entire implementation" -> "Owning caller final whole-diff gate present?"',
    );
    expect(processSection).toContain(
      '"Owning caller final whole-diff gate present?" -> "Return to caller (downstream full-diff review gate runs there)" [label="yes"]',
    );
    expect(processSection).toContain(
      '"Owning caller final whole-diff gate present?" -> "Use play-branch-finish" [label="no"]',
    );
    expect(processSection).toContain(
      "The diagram routes each multi-task task through effective route computation",
    );
    expect(processSection).not.toContain("full two-stage branch");
    expect(processSection).not.toContain(
      '"Implementer agent implements, tests, commits, self-reviews" -> "Dispatch the spec-compliance-reviewer agent (references/spec-reviewer-prompt.md)" [label="multi-task plan"]',
    );
    expect(processSection).not.toContain(
      '"Spec-compliance-reviewer agent confirms code matches spec?" -> "Dispatch the code-quality-reviewer agent (references/code-quality-reviewer-prompt.md)" [label="yes"]',
    );
    expect(processSection).not.toContain(
      '"Dispatch the code-quality-reviewer agent for entire implementation" -> "Use play-branch-finish"',
    );
    expect(playSubagentExecutionBody).toContain(
      "## Risk-Based Per-Task Review Routing",
    );
    const routingSectionStart = playSubagentExecutionBody.indexOf(
      "## Risk-Based Per-Task Review Routing",
    );
    const routingSectionEnd = playSubagentExecutionBody.indexOf(
      "## Single-Task Plans",
    );
    expect(routingSectionStart).toBeGreaterThanOrEqual(0);
    expect(routingSectionEnd).toBeGreaterThan(routingSectionStart);
    const routingSection = playSubagentExecutionBody.slice(
      routingSectionStart,
      routingSectionEnd,
    );
    const normalizedRoutingSection = normalizeWhitespace(routingSection);
    expect(routingSection).toContain(
      "`play-subagent-execution` owns reviewer dispatch",
    );
    expect(routingSection).toContain(
      "defaults missing, malformed, conflicting, unclear, or unverified",
    );
    expect(normalizedRoutingSection).toContain(
      "defaults missing, malformed, conflicting, unclear, or unverified classifications to `spec-and-quality`",
    );
    expect(normalizedRoutingSection).toContain(
      "Route computation MUST inspect the actual task diff",
    );
    expect(normalizedRoutingSection).toContain(
      "git diff --name-status --no-renames BASE_SHA..HEAD",
    );
    expect(normalizedRoutingSection).toContain(
      "If the changed-file/status/diff data is unavailable, stale, ambiguous, or shows an unplanned hard-risk trigger, fail closed to `spec-and-quality`",
    );
    expect(routingSection).toContain(
      "`spec-and-quality`: run the spec-compliance reviewer, then the code-quality",
    );
    expect(routingSection).toContain(
      "`spec-only`: run the spec-compliance reviewer only.",
    );
    expect(routingSection).toContain(
      "`none-final-only`: run no per-task reviewer for that task; rely on the",
    );
    expect(routingSection).toContain(
      "Reduced per-task routes (`spec-only` or `none-final-only`) are valid only on",
    );
    expect(routingSection).toContain(
      "shared `issue-priming-workflow --auto` Phase 6 path",
    );
    expect(normalizedRoutingSection).toContain(
      "Phase 7 immediately runs `branch-review --fix` on the full branch diff",
    );
    expect(normalizedRoutingSection).toContain(
      "rerunning it after any Phase 7 commit (auto-fixed blockers or mechanical nit fixes) until a run reports zero blocking findings auto-fixed, no remaining `Blocking` findings, and no additional mechanical nit commits after that review",
    );
    expect(normalizedRoutingSection).toContain(
      "This covers GitHub and Linear entrypoints because both delegate",
    );
    expect(normalizedRoutingSection).toContain(
      "plan content, copied invocation prose, or direct/manual calls cannot assert it",
    );
    expect(normalizedRoutingSection).toContain(
      "Any other caller must use `spec-and-quality` until this skill source explicitly adds that caller",
    );
    expect(normalizedRoutingSection).toContain(
      "If the controller cannot verify the shared issue-priming `--auto` Phase 6 handoff, use `spec-and-quality`",
    );
    expect(routingSection).toContain(
      "`spec-only` is allowed for medium-risk tasks when no hard-risk trigger",
    );
    expect(routingSection).toContain(
      "`none-final-only` is allowed for low-risk tasks when no hard-risk trigger",
    );
    expect(routingSection).toContain(
      "Hard-risk, unclear, malformed, conflicting, or untrusted classifications",
    );
    expect(routingSection).toContain(
      "Hard-risk triggers force `spec-and-quality`",
    );
    for (const trigger of [
      "public API changes",
      "schema/model/config changes",
      "generated output format changes",
      "install/sync behavior or user-home writes",
      "external CLI/API/system invocation substitutions",
      "async lifecycle, ordering, or concurrency changes",
      "security-sensitive behavior",
      "data-loss/destructive filesystem risk",
      "broad architecture changes",
      "reviewer-routing policy, hard review rules, workflow-policy changes",
      "ADR/spec/guideline/skill/agent contract changes",
      "documentation-policy, ownership, procedure, or AFDS workflow changes",
      "manifests, generated files, file deletions, file renames, file mode changes",
      "test harness or validation behavior changes that can mask regressions",
    ]) {
      expect(routingSection).toContain(trigger);
    }
    expect(routingSection).toContain(
      "Foundation-producing tasks receive at least `spec-only` before dependent",
    );
    expect(playSubagentExecutionBody).not.toContain(
      "For plans with **two or more** tasks, the per-task two-stage review",
    );
    expect(playSubagentExecutionBody).not.toContain(
      "two-stage review after each task for multi-task plans",
    );
    expect(playSubagentExecutionBody).not.toContain(
      "all multi-task plans run two-stage review",
    );
    expect(playSubagentExecutionBody).toContain(
      "## Controller Lifecycle Ledger",
    );
    expect(playSubagentExecutionBody).toContain("task id");
    expect(playSubagentExecutionBody).toContain("base/head SHA");
    expect(playSubagentExecutionBody).toContain(
      "one `agent_id` or `agent_id=pending`",
    );
    expect(playSubagentExecutionBody).toContain("role");
    expect(playSubagentExecutionBody).toContain("status");
    expect(playSubagentExecutionBody).toContain("role-specific captured state");
    expect(playSubagentExecutionBody).toContain("reviewer scope");
    expect(playSubagentExecutionBody).toContain("closed=yes");
    expect(playSubagentExecutionBody).toContain("closed=no");
    expect(playSubagentExecutionBody).toContain("close-unavailable: <reason>");
    expect(playSubagentExecutionBody).toContain("## Lifecycle State Machine");
    expect(playSubagentExecutionBody).toContain(
      "This diagram is a visual summary; the ledger fields and rules below are authoritative.",
    );
    expect(playSubagentExecutionBody).toContain(
      "close-unavailable: inventory-only; no close operation",
    );
    expect(playSubagentExecutionBody).toContain("reviewer result");
    expect(playSubagentExecutionBody).toContain("fixup count");
    expect(playSubagentExecutionBody).toContain("blocker state");
    expect(playSubagentExecutionBody).toContain(
      "## Target Lifecycle Capability",
    );
    expect(playSubagentExecutionBody).toContain("automatic-close-supported");
    expect(playSubagentExecutionBody).toContain("inventory-only");
    expect(playSubagentExecutionBody).toContain("cleanup-unavailable");
    expect(playSubagentExecutionBody).toContain(
      "Before every new subagent spawn",
    );
    expect(playSubagentExecutionBody).toContain(
      "orchestration resource exhaustion",
    );
    expect(playSubagentExecutionBody).toContain(
      "reconstruct active task state from the lifecycle ledger and git",
    );
    expect(playSubagentExecutionBody).toContain(
      "Wait for operator confirmation that manual cleanup is complete",
    );
    expect(playSubagentExecutionBody).toContain("retry the spawn exactly once");
    expect(playSubagentExecutionBody).toContain("agent_id=pending");
    expect(playSubagentExecutionBody).toContain(
      "review scope, base/head SHA, report, and PASS verdict",
    );
    expect(playSubagentExecutionBody).toContain(
      "concrete findings, routing target, and re-review target",
    );
    expect(playSubagentExecutionBody).toContain(
      "first capture the same role-specific state",
    );
    expect(playSubagentExecutionBody).toContain(
      "artifacts that status actually provides",
    );
    expect(playSubagentExecutionBody).toContain(
      "report or blocker/context request, `agent_id`, and any available base/head SHA",
    );
    expect(playSubagentExecutionBody).toContain(
      "do not wait for snapshot, changed-file, or test artifacts that were not produced",
    );
    expect(playSubagentExecutionBody).toContain(
      "The family is the text before the first colon",
    );
    expect(playSubagentExecutionBody).not.toContain(
      "high quality, fast iteration",
    );
    expect(playSubagentExecutionBody).not.toContain(
      "- Faster iteration (no human-in-loop between tasks)",
    );

    const playSubagentAdvantages = await readFile(
      path.join(
        repoRoot,
        "skills/play-subagent-execution/references/advantages.md",
      ),
      "utf-8",
    );
    expect(playSubagentAdvantages).toContain(
      "Serial-safe implementer isolation",
    );
    expect(playSubagentAdvantages).toContain(
      "Controller rereads may be reduced",
    );
    expect(playSubagentAdvantages).toContain("reviewers still read from disk");
    expect(playSubagentAdvantages).toContain(
      "Executor-owned risk-based review routing per task",
    );
    expect(playSubagentAdvantages).toContain("none-final-only");
    expect(playSubagentAdvantages).toContain(
      "verified shared\n  `issue-priming-workflow --auto` Phase 6 path",
    );
    expect(playSubagentAdvantages).toContain(
      "zero blocking findings auto-fixed, no remaining `Blocking`",
    );
    expect(playSubagentAdvantages).toContain(
      "no additional mechanical nit commits",
    );
    expect(playSubagentAdvantages).toContain(
      "remaining `Blocking` findings stop the workflow",
    );
    expect(playSubagentAdvantages).not.toContain("Parallel-safe");
    expect(playSubagentAdvantages).not.toContain("No file reading overhead");

    const playSubagentExampleWorkflow = await readFile(
      path.join(
        repoRoot,
        "skills/play-subagent-execution/references/example-workflow.md",
      ),
      "utf-8",
    );
    expect(playSubagentExampleWorkflow).toContain("coherent authored tasks");
    expect(playSubagentExampleWorkflow).toContain(
      "Each multi-task task follows the executor-computed",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "only\non the verified shared `issue-priming-workflow --auto` Phase 6 path",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "Effective route: `none-final-only`",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "Task 3: Low-risk example copy",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "Clarified one example sentence in a neutral demo note",
    );
    expect(playSubagentExampleWorkflow).not.toContain(
      "Task 3: Low-risk reference wording",
    );
    expect(playSubagentExampleWorkflow).not.toContain(
      "Clarified one example sentence in a reference file",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "Phase 7 reruns `branch-review --fix` after any auto-fix or mechanical-nit",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "reports zero blocking findings auto-fixed",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "`issue-priming-workflow` Phase 7 runs `branch-review --fix`",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "Branch review: no remaining `Blocking` findings",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "does not do runtime regrouping or batching",
    );
    expect(playSubagentExampleWorkflow).toContain("Task 1: Hook lifecycle");
    const task1Section = playSubagentExampleWorkflow.slice(
      playSubagentExampleWorkflow.indexOf("Task 1: Hook lifecycle"),
      playSubagentExampleWorkflow.indexOf("Task 2: Recovery and repair modes"),
    );
    expectOrdered(
      task1Section,
      "Task 1 implementer: status=DONE",
      "Hard-risk trigger detected: install/sync behavior or user-home writes.",
    );
    const task2Section = playSubagentExampleWorkflow.slice(
      playSubagentExampleWorkflow.indexOf("Task 2: Recovery and repair modes"),
      playSubagentExampleWorkflow.indexOf("Task 3: Low-risk example copy"),
    );
    expectOrdered(
      task2Section,
      "Task 2 implementer: agent_id=impl-2, status=DONE",
      "Plan hints high risk and `spec-and-quality`; repair-mode behavior changes",
    );
    expect(task2Section).toContain(
      "workflow policy, so a hard-risk trigger is present",
    );
    const task3Section = playSubagentExampleWorkflow.slice(
      playSubagentExampleWorkflow.indexOf("Task 3: Low-risk example copy"),
      playSubagentExampleWorkflow.indexOf("[Mark Task 3 complete]"),
    );
    expectOrdered(
      task3Section,
      "  - Committed",
      "Plan hints low risk and `none-final-only`; no hard-risk trigger is present;",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "Lifecycle cleanup checkpoint",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "closed=yes after PASS verdict recorded",
    );
    expect(playSubagentExampleWorkflow).toContain("Ledger pre-dispatch");
    expect(playSubagentExampleWorkflow).toContain("Ledger post-dispatch");
    expect(playSubagentExampleWorkflow).toContain(
      "Every later implementer, reviewer, re-reviewer, and final reviewer dispatch gets its own row",
    );
    expect(playSubagentExampleWorkflow).toContain("agent_id=pending");
    expect(playSubagentExampleWorkflow).toContain("review scope captured");
    expect(playSubagentExampleWorkflow).toContain("report captured");
    expect(playSubagentExampleWorkflow).toContain("status=DONE");
    expect(playSubagentExampleWorkflow).toContain(
      "inventory-only: target exposes session inventory but no close operation",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "close-unavailable: inventory-only; no close operation",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "first captures each completed session's role-specific state",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "cleanup-unavailable: target exposes neither inventory nor close operation",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "close-unavailable: no inventory or close operation",
    );
    expect(playSubagentExampleWorkflow).toContain("Slot-limit spawn failure");
    expect(playSubagentExampleWorkflow).toContain(
      "Controller runs the cleanup gate",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "Repeated blocker-family branch",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "Initial blocker-family record",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "blocker state=context-missing: needs target install path",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "base/head SHA captured (head pending)",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "close-unavailable: no inventory or close operation after BLOCKED report",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "Cleanup gate before Task 2 spec reviewer spawn",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "Cleanup gate before Task 2 spec re-review spawn",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "Cleanup gate before Task 2 code-quality reviewer spawn",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "Cleanup gate before Task 2 code-quality re-review spawn",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "findings captured: Missing progress reporting",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "re-review target=spec-2-rereview",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "routing target=Task 2 implementer",
    );
    expect(playSubagentExampleWorkflow).toContain("report refreshed");
    expect(playSubagentExampleWorkflow).toContain("test state refreshed");
    expect(playSubagentExampleWorkflow).toContain("snapshot refreshed");
    expect(playSubagentExampleWorkflow).toContain(
      "findings captured: Magic number (100)",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "re-review target=quality-2-rereview",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "Cleanup gate before final code-quality reviewer spawn",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "Task 2 code-quality reviewer: status=findings-recorded",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "Alternative target capability examples - separate runs",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "final-code-quality-reviewer",
    );

    const playSubagentRedFlags = await readFile(
      path.join(
        repoRoot,
        "skills/play-subagent-execution/references/red-flags.md",
      ),
      "utf-8",
    );
    expect(playSubagentRedFlags).toContain(
      "the workflow is serial by design; isolation is not authorization for concurrent implementer dispatch",
    );
    expect(playSubagentRedFlags).toContain(
      "Skip or weaken the executor-computed review route",
    );
    expect(playSubagentRedFlags).toContain("Hard-risk triggers force");
    expect(playSubagentRedFlags).toContain(
      "reduced routes require the verified shared `issue-priming-workflow --auto`",
    );
    expect(playSubagentRedFlags).toContain(
      "Move to next task while an executor-required review has open issues",
    );
    expect(playSubagentRedFlags).not.toContain(
      "Move to next task while either review has open issues",
    );
    expect(playSubagentRedFlags).not.toContain("(conflicts)");

    const issuePhase6Start = issuePrimingWorkflowBody.indexOf(
      "### Phase 6: Implement",
    );
    const issuePhase6End = issuePrimingWorkflowBody.indexOf(
      "### Phase 7: Branch Review",
    );
    expect(issuePhase6Start).toBeGreaterThanOrEqual(0);
    expect(issuePhase6End).toBeGreaterThan(issuePhase6Start);
    const issuePhase6Section = issuePrimingWorkflowBody.slice(
      issuePhase6Start,
      issuePhase6End,
    );
    expect(issuePhase6Section).toContain(
      "Apply `play-subagent-execution`'s executor-owned risk-based per-task review routing",
    );
    expect(issuePhase6Section).toContain(
      "the Phase 7 `branch-review --fix` loop is mandatory",
    );
    expect(issuePhase6Section).toContain(
      "satisfies the final-review guarantee required by any reduced per-task review route",
    );
    expect(issuePhase6Section).toContain(
      "If Phase 7 commits auto-fixes or mechanical nit fixes, Phase 7 reruns on the new `HEAD`",
    );
    expect(issuePhase6Section).toContain("zero blocking findings auto-fixed");
    expect(issuePhase6Section).toContain(
      "no additional mechanical nit commits",
    );
    expect(issuePhase6Section).not.toContain(
      "Run all per-task reviews for multi-task plans",
    );

    const issuePhase7Start = issuePrimingWorkflowBody.indexOf(
      "### Phase 7: Branch Review",
    );
    const issuePhase7End = issuePrimingWorkflowBody.indexOf(
      "### Phase 8: Create PR",
    );
    expect(issuePhase7Start).toBeGreaterThanOrEqual(0);
    expect(issuePhase7End).toBeGreaterThan(issuePhase7Start);
    const issuePhase7Section = issuePrimingWorkflowBody.slice(
      issuePhase7Start,
      issuePhase7End,
    );
    expect(issuePhase7Section).toContain(
      "Invoke `branch-review --fix` to review the implementation before creating a PR.",
    );
    expect(issuePhase7Section).toContain(
      "If the run commits any auto-fixes, rerun `branch-review --fix` on the new",
    );
    expect(issuePhase7Section).toContain(
      "mechanical nit handling creates any commit, rerun this same Branch Review step",
    );
    expect(issuePhase7Section).toContain('no `severity: "Blocking"` entries');
    expect(issuePhase7Section).toContain(
      "validate the parsed findings path before reading it",
    );
    expect(issuePhase7Section).toContain(
      "Do not recompute the review SHA from post-review `HEAD`",
    );
    expect(issuePhase7Section).toContain(
      "exact `Review head: <40-hex-sha>.` notice line",
    );
    expect(issuePhase7Section).toContain('HEAD_SHA="$REVIEW_HEAD_SHA"');
    expect(issuePhase7Section).toContain(
      'echo "branch-review review head invalid: $REVIEW_HEAD_SHA"',
    );
    expect(issuePhase7Section).toContain(".ephemeral/*-findings.json");
    expect(issuePhase7Section).toContain(
      "nested findings path rejected: $FINDINGS_FILE",
    );
    expect(issuePhase7Section).toContain(
      'EXPECTED_FINDINGS_FILE=".ephemeral/${BRANCH_SLUG}-${HEAD_SHA}-findings.json"',
    );
    expect(issuePhase7Section).toContain(
      'echo "findings path mismatch: $FINDINGS_FILE"',
    );
    expect(issuePhase7Section).toContain(
      'echo "findings file must not be a symlink: $FINDINGS_FILE"',
    );
    expect(issuePhase7Section).toContain(
      ".ephemeral must be a directory, not a symlink",
    );
    expect(issuePhase7Section).toContain(
      "If any mechanical nit commit is made, rerun `branch-review --fix` on the new `HEAD`",
    );
    expect(issuePhase7Section).toContain(
      'jq -e \'.schema == "play-review/findings/v1"\' "$FINDINGS_FILE"',
    );
    expectOrdered(
      issuePhase7Section,
      '.ephemeral/*/*) echo "nested findings path rejected: $FINDINGS_FILE"',
      ".ephemeral/*-findings.json) ;;",
    );
    expect(issuePhase7Section).toContain(
      'echo "play-review path validation failed: $FINDINGS_FILE"',
    );
    expect(issuePhase7Section).toContain(
      'echo "path traversal: $FINDINGS_FILE"',
    );
    expect(issuePhase7Section).toContain(
      "nested nits path rejected: $NITS_PENDING_FILE",
    );
    expectOrdered(
      issuePhase7Section,
      '.ephemeral/*/*) echo "nested nits path rejected: $NITS_PENDING_FILE"',
      ".ephemeral/*-nits-pending.json) ;;",
    );
    expect(issuePhase7Section).toContain(
      'echo "path traversal: $NITS_PENDING_FILE"',
    );
    expect(issuePhase7Section).toContain(
      'If any finding has `severity: "Blocking"`, **stop `--auto` and surface those findings to the user**',
    );
    expect(issuePhase7Section).toContain(
      'Only proceed with the per-nit classification flow when every remaining finding has `severity: "Nit"`',
    );

    const issueModelSelectionStart = issuePrimingWorkflowBody.indexOf(
      "### Model selection",
    );
    const issueModelSelectionEnd = issuePrimingWorkflowBody.indexOf(
      "## What This Skill Does NOT Do",
    );
    expect(issueModelSelectionStart).toBeGreaterThanOrEqual(0);
    expect(issueModelSelectionEnd).toBeGreaterThan(issueModelSelectionStart);
    const issueModelSelectionSection = issuePrimingWorkflowBody.slice(
      issueModelSelectionStart,
      issueModelSelectionEnd,
    );
    expect(issueModelSelectionSection).toContain(
      "Per-task for `spec-and-quality` and `spec-only` routes",
    );
    expect(issueModelSelectionSection).toContain(
      "Per-task for `spec-and-quality`; final/local gates separately",
    );
    expect(issueModelSelectionSection).not.toContain(
      "Per-task only; runs on multi-task plans",
    );
    expect(issueModelSelectionSection).not.toContain(
      "Per-task (multi-task) + whole-implementation review",
    );
  });
});
