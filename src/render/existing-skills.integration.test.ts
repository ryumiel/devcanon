import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  getSkillOutput,
  listRelativeFiles,
  normalizeWhitespace,
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
  "report-devcanon-shared-issue",
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
    "report-devcanon-shared-issue",
  ] as const,
  sidecar: [
    "github-issue-priming",
    "linear-issue-priming",
    "pr-review",
    "report-devcanon-shared-issue",
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

    const researchPromptSourcePath = path.join(
      repoRoot,
      "skills/issue-priming-workflow/references/research-agent-prompt.md",
    );
    const researchPromptSourceContent = await readFile(
      researchPromptSourcePath,
      "utf-8",
    );
    const normalizedResearchPromptSourceContent = normalizeWhitespace(
      researchPromptSourceContent,
    );
    expect(researchPromptSourceContent).toContain("subagent-lifecycle");
    expect(normalizedResearchPromptSourceContent).toContain(
      "Before dispatching internal research sub-agents",
    );
    expect(normalizedResearchPromptSourceContent).toContain(
      "target capability",
    );
    expect(normalizedResearchPromptSourceContent).toContain(
      "cleanup gate before spawns",
    );
    expect(normalizedResearchPromptSourceContent).toContain(
      "target-honest cleanup outcomes",
    );
    expect(normalizedResearchPromptSourceContent).toContain(
      "slot-limit recovery",
    );
    expect(normalizedResearchPromptSourceContent).toContain(
      "role-specific state",
    );
    for (const capturedStateTerm of [
      "scope",
      "report",
      "source references",
      "blocker state",
    ]) {
      expect(normalizedResearchPromptSourceContent).toContain(
        capturedStateTerm,
      );
    }

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

  it("documents subagent-lifecycle references in direct spawning workflows", async () => {
    const repoRoot = process.cwd();
    const config = await loadConfig(
      path.join(repoRoot, "devcanon.config.yaml"),
    );

    const { outputs } = await renderAll(config, false);
    const bodyFor = (skillName: string) =>
      parseFrontmatter(getSkillOutput(outputs, skillName, "codex").content)
        .body;

    const issuePrimingWorkflowBody = bodyFor("issue-priming-workflow");
    const playReviewBody = bodyFor("play-review");
    const playPlanningBody = bodyFor("play-planning");
    const playAgentDispatchBody = bodyFor("play-agent-dispatch");
    const playSkillAuthoringBody = bodyFor("play-skill-authoring");
    const prMergeBody = bodyFor("pr-merge");

    const expectSharedLifecycleReference = (
      section: string,
      sectionName: string,
    ) => {
      expect(
        section,
        `${sectionName} should reference subagent-lifecycle`,
      ).toContain("subagent-lifecycle");
      expect(section).toContain("target-honest cleanup outcomes");
      expect(section).toContain("slot-limit");
      expect(section).toContain("recovery");
    };

    const issueLifecycleStart = issuePrimingWorkflowBody.indexOf(
      "## Subagent Lifecycle",
    );
    const issueLifecycleEnd = issuePrimingWorkflowBody.indexOf(
      "## Phase 2: Complexity Gate",
    );
    expect(issueLifecycleStart).toBeGreaterThanOrEqual(0);
    expect(issueLifecycleEnd).toBeGreaterThan(issueLifecycleStart);
    const issueLifecycleSection = issuePrimingWorkflowBody.slice(
      issueLifecycleStart,
      issueLifecycleEnd,
    );
    expectSharedLifecycleReference(
      issueLifecycleSection,
      "issue-priming-workflow lifecycle section",
    );
    expect(issueLifecycleSection).toContain(
      "Before dispatching the Phase 2 gate agent",
    );
    expect(issueLifecycleSection).toContain("Phase 3 research agent");
    expect(normalizeWhitespace(issueLifecycleSection)).toContain("gate result");
    expect(issueLifecycleSection).toContain("research brief path");

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
    expect(issuePhase6Section).toContain("subagent-lifecycle");
    expect(issuePhase6Section).toContain(
      "Before the Phase 6 handoff, run the `subagent-lifecycle` cleanup gate",
    );
    expect(issuePhase6Section.indexOf("`subagent-lifecycle`")).toBeLessThan(
      issuePhase6Section.indexOf("Invoke `play-subagent-execution`"),
    );

    const playReviewPhase3Start = playReviewBody.indexOf(
      "## Phase 3: Spawn agents",
    );
    const playReviewPhase3End = playReviewBody.indexOf(
      "**Core agents (always spawned):**",
    );
    expect(playReviewPhase3Start).toBeGreaterThanOrEqual(0);
    expect(playReviewPhase3End).toBeGreaterThan(playReviewPhase3Start);
    const playReviewPhase3Section = playReviewBody.slice(
      playReviewPhase3Start,
      playReviewPhase3End,
    );
    expectSharedLifecycleReference(
      playReviewPhase3Section,
      "play-review Phase 3",
    );
    expect(playReviewPhase3Section).toContain(
      "Before spawning Phase 3 reviewer agents",
    );
    expect(playReviewPhase3Section).toContain("review scope");
    expect(playReviewPhase3Section).toContain("concrete findings");
    expect(playReviewPhase3Section).toContain(
      "Critic verdicts are captured with the critic session in Phase 5",
    );

    const playReviewCriticStart = playReviewBody.indexOf(
      "## Phase 5: Critic verification",
    );
    const playReviewCriticEnd = playReviewBody.indexOf("## Hard Rules");
    expect(playReviewCriticStart).toBeGreaterThanOrEqual(0);
    expect(playReviewCriticEnd).toBeGreaterThan(playReviewCriticStart);
    const playReviewCriticSection = playReviewBody.slice(
      playReviewCriticStart,
      playReviewCriticEnd,
    );
    expect(playReviewCriticSection).toContain("subagent-lifecycle");
    expect(playReviewCriticSection).toContain(
      "Before spawning the critic agent, run the `subagent-lifecycle` cleanup gate",
    );
    expect(playReviewCriticSection).toContain("critic report");
    expect(playReviewCriticSection).toContain("verdicts");

    const playPlanningReviewStart = playPlanningBody.indexOf("## Plan Review");
    const playPlanningReviewEnd = playPlanningBody.indexOf(
      "## Execution Handoff",
    );
    expect(playPlanningReviewStart).toBeGreaterThanOrEqual(0);
    expect(playPlanningReviewEnd).toBeGreaterThan(playPlanningReviewStart);
    const playPlanningReviewSection = playPlanningBody.slice(
      playPlanningReviewStart,
      playPlanningReviewEnd,
    );
    expectSharedLifecycleReference(
      playPlanningReviewSection,
      "play-planning Plan Review",
    );
    expect(playPlanningReviewSection).toContain(
      "Before dispatching the plan-review agent",
    );
    expect(playPlanningReviewSection).toContain("PASS/FAIL result");
    expect(playPlanningReviewSection).toContain("specific gaps");

    const playAgentDispatchStart = playAgentDispatchBody.indexOf(
      "### 3. Dispatch in Parallel",
    );
    const playAgentDispatchEnd = playAgentDispatchBody.indexOf(
      "## Agent Prompt Structure",
    );
    expect(playAgentDispatchStart).toBeGreaterThanOrEqual(0);
    expect(playAgentDispatchEnd).toBeGreaterThan(playAgentDispatchStart);
    const playAgentDispatchSection = playAgentDispatchBody.slice(
      playAgentDispatchStart,
      playAgentDispatchEnd,
    );
    const normalizedPlayAgentDispatchSection = normalizeWhitespace(
      playAgentDispatchSection,
    );
    expectSharedLifecycleReference(
      playAgentDispatchSection,
      "play-agent-dispatch parallel dispatch",
    );
    expect(playAgentDispatchSection).toContain("Before parallel dispatch");
    expect(playAgentDispatchSection).toContain(
      "one pending ledger row per planned agent",
    );
    expect(normalizedPlayAgentDispatchSection).toContain(
      "Update the `subagent-lifecycle` ledger with each returned session's role-specific state before closing or superseding it",
    );
    expect(normalizedPlayAgentDispatchSection).toContain(
      "After each returned session is integrated, run the `subagent-lifecycle` cleanup gate before keeping or spawning any additional agent sessions",
    );

    const playSkillAuthoringStart =
      playSkillAuthoringBody.indexOf("## Overview");
    const playSkillAuthoringEnd = playSkillAuthoringBody.indexOf(
      "## What is a Skill?",
    );
    expect(playSkillAuthoringStart).toBeGreaterThanOrEqual(0);
    expect(playSkillAuthoringEnd).toBeGreaterThan(playSkillAuthoringStart);
    const playSkillAuthoringSection = playSkillAuthoringBody.slice(
      playSkillAuthoringStart,
      playSkillAuthoringEnd,
    );
    const normalizedPlaySkillAuthoringSection = normalizeWhitespace(
      playSkillAuthoringSection,
    );
    expectSharedLifecycleReference(
      playSkillAuthoringSection,
      "play-skill-authoring pressure scenarios",
    );
    expect(normalizedPlaySkillAuthoringSection).toContain(
      "When dispatching pressure-scenario subagents",
    );
    expect(normalizedPlaySkillAuthoringSection).toContain(
      "Capture each pressure-scenario subagent's prompt, baseline/pass result, observed rationalizations, and pressure conditions before closing or superseding the session",
    );

    const prMergeInvestigationStart = prMergeBody.indexOf(
      "### 4b. Dispatch investigation agent",
    );
    const prMergeInvestigationEnd = prMergeBody.indexOf(
      '### 4c. "In scope" definition',
    );
    expect(prMergeInvestigationStart).toBeGreaterThanOrEqual(0);
    expect(prMergeInvestigationEnd).toBeGreaterThan(prMergeInvestigationStart);
    const prMergeInvestigationSection = prMergeBody.slice(
      prMergeInvestigationStart,
      prMergeInvestigationEnd,
    );
    const normalizedPrMergeInvestigationSection = normalizeWhitespace(
      prMergeInvestigationSection,
    );
    expectSharedLifecycleReference(
      prMergeInvestigationSection,
      "pr-merge CI investigation",
    );
    expect(prMergeInvestigationSection).toContain(
      "Before dispatching the CI investigation agent",
    );
    expect(prMergeInvestigationSection).toContain("CI run/check identifiers");
    expect(normalizedPrMergeInvestigationSection).toContain(
      "in-scope/out-of-scope classification",
    );
  });
});
