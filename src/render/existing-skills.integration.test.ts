import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { loadConfig } from "../config/load.js";
import { CODEX_SKILL_OVERRIDE_FIELDS } from "../config/schema.js";
import { pathExists } from "../utils/fs.js";
import { parseFrontmatter } from "./frontmatter.js";
import { renderAll } from "./pipeline.js";

const TOUCHED_SKILLS = new Set([
  "github-issue-priming",
  "issue-priming-workflow",
  "issue-slicing",
  "issue-worktree-setup",
  "linear-issue-priming",
  "play-brainstorm",
  "pr-review",
  "branch-review",
  "play-review",
  "pr-merge",
  "play-skill-authoring",
  "play-planning",
  "report-devcanon-shared-issue",
  "spec-readiness-review",
  "write-product-requirements",
  "write-product-spec",
]);

const SKILLS_WITH_METADATA = {
  claudeFrontmatter: [
    "github-issue-priming",
    "issue-priming-workflow",
    "linear-issue-priming",
  ] as const,
  codexFrontmatter: [
    "github-issue-priming",
    "linear-issue-priming",
    "report-devcanon-shared-issue",
  ] as const,
  sidecar: [
    "github-issue-priming",
    "linear-issue-priming",
    "pr-review",
    "report-devcanon-shared-issue",
  ] as const,
  policySidecar: ["issue-priming-workflow", "play-review"] as const,
};

const CODEX_ALLOWED_FRONTMATTER_KEYS = new Set([
  "name",
  "description",
  "allowed-tools",
  ...CODEX_SKILL_OVERRIDE_FIELDS,
]);

function getSkillOutput(
  outputs: Awaited<ReturnType<typeof renderAll>>["outputs"],
  name: string,
  target: "claude" | "codex",
) {
  const output = outputs.find(
    (candidate) =>
      candidate.type === "skill" &&
      candidate.name === name &&
      candidate.target === target,
  );
  if (!output) {
    throw new Error(`Missing rendered ${target} output for skill ${name}`);
  }
  return output;
}

