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
      expect(body).toContain("worktree-path");
    }

    const issuePrimingWorkflow = bodyFor("issue-priming-workflow");
    expect(issuePrimingWorkflow).toContain("Issue body:");
    expect(issuePrimingWorkflow).toContain("Research brief:");
    expect(issuePrimingWorkflow).toContain("Design written to");
    expect(issuePrimingWorkflow).toContain("Plan written to");
    expect(issuePrimingWorkflow).toContain("Auto handoff:");
    expect(issuePrimingWorkflow).toContain("play-review/findings/v1");
    expect(issuePrimingWorkflow).toContain("PLAY_REVIEW_HELPER");

    const playBrainstorm = bodyFor("play-brainstorm");
    expect(playBrainstorm).toContain("Issue body:");
    expect(playBrainstorm).toContain("Research brief:");
    expect(playBrainstorm).toContain("Design written to");

    const playPlanning = bodyFor("play-planning");
    expect(playPlanning).toContain("Design:");
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

  it("keeps rendered branch-review and play-review follow-up contract surfaces", () => {
    for (const target of ["claude", "codex"] as const) {
      const branchReview = bodies[`branch-review:${target}`];

      expect(branchReview).toContain("--last-reviewed");
      expect(branchReview).toContain("--prior-findings");
      expect(branchReview).toContain(
        "--last-reviewed and --prior-findings must be supplied together",
      );
      expect(branchReview).toContain(
        "--prior-findings review head must match --last-reviewed",
      );
      expect(branchReview).toContain("candidate_active_diff_range");
      expect(branchReview).toContain("full_pr_diff_range");
      expect(branchReview).toContain("Escalate back to full branch review");
      expect(branchReview).toContain("path-validation guards");
      expect(branchReview).toContain("prior_branch_findings");
      expect(branchReview).toContain("carry_forward[]");
      expect(branchReview).toContain("preserves `carry_forward[]` unchanged");

      const playReview = bodies[`play-review:${target}`];

      expect(playReview).toContain(
        "| `active_diff_range`  | git diff spec                             | Phase 3 agents review this",
      );
      expect(playReview).toContain(
        "| `full_pr_diff_range` | git diff spec                             | Doc-impact summary always uses this",
      );
      expect(playReview).toContain("Always run against\n`full_pr_diff_range`");
      expect(playReview).toContain(
        'git diff --name-only "$FULL_PR_DIFF_RANGE"',
      );
      expect(playReview).toContain("Changed files (active diff)");
      expect(playReview).toContain(
        'git diff --name-status "$ACTIVE_DIFF_RANGE"',
      );
      expect(playReview).toContain(
        'Active diff invocation — instruct the agent to run `git diff "$ACTIVE_DIFF_RANGE"`',
      );
      expect(playReview).toContain("prior_branch_findings");
      expect(playReview).toContain(
        "Branch review context from a validated local `play-review/findings/v1` envelope path",
      );
      expect(playReview).toContain("validate-findings");
      expect(playReview).toContain("Prior review context");
      expect(playReview).toContain("branch-local prior findings");
      expect(playReview).toContain("Carry-forward");
      expect(playReview).toContain("carry_forward");
      expect(playReview).toContain(
        "Diff at `active_diff_range` is empty and `prior_threads` or `prior_branch_findings` exists",
      );
      expect(playReview).toContain("Findings-file consumers fail closed");
    }
  });
});
