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
    expect(implementerPrompt).toContain(
      '[ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink" >&2; exit 1; }',
    );
    expect(implementerPrompt).toContain("mkdir -p .ephemeral");
    expect(implementerPrompt).toContain(
      '[ -L "$SNAPSHOT_FILE" ] && rm "$SNAPSHOT_FILE"',
    );

    const mechanicalImplementerPrompt = await readFile(
      path.join(
        repoRoot,
        "skills/play-subagent-execution/references/mechanical-implementer-prompt.md",
      ),
      "utf-8",
    );
    expect(mechanicalImplementerPrompt).toContain(
      '[ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink" >&2; exit 1; }',
    );
    expect(mechanicalImplementerPrompt).toContain("mkdir -p .ephemeral");
    expect(mechanicalImplementerPrompt).toContain(
      '[ -L "$SNAPSHOT_FILE" ] && rm "$SNAPSHOT_FILE"',
    );

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
