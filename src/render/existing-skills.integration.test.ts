import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getSkillOutput,
  listRelativeFiles,
  parseRenderedYamlArtifact,
} from "../__test-helpers__/render.js";
import { loadConfig } from "../config/load.js";
import type { SkillSource } from "../config/schema.js";
import { pathExists } from "../utils/fs.js";
import { parseFrontmatter } from "./frontmatter.js";
import { renderAll } from "./pipeline.js";
import { buildGlossary, resolvePlaceholders } from "./placeholders.js";

const TARGETS = ["claude", "codex"] as const;

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
  it("materializes every D1-D18 route model binding from the configured capability", async () => {
    const config = await loadConfig(
      path.join(process.cwd(), "devcanon.config.yaml"),
    );
    const { outputs } = await renderAll(config, false, true);
    const bindings = [
      ["issue-priming-workflow", "D1_MODEL", "balanced"],
      ["issue-priming-workflow", "D2_MODEL", "balanced"],
      ["issue-priming-workflow", "D3_MODEL", "balanced"],
      ["play-planning", "D5_MODEL", "frontier"],
      ["play-planning", "D6_MODEL", "frontier"],
      ["play-review", "D7_MODEL", "frontier"],
      ["play-review", "D8_MODEL", "frontier"],
      ["play-review", "D9_MODEL", "frontier"],
      ["play-review", "D10_MODEL", "frontier"],
      ["play-skill-authoring", "D11_MODEL", "balanced"],
      ["play-subagent-execution", "D12_MODEL", "balanced"],
      ["play-subagent-execution", "D13_MODEL", "efficient"],
      ["play-subagent-execution", "D14_MODEL", "frontier"],
      ["play-subagent-execution", "D15_MODEL", "frontier"],
      ["play-subagent-execution", "D16_MODEL", "frontier"],
      ["pr-merge", "D17_DIAGNOSIS_MODEL", "balanced"],
      ["pr-merge", "D17_EXACT_FIX_MODEL", "efficient"],
      ["pr-merge", "D17_JUDGMENT_FIX_MODEL", "balanced"],
      ["play-review", "D18_MODEL", "balanced"],
    ] as const;

    for (const [skill, binding, capability] of bindings) {
      for (const target of TARGETS) {
        const { body } = parseFrontmatter(
          getSkillOutput(outputs, skill, target).content,
        );
        const configuredModel = config.capabilityProfiles[capability][target];

        expect(body).toContain(
          `${binding} = capabilityProfiles.${capability}.codex`,
        );
        expect(body).toContain(configuredModel);
        expect(body).not.toContain(
          `\`${binding}\` resolves to \`${config.capabilityProfiles[capability].claude}\``,
        );
      }
    }

    for (const target of TARGETS) {
      const { body } = parseFrontmatter(
        getSkillOutput(outputs, "play-agent-dispatch", target).content,
      );
      expect(body).toContain("Codex-only model bindings");
      expect(body).toContain("Target capability markers:");
      for (const capability of ["efficient", "balanced", "frontier"] as const) {
        expect(body).toContain(`capabilityProfiles.${capability}.codex`);
        expect(body).toContain(config.capabilityProfiles[capability][target]);
        expect(body).not.toContain(
          `\`${capability}\` → \`${config.capabilityProfiles[capability].claude}\``,
        );
      }
    }
  });

  it("renders D10 through reviewer frontier/high without changing deep-reviewer routes", async () => {
    const config = await loadConfig(
      path.join(process.cwd(), "devcanon.config.yaml"),
    );
    const { outputs } = await renderAll(config, false, true);
    const d10Spawn = [
      "Codex.spawn_agent({",
      "  task_name: d10_<instance_ordinal>,",
      '  agent_type: "reviewer",',
      "  model: D10_MODEL,",
      '  reasoning_effort: "high",',
      '  fork_turns: "none",',
      "  message: D10_CRITIC_PROMPT,",
      "})",
    ].join("\n");

    for (const target of TARGETS) {
      const { body: playReview } = parseFrontmatter(
        getSkillOutput(outputs, "play-review", target).content,
      );
      expect(playReview).toContain(
        "D10 is one response-only `reviewer`, frontier/high and source-immutable",
      );
      expect(playReview).toContain("`semantic_role: reviewer`");
      expect(playReview).toContain(d10Spawn);
      expect(playReview).toContain(config.capabilityProfiles.frontier[target]);
      expect(playReview).not.toContain(
        "D10 is one response-only `deep-reviewer`, frontier/xhigh",
      );
      expect(playReview).not.toContain(
        "`semantic_role: deep-reviewer`; `capability: frontier`",
      );

      const { body: execution } = parseFrontmatter(
        getSkillOutput(outputs, "play-subagent-execution", target).content,
      );
      for (const route of ["D14", "D15", "D16"] as const) {
        expect(execution).toContain(
          [
            `# ${route}: ${route}_MODEL = capabilityProfiles.frontier.codex`,
            "Codex.spawn_agent({",
            `  task_name: ${route.toLowerCase()}_<instance_ordinal>,`,
            '  agent_type: "deep-reviewer",',
            `  model: ${route}_MODEL,`,
            '  reasoning_effort: "xhigh",',
            '  fork_turns: "none",',
            `  message: ${route}_SELF_CONTAINED_PROMPT,`,
            "})",
          ].join("\n"),
        );
      }
    }
  });

  it("renders the D18 route for both targets", async () => {
    const config = await loadConfig(
      path.join(process.cwd(), "devcanon.config.yaml"),
    );
    const { outputs } = await renderAll(config, false, true);
    const d18Spawn = [
      "Codex.spawn_agent({",
      "  task_name: d18_<instance_ordinal>,",
      '  agent_type: "assessor",',
      "  model: D18_MODEL,",
      '  reasoning_effort: "medium",',
      '  fork_turns: "none",',
      "  message: D18_SEMANTIC_CONTEXT_PROMPT,",
      "})",
    ].join("\n");

    for (const target of TARGETS) {
      const { body } = parseFrontmatter(
        getSkillOutput(outputs, "play-review", target).content,
      );

      expect(body).toContain(d18Spawn);
      expect(body).toContain(config.capabilityProfiles.balanced[target]);
    }
  });

  it("preserves the pr-review scope notice before play-review for both targets", async () => {
    const config = await loadConfig(
      path.join(process.cwd(), "devcanon.config.yaml"),
    );
    const { outputs } = await renderAll(config, false, true);
    const scopeNotice =
      "PR review scope: mode=${scope.mode}, selection=${selection}, selected files=${scope.changed_files.length}. Review is continuing.";

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
        "emit_pr_review_scope_notice || exit 1",
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

  it("renders every validated source skill once for each enabled target", async () => {
    const config = await loadConfig(
      path.join(process.cwd(), "devcanon.config.yaml"),
    );
    const { outputs, skills } = await renderAll(config, false, true);
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

  it("mirrors every declared supporting-file subtree byte for byte", async () => {
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
              expect(rendered).toEqual(source);
            }
          }
        }
      }
    } finally {
      await rm(generatedDir, { recursive: true, force: true });
    }
  }, 30_000);
});
