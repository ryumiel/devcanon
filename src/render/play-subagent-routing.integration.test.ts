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
  let playSubagentExecutionBody: string;
  let playSubagentExecutionClaudeBody: string;
  let playPlanningBody: string;
  let playPlanningClaudeBody: string;
  let issuePrimingWorkflowBody: string;

  beforeAll(async () => {
    repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    const { outputs } = await renderAll(config, false);
    playSubagentExecutionBody = parseFrontmatter(
      getSkillOutput(outputs, "play-subagent-execution", "codex").content,
    ).body;
    playSubagentExecutionClaudeBody = parseFrontmatter(
      getSkillOutput(outputs, "play-subagent-execution", "claude").content,
    ).body;
    playPlanningBody = parseFrontmatter(
      getSkillOutput(outputs, "play-planning", "codex").content,
    ).body;
    playPlanningClaudeBody = parseFrontmatter(
      getSkillOutput(outputs, "play-planning", "claude").content,
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
    expect(specReviewerPrompt).toContain(
      "**Task contract checklist (when present in the requested task):**",
    );
    expect(specReviewerPrompt).toContain(
      "Verify owner/authority fields against the source files, docs, ADRs",
    );
    expect(specReviewerPrompt).toContain(
      "Verify must-preserve boundaries and existing workflow/domain contracts",
    );
    expect(specReviewerPrompt).toContain(
      "Verify required behavior, including preconditions, happy path, failure",
    );
    expect(specReviewerPrompt).toContain(
      "Verify risk surfaces and proof obligations were addressed",
    );
    expect(specReviewerPrompt).toContain(
      "A blank field, unexplained\n      `N/A`, or unproven proof obligation is a missing requirement",
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
      "does not authorize concrete code-like examples, test\n    snippets, plan-authored test bodies, shell snippets, shell recipes, command",
    );
    expect(implementerPrompt).toContain(
      "sequences, helper-name prescriptions, line-number edits, or commit recipes",
    );
    expect(implementerPrompt).toContain(
      "Read the relevant source files, existing tests, docs, ADRs, helpers, and\n       referenced contracts directly before choosing concrete implementation",
    );
    expect(implementerPrompt).toContain(
      "If the plan appears to require an unapproved code-like example",
    );
    expect(implementerPrompt).toContain(
      "treat that content as invalid for implementation",
    );
    expect(implementerPrompt).toContain(
      "NEEDS_CONTEXT or BLOCKED with the exact conflict",
    );
    expect(implementerPrompt).toContain(
      "If the task includes a contract checklist",
    );
    expect(implementerPrompt).toContain(
      "owner/authority,\n    affected consumers/generated outputs, must-preserve, required behavior",
    );
    expect(implementerPrompt).toContain(
      "field is blank, has an unexplained `N/A`, or names an owner/authority",
    );
    expect(normalizeWhitespace(implementerPrompt)).toContain(
      "source-of-truth, consumer, generated-output, or evidence surface that source inspection cannot confirm",
    );

    expect(mechanicalImplementerPrompt).toContain(
      "Mechanical mode is only for approved verbatim artifact work",
    );
    expect(mechanicalImplementerPrompt).toContain(
      "Concrete code-like examples, test\n    snippets, plan-authored test bodies, shell snippets, shell recipes, command",
    );
    expect(mechanicalImplementerPrompt).toContain(
      "sequences, helper-name prescriptions, line-number edits, or commit recipes",
    );
    expect(mechanicalImplementerPrompt).toContain(
      "affected consumers/generated outputs, must-preserve, required behavior",
    );
    expect(mechanicalImplementerPrompt).toContain(
      "approved\n    verbatim artifact content with an authority source",
    );
    expect(mechanicalImplementerPrompt).toContain(
      "report BLOCKED\n    or NEEDS_CONTEXT instead of copying it",
    );
    expect(mechanicalImplementerPrompt).toContain(
      "Satisfy the task's verification expectations",
    );
    expect(mechanicalImplementerPrompt).toContain(
      "Read the relevant source files, existing docs, ADRs, helpers, generated",
    );
    expect(mechanicalImplementerPrompt).toContain(
      "referenced contracts directly before choosing any\n       concrete file operation or verification approach",
    );
    expect(mechanicalImplementerPrompt).toContain(
      "source-owned project docs, config, tests",
    );
    expect(mechanicalImplementerPrompt).toContain(
      "Plan-named commands are not authoritative",
    );
    expect(mechanicalImplementerPrompt).toContain(
      "If the task includes a contract checklist",
    );
    expect(normalizeWhitespace(mechanicalImplementerPrompt)).toContain(
      "A blank checklist field, unexplained `N/A`, or unconfirmed owner/authority",
    );
    expect(normalizeWhitespace(mechanicalImplementerPrompt)).toContain(
      "source-of-truth, consumer, generated-output, or evidence surface is not a mechanical replacement target",
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
      "Do not include concrete implementation code, test code, plan-authored test\nbodies, shell snippets, shell recipes, exact command sequences, helper-name",
    );
    expect(playPlanningBody).toContain(
      "prescriptions, line-number edits, or commit recipes",
    );
    expect(playPlanningBody).toContain(
      "already-approved verbatim artifact that the task must reproduce exactly",
    );
    expect(playPlanningBody).toContain(
      "label it as approved verbatim artifact\ncontent and name its authority source",
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

    expect(playPlanningBody).toContain("## Contract Checklist Triggers");
    const contractChecklistSectionStart = playPlanningBody.indexOf(
      "## Contract Checklist Triggers",
    );
    const contractChecklistSectionEnd = playPlanningBody.indexOf(
      "## Cohesive Task Composition",
      contractChecklistSectionStart,
    );
    expect(contractChecklistSectionStart).toBeGreaterThanOrEqual(0);
    expect(contractChecklistSectionEnd).toBeGreaterThan(
      contractChecklistSectionStart,
    );
    const contractChecklistSection = playPlanningBody.slice(
      contractChecklistSectionStart,
      contractChecklistSectionEnd,
    );
    for (const trigger of [
      "multi-step implementation",
      "durable documentation, spec, Architecture Decision Record (ADR)",
      "cross-skill or cross-agent handoffs",
      "source-owned policy, schema, interface, bridge, or protocol changes",
      "generated or derived artifact behavior",
      "state-machine, failure, retry, cleanup, recovery, or terminal-state behavior",
      "fail-closed behavior, safety-sensitive behavior, or user-visible error",
      "compatibility or versioning behavior",
    ]) {
      expect(contractChecklistSection).toContain(trigger);
    }
    for (const surface of [
      "**Owner / authority:**",
      "**Must preserve:**",
      "**Required behavior:**",
      "**Spec / procedure work:**",
      "**Risk surfaces:**",
      "**Proof obligations:**",
    ]) {
      expect(contractChecklistSection).toContain(surface);
    }
    expect(contractChecklistSection).toContain(
      "Blank fields, unreplaced placeholders, and\nunexplained `N/A` entries are plan-review failures",
    );
    expect(contractChecklistSection).toContain(
      "name the blocker or\nassumption instead of inventing a contract",
    );
    expect(contractChecklistSection).toContain(
      "must not prescribe concrete code, test bodies, helper names, shell recipes",
    );
    expect(contractChecklistSection).toContain(
      "line-number edits, or command sequences",
    );
    expect(contractChecklistSection).toContain(
      "Do not require ADR or MAP updates unless their AFDS\ntriggers are met",
    );
    expect(contractChecklistSection).toContain(
      "An ADR trigger means the plan must ask whether the change\ncrosses the durable-decision threshold",
    );
    expect(contractChecklistSection).toContain(
      "it does not mean every feature or spec\nplan needs an ADR",
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
      "**Contract checklist:**",
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
      "required for non-trivial work; otherwise state why no trigger applies",
    );
    expect(taskStructureSection).toContain("with task-specific `N/A` reasons");
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
      "The contract checklist is present for every triggered task",
    );
    expect(planReviewSection).toContain(
      "Required checklist fields cover trigger criteria, owner/authority",
    );
    expect(planReviewSection).toContain(
      "must-preserve boundaries, affected consumers/generated outputs",
    );
    expect(normalizeWhitespace(planReviewSection)).toContain(
      "must-preserve boundaries, affected consumers/generated outputs, required behavior",
    );
    expect(planReviewSection).toContain(
      "Every checklist field is populated or marked `N/A` with a task-specific",
    );
    expect(planReviewSection).toContain(
      "Unknown owner, authority, source-of-truth, or evidence surfaces are named as",
    );
    expect(planReviewSection).toContain(
      "Tasks include purpose, goal, non-goals, acceptance criteria, risks",
    );
    expect(planReviewSection).toContain(
      "The plan does not include concrete implementation code, test code",
    );
    expect(planReviewSection).toContain(
      "plan-authored test bodies, shell snippets, shell recipes",
    );
    expect(planReviewSection).toContain(
      "helper-name prescriptions, line-number edits, or commit recipes",
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
    expect(planningHintExample).toContain(
      "**Contract checklist:** N/A — this exact token replacement is a single-file",
    );
    expect(planningHintExample).toContain(
      "changes no behavior, authority, generated output,\nfailure route, review rule, documentation navigation, or compatibility surface",
    );
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

  it("renders contract checklist surfaces for all supported skill targets", () => {
    for (const body of [playPlanningBody, playPlanningClaudeBody]) {
      expect(body).toContain("## Contract Checklist Triggers");
      expect(body).toContain("For non-trivial work, every task must include");
      expect(body).toContain(
        "Blank fields, unreplaced placeholders, and\nunexplained `N/A` entries are plan-review failures",
      );
      expect(body).toContain(
        "must not prescribe concrete code, test bodies, helper names, shell recipes",
      );
      expect(body).toContain("line-number edits, or command sequences");
      expect(body).toContain("**Contract checklist:**");
      expect(body).toContain("Trigger criteria");
      expect(body).toContain("Triggered tasks must name the trigger criteria");
      expect(body).toContain("Affected consumers / generated outputs");
      expect(body).toContain(
        "The contract checklist is present for every triggered task",
      );
    }

    for (const body of [
      playSubagentExecutionBody,
      playSubagentExecutionClaudeBody,
    ]) {
      expect(body).toContain("When a task includes a contract checklist");
      expect(normalizeWhitespace(body)).toContain(
        "they do not make plan-authored implementation mechanics authoritative",
      );
      expect(body).toContain(
        "helper-name prescriptions,\nline-number edits, or commit recipes authoritative",
      );
      expect(normalizeWhitespace(body)).toContain(
        "If a checklist field is blank, an `N/A` lacks a task-specific reason",
      );
    }
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
      "all five skip-dispatch guardrails pass",
    );
    expect(playSubagentExecutionBody).not.toContain(
      "all four skip-dispatch guardrails pass",
    );
    expect(playSubagentExecutionBody).not.toContain("All four guardrails hold");
    expect(playSubagentExecutionBody).not.toContain(
      "guardrail #4 fails (TDD expectation present)",
    );
    expect(playSubagentExecutionBody).toContain(
      "The plan constrains implementation intent, boundaries, source-of-truth",
    );
    expect(playSubagentExecutionBody).toContain(
      "It does not\nmake concrete code-like examples, test snippets, plan-authored test bodies,\nshell snippets, shell recipes, command sequences, helper-name prescriptions",
    );
    expect(playSubagentExecutionBody).toContain(
      "line-number edits, or commit recipes authoritative",
    );
    expect(playSubagentExecutionBody).toContain(
      "labels that content as approved verbatim artifact content and names the\nauthority source",
    );
    expect(playSubagentExecutionBody).toContain(
      "Implementers choose concrete code, tests, docs, and\nverification commands only after reading the relevant source files directly",
    );
    expect(playSubagentExecutionBody).toContain(
      "When a task includes a contract checklist",
    );
    expect(playSubagentExecutionBody).toContain(
      "Before any implementer dispatch or inline execution, run a structural",
    );
    expect(playSubagentExecutionBody).toContain(
      "Do not infer trigger applicability\ninside `play-subagent-execution`",
    );
    expect(playSubagentExecutionBody).toContain(
      "A no-trigger\nomission reason is trusted only when this controller can identify an upstream\n`play-planning` plan-review PASS for the plan being executed",
    );
    expect(playSubagentExecutionBody).toContain(
      "Direct,\nhand-written, copied, or older plans without that upstream PASS must include a\nstructurally complete checklist instead of an omission reason",
    );
    expect(playSubagentExecutionBody).toContain(
      "do not dispatch an implementer or execute\ninline against the invalid task contract",
    );
    expect(playSubagentExecutionBody).toContain(
      "Trigger criteria are durable ADR documentation",
    );
    expect(playSubagentExecutionBody).toContain(
      "Claude/Codex generated skill outputs marked `N/A`",
    );
    expect(playSubagentExecutionBody).toContain(
      "retry/recovery/cleanup/terminal-state behavior marked `N/A`",
    );
    expect(playSubagentExecutionBody).toContain(
      "owner/authority,\naffected consumers/generated outputs, must-preserve, required behavior",
    );
    expect(normalizeWhitespace(playSubagentExecutionBody)).toContain(
      "they do not make plan-authored implementation mechanics authoritative",
    );
    expect(playSubagentExecutionBody).toContain(
      "helper-name prescriptions,\nline-number edits, or commit recipes authoritative",
    );
    expect(normalizeWhitespace(playSubagentExecutionBody)).toContain(
      "If a checklist field is blank, an `N/A` lacks a task-specific reason",
    );
    expect(playSubagentExecutionBody).toContain(
      "fail closed: report\nBLOCKED/NEEDS_CONTEXT with the exact contract gap",
    );
    expect(playSubagentExecutionBody).not.toContain("fuller review path");
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

    const skipDispatchConditionsStart =
      playSubagentExecutionBody.indexOf("### Conditions");
    const skipDispatchConditionsEnd = playSubagentExecutionBody.indexOf(
      "### Inline execution sequence",
      skipDispatchConditionsStart,
    );
    expect(skipDispatchConditionsStart).toBeGreaterThanOrEqual(0);
    expect(skipDispatchConditionsEnd).toBeGreaterThan(
      skipDispatchConditionsStart,
    );
    const skipDispatchConditionsSection = playSubagentExecutionBody.slice(
      skipDispatchConditionsStart,
      skipDispatchConditionsEnd,
    );
    expect(skipDispatchConditionsSection).toContain(
      "The controller evaluates five conditions",
    );
    expect(skipDispatchConditionsSection).toContain(
      "If condition #4 fails, stop before implementation and\nreport BLOCKED/NEEDS_CONTEXT for the task contract",
    );
    expect(skipDispatchConditionsSection).toContain(
      "Other misses fall back to\nthe dispatched-implementer flow",
    );
    expect(skipDispatchConditionsSection).toContain(
      "Task contract gate is satisfied",
    );
    expect(skipDispatchConditionsSection).toContain(
      "The task passes the structural task-contract gate",
    );
    expect(skipDispatchConditionsSection).toContain(
      "The controller does not re-infer `play-planning` trigger applicability here",
    );
    expect(skipDispatchConditionsSection).toContain(
      "Direct, hand-written, copied, or older plans without that upstream PASS must include the checklist",
    );
    expect(skipDispatchConditionsSection).not.toContain("all four");

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
    expect(normalizeWhitespace(fallbackSection)).toContain(
      "use `implementer-prompt.md` regardless of any `**Mode:** mechanical` hint",
    );
    expect(fallbackSection).toContain("Guardrail #4 fails");
    expect(fallbackSection).toContain("missing or invalid contract checklist");
    expect(fallbackSection).toContain(
      "stop before implementation and report BLOCKED/NEEDS_CONTEXT",
    );
    expect(fallbackSection).toContain(
      "unconfirmed owner, authority, source-of-truth, consumer, generated-output, or evidence surface",
    );
    expect(fallbackSection).toContain(
      "Do not dispatch a mechanical implementer or run inline execution against an invalid contract",
    );
    expect(fallbackSection).not.toContain("all four");

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
    expect(processSection).toContain(
      '"Read plan (resolve Plan: <path> reference if present), extract all tasks with full text, note context, create TodoWrite" -> "Task contract structurally valid?"',
    );
    expect(processSection).toContain(
      '"Task contract structurally valid?" -> "Stop: report BLOCKED/NEEDS_CONTEXT for task contract" [label="no"]',
    );
    expect(processSection).toContain(
      '"Task contract structurally valid?" -> "Plan has exactly one task?" [label="yes"]',
    );
    expect(processSection).toContain(
      '"Plan has exactly one task?" -> "Contract checklist requirement missing or invalid?" [label="yes (skip per-task review)"]',
    );
    expect(processSection).toContain(
      '"Contract checklist requirement missing or invalid?" -> "Stop: report BLOCKED/NEEDS_CONTEXT for task contract" [label="yes"]',
    );
    expect(processSection).toContain(
      '"Contract checklist requirement missing or invalid?" -> "Remaining skip-dispatch guardrails all pass?" [label="no"]',
    );
    expect(processSection).toContain(
      '"Remaining skip-dispatch guardrails all pass?" -> "Dispatch the implementer agent (references/implementer-prompt.md)" [label="no (fallback for non-contract guardrail miss)"]',
    );
    expect(processSection).not.toContain(
      '"Skip-dispatch guardrails all pass?" -> "Dispatch the implementer agent (references/implementer-prompt.md)" [label="no (fallback)"]',
    );
    expect(processSection).not.toContain("all four");
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

  it("documents issue-priming implementation and review handoffs", async () => {
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
    expect(issuePhase6Section).toContain(
      "Four runtime guardrails (single-task, `**Mode:** mechanical`, structural task-contract gate satisfied, no TDD expectations or legacy TDD step-pair markers)",
    );
    expect(issuePhase6Section).toContain(
      "A missing or invalid required contract checklist stops before implementation",
    );
    expect(issuePhase6Section).not.toContain("Three runtime guardrails");
    expect(issuePhase6Section).not.toContain(
      "single-task, `**Mode:** mechanical`, no TDD step-pair",
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

    const adr0007 = await readFile(
      path.join(repoRoot, "docs/adr/adr-0007-review-pipeline-delineation.md"),
      "utf-8",
    );
    const adr0015 = await readFile(
      path.join(
        repoRoot,
        "docs/adr/adr-0015-skip-dispatch-for-trivial-single-task-plans.md",
      ),
      "utf-8",
    );
    expect(adr0007).toContain(
      "four runtime guardrails (single-task plan, `**Mode:** mechanical`, structural",
    );
    expect(adr0007).toContain(
      "task-contract gate satisfied, no TDD expectations or legacy TDD step-pair",
    );
    expect(adr0007).not.toContain("three runtime guardrails");
    expect(adr0015).toContain(
      "evaluate five guardrails on the plan; if all hold",
    );
    expect(adr0015).toContain(
      "**Runtime guardrail.** The task passes `play-subagent-execution`'s",
    );
    expect(adr0015).toContain(
      "The controller does not re-infer\n   `play-planning` trigger applicability at execution time",
    );
    expect(adr0015).toContain(
      "trigger\n   criteria, owner/authority, affected consumers/generated outputs",
    );
    expect(adr0015).toContain(
      "task-specific no-trigger omission reason backed by an upstream\n   `play-planning` plan-review PASS",
    );
    expect(adr0015).toContain(
      "Direct,\n   hand-written, copied, or older plans without that upstream PASS must include\n   the checklist",
    );
    expect(adr0015).toContain(
      "If source inspection cannot confirm the checklist's owner,\n   authority, source-of-truth, consumer, generated-output, or evidence surface",
    );
    expect(adr0015).toContain(
      "If guardrail #4 fails, the controller stops before implementation",
    );
    expect(adr0015).not.toContain(
      "if any `play-planning` contract checklist trigger applies",
    );
    expect(adr0015).not.toContain("evaluate four guardrails");
    expect(adr0015).not.toContain("remaining three runtime guardrails");

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
