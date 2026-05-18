import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  expectOrdered,
  getSkillOutput,
  normalizeWhitespace,
} from "../__test-helpers__/render.js";
import { loadConfig } from "../config/load.js";
import { parseFrontmatter } from "./frontmatter.js";
import { renderAll } from "./pipeline.js";

describe("play-subagent planning and routing contracts", () => {
  let repoRoot: string;
  let subagentLifecycleBody: string;
  let playSubagentExecutionBody: string;
  let playPlanningBody: string;
  let issuePrimingWorkflowBody: string;

  beforeAll(async () => {
    repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    const { outputs } = await renderAll(config, false);
    subagentLifecycleBody = parseFrontmatter(
      getSkillOutput(outputs, "subagent-lifecycle", "codex").content,
    ).body;
    playSubagentExecutionBody = parseFrontmatter(
      getSkillOutput(outputs, "play-subagent-execution", "codex").content,
    ).body;
    playPlanningBody = parseFrontmatter(
      getSkillOutput(outputs, "play-planning", "codex").content,
    ).body;
    issuePrimingWorkflowBody = parseFrontmatter(
      getSkillOutput(outputs, "issue-priming-workflow", "codex").content,
    ).body;
  });

  it("pins reviewer prompt snapshot trust-boundary language", async () => {
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
    expect(specReviewerPrompt).toContain(
      "spec-compliance reviewer (`spec-and-quality` or `spec-only`)",
    );
    expect(specReviewerPrompt).toContain("ADR-0017");
    expect(specReviewerPrompt).toContain(
      "guarded tiny-diff mode may suppress dynamic Docs-agent dispatch",
    );
    expect(codeQualityReviewerPrompt).toContain(
      "Do not consume any content snapshot",
    );
    expect(codeQualityReviewerPrompt).toContain("Per-task dispatch only");
    expect(normalizeWhitespace(codeQualityReviewerPrompt)).toContain(
      "final whole-implementation code-quality reviewer",
    );
  });

  it("pins implementer source-read and invalid example contracts", async () => {
    const implementerPrompt = await readFile(
      path.join(
        repoRoot,
        "skills/play-subagent-execution/references/implementer-prompt.md",
      ),
      "utf-8",
    );
    const mechanicalImplementerPrompt = await readFile(
      path.join(
        repoRoot,
        "skills/play-subagent-execution/references/mechanical-implementer-prompt.md",
      ),
      "utf-8",
    );

    expect(implementerPrompt).toContain(
      "Treat the task text as a task specification",
    );
    expect(implementerPrompt).toContain(
      "not as source-authoritative\n    implementation",
    );
    expect(implementerPrompt).toContain(
      "does not authorize concrete code-like examples, test\n    snippets, shell snippets, command sequences, or commit recipes",
    );
    expect(implementerPrompt).toContain(
      "Read the relevant source files, existing tests, docs, ADRs, helpers, and\n       referenced contracts directly before choosing concrete implementation",
    );
    expect(implementerPrompt).toContain(
      "If the plan appears to require an unapproved code-like example",
    );
    expect(implementerPrompt).toContain(
      "treat that\n    content as invalid for implementation",
    );
    expect(implementerPrompt).toContain(
      "Stop and report NEEDS_CONTEXT or\n    BLOCKED",
    );

    expect(mechanicalImplementerPrompt).toContain(
      "Mechanical mode is only for approved verbatim artifact work",
    );
    expect(mechanicalImplementerPrompt).toContain(
      "Concrete code-like examples, test\n    snippets, shell snippets, command sequences, or commit recipes are not\n    authoritative",
    );
    expect(mechanicalImplementerPrompt).toContain(
      "approved verbatim\n    artifact content with an authority source",
    );
    expect(mechanicalImplementerPrompt).toContain(
      "report BLOCKED or\n    NEEDS_CONTEXT instead of copying it",
    );
    expect(mechanicalImplementerPrompt).toContain(
      "Satisfy the task's verification expectations",
    );
    expect(mechanicalImplementerPrompt).toContain(
      "source-owned project docs, config, tests",
    );
    expect(mechanicalImplementerPrompt).toContain(
      "Plan-named commands are not authoritative",
    );
    expect(mechanicalImplementerPrompt).not.toContain(
      "Verify the change (run any verify command from the plan)",
    );
  });

  it("documents task-spec planning and hint contracts", () => {
    expect(playPlanningBody).toContain("comprehensive task-spec plans");
    expect(playPlanningBody).toContain(
      "Plans are authoritative for intent, boundaries, invariants",
    );
    expect(playPlanningBody).toContain(
      "acceptance criteria, task order, dependencies, source-of-truth references",
    );
    expect(playPlanningBody).toContain(
      "authority surfaces, and verification expectations",
    );
    expect(playPlanningBody).toContain("Plans are not prewritten");
    expect(playPlanningBody).toContain(
      "must read the relevant source\nfiles directly before choosing concrete code, tests, documentation edits, and\nverification commands",
    );
    expect(playPlanningBody).toContain(
      "Do not include concrete implementation code, test code, shell snippets, exact\ncommand sequences, or commit recipes",
    );
    expect(playPlanningBody).toContain("already-approved\nverbatim artifact");
    expect(playPlanningBody).toContain(
      "label it as approved verbatim artifact content and name its\nauthority source",
    );

    expect(playPlanningBody).toContain("## Contract-Heavy Work");
    const contractHeavySectionStart = playPlanningBody.indexOf(
      "## Contract-Heavy Work",
    );
    const contractHeavySectionEnd = playPlanningBody.indexOf(
      "## Cohesive Task Composition",
      contractHeavySectionStart,
    );
    expect(contractHeavySectionStart).toBeGreaterThanOrEqual(0);
    expect(contractHeavySectionEnd).toBeGreaterThan(contractHeavySectionStart);
    const contractHeavySection = playPlanningBody.slice(
      contractHeavySectionStart,
      contractHeavySectionEnd,
    );
    expect(contractHeavySection).toContain("write a short contract table");
    for (const surface of [
      "Inputs",
      "Execution cwd",
      "Script or helper locations",
      "Source-of-truth files",
      "Derived paths",
      "Allowed overrides",
      "Failure modes",
    ]) {
      expect(contractHeavySection).toContain(surface);
    }
    expect(contractHeavySection).toContain("authority surfaces");
    expect(contractHeavySection).toContain(
      "does\nnot copy helper implementations or command recipes",
    );

    expect(playPlanningBody).toContain("## Cohesive Task Composition");
    expect(playPlanningBody).toContain(
      "share the same subsystem or file family",
    );
    expect(playPlanningBody).toContain(
      "Composition changes task boundaries, not task-spec quality",
    );
    expect(playPlanningBody).toContain(
      "Do not hide dependent implementation units merely to avoid multi-task review",
    );

    const taskStructureStart = playPlanningBody.indexOf("## Task Structure");
    const taskStructureEnd = playPlanningBody.indexOf(
      "### Optional `**Mode:**` field",
      taskStructureStart,
    );
    expect(taskStructureStart).toBeGreaterThanOrEqual(0);
    expect(taskStructureEnd).toBeGreaterThan(taskStructureStart);
    const taskStructureSection = playPlanningBody.slice(
      taskStructureStart,
      taskStructureEnd,
    );
    for (const field of [
      "**Purpose:**",
      "**Goal:**",
      "**Non-goals:**",
      "**Source-of-truth references:**",
      "**Authority surfaces:**",
      "**Acceptance criteria:**",
      "**Risks:**",
      "**Dependencies:**",
      "**Verification expectations:**",
    ]) {
      expect(taskStructureSection).toContain(field);
    }
    expect(taskStructureSection).toContain(
      "generated outputs are derived evidence, not authority",
    );
    expect(taskStructureSection).toContain(
      "Task specs should prefer references to existing behavior",
    );
    expect(taskStructureSection).toContain("over copied logic");
    expect(taskStructureSection).toContain(
      "the implementer writes the concrete test after reading source",
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
    expect(reviewHintSection).not.toContain("**Execution:**");
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
      "Hard-risk triggers from `skills/play-subagent-execution/SKILL.md` §",
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
    expect(planReviewSection).toContain(
      "Contract-heavy work includes the applicable contract table surfaces",
    );
    expect(planReviewSection).toContain(
      "Tasks include purpose, goal, non-goals, acceptance criteria, risks",
    );
    expect(planReviewSection).toContain(
      "The plan does not include concrete implementation code, test code, shell",
    );
    expect(planReviewSection).toContain(
      "Task specs prefer references to existing behavior and source-of-truth files",
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
    expect(executionHandoffSection).toContain(
      "`issue-priming/auto-handoff/v1` artifact",
    );
    expect(executionHandoffSection).not.toContain(
      "Fresh subagent per task + two-stage review",
    );

    const autoHandoffInputStart = playSubagentExecutionBody.indexOf(
      "### Auto handoff reference",
    );
    expect(autoHandoffInputStart).toBeGreaterThanOrEqual(0);
    const autoHandoffInputSection = playSubagentExecutionBody.slice(
      autoHandoffInputStart,
      playSubagentExecutionBody.indexOf(
        "### Inline content",
        autoHandoffInputStart,
      ),
    );
    expect(autoHandoffInputSection).toContain(
      "Auto handoff: <repo-relative-path>",
    );
    expect(autoHandoffInputSection).toContain(
      "bind the path to `AUTO_HANDOFF_FILE`",
    );
    expect(autoHandoffInputSection).toContain(
      "ISSUE_PRIMING_AUTO_HANDOFF_VERIFIED=false",
    );

    const planningHintStart = playPlanningBody.indexOf(
      "Example mechanical-task header:",
    );
    const planningHintEnd = playPlanningBody.indexOf(
      "Omit `**Mode:** mechanical` for any task with judgment",
    );
    expect(planningHintStart).toBeGreaterThanOrEqual(0);
    expect(planningHintEnd).toBeGreaterThan(planningHintStart);
    const planningHintExample = playPlanningBody.slice(
      planningHintStart,
      planningHintEnd,
    );
    const modeIndex = planningHintExample.indexOf("**Mode:** mechanical");
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
    expect(modeIndex).toBeLessThan(riskIndex);
    expect(riskIndex).toBeLessThan(reviewIndex);
    expect(reviewIndex).toBeLessThan(rationaleIndex);
    expect(rationaleIndex).toBeLessThan(filesIndex);
  });

  it("documents play-subagent execution routing and lifecycle contracts", async () => {
    expect(playSubagentExecutionBody).toContain(
      "high-assurance serial execution",
    );
    expect(playSubagentExecutionBody).toContain(
      "preserves the task boundaries authored in the plan",
    );
    expect(playSubagentExecutionBody).toContain(
      "nested plan path rejected: $PLAN_PATH",
    );
    expect(playSubagentExecutionBody).toContain(
      "plan must not be a symlink: $PLAN_PATH",
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
    expect(playSubagentExecutionBody).toContain(
      "The plan constrains implementation intent, boundaries, source-of-truth",
    );
    expect(playSubagentExecutionBody).toContain(
      "It does not\nmake concrete code-like examples, test snippets, shell snippets, command\nsequences, or commit recipes authoritative",
    );
    expect(playSubagentExecutionBody).toContain(
      "unless the task explicitly labels\nthat content as approved verbatim artifact content",
    );
    expect(playSubagentExecutionBody).toContain(
      "Implementers choose concrete code, tests, docs, and verification\ncommands only after reading the relevant source files directly",
    );
    expect(playSubagentExecutionBody).toContain(
      "This model-selection category is separate\nfrom `**Mode:** mechanical`",
    );
    expect(playSubagentExecutionBody).toContain(
      "satisfy\nverification expectations + commit inline",
    );

    const singleTaskSectionStart = playSubagentExecutionBody.indexOf(
      "## Single-Task Plans",
    );
    const singleTaskSectionEnd = playSubagentExecutionBody.indexOf(
      "## Subagent Lifecycle",
      singleTaskSectionStart,
    );
    expect(singleTaskSectionStart).toBeGreaterThanOrEqual(0);
    expect(singleTaskSectionEnd).toBeGreaterThan(singleTaskSectionStart);
    const singleTaskSection = playSubagentExecutionBody.slice(
      singleTaskSectionStart,
      singleTaskSectionEnd,
    );
    const normalizedSingleTaskSection = normalizeWhitespace(singleTaskSection);
    expect(singleTaskSection).toContain(
      "validates both controller-local parent state",
    );
    expect(singleTaskSection).toContain(
      "`issue-priming/auto-handoff/v1` audit artifact",
    );
    expect(normalizedSingleTaskSection).toContain(
      "downstream `branch-review --fix` as the mandatory next step",
    );
    expect(singleTaskSection).toContain(
      "Otherwise, the final whole-implementation code-quality reviewer",
    );
    expect(singleTaskSection).not.toContain("caller says");
    expect(singleTaskSection).not.toContain("prose-only");

    const skipDispatchSectionStart = playSubagentExecutionBody.indexOf(
      "### Inline execution sequence",
    );
    const skipDispatchSectionEnd = playSubagentExecutionBody.indexOf(
      "### Fallback",
      skipDispatchSectionStart,
    );
    expect(skipDispatchSectionStart).toBeGreaterThanOrEqual(0);
    expect(skipDispatchSectionEnd).toBeGreaterThan(skipDispatchSectionStart);
    const skipDispatchSection = playSubagentExecutionBody.slice(
      skipDispatchSectionStart,
      skipDispatchSectionEnd,
    );
    expect(skipDispatchSection).toContain(
      "Satisfy the task's `**Verification expectations:**` field",
    );
    expect(skipDispatchSection).toContain(
      "source-owned project docs, config, tests",
    );
    expect(skipDispatchSection).toContain("Plan-named commands are not");
    expect(skipDispatchSection).not.toContain(
      "If the plan has no verify command, the verify step is a no-op",
    );
    expect(skipDispatchSection).toContain(
      "validates both controller-local parent state",
    );
    expect(skipDispatchSection).toContain(
      "`issue-priming/auto-handoff/v1` audit artifact",
    );
    expect(skipDispatchSection).toContain(
      "Otherwise, dispatch the existing final whole-implementation code-quality",
    );
    expect(skipDispatchSection).not.toContain("caller says");
    expect(skipDispatchSection).not.toContain("prose-only");

    const fallbackSectionStart =
      playSubagentExecutionBody.indexOf("### Fallback");
    const fallbackSectionEnd = playSubagentExecutionBody.indexOf(
      "### Skip-Dispatch Examples",
      fallbackSectionStart,
    );
    expect(fallbackSectionStart).toBeGreaterThanOrEqual(0);
    expect(fallbackSectionEnd).toBeGreaterThan(fallbackSectionStart);
    const fallbackSection = playSubagentExecutionBody.slice(
      fallbackSectionStart,
      fallbackSectionEnd,
    );
    expect(fallbackSection).toContain("`**TDD expectation:**`");
    expect(fallbackSection).toContain("legacy TDD step-pair");
    expect(fallbackSection).toContain(
      "use\n`implementer-prompt.md` regardless of any `**Mode:** mechanical` hint",
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
      '"Implementer agent fixes spec gaps" -> "Revalidate effective review route" [label="refresh task head"]',
    );
    expect(processSection).toContain(
      '"Implementer agent fixes quality issues" -> "Revalidate effective review route" [label="refresh task head"]',
    );
    expect(processSection).toContain(
      '"Revalidate effective review route" -> "Dispatch the code-quality-reviewer agent (references/code-quality-reviewer-prompt.md)" [label="spec-and-quality code-quality path"]',
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
    expect(routingSection).toContain("Auto handoff: <repo-relative-path>");
    expect(routingSection).toContain("controller-local parent state");
    expect(routingSection).toContain(".ephemeral/*/*) ;;");
    expect(routingSection).toContain(
      "ISSUE_PRIMING_AUTO_HANDOFF_VERIFIED=false",
    );
    expect(routingSection).toContain(
      'if [ "${ISSUE_PRIMING_AUTO_PARENT_ACTIVE:-false}" = true ]; then',
    );
    expect(routingSection).toContain(
      'jq -e --arg plan "$PLAN_PATH" --arg head "$ISSUE_PRIMING_AUTO_HEAD"',
    );
    expect(routingSection).toContain('[ -f "$AUTO_HANDOFF_FILE" ]');
    expect(routingSection).toContain('[ -r "$AUTO_HANDOFF_FILE" ]');
    expect(routingSection).toContain(
      '.schema == "issue-priming/auto-handoff/v1"',
    );
    expect(routingSection).toContain('.phase == "issue-priming-workflow:6"');
    expect(routingSection).toContain('.mode == "auto"');
    expect(routingSection).toContain(".plan_path == $plan");
    expect(routingSection).toContain(".head_sha == $head");
    expect(routingSection).toContain(
      ".phase7_branch_review_fix_required == true",
    );
    expect(routingSection).toContain(".phase7_rerun_after_commits == true");
    expect(normalizedRoutingSection).toContain(
      "Phase 7 immediately runs `branch-review --fix` on the full branch diff",
    );
    expect(normalizedRoutingSection).toContain(
      "rerunning it after any Phase 7 commit (auto-fixed blockers or mechanical nit fixes) until a run reports zero blocking findings auto-fixed, no unresolved remaining `Blocking` findings except findings whose `critic` verdict is `INVALID` or `DOWNGRADE`, and no additional mechanical nit commits after that review",
    );
    expect(normalizedRoutingSection).toContain(
      "This covers GitHub and Linear entrypoints because both delegate",
    );
    expect(normalizedRoutingSection).toContain(
      "repo files alone, or direct/manual calls cannot assert this contract",
    );
    expect(normalizedRoutingSection).toContain(
      "artifact that does not match the current plan path and `ISSUE_PRIMING_AUTO_HEAD`",
    );
    expect(normalizedRoutingSection).toContain(
      "These unverified cases do not abort the workflow; they only disable reduced routes",
    );
    expect(normalizedRoutingSection).toContain(
      "If the controller cannot validate the `issue-priming/auto-handoff/v1` artifact, use `spec-and-quality`",
    );
    expect(routingSection).toContain(
      "After any implementer fixup commit requested by a spec-compliance or",
    );
    expect(normalizedRoutingSection).toContain(
      "Revalidation may only preserve or escalate the route; it never downgrades",
    );
    expect(routingSection).toContain(
      "`spec-only` is allowed for medium-risk tasks when no hard-risk trigger",
    );
    expect(routingSection).toContain(
      "`none-final-only` is allowed for low-risk tasks when no hard-risk trigger",
    );
    expect(normalizedRoutingSection).toContain(
      "Low-risk tasks are limited to localized prose/comment/example changes or verbatim creation of non-executable prose/example/fixture files",
    );
    expect(normalizedRoutingSection).toContain(
      "New source, test, config, manifest, generated, or executable files are not low-risk",
    );
    expect(normalizedRoutingSection).toContain(
      "Medium-risk tasks have bounded implementation judgment but no hard-risk trigger",
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
      "external CLI/API/system invocation additions, removals, substitutions, or",
      "flag/body/argument changes",
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
    const normalizedPlaySubagentExecutionBody = normalizeWhitespace(
      playSubagentExecutionBody,
    );
    expect(playSubagentExecutionBody).toContain("## Subagent Lifecycle");
    expect(playSubagentExecutionBody).toContain("Use `subagent-lifecycle`");
    expect(normalizedPlaySubagentExecutionBody).toContain(
      "generic controller lifecycle ledger, target lifecycle capability classification, cleanup gate before spawns, target-honest cleanup outcomes, and slot-limit recovery",
    );
    expect(normalizedPlaySubagentExecutionBody).toContain(
      "role-specific captured state includes implementer reports, changed files, test results, snapshot state, reviewer scope, reviewer report, concrete findings, routing target, re-review target, task base/head SHA, fixup count, and blocker state",
    );
    expect(normalizedPlaySubagentExecutionBody).toContain(
      "same-session spec-compliance or code-quality reviewer fix loops may still route fixups back to that implementer session",
    );
    expect(normalizedPlaySubagentExecutionBody).toContain(
      "preserve the implementer session until every reviewer loop required by the task's effective route passes",
    );
    expect(playSubagentExecutionBody).not.toContain(
      "## Controller Lifecycle Ledger",
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
    expect(playSubagentAdvantages).toContain("controller-local parent");
    expect(playSubagentAdvantages).toContain(
      "`issue-priming/auto-handoff/v1` artifact",
    );
    expect(playSubagentAdvantages).toContain(
      "zero blocking findings auto-fixed, no unresolved remaining",
    );
    expect(playSubagentAdvantages).toContain(
      "no additional mechanical nit commits",
    );
    expect(playSubagentAdvantages).toContain(
      "unresolved remaining `Blocking` findings with any other critic value stop the workflow",
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
      "`issue-priming/auto-handoff/v1`\nartifact",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "controller-local parent state",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "`branch-review --fix` after any auto-fix or mechanical-nit",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "reports zero blocking findings auto-fixed",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "`issue-priming-workflow` Phase 7 runs `branch-review --fix`",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "Branch review: no unresolved remaining `Blocking` findings except `INVALID` or",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "`DOWNGRADE` critic verdicts.",
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
      "[Revalidate effective review route]",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "Controller compares the original Task 2 base SHA to the refreshed task head",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "The route may only preserve or escalate",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "so continue to spec re-review",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "so continue to code-quality re-review",
    );
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
  });

  it("pins the rendered subagent-lifecycle owner contract", () => {
    const normalizedSubagentLifecycleBody = normalizeWhitespace(
      subagentLifecycleBody,
    );

    expect(subagentLifecycleBody).toContain("## Controller Lifecycle Ledger");
    expect(subagentLifecycleBody).toContain(
      "agent-local/controller-local state",
    );
    expect(subagentLifecycleBody).toContain(
      "one `agent_id` or `agent_id=pending`",
    );
    expect(subagentLifecycleBody).toContain("role-specific captured state");
    expect(subagentLifecycleBody).toContain("reviewer result when relevant");
    expect(subagentLifecycleBody).toContain(
      "fixup count or blocker state when relevant",
    );
    expect(normalizedSubagentLifecycleBody).toContain(
      "one cleanup outcome: `closed=yes`, `closed=no`, or `close-unavailable: <reason>`",
    );
    expect(normalizedSubagentLifecycleBody).toContain(
      "Role-specific captured state is whatever the owning workflow needs before it can safely close, supersede, or replace that role",
    );

    expect(subagentLifecycleBody).toContain("## Target Lifecycle Capability");
    expect(subagentLifecycleBody).toContain("automatic-close-supported");
    expect(subagentLifecycleBody).toContain(
      "close/session-cleanup operation exist",
    );
    expect(subagentLifecycleBody).toContain("inventory-only");
    expect(subagentLifecycleBody).toContain(
      "close-unavailable: inventory-only; no close operation",
    );
    expect(subagentLifecycleBody).toContain("cleanup-unavailable");
    expect(subagentLifecycleBody).toContain(
      "close-unavailable: no inventory or close operation",
    );
    expect(normalizedSubagentLifecycleBody).toContain(
      "Do not infer support from another target",
    );

    expect(subagentLifecycleBody).toContain("## Cleanup Gate Before Spawns");
    expect(subagentLifecycleBody).toContain("Before every new subagent spawn");
    expect(normalizedSubagentLifecycleBody).toContain(
      "Capture the role-specific state needed by the owning workflow before closing or superseding any session",
    );
    expect(normalizedSubagentLifecycleBody).toContain(
      "Keep sessions open when the owning workflow still requires same-session follow-up",
    );
    expect(normalizedSubagentLifecycleBody).toContain(
      "Never record `closed=yes` unless the current target actually exposed stable ids plus a close operation",
    );

    expect(subagentLifecycleBody).toContain("## Slot-Limit Recovery");
    expect(subagentLifecycleBody).toContain(
      "orchestration resource exhaustion",
    );
    expect(normalizedSubagentLifecycleBody).toContain(
      "Wait for operator confirmation that manual cleanup is complete before continuing",
    );
    expect(subagentLifecycleBody).toContain(
      "Reconstruct active workflow state from the lifecycle ledger",
    );
    expect(normalizedSubagentLifecycleBody).toContain(
      "Retry the spawn exactly once after automatic cleanup completes or after the operator confirms manual cleanup",
    );
    expect(subagentLifecycleBody).toContain(
      "Repeated failures after the single retry are not permission to keep spawning",
    );
  });

  it("documents issue-priming implementation and review handoffs", () => {
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
      'ISSUE_PRIMING_AUTO_HEAD="$(git rev-parse HEAD)"',
    );
    expect(issuePhase6Section).toContain('PLAN_PATH="$PLAN_PATH"');
    expect(issuePhase6Section).toContain(
      "installed `issue-priming-workflow` skill",
    );
    expect(issuePhase6Section).toContain(
      'ISSUE_PRIMING_WORKFLOW_DIR="<installed-issue-priming-workflow-skill-bundle>"',
    );
    expect(issuePhase6Section).toContain("AUTO_HANDOFF_HELPER");
    expect(issuePhase6Section).toContain('bash "$AUTO_HANDOFF_HELPER"');
    const autoHandoffSnippet = `\
ISSUE_PRIMING_WORKFLOW_DIR="<installed-issue-priming-workflow-skill-bundle>"
AUTO_HANDOFF_HELPER="$ISSUE_PRIMING_WORKFLOW_DIR/scripts/write-auto-handoff.sh"
ISSUE_PRIMING_AUTO_HEAD="$(git rev-parse HEAD)"
AUTO_HANDOFF_FILE=$(
  PLAN_PATH="$PLAN_PATH" \\
    bash "$AUTO_HANDOFF_HELPER"
)`;
    expect(issuePhase6Section).toContain(autoHandoffSnippet);
    expect(issuePhase6Section.indexOf(autoHandoffSnippet)).toBeLessThan(
      issuePhase6Section.indexOf("Invoke `play-subagent-execution`"),
    );
    expect(issuePhase6Section).toContain(
      "prints the repo-relative artifact path",
    );
    expect(issuePhase6Section).toContain("unsafe-path and repository-root");
    expect(issuePhase6Section).toContain("`issue-priming/auto-handoff/v1`");
    expect(issuePhase6Section).toContain("`issue-priming-workflow:6`");
    expect(issuePhase6Section).toContain(
      "phase7_branch_review_fix_required: true",
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
    expect(issuePhase6Section).toContain("phase7_rerun_after_commits: true");
    expect(issuePhase6Section).not.toContain("AUTO_HANDOFF_TMP=");
    expect(issuePhase6Section).not.toContain('mv "$AUTO_HANDOFF_TMP"');
    expect(issuePhase6Section).toContain("Plan: <PLAN_PATH captured above>");
    expect(issuePhase6Section).toContain("Auto handoff: <repo-relative-path>");
    expect(normalizeWhitespace(issuePhase6Section)).toContain(
      "Use the `$AUTO_HANDOFF_FILE` path captured above for that placeholder",
    );
    expect(issuePhase6Section).toContain(
      "ISSUE_PRIMING_AUTO_PARENT_ACTIVE=true",
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
      "except findings whose `critic` verdict is `INVALID` or `DOWNGRADE`",
    );
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
    expect(issuePhase7Section).toContain(
      'no unresolved `severity: "Blocking"` entries\nexcept findings whose `critic` verdict is `INVALID` or `DOWNGRADE`',
    );
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
    expect(issuePhase7Section).toContain("installed `play-review` skill");
    expect(issuePhase7Section).toContain(
      'PLAY_REVIEW_DIR="<installed-play-review-skill-bundle>"',
    );
    expect(issuePhase7Section).toContain("PLAY_REVIEW_HELPER");
    expect(issuePhase7Section).toContain("validate-findings");
    expect(issuePhase7Section).toContain("derive-nits-pending");
    const phase7ValidateSnippet = `\
PLAY_REVIEW_DIR="<installed-play-review-skill-bundle>"
PLAY_REVIEW_HELPER="$PLAY_REVIEW_DIR/scripts/review-artifacts.sh"
case "$REVIEW_HEAD_SHA" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *) echo "branch-review review head invalid: $REVIEW_HEAD_SHA" >&2; exit 1 ;;
esac
HEAD_SHA="$REVIEW_HEAD_SHA"
HEAD_SHA="$HEAD_SHA" FINDINGS_FILE="$FINDINGS_FILE" \\
  bash "$PLAY_REVIEW_HELPER" validate-findings`;
    const phase7DeriveSnippet = `\
NITS_PENDING_FILE=$(
    HEAD_SHA="$HEAD_SHA" FINDINGS_FILE="$FINDINGS_FILE" \\
      bash "$PLAY_REVIEW_HELPER" derive-nits-pending
  )`;
    expect(issuePhase7Section).toContain(phase7ValidateSnippet);
    expect(issuePhase7Section).toContain(phase7DeriveSnippet);
    expectOrdered(
      issuePhase7Section,
      phase7ValidateSnippet,
      "After the guard passes, load `findings[]` from the file",
    );
    expectOrdered(
      issuePhase7Section,
      phase7DeriveSnippet,
      'The Phase 8 step "Pass nits to `play-branch-finish`"',
    );
    expect(issuePhase7Section).toContain("play-review/findings/v1");
    expect(issuePhase7Section).toContain(
      "canonical `-nits-pending.json` sibling path",
    );
    expect(issuePhase7Section).toContain(
      "If any mechanical nit commit is made, rerun `branch-review --fix` on the new `HEAD`",
    );
    expect(issuePhase7Section).toContain(
      'Ignore `critic: "INVALID"` findings for continuation',
    );
    expect(issuePhase7Section).toContain(
      'Treat `critic: "DOWNGRADE"` findings as non-blocking, judgment-required feedback',
    );
    expect(issuePhase7Section).toContain(
      'Treat each `critic: "DOWNGRADE"` finding as judgment-required without mechanical auto-fix',
    );
    expect(issuePhase7Section).toContain(
      'If any remaining finding has `severity: "Blocking"` with any other critic value, **stop `--auto` and surface those findings to the user**',
    );
    expect(issuePhase7Section).toContain(
      'set `severity` to `"Nit"`, set `critic` to `null`, and recompute `body`',
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
