import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expectOrdered, getSkillOutput } from "../__test-helpers__/render.js";
import { loadConfig } from "../config/load.js";
import { parseFrontmatter } from "./frontmatter.js";
import { renderAll } from "./pipeline.js";

describe("rendered phase artifact contracts", () => {
  it("documents the issue-body path handoff contract in rendered skills and prompt references", async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    const { outputs } = await renderAll(config, false);

    const githubPriming = parseFrontmatter(
      getSkillOutput(outputs, "github-issue-priming", "codex").content,
    ).body;
    expect(githubPriming).toContain("issue-body-path");
    expect(githubPriming).toContain("worktree-path");
    expect(githubPriming).toContain("worktree path must be absolute");
    expect(githubPriming).toContain(
      '[ -L "$WORKTREE_PATH/.ephemeral" ] && rm "$WORKTREE_PATH/.ephemeral"',
    );
    expect(githubPriming).toContain('mkdir -p "$WORKTREE_PATH/.ephemeral"');
    expect(githubPriming).toContain(
      "nested issue body path rejected: $ISSUE_BODY_PATH",
    );
    expect(githubPriming).toContain(
      "issue body path exists but is not a regular file: $WORKTREE_PATH/$ISSUE_BODY_PATH",
    );

    const linearPriming = parseFrontmatter(
      getSkillOutput(outputs, "linear-issue-priming", "codex").content,
    ).body;
    expect(linearPriming).toContain("issue-body-path");
    expect(linearPriming).toContain("worktree-path");
    expect(linearPriming).toContain("worktree path must be absolute");
    expect(linearPriming).toContain(
      '[ -L "$WORKTREE_PATH/.ephemeral" ] && rm "$WORKTREE_PATH/.ephemeral"',
    );
    expect(linearPriming).toContain('mkdir -p "$WORKTREE_PATH/.ephemeral"');
    expect(linearPriming).toContain(
      "nested issue body path rejected: $ISSUE_BODY_PATH",
    );
    expect(linearPriming).toContain(
      "issue body path exists but is not a regular file: $WORKTREE_PATH/$ISSUE_BODY_PATH",
    );

    const workflowBody = parseFrontmatter(
      getSkillOutput(outputs, "issue-priming-workflow", "codex").content,
    ).body;
    expect(workflowBody).toContain("Issue body:");
    expect(workflowBody).toContain("issue-body-path");
    expect(workflowBody).toContain("worktree-path");
    expect(workflowBody).toContain('cd "$WORKTREE_PATH" ||');
    expect(workflowBody).toContain(
      "nested issue body path rejected: $ISSUE_BODY_PATH",
    );
    expect(workflowBody).toContain(
      "issue body must not be a symlink: $ISSUE_BODY_PATH",
    );
    expect(workflowBody).toContain(
      "issue body missing or not a regular file: $ISSUE_BODY_PATH",
    );
    expect(workflowBody).toContain(
      "nested research brief path rejected: $RESEARCH_BRIEF_PATH",
    );
    expect(workflowBody).toContain("nested design path rejected: $DESIGN_PATH");
    expect(workflowBody).toContain(
      "design must not be a symlink: $DESIGN_PATH",
    );
    expect(workflowBody).toContain(
      "design missing or not a regular file: $DESIGN_PATH",
    );
    expect(workflowBody).toContain("nested plan path rejected: $PLAN_PATH");
    expect(workflowBody).toContain("plan must not be a symlink: $PLAN_PATH");
    expect(workflowBody).toContain(
      "plan missing or not a regular file: $PLAN_PATH",
    );
    expect(workflowBody).toContain(`\
[ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink" >&2; exit 1; }
   mkdir -p .ephemeral
   [ -L "$RESEARCH_BRIEF_PATH" ] && rm "$RESEARCH_BRIEF_PATH"`);
    expect(workflowBody).toContain(
      "research brief path exists but is not a regular file: $RESEARCH_BRIEF_PATH",
    );
    expect(workflowBody).toContain("installed `play-review` skill");
    expect(workflowBody).toContain(
      'PLAY_REVIEW_DIR="<installed-play-review-skill-bundle>"',
    );
    expect(workflowBody).toContain("PLAY_REVIEW_HELPER");
    expect(workflowBody).toContain("derive-nits-pending");
    expect(workflowBody).toContain(
      "assumptions comment path exists but is not a regular file: $ASSUMPTIONS_COMMENT_FILE",
    );

    const brainstormBody = parseFrontmatter(
      getSkillOutput(outputs, "play-brainstorm", "codex").content,
    ).body;
    expect(brainstormBody).toContain("Issue body:");
    expect(brainstormBody).toContain("-issue-body.md");
    expect(brainstormBody).toContain(
      "nested issue body path rejected: $ISSUE_BODY_PATH",
    );
    expect(brainstormBody).toContain(
      "issue body must not be a symlink: $ISSUE_BODY_PATH",
    );
    expect(brainstormBody).toContain(
      "nested research brief path rejected: $RESEARCH_BRIEF_PATH",
    );
    expect(brainstormBody).toContain(
      "research brief must not be a symlink: $RESEARCH_BRIEF_PATH",
    );
    expect(brainstormBody).toContain(`\
DESIGN_PATH=".ephemeral/$(date +%F)-<topic>-design.md"
  [ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink" >&2; exit 1; }
  mkdir -p .ephemeral
  [ -L "$DESIGN_PATH" ] && rm "$DESIGN_PATH"`);
    expect(brainstormBody).toContain(
      "design path exists but is not a regular file: $DESIGN_PATH",
    );

    const playPlanningBody = parseFrontmatter(
      getSkillOutput(outputs, "play-planning", "codex").content,
    ).body;
    expect(playPlanningBody).toContain(
      "nested design path rejected: $DESIGN_PATH",
    );
    expect(playPlanningBody).toContain(
      "design must not be a symlink: $DESIGN_PATH",
    );
    expect(playPlanningBody).toContain(`\
PLAN_PATH=".ephemeral/$(date +%F)-<feature-name>-plan.md"
[ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink" >&2; exit 1; }
mkdir -p .ephemeral
[ -L "$PLAN_PATH" ] && rm "$PLAN_PATH"`);
    expect(playPlanningBody).toContain(
      "plan path exists but is not a regular file: $PLAN_PATH",
    );

    const playReviewBody = parseFrontmatter(
      getSkillOutput(outputs, "play-review", "codex").content,
    ).body;
    expect(playReviewBody).toContain("installed `play-review` skill");
    expect(playReviewBody).toContain(
      'PLAY_REVIEW_DIR="<installed-play-review-skill-bundle>"',
    );
    expect(playReviewBody).toContain("PLAY_REVIEW_HELPER");
    expect(playReviewBody).toContain("prepare-findings-write");
    expect(playReviewBody).toContain("validate-findings");
    const prepareFindingsSnippet = `\
PLAY_REVIEW_DIR="<installed-play-review-skill-bundle>"
PLAY_REVIEW_HELPER="$PLAY_REVIEW_DIR/scripts/review-artifacts.sh"
cd "$WORKING_DIRECTORY"
FINDINGS_FILE=$(
  HEAD_SHA="$HEAD_SHA" \\
    bash "$PLAY_REVIEW_HELPER" prepare-findings-write
)`;
    const validateFindingsSnippet = `\
PLAY_REVIEW_DIR="<installed-play-review-skill-bundle>"
PLAY_REVIEW_HELPER="$PLAY_REVIEW_DIR/scripts/review-artifacts.sh"
HEAD_SHA="$REVIEW_HEAD_SHA" \\
FINDINGS_FILE="$REVIEW_FINDINGS_FILE" \\
  bash "$PLAY_REVIEW_HELPER" validate-findings`;
    expect(playReviewBody).toContain(prepareFindingsSnippet);
    expect(playReviewBody).toContain(validateFindingsSnippet);
    expect(playReviewBody.indexOf(prepareFindingsSnippet)).toBeLessThan(
      playReviewBody.indexOf("The helper enforces repository-root execution"),
    );
    expect(playReviewBody.indexOf(validateFindingsSnippet)).toBeLessThan(
      playReviewBody.indexOf(
        "Findings-file consumers fail closed before opening",
      ),
    );
    expect(playReviewBody).toContain("play-review/findings/v1");
    expect(playReviewBody).toContain(
      ".ephemeral/<branch_slug>-<head_sha>-findings.json",
    );
    expect(playReviewBody).not.toContain(
      ".ephemeral/*-findings.json|.ephemeral/*-nits-pending.json",
    );
    expect(playReviewBody).not.toContain("EXPECTED_FINDINGS_FILE=");
    expect(playReviewBody).not.toContain("BRANCH_SLUG=$(printf");
    expect(playReviewBody).toContain(`\
: "\${HEAD_SHA:?trusted head_sha input required}"  # validated per § Output's SHA-format check
  : "\${FINDINGS_FILE:?findings file required}"
  case "$FINDINGS_FILE" in
    .ephemeral/*/*) echo "nested findings path rejected: $FINDINGS_FILE" >&2; exit 1 ;;
    .ephemeral/*-findings.json) ;;
    *) echo "findings path validation failed: $FINDINGS_FILE" >&2; exit 1 ;;
  esac
  [ "\${FINDINGS_FILE#*..}" = "$FINDINGS_FILE" ] || { echo "path traversal: $FINDINGS_FILE" >&2; exit 1; }
  CONTEXT_FILE="\${FINDINGS_FILE%-findings.json}-review-context.md"
  [ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink" >&2; exit 1; }
  mkdir -p .ephemeral
  [ -L "$CONTEXT_FILE" ] && rm "$CONTEXT_FILE"`);
    expect(playReviewBody).toContain(
      "review context path exists but is not a regular file: $CONTEXT_FILE",
    );
    expect(playReviewBody).toContain(
      ': "${HEAD_SHA:?trusted head_sha input required}"',
    );
    expect(playReviewBody).toContain("`Review head: <40-hex-sha>.` notice");

    const playBranchFinishBody = parseFrontmatter(
      getSkillOutput(outputs, "play-branch-finish", "codex").content,
    ).body;
    expect(playBranchFinishBody).toContain("installed `play-review` skill");
    expect(playBranchFinishBody).toContain(
      'PLAY_REVIEW_DIR="<installed-play-review-skill-bundle>"',
    );
    expect(playBranchFinishBody).toContain("PLAY_REVIEW_HELPER");
    expect(playBranchFinishBody).toContain("validate-nits-file");
    expect(playBranchFinishBody).toContain(
      "path MUST be a direct child of `.ephemeral/`",
    );
    expect(playBranchFinishBody).toContain("play-review/findings/v1");
    expect(playBranchFinishBody).toContain(
      "build each API comment from an allowlist",
    );
    expect(playBranchFinishBody).toContain(
      'map({path, line, start_line, body, side: "RIGHT"}',
    );
    expect(playBranchFinishBody).toContain("invalid nits payload fields");

    const branchReviewBody = parseFrontmatter(
      getSkillOutput(outputs, "branch-review", "codex").content,
    ).body;
    expect(branchReviewBody).toContain(
      'REVIEW_HEAD_SHA="$(git rev-parse HEAD)"',
    );
    expect(branchReviewBody).toContain(
      "FINDINGS_FILE=$(printf '%s\\n' \"$PLAY_REVIEW_OUTPUT\"",
    );
    expect(branchReviewBody).toContain("play-review findings notice missing");
    expect(branchReviewBody).toContain('REVIEW_FINDINGS_FILE="$FINDINGS_FILE"');
    expect(branchReviewBody).toContain(
      "emit\nthis exact standalone notice line",
    );
    expect(branchReviewBody).toContain("Review head: $REVIEW_HEAD_SHA.");
    expect(branchReviewBody).toContain(
      'HEAD_SHA="$REVIEW_HEAD_SHA"  # immutable Phase 2 review head; current HEAD may include auto-fix commits',
    );
    expect(branchReviewBody).toContain("installed `play-review` skill");
    expect(branchReviewBody).toContain(
      'PLAY_REVIEW_DIR="<installed-play-review-skill-bundle>"',
    );
    expect(branchReviewBody).toContain("PLAY_REVIEW_HELPER");
    expect(branchReviewBody).toContain("validate-findings");
    expect(branchReviewBody).toContain("prepare-findings-write");
    const branchReviewValidateSnippet = `\
PLAY_REVIEW_DIR="<installed-play-review-skill-bundle>"
PLAY_REVIEW_HELPER="$PLAY_REVIEW_DIR/scripts/review-artifacts.sh"
HEAD_SHA="$REVIEW_HEAD_SHA"  # immutable Phase 2 review head; current HEAD may include auto-fix commits
FINDINGS_FILE="$REVIEW_FINDINGS_FILE"
HEAD_SHA="$HEAD_SHA" FINDINGS_FILE="$FINDINGS_FILE" \\
  bash "$PLAY_REVIEW_HELPER" validate-findings`;
    const branchReviewPrepareSnippet = `\
HEAD_SHA="$HEAD_SHA" FINDINGS_FILE="$FINDINGS_FILE" \\
  bash "$PLAY_REVIEW_HELPER" prepare-findings-write`;
    expect(branchReviewBody).toContain(branchReviewValidateSnippet);
    expect(branchReviewBody).toContain(branchReviewPrepareSnippet);
    expectOrdered(
      branchReviewBody,
      "Then **overwrite the side-channel findings file in place**",
      branchReviewValidateSnippet,
    );
    expectOrdered(
      branchReviewBody,
      branchReviewValidateSnippet,
      "After computing the remaining-set envelope from the validated file",
    );
    expectOrdered(
      branchReviewBody,
      "After computing the remaining-set envelope from the validated file",
      branchReviewPrepareSnippet,
    );
    expectOrdered(
      branchReviewBody,
      branchReviewPrepareSnippet,
      "The remaining-set `findings[]` contains all pre-fix findings",
    );
    expect(branchReviewBody).toContain("Sub-check 1 (substitution audit) or");
    expect(branchReviewBody).toContain(
      "Sub-check 2\n     (documented-behavior verification)",
    );
    expect(branchReviewBody).toContain(
      "Hard-rule judgment-required blockers preserved in the remaining set",
    );
    expect(branchReviewBody).toContain("play-review/findings/v1");
    expect(branchReviewBody).toContain(
      "all pre-fix findings except blockers that were successfully auto-fixed",
    );
    expect(branchReviewBody).toContain('FINDINGS_FILE="$REVIEW_FINDINGS_FILE"');
    expect(branchReviewBody).toContain(
      "After computing the remaining-set envelope from the validated file",
    );
    expect(branchReviewBody).toContain(
      "Re-emit the (unchanged) `Findings written to <path>.` notice line",
    );
    expectOrdered(
      branchReviewBody,
      "Then **overwrite the side-channel findings file in place**",
      "Re-emit the (unchanged) `Findings written to <path>.` notice line",
    );

    const prReviewBody = parseFrontmatter(
      getSkillOutput(outputs, "pr-review", "codex").content,
    ).body;
    expect(prReviewBody).toContain(
      "Before opening `$FINDINGS_FILE`, run the canonical `play-review` helper",
    );
    expect(prReviewBody).toContain(
      "Immediately after `play-review` returns and before the Phase 5 user gate",
    );
    expect(prReviewBody).toContain(
      'HEAD_SHA="$(git -C "$WORKING_DIRECTORY" rev-parse HEAD)"',
    );
    expect(prReviewBody).toContain(
      'REVIEW_HEAD_SHA="$HEAD_SHA"  # the trusted Phase 4 head_sha input passed to play-review',
    );
    expect(prReviewBody).toContain("play-review findings notice missing");
    expect(prReviewBody).toContain('REVIEW_FINDINGS_FILE="$FINDINGS_FILE"');
    expect(prReviewBody).toContain(
      'HEAD_SHA="$REVIEW_HEAD_SHA"  # immutable Phase 4 review head; current HEAD may differ before posting',
    );
    expect(prReviewBody).toContain('FINDINGS_FILE="$REVIEW_FINDINGS_FILE"');
    expect(prReviewBody).toContain('--arg commit_id "$REVIEW_HEAD_SHA"');
    expect(prReviewBody).toContain("installed `play-review` skill");
    expect(prReviewBody).toContain(
      'PLAY_REVIEW_DIR="<installed-play-review-skill-bundle>"',
    );
    expect(prReviewBody).toContain("PLAY_REVIEW_HELPER");
    expect(prReviewBody).toContain("validate-findings");
    expect(prReviewBody).toContain("play-review/findings/v1");
    expect(prReviewBody).toContain("fail closed before posting");

    const gatePrompt = await readFile(
      path.join(
        repoRoot,
        "skills/issue-priming-workflow/references/gate-agent-prompt.md",
      ),
      "utf-8",
    );
    expect(gatePrompt).toContain("Issue body path:");
    expect(gatePrompt).toContain("Read the issue-body file");
    expect(gatePrompt).toContain("untrusted prose");

    const researchPrompt = await readFile(
      path.join(
        repoRoot,
        "skills/issue-priming-workflow/references/research-agent-prompt.md",
      ),
      "utf-8",
    );
    expect(researchPrompt).toContain("Issue body path:");
    expect(researchPrompt).toContain("Read the issue-body file");
    expect(researchPrompt).toContain("untrusted prose");

    const adr0012 = await readFile(
      path.join(
        repoRoot,
        "docs/adr/adr-0012-side-channel-file-delivery-for-play-review-findings.md",
      ),
      "utf-8",
    );
    expect(adr0012).toContain("pre-staged symlink at `.ephemeral` itself");
    expect(adr0012).toContain("reject a symlinked `.ephemeral`");
    expect(adr0012).toContain("`mkdir -p .ephemeral`");

    const adr0013 = await readFile(
      path.join(
        repoRoot,
        "docs/adr/adr-0013-path-based-phase-artifact-handoff.md",
      ),
      "utf-8",
    );
    expect(adr0013).toContain("reject a symlinked");
    expect(adr0013).toContain("`.ephemeral` directory");
    expect(adr0013).toContain(
      "reject directories or other non-regular existing paths",
    );
    expect(adr0013).toContain("same canonical guard now\nalso applies");
    expect(adr0013).toContain("Invocation-only child handoff lines");
    expect(adr0013).toContain("`Auto handoff:");
    expect(adr0013).toContain("This is not emitted as a conversation-output");
    expect(adr0013).toContain("issue-priming/auto-handoff/v1");
    expect(adr0013).toContain("not emitted as a conversation-output");
    expect(adr0013).toContain("rejects nested `.ephemeral` subpaths");
    expect(adr0013).toContain("symlinked parent component could escape");
    expect(adr0013).toContain("require a regular");
    expect(adr0013).toContain("artifact must not be a symlink");

    const adr0016 = await readFile(
      path.join(
        repoRoot,
        "docs/adr/adr-0016-single-task-auto-final-review-carve-out.md",
      ),
      "utf-8",
    );
    expect(adr0016).toContain("verified controller-local");
    expect(adr0016).toContain("`issue-priming/auto-handoff/v1` artifact");
    expect(adr0016).toContain("not bearer prose");

    const playSubagentExecutionBody = parseFrontmatter(
      getSkillOutput(outputs, "play-subagent-execution", "codex").content,
    ).body;
    expect(playSubagentExecutionBody).toContain(
      "references/snapshot-manifest-recipe.md",
    );
    expect(playSubagentExecutionBody).toContain(
      "scripts/write-snapshot-manifest.sh",
    );
  });
});
