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
  it("renders every validated source skill once for each enabled target", async () => {
    const config = await loadConfig(
      path.join(process.cwd(), "devcanon.config.yaml"),
    );
    const { outputs, skills } = await renderAll(config, false, true);
    const skillOutputs = outputs.filter((output) => output.type === "skill");

    expect(skillOutputs).toHaveLength(skills.length * TARGETS.length);

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
