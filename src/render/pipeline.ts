import { type Stats, lstatSync } from "node:fs";
import { cp, lstat, rm, unlink } from "node:fs/promises";
import path from "node:path";
import type { ResolvedConfig } from "../config/schema.js";
import {
  AgentSourceSchema,
  MODEL_TIER_PLACEHOLDER,
  MODEL_TIER_PLACEHOLDER_PREFIX,
  SkillSourceSchema,
} from "../config/schema.js";
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
import { KNOWN_SUBDIRS, loadAndValidateSkills } from "../validate/skills.js";
import { renderClaudeAgent } from "./claude.js";
import { renderCodexAgent } from "./codex.js";
import { renderSkillForTarget } from "./skill.js";

export interface RenderResult<
  TSkills extends readonly LoadedSkill[] = LoadedSkill[],
  TAgents extends readonly LoadedAgent[] = LoadedAgent[],
> {
  outputs: RenderedOutput[];
  skills: TSkills;
  agents: TAgents;
}

export interface RenderLoadedOptions<
  TSkills extends readonly LoadedSkill[] = readonly LoadedSkill[],
  TAgents extends readonly LoadedAgent[] = readonly LoadedAgent[],
> {
  config: ResolvedConfig;
  skills: TSkills;
  agents: TAgents;
  validatedSkills?: readonly LoadedSkill[];
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
    validatedSkills: skills,
    writeToGenerated,
    targetFilter,
    cleanStaleGenerated: writeToGenerated,
  });
}

export async function renderLoaded<
  TSkills extends readonly LoadedSkill[],
  TAgents extends readonly LoadedAgent[],
>(
  options: RenderLoadedOptions<TSkills, TAgents>,
): Promise<RenderResult<TSkills, TAgents>> {
  return renderLoadedInternal({ ...options, cleanStaleGenerated: false });
}

interface RenderLoadedInternalOptions<
  TSkills extends readonly LoadedSkill[],
  TAgents extends readonly LoadedAgent[],
> extends RenderLoadedOptions<TSkills, TAgents> {
  cleanStaleGenerated: boolean;
}

async function renderLoadedInternal<
  TSkills extends readonly LoadedSkill[],
  TAgents extends readonly LoadedAgent[],
>({
  config,
  skills,
  agents,
  validatedSkills,
  writeToGenerated = false,
  cleanStaleGenerated = false,
  targetFilter,
}: RenderLoadedInternalOptions<TSkills, TAgents>): Promise<
  RenderResult<TSkills, TAgents>
