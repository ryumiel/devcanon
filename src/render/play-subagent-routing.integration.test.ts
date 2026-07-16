import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  getSkillOutput,
  normalizeWhitespace,
} from "../__test-helpers__/render.js";
import { loadConfig } from "../config/load.js";
import { parseFrontmatter } from "./frontmatter.js";
import { renderAll } from "./pipeline.js";

const ROUTING_SKILLS = [
  "play-planning",
  "play-review-response",
  "play-subagent-execution",
  "issue-priming-workflow",
] as const;

const COPIED_BRANCH_FINISH_CHOICE_PATTERNS = [
  /^\s*1\.\s+Merge back to <base-branch> locally\s*$/m,
  /^\s*2\.\s+Push and create a Pull Request\s*$/m,
  /^\s*3\.\s+Keep the branch as-is \(I'll handle it later\)\s*$/m,
  /^\s*4\.\s+Discard this work\s*$/m,
  /^\s*Which option\?\s*$/m,
] as const;

type RenderedBodies = Record<string, string>;

describe("play-subagent planning and routing render smoke coverage", () => {
  let bodies: RenderedBodies;
  let planningCriteria: RenderedBodies;
  let skipDispatchPolicies: RenderedBodies;
  let sourceSkipDispatchPolicy: string;

  beforeAll(async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    const { outputs } = await renderAll(config, false);
    bodies = {};
    planningCriteria = {};
    skipDispatchPolicies = {};

    for (const skillName of ROUTING_SKILLS) {
      for (const target of ["claude", "codex"] as const) {
        const output = getSkillOutput(outputs, skillName, target);
        const { frontmatter, body } = parseFrontmatter(output.content);

        expect(frontmatter.name).toBe(skillName);
        bodies[`${skillName}:${target}`] = body;
      }
    }

    sourceSkipDispatchPolicy = await readFile(
      path.join(
        repoRoot,
        "skills/play-subagent-execution/references/skip-dispatch-policy.md",
      ),
      "utf8",
    );
    const generatedDir = await mkdtemp(
      path.join(tmpdir(), "devcanon-routing-render-"),
    );
    try {
      await renderAll(
        {
          ...config,
          library: {
            ...config.library,
            generatedDir,
          },
        },
        true,
      );
      for (const target of ["claude", "codex"] as const) {
        planningCriteria[target] = await readFile(
          path.join(
            generatedDir,
            target,
            "skills/play-planning/references/planning-criteria.md",
          ),
          "utf8",
        );
        skipDispatchPolicies[target] = await readFile(
          path.join(
            generatedDir,
            target,
            "skills/play-subagent-execution/references/skip-dispatch-policy.md",
          ),
          "utf8",
        );
      }
    } finally {
      await rm(generatedDir, { recursive: true, force: true });
    }
  });

  it("renders routing skills to both targets without placeholder leaks", () => {
    for (const skillName of ROUTING_SKILLS) {
      for (const target of ["claude", "codex"] as const) {
        const body = bodies[`${skillName}:${target}`];

        expect(body.trim()).not.toHaveLength(0);
        expect(body).not.toContain("{{model:");
      }
    }
  });

  it("keeps rendered planning and execution handoff surfaces available", () => {
    for (const target of ["claude", "codex"] as const) {
      const playPlanning = bodies[`play-planning:${target}`];
      const normalizedPlayPlanning = normalizeWhitespace(playPlanning);
      const normalizedPlanningCriteria = normalizeWhitespace(
        planningCriteria[target],
      );
      expect(playPlanning).toContain(
        "## Scope Envelope and Canonical Criteria",
      );
      expect(playPlanning).toContain("references/planning-criteria.md");
      expect(playPlanning).toContain("references/planning-readiness-audit.md");
      expect(normalizedPlayPlanning).toContain(
        "from the loaded or installed `play-planning` skill bundle, not from the target repository or current working directory",
      );
      expect(normalizedPlayPlanning).toContain(
        "Criteria: <validated-bundle-owned-path>",
      );
      expect(normalizedPlayPlanning).toContain(
        "otherwise pass the preserved inline `## Design` content for a direct invocation",
      );
      expect(normalizedPlayPlanning).toContain(
        "pass the guarded `Design: <path>` when the invocation selected the path form",
      );
      expect(normalizedPlayPlanning).toContain(
        "missing selected inline design content",
      );
      expect(normalizedPlayPlanning).toContain(
        "Absence of the unselected path or inline form does not block",
      );
      expect(normalizedPlayPlanning).toContain(
        "Never direct the reviewer to find criteria or readiness policy relative to the target repository",
      );
      expect(normalizedPlayPlanning).toContain(
        "Ordinary omitted or missing consumer or boundary mapping coverage and mapping-authority findings are D5-owned",
      );
      expect(normalizedPlayPlanning).toContain(
        "D6 may report the shared fact only by naming a concrete task-local startability defect caused in D6's own remit",
      );
      expect(normalizedPlanningCriteria).toContain(
        "Ordinary omitted or missing consumer or boundary mapping coverage and mapping-authority findings are D5-owned",
      );
      expect(normalizedPlanningCriteria).toContain(
        "D6 may report the shared fact only by naming a concrete task-local startability defect caused in D6's own remit",
      );
      expect(normalizedPlayPlanning).toContain(
        "provide bounded authoritative discovery criteria inside already named in-scope consumers or boundaries",
      );
      expect(normalizedPlayPlanning).toContain(
        "do not use discovery to determine which consumers or boundary participants are in scope",
      );
      expect(normalizedPlayPlanning).toContain(
        "Discover affected paths (only when individual paths are not yet known)",
      );
      expect(normalizedPlayPlanning).toContain(
        "authority: <named source>; criterion: <explicit inclusion rule>",
      );
      expect(normalizedPlayPlanning).toContain(
        "Exact affected file paths when known; otherwise bounded authoritative discovery criteria for individual paths inside already named in-scope consumers or boundaries",
      );
      expect(normalizedPlayPlanning).not.toContain("Exact file paths always");
      expect(normalizedPlayPlanning).not.toContain(
        "read `references/planning-criteria.md` from the repository",
      );
      expect(normalizedPlayPlanning).toContain(
        "Planning may make approved scope executable, but it must not create new product, infrastructure, governance, or verification obligations",
      );
      expect(normalizedPlayPlanning).toContain(
        "Every task must map to an authoritative requirement and be necessary for an in-scope outcome",
      );
      expect(normalizedPlayPlanning).toContain(
        "Only verified CURRENT findings may be fixed inline",
      );
      expect(normalizedPlayPlanning).toContain(
        "PASS may coexist with FOLLOW-UP and OPTIONAL findings",
      );
      expect(normalizedPlayPlanning).toContain(
        "prefer the narrowest existing repository mechanism that demonstrates acceptance",
      );
      expect(playPlanning).toContain("## Scope Envelope");
      expect(playPlanning).toContain("## Scope Delta");
      expect(playPlanning).toContain("## Execution Handoff");
      expect(playPlanning).toContain("play-subagent-execution");
      expect(normalizedPlayPlanning).toContain(
        "both independent GUARD-001 captures must succeed before either reviewer starts",
      );
      expect(normalizedPlayPlanning).toContain(
        "start D5 and D6 independently without waiting for either result",
      );
      expect(normalizedPlayPlanning).toContain(
        "every started sibling must settle",
      );
      expect(normalizedPlayPlanning).toContain(
        "maximum of two paired review waves",
      );
      expect(normalizedPlayPlanning).toContain(
        "Wave one is exhaustive in each distinct remit",
      );
      expect(normalizedPlayPlanning).toContain("there is no third wave");
      for (const priorGapRule of [
        "stable gap ID, task ID, defect class, `classification=CURRENT`",
        "`Authority`, `Concrete blocker`, `Inspection insufficiency`, `Smallest correction`",
        "originating reviewer provenance and originating D5 or D6 remit",
        "correction owner, concrete correction evidence",
        "`resolution_state` uses only `OPEN`, `CORRECTED`, `RESOLVED`, or `UNRESOLVED`",
        "`verification_state` uses only `NOT_RUN`, `PENDING`, `PASSED`, or `FAILED`",
        "`OPEN` + `NOT_RUN`",
        "`CORRECTED` + `PENDING`",
        "`RESOLVED` + `PASSED`",
        "`UNRESOLVED` + `FAILED`",
        "No backward transition, skipped state, unknown value, mixed terminal pair, or mutation after `PENDING`",
        "For wave one, `prior_verified_gaps` is explicitly none/inapplicable",
        "`BLOCKER` never enters `prior_verified_gaps`; it returns to its named owner",
        "`FOLLOW-UP` and `OPTIONAL` remain deferred outside `prior_verified_gaps`",
        "A new wave-two `CURRENT` or `BLOCKER` is accepted only under the existing new-evidence rule",
        "After any wave-two non-pass, surface unresolved gaps and stop; there is no third wave",
      ]) {
        expect(normalizedPlayPlanning).toContain(priorGapRule);
      }
      expect(normalizedPlayPlanning).toContain(
        "both reviewers return PASS for the same current exact-byte digest",
      );
      expect(normalizedPlayPlanning).toContain(
        "`Plan written to <repo-relative-path>.` followed by the literal line `Reviewed digest: <sha256>`",
      );
      expect(normalizedPlayPlanning).toContain(
        "Carry the plan path and exact reviewed digest in controller-local state",
      );
      expect(normalizedPlayPlanning).toContain(
        "Preserve both values through any interactive execution choice",
      );
      expect(normalizedPlayPlanning).toContain(
        "Each reviewer must independently compute SHA-256 over the exact plan bytes it reads and compare that digest to the supplied expected digest before returning",
      );
      expect(normalizedPlayPlanning).toContain(
        "recompute SHA-256 over the current exact plan bytes at the join",
      );
      expect(normalizedPlayPlanning).toContain(
        "Immediately before execution or owning-workflow handoff, recompute SHA-256 over the current exact plan bytes again",
      );
      expect(normalizedPlayPlanning).toContain(
        "Before each authorized revision, retain a controller-local semantic-task-to-Task-ID baseline from the current plan",
      );
      expect(normalizedPlayPlanning).toContain(
        "After saving the revised plan and before fresh reviewer dispatch, compare it with that baseline",
      );
      expect(normalizedPlayPlanning).toContain(
        "Continuing semantic tasks must preserve their Task IDs",
      );
      expect(normalizedPlayPlanning).toContain(
        "Reject changed or missing IDs for continuing tasks and any duplicate, reused, or reassigned ID across distinct semantic tasks",
      );
      expect(normalizedPlayPlanning).toContain(
        "A genuinely new semantic task may receive a new unique Task ID that does not appear in the retained baseline",
      );
      expect(normalizedPlayPlanning).toContain(
        "Keep this comparison in controller memory; do not create a baseline artifact or persistent ID mechanism",
      );
      const interactiveExecution = playPlanning.slice(
        playPlanning.indexOf("Otherwise, offer execution choice:"),
      );
      const normalizedInteractiveExecution =
        normalizeWhitespace(interactiveExecution);
      expect(normalizedInteractiveExecution).toContain(
        "Immediately before invoking `play-subagent-execution`, compute SHA-256 over the exact saved plan bytes",
      );
      expect(normalizedInteractiveExecution).toContain(
        "compare it with the preserved reviewed digest",
      );
      expect(normalizedInteractiveExecution).toContain(
        "mismatch invalidates the handoff and routes the changed plan through a fresh planning wave",
      );
      expect(interactiveExecution).toContain(
        "Plan: <path>\n  Expected digest: <sha256>",
      );
      expect(normalizedPlayPlanning).toContain(
        "reload and read both validated bundle-owned references",
      );
      expect(normalizedPlayPlanning).toContain(
        "invalidates readiness and returns `NOT_READY`",
      );
      expect(normalizedPlayPlanning).toContain(
        "emit or reuse stable missing-decision records with the named owner surface and stop before drafting",
      );
      expect(normalizedPlayPlanning).toContain(
        "canonical planning criteria own the detailed topology and task-mapping rules",
      );
      expect(normalizedPlayPlanning).toContain(
        "readiness reference exclusively owns audit and readiness rules",
      );

      const pairedReviewStart = playPlanning.indexOf(
        "## Exact Digest and Paired Review Orchestration",
      );
      const planReviewStart = playPlanning.indexOf("## Plan Review");
      const executabilityReviewStart = playPlanning.indexOf(
        "## Implementer Executability Review",
      );
      const executionHandoffStart = playPlanning.indexOf(
        "## Execution Handoff",
      );
      expect(pairedReviewStart).toBeGreaterThanOrEqual(0);
      expect(planReviewStart).toBeGreaterThan(pairedReviewStart);
      expect(executabilityReviewStart).toBeGreaterThan(planReviewStart);
      expect(executionHandoffStart).toBeGreaterThan(executabilityReviewStart);
      const planReview = normalizeWhitespace(
        playPlanning.slice(planReviewStart, executabilityReviewStart),
      );
      const pairedReview = normalizeWhitespace(
        playPlanning.slice(pairedReviewStart, planReviewStart),
      );
      expect(pairedReview).toContain(
        "pipe either result through `awk '{print $1}'` to extract the first whitespace-delimited field",
      );
      expect(pairedReview).toContain(
        "Validate that extracted field -- not the raw command output -- as lowercase 64-hex",
      );
      const executabilityReview = normalizeWhitespace(
        playPlanning.slice(executabilityReviewStart, executionHandoffStart),
      );
      for (const reviewSection of [planReview, executabilityReview]) {
        expect(reviewSection).toContain(
          "response-only `reviewer`, frontier/high and source-immutable, with zero handoffs",
        );
        expect(reviewSection).toContain("scripts/source-immutability.sh");
        expect(reviewSection).toContain("capture before spawn");
        expect(reviewSection).toContain(
          "verify before semantic validation or consumption",
        );
        expect(reviewSection).toContain(
          "apply the retained PASS/FAIL result only after cleanup",
        );
        expect(reviewSection).toContain(
          "unavailable, failed, malformed, or verification-rejected review cannot pass",
        );
        expect(reviewSection).toContain("guard-integrity terminal");
        expect(reviewSection).toContain("retain the terminal condition");
        expect(reviewSection).toContain("leave the source state visible");
        expect(reviewSection).toContain(
          "wait for every already-started sibling to settle and attempt its exact owned cleanup",
        );
        const terminalOrder = [
          "retain the terminal condition",
          "leave the source state visible",
          "wait for every already-started sibling to settle and attempt its exact owned cleanup",
          "then stop planning",
        ];
        for (let index = 1; index < terminalOrder.length; index += 1) {
          expect(reviewSection.indexOf(terminalOrder[index - 1])).toBeLessThan(
            reviewSection.indexOf(terminalOrder[index]),
          );
        }
        expect(reviewSection).not.toContain("`deep-reviewer`");
        expect(reviewSection).toContain(
          "read the concrete readiness reference and validate the recorded readiness result",
        );
        expect(reviewSection).toContain(
          "Missing or unreadable readiness input blocks",
        );
        expect(reviewSection).toContain(
          "Pass `Comment evidence: <path>` only when the planning invocation received it",
        );
      }
      expect(planReview).toContain("optional comment-evidence path");
      expect(pairedReview).toContain(
        "both independent GUARD-001 captures must succeed before either reviewer starts",
      );
      expect(pairedReview).toContain(
        "start D5 and D6 independently without waiting for either result",
      );
      expect(pairedReview).toContain("every started sibling must settle");
      expect(pairedReview).toContain("Do not route early");
      expect(pairedReview).toContain("maximum of two paired review waves");
      const pairedAndLeafReviewSurface = [
        pairedReview,
        planReview,
        executabilityReview,
      ].join(" ");
      for (const sequentialContradiction of [
        /complet(?:e|es|ed|ing) D5 before start(?:ing)? D6/iu,
        /D5 PASS.{0,40}(?:advance|start).{0,20}D6/iu,
        /D5 FAIL.{0,40}(?:prevent|cancel|block).{0,20}D6.{0,10}start/iu,
      ]) {
        expect(pairedAndLeafReviewSurface).not.toMatch(sequentialContradiction);
      }
      const pairedReviewOrder = [
        "every started sibling must settle",
        "After both reviewers settle and clean",
        "recompute SHA-256 over the current exact plan bytes at the join",
        "Immediately before execution or owning-workflow handoff",
        "recompute SHA-256 over the current exact plan bytes again",
        "before applying dual PASS",
      ];
      for (let index = 1; index < pairedReviewOrder.length; index += 1) {
        expect(pairedReview.indexOf(pairedReviewOrder[index - 1])).toBeLessThan(
          pairedReview.indexOf(pairedReviewOrder[index]),
        );
      }
      for (const [reviewSection, spawnStep] of [
        [planReview, "spawn the D5 reviewer and capture only"],
        [executabilityReview, "spawn the fresh D6 reviewer and capture only"],
      ]) {
        const orderedSteps = [
          "capture before spawn",
          spawnStep,
          "verify before semantic validation or consumption",
          "validate and retain the PASS/FAIL response in controller memory",
          "cleanup the exact retained baseline",
          "apply the retained PASS/FAIL result only after cleanup",
        ];
        for (let index = 1; index < orderedSteps.length; index += 1) {
          expect(reviewSection.indexOf(orderedSteps[index - 1])).toBeLessThan(
            reviewSection.indexOf(orderedSteps[index]),
          );
        }
        expect(reviewSection).toContain(
          "every post-capture terminal path attempts exact cleanup",
        );
        expect(reviewSection).toContain(
          "dispatch or spawn failure or unavailability before a reviewer session exists",
        );
        expect(reviewSection).toContain("After safe cleanup");
      }
      expect(executabilityReview).toContain(
        "must not reuse or collapse the D5 session, review question, PASS/FAIL result, or lifecycle state",
      );

      const playSubagentExecution = bodies[`play-subagent-execution:${target}`];
      const normalizedPlaySubagentExecution = normalizeWhitespace(
        playSubagentExecution,
      );
      expect(playSubagentExecution).toContain("### Auto handoff reference");
      expect(playSubagentExecution).toContain("## Branch Policy Reference Map");
      expect(playSubagentExecution).toContain("## Single-Task Plans");
      expect(playSubagentExecution).toContain(
        "references/review-routing-policy.md",
      );
      expect(playSubagentExecution).toContain(
        "references/skip-dispatch-policy.md",
      );
      expect(playSubagentExecution).toContain(
        "references/lifecycle-status-policy.md",
      );
      expect(playSubagentExecution).toContain(
        "references/snapshot-consumption.md",
      );
      expect(playSubagentExecution).toContain("references/process-diagrams.md");
      expect(playSubagentExecution).toContain(
        "references/implementer-prompt.md",
      );
      expect(playSubagentExecution).toContain("references/executor-prompt.md");
      expect(playSubagentExecution).toContain(
        "references/spec-reviewer-prompt.md",
      );
      expect(playSubagentExecution).toContain(
        "references/code-quality-reviewer-prompt.md",
      );
      expect(playSubagentExecution).toContain(
        "references/snapshot-manifest-recipe.md",
      );
      expect(playSubagentExecution).toContain(
        "scripts/write-snapshot-manifest.sh",
      );
      expect(playSubagentExecution).toContain("issue-priming/auto-handoff/v1");
      expect(normalizedPlaySubagentExecution).toContain(
        "D14 and D15 may run concurrently when practical against the same committed task head",
      );
      expect(normalizedPlaySubagentExecution).toContain(
        "D12 uses the source-mutable `implementer`, balanced/high, for judgment-bearing scoped implementation",
      );
      expect(normalizedPlaySubagentExecution).toContain(
        "D13 uses guarded inline execution or the source-mutable `executor`, efficient/medium, only when all five exact guardrails pass",
      );
      expect(normalizedPlaySubagentExecution).toContain(
        "D14 is a separate response-only `deep-reviewer`, frontier/xhigh and source-immutable, with zero handoffs",
      );
      expect(normalizedPlaySubagentExecution).toContain(
        "D15 is a separate response-only `deep-reviewer`, frontier/xhigh and source-immutable, with zero handoffs",
      );
      expect(normalizedPlaySubagentExecution).toContain(
        "D16 is a fresh response-only `deep-reviewer`, frontier/xhigh and source-immutable, with zero handoffs",
      );
      expect(normalizedPlaySubagentExecution).toContain(
        "scripts/source-immutability.sh",
      );
      expect(normalizedPlaySubagentExecution).toContain(
        "references/lifecycle-status-policy.md",
      );
      expect(normalizedPlaySubagentExecution).toContain(
        "Returned D12/D13 status interpretation and all post-selection D14-D16 state transitions are owned by the lifecycle/status policy; this index does not restate them",
      );
      expect(normalizedPlaySubagentExecution).toContain(
        "review routing - `references/review-routing-policy.md` | Computing initial effective per-task routes, validating reduced-route auto-handoff, or checking hard-risk triggers",
      );
      expect(normalizedPlaySubagentExecution).toContain(
        "lifecycle/status handling - `references/lifecycle-status-policy.md` | Updating lifecycle ledger state, interpreting returned worker statuses, resolving same-head reviewer disposition, handling fixups/blockers, guard failures, or cleanup timing",
      );
      expect(normalizedPlaySubagentExecution).not.toContain(
        "review-routing-policy.md` | Computing effective per-task routes, validating reduced-route auto-handoff, checking hard-risk triggers, or resolving same-head reviewer disposition",
      );
      expect(normalizedPlaySubagentExecution).not.toContain(
        "references/mechanical-implementer-prompt.md",
      );
      expect(normalizedPlaySubagentExecution).toContain(
        "Single-task plans skip per-task review and use the final whole-implementation reviewer plus direct/manual branch-level review status resolution",
      );
      expect(normalizedPlaySubagentExecution).not.toContain(
        "rely on the final whole-implementation reviewer for direct/manual calls",
      );
      expect(normalizedPlaySubagentExecution).toContain(
        "load the detailed references only when the trigger applies",
      );
      expect(playSubagentExecution).toContain(
        "Plan: <repo-relative-path>\nExpected digest: <sha256>",
      );
      expect(normalizedPlaySubagentExecution).toContain(
        "before reading, extracting, routing, or dispatching any task",
      );
      expect(normalizedPlaySubagentExecution).toContain(
        "never replace the expected digest with the current file digest",
      );
      expect(normalizedPlaySubagentExecution).toContain(
        "Both `LIGHTWEIGHT` and `NO-TRIGGER` are trusted only when this controller can identify the upstream two-gate `play-planning` return",
      );
      expect(normalizedPlaySubagentExecution).toContain(
        "otherwise unreviewed plans without that upstream two-gate return must use a structurally complete `FULL` contract",
      );

      const renderedSkipDispatchPolicy = skipDispatchPolicies[target];
      expect(renderedSkipDispatchPolicy).toBe(sourceSkipDispatchPolicy);
      const normalizedSkipDispatchPolicy = normalizeWhitespace(
        renderedSkipDispatchPolicy,
      );
      for (const skipDispatchRule of [
        "Guardrail #4 failure blocks before source mutation",
        "The task declares `FULL`, `LIGHTWEIGHT`, or `NO-TRIGGER` and satisfies that tier's structure",
        "Both `LIGHTWEIGHT` and `NO-TRIGGER` require the upstream two-gate `play-planning` return; without it, the task must use a structurally complete `FULL` contract",
        "present obligations are additive after `FULL`, `LIGHTWEIGHT`, or `NO-TRIGGER` satisfaction and do not satisfy guardrail #4 by themselves",
        "If guardrail #4 fails, stop before implementation and report the contract gap",
        "absent reduced-tier provenance, unexplained `N/A`, or unconfirmed owner, authority, source-of-truth, consumer, generated-output, or evidence surface",
        "Other guardrail misses reclassify to D12 and use `implementer-prompt.md`",
      ]) {
        expect(normalizedSkipDispatchPolicy).toContain(skipDispatchRule);
      }

      const playReviewResponse = bodies[`play-review-response:${target}`];
      const normalizedPlayReviewResponse =
        normalizeWhitespace(playReviewResponse);
      expect(normalizedPlayReviewResponse).toContain(
        "`Plan written to <path>.` and `Reviewed digest: <sha256>`",
      );
      expect(normalizedPlayReviewResponse).toContain(
        "compute SHA-256 over the exact saved plan bytes",
      );
      expect(normalizedPlayReviewResponse).toContain(
        "`Plan: <path>` and `Expected digest: <sha256>`",
      );
    }

    const issuePrimingWorkflow = bodies["issue-priming-workflow:codex"];
    const normalizedIssuePrimingWorkflow =
      normalizeWhitespace(issuePrimingWorkflow);
    expect(issuePrimingWorkflow).toContain("Plan:");
    expect(issuePrimingWorkflow).toContain("Expected digest:");
    expect(issuePrimingWorkflow).toContain("Auto handoff:");
    expect(issuePrimingWorkflow).toContain("play-subagent-execution");
    expect(issuePrimingWorkflow).toContain("scripts/phase-artifacts.sh");
    expect(issuePrimingWorkflow).toContain("scripts/write-research-brief.sh");
    expect(issuePrimingWorkflow).toContain(
      "scripts/write-assumptions-comment.sh",
    );
    expect(normalizedIssuePrimingWorkflow).toContain(
      "Phase 7 owns branch review before Phase 8",
    );
    expect(normalizedIssuePrimingWorkflow).toContain(
      "Phase 8 must not rely on `play-branch-finish` to run, validate, classify, or complete branch review",
    );
    expect(normalizedIssuePrimingWorkflow).toContain(
      "Pass judgment-required Phase 7 feedback only through `nits_file`",
    );
    expect(normalizedIssuePrimingWorkflow).toContain(
      "compute SHA-256 over the exact saved plan bytes",
    );
    expect(normalizedIssuePrimingWorkflow).toContain(
      "do not update the expected digest to match changed bytes",
    );
  });

  it("renders direct/manual execution handoff with branch-review status resolution for both targets", () => {
    for (const target of ["claude", "codex"] as const) {
      const playSubagentExecution = bodies[`play-subagent-execution:${target}`];
      const startMarker = "### Direct/manual terminal handoff";
      const endMarker = "## Subagent Lifecycle";
      const startIndex = playSubagentExecution.indexOf(startMarker);
      const endIndex = playSubagentExecution.indexOf(endMarker, startIndex);

      expect(
        startIndex,
        `${target} output missing direct/manual terminal handoff section`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        endIndex,
        `${target} output missing Subagent Lifecycle section after handoff`,
      ).toBeGreaterThan(startIndex);

      const handoffSection = playSubagentExecution.slice(startIndex, endIndex);
      const normalizedHandoff = normalizeWhitespace(handoffSection);

      expect(normalizedHandoff).toContain("direct or manual invocation");
      expect(normalizedHandoff).toContain(
        "final whole-implementation review passes",
      );
      expect(normalizedHandoff).toContain(
        "report implementation status and final review status before any branch-review or finish handoff",
      );
      expect(normalizedHandoff).toContain("invoke `play-branch-finish`");
      expect(normalizedHandoff).toContain(
        "`play-branch-finish` presents its authoritative finish options",
      );
      expect(normalizedHandoff).toContain(
        "implementation summaries, verification summaries, and review pass reports are status reports only",
      );
      expect(normalizedHandoff).toContain(
        "they are not terminal workflow states",
      );
      expect(normalizedHandoff).toContain(
        "After the final whole-implementation review passes, the next action is to resolve the branch-level review status above and then either hand off for required branch review, wait until that review status is resolved, or invoke `play-branch-finish` when branch review is not required",
      );
      expect(normalizedHandoff).toContain(
        "Use `branch-review --fix` as the branch-level gate before finish only when the owning workflow already grants auto-fix authority or the operator explicitly confirms that branch-review may auto-commit fixes",
      );
      expect(normalizedHandoff).toContain(
        "Do not invoke `play-branch-finish` until `branch-review` returns review approval evidence or the active workflow explicitly waives branch-level review",
      );
      expect(normalizedHandoff).toContain(
        "run `branch-review` before `play-branch-finish` when the active workflow requires branch-level review before PR creation",
      );
      expect(normalizedHandoff).toContain(
        "summary-only completion is a workflow violation",
      );

      for (const copiedFinishChoicePattern of COPIED_BRANCH_FINISH_CHOICE_PATTERNS) {
        expect(handoffSection).not.toMatch(copiedFinishChoicePattern);
      }
    }
  });
});
