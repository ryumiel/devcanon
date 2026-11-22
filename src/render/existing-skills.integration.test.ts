import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { providerFromRuntimeFixture } from "../__test-helpers__/fixtures.js";
import {
  getSkillOutput,
  listRelativeFiles,
  parseRenderedYamlArtifact,
} from "../__test-helpers__/render.js";
import { loadConfig } from "../config/load.js";
import type { SkillSource } from "../config/schema.js";
import { pathExists } from "../utils/fs.js";
import { parseFrontmatter } from "./frontmatter.js";
import { renderAll as renderAllWithProvider } from "./pipeline.js";
import { buildGlossary, resolvePlaceholders } from "./placeholders.js";

const TARGETS = ["claude", "codex"] as const;
const FIXED_ROUTE_OWNER_CONTRACT = [
  ["issue-gate-assessment", "issue-priming-workflow"],
  ["internal-research", "issue-priming-workflow"],
  ["external-research", "issue-priming-workflow"],
  ["focused-specialist-dispatch", "play-agent-dispatch"],
  ["combined-planning-review", "play-planning"],
  ["independent-review", "play-review"],
  ["targeted-verification", "play-review"],
  ["skill-pressure-scenario", "play-skill-authoring"],
  ["default-implementation", "play-subagent-execution"],
  ["exact-task-execution", "play-subagent-execution"],
  ["task-spec-review", "play-subagent-execution"],
  ["task-quality-review", "play-subagent-execution"],
  ["whole-implementation-quality-review", "play-subagent-execution"],
  ["ci-diagnosis-and-fix", "pr-merge"],
  ["semantic-review-context", "play-review"],
] as const;
const ROUTE_OWNER_SKILLS = [
  "issue-priming-workflow",
  "play-agent-dispatch",
  "play-planning",
  "play-review",
  "play-skill-authoring",
  "play-subagent-execution",
  "pr-merge",
] as const;

async function renderAll(
  config: Awaited<ReturnType<typeof loadConfig>>,
  writeToGenerated = true,
  strict = false,
  targetFilter?: "claude" | "codex",
) {
  return renderAllWithProvider(
    config,
    await providerFromRuntimeFixture(
      path.join(config.library.skillsDir, "devcanon-runtime"),
    ),
    writeToGenerated,
    strict,
    targetFilter,
  );
}

const reviewerSource = parseYaml(
  await readFile(path.join(process.cwd(), "agents/reviewer.yaml"), "utf8"),
);
const reviewerModel: string = reviewerSource.codex.model;

const shippedSkillsConfig = await loadConfig(
  path.join(process.cwd(), "devcanon.config.yaml"),
);
const shippedSkillsRender = await renderAll(shippedSkillsConfig, false, true);

function normalizeContractText(content: string): string {
  return content.replace(/\s+/gu, " ").trim();
}

function expectNoForbiddenRouteModelTokens(content: string): void {
  expect(content).not.toContain("devcanon.config.yaml");
  expect(content).not.toContain("capabilityProfiles.");
  expect(content).not.toMatch(/\{\{model(?:-codex)?:/u);
  expect(content).not.toMatch(/model\s*[=:]\s*capabilityProfiles\.[\w.]+/u);
}

function expectedMirroredBytes(
  subdir: string,
  relativeFile: string,
  source: Buffer,
): Buffer {
  if (subdir !== "scripts" || !relativeFile.endsWith(".sh")) {
    return source;
  }

  const normalized: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === 13 && source[index + 1] === 10) {
      normalized.push(10);
      index += 1;
    } else {
      normalized.push(source[index]);
    }
  }
  return Buffer.from(normalized);
}

function expectedFrontmatter(
  source: SkillSource,
  target: (typeof TARGETS)[number],
  config: Awaited<ReturnType<typeof loadConfig>>,
): Record<string, unknown> {
  const expected: Record<string, unknown> = {
    name: source.name,
    description: source.description,
  };
  if (source["allowed-tools"] !== undefined) {
    expected["allowed-tools"] = Array.isArray(source["allowed-tools"])
      ? source["allowed-tools"].join(" ")
      : source["allowed-tools"];
  }

  const targetOverrides = source[target];
  if (targetOverrides === undefined) return expected;

  const glossary = buildGlossary(config);
  for (const [key, value] of Object.entries(targetOverrides)) {
    expected[key] =
      typeof value === "string"
        ? resolvePlaceholders(value, target, glossary, {
            skillName: source.name,
            target,
          })
        : value;
  }
  return expected;
}

