import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { cleanupTempDir } from "../__test-helpers__/fixtures.js";
import {
  getMarkdownSection,
  normalizeWhitespace,
  readRepoFile,
  readSkillSource,
} from "../__test-helpers__/skill-contracts.js";

const execFileAsync = promisify(execFile);

function quoteShellArg(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function nodeNoopCommand(): string {
  return `${quoteShellArg(process.execPath)} -e "process.exit(0)"`;
}

function sliceBetween(content: string, start: string, end: string): string {
  const startIndex = content.indexOf(start);
  const endIndex = content.indexOf(end);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return content.slice(startIndex, endIndex);
}

function expectSharedLifecycleReference(section: string): void {
  expect(section).toContain("subagent-lifecycle");
  expect(section).toContain("target-honest cleanup outcomes");
  expect(section).toContain("slot-limit");
  expect(section).toContain("recovery");
}

async function git(args: string[], cwd: string): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

type AutosquashFixtureOptions = {
  initDefaultBranch?: string;
  squashSubject?: string;
};

async function createAutosquashFixture({
  initDefaultBranch,
  squashSubject = "squash! feat: update note",
}: AutosquashFixtureOptions = {}): Promise<string> {
  const repoDir = await mkdtemp(path.join(tmpdir(), "devcanon-autosquash-"));

  const initArgs = initDefaultBranch
    ? ["-c", `init.defaultBranch=${initDefaultBranch}`, "init", "-q"]
    : ["init", "-q"];

  await git(initArgs, repoDir);
  await git(["checkout", "-q", "-B", "main"], repoDir);
  await git(["config", "user.name", "DevCanon Test"], repoDir);
  await git(["config", "user.email", "devcanon@example.test"], repoDir);
  await git(["config", "commit.gpgSign", "false"], repoDir);

  await writeFile(path.join(repoDir, "note.txt"), "base\n", "utf-8");
  await git(["add", "note.txt"], repoDir);
  await git(["commit", "-q", "-m", "feat: base"], repoDir);

  await git(["checkout", "-q", "-b", "feature/autosquash"], repoDir);
  await writeFile(path.join(repoDir, "note.txt"), "base\nfeature\n", "utf-8");
  await git(["add", "note.txt"], repoDir);
  await git(["commit", "-q", "-m", "feat: update note"], repoDir);

  await writeFile(
    path.join(repoDir, "note.txt"),
    "base\nfeature\nsquash follow-up\n",
    "utf-8",
  );
  await git(["add", "note.txt"], repoDir);
  await git(["commit", "-q", "-m", squashSubject], repoDir);

  return repoDir;
}

describe("existing skills source prose contracts", () => {
  it("keeps design-to-plan requirement traceability contracts in source", async () => {
    const playBrainstorm = await readSkillSource("play-brainstorm");
    const playPlanning = await readSkillSource("play-planning");
    const hardRequirements = getMarkdownSection(
      playBrainstorm,
      "Hard Requirements Ledger",
    );
    const traceability = getMarkdownSection(
      playPlanning,
      "Requirements Traceability",
    );
    const planningSelfReview = getMarkdownSection(playPlanning, "Self-Review");
    const planningReview = getMarkdownSection(playPlanning, "Plan Review");
    const normalizedHardRequirements = normalizeWhitespace(hardRequirements);
    const normalizedTraceability = normalizeWhitespace(traceability);
    const normalizedPlanningSelfReview =
      normalizeWhitespace(planningSelfReview);
    const normalizedPlanningReview = normalizeWhitespace(planningReview);

    expect(hardRequirements).toContain("## Hard Requirements");
    expect(normalizedHardRequirements).toContain(
      "non-trivial executable designs when normative requirements must be preserved across planning",
    );
    expect(normalizedHardRequirements.toLowerCase()).toContain(
      "trivial, mechanical, or requirement-light work",
    );
    expect(normalizedHardRequirements.toLowerCase()).toContain(
      "the ledger, not incidental modal verbs in examples, quoted issue text, shell snippets, or explanatory prose, is the executable traceability contract",
    );
    expect(normalizedHardRequirements).toContain(
      "| ID | Requirement | Source | Rationale |",
    );
    expect(normalizeWhitespace(playBrainstorm)).toContain(
      "missing or ambiguous hard-requirements ledger",
    );

    expect(traceability).toContain("## Traceability Matrix");
    expect(traceability).toContain(
      "plans based on designs with hard requirements",
    );
    expect(normalizedTraceability).toContain(
      "task coverage, acceptance criteria, and proof or verification obligation",
    );
    expect(normalizedTraceability).toContain(
      "| Requirement | Task coverage | Acceptance criteria | Proof obligation |",
    );
    expect(normalizedTraceability).toContain("plan-review failures");
    expect(normalizedTraceability).toContain(
      "lacks explicit task coverage, acceptance criteria, or proof coverage",
    );
    expect(normalizedTraceability).toContain(
      "docs/guidelines/writing-skills.md",
    );
    expect(normalizedTraceability).toContain(
      "docs/guidelines/documentation-checklists.md",
    );
    expect(normalizedTraceability).toContain("Adjacent Governance Policy Set");

    expect(normalizedPlanningSelfReview).toContain(
      "Requirements traceability check",
    );
    expect(normalizedPlanningSelfReview).toContain("`## Traceability Matrix`");
    expect(normalizedPlanningSelfReview).toContain(
      "every ledger row has explicit task coverage, acceptance criteria, and proof coverage",
    );

    expect(normalizedPlanningReview).toContain("`## Hard Requirements` ledger");
    expect(normalizedPlanningReview).toContain("`## Traceability Matrix`");
    expect(normalizedPlanningReview).toContain(
      "every hard requirement has explicit task coverage, acceptance criteria, and proof coverage",
    );
  });

  it("keeps generated/reference coverage triggers owned by the skill writing guideline", async () => {
    const guideline = await readRepoFile("docs/guidelines/writing-skills.md");
    const coverageRule = getMarkdownSection(
      guideline,
      "8. Generated/Reference Coverage Trigger",
    );
    const normalizedRule = normalizeWhitespace(coverageRule).toLowerCase();

    for (const phrase of [
      "source-contract",
      "src/skill-contracts/",
      "render",
      "src/render/",
      "scripts",
      "target metadata",
      "sidecars",
      "touched-skill allowlists",
      "generated output",
      "disposable",
    ]) {
      expect(normalizedRule).toContain(phrase);
    }

    expect(normalizedRule).toMatch(/skill\.md.*prose|prose.*skill\.md/);
    expect(normalizedRule).toMatch(
      /references\/.*mirrored|mirrored.*references\//,
    );
    expect(normalizedRule).toMatch(/scripts\/.*runtime|runtime.*scripts\//);
    expect(normalizedRule).toContain("do not snapshot every generated byte");
  });

  it("keeps DevCanon issue reporting pointed at the DevCanon repository", async () => {
    const skillSource = await readSkillSource("report-devcanon-issue");

    expect(skillSource).toContain("name: report-devcanon-issue");
    expect(skillSource).toContain("ryumiel/devcanon");
    expect(skillSource).not.toContain("ryumiel/agent-manager");
    expect(skillSource).toContain("consumer repo names, owners, orgs");
    expect(skillSource).toContain("Ask one question at a time");
    expect(skillSource).toContain(
      "Never post an issue without showing the exact draft first and receiving explicit confirmation.",
    );
    expect(skillSource).toContain("MODE=draft");
    expect(skillSource).toContain(
      "If GitHub access to `ryumiel/devcanon` is unavailable, return `MODE=draft` and stop without attempting to post.",
    );
  });

  it("keeps behavior-spec evidence routing owned by durable guideline sources", async () => {
    const procedureMap = await readRepoFile(
      "docs/guidelines/portable-afds-user-procedure-map.md",
    );
    const routingGuideline = await readRepoFile(
      "docs/guidelines/behavior-spec-evidence-routing.md",
    );

    expect(procedureMap).toContain("behavior-spec-evidence-routing.md");
    expect(procedureMap).toContain("durable source of origin");
    expect(procedureMap).toContain(
      "`spec-readiness-review`, then `issue-slicing`",
    );

    expect(routingGuideline).toContain("The durable source of origin");
    expect(routingGuideline).toContain(
      "`docs/specs/afds-workflow-routing.md` `EVID-001`",
    );
    expect(routingGuideline).toContain("Runtime excerpt from `EVID-001`");
    expect(routingGuideline).toContain(
      "checked requirement, route, execution contract, or owner",
    );
    expect(routingGuideline).toContain("blocker or follow-up owner");
    expect(routingGuideline).toContain("contract to behavior-spec authoring");

    for (const section of [
      "Evidence Pointers",
      "Readiness Before Slicing",
      "Storage Boundary",
    ]) {
      expect(routingGuideline).toContain(section);
    }
  });

  it("keeps the spec-readiness-review status and owner-link contract in source", async () => {
    const skillSource = await readSkillSource("spec-readiness-review");
    const reviewProcedure = getMarkdownSection(skillSource, "Review Procedure");
    const outputFormat = getMarkdownSection(skillSource, "Output Format");

    expect(outputFormat).toContain(
      "**Status:** <one of: Ready, Needs revision, Blocked>",
    );
    expect(outputFormat).toContain(
      "Final status: <repeat the same single status>",
    );
    expect(outputFormat).not.toContain(
      "**Status:** Ready | Needs revision | Blocked",
    );
    expect(outputFormat).not.toContain(
      "Final status: Ready | Needs revision | Blocked",
    );

    expect(reviewProcedure).toContain(
      "references/pre-slicing-procedure-map.md",
    );
    expect(reviewProcedure).toContain("references/routing-and-evidence.md");
    expect(reviewProcedure).toContain(
      "artifact, durable team, system, or role",
    );
    expect(reviewProcedure).toContain("do not accept");
    expect(reviewProcedure).toContain("person names, assignees");
    expect(reviewProcedure).toContain("live tracker ownership");
    expect(reviewProcedure).toContain("Repo-local project docs are optional");
    expect(reviewProcedure).toContain(
      "Do not treat repo-local docs as required",
    );
    expect(skillSource).toContain("does not approve implementation");

    expect(skillSource).not.toContain("docs/specs/afds-workflow-routing.md");
    expect(skillSource).not.toContain("MAP.md");
    expect(skillSource).not.toContain("docs/guidelines/");
  });

  it("keeps the issue-slicing draft-only provider-neutral contract in source", async () => {
    const skillSource = await readSkillSource("issue-slicing");
    const procedure = getMarkdownSection(skillSource, "Procedure");
    const evidencePointers = getMarkdownSection(
      skillSource,
      "Evidence Pointers",
    );
    const outputFormat = getMarkdownSection(skillSource, "Output Format");

    expect(outputFormat).toContain("MODE=draft");
    expect(outputFormat).toContain("MODE=blocked");
    expect(skillSource).toContain("GitHub Issues or Linear");
    expect(procedure).toContain(
      "docs/guidelines/portable-afds-user-procedure-map.md",
    );

    for (const forbiddenMutation of [
      "Do not create live issues",
      "assign users",
      "set status",
      "mutate labels",
      "duplicate live tracker state",
    ]) {
      expect(skillSource).toContain(forbiddenMutation);
    }

    expect(evidencePointers).toContain(
      "At least one evidence pointer must name the owning durable artifact",
    );
    expect(skillSource).toContain(
      "<owning durable artifact>: <stable reference>",
    );
    expect(outputFormat).not.toContain(
      "Final mode: <repeat MODE=draft or MODE=blocked>",
    );
  });

  it("keeps the write-product-requirements PRD boundaries in source", async () => {
    const skillSource = await readSkillSource("write-product-requirements");
    const overview = getMarkdownSection(skillSource, "Overview");
    const procedure = getMarkdownSection(skillSource, "Procedure");
    const shape = getMarkdownSection(skillSource, "Product Requirements Shape");
    const boundaryChecklist = getMarkdownSection(
      skillSource,
      "Boundary Checklist",
    );

    expect(procedure).toContain("docs/product-requirements/<topic>.md");
    expect(procedure).toContain("profile gate");
    expect(overview).toContain("product intent");
    expect(skillSource).toContain("live issue state");
    expect(procedure).toContain("PR state");
    expect(procedure).toContain("agent-local execution detail");
    expect(boundaryChecklist).toContain("contract authority");
    expect(boundaryChecklist).toContain("links to contract authority");
    expect(boundaryChecklist).toContain("source-owned schemas");
    expect(shape).toContain("Readiness criteria");
    expect(shape).toContain("Product validation criteria");
    expect(shape).toContain("Expected follow-up artifact references");
    expect(shape).toContain("Non-goals and out-of-scope items");
    expect(skillSource).toContain("immediate next owning artifact");
    expect(procedure).toContain("Portable AFDS Toolkit PRD");
    expect(procedure).toContain("root `PRD.md`");
    expect(shape).toContain("Stable requirement IDs");
    expect(shape).toContain("line-number references");
    expect(procedure).toContain("write-product-spec");
    expect(procedure).toContain("docs/specs/<topic>.md");
  });

  it("keeps guarded tiny-diff review routing constraints in play-review source", async () => {
    const skillSource = await readSkillSource("play-review");
    const tinyDiffSection = getMarkdownSection(
      skillSource,
      "Phase 2.75: Guarded tiny-diff mode",
    );
    const redFlags = await readRepoFile(
      "skills/play-review/references/red-flags.md",
    );

    for (const phrase of [
      "Guarded tiny-diff mode",
      "at most 2 files",
      "at most 20 total lines",
      "Correctness, Data-safety, and critic verification remain",
      "safe tiny diff example",
      "Result: tiny-diff mode may suppress the",
      "dynamic fanout; Correctness, Data-safety, and critic still run.",
      "small-but-risky diff example",
      "Result: normal full dynamic fanout",
      "If any check is ambiguous, fall back to the normal full dynamic fanout.",
      "`is_followup_narrow` is **false**",
      "docs/specs/**",
      "reviewer-routing policy",
      "docs/guidelines/*.md",
      "references/red-flags.md",
    ]) {
      expect(tinyDiffSection).toContain(phrase);
    }

    expect(tinyDiffSection).not.toContain("skills/**/SKILL.md");
    expect(redFlags).toContain(
      "You treated line count alone as enough to suppress the dynamic fanout",
    );
  });

  it("keeps review-response commit continuity policy in source", async () => {
    const skillSource = await readSkillSource("play-review-response");
    const implementationOrderIndex = skillSource.indexOf(
      "## Implementation Order",
    );
    const commitPolicyIndex = skillSource.indexOf(
      "## PR Branch Commit Continuity",
    );
    const threadClosureIndex = skillSource.indexOf(
      "## Pushed-Fix Inline Thread Closure",
    );
    const pushBackIndex = skillSource.indexOf("## When To Push Back");

    expect(implementationOrderIndex).toBeGreaterThanOrEqual(0);
    expect(commitPolicyIndex).toBeGreaterThan(implementationOrderIndex);
    expect(threadClosureIndex).toBeGreaterThan(commitPolicyIndex);
    expect(pushBackIndex).toBeGreaterThan(threadClosureIndex);

    const implementationOrder = getMarkdownSection(
      skillSource,
      "Implementation Order",
    );
    const unclearFeedback = getMarkdownSection(
      skillSource,
      "Handling Unclear Feedback",
    );
    const commitPolicy = getMarkdownSection(
      skillSource,
      "PR Branch Commit Continuity",
    );
    const normalizedCommitPolicy = normalizeWhitespace(commitPolicy);
    const threadClosure = getMarkdownSection(
      skillSource,
      "Pushed-Fix Inline Thread Closure",
    );
    const normalizedThreadClosure = normalizeWhitespace(threadClosure);
    const githubReplies = getMarkdownSection(
      skillSource,
      "GitHub Thread Replies",
    );
    const normalizedGithubReplies = normalizeWhitespace(githubReplies);

    expect(normalizeWhitespace(implementationOrder)).toMatch(
      /verification.*already-pushed or reviewed PR branch.*follow-up commit.*plain push/,
    );
    expect(normalizeWhitespace(unclearFeedback)).toContain(
      "ASK for clarification on unclear items",
    );

    expect(normalizedCommitPolicy).toMatch(
      /pushed.*review.*follow-up commit.*plain push/i,
    );
    expect(normalizedCommitPolicy).toMatch(/do not amend.*do not force-push/i);
    expect(normalizedCommitPolicy).toMatch(
      /user explicitly asks.*repository workflow/i,
    );
    expect(normalizedCommitPolicy).toMatch(/pre-push.*cleanup.*allowed/i);
    expect(normalizedCommitPolicy).toMatch(
      /```text.*pre-push.*amend.*post-review.*force.*post-review.*follow-up commit.*```/i,
    );
    expect(normalizedCommitPolicy).toContain("review continuity");

    expect(normalizedThreadClosure).toMatch(
      /verify.*current review comments.*implement.*run.*checks.*commit.*push.*re-fetch.*thread state.*confirm.*github writes.*reply in-thread.*re-fetch.*thread state.*resolve.*eligible threads/i,
    );
    expect(normalizedThreadClosure).toMatch(
      /re-fetch.*after.*push.*before.*reply/i,
    );
    expect(normalizedThreadClosure).toMatch(
      /re-fetch.*after.*reply.*immediately before.*resolution/i,
    );
    expect(normalizedThreadClosure).toContain("Safe-to-resolve criteria");

    for (const requiredCriterion of [
      "GitHub writes are permitted",
      "explicit user approval",
      "approved posting gate",
      "latest fetched thread after the reply is still unresolved",
      "same concern",
      "pushed branch contains the fix",
      "reply explains why no code change is required",
      "relevant checks",
      "permission to resolve",
      "active owner",
    ]) {
      expect(normalizedThreadClosure).toContain(requiredCriterion);
    }

    for (const requiredDisposition of [
      "Explanation-only",
      "post-reply fetched thread",
      "Stale or outdated",
      "Already-resolved",
      "unclear, partially fixed, or newly conflicting",
      "stay unresolved",
    ]) {
      expect(normalizedThreadClosure).toContain(requiredDisposition);
    }

    expect(normalizedGithubReplies).toMatch(/comment thread/i);
    expect(normalizedGithubReplies).toMatch(/follow-up commit or fix/i);
    expect(normalizedGithubReplies).toMatch(/thread context/i);
    expect(normalizedGithubReplies).toContain(
      "Pushed-Fix Inline Thread Closure",
    );
  });

  it("keeps review-response execution-mode routing boundaries in source", async () => {
    const skillSource = await readSkillSource("play-review-response");
    const sourceSpecificIndex = skillSource.indexOf(
      "## Source-Specific Handling",
    );
    const executionModeIndex = skillSource.indexOf(
      "## Execution Mode Selection",
    );
    const yagniIndex = skillSource.indexOf(
      '## YAGNI Check for "Professional" Features',
    );

    expect(sourceSpecificIndex).toBeGreaterThanOrEqual(0);
    expect(executionModeIndex).toBeGreaterThan(sourceSpecificIndex);
    expect(yagniIndex).toBeGreaterThan(executionModeIndex);

    const executionMode = getMarkdownSection(
      skillSource,
      "Execution Mode Selection",
    );
    const normalizedExecutionMode = normalizeWhitespace(executionMode);
    const lowerExecutionMode = normalizedExecutionMode.toLowerCase();

    expect(normalizedExecutionMode).toContain("thread-aware intake");
    expect(normalizedExecutionMode).toMatch(
      /After.*thread-aware intake.*verification.*classify/i,
    );

    for (const disposition of [
      "Inline execution",
      "Planned execution",
      "No-code response",
    ]) {
      expect(normalizedExecutionMode).toContain(disposition);
    }

    for (const noCodeOutcome of [
      "technically invalid",
      "stale",
      "already-addressed",
      "explanation-only",
      "needs-user-clarification",
    ]) {
      expect(lowerExecutionMode).toContain(noCodeOutcome);
    }

    for (const inlineCondition of [
      /only when every.*condition.*true/i,
      /one or two.*clear.*low-risk.*local.*comments/i,
      /affected code.*same file.*tightly local files/i,
      /no ambiguity/i,
      /no public contract, workflow-policy, skill\/agent contract, schema, generated-output, security, lifecycle, data-loss, or cross-module behavior risk/i,
      /no new test design/i,
      /quick verification/i,
    ]) {
      expect(normalizedExecutionMode).toMatch(inlineCondition);
    }

    const plannedExecutionRules = normalizeWhitespace(
      sliceBetween(
        executionMode,
        "Planned execution is required for multi-item",
        "For planned execution",
      ),
    );

    for (const plannedTrigger of [
      /Planned execution.*required.*multi-item/i,
      /Planned execution.*required.*ambiguous/i,
      /Planned execution.*required.*policy-sensitive/i,
      /Planned execution.*required.*contract-sensitive/i,
      /Planned execution.*required.*schema/i,
      /Planned execution.*required.*generated-output/i,
      /Planned execution.*required.*security-sensitive/i,
      /Planned execution.*required.*lifecycle/i,
      /Planned execution.*required.*recovery/i,
      /Planned execution.*required.*data-loss/i,
      /Planned execution.*required.*cross-module/i,
      /Planned execution.*required.*high-risk/i,
      /Planned execution.*required.*independent implementation\/review gates/i,
      /Planned execution.*required.*audit evidence|Planned execution.*required.*traceability/i,
      /Planned execution.*required.*explanation-only.*mixed.*code/i,
    ]) {
      expect(plannedExecutionRules).toMatch(plannedTrigger);
    }

    for (const plannedTaskRequirement of [
      "reviewer concern",
      "verified evidence",
      "disposition",
      "source authority",
      "acceptance criteria",
      "TDD expectations",
      "verification expectations",
      "contract checklist",
    ]) {
      expect(lowerExecutionMode).toContain(
        plannedTaskRequirement.toLowerCase(),
      );
    }

    for (const handoffBoundary of [
      "direct/manual",
      "play-subagent-execution",
      "Plan: <path>",
      ".ephemeral/*-plan.md",
      "issue-priming",
      "`--auto`",
      "reduced-route",
    ]) {
      expect(normalizedExecutionMode).toContain(handoffBoundary);
    }
    expect(normalizedExecutionMode).toMatch(
      /must not rely on.*issue-priming.*`--auto`.*reduced-route/i,
    );

    for (const executorOwnedMechanic of [
      "task-contract validation",
      "dispatch/skip-dispatch",
      "review routing",
      "snapshot handling",
      "implementer lifecycle",
      "final whole-implementation review",
      "whole-diff gate validation",
    ]) {
      expect(lowerExecutionMode).toContain(executorOwnedMechanic.toLowerCase());
    }

    expect(normalizedExecutionMode).toMatch(/executor-owned mechanics/i);
    expect(normalizedExecutionMode).toMatch(
      /Direct\/manual review-response plans.*do not get.*automatic whole-diff review/i,
    );
    expect(normalizedExecutionMode).toMatch(
      /Run `branch-review`.*planned review-response work needs whole-diff coverage/i,
    );
    expect(normalizedExecutionMode).toMatch(
      /After.*executor.*returns.*thread refetching.*resolution eligibility.*final PR-thread closeout/i,
    );
    expect(normalizedExecutionMode).toMatch(/inline example/i);
    expect(normalizedExecutionMode).toMatch(
      /plan-plus-executor handoff example/i,
    );
  });

  it("keeps pr-merge final reports separate from local cleanup outcomes", async () => {
    const skillSource = await readSkillSource("pr-merge");
    const cleanupSection = getMarkdownSection(
      skillSource,
      "Step 3b: Post-Merge Cleanup",
    );
    const normalizedCleanupSection = normalizeWhitespace(cleanupSection);

    expect(cleanupSection).toContain("Final report contract");
    expect(normalizedCleanupSection).toMatch(/remote merge.*PR URL.*cleanup/i);
    expect(normalizedCleanupSection).toMatch(
      /worktree.*removed, skipped, or failed.*path.*reason/i,
    );
    expect(normalizedCleanupSection).toMatch(/base checkout\/pull.*attempted/i);
    expect(normalizedCleanupSection).toMatch(
      /local branch.*deleted, retained, or skipped.*reason/i,
    );
    expect(normalizedCleanupSection).toMatch(/manual cleanup.*required.*none/i);
    expect(normalizedCleanupSection).not.toContain(
      "Report the merge to the user with the PR URL. Done.",
    );
  });

  it("keeps PR authoring policy shared and PR creation worktrees preserved", async () => {
    const prAuthoring = await readSkillSource("pr-authoring");
    const playBranchFinish = await readSkillSource("play-branch-finish");
    const prMerge = await readSkillSource("pr-merge");
    const issuePrimingWorkflow = await readSkillSource(
      "issue-priming-workflow",
    );
    const issuePrimingCommonMistakes = await readRepoFile(
      "skills/issue-priming-workflow/references/common-mistakes.md",
    );
    const issuePrimingRedFlags = await readRepoFile(
      "skills/issue-priming-workflow/references/red-flags.md",
    );
    const commonMistakes = await readRepoFile(
      "skills/play-branch-finish/references/common-mistakes.md",
    );
    const redFlags = await readRepoFile(
      "skills/play-branch-finish/references/red-flags.md",
    );
    const adr0012 = await readRepoFile(
      "docs/adr/adr-0012-side-channel-file-delivery-for-play-review-findings.md",
    );
    const adr0013 = await readRepoFile(
      "docs/adr/adr-0013-path-based-phase-artifact-handoff.md",
    );
    const map = await readRepoFile("MAP.md");

    const normalizedPrAuthoring = normalizeWhitespace(prAuthoring);
    for (const phrase of [
      "compose",
      "validate-fix",
      "Title format",
      "Required sections",
      "Anti-patterns",
      "Content vs diff",
      "commit headlines",
      "diff file list",
      "owns PR policy-surface discovery",
      "already-read repository PR guideline/template contents",
      "when omitted, `pr-authoring` discovers and reads them",
      "final-state",
      "no commit SHAs",
      "no commit-by-commit changelogs",
      "no originally/now chronology",
      "no review-history sections",
      "no file-by-file diff restatement",
      ".github/pull_request_template.md",
      "docs/guidelines/pr-guideline.md",
      "Body-only repair",
      "Title-only repair",
      "Title and body repair",
      "Omit unchanged fields entirely",
    ]) {
      expect(normalizedPrAuthoring).toContain(phrase);
    }

    const option2 = sliceBetween(
      playBranchFinish,
      "#### Option 2: Push and Create PR",
      "#### Option 3: Keep As-Is",
    );
    const cleanup = sliceBetween(
      playBranchFinish,
      "### Step 5: Cleanup Worktree",
      "## Quick Reference",
    );
    const quickReference = getMarkdownSection(
      playBranchFinish,
      "Quick Reference",
    );
    const normalizedOption2 = normalizeWhitespace(option2);
    const normalizedCleanup = normalizeWhitespace(cleanup);

    expect(normalizedOption2).toContain("pr-authoring");
    expect(normalizedOption2).toContain("Created PR <url>");
    expect(normalizedOption2).toContain(
      "Branch <name> and worktree <path> preserved for review follow-up",
    );
    expect(normalizedOption2).toContain("gh pr create --title");
    expect(normalizedOption2).toContain("--body-file");
    expect(normalizedOption2).toContain(
      "Option 2 accepts an optional `assignee` argument",
    );
    expect(normalizedOption2).toContain(
      "callers such as `issue-priming-workflow` pass `assignee=@me`",
    );
    expect(normalizedOption2).toContain("--assignee");
    expect(normalizedOption2).toContain(
      "If the optional assignee argument was provided",
    );
    expect(normalizedOption2).toContain(
      "Set `ASSIGNEE` from the caller's `assignee` argument",
    );
    expect(normalizedOption2).toContain("docs/guidelines/pr-guideline.md");
    expect(normalizedOption2).toContain(
      "otherwise `pr-authoring` discovers those surfaces itself",
    );
    expect(normalizedOption2).toContain("PR_BODY_FILE=$(mktemp)");
    expect(normalizedOption2).toContain("trap 'rm -f \"$PR_BODY_FILE\"' EXIT");
    expect(normalizedOption2).not.toContain('--body "<body>"');
    expect(normalizedCleanup).toContain("Options 1 and 4");
    expect(normalizedCleanup).toContain(
      "Option 2 preserves the branch and worktree after PR creation",
    );
    expect(normalizedCleanup).not.toContain(
      "Option 2 reaches Step 5 only after PR creation",
    );
    expect(quickReference).toContain("Create PR");
    expect(quickReference).toMatch(/Create PR[^\n]*✓/);

    expect(normalizeWhitespace(commonMistakes)).toContain(
      "PR creation cleanup",
    );
    expect(normalizeWhitespace(commonMistakes)).toContain(
      "PR worktree is the review follow-up workspace",
    );
    expect(normalizeWhitespace(commonMistakes)).toContain(
      "docs/guidelines/pr-guideline.md",
    );
    expect(normalizeWhitespace(redFlags)).toContain(
      "Remove a PR-created worktree before merge or explicit discard",
    );
    expect(normalizeWhitespace(redFlags)).toContain(
      "Preserve the branch and worktree after Option 2 creates a PR",
    );

    const prMergeValidation = getMarkdownSection(
      prMerge,
      "Step 1b: Validate PR Title and Description",
    );
    expect(normalizeWhitespace(prMergeValidation)).toContain("pr-authoring");
    expect(normalizeWhitespace(prMergeValidation)).toContain("validate-fix");
    expect(normalizeWhitespace(prMergeValidation)).toContain("gh pr edit");
    expect(normalizeWhitespace(prMergeValidation)).toContain(
      ".github/pull_request_template.md",
    );
    expect(normalizeWhitespace(prMergeValidation)).toContain(
      "otherwise let `pr-authoring` discover and read the policy surfaces",
    );
    expect(normalizeWhitespace(prMergeValidation)).toContain(
      "PR_BODY_FILE=$(mktemp)",
    );
    expect(normalizeWhitespace(prMergeValidation)).toContain(
      "trap 'rm -f \"$PR_BODY_FILE\"' EXIT",
    );
    expect(normalizeWhitespace(prMergeValidation)).toContain(
      "Body-only repair",
    );
    expect(normalizeWhitespace(prMergeValidation)).toContain(
      'gh pr edit <N> --body-file "$PR_BODY_FILE"',
    );
    expect(normalizeWhitespace(prMergeValidation)).toContain(
      "Title-only repair",
    );
    expect(normalizeWhitespace(prMergeValidation)).toContain(
      'gh pr edit <N> --title "<fixed title>"',
    );
    expect(normalizeWhitespace(prMergeValidation)).toContain(
      "Title and body repair",
    );
    expect(normalizeWhitespace(prMergeValidation)).not.toContain(
      "skip validation",
    );
    expect(normalizeWhitespace(prMergeValidation)).not.toContain(
      "If no file is found",
    );
    expect(normalizeWhitespace(prMergeValidation)).not.toContain(
      "Search for `**/pr-guideline*.md`",
    );

    const phase8 = sliceBetween(
      issuePrimingWorkflow,
      "### Phase 8: Create PR",
      "## Quick Reference",
    );
    const issuePrimingCommonMistakesPointer = getMarkdownSection(
      issuePrimingWorkflow,
      "Common Mistakes",
    );
    const playBranchFinishCommonMistakesPointer = getMarkdownSection(
      playBranchFinish,
      "Common Mistakes",
    );
    expect(normalizeWhitespace(phase8)).toContain(
      "PR creation preserves the branch and worktree",
    );
    expect(normalizeWhitespace(phase8)).toContain("until `pr-merge`");
    expect(normalizeWhitespace(phase8)).toContain(
      "pr-authoring` owns both project-specific guideline handling and default fallback title/body structure",
    );
    expect(normalizeWhitespace(phase8)).toContain(
      "Pass `assignee=@me` to `play-branch-finish` Option 2",
    );
    expect(normalizeWhitespace(phase8)).not.toContain(
      "Pass `--assignee @me` to `gh pr create`",
    );
    expect(normalizeWhitespace(phase8)).not.toContain("defaults below");
    expect(normalizeWhitespace(phase8)).not.toContain("Default PR title");
    expect(normalizeWhitespace(phase8)).not.toContain(
      "Default PR description should include",
    );
    expect(normalizeWhitespace(issuePrimingCommonMistakes)).toContain(
      "Bypassing shared PR authoring",
    );
    expect(normalizeWhitespace(issuePrimingCommonMistakes)).toContain(
      "pr-authoring` in `compose` mode",
    );
    expect(normalizeWhitespace(issuePrimingCommonMistakes)).not.toContain(
      "Always glob for PR guidelines",
    );
    expect(normalizeWhitespace(issuePrimingCommonMistakesPointer)).toContain(
      "shared PR authoring bypass",
    );
    expect(
      normalizeWhitespace(issuePrimingCommonMistakesPointer),
    ).not.toContain("ignoring PR guideline");
    expect(normalizeWhitespace(issuePrimingRedFlags)).toContain(
      "instead of relying on `play-branch-finish` to invoke `pr-authoring`",
    );
    expect(normalizeWhitespace(issuePrimingRedFlags)).not.toContain(
      "reading the project's PR guideline first",
    );
    expect(
      normalizeWhitespace(playBranchFinishCommonMistakesPointer),
    ).toContain("PR creation cleanup");
    expect(
      normalizeWhitespace(playBranchFinishCommonMistakesPointer),
    ).toContain("local merge/discard cleanup mistakes");
    expect(
      normalizeWhitespace(playBranchFinishCommonMistakesPointer),
    ).toContain("ignoring shared PR authoring policy");
    expect(
      normalizeWhitespace(playBranchFinishCommonMistakesPointer),
    ).not.toContain("automatic worktree cleanup");
    expect(
      normalizeWhitespace(playBranchFinishCommonMistakesPointer),
    ).not.toContain("ignoring PR guideline");

    expect(normalizeWhitespace(adr0012)).toContain(
      "PR creation preserves the worktree",
    );
    expect(normalizeWhitespace(adr0013)).toContain(
      "PR creation preserves the worktree",
    );
    expect(normalizeWhitespace(adr0012)).not.toContain(
      "Options 1 (merge), 2 (PR), and 4 (discard)",
    );
    expect(normalizeWhitespace(adr0013)).not.toContain(
      "Options 1 (merge), 2 (PR), and 4 (discard)",
    );
    expect(map).toContain("skills/pr-authoring/SKILL.md");
  });

  it("keeps play-branch-finish autosquash local, opt-in, and PR-body neutral", async () => {
    const skillSource = await readSkillSource("play-branch-finish");
    const option2 = sliceBetween(
      skillSource,
      "#### Option 2: Push and Create PR",
      "#### Option 3: Keep As-Is",
    );
    const normalizedOption2 = normalizeWhitespace(option2);
    const redFlags = await readRepoFile(
      "skills/play-branch-finish/references/red-flags.md",
    );
    const commonMistakes = await readRepoFile(
      "skills/play-branch-finish/references/common-mistakes.md",
    );

    expect(skillSource).toContain("Present exactly these 4 options");
    expect(normalizedOption2).toContain(
      "Optional pre-push autosquash checkpoint",
    );
    expect(normalizedOption2).toMatch(
      /after tests pass.*base branch.*resolved.*before.*git push/i,
    );
    expect(normalizedOption2).toContain(
      "git log --oneline <base-branch>..HEAD",
    );
    expect(normalizedOption2).toContain("fixup!");
    expect(normalizedOption2).toContain("squash!");
    expect(normalizedOption2).toMatch(
      /opt-in.*never.*default.*exact affirmative/i,
    );
    expect(normalizedOption2).toContain(
      "This rewrites only local feature-branch commits and is not required.",
    );
    expect(normalizedOption2).toContain(
      "AUTOSQUASH_BASE=$(git merge-base <base-branch> HEAD)",
    );
    expect(normalizedOption2).toContain("PRE_AUTOSQUASH_HEAD=");
    expect(normalizedOption2).toContain('test -z "$(git status --porcelain)"');
    expect(normalizedOption2).toContain(
      "AUTOSQUASH_NOOP_EDITOR='node -e \"process.exit(0)\"'",
    );
    expect(normalizedOption2).toContain(
      'GIT_SEQUENCE_EDITOR="$AUTOSQUASH_NOOP_EDITOR" GIT_EDITOR="$AUTOSQUASH_NOOP_EDITOR" git rebase -i --autosquash "$AUTOSQUASH_BASE"',
    );
    expect(normalizedOption2).not.toContain("GIT_SEQUENCE_EDITOR=:");
    expect(normalizedOption2).toContain("git rebase --abort");
    expect(normalizedOption2).toContain(
      'git reset --hard "$PRE_AUTOSQUASH_HEAD"',
    );
    expect(normalizedOption2).toContain("REMAINING_AUTOSQUASH_MARKERS=");
    expect(normalizedOption2).toContain(
      'git log --format=%s "$AUTOSQUASH_BASE"..HEAD',
    );
    expect(normalizedOption2).toContain(
      "sed -n -e '/^fixup!/p' -e '/^squash!/p'",
    );
    expect(normalizedOption2).toMatch(/fixup!.*squash!|squash!.*fixup!/i);
    expect(normalizedOption2).toMatch(
      /post-autosquash tree.*unchanged.*before push/i,
    );
    expect(normalizedOption2).toMatch(
      /shared.*already-pushed.*open PR.*reviewed.*non-local/i,
    );
    expect(normalizedOption2).toMatch(
      /separate.*explicit shared-branch rewrite approval/i,
    );
    expect(normalizedOption2).toMatch(/granular.*review\/audit value.*skip/i);
    expect(normalizedOption2).toMatch(
      /PR (title and description|body).*final-state oriented/i,
    );
    expect(normalizedOption2).toContain("commit-history narration");

    expect(normalizedOption2).not.toMatch(
      /autosquash[^.]{0,80}(reduces?|improves?)[^.]{0,80}branch-review/i,
    );
    expect(normalizedOption2).not.toMatch(
      /branch-review[^.]{0,80}(cost|efficiency)/i,
    );

    expect(redFlags).toMatch(/autosquash/i);
    expect(redFlags).toMatch(/shared|already-pushed|open PR|reviewed/i);
    expect(redFlags).toMatch(/audit/i);
    expect(commonMistakes).toMatch(/autosquash/i);
    expect(commonMistakes).toMatch(/unchanged tree|tree.*unchanged/i);
    expect(commonMistakes).toMatch(/commit-history narration/i);
  });

  it("keeps the documented autosquash command noninteractive for squash markers", async () => {
    const repoDir = await createAutosquashFixture();
    const editorCommand = nodeNoopCommand();

    try {
      const { stdout: mergeBase } = await execFileAsync(
        "git",
        ["merge-base", "main", "HEAD"],
        { cwd: repoDir },
      );
      const { stdout: preTree } = await execFileAsync(
        "git",
        ["rev-parse", "HEAD^{tree}"],
        { cwd: repoDir },
      );

      await execFileAsync(
        "git",
        ["rebase", "-i", "--autosquash", mergeBase.trim()],
        {
          cwd: repoDir,
          env: {
            ...process.env,
            GIT_SEQUENCE_EDITOR: editorCommand,
            GIT_EDITOR: editorCommand,
          },
        },
      );

      const { stdout: postTree } = await execFileAsync(
        "git",
        ["rev-parse", "HEAD^{tree}"],
        { cwd: repoDir },
      );
      const { stdout: log } = await execFileAsync(
        "git",
        ["log", "--oneline", "main..HEAD"],
        { cwd: repoDir },
      );

      expect(postTree.trim()).toBe(preTree.trim());
      expect(log).not.toContain("squash!");
      expect(log.trim().split("\n")).toHaveLength(1);
    } finally {
      await cleanupTempDir(repoDir);
    }
  });

  it("keeps unmatched autosquash markers detectable after rebase", async () => {
    const repoDir = await createAutosquashFixture({
      squashSubject: "squash! feat: base",
    });
    const editorCommand = nodeNoopCommand();

    try {
      const { stdout: mergeBase } = await execFileAsync(
        "git",
        ["merge-base", "main", "HEAD"],
        { cwd: repoDir },
      );

      await execFileAsync(
        "git",
        ["rebase", "-i", "--autosquash", mergeBase.trim()],
        {
          cwd: repoDir,
          env: {
            ...process.env,
            GIT_SEQUENCE_EDITOR: editorCommand,
            GIT_EDITOR: editorCommand,
          },
        },
      );

      const { stdout: remainingMarkers } = await execFileAsync(
        "git",
        ["log", "--format=%s", `${mergeBase.trim()}..HEAD`],
        { cwd: repoDir },
      );

      expect(remainingMarkers).toContain("squash! feat: base");
    } finally {
      await cleanupTempDir(repoDir);
    }
  });

  it("keeps the autosquash fixture stable when git init defaults to main", async () => {
    const repoDir = await createAutosquashFixture({
      initDefaultBranch: "main",
    });

    try {
      const { stdout: mergeBase } = await execFileAsync(
        "git",
        ["merge-base", "main", "HEAD"],
        { cwd: repoDir },
      );
      const { stdout: log } = await execFileAsync(
        "git",
        ["log", "--oneline", `${mergeBase.trim()}..HEAD`],
        { cwd: repoDir },
      );

      expect(log.trim().split("\n")).toHaveLength(2);
    } finally {
      await cleanupTempDir(repoDir);
    }
  });

  it("keeps subagent-lifecycle references in direct spawning workflow sources", async () => {
    const issuePrimingWorkflow = await readSkillSource(
      "issue-priming-workflow",
    );
    const playReview = await readSkillSource("play-review");
    const playPlanning = await readSkillSource("play-planning");
    const playAgentDispatch = await readSkillSource("play-agent-dispatch");
    const playSkillAuthoring = await readSkillSource("play-skill-authoring");
    const prMerge = await readSkillSource("pr-merge");

    const issueLifecycleSection = sliceBetween(
      issuePrimingWorkflow,
      "## Subagent Lifecycle",
      "## Phase 2: Complexity Gate",
    );
    expectSharedLifecycleReference(issueLifecycleSection);
    expect(issueLifecycleSection).toContain(
      "Before dispatching the Phase 2 gate agent",
    );
    expect(issueLifecycleSection).toContain("Phase 3 research agent");
    expect(normalizeWhitespace(issueLifecycleSection)).toContain("gate result");
    expect(issueLifecycleSection).toContain("research brief path");

    const issuePhase6Section = sliceBetween(
      issuePrimingWorkflow,
      "### Phase 6: Implement",
      "### Phase 7: Branch Review",
    );
    expect(issuePhase6Section).toContain("subagent-lifecycle");
    expect(issuePhase6Section).toContain(
      "Before the Phase 6 handoff, run the `subagent-lifecycle` cleanup gate",
    );
    expect(issuePhase6Section.indexOf("`subagent-lifecycle`")).toBeLessThan(
      issuePhase6Section.indexOf("Invoke `play-subagent-execution`"),
    );

    const playReviewPhase3Section = sliceBetween(
      playReview,
      "## Phase 3: Spawn agents",
      "**Core agents (always spawned):**",
    );
    expectSharedLifecycleReference(playReviewPhase3Section);
    expect(playReviewPhase3Section).toContain(
      "Before spawning Phase 3 reviewer agents",
    );
    expect(playReviewPhase3Section).toContain("review scope");
    expect(playReviewPhase3Section).toContain("concrete findings");
    expect(playReviewPhase3Section).toContain(
      "Critic verdicts are captured with the critic session in Phase 5",
    );

    const playReviewCriticSection = sliceBetween(
      playReview,
      "## Phase 5: Critic verification",
      "## Hard Rules",
    );
    expect(playReviewCriticSection).toContain("subagent-lifecycle");
    expect(playReviewCriticSection).toContain(
      "Before spawning the critic agent, run the `subagent-lifecycle` cleanup gate",
    );
    expect(playReviewCriticSection).toContain("critic report");
    expect(playReviewCriticSection).toContain("verdicts");

    const playPlanningReviewSection = sliceBetween(
      playPlanning,
      "## Plan Review",
      "## Execution Handoff",
    );
    expectSharedLifecycleReference(playPlanningReviewSection);
    expect(playPlanningReviewSection).toContain(
      "Before dispatching the plan-review agent",
    );
    expect(playPlanningReviewSection).toContain("PASS/FAIL result");
    expect(playPlanningReviewSection).toContain("specific gaps");

    const playAgentDispatchSection = sliceBetween(
      playAgentDispatch,
      "### 3. Dispatch in Parallel",
      "## Agent Prompt Structure",
    );
    const normalizedPlayAgentDispatchSection = normalizeWhitespace(
      playAgentDispatchSection,
    );
    expectSharedLifecycleReference(playAgentDispatchSection);
    expect(playAgentDispatchSection).toContain("Before parallel dispatch");
    expect(playAgentDispatchSection).toContain(
      "one pending ledger row per planned agent",
    );
    expect(normalizedPlayAgentDispatchSection).toContain(
      "Update the `subagent-lifecycle` ledger with each returned session's role-specific state before closing or superseding it",
    );
    expect(normalizedPlayAgentDispatchSection).toContain(
      "After each returned session is integrated, run the `subagent-lifecycle` cleanup gate before keeping or spawning any additional agent sessions",
    );

    const playSkillAuthoringSection = sliceBetween(
      playSkillAuthoring,
      "## Overview",
      "## What is a Skill?",
    );
    const normalizedPlaySkillAuthoringSection = normalizeWhitespace(
      playSkillAuthoringSection,
    );
    expectSharedLifecycleReference(playSkillAuthoringSection);
    expect(normalizedPlaySkillAuthoringSection).toContain(
      "When dispatching pressure-scenario subagents",
    );
    expect(normalizedPlaySkillAuthoringSection).toContain(
      "Capture each pressure-scenario subagent's prompt, baseline/pass result, observed rationalizations, and pressure conditions before closing or superseding the session",
    );

    const prMergeInvestigationSection = sliceBetween(
      prMerge,
      "### 4b. Dispatch investigation agent",
      '### 4c. "In scope" definition',
    );
    expectSharedLifecycleReference(prMergeInvestigationSection);
    expect(prMergeInvestigationSection).toContain(
      "Before dispatching the CI investigation agent",
    );
    expect(prMergeInvestigationSection).toContain("CI run/check identifiers");
    expect(normalizeWhitespace(prMergeInvestigationSection)).toContain(
      "in-scope/out-of-scope classification",
    );
  });

  it("keeps bundled prompt and runtime-reference prose contracts in source", async () => {
    const implementerPrompt = await readRepoFile(
      "skills/play-subagent-execution/references/implementer-prompt.md",
    );
    const mechanicalImplementerPrompt = await readRepoFile(
      "skills/play-subagent-execution/references/mechanical-implementer-prompt.md",
    );
    const specReviewerPrompt = await readRepoFile(
      "skills/play-subagent-execution/references/spec-reviewer-prompt.md",
    );
    const writeProductSpecRouting = await readRepoFile(
      "skills/write-product-spec/references/behavior-spec-evidence-routing.md",
    );
    const researchPrompt = await readRepoFile(
      "skills/issue-priming-workflow/references/research-agent-prompt.md",
    );

    expect(implementerPrompt).toContain(
      "If the task includes a contract checklist",
    );
    expect(normalizeWhitespace(implementerPrompt)).toContain(
      "owner/authority, affected consumers/generated outputs, must-preserve, required behavior",
    );
    expect(normalizeWhitespace(implementerPrompt)).toContain(
      "source-of-truth, consumer, generated-output, or evidence surface that source inspection cannot confirm",
    );
    expect(implementerPrompt).toContain(
      "helper-name prescriptions, line-number edits, or commit recipes",
    );

    expect(mechanicalImplementerPrompt).toContain(
      "helper-name prescriptions, line-number edits, or commit recipes",
    );
    expect(mechanicalImplementerPrompt).toContain(
      "affected consumers/generated outputs, must-preserve, required behavior",
    );
    expect(mechanicalImplementerPrompt).toContain(
      "Read the relevant source files, existing docs, ADRs, helpers, generated",
    );
    expect(normalizeWhitespace(mechanicalImplementerPrompt)).toContain(
      "A blank checklist field, unexplained `N/A`, or unconfirmed owner/authority",
    );
    expect(normalizeWhitespace(mechanicalImplementerPrompt)).toContain(
      "source-of-truth, consumer, generated-output, or evidence surface is not a mechanical replacement target",
    );

    expect(specReviewerPrompt).toContain(
      "**Task contract checklist (when present in the requested task):**",
    );
    expect(specReviewerPrompt).toContain(
      "Verify owner/authority fields against the source files, docs, ADRs",
    );
    expect(specReviewerPrompt).toContain(
      "Verify affected consumers and generated outputs named by the task",
    );
    expect(specReviewerPrompt).toContain(
      "Verify risk surfaces and proof obligations were addressed",
    );

    expect(writeProductSpecRouting).toContain("packaged runtime reference");
    expect(writeProductSpecRouting).toContain("minimum evidence pointer");
    expect(writeProductSpecRouting).toContain(
      "durable team, system, role, or artifact",
    );
    expect(writeProductSpecRouting).not.toContain(
      "docs/guidelines/behavior-spec-evidence-routing.md",
    );
    expect(writeProductSpecRouting).not.toContain(
      "docs/specs/afds-workflow-routing.md",
    );
    expect(writeProductSpecRouting).not.toContain("EVID-001");
    expect(writeProductSpecRouting).not.toContain("source of origin");

    const normalizedResearchPrompt = normalizeWhitespace(researchPrompt);
    expect(researchPrompt).toContain("subagent-lifecycle");
    for (const phrase of [
      "Before dispatching internal research sub-agents",
      "target capability",
      "cleanup gate before spawns",
      "target-honest cleanup outcomes",
      "slot-limit recovery",
      "role-specific state",
      "scope",
      "report",
      "source references",
      "blocker state",
    ]) {
      expect(normalizedResearchPrompt).toContain(phrase);
    }
  });
});
