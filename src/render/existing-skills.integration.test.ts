import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getSkillOutput,
  listRelativeFiles,
} from "../__test-helpers__/render.js";
import { loadConfig } from "../config/load.js";
import { parseFrontmatter } from "./frontmatter.js";
import { renderAll } from "./pipeline.js";

const TARGETS = ["claude", "codex"] as const;

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

        expect(frontmatter.name).toBe(skill.name);
        expect(frontmatter.description).toBe(skill.source.description);
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