function normalizeWhitespace(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

describe("existing skills render cleanly", () => {
  it("renders every shipped skill to both targets without error", async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    const result = await renderAll(config, false);

    const skillEntries = await readdir(path.join(repoRoot, "skills"));
    const skillDirs = skillEntries.filter((e) => !e.startsWith("."));

    const skillOutputs = result.outputs.filter((o) => o.type === "skill");
    expect(skillOutputs).toHaveLength(skillDirs.length * 2);

    for (const output of skillOutputs) {
      expect(output.content.startsWith("---\n")).toBe(true);
      expect(output.content).toContain(`name: ${output.name}`);
    }
  });

  it("renders the touched skills with Codex-valid frontmatter", async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    const { outputs } = await renderAll(config, false);
    const codexOutputs = outputs.filter(
      (output) =>
        output.type === "skill" &&
        output.target === "codex" &&
        TOUCHED_SKILLS.has(output.name),
    );

    expect(codexOutputs).toHaveLength(TOUCHED_SKILLS.size);

    for (const output of codexOutputs) {
      const { frontmatter, body } = parseFrontmatter(output.content);

      expect(frontmatter.name).toBe(output.name);
      expect(frontmatter.description).toEqual(expect.any(String));
      expect(frontmatter).not.toHaveProperty("model");
      expect(frontmatter).not.toHaveProperty("effort");
      expect(body).not.toContain("{{model:");

      for (const key of Object.keys(frontmatter)) {
        expect(CODEX_ALLOWED_FRONTMATTER_KEYS.has(key)).toBe(true);
      }
    }
  });

  it("renders shipped per-target metadata for the priming and review skills", async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    const { outputs } = await renderAll(config, true);

    for (const skillName of SKILLS_WITH_METADATA.codexFrontmatter) {
      const codexOutput = getSkillOutput(outputs, skillName, "codex");
      const { frontmatter: codexFrontmatter, body: codexBody } =
        parseFrontmatter(codexOutput.content);

      expect(codexFrontmatter).toMatchObject({
        license: "MIT",
        metadata: {
          "short-description": expect.any(String),
        },
      });
      expect(codexBody).not.toContain("{{model:");
      expect(codexFrontmatter).toMatchSnapshot(
        `${skillName}-codex-frontmatter`,
      );
    }

    for (const skillName of SKILLS_WITH_METADATA.claudeFrontmatter) {
      const claudeOutput = getSkillOutput(outputs, skillName, "claude");
      const { frontmatter: claudeFrontmatter, body: claudeBody } =
        parseFrontmatter(claudeOutput.content);

      expect(claudeFrontmatter).toMatchObject({
        model: "claude-opus-4-7",
      });
      expect(claudeBody).not.toContain("{{model:");
      expect(claudeFrontmatter).toMatchSnapshot(
        `${skillName}-claude-frontmatter`,
      );
    }

    for (const skillName of SKILLS_WITH_METADATA.sidecar) {
      const sidecarPath = path.join(
        config.library.generatedDir,
        "codex",
        "skills",
        skillName,
        "agents",
        "openai.yaml",
      );

      expect(await pathExists(sidecarPath)).toBe(true);

      const sidecar = await readFile(sidecarPath, "utf-8");
      const parsed = parseYaml(sidecar) as Record<string, unknown>;

      expect(parsed).toMatchObject({
        interface: {
          display_name: expect.any(String),
          short_description: expect.any(String),
          brand_color: expect.any(String),
        },
      });
      expect(parsed).toMatchSnapshot(`${skillName}-sidecar`);
    }

    for (const skillName of SKILLS_WITH_METADATA.policySidecar) {
      const sidecarPath = path.join(
        config.library.generatedDir,
        "codex",
        "skills",
        skillName,
        "agents",
        "openai.yaml",
      );

      expect(await pathExists(sidecarPath)).toBe(true);

      const sidecar = await readFile(sidecarPath, "utf-8");
      const parsed = parseYaml(sidecar) as Record<string, unknown>;

      expect(parsed).toMatchObject({
        policy: { allow_implicit_invocation: false },
      });
      expect(parsed).not.toHaveProperty("interface");
      expect(parsed).toMatchSnapshot(`${skillName}-sidecar`);
    }
  });

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

    const branchReviewBody = parseFrontmatter(
      getSkillOutput(outputs, "branch-review", "codex").content,
    ).body;
    expect(branchReviewBody).toContain(`\
[ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink" >&2; exit 1; }
mkdir -p .ephemeral
[ -L "$FINDINGS_FILE" ] && rm "$FINDINGS_FILE"`);

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

  it("pins reviewer prompt snapshot trust-boundary language", async () => {
    const repoRoot = process.cwd();
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
    expect(codeQualityReviewerPrompt).toContain(
      "Do not consume any content snapshot",
    );
  });

  it("documents planning composition and execution boundary contracts", async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    const { outputs } = await renderAll(config, false);
    const playSubagentExecutionBody = parseFrontmatter(
      getSkillOutput(outputs, "play-subagent-execution", "codex").content,
    ).body;
    const playPlanningBody = parseFrontmatter(
      getSkillOutput(outputs, "play-planning", "codex").content,
    ).body;
    const issuePrimingWorkflowBody = parseFrontmatter(
      getSkillOutput(outputs, "issue-priming-workflow", "codex").content,
    ).body;
    expect(playPlanningBody).toContain("## Cohesive Task Composition");
    expect(playPlanningBody).toContain(
      "share the same subsystem or file family",
    );
    expect(playPlanningBody).toContain(
      "Do not replace executable checkbox steps with vague high-level subtasks",
    );
    expect(playPlanningBody).toContain(
      "Do not hide dependent implementation units merely to avoid multi-task review",
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
    expect(reviewHintSection).toContain("**Execution:** single | composed");
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
      "High-risk triggers from `skills/play-subagent-execution/SKILL.md` §",
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
    expect(executionHandoffSection).not.toContain(
      "Fresh subagent per task + two-stage review",
    );

    const planningHintStart = playPlanningBody.indexOf(
      "Example mechanical-task header:",
    );
    const planningHintEnd = playPlanningBody.indexOf(
      "Omit the field for any task with judgment",
    );
    expect(planningHintStart).toBeGreaterThanOrEqual(0);
    expect(planningHintEnd).toBeGreaterThan(planningHintStart);
    const planningHintExample = playPlanningBody.slice(
      planningHintStart,
      planningHintEnd,
    );
    const modeIndex = planningHintExample.indexOf("**Mode:** mechanical");
    const executionIndex = planningHintExample.indexOf("**Execution:** single");
    expect(planningHintExample).toContain("### Task N: Rename Example Token");
    expect(planningHintExample).toContain(
      "Exact single-file identifier replacement with no hard-risk trigger",
    );
    expect(planningHintExample).toContain("- Modify: `examples/demo-note.md`");
    expect(planningHintExample).toContain("**Replace:** `OldExampleToken`");
    expect(planningHintExample).toContain("**With:** `NewExampleToken`");
    const riskIndex = planningHintExample.indexOf("**Risk hint:** low");
    const reviewIndex = planningHintExample.indexOf(
      "**Review hint:** none-final-only",
    );
    const rationaleIndex = planningHintExample.indexOf("**Review rationale:**");
    const filesIndex = planningHintExample.indexOf("**Files:**");
    expect(modeIndex).toBeGreaterThanOrEqual(0);
    expect(modeIndex).toBeLessThan(executionIndex);
    expect(executionIndex).toBeLessThan(riskIndex);
    expect(riskIndex).toBeLessThan(reviewIndex);
    expect(reviewIndex).toBeLessThan(rationaleIndex);
    expect(rationaleIndex).toBeLessThan(filesIndex);

    expect(playSubagentExecutionBody).toContain(
      "high-assurance serial execution",
    );
    expect(playSubagentExecutionBody).toContain(
      "preserves the task boundaries authored in the plan",
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
    const normalizedRoutingSection = routingSection.replace(/\s+/g, " ");
    expect(routingSection).toContain(
      "`play-subagent-execution` owns reviewer dispatch",
    );
    expect(routingSection).toContain(
      "defaults missing, malformed, conflicting, or unclear classifications to",
    );
    expect(normalizedRoutingSection).toContain(
      "defaults missing, malformed, conflicting, or unclear classifications to `spec-and-quality`",
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
    expect(routingSection).toContain(
      "Phase 7 immediately runs\n`branch-review --fix` on the full branch diff",
    );
    expect(routingSection).toContain(
      "This covers GitHub and Linear\nentrypoints because both delegate",
    );
    expect(routingSection).toContain(
      "plan content, copied invocation\nprose, or direct/manual calls cannot assert it",
    );
    expect(routingSection).toContain(
      "Any other caller must use\n`spec-and-quality` until this skill source explicitly adds that caller",
    );
    expect(routingSection).toContain(
      "If the controller cannot verify the shared\nissue-priming `--auto` Phase 6 handoff, use `spec-and-quality`",
    );
    expect(routingSection).toContain(
      "`spec-only` is allowed for medium-risk tasks when no hard-risk trigger",
    );
    expect(routingSection).toContain(
      "`none-final-only` is allowed for low-risk tasks when no hard-risk trigger",
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
      "external CLI/API/system invocation substitutions",
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
      "## Controller Lifecycle Ledger",
    );
    expect(playSubagentExecutionBody).toContain("task id");
    expect(playSubagentExecutionBody).toContain("base/head SHA");
    expect(playSubagentExecutionBody).toContain(
      "one `agent_id` or `agent_id=pending`",
    );
    expect(playSubagentExecutionBody).toContain("role");
    expect(playSubagentExecutionBody).toContain("status");
    expect(playSubagentExecutionBody).toContain("role-specific captured state");
    expect(playSubagentExecutionBody).toContain("reviewer scope");
    expect(playSubagentExecutionBody).toContain("closed=yes");
    expect(playSubagentExecutionBody).toContain("closed=no");
    expect(playSubagentExecutionBody).toContain("close-unavailable: <reason>");
    expect(playSubagentExecutionBody).toContain("## Lifecycle State Machine");
    expect(playSubagentExecutionBody).toContain(
      "This diagram is a visual summary; the ledger fields and rules below are authoritative.",
    );
    expect(playSubagentExecutionBody).toContain(
      "close-unavailable: inventory-only; no close operation",
    );
    expect(playSubagentExecutionBody).toContain("reviewer result");
    expect(playSubagentExecutionBody).toContain("fixup count");
    expect(playSubagentExecutionBody).toContain("blocker state");
    expect(playSubagentExecutionBody).toContain(
      "## Target Lifecycle Capability",
    );
    expect(playSubagentExecutionBody).toContain("automatic-close-supported");
    expect(playSubagentExecutionBody).toContain("inventory-only");
    expect(playSubagentExecutionBody).toContain("cleanup-unavailable");
    expect(playSubagentExecutionBody).toContain(
      "Before every new subagent spawn",
    );
    expect(playSubagentExecutionBody).toContain(
      "orchestration resource exhaustion",
    );
    expect(playSubagentExecutionBody).toContain(
      "reconstruct active task state from the lifecycle ledger and git",
    );
    expect(playSubagentExecutionBody).toContain(
      "Wait for operator confirmation that manual cleanup is complete",
    );
    expect(playSubagentExecutionBody).toContain("retry the spawn exactly once");
    expect(playSubagentExecutionBody).toContain("agent_id=pending");
    expect(playSubagentExecutionBody).toContain(
      "review scope, base/head SHA, report, and PASS verdict",
    );
    expect(playSubagentExecutionBody).toContain(
      "concrete findings, routing target, and re-review target",
    );
    expect(playSubagentExecutionBody).toContain(
      "first capture the same role-specific state",
    );
    expect(playSubagentExecutionBody).toContain(
      "artifacts that status actually provides",
    );
    expect(playSubagentExecutionBody).toContain(
      "report or blocker/context request, `agent_id`, and any available base/head SHA",
    );
    expect(playSubagentExecutionBody).toContain(
      "do not wait for snapshot, changed-file, or test artifacts that were not produced",
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
    expect(playSubagentAdvantages).toContain(
      "remaining `Blocking` findings stop the workflow",
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
      "the verified shared `issue-priming-workflow --auto` Phase 6 path guarantees",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "`issue-priming-workflow` Phase 7 runs `branch-review --fix`",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "Branch review: no remaining `Blocking` findings",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "does not do runtime regrouping or batching",
    );
    const expectOrdered = (
      section: string,
      beforeMarker: string,
      afterMarker: string,
    ) => {
      const beforeIndex = section.indexOf(beforeMarker);
      const afterIndex = section.indexOf(afterMarker);

      expect(beforeIndex).toBeGreaterThanOrEqual(0);
      expect(afterIndex).toBeGreaterThanOrEqual(0);
      expect(beforeIndex).toBeLessThan(afterIndex);
    };

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
    expect(playSubagentExampleWorkflow).toContain(
      "Lifecycle cleanup checkpoint",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "closed=yes after PASS verdict recorded",
    );
    expect(playSubagentExampleWorkflow).toContain("Ledger pre-dispatch");
    expect(playSubagentExampleWorkflow).toContain("Ledger post-dispatch");
    expect(playSubagentExampleWorkflow).toContain(
      "Every later implementer, reviewer, re-reviewer, and final reviewer dispatch gets its own row",
    );
    expect(playSubagentExampleWorkflow).toContain("agent_id=pending");
    expect(playSubagentExampleWorkflow).toContain("review scope captured");
    expect(playSubagentExampleWorkflow).toContain("report captured");
    expect(playSubagentExampleWorkflow).toContain("status=DONE");
    expect(playSubagentExampleWorkflow).toContain(
      "inventory-only: target exposes session inventory but no close operation",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "close-unavailable: inventory-only; no close operation",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "first captures each completed session's role-specific state",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "cleanup-unavailable: target exposes neither inventory nor close operation",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "close-unavailable: no inventory or close operation",
    );
    expect(playSubagentExampleWorkflow).toContain("Slot-limit spawn failure");
    expect(playSubagentExampleWorkflow).toContain(
      "Controller runs the cleanup gate",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "Repeated blocker-family branch",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "Initial blocker-family record",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "blocker state=context-missing: needs target install path",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "base/head SHA captured (head pending)",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "close-unavailable: no inventory or close operation after BLOCKED report",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "Cleanup gate before Task 2 spec reviewer spawn",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "Cleanup gate before Task 2 spec re-review spawn",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "Cleanup gate before Task 2 code-quality reviewer spawn",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "Cleanup gate before Task 2 code-quality re-review spawn",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "findings captured: Missing progress reporting",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "re-review target=spec-2-rereview",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "routing target=Task 2 implementer",
    );
    expect(playSubagentExampleWorkflow).toContain("report refreshed");
    expect(playSubagentExampleWorkflow).toContain("test state refreshed");
    expect(playSubagentExampleWorkflow).toContain("snapshot refreshed");
    expect(playSubagentExampleWorkflow).toContain(
      "findings captured: Magic number (100)",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "re-review target=quality-2-rereview",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "Cleanup gate before final code-quality reviewer spawn",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "Task 2 code-quality reviewer: status=findings-recorded",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "Alternative target capability examples - separate runs",
    );
    expect(playSubagentExampleWorkflow).toContain(
      "final-code-quality-reviewer",
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
      "Phase 7 `branch-review --fix` is mandatory",
    );
    expect(issuePhase6Section).toContain(
      "satisfies the final-review guarantee required by any reduced per-task review route",
    );
    expect(issuePhase6Section).not.toContain(
      "Run all per-task reviews for multi-task plans",
    );

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
      "validate the parsed findings path before reading it",
    );
    expect(issuePhase7Section).toContain(".ephemeral/*-findings.json");
    expect(issuePhase7Section).toContain(
      "nested findings path rejected: $FINDINGS_FILE",
    );
    expect(issuePhase7Section).toContain(
      'echo "play-review path validation failed: $FINDINGS_FILE"',
    );
    expect(issuePhase7Section).toContain(
      'echo "path traversal: $FINDINGS_FILE"',
    );
    expect(issuePhase7Section).toContain(
      "nested nits path rejected: $NITS_PENDING_FILE",
    );
    expect(issuePhase7Section).toContain(
      'echo "path traversal: $NITS_PENDING_FILE"',
    );
    expect(issuePhase7Section).toContain(
      'If any finding has `severity: "Blocking"`, **stop `--auto` and surface those findings to the user**',
    );
    expect(issuePhase7Section).toContain(
      'Only proceed with the per-nit classification flow when every remaining finding has `severity: "Nit"`',
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

  it("documents the write-product-spec behavior-spec boundaries", async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    const { outputs } = await renderAll(config, false);
    const writeProductSpecBody = parseFrontmatter(
      getSkillOutput(outputs, "write-product-spec", "codex").content,
    ).body;

    expect(writeProductSpecBody).toContain("docs/specs/<topic>.md");
    expect(writeProductSpecBody).toContain("root `SPEC.md`");
    expect(writeProductSpecBody).toContain("routine bug fixes");
    expect(writeProductSpecBody).toContain("dependency audits");
    expect(writeProductSpecBody).toContain("review-feedback patches");
    expect(writeProductSpecBody).toContain("docs gardening");
    expect(writeProductSpecBody).toContain("behavior-preserving refactors");
    expect(writeProductSpecBody).toContain("live issue status");
    expect(writeProductSpecBody).toContain("assignees");
    expect(writeProductSpecBody).toContain("PR lists");
    expect(writeProductSpecBody).toContain("single-PR execution plans");
    expect(writeProductSpecBody).toContain("contract authority");
    expect(writeProductSpecBody).toContain("source-owned schemas");
    expect(writeProductSpecBody).toContain(
      "references/behavior-spec-evidence-routing.md",
    );
    expect(writeProductSpecBody).toContain(
      "Repo-local AFDS docs are optional project context",
    );
    expect(writeProductSpecBody).toContain("required runtime inputs");
    expect(writeProductSpecBody).toContain("evidence pointer");
    expect(writeProductSpecBody).toContain("durable team, system, role");
    expect(writeProductSpecBody).not.toContain(
      "docs/guidelines/portable-afds-user-procedure-map.md",
    );
    expect(writeProductSpecBody).not.toContain(
      "docs/guidelines/behavior-spec-evidence-routing.md",
    );
    expect(writeProductSpecBody).not.toContain(
      "docs/specs/afds-workflow-routing.md",
    );
    expect(writeProductSpecBody).not.toContain("EVID-001");
    expect(writeProductSpecBody).toContain("readiness review");
    expect(writeProductSpecBody).toContain("unapproved follow-up");
    expect(writeProductSpecBody).toContain("spec-readiness-review");
    expect(writeProductSpecBody).toContain("issue-slicing");
    expect(writeProductSpecBody.indexOf("spec-readiness-review")).toBeLessThan(
      writeProductSpecBody.indexOf("issue-slicing"),
    );
    expect(writeProductSpecBody).not.toContain("slice-issues");
    expect(writeProductSpecBody).toContain("doc-impact-review");
    expect(writeProductSpecBody).toContain("post-merge-gardener");
    expect(writeProductSpecBody).toContain("new agent");
    expect(writeProductSpecBody).toContain("roles");
    expect(writeProductSpecBody).toContain("write-product-requirements");
    expect(writeProductSpecBody).toContain("docs/product-requirements/");
    expect(writeProductSpecBody).toContain("product intent");
  });

  it("documents behavior-spec evidence routing as a durable procedure-map owner", async () => {
    const repoRoot = process.cwd();

    const procedureMap = await readFile(
      path.join(
        repoRoot,
        "docs/guidelines/portable-afds-user-procedure-map.md",
      ),
      "utf-8",
    );
    const routingGuideline = await readFile(
      path.join(repoRoot, "docs/guidelines/behavior-spec-evidence-routing.md"),
      "utf-8",
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
    expect(routingGuideline).toContain("Evidence Pointers");
    expect(routingGuideline).toContain("Readiness Before Slicing");
    expect(routingGuideline).toContain("Storage Boundary");
  });

  it("documents the spec-readiness-review status contract", async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    const { outputs } = await renderAll(config, false);
    const specReadinessReviewBody = parseFrontmatter(
      getSkillOutput(outputs, "spec-readiness-review", "codex").content,
    ).body;

    expect(specReadinessReviewBody).toContain(
      "**Status:** <one of: Ready, Needs revision, Blocked>",
    );
    expect(specReadinessReviewBody).toContain(
      "Final status: <repeat the same single status>",
    );
    expect(specReadinessReviewBody).not.toContain(
      "**Status:** Ready | Needs revision | Blocked",
    );
    expect(specReadinessReviewBody).not.toContain(
      "Final status: Ready | Needs revision | Blocked",
    );
    expect(specReadinessReviewBody).toContain(
      "references/pre-slicing-procedure-map.md",
    );
    expect(specReadinessReviewBody).toContain(
      "references/routing-and-evidence.md",
    );
    expect(specReadinessReviewBody).toContain(
      "artifact, durable team, system, or role",
    );
    expect(specReadinessReviewBody).toContain("do not accept");
    expect(specReadinessReviewBody).toContain("person names, assignees");
    expect(specReadinessReviewBody).toContain("live tracker ownership");
    expect(specReadinessReviewBody).toContain(
      "Repo-local project docs are optional context",
    );
    expect(specReadinessReviewBody).toContain(
      "Do not treat repo-local docs as required",
    );
    expect(specReadinessReviewBody).toContain(
      "does not approve implementation",
    );
    expect(specReadinessReviewBody).not.toContain(
      "docs/specs/afds-workflow-routing.md",
    );
    expect(specReadinessReviewBody).not.toContain("MAP.md");
    expect(specReadinessReviewBody).not.toContain("docs/guidelines/");
  });

  it("documents the issue-slicing draft-only provider-neutral contract", async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    const { outputs } = await renderAll(config, false);
    const issueSlicingBody = parseFrontmatter(
      getSkillOutput(outputs, "issue-slicing", "codex").content,
    ).body;

    expect(issueSlicingBody).toContain("MODE=draft");
    expect(issueSlicingBody).toContain("MODE=blocked");
    expect(issueSlicingBody).toContain("GitHub Issues or Linear");
    expect(issueSlicingBody).toContain(
      "docs/guidelines/portable-afds-user-procedure-map.md",
    );
    expect(issueSlicingBody).toContain("Do not create live issues");
    expect(issueSlicingBody).toContain("assign users");
    expect(issueSlicingBody).toContain("set status");
    expect(issueSlicingBody).toContain("mutate labels");
    expect(issueSlicingBody).toContain("duplicate live tracker state");
    expect(issueSlicingBody).toContain("Evidence Pointers");
    expect(issueSlicingBody).toContain(
      "At least one evidence pointer must name the owning durable artifact",
    );
    expect(issueSlicingBody).toContain(
      "<owning durable artifact>: <stable reference>",
    );
    expect(issueSlicingBody).not.toContain(
      "Final mode: <repeat MODE=draft or MODE=blocked>",
    );
  });

  it("mirrors bundled references and scripts to both targets", async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    await renderAll(config, true);

    const expectedReferences = [
      "routing-and-evidence.md",
      "pre-slicing-procedure-map.md",
    ];

    for (const reference of expectedReferences) {
      const sourcePath = path.join(
        repoRoot,
        "skills/spec-readiness-review/references",
        reference,
      );
      const sourceContent = await readFile(sourcePath, "utf-8");

      for (const target of ["claude", "codex"] as const) {
        const generatedPath = path.join(
          config.library.generatedDir,
          target,
          "skills",
          "spec-readiness-review",
          "references",
          reference,
        );

        expect(await pathExists(generatedPath)).toBe(true);
        expect(await readFile(generatedPath, "utf-8")).toBe(sourceContent);
      }
    }

    const playSubagentReferenceFiles = await readdir(
      path.join(repoRoot, "skills/play-subagent-execution/references"),
    );

    for (const reference of playSubagentReferenceFiles) {
      const sourcePath = path.join(
        repoRoot,
        "skills/play-subagent-execution/references",
        reference,
      );
      const sourceContent = await readFile(sourcePath, "utf-8");

      for (const target of ["claude", "codex"] as const) {
        const generatedPath = path.join(
          config.library.generatedDir,
          target,
          "skills",
          "play-subagent-execution",
          "references",
          reference,
        );

        expect(await pathExists(generatedPath)).toBe(true);
        expect(await readFile(generatedPath, "utf-8")).toBe(sourceContent);
      }
    }

    const snapshotHelperSourcePath = path.join(
      repoRoot,
      "skills/play-subagent-execution/scripts/write-snapshot-manifest.sh",
    );
    const snapshotHelperSourceContent = await readFile(
      snapshotHelperSourcePath,
      "utf-8",
    );

    for (const target of ["claude", "codex"] as const) {
      const generatedPath = path.join(
        config.library.generatedDir,
        target,
        "skills",
        "play-subagent-execution",
        "scripts",
        "write-snapshot-manifest.sh",
      );

      expect(await pathExists(generatedPath)).toBe(true);
      expect(await readFile(generatedPath, "utf-8")).toBe(
        snapshotHelperSourceContent,
      );
    }

    const sourcePath = path.join(
      repoRoot,
      "skills/write-product-spec/references/behavior-spec-evidence-routing.md",
    );
    const sourceContent = await readFile(sourcePath, "utf-8");
    expect(sourceContent).toContain("packaged runtime reference");
    expect(sourceContent).toContain("minimum evidence pointer");
    expect(sourceContent).toContain("durable team, system, role, or artifact");
    expect(sourceContent).not.toContain(
      "docs/guidelines/behavior-spec-evidence-routing.md",
    );
    expect(sourceContent).not.toContain("docs/specs/afds-workflow-routing.md");
    expect(sourceContent).not.toContain("EVID-001");
    expect(sourceContent).not.toContain("source of origin");

    for (const target of ["claude", "codex"] as const) {
      const generatedPath = path.join(
        config.library.generatedDir,
        target,
        "skills",
        "write-product-spec",
        "references",
        "behavior-spec-evidence-routing.md",
      );

      expect(await pathExists(generatedPath)).toBe(true);
      expect(await readFile(generatedPath, "utf-8")).toBe(sourceContent);
    }
  });

  it("documents the write-product-requirements PRD boundaries", async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    const { outputs } = await renderAll(config, false);
    const writeProductRequirementsBody = parseFrontmatter(
      getSkillOutput(outputs, "write-product-requirements", "codex").content,
    ).body;

    expect(writeProductRequirementsBody).toContain(
      "docs/product-requirements/<topic>.md",
    );
    expect(writeProductRequirementsBody).toContain("profile gate");
    expect(writeProductRequirementsBody).toContain("product intent");
    expect(writeProductRequirementsBody).toContain("live issue state");
    expect(writeProductRequirementsBody).toContain("PR state");
    expect(writeProductRequirementsBody).toContain(
      "agent-local execution detail",
    );
    expect(writeProductRequirementsBody).toContain("contract authority");
    expect(writeProductRequirementsBody).toContain("link contract authority");
    expect(writeProductRequirementsBody).toContain("source-owned schemas");
    expect(writeProductRequirementsBody).toContain("readiness criteria");
    expect(writeProductRequirementsBody).toContain(
      "product validation criteria",
    );
    expect(writeProductRequirementsBody).toContain(
      "expected follow-up artifact",
    );
    expect(writeProductRequirementsBody).toContain("non-goals");
    expect(writeProductRequirementsBody).toContain("out-of-scope");
    expect(writeProductRequirementsBody).toContain(
      "immediate next owning artifact",
    );
    expect(writeProductRequirementsBody).toContain("Portable AFDS Toolkit PRD");
    expect(writeProductRequirementsBody).toContain("root `PRD.md`");
    expect(writeProductRequirementsBody).toContain("stable requirement IDs");
    expect(writeProductRequirementsBody).toContain("line-number references");
    expect(writeProductRequirementsBody).toContain("write-product-spec");
    expect(writeProductRequirementsBody).toContain("docs/specs/<topic>.md");
  });

  it("documents the guarded tiny-diff fanout contract in rendered play-review output", async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    const { outputs } = await renderAll(config, false);
    const playReviewBody = parseFrontmatter(
      getSkillOutput(outputs, "play-review", "codex").content,
    ).body;

    expect(playReviewBody).toContain("Guarded tiny-diff mode");
    expect(playReviewBody).toContain("at most 2 files");
    expect(playReviewBody).toContain("at most 20 total lines");
    expect(playReviewBody).toContain(
      "Correctness, Data-safety, and critic verification remain",
    );
    expect(playReviewBody).toContain("safe tiny diff example");
    expect(playReviewBody).toContain("Result: tiny-diff mode may suppress the");
    expect(playReviewBody).toContain(
      "dynamic fanout; Correctness, Data-safety, and critic still run.",
    );
    expect(playReviewBody).toContain("small-but-risky diff example");
    expect(playReviewBody).toContain("Result: normal full dynamic fanout");
    expect(playReviewBody).toContain(
      "If any check is ambiguous, fall back to the normal full dynamic fanout.",
    );
    expect(playReviewBody).toContain("`is_followup_narrow` is **false**");
    expect(playReviewBody).toContain("docs/specs/**");
    expect(playReviewBody).toContain("reviewer-routing policy");
    expect(playReviewBody).toContain("docs/guidelines/*.md");
    expect(playReviewBody).not.toContain("skills/**/SKILL.md");
    expect(playReviewBody).toContain("references/red-flags.md");

    const redFlags = await readFile(
      path.join(repoRoot, "skills/play-review/references/red-flags.md"),
      "utf-8",
    );
    expect(redFlags).toContain(
      "You treated line count alone as enough to suppress the dynamic fanout",
    );
  });
});
