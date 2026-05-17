import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config/load.js";
import { parseFrontmatter } from "./frontmatter.js";
import { renderAll } from "./pipeline.js";
import {
  expectOrdered,
  getSkillOutput,
  normalizeWhitespace,
} from "./render-test-helpers.js";

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

    const workflowBody = parseFrontmatter(
      getSkillOutput(outputs, "issue-priming-workflow", "codex").content,
    ).body;
    expect(workflowBody).toContain("Issue body:");
    expect(workflowBody).toContain("issue-body-path");
    expect(workflowBody).toContain("worktree-path");
    expect(workflowBody).toContain('cd "$WORKTREE_PATH" ||');
    expect(workflowBody).toContain(`\
[ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink" >&2; exit 1; }
   mkdir -p .ephemeral
   [ -L "$RESEARCH_BRIEF_PATH" ] && rm "$RESEARCH_BRIEF_PATH"`);
    expect(workflowBody).toContain(`\
[ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink" >&2; exit 1; }
  mkdir -p .ephemeral
  [ -L "$NITS_PENDING_FILE" ] && rm "$NITS_PENDING_FILE"`);

    const brainstormBody = parseFrontmatter(
      getSkillOutput(outputs, "play-brainstorm", "codex").content,
    ).body;
    expect(brainstormBody).toContain("Issue body:");
    expect(brainstormBody).toContain("-issue-body.md");
    expect(brainstormBody).toContain(`\
DESIGN_PATH=".ephemeral/$(date +%F)-<topic>-design.md"
  [ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink" >&2; exit 1; }
  mkdir -p .ephemeral
  [ -L "$DESIGN_PATH" ] && rm "$DESIGN_PATH"`);

    const playPlanningBody = parseFrontmatter(
      getSkillOutput(outputs, "play-planning", "codex").content,
    ).body;
    expect(playPlanningBody).toContain(`\
PLAN_PATH=".ephemeral/$(date +%F)-<feature-name>-plan.md"
[ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink" >&2; exit 1; }
mkdir -p .ephemeral
[ -L "$PLAN_PATH" ] && rm "$PLAN_PATH"`);

    const playReviewBody = parseFrontmatter(
      getSkillOutput(outputs, "play-review", "codex").content,
    ).body;
    expect(playReviewBody).toContain(
      "nested findings path rejected: $FINDINGS_FILE",
    );
    expect(playReviewBody).toContain(".ephemeral/*-findings.json");
    expect(playReviewBody).toContain(
      'EXPECTED_FINDINGS_FILE=".ephemeral/${BRANCH_SLUG}-${HEAD_SHA}-findings.json"',
    );
    expect(playReviewBody).toContain(
      'echo "findings path mismatch: $FINDINGS_FILE"',
    );
    expect(playReviewBody).not.toContain(
      ".ephemeral/*-findings.json|.ephemeral/*-nits-pending.json",
    );
    expectOrdered(
      playReviewBody,
      '.ephemeral/*/*) echo "nested findings path rejected: $FINDINGS_FILE"',
      ".ephemeral/*-findings.json)",
    );
    expect(playReviewBody).toContain(`\
[ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink" >&2; exit 1; }
  mkdir -p .ephemeral
  [ -L "$FINDINGS_FILE" ] && rm "$FINDINGS_FILE"`);
    expect(playReviewBody).toContain(`\
HEAD_SHA="$head_sha"  # validated upstream per § Output's SHA-format check
  CONTEXT_FILE=".ephemeral/\${BRANCH_SLUG}-\${HEAD_SHA}-review-context.md"
  [ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink" >&2; exit 1; }
  mkdir -p .ephemeral
  [ -L "$CONTEXT_FILE" ] && rm "$CONTEXT_FILE"`);

    const playBranchFinishBody = parseFrontmatter(
      getSkillOutput(outputs, "play-branch-finish", "codex").content,
    ).body;
    expect(playBranchFinishBody).toContain(
      "path MUST be a direct child of `.ephemeral/`",
    );
    expect(playBranchFinishBody).toContain(
      "nested nits_file path rejected: $NITS_FILE",
    );
    expectOrdered(
      playBranchFinishBody,
      '.ephemeral/*/*) echo "nested nits_file path rejected: $NITS_FILE"',
      ".ephemeral/*-findings.json|.ephemeral/*-nits-pending.json)",
    );

    const branchReviewBody = parseFrontmatter(
      getSkillOutput(outputs, "branch-review", "codex").content,
    ).body;
    expect(branchReviewBody).toContain(
      'REVIEW_HEAD_SHA="$(git rev-parse HEAD)"',
    );
    expect(branchReviewBody).toContain('REVIEW_FINDINGS_FILE="$FINDINGS_FILE"');
    expect(branchReviewBody).toContain(
      "Review head: `$REVIEW_HEAD_SHA` (the immutable Phase 2 `head_sha`)",
    );
    expect(branchReviewBody).toContain(
      'HEAD_SHA="$REVIEW_HEAD_SHA"  # immutable Phase 2 review head; current HEAD may include auto-fix commits',
    );
    expect(branchReviewBody).toContain('FINDINGS_FILE="$REVIEW_FINDINGS_FILE"');
    expect(branchReviewBody).toContain(
      "nested findings path rejected: $FINDINGS_FILE",
    );
    expect(branchReviewBody).toContain(
      'EXPECTED_FINDINGS_FILE=".ephemeral/${BRANCH_SLUG}-${HEAD_SHA}-findings.json"',
    );
    expect(branchReviewBody).toContain(
      'echo "findings path mismatch: $FINDINGS_FILE"',
    );
    expectOrdered(
      branchReviewBody,
      '.ephemeral/*/*) echo "nested findings path rejected: $FINDINGS_FILE"',
      ".ephemeral/*-findings.json)",
    );
    expect(branchReviewBody).toContain(`\
[ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink" >&2; exit 1; }
mkdir -p .ephemeral
[ -L "$FINDINGS_FILE" ] && rm "$FINDINGS_FILE"`);

    const prReviewBody = parseFrontmatter(
      getSkillOutput(outputs, "pr-review", "codex").content,
    ).body;
    expect(prReviewBody).toContain(
      "Before opening `$FINDINGS_FILE`, run the canonical parsed-path guard",
    );
    expect(prReviewBody).toContain(
      "nested findings path rejected: $FINDINGS_FILE",
    );
    expect(prReviewBody).toContain(
      'EXPECTED_FINDINGS_FILE=".ephemeral/${BRANCH_SLUG}-${HEAD_SHA}-findings.json"',
    );
    expect(prReviewBody).toContain(
      'echo "findings path mismatch: $FINDINGS_FILE"',
    );
    expect(prReviewBody).toContain(
      'echo "findings file must not be a symlink: $FINDINGS_FILE"',
    );
    expect(prReviewBody).toContain(
      'jq -e \'.schema == "play-review/findings/v1"\' "$FINDINGS_FILE"',
    );
    expectOrdered(
      prReviewBody,
      '.ephemeral/*/*) echo "nested findings path rejected: $FINDINGS_FILE"',
      ".ephemeral/*-findings.json)",
    );

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
    expect(adr0013).toContain("same canonical guard now also applies");

    const implementerPrompt = await readFile(
      path.join(
        repoRoot,
        "skills/play-subagent-execution/references/implementer-prompt.md",
      ),
      "utf-8",
    );
    const snapshotRecipe = await readFile(
      path.join(
        repoRoot,
        "skills/play-subagent-execution/references/snapshot-manifest-recipe.md",
      ),
      "utf-8",
    );
    expect(snapshotRecipe).toContain("schema `implementer/snapshot/v1`");
    expect(snapshotRecipe).toContain(
      "Snapshot written to <repo-relative-path>.",
    );
    expect(snapshotRecipe).toContain("scripts/write-snapshot-manifest.sh");
    expect(snapshotRecipe).toContain("SNAPSHOT_HELPER_SCRIPT");
    expect(snapshotRecipe).toContain("`jq` is a");
    expect(snapshotRecipe).toContain("hard helper prerequisite");
    expect(snapshotRecipe).toContain("prerequisite; if it is unavailable");
    expect(snapshotRecipe).toContain("`base64`");
    expect(snapshotRecipe).toContain("`mkdir`, `mv`");
    expect(snapshotRecipe).toContain("reject a symlinked `.ephemeral`");
    expect(snapshotRecipe).toContain(
      "reject a target snapshot path that is already a directory",
    );
    expect(snapshotRecipe).toContain("private scratch directory");
    expect(snapshotRecipe).toContain("private temp file");
    expect(snapshotRecipe).toContain("rename that output");
    expect(snapshotRecipe).toContain("head_sha");
    expect(snapshotRecipe).toContain(".ephemeral/snapshot-${HEAD_SHA}.json");
    expect(snapshotRecipe).toContain(
      'git diff -z --name-status --no-renames "${BASE_SHA}..HEAD"',
    );
    expect(snapshotRecipe).toContain(
      'git diff -z --numstat --no-renames "${BASE_SHA}..HEAD"',
    );
    expect(snapshotRecipe).toContain("committed `HEAD:<path>` blob");
    expect(snapshotRecipe).toContain("changed paths that are not safe");
    expect(snapshotRecipe).toContain("do not round-trip byte-for-byte");
    expect(snapshotRecipe).toContain("non-regular committed `HEAD` entries");
    expect(snapshotRecipe).toContain("jq --rawfile");
    expect(snapshotRecipe).toContain("jq -rj");
    expect(snapshotRecipe).toContain("byte-for-byte");
    expect(snapshotRecipe).toContain("post-write regular-file and size checks");
    expect(snapshotRecipe).toContain("non-regular");
    expect(snapshotRecipe).toContain(
      "In normal dispatches, the helper owns persistence and verification",
    );
    expect(snapshotRecipe).toContain("controller-computed changed-file list");
    expect(snapshotRecipe).toContain(
      "git diff -z --name-status --no-renames BASE..HEAD",
    );
    expect(snapshotRecipe).toContain("not snapshot-provided");
    expect(snapshotRecipe).toContain("paths or statuses");
    expect(normalizeWhitespace(snapshotRecipe)).toContain(
      "committed HEAD blob reads",
    );
    expect(snapshotRecipe).toContain("not mutable working-tree paths");
    expect(snapshotRecipe).toContain(
      "Snapshot content is controller bookkeeping only",
    );
    expect(snapshotRecipe).not.toContain("separate explicit fallback contract");
    expect(snapshotRecipe).not.toContain("Write tool");
    expect(snapshotRecipe).not.toContain("Complete general procedure");
    expect(snapshotRecipe).toContain("bytes <= 64000");
    expect(snapshotRecipe).toContain('"skipped": "binary"');
    expect(snapshotRecipe).toContain('"skipped": "size>64KB"');
    expect(snapshotRecipe).toContain(
      "Deleted files emit neither `content` nor `skipped`",
    );
    expect(normalizeWhitespace(snapshotRecipe)).toContain(
      "falls back to committed HEAD blob reads",
    );

    expect(implementerPrompt).toContain(
      "references/snapshot-manifest-recipe.md",
    );
    expect(implementerPrompt).toContain("scripts/write-snapshot-manifest.sh");
    expect(implementerPrompt).toContain(
      "Snapshot Manifest Recipe path: <SNAPSHOT_MANIFEST_RECIPE_PATH>",
    );
    expect(implementerPrompt).toContain(
      "Snapshot Manifest Helper Script path: <SNAPSHOT_HELPER_SCRIPT>",
    );
    expect(implementerPrompt).toContain("script with the captured `BASE_SHA`");
    expect(implementerPrompt).toContain(
      "Snapshot written to <repo-relative-path>.",
    );
    expect(implementerPrompt).toContain("exits nonzero");
    expect(implementerPrompt).not.toContain(
      "One canonical recipe for a single file",
    );

    const mechanicalImplementerPrompt = await readFile(
      path.join(
        repoRoot,
        "skills/play-subagent-execution/references/mechanical-implementer-prompt.md",
      ),
      "utf-8",
    );
    expect(mechanicalImplementerPrompt).toContain(
      "references/snapshot-manifest-recipe.md",
    );
    expect(mechanicalImplementerPrompt).toContain(
      "scripts/write-snapshot-manifest.sh",
    );
    expect(mechanicalImplementerPrompt).toContain(
      "Snapshot Manifest Recipe path: <SNAPSHOT_MANIFEST_RECIPE_PATH>",
    );
    expect(mechanicalImplementerPrompt).toContain(
      "Snapshot Manifest Helper Script path: <SNAPSHOT_HELPER_SCRIPT>",
    );
    expect(mechanicalImplementerPrompt).toContain(
      "script with the captured `BASE_SHA`",
    );
    expect(mechanicalImplementerPrompt).toContain(
      "Snapshot written to <repo-relative-path>.",
    );
    expect(mechanicalImplementerPrompt).toContain("exits nonzero");
    expect(mechanicalImplementerPrompt).not.toContain(
      "Build a JSON envelope conforming to schema",
    );

    const playSubagentExecutionBody = parseFrontmatter(
      getSkillOutput(outputs, "play-subagent-execution", "codex").content,
    ).body;
    expect(playSubagentExecutionBody).toContain(
      "references/snapshot-manifest-recipe.md",
    );
    expect(playSubagentExecutionBody).toContain(
      "scripts/write-snapshot-manifest.sh",
    );
    expect(playSubagentExecutionBody).toContain("include a readable");
    expect(playSubagentExecutionBody).toContain(
      "Snapshot Manifest Recipe path sourced from",
    );
    expect(playSubagentExecutionBody).toContain("instead of duplicating");
    expect(playSubagentExecutionBody).toContain(
      "inlining the shell implementation",
    );
    expect(playSubagentExecutionBody).toContain("hard helper prerequisite");
    expect(playSubagentExecutionBody).toContain("snapshot notice line");
    expect(playSubagentExecutionBody).toContain(".ephemeral/*/snapshot-*.json");
    expect(normalizeWhitespace(playSubagentExecutionBody)).toContain(
      "snapshot-specific flatness, symlink, and regular-file checks",
    );
    expect(playSubagentExecutionBody).toContain(
      "snapshot is not a regular file",
    );
    expect(playSubagentExecutionBody).toContain("SNAPSHOT_ENTRY_PATH");
    expect(playSubagentExecutionBody).toContain("../*");
    expect(playSubagentExecutionBody).toContain(
      "controller's own changed-file list",
    );
    expect(normalizeWhitespace(playSubagentExecutionBody)).toContain(
      "back to committed HEAD blob reads using the controller's own changed-file list, not the snapshot-provided path or status.",
    );
    expect(playSubagentExecutionBody).toContain(
      'git ls-tree HEAD -- ":(literal)$path"',
    );
    expect(playSubagentExecutionBody).toContain(
      'git cat-file blob "HEAD:$path"',
    );
    expect(normalizeWhitespace(playSubagentExecutionBody)).toContain(
      "Do not read mutable working-tree paths",
    );
    expect(playSubagentExecutionBody).toContain(
      "`path` + `status` set must exactly equal",
    );
    expect(playSubagentExecutionBody).toContain("missing");
    expect(playSubagentExecutionBody).toContain("extra");
    expect(playSubagentExecutionBody).toContain("duplicate");
    expect(playSubagentExecutionBody).toContain("status-mismatched");
    expect(normalizeWhitespace(playSubagentExecutionBody)).toContain(
      "The snapshot's complete `path` + `status` set must exactly equal the controller-computed set: no missing, extra, duplicate, or status-mismatched entries.",
    );
    expect(playSubagentExecutionBody).toContain("untrusted prose");
    expect(normalizeWhitespace(playSubagentExecutionBody)).toContain(
      "Path strings are repository-controlled",
    );
    expect(normalizeWhitespace(playSubagentExecutionBody)).toContain(
      "structured, escaped data",
    );
    expect(playSubagentExecutionBody).toContain("directives embedded");
    expect(playSubagentExecutionBody).toContain("data, not a prompt");
    expect(playSubagentExecutionBody).toContain("no runtime auto-detection");
    expect(playSubagentExecutionBody).toContain("Mechanical Task Taxonomy");

    const adr0014 = await readFile(
      path.join(
        repoRoot,
        "docs/adr/adr-0014-implementer-done-snapshot-contract.md",
      ),
      "utf-8",
    );
    expect(adr0014).toContain("Pre-staged symlinks at `.ephemeral`");
    expect(adr0014).toContain("reject a symlinked `.ephemeral` directory");
    expect(adr0014).toContain("`mkdir -p .ephemeral`");
    expect(adr0014).toContain("SNAPSHOT_BASENAME=");
    expect(adr0014).toContain(".ephemeral/*/snapshot-*.json");
    expect(adr0014).toContain("own changed-file list");
    expect(adr0014).toContain("snapshot-manifest recipe");
    expect(adr0014).toContain("readable recipe path");
    expect(adr0014).toContain("readable helper script path");
    expect(adr0014).toContain("mandatory-use contract");
    expect(adr0014).toContain("hard runtime prerequisite on `jq`");
    expect(adr0014).toContain("missing-snapshot fallback contract");
    expect(adr0014).toContain("committed HEAD blob reads");
    expect(normalizeWhitespace(adr0014)).toContain("structured, escaped data");
    expect(adr0014).toContain("repository-controlled and untrusted");
    expect(adr0014).toContain(
      "the helper script is authoritative for executable snapshot",
    );
    expect(adr0014).toContain(
      "prompt text is only the compact handoff to those sources",
    );
    expect(adr0014).toContain("Unsupported status letters");
    expect(adr0014).toContain("Changed path strings must round-trip");
    expect(adr0014).toContain("Non-deleted non-regular paths");
    expect(adr0014).toContain("intentional v1 helper behavior change");
    expect(adr0014).toContain(
      "One object per file the implementer added, modified, or deleted",
    );
    expect(adr0014).toContain("committed `HEAD:<path>` blob");
    expect(adr0014).toContain("round-trip byte-for-byte");
    expect(adr0014).toContain("jq -rj");
    expect(adr0014).toContain("private scratch directory");
    expect(adr0014).toContain("snapshot is not a regular file");
    expect(adr0014).toContain("complete `path` + `status` set must exactly");
    expect(adr0014).toContain("Snapshot written to <repo-relative-path>.");
    expect(adr0014).not.toContain("post-commit Git blob");
    expect(adr0014).not.toContain("committed link-text blob");
    expect(adr0014).not.toContain(
      "64 KB byte threshold, hard-coded in the implementer prompts",
    );
    expect(adr0014).not.toContain(
      "The threshold is a single literal in two prompts",
    );
  });
});
