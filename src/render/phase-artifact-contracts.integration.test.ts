import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { getSkillOutput } from "../__test-helpers__/render.js";
import { loadConfig } from "../config/load.js";
import { parseFrontmatter } from "./frontmatter.js";
import { renderAll } from "./pipeline.js";

const PHASE_ARTIFACT_SKILLS = [
  "github-issue-priming",
  "linear-issue-priming",
  "issue-priming-workflow",
  "play-brainstorm",
  "play-planning",
  "play-review",
  "branch-review",
  "pr-review",
  "play-branch-finish",
  "play-subagent-execution",
] as const;

type RenderedBodies = Record<string, string>;

describe("rendered phase artifact smoke coverage", () => {
  let bodies: RenderedBodies;

  beforeAll(async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    const { outputs } = await renderAll(config, false);
    bodies = {};

    for (const skillName of PHASE_ARTIFACT_SKILLS) {
      for (const target of ["claude", "codex"] as const) {
        const output = getSkillOutput(outputs, skillName, target);
        const { frontmatter, body } = parseFrontmatter(output.content);

        expect(frontmatter.name).toBe(skillName);
        bodies[`${skillName}:${target}`] = body;
      }
    }
  });

  it("renders phase artifact skills to both targets without placeholder leaks", () => {
    for (const skillName of PHASE_ARTIFACT_SKILLS) {
      for (const target of ["claude", "codex"] as const) {
        const body = bodies[`${skillName}:${target}`];

        expect(body.trim()).not.toHaveLength(0);
        expect(body).not.toContain("{{model:");
      }
    }
  });

  it("keeps rendered phase artifact handoff and helper reference surfaces", () => {
    const bodyFor = (skillName: string) => bodies[`${skillName}:codex`];

    for (const skillName of ["github-issue-priming", "linear-issue-priming"]) {
      const body = bodyFor(skillName);
      expect(body).toContain("issue-body-path");
      expect(body).toContain("comment-evidence-path");
      expect(body).toContain("worktree-path");
    }

    const issuePrimingWorkflow = bodyFor("issue-priming-workflow");
    expect(issuePrimingWorkflow).toContain("Issue body:");
    expect(issuePrimingWorkflow).toContain("Comment evidence:");
    expect(issuePrimingWorkflow).toContain("comment-evidence-path");
    expect(issuePrimingWorkflow).toContain("Research brief:");
    expect(issuePrimingWorkflow).toContain("Design written to");
    expect(issuePrimingWorkflow).toContain("Plan written to");
    expect(issuePrimingWorkflow).toContain("Auto handoff:");
    expect(issuePrimingWorkflow).toContain("play-review/findings/v1");
    expect(issuePrimingWorkflow).toContain("PLAY_REVIEW_HELPER");

    const playBrainstorm = bodyFor("play-brainstorm");
    expect(playBrainstorm).toContain("Issue body:");
    expect(playBrainstorm).toContain("Comment evidence:");
    expect(playBrainstorm).toContain("Research brief:");
    expect(playBrainstorm).toContain("Design written to");

    const playPlanning = bodyFor("play-planning");
    expect(playPlanning).toContain("Design:");
    expect(playPlanning).toContain("Comment evidence:");
    expect(playPlanning).toContain("Plan written to");

    const playReview = bodyFor("play-review");
    expect(playReview).toContain("play-review/findings/v1");
    expect(playReview).toContain("Findings written to");
    expect(playReview).toContain("PLAY_REVIEW_HELPER");

    for (const skillName of ["branch-review", "pr-review"]) {
      const body = bodyFor(skillName);
      expect(body).toContain("play-review/findings/v1");
      expect(body).toContain("Findings written to");
      expect(body).toContain("PLAY_REVIEW_HELPER");
    }

    const playBranchFinish = bodyFor("play-branch-finish");
    expect(playBranchFinish).toContain("play-review/findings/v1");
    expect(playBranchFinish).toContain("nits_file");
    expect(playBranchFinish).toContain("PLAY_REVIEW_HELPER");

    const playSubagentExecution = bodyFor("play-subagent-execution");
    expect(playSubagentExecution).toContain(
      "references/snapshot-manifest-recipe.md",
    );
    expect(playSubagentExecution).toContain(
      "scripts/write-snapshot-manifest.sh",
    );
  });
});