> {
  validateLoadedInputs(config, skills, agents, validatedSkills ?? skills);

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
      await assertNoSymlinkPathComponents(
        config.library.generatedDir,
        agentsDir,
        `Generated agents directory for "${target}"`,
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
      await assertNoSymlinkPathComponents(
        config.library.generatedDir,
        skillsGeneratedDir,
        `Generated skills directory for "${target}"`,
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
  validatedSkills: readonly LoadedSkill[],
): void {
  const validatedSkillNames = new Set<string>();
  for (const skill of validatedSkills) {
    validateLoadedSkillReference(skill, validatedSkillNames);
  }
  const renderedSkillNames = new Set<string>();
  for (const skill of skills) {
    validateLoadedSkill(config, skill, renderedSkillNames);
    if (!validatedSkillNames.has(skill.name)) {
      throw new UserError(
        `Loaded skill "${skill.name}" is missing from validatedSkills.`,
      );
    }
  }

  const agentNames = new Set<string>();
  for (const agent of agents) {
    const result = AgentSourceSchema.safeParse(agent.source);
    if (
      !result.success ||
      agent.name !== agent.source.name ||
      !deepEqual(agent.source, result.data)
    ) {
      throw new UserError(`Loaded agent "${agent.name}" is not validated.`);
    }
    if (agentNames.has(agent.name)) {
      throw new UserError(`Loaded agent "${agent.name}" is duplicated.`);
    }
    agentNames.add(agent.name);
    assertDirectYamlPathShapeInside(
      config.library.agentsDir,
      agent.filePath,
      `Loaded agent "${agent.name}" file`,
    );
    validateAgentModelTierReference(
      agent.name,
      "claude.model",
      agent.source.claude?.model,
      config,
    );
    validateAgentModelTierReference(
      agent.name,
      "codex.model",
      agent.source.codex?.model,
      config,
    );
    for (const skillRef of agent.source.skills) {
      if (!validatedSkillNames.has(skillRef)) {
        throw new UserError(
          `Loaded agent "${agent.name}" references unknown skill "${skillRef}".`,
        );
      }
    }
  }
}

function validateAgentModelTierReference(
  agentName: string,
  fieldPath: "claude.model" | "codex.model",
  value: string | undefined,
  config: ResolvedConfig,
): void {
  if (!value?.includes(MODEL_TIER_PLACEHOLDER_PREFIX)) return;

  const tier = value.match(MODEL_TIER_PLACEHOLDER)?.[1];
  if (!tier || !config.modelTiers || !Object.hasOwn(config.modelTiers, tier)) {
    throw new UserError(
      `Loaded agent "${agentName}": ${fieldPath} references invalid model tier.`,
    );
  }
}

function validateLoadedSkill(
  config: ResolvedConfig,
  skill: LoadedSkill,
  names: Set<string>,
): void {
  validateLoadedSkillReference(skill, names);
  assertDirectNamedPathShapeInside(
    config.library.skillsDir,
    skill.name,
    skill.dirPath,
    `Loaded skill "${skill.name}" directory`,
  );
  for (const subdir of skill.subdirs) {
    if (!(KNOWN_SUBDIRS as readonly string[]).includes(subdir)) {
      throw new UserError(
        `Loaded skill "${skill.name}" has invalid mirrored subdir "${subdir}".`,
      );
    }
    const sourceSubdirPath = path.join(skill.dirPath, subdir);
    assertNoSymlinkPathComponentsSync(
      config.library.skillsDir,
      sourceSubdirPath,
      `Loaded skill "${skill.name}" mirrored subdir "${subdir}"`,
    );
    assertExistingDirectory(
      sourceSubdirPath,
      `Loaded skill "${skill.name}" mirrored subdir "${subdir}"`,
    );
  }
}

function validateLoadedSkillReference(
  skill: LoadedSkill,
  names: Set<string>,
): void {
  const result = SkillSourceSchema.safeParse(skill.source);
  if (!result.success || skill.name !== skill.source.name) {
    throw new UserError(`Loaded skill "${skill.name}" is not validated.`);
  }
  if (names.has(skill.name)) {
    throw new UserError(`Loaded skill "${skill.name}" is duplicated.`);
  }
  names.add(skill.name);
}

function assertDirectNamedPathShapeInside(
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

function assertDirectYamlPathShapeInside(
  root: string,
  candidate: string,
  label: string,
): void {
  assertPathInside(root, candidate, label);
  if (
    path.dirname(path.resolve(candidate)) !== path.resolve(root) ||
    !path.basename(candidate).endsWith(".yaml")
  ) {
    throw new UserError(
      `${label} must be a direct .yaml child of "${root}": ${candidate}`,
    );
  }
}

async function assertNoSymlinkPathComponents(
  root: string,
  candidate: string,
  label: string,
): Promise<void> {
  assertPathInside(root, candidate, label);

  const resolvedCandidate = path.resolve(candidate);
  let current = path.parse(resolvedCandidate).root;

  await assertExistingPathComponentIsNotSymlink(current, label);
  const parts = path.relative(current, resolvedCandidate).split(path.sep);
  for (const part of parts.filter(Boolean)) {
    current = path.join(current, part);
    if (!(await assertExistingPathComponentIsNotSymlink(current, label)))
      return;
  }
}

function assertNoSymlinkPathComponentsSync(
  root: string,
  candidate: string,
  label: string,
): void {
  assertPathInside(root, candidate, label);

  const resolvedCandidate = path.resolve(candidate);
  let current = path.parse(resolvedCandidate).root;

  assertExistingPathComponentIsNotSymlinkSync(current, label);
  const parts = path.relative(current, resolvedCandidate).split(path.sep);
  for (const part of parts.filter(Boolean)) {
    current = path.join(current, part);
    if (!assertExistingPathComponentIsNotSymlinkSync(current, label)) return;
  }
}

async function assertExistingPathComponentIsNotSymlink(
  candidate: string,
  label: string,
): Promise<boolean> {
  try {
    const stat = await lstat(candidate);
    if (isUserControlledSymlink(stat)) {
      throw new UserError(`${label} crosses symlinked path: ${candidate}`);
    }
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return false;
    throw err;
  }
}

function assertExistingPathComponentIsNotSymlinkSync(
  candidate: string,
  label: string,
): boolean {
  try {
    const stat = lstatSync(candidate);
    if (isUserControlledSymlink(stat)) {
      throw new UserError(`${label} crosses symlinked path: ${candidate}`);
    }
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return false;
    throw err;
  }
}

function isUserControlledSymlink(stat: Stats): boolean {
  if (!stat.isSymbolicLink()) return false;
  // macOS exposes normal temp paths under root-owned compatibility symlinks
  // such as /var -> /private/var; reject symlinks the current user can create.
  const currentUid = process.getuid?.();
  if (currentUid === undefined) return true;
  return stat.uid === currentUid;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((value, index) => deepEqual(value, b[index]));
  }
  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object"
  ) {
    return false;
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord).sort();
  const bKeys = Object.keys(bRecord).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (const [index, key] of aKeys.entries()) {
    if (key !== bKeys[index]) return false;
  }
  return aKeys.every((key) => deepEqual(aRecord[key], bRecord[key]));
}

function assertExistingDirectory(candidate: string, label: string): void {
  const stat = lstatExisting(candidate, label);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new UserError(`${label} must be a real directory: ${candidate}`);
  }
}

function lstatExisting(candidate: string, label: string) {
  try {
    return lstatSync(candidate);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new UserError(`${label} does not exist: ${candidate}`);
    }
    throw err;
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
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new UserError(`${label} path escapes root "${root}": ${candidate}`);
  }
}
