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
      expect(playPlanning).toContain("## Contract Checklist Triggers");
      expect(playPlanning).toContain("## Execution Handoff");
      expect(playPlanning).toContain("play-subagent-execution");

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
    expect(issuePrimingWorkflow).toContain("Plan:");
    expect(issuePrimingWorkflow).toContain("Auto handoff:");
    expect(issuePrimingWorkflow).toContain("play-subagent-execution");
    expect(issuePrimingWorkflow).toContain("scripts/phase-artifacts.sh");
    expect(issuePrimingWorkflow).toContain("scripts/write-research-brief.sh");
    expect(issuePrimingWorkflow).toContain(
      "scripts/write-assumptions-comment.sh",
    );
  });

  it("renders direct/manual execution handoff to play-branch-finish for both targets", () => {
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
        "implementation and final review passed",
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
        "After the final whole-implementation review passes, the next action is to invoke `play-branch-finish`",
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
