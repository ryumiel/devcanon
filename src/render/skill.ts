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

  // Hash includes both SKILL.md and any extra files (e.g. the Codex
  // `agents/openai.yaml` sidecar) so that edits to the sidecar invalidate the
  // skill's contentHash. Without this, plan computation emits
  // skip-up-to-date and copy-mode installs leave the sidecar stale.
  // Extra-file basenames (relative to the skill's generated dir) are folded
  // in alongside their content. We use basenames rather than absolute paths
  // so the hash stays stable across machines / users.
  const hashParts: string[] = [content];
  const extraEntries = Array.from(extraFiles.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  for (const [absPath, fileContent] of extraEntries) {
    const relPath = path.relative(generatedDir, absPath);
    hashParts.push(relPath, fileContent);
  }
  const contentHash = sha256(hashParts.join("\0"));

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
