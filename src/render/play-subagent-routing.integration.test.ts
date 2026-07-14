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

  beforeAll(async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    const { outputs } = await renderAll(config, false);
    bodies = {};

    for (const skillName of ROUTING_SKILLS) {
      for (const target of ["claude", "codex"] as const) {
        const output = getSkillOutput(outputs, skillName, target);
        const { frontmatter, body } = parseFrontmatter(output.content);

        expect(frontmatter.name).toBe(skillName);
        bodies[`${skillName}:${target}`] = body;
      }
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
      expect(playPlanning).toContain(
        "## Scope Envelope and Canonical Criteria",
      );
      expect(playPlanning).toContain("references/planning-criteria.md");
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
        "Never direct the reviewer to find criteria relative to the target repository",
      );
      expect(normalizedPlayPlanning).toContain(
        "an omitted known mapping is `CURRENT`, while missing authority for that mapping is `BLOCKER`",
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

      const planReviewStart = playPlanning.indexOf("## Plan Review");
      const executabilityReviewStart = playPlanning.indexOf(
        "## Implementer Executability Review",
      );
      const executionHandoffStart = playPlanning.indexOf(
        "## Execution Handoff",
      );
      expect(planReviewStart).toBeGreaterThanOrEqual(0);
      expect(executabilityReviewStart).toBeGreaterThan(planReviewStart);
      expect(executionHandoffStart).toBeGreaterThan(executabilityReviewStart);
      const planReview = normalizeWhitespace(
        playPlanning.slice(planReviewStart, executabilityReviewStart),
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
        expect(reviewSection).not.toContain("`deep-reviewer`");
      }
      expect(planReview).toContain("D5 FAIL never advances to D6");
      expect(executabilityReview).toContain(
        "D5 PASS followed by D6 FAIL never reaches execution handoff",
      );
      expect(executabilityReview).toContain(
        "Only a retained D5 PASS followed by a separate retained D6 PASS",
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
      expect(playSubagentExecution).toContain(
        "references/mechanical-implementer-prompt.md",
      );
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
        "spec-compliance and code-quality reviewers concurrently when practical",
      );
      expect(normalizedPlaySubagentExecution).toContain(
        "Single-task plans skip per-task review and use the final whole-implementation reviewer plus direct/manual branch-level review status resolution",
      );
      expect(normalizedPlaySubagentExecution).not.toContain(
        "rely on the final whole-implementation reviewer for direct/manual calls",
      );
      expect(normalizedPlaySubagentExecution).toContain(
        "A quality result is final only after same-head spec compliance passes",
      );
      expect(normalizedPlaySubagentExecution).toContain(
        "load the detailed references only when the trigger applies",
      );
      expect(normalizedPlaySubagentExecution).toContain(
        "same-head quality results remain pending or advisory",
      );
    }

    const issuePrimingWorkflow = bodies["issue-priming-workflow:codex"];
    const normalizedIssuePrimingWorkflow =
      normalizeWhitespace(issuePrimingWorkflow);
    expect(issuePrimingWorkflow).toContain("Plan:");
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