function expectSidecarParity(
  rendered: Record<string, unknown>,
  source: SkillSource,
  suffix: string | undefined,
): void {
  const sourceSidecar = source.codex_sidecar;
  const normalizedSuffix = suffix?.trim();
  if (!normalizedSuffix) {
    expect(rendered).toEqual(sourceSidecar);
    return;
  }

  const formattedSuffix = ` (${normalizedSuffix})`;
  const renderedInterface = rendered.interface as
    | Record<string, unknown>
    | undefined;
  expect(renderedInterface?.display_name).toEqual(expect.any(String));
  expect(String(renderedInterface?.display_name)).toSatisfy((displayName) =>
    displayName.endsWith(formattedSuffix),
  );

  if (sourceSidecar?.interface !== undefined) {
    const { display_name: sourceDisplayName, ...sourceInterface } =
      sourceSidecar.interface;
    expect(renderedInterface).toMatchObject(sourceInterface);
    if (sourceDisplayName !== undefined) {
      expect(String(renderedInterface?.display_name)).toSatisfy(
        (displayName) =>
          displayName === sourceDisplayName ||
          displayName === `${sourceDisplayName}${formattedSuffix}`,
      );
    }
  }
  expect(rendered.policy).toEqual(sourceSidecar?.policy);
  expect(rendered.dependencies).toEqual(sourceSidecar?.dependencies);
}

