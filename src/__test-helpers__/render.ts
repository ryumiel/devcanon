import { readdir } from "node:fs/promises";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { expect } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  type ParsedFrontmatter,
  parseFrontmatter,
} from "../render/frontmatter.js";
import type { renderAll } from "../render/pipeline.js";

type RenderOutput = Awaited<ReturnType<typeof renderAll>>["outputs"][number];

export function getSkillOutput(
  outputs: RenderOutput[],
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

export function normalizeWhitespace(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

export function parseRenderedMarkdownArtifact(
  content: string,
): ParsedFrontmatter {
  return parseFrontmatter(content);
}

export function parseRenderedTomlArtifact(
  content: string,
): Record<string, unknown> {
  return parseToml(content) as Record<string, unknown>;
}

export function parseRenderedYamlArtifact(
  content: string,
): Record<string, unknown> {
  const parsed = parseYaml(content);
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Rendered YAML artifact must parse to a mapping");
  }
  return parsed as Record<string, unknown>;
}

export function expectOrdered(
  section: string,
  beforeMarker: string,
  afterMarker: string,
) {
  const beforeIndex = section.indexOf(beforeMarker);
  const afterIndex = section.indexOf(afterMarker);

  expect(beforeIndex).toBeGreaterThanOrEqual(0);
  expect(afterIndex).toBeGreaterThanOrEqual(0);
  expect(beforeIndex).toBeLessThan(afterIndex);
}

export async function listRelativeFiles(
  root: string,
  prefix = "",
): Promise<string[]> {
  const entries = await readdir(path.join(root, prefix), {
    withFileTypes: true,
  });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = path.join(prefix, entry.name);

      if (entry.isDirectory()) {
        return listRelativeFiles(root, relativePath);
      }

      if (entry.isFile()) {
        return [relativePath];
      }

      return [];
    }),
  );

  return files.flat().sort();
}
