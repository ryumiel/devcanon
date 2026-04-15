import path from "node:path";
import type { ResolvedConfig } from "../config/schema.js";
import type {
  LoadedAgent,
  LoadedSkill,
  RenderedOutput,
} from "../models/types.js";
import { ensureDir, writeTextFile } from "../utils/fs.js";
import { hashDirectory } from "../utils/hash.js";
import { loadAndValidateAgents } from "../validate/agents.js";
import { loadAndValidateSkills } from "../validate/skills.js";
import { renderClaudeAgent } from "./claude.js";
import { renderCodexAgent } from "./codex.js";

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
  const agents = await loadAndValidateAgents(
    config.library.agentsDir,
    skills,
    strict,
  );

  const skillMap = new Map(skills.map((s) => [s.name, s]));

  const targets = ["claude", "codex"] as const;
  const willRender = targets.some(
    (target) =>
      config.targets[target].enabled &&
      (!targetFilter || target === targetFilter),
  );

  const skillHashes = willRender
    ? new Map(
        await Promise.all(
          skills.map(
            async (skill) =>
              [skill.name, await hashDirectory(skill.dirPath)] as const,
          ),
        ),
      )
    : new Map<string, string>();

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

    // Create skill entries (skills are not rendered, just tracked)
    for (const skill of skills) {
      const hash = skillHashes.get(skill.name);
      if (hash === undefined) {
        throw new Error(
          `internal: missing precomputed hash for skill ${skill.name}`,
        );
      }
      outputs.push({
        target,
        type: "skill",
        name: skill.name,
        sourcePath: skill.dirPath,
        generatedPath: null,
        installedPath: path.join(config.targets[target].skillsHome, skill.name),
        content: null,
        contentHash: hash,
      });
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
  }

  return { outputs, skills, agents };
}
