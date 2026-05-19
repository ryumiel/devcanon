import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  getSkillOutput,
  listRelativeFiles,
} from "../__test-helpers__/render.js";
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
  "play-branch-finish",
  "play-agent-dispatch",
  "pr-review",
  "branch-review",
  "play-review",
  "play-subagent-execution",
  "pr-merge",
  "play-skill-authoring",
  "play-planning",
  "report-devcanon-issue",
  "spec-readiness-review",
  "subagent-lifecycle",
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
    "report-devcanon-issue",
  ] as const,
  sidecar: [
    "github-issue-priming",
    "linear-issue-priming",
    "pr-review",
    "report-devcanon-issue",
  ] as const,
  policySidecar: [
    "issue-priming-workflow",
    "play-review",
    "subagent-lifecycle",
  ] as const,
};

const CODEX_ALLOWED_FRONTMATTER_KEYS = new Set([
  "name",
  "description",
  "allowed-tools",
  ...CODEX_SKILL_OVERRIDE_FIELDS,
]);

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

  it("renders DevCanon issue reporting with the renamed skill and DevCanon target", async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    const { outputs } = await renderAll(config, true);

    for (const target of ["claude", "codex"] as const) {
      const output = getSkillOutput(outputs, "report-devcanon-issue", target);

      expect(output.content).toContain("name: report-devcanon-issue");
      expect(output.content).toContain("ryumiel/devcanon");
      expect(output.content).not.toContain("ryumiel/agent-manager");
    }

    expect(
      await pathExists(
        path.join(
          config.library.generatedDir,
          "codex",
          "skills",
          "report-devcanon-shared-issue",
        ),
      ),
    ).toBe(false);
    expect(
      await pathExists(
        path.join(
          config.library.generatedDir,
          "claude",
          "skills",
          "report-devcanon-shared-issue",
        ),
      ),
    ).toBe(false);
  });

  it("renders play-subagent implementer prompts with conditional snapshot behavior", async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    const { outputs } = await renderAll(config, true);

    const promptReferences = [
      "implementer-prompt.md",
      "mechanical-implementer-prompt.md",
    ];

    for (const target of ["claude", "codex"] as const) {
      const output = getSkillOutput(outputs, "play-subagent-execution", target);
      expect(output.content).toContain("Controller skipped the snapshot");
      expect(output.content).toContain(
        "Requested snapshot notice line is absent from DONE/DONE_WITH_CONCERNS",
      );
      expect(output.content).toContain(
        "Record snapshot state as `malformed`; surface the requested-snapshot contract violation",
      );

      const skillRoot = path.join(
        config.library.generatedDir,
        target,
        "skills",
        "play-subagent-execution",
      );

      const recipePath = path.join(
        skillRoot,
        "references",
        "snapshot-manifest-recipe.md",
      );
      const helperPath = path.join(
        skillRoot,
        "scripts",
        "write-snapshot-manifest.sh",
      );

      expect(await pathExists(recipePath)).toBe(true);
      expect(await readFile(recipePath, "utf-8")).toContain(
        "implementer/snapshot/v1",
      );
      expect(await pathExists(helperPath)).toBe(true);
      expect(await readFile(helperPath, "utf-8")).toContain(
        "Snapshot written to",
      );

      for (const promptReference of promptReferences) {
        const promptPath = path.join(skillRoot, "references", promptReference);
        const prompt = await readFile(promptPath, "utf-8");
        const normalizedPrompt = prompt.replace(/\s+/g, " ");

        expect(prompt).toContain(
          "Snapshot request: <SNAPSHOT_REQUEST_STATE: requested|skipped>",
        );
        expect(prompt).toContain(
          "Only write a side-channel snapshot manifest when the",
        );
        expect(prompt).toContain("snapshot request state is `requested`.");
        expect(prompt).toContain(
          "If the snapshot request state is `skipped`, do not append any snapshot notice",
        );
        expect(normalizedPrompt).toContain(
          "default fields: status, summary, tests, files changed, base SHA, head SHA.",
        );
        expect(normalizedPrompt).toContain(
          "If the helper exits nonzero, report BLOCKED instead of emitting the notice",
        );
        expect(prompt).toContain("Snapshot written to <repo-relative-path>.");
        expect(normalizedPrompt).not.toContain(
          "After committing and self-reviewing, write the side-channel snapshot manifest before reporting",
        );
      }
    }
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

    const playSubagentReferencesRoot = path.join(
      repoRoot,
      "skills/play-subagent-execution/references",
    );
    const playSubagentReferenceFiles = await listRelativeFiles(
      playSubagentReferencesRoot,
    );

    for (const reference of playSubagentReferenceFiles) {
      const sourcePath = path.join(playSubagentReferencesRoot, reference);
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
        const generatedContent = await readFile(generatedPath, "utf-8");
        expect(generatedContent).toBe(sourceContent);
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

    const skillEntries = await readdir(path.join(repoRoot, "skills"), {
      withFileTypes: true,
    });
    const skillDirs = skillEntries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);

    for (const skillName of skillDirs) {
      const sourceScriptsRoot = path.join(
        repoRoot,
        "skills",
        skillName,
        "scripts",
      );
      if (!(await pathExists(sourceScriptsRoot))) continue;

      const scriptFiles = await listRelativeFiles(sourceScriptsRoot);
      for (const scriptFile of scriptFiles) {
        const sourcePath = path.join(sourceScriptsRoot, scriptFile);
        const sourceContent = await readFile(sourcePath, "utf-8");

        for (const target of ["claude", "codex"] as const) {
          const generatedPath = path.join(
            config.library.generatedDir,
            target,
            "skills",
            skillName,
            "scripts",
            scriptFile,
          );

          expect(await pathExists(generatedPath)).toBe(true);
          expect(await readFile(generatedPath, "utf-8")).toBe(sourceContent);
        }
      }
    }

    const sourcePath = path.join(
      repoRoot,
      "skills/write-product-spec/references/behavior-spec-evidence-routing.md",
    );
    const sourceContent = await readFile(sourcePath, "utf-8");

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

    const researchPromptSourcePath = path.join(
      repoRoot,
      "skills/issue-priming-workflow/references/research-agent-prompt.md",
    );
    const researchPromptSourceContent = await readFile(
      researchPromptSourcePath,
      "utf-8",
    );

    for (const target of ["claude", "codex"] as const) {
      const generatedPath = path.join(
        config.library.generatedDir,
        target,
        "skills",
        "issue-priming-workflow",
        "references",
        "research-agent-prompt.md",
      );

      expect(await pathExists(generatedPath)).toBe(true);
      expect(await readFile(generatedPath, "utf-8")).toBe(
        researchPromptSourceContent,
      );
    }
  });
});
