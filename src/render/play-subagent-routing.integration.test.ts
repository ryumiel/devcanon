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
      expect(playSubagentExecution).toContain(
        "## Risk-Based Per-Task Review Routing",
      );
      expect(playSubagentExecution).toContain("## Single-Task Plans");
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
        "dispatch the spec-compliance reviewer and code-quality reviewer concurrently against the same captured task head",
      );
      expect(normalizedPlaySubagentExecution).toContain(
        "quality result may become final only after same-head spec pass",
      );
      expect(normalizedPlaySubagentExecution).toContain(
        "Unclear stale-result classification fails closed to rerunning code quality",
      );
      expect(normalizedPlaySubagentExecution).toContain(
        "advisory, stale, and superseded quality results",
      );
    }

    const issuePrimingWorkflow = bodies["issue-priming-workflow:codex"];
    expect(issuePrimingWorkflow).toContain("Plan:");
    expect(issuePrimingWorkflow).toContain("Auto handoff:");
    expect(issuePrimingWorkflow).toContain("play-subagent-execution");
  });
});
