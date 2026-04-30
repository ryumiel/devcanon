import { cp, rm, unlink } from "node:fs/promises";
import path from "node:path";
import type { ResolvedConfig } from "../config/schema.js";
import type {
  LoadedAgent,
  LoadedSkill,
  RenderedAgent,
  RenderedOutput,
  RenderedSkill,
} from "../models/types.js";
import { ensureDir, readdir, writeTextFile } from "../utils/fs.js";
import { loadAndValidateAgents } from "../validate/agents.js";
import { loadAndValidateSkills } from "../validate/skills.js";
import { renderClaudeAgent } from "./claude.js";
import { renderCodexAgent } from "./codex.js";
import { renderSkillForTarget } from "./skill.js";

export interface RenderResult {
  outputs: RenderedOutput[];
  skills: LoadedSkill[];
  agents: LoadedAgent[];
}

export async function renderAll(
  config: ResolvedConfig,
  writeToGenerated = true,
  strict = false,
  targetFilter?: "claude" | "codex",
): Promise<RenderResult> {
  const skills = await loadAndValidateSkills(config.library.skillsDir);
  const agents = await loadAndValidateAgents(config.library.agentsDir, skills, {
    strict,
    modelTiers: config.modelTiers,
  });

  const skillMap = new Map(skills.map((s) => [s.name, s]));

  const targets = ["claude", "codex"] as const;

  const outputs: RenderedOutput[] = [];

  for (const target of targets) {
    if (!config.targets[target].enabled) continue;
    if (targetFilter && target !== targetFilter) continue;

    // Render agents
    for (const agent of agents) {
      const rendered =
        target === "claude"
          ? renderClaudeAgent(agent, skillMap, config)
          : renderCodexAgent(agent, skillMap, config);
      outputs.push(rendered);
    }

    // Render skills per target
    for (const skill of skills) {
      const { rendered, extraFiles } = renderSkillForTarget(
        skill,
        target,
        config,
      );
      outputs.push(rendered);

      if (writeToGenerated) {
        // Purge the per-skill generated dir before writing. Without this,
        // dropping `codex_sidecar:` from a source or removing a previously
        // mirrored subdir (e.g. scripts/) leaves stale files lingering in
        // generated/<target>/skills/<name>/. The generated/ tree is
        // documented as disposable, so a full rebuild per skill is fine.
        await rm(rendered.generatedPath, { recursive: true, force: true });
        await ensureDir(rendered.generatedPath);
        await writeTextFile(
          path.join(rendered.generatedPath, "SKILL.md"),
          rendered.content,
        );
        for (const [filePath, fileContent] of extraFiles) {
          await ensureDir(path.dirname(filePath));
          await writeTextFile(filePath, fileContent);
        }
        // Mirror known subdirs
        for (const sub of skill.subdirs) {
          await cp(
            path.join(skill.dirPath, sub),
            path.join(rendered.generatedPath, sub),
            { recursive: true, verbatimSymlinks: true },
          );
        }
      }
    }
  }

  // Write agent outputs to generated/ directory
  if (writeToGenerated) {
    for (const output of outputs) {
      if (output.type === "agent") {
        await ensureDir(path.dirname(output.generatedPath));
        await writeTextFile(output.generatedPath, output.content);
      }
    }

    // Remove stale generated files that no longer have corresponding sources
    const currentGeneratedPaths = new Set(
      outputs
        .filter((o): o is RenderedAgent => o.type === "agent")
        .map((o) => o.generatedPath),
    );

    for (const target of targets) {
      if (!config.targets[target].enabled) continue;
      if (targetFilter && target !== targetFilter) continue;

      const agentsDir = path.join(
        config.library.generatedDir,
        target,
        "agents",
      );
      let entries: string[];
      try {
        entries = await readdir(agentsDir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        const filePath = path.join(agentsDir, entry);
        if (!currentGeneratedPaths.has(filePath)) {
          await unlink(filePath);
        }
      }
    }

    // Remove stale per-target skill directories
    const currentSkillGeneratedDirs = new Set(
      outputs
        .filter((o): o is RenderedSkill => o.type === "skill")
        .map((o) => o.generatedPath),
    );

    for (const target of targets) {
      if (!config.targets[target].enabled) continue;
      if (targetFilter && target !== targetFilter) continue;

      const skillsGeneratedDir = path.join(
        config.library.generatedDir,
        target,
        "skills",
      );
      let skillEntries: string[];
      try {
        skillEntries = await readdir(skillsGeneratedDir);
      } catch {
        continue;
      }
      for (const entry of skillEntries) {
        const entryPath = path.join(skillsGeneratedDir, entry);
        if (!currentSkillGeneratedDirs.has(entryPath)) {
          await rm(entryPath, { recursive: true, force: true });
        }
      }
    }
  }

  return { outputs, skills, agents };
}
