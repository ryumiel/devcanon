import { lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import path from "node:path";
import type { ResolvedConfig } from "../config/schema.js";
import type { LoadedSkill, RenderedSkill } from "../models/types.js";
import { sha256 } from "../utils/hash.js";
import { renderClaudeSkill } from "./skill-claude.js";
import { renderCodexSkill } from "./skill-codex.js";

export interface RenderedSkillBundle {
  outputs: RenderedSkill[];
  /**
   * Files to write under `generated/<target>/skills/<name>/`.
   * Keyed by absolute path.
   */
  extraFiles: Map<string, string>;
}

export function renderSkillForTarget(
  skill: LoadedSkill,
  target: "claude" | "codex",
  config: ResolvedConfig,
): { rendered: RenderedSkill; extraFiles: Map<string, string> } {
  const input = { source: skill.source, body: skill.body };
  const generatedDir = path.join(
    config.library.generatedDir,
    target,
    "skills",
    skill.name,
  );
  const extraFiles = new Map<string, string>();

  let content: string;
  if (target === "claude") {
    content = renderClaudeSkill(input, config.modelTiers);
  } else {
    const out = renderCodexSkill(input, config.modelTiers);
    content = out.skillMd;
    if (out.sidecar !== null) {
      extraFiles.set(
        path.join(generatedDir, "agents", "openai.yaml"),
        out.sidecar,
      );
    }
  }

  const hashFiles = new Map(extraFiles);
  const mirroredFiles = collectMirroredFilesForHash(
    skill.dirPath,
    skill.subdirs,
    generatedDir,
  );
  for (const [filePath, fileContent] of mirroredFiles) {
    hashFiles.set(filePath, fileContent);
  }

  const contentHash = buildSkillContentHash(content, hashFiles, generatedDir);

  const rendered: RenderedSkill = {
    target,
    type: "skill",
    name: skill.name,
    sourcePath: skill.dirPath,
    generatedPath: generatedDir,
    installedPath: path.join(config.targets[target].skillsHome, skill.name),
    content,
    contentHash,
  };

  return { rendered, extraFiles };
}

/**
 * Compute the contentHash for a rendered skill.
 *
 * The hash includes SKILL.md, any extra files (e.g. the Codex
 * `agents/openai.yaml` sidecar), and all mirrored skill subdirectory files
 * (e.g. `scripts/`, `references/`, `assets/`, `examples/`). Without this,
 * plan computation emits skip-up-to-date and copy-mode installs can leave
 * bundled helper files stale.
 * Extra-file basenames (relative to the skill's generated dir) are folded
 * in alongside their content. We use basenames rather than absolute paths
 * so the hash stays stable across machines / users.
 *
 * Determinism guards:
 *   1. Sort with a byte-wise comparator rather than `localeCompare`. Locale
 *      collation (e.g. tr-TR) can reorder otherwise-identical inputs.
 *   2. Normalize the path separator to forward slash before hashing so the
 *      same skill yields the same hash on POSIX and Windows.
 */
export function buildSkillContentHash(
  content: string,
  extraFiles: Map<string, string>,
  generatedDir: string,
): string {
  const hashParts: string[] = [content];
  const extraEntries = Array.from(extraFiles.entries()).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  for (const [absPath, fileContent] of extraEntries) {
    const relPath = path.relative(generatedDir, absPath);
    const posixRelPath = relPath.split(path.sep).join("/");
    hashParts.push(posixRelPath, fileContent);
  }
  return sha256(hashParts.join("\0"));
}

function collectMirroredFilesForHash(
  skillDir: string,
  subdirs: readonly string[],
  generatedDir: string,
): Map<string, string> {
  const mirroredFiles = new Map<string, string>();

  for (const subdir of subdirs) {
    const sourceRoot = path.join(skillDir, subdir);
    const generatedRoot = path.join(generatedDir, subdir);
    walkMirroredFilesForHash(sourceRoot, generatedRoot, mirroredFiles);
  }

  return mirroredFiles;
}

function walkMirroredFilesForHash(
  sourceDir: string,
  generatedDir: string,
  mirroredFiles: Map<string, string>,
): void {
  const entries = readdirSync(sourceDir, { withFileTypes: true }).sort(
    (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const generatedPath = path.join(generatedDir, entry.name);

    if (entry.isDirectory()) {
      walkMirroredFilesForHash(sourcePath, generatedPath, mirroredFiles);
      continue;
    }

    if (entry.isFile()) {
      mirroredFiles.set(
        generatedPath,
        `file:${readFileSync(sourcePath).toString("base64")}`,
      );
      continue;
    }

    if (entry.isSymbolicLink()) {
      const linkedStat = lstatSync(sourcePath);
      if (linkedStat.isSymbolicLink()) {
        mirroredFiles.set(generatedPath, `symlink:${readlinkSync(sourcePath)}`);
      }
    }
  }
}
