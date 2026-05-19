import { cp, lstat, rm, unlink } from "node:fs/promises";
import path from "node:path";
import type { ResolvedConfig } from "../config/schema.js";
import { AgentSourceSchema, SkillSourceSchema } from "../config/schema.js";
import type {
  LoadedAgent,
  LoadedSkill,
  RenderedAgent,
  RenderedOutput,
  RenderedSkill,
} from "../models/types.js";
import { UserError } from "../utils/errors.js";
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

export interface RenderLoadedOptions {
  config: ResolvedConfig;
  skills: LoadedSkill[];
  agents: LoadedAgent[];
  writeToGenerated?: boolean;
  targetFilter?: "claude" | "codex";
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

  return renderLoadedInternal({
    config,
    skills,
    agents,
    writeToGenerated,
    targetFilter,
    cleanStaleGenerated: writeToGenerated,
  });
}

export async function renderLoaded(
  options: RenderLoadedOptions,
): Promise<RenderResult> {
  return renderLoadedInternal({ ...options, cleanStaleGenerated: false });
}

interface RenderLoadedInternalOptions extends RenderLoadedOptions {
  cleanStaleGenerated: boolean;
}

async function renderLoadedInternal({
  config,
  skills,
  agents,
  writeToGenerated = false,
  cleanStaleGenerated = false,
  targetFilter,
}: RenderLoadedInternalOptions): Promise<RenderResult> {
  validateLoadedInputs(config, skills, agents);

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
      assertRenderedOutputPath(config, rendered);

      outputs.push(rendered);

      if (writeToGenerated) {
        await assertNoSymlinkPathComponents(
          config.library.generatedDir,
          rendered.generatedPath,
          `Skill "${skill.name}" generated directory`,
        );
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
          assertPathInside(
            rendered.generatedPath,
            filePath,
            `Skill "${skill.name}" extra generated file`,
          );
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
      assertRenderedOutputPath(config, output);
      if (output.type === "agent") {
        await assertNoSymlinkPathComponents(
          config.library.generatedDir,
          output.generatedPath,
          `Agent "${output.name}" generated file`,
        );
        await ensureDir(path.dirname(output.generatedPath));
        await writeTextFile(output.generatedPath, output.content);
      }
    }
  }

  if (writeToGenerated && cleanStaleGenerated) {
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
        await assertNoSymlinkPathComponents(
          config.library.generatedDir,
          filePath,
          `Generated agent file "${entry}"`,
        );
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
        await assertNoSymlinkPathComponents(
          config.library.generatedDir,
          entryPath,
          `Generated skill directory "${entry}"`,
        );
        if (!currentSkillGeneratedDirs.has(entryPath)) {
          await rm(entryPath, { recursive: true, force: true });
        }
      }
    }
  }

  return { outputs, skills, agents };
}

function validateLoadedInputs(
  config: ResolvedConfig,
  skills: readonly LoadedSkill[],
  agents: readonly LoadedAgent[],
): void {
  const skillNames = new Set<string>();
  for (const skill of skills) {
    const result = SkillSourceSchema.safeParse(skill.source);
    if (!result.success || skill.name !== skill.source.name) {
      throw new UserError(`Loaded skill "${skill.name}" is not validated.`);
    }
    if (skillNames.has(skill.name)) {
      throw new UserError(`Loaded skill "${skill.name}" is duplicated.`);
    }
    skillNames.add(skill.name);
    assertNamedPathInside(
      config.library.skillsDir,
      skill.name,
      skill.dirPath,
      `Loaded skill "${skill.name}" directory`,
    );
    for (const subdir of skill.subdirs) {
      if (!["assets", "examples", "references", "scripts"].includes(subdir)) {
        throw new UserError(
          `Loaded skill "${skill.name}" has invalid mirrored subdir "${subdir}".`,
        );
      }
    }
  }

  const agentNames = new Set<string>();
  for (const agent of agents) {
    const result = AgentSourceSchema.safeParse(agent.source);
    if (
      !result.success ||
      agent.name !== agent.source.name ||
      !Array.isArray(agent.source.skills)
    ) {
      throw new UserError(`Loaded agent "${agent.name}" is not validated.`);
    }
    if (agentNames.has(agent.name)) {
      throw new UserError(`Loaded agent "${agent.name}" is duplicated.`);
    }
    agentNames.add(agent.name);
    assertNamedPathInside(
      config.library.agentsDir,
      `${agent.name}.yaml`,
      agent.filePath,
      `Loaded agent "${agent.name}" file`,
    );
  }
}

function assertNamedPathInside(
  root: string,
  expectedLeaf: string,
  candidate: string,
  label: string,
): void {
  assertPathInside(root, candidate, label);
  if (path.resolve(candidate) !== path.resolve(root, expectedLeaf)) {
    throw new UserError(
      `${label} must resolve to "${path.join(root, expectedLeaf)}": ${candidate}`,
    );
  }
}

async function assertNoSymlinkPathComponents(
  root: string,
  candidate: string,
  label: string,
): Promise<void> {
  assertPathInside(root, candidate, label);

  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  const parts = relative.split(path.sep).filter(Boolean);
  let current = resolvedRoot;

  for (const part of parts) {
    current = path.join(current, part);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) {
        throw new UserError(`${label} crosses symlinked path: ${current}`);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      throw err;
    }
  }
}

function assertRenderedOutputPath(
  config: ResolvedConfig,
  output: RenderedOutput,
): void {
  const root = path.join(
    config.library.generatedDir,
    output.target,
    output.type === "agent" ? "agents" : "skills",
  );
  assertPathInside(
    root,
    output.generatedPath,
    `${output.type} "${output.name}"`,
  );
}

function assertPathInside(
  root: string,
  candidate: string,
  label: string,
): void {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new UserError(
      `${label} generated path escapes generated output root: ${candidate}`,
    );
  }
}