describe("shipped skill rendering", () => {
  it("renders Node-first issue-priming helper calls for both targets", async () => {
    const generatedDir = await mkdtemp(
      path.join(tmpdir(), "devcanon-issue-priming-helpers-"),
    );
    const config = shippedSkillsConfig;
    const helpers = [
      ["phase-artifacts", "SKILL.md"],
      ["source-immutability", "SKILL.md"],
      ["write-research-brief", "references/phase-3-research-controller.md"],
      ["write-auto-handoff", "references/reviewed-plan.md"],
      ["write-assumptions-comment", "SKILL.md"],
    ] as const;

    try {
      await renderAll(
        { ...config, library: { ...config.library, generatedDir } },
        true,
        true,
      );
      for (const target of TARGETS) {
        for (const [helper, owner] of helpers) {
          const body = await readFile(
            path.join(
              generatedDir,
              target,
              "skills",
              "issue-priming-workflow",
              owner,
            ),
            "utf8",
          );
          expect(body).toContain(`${helper}.mjs`);
          expect(body).not.toMatch(
            new RegExp(`bash [^\n]*${helper}\\.sh`, "u"),
          );
        }
      }
    } finally {
      await rm(generatedDir, { recursive: true, force: true });
    }
  });

  it("materializes capability bindings and explicit Codex role overrides under custom profiles", async () => {
    const config = await loadConfig("devcanon.config.yaml");
    config.capabilityProfiles.balanced.codex = "custom-balanced-model";
    config.capabilityProfiles.frontier.codex = "custom-frontier-model";
    const { outputs } = await renderAll(config, false, true);
    const bindings = [
      ["issue-priming-workflow", "ISSUE_GATE_ASSESSMENT_MODEL", "balanced"],
      ["issue-priming-workflow", "INTERNAL_RESEARCH_MODEL", "balanced"],
      ["issue-priming-workflow", "EXTERNAL_RESEARCH_MODEL", "balanced"],
      ["play-planning", "COMBINED_PLANNING_REVIEW_MODEL", "frontier"],
      ["play-review", "INDEPENDENT_REVIEW_MODEL", "frontier"],
      ["play-review", "TARGETED_VERIFICATION_MODEL", "frontier"],
      ["play-skill-authoring", "SKILL_PRESSURE_SCENARIO_MODEL", "balanced"],
      ["play-subagent-execution", "DEFAULT_IMPLEMENTATION_MODEL", "balanced"],
      ["play-subagent-execution", "EXACT_TASK_EXECUTION_MODEL", "efficient"],
      ["play-subagent-execution", "TASK_SPEC_REVIEW_MODEL", "frontier"],
      ["play-subagent-execution", "TASK_QUALITY_REVIEW_MODEL", "frontier"],
      [
        "play-subagent-execution",
        "WHOLE_IMPLEMENTATION_QUALITY_REVIEW_MODEL",
        "frontier",
      ],
      ["pr-merge", "CI_DIAGNOSIS_MODEL", "balanced"],
      ["pr-merge", "CI_EXACT_FIX_MODEL", "efficient"],
      ["pr-merge", "CI_JUDGMENT_FIX_MODEL", "balanced"],
      ["play-review", "SEMANTIC_REVIEW_CONTEXT_MODEL", "balanced"],
    ] as const;

    for (const [skill, binding, capability] of bindings) {
      for (const target of TARGETS) {
        const { body } = parseFrontmatter(
          getSkillOutput(outputs, skill, target).content,
        );
        const normalizedBody = normalizeContractText(body);
        const usesReviewerOverride = [
          "COMBINED_PLANNING_REVIEW_MODEL",
          "INDEPENDENT_REVIEW_MODEL",
          "TARGETED_VERIFICATION_MODEL",
          "TASK_SPEC_REVIEW_MODEL",
          "TASK_QUALITY_REVIEW_MODEL",
          "WHOLE_IMPLEMENTATION_QUALITY_REVIEW_MODEL",
        ].includes(binding);
        const configuredModel = usesReviewerOverride
          ? reviewerModel
          : ["DEFAULT_IMPLEMENTATION_MODEL", "CI_JUDGMENT_FIX_MODEL"].includes(
                binding,
              )
            ? "gpt-6.1-terra"
            : config.capabilityProfiles[capability].codex;

        expect(normalizedBody).toContain(
          usesReviewerOverride
            ? `${binding} = "${configuredModel}"`
            : `\`${binding}\` = \`${configuredModel}\``,
        );
        expect(normalizedBody).not.toContain(
          `\`${binding}\` resolves to \`${config.capabilityProfiles[capability].claude}\``,
        );
      }
    }

    for (const target of TARGETS) {
      const { body } = parseFrontmatter(
        getSkillOutput(outputs, "play-agent-dispatch", target).content,
      );
      const normalizedBody = normalizeContractText(body);
      expect(normalizedBody).toContain("Codex-bound model bindings");
      expect(body).toContain(`reviewer Codex model = "${reviewerModel}"`);
      expect(body).toContain(
        `model = "${reviewerModel}"\nreasoning_effort = "high"`,
      );
      for (const capability of ["efficient", "balanced", "frontier"] as const) {
        expect(normalizedBody).toContain(
          `\`${capability}\` → \`${config.capabilityProfiles[capability].codex}\``,
        );
        expect(normalizedBody).not.toContain(
          `\`${capability}\` → \`${config.capabilityProfiles[capability].claude}\``,
        );
      }
    }
  });

  it("renders event-driven batch startup for both targets", () => {
    const { outputs } = shippedSkillsRender;
    for (const target of TARGETS) {
      const { content } = getSkillOutput(
        outputs,
        "issue-batch-coordination",
        target,
      );
      expect(content).toContain("(references/github-push.md)");
      expect(content).not.toContain("WATCHER_MODEL");
    }
  });

  it("keeps rendered workflow model consumers bound to their owner-supplied models", async () => {
    const config = await loadConfig(
      path.join(process.cwd(), "devcanon.config.yaml"),
    );
    const generatedDir = await mkdtemp(
      path.join(tmpdir(), "devcanon-rendered-route-models-"),
    );
    const referenceContracts = [
      {
        path: "play-review/references/reviewer-routing-policy.md",
        bindings: ["INDEPENDENT_REVIEW_MODEL", "TARGETED_VERIFICATION_MODEL"],
        failClosed:
          "missing or mismatched bindings block before capture without substitution.",
      },
      {
        path: "play-subagent-execution/references/implementer-prompt.md",
        bindings: ["DEFAULT_IMPLEMENTATION_MODEL"],
        failClosed:
          "A missing, blank, unresolved, or mismatched binding blocks before capture or spawn; do not locate a source checkout or use an alias, nearby, or ambient model.",
      },
      {
        path: "play-subagent-execution/references/executor-prompt.md",
        bindings: ["EXACT_TASK_EXECUTION_MODEL"],
        failClosed:
          "A missing, blank, unresolved, or mismatched binding blocks before capture or spawn; do not locate a source checkout or use an alias, nearby, or ambient model.",
      },
      {
        path: "play-subagent-execution/references/spec-reviewer-prompt.md",
        bindings: ["TASK_SPEC_REVIEW_MODEL"],
        failClosed:
          "A missing, blank, unresolved, or mismatched binding blocks before capture or spawn; do not locate a source checkout or use an alias, nearby, or ambient model.",
      },
      {
        path: "play-subagent-execution/references/code-quality-reviewer-prompt.md",
        bindings: [
          "TASK_QUALITY_REVIEW_MODEL",
          "WHOLE_IMPLEMENTATION_QUALITY_REVIEW_MODEL",
        ],
        failClosed:
          "A missing, blank, unresolved, or mismatched binding blocks before capture or spawn; do not locate a source checkout or use an alias, nearby, or ambient model.",
      },
      {
        path: "play-subagent-execution/references/example-workflow.md",
        bindings: [
          "DEFAULT_IMPLEMENTATION_MODEL",
          "EXACT_TASK_EXECUTION_MODEL",
          "TASK_SPEC_REVIEW_MODEL",
          "TASK_QUALITY_REVIEW_MODEL",
          "WHOLE_IMPLEMENTATION_QUALITY_REVIEW_MODEL",
        ],
        failClosed:
          "A missing, blank, unresolved, or mismatched binding blocks before capture or spawn; do not locate a source checkout or use an alias, nearby, or ambient model.",
      },
    ] as const;

    try {
      const { outputs } = await renderAll(
        {
          ...config,
          library: { ...config.library, generatedDir },
        },
        true,
        true,
      );

      for (const target of TARGETS) {
        const bundleFiles = await Promise.all(
          ROUTE_OWNER_SKILLS.map(async (skill) => {
            const root = path.join(generatedDir, target, "skills", skill);
            const files = await listRelativeFiles(root);
            return Promise.all(
              files
                .filter((file) => file.endsWith(".md"))
                .map(
                  async (file) =>
                    [
                      `${skill}/${file}`,
                      await readFile(path.join(root, file), "utf8"),
                    ] as const,
                ),
            );
          }),
        );
        const renderedFiles = new Map<string, string>(bundleFiles.flat());
        for (const [id, owner] of FIXED_ROUTE_OWNER_CONTRACT) {
          expect(
            renderedFiles.get(`${owner}/SKILL.md`),
            `${target} ${id} resolves in its owner ${owner}`,
          ).toContain(`\`${id}\``);
        }

        for (const [file, content] of renderedFiles) {
          expectNoForbiddenRouteModelTokens(content);
        }

        for (const reference of referenceContracts) {
          const content = renderedFiles.get(reference.path);
          expect(
            content,
            `${target} ${reference.path} is rendered`,
          ).toBeDefined();
          const normalized = normalizeContractText(content ?? "");
          expect(normalized).toContain(reference.failClosed);
          for (const binding of reference.bindings) {
            expect(content).toMatch(
              new RegExp(`already-rendered\\s+\`${binding}\``, "u"),
            );
          }
        }
      }
    } finally {
      await rm(generatedDir, { recursive: true, force: true });
    }
  });

  it("renders ordinary reviewer routes at Sol/high with explicit Claude compatibility", async () => {
    const { outputs } = shippedSkillsRender;
    const targetedVerificationSpawn = [
      "Codex.spawn_agent({",
      "  task_name: targeted_verification_<instance_ordinal>,",
      '  agent_type: "reviewer",',
      "  model: TARGETED_VERIFICATION_MODEL,",
      '  reasoning_effort: "high",',
      '  fork_turns: "none",',
      "  message: TARGETED_VERIFICATION_CRITIC_PROMPT,",
      "})",
    ].join("\n");
    const ordinarySpawns = [
      [
        "play-planning",
        [
          "Codex.spawn_agent({",
          "  task_name: combined_planning_review_<instance_ordinal>,",
          '  agent_type: "reviewer",',
          "  model: COMBINED_PLANNING_REVIEW_MODEL,",
          '  reasoning_effort: "high",',
          '  fork_turns: "none",',
          "  message: COMBINED_PLANNING_REVIEW_PLAN_REVIEW_PROMPT,",
          "})",
        ].join("\n"),
      ],
      [
        "play-review",
        [
          "Codex.spawn_agent({",
          "  task_name: independent_review_<instance_ordinal>,",
          '  agent_type: "reviewer",',
          "  model: INDEPENDENT_REVIEW_MODEL,",
          '  reasoning_effort: "high",',
          '  fork_turns: "none",',
          "  message: INDEPENDENT_REVIEW_PROMPT,",
          "})",
        ].join("\n"),
      ],
    ] as const;

    for (const target of TARGETS) {
      const { body: playReview } = parseFrontmatter(
        getSkillOutput(outputs, "play-review", target).content,
      );
      expect(playReview).toContain(
        "fresh, independent response-only targeted verifier",
      );
      expect(playReview).toContain("D8 and D9 are retired");
      expect(playReview).not.toContain("model: D8_MODEL");
      expect(playReview).not.toContain("model: D9_MODEL");
      expect(playReview).toContain(targetedVerificationSpawn);
      expect(playReview).toContain(reviewerModel);
      expect(playReview).not.toContain(
        "Targeted verification is one response-only `deep-reviewer`, frontier/high",
      );
      expect(playReview).not.toContain(
        "`semantic_role: deep-reviewer`; `capability: frontier`",
      );

      for (const [skill, spawn] of ordinarySpawns) {
        const { body } = parseFrontmatter(
          getSkillOutput(outputs, skill, target).content,
        );
        expect(body).toContain(spawn);
        expect(body).toContain(reviewerModel);
      }

      const { body: planning } = parseFrontmatter(
        getSkillOutput(outputs, "play-planning", target).content,
      );
      const activeCombined = planning.slice(
        planning.lastIndexOf(
          "## Exact Digest and Combined Review Orchestration",
        ),
      );
      expect(activeCombined).toContain("planning-review/combined-v1");
      expect(activeCombined).not.toContain("D6_EXECUTABILITY_REVIEW_PROMPT");

      const { body: execution } = parseFrontmatter(
        getSkillOutput(outputs, "play-subagent-execution", target).content,
      );
      expect(execution).toContain("Claude instead");
      expect(execution).toContain(
        "retains `deep-reviewer`, frontier capability and its catalog Claude effort",
      );
      expect(execution).toContain("gpt-6.1-terra");
      for (const [id, displayName] of [
        ["task-spec-review", "Task specification review"],
        ["task-quality-review", "Task quality review"],
        [
          "whole-implementation-quality-review",
          "Whole-implementation quality review",
        ],
      ]) {
        const taskPrefix = id.replaceAll("-", "_");
        const binding = taskPrefix.toUpperCase();
        expect(execution).toContain(
          [
            `# ${displayName}: ${binding}_MODEL is the literal Codex reviewer override`,
            "Codex.spawn_agent({",
            `  task_name: ${taskPrefix}_<instance_ordinal>,`,
            '  agent_type: "reviewer",',
            `  model: ${binding}_MODEL,`,
            '  reasoning_effort: "high",',
            '  fork_turns: "none",',
            `  message: ${binding}_SELF_CONTAINED_PROMPT,`,
            "})",
          ].join("\n"),
        );
      }
    }
  });

  it("keeps Terra implementation overrides when the balanced model changes", async () => {
    const config = await loadConfig("devcanon.config.yaml", true);
    config.capabilityProfiles.balanced.codex = "custom-balanced-model";
    const { outputs } = await renderAll(config, false, true);
    for (const target of TARGETS) {
      const execution = normalizeContractText(
        getSkillOutput(outputs, "play-subagent-execution", target).content,
      );
      const merge = normalizeContractText(
        getSkillOutput(outputs, "pr-merge", target).content,
      );
      const research = normalizeContractText(
        getSkillOutput(outputs, "issue-priming-workflow", target).content,
      );
      const dispatch = normalizeContractText(
        getSkillOutput(outputs, "play-agent-dispatch", target).content,
      );
      expect(execution).toContain(
        "`DEFAULT_IMPLEMENTATION_MODEL` = `gpt-6.1-terra`",
      );
      expect(merge).toContain("`CI_JUDGMENT_FIX_MODEL` = `gpt-6.1-terra`");
      expect(research).toContain(
        "`INTERNAL_RESEARCH_MODEL` = `custom-balanced-model`",
      );
      expect(dispatch).toContain(
        "For `implementer`, select `gpt-6.1-terra` instead of the balanced binding",
      );
      expect(dispatch).toContain(
        "On Claude, reject `architect` selection before capture or spawn",
      );
      expect(dispatch).toContain(
        "A missing, blank, unresolved, or mismatched binding blocks before spawn",
      );
      const repairs = getSkillOutput(
        outputs,
        "play-review-response",
        target,
      ).content;
      expect(repairs).toContain("`gpt-6.1-terra`/`medium`");
    }
    const implementer = outputs.find(
      (output) =>
        output.type === "agent" &&
        output.name === "implementer" &&
        output.target === "codex",
    );
    expect(implementer?.content).toContain('model = "gpt-6.1-terra"');
    expect(implementer?.content).not.toContain("custom-balanced-model");
  });

  it("renders the semantic review context route for both targets", async () => {
    const config = shippedSkillsConfig;
    const { outputs } = shippedSkillsRender;
    const semanticReviewContextSpawn = [
      "Codex.spawn_agent({",
      "  task_name: semantic_review_context_<instance_ordinal>,",
      '  agent_type: "assessor",',
      "  model: SEMANTIC_REVIEW_CONTEXT_MODEL,",
      '  reasoning_effort: "low",',
      '  fork_turns: "none",',
      "  message: SEMANTIC_REVIEW_CONTEXT_PROMPT,",
      "})",
    ].join("\n");

    for (const target of TARGETS) {
      const { body } = parseFrontmatter(
        getSkillOutput(outputs, "play-review", target).content,
      );

      expect(body).toContain(semanticReviewContextSpawn);
      expect(body).toContain(config.capabilityProfiles.balanced.codex);
    }
  });

  it("preserves the pr-review scope notice before play-review for both targets", async () => {
    const config = shippedSkillsConfig;
    const { outputs } = shippedSkillsRender;
    const scopeNotice =
      "PR review scope: mode=..., selection=..., selected files=.... Review is continuing.";

    for (const target of TARGETS) {
      const { body } = parseFrontmatter(
        getSkillOutput(outputs, "pr-review", target).content,
      );
      const phase4 = body.indexOf("## Phase 4: Run play-review");
      const handoffValidation = body.indexOf(
        'bash "$PR_REVIEW_MANIFEST_HELPER" validate-handoff || exit 1',
        phase4,
      );
      const headValidation = body.indexOf(
        'echo "review worktree HEAD changed since handoff; refusing stale review" >&2',
        handoffValidation,
      );
      const notice = body.indexOf(scopeNotice, phase4);
      const noticeConsumer = body.indexOf(
        'bash "$PR_REVIEW_ARTIFACT_HELPER" render-scope-notice || exit 1',
        headValidation,
      );
      const playReview = body.indexOf(
        "Hand off to `play-review`",
        noticeConsumer,
      );

      expect(phase4).toBeGreaterThan(-1);
      expect(handoffValidation).toBeGreaterThan(phase4);
      expect(headValidation).toBeGreaterThan(handoffValidation);
      expect(notice).toBeGreaterThan(phase4);
      expect(noticeConsumer).toBeGreaterThan(headValidation);
      expect(playReview).toBeGreaterThan(noticeConsumer);
    }
  });

  it("links the conditional priming procedures and packages them for both targets", async () => {
    const generatedDir = await mkdtemp(
      path.join(tmpdir(), "devcanon-issue-priming-procedures-"),
    );
    const config = shippedSkillsConfig;
    const procedures = [
      ["phase-2-complexity-gate.md", "# Phase 2 Complexity Gate Procedure", ""],
      [
        "phase-3-research-controller.md",
        "# Phase 3 Research Controller Procedure",
        "",
      ],
      [
        "reviewed-plan.md",
        "## Phase 4: Invoke Brainstorming",
        "#phase-4-invoke-brainstorming",
      ],
      [
        "reviewed-plan.md",
        "## Phase 5: Write Plan (reviewed-plan route)",
        "#phase-5-write-plan-reviewed-plan-route",
      ],
      [
        "reviewed-plan.md",
        "## Phase 6: Implement (reviewed-plan route)",
        "#phase-6-implement-reviewed-plan-route",
      ],
      ["requested-run-assessments.md", "# Requested Run Assessments", ""],
      ["batch-owner-recovery.md", "# Interrupted Batch Owner Recovery", ""],
    ] as const;

    try {
      const { outputs } = await renderAll(
        { ...config, library: { ...config.library, generatedDir } },
        true,
        true,
      );
      const skill = "issue-priming-workflow";
      for (const target of TARGETS) {
        const entry = getSkillOutput(outputs, skill, target).content;
        const firstSpecialistPhase = entry.indexOf(
          "## Phase 2: Complexity Gate",
        );
        expect(firstSpecialistPhase).toBeGreaterThan(
          entry.indexOf("### Phase 8: Create PR"),
        );
        const commonPath = entry.slice(0, firstSpecialistPhase);
        for (const [file, heading, anchor] of procedures) {
          const reference = `references/${file}`;
          expect(entry).toContain(`](${reference}${anchor})`);
          expect(commonPath).not.toContain(`](${reference}${anchor})`);
          const [source, installed] = await Promise.all([
            readFile(
              path.join(config.library.skillsDir, skill, reference),
              "utf8",
            ),
            readFile(
              path.join(generatedDir, target, "skills", skill, reference),
              "utf8",
            ),
          ]);
          expect(source).toContain(heading);
          expect(installed).toBe(source);
        }
      }
    } finally {
      await rm(generatedDir, { recursive: true, force: true });
    }
  });

  it("packages inline consumers and delegated repair tokens for both targets", async () => {
    const config = await loadConfig("devcanon.config.yaml", true);
    config.capabilityProfiles.balanced.codex = "custom-balanced-model";
    const generatedDir = await mkdtemp(
      path.join(tmpdir(), "devcanon-inline-allocation-"),
    );
    try {
      const { outputs } = await renderAll(
        { ...config, library: { ...config.library, generatedDir } },
        true,
        true,
      );
      const repairSource = await readFile(
        "skills/branch-review/references/fix-disposition.md",
        "utf8",
      );
      for (const target of TARGETS) {
        for (const name of ["issue-priming-workflow", "play-review-response"]) {
          const output = getSkillOutput(outputs, name, target);
          const packaged = await readFile(
            path.join(generatedDir, target, "skills", name, "SKILL.md"),
            "utf8",
          );
          expect(packaged).toBe(output.content);
          expect(parseFrontmatter(packaged).frontmatter.name).toBe(name);
        }
        const repair = await readFile(
          path.join(
            generatedDir,
            target,
            "skills/branch-review/references/fix-disposition.md",
          ),
          "utf8",
        );
        expect(repair).toBe(repairSource);
        expect(repair).toContain("focused specialist dispatch `implementer`");
        expect(repair).toContain("`gpt-6.1-terra`/`medium`");
        expect(repair).not.toContain("custom-balanced-model");
        const response = getSkillOutput(
          outputs,
          "play-review-response",
          target,
        ).content;
        expect(response).toContain(
          "focused specialist dispatch or default implementation",
        );
        expect(response).toContain("`gpt-6.1-terra`/`medium`");
      }
    } finally {
      await rm(generatedDir, { recursive: true, force: true });
    }
  });

  it("keeps conditional branch-review fix disposition linked and packaged for both targets", async () => {
    const config = shippedSkillsConfig;
    const { outputs, skills } = shippedSkillsRender;
    const workflow = skills.find((skill) => skill.name === "branch-review");
    const reference = "references/fix-disposition.md";

    expect(workflow).toBeDefined();
    expect(workflow?.subdirs).toContain("references");
    expect(
      await pathExists(path.join(workflow?.dirPath ?? "", reference)),
    ).toBe(true);

    for (const target of TARGETS) {
      const { body } = parseFrontmatter(
        getSkillOutput(outputs, "branch-review", target).content,
      );
      expect(body).toContain(
        "[`references/fix-disposition.md`](references/fix-disposition.md)",
      );
    }
  });

  it("packages the authorized ordinary blocker repair policy for both targets", async () => {
    const config = await loadConfig(
      path.join(process.cwd(), "devcanon.config.yaml"),
    );
    const generatedDir = await mkdtemp(
      path.join(tmpdir(), "devcanon-authorized-repairs-"),
    );

    try {
      const { outputs } = await renderAll(
        {
          ...config,
          library: { ...config.library, generatedDir },
        },
        true,
        true,
      );

      for (const target of TARGETS) {
        const contract = normalizeContractText(
          await readFile(
            path.join(
              generatedDir,
              target,
              "skills",
              "play-review",
              "references",
              "single-reviewer-contract.md",
            ),
            "utf8",
          ),
        );
        const branchReview = normalizeContractText(
          getSkillOutput(outputs, "branch-review", target).content,
        );
        const phaseSeven = normalizeContractText(
          getSkillOutput(outputs, "issue-priming-workflow", target).content,
        );

        expect(contract).toContain(
          "current fresh supported ordinary blocker with selection none",
        );
        expect(contract).toContain(
          "current implementation authority covering the exact bounded repair",
        );
        expect(branchReview).toContain(
          "ordinary undisputed supported blocker with selection `none`",
        );
        expect(branchReview).toContain(
          "current implementation authority covers the exact bounded repair",
        );
        expect(branchReview).toContain(
          "Both paths require current implementation authority covering the exact bounded repair",
        );
        expect(branchReview).toContain(
          "whether ordinary with `critic: null` or selected with its required critic verdict",
        );
        expect(phaseSeven).toContain(
          "ordinary blockers may qualify under the shared review contract",
        );
      }
    } finally {
      await rm(generatedDir, { recursive: true, force: true });
    }
  });

  it("renders every validated source skill once for each enabled target", async () => {
    const config = shippedSkillsConfig;
    const { outputs, skills } = shippedSkillsRender;
    const skillOutputs = outputs.filter((output) => output.type === "skill");

    expect(skillOutputs).toHaveLength((skills.length + 1) * TARGETS.length);

    for (const skill of skills) {
      for (const target of TARGETS) {
        const output = getSkillOutput(outputs, skill.name, target);
        const { frontmatter, body } = parseFrontmatter(output.content);

        expect(frontmatter).toEqual(
          expectedFrontmatter(skill.source, target, config),
        );
        expect(body.trim()).not.toHaveLength(0);
        expect(output.content).not.toContain("{{model:");
      }
    }
  });

  it("preserves supporting files except for packaged shell LF normalization", async () => {
    const config = await loadConfig(
      path.join(process.cwd(), "devcanon.config.yaml"),
    );
    const generatedDir = await mkdtemp(
      path.join(tmpdir(), "devcanon-shipped-skills-"),
    );

    try {
      const result = await renderAll(
        {
          ...config,
          library: { ...config.library, generatedDir },
        },
        true,
        true,
      );

      for (const skill of result.skills) {
        const sidecarPath = path.join(
          generatedDir,
          "codex",
          "skills",
          skill.name,
          "agents",
          "openai.yaml",
        );
        const shouldRenderSidecar =
          skill.source.codex_sidecar !== undefined ||
          config.targets.codex.skillDisplayNameSuffix !== undefined;
        expect(await pathExists(sidecarPath)).toBe(shouldRenderSidecar);
        if (shouldRenderSidecar) {
          expectSidecarParity(
            parseRenderedYamlArtifact(await readFile(sidecarPath, "utf8")),
            skill.source,
            config.targets.codex.skillDisplayNameSuffix,
          );
        }

        for (const subdir of skill.subdirs) {
          const sourceRoot = path.join(skill.dirPath, subdir);
          const relativeFiles = await listRelativeFiles(sourceRoot);

          for (const target of TARGETS) {
            const renderedRoot = path.join(
              generatedDir,
              target,
              "skills",
              skill.name,
              subdir,
            );
            expect(await listRelativeFiles(renderedRoot)).toEqual(
              relativeFiles,
            );

            for (const relativeFile of relativeFiles) {
              const [source, rendered] = await Promise.all([
                readFile(path.join(sourceRoot, relativeFile)),
                readFile(path.join(renderedRoot, relativeFile)),
              ]);
              expect(rendered).toEqual(
                expectedMirroredBytes(subdir, relativeFile, source),
              );
            }
          }
        }
      }
    } finally {
      await rm(generatedDir, { recursive: true, force: true });
    }
  }, 30_000);
});
