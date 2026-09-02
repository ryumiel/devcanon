import { type Stats, lstatSync } from "node:fs";
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
import {
  type ValidatedDevcanonRuntime,
  bundledDevcanonRuntimeDir,
  devcanonRuntimeDir,
  validateDevcanonRuntime,
} from "../validate/devcanon-runtime.js";
import {
  DEVCANON_RUNTIME_SKILL_NAME,
  KNOWN_SUBDIRS,
  collectActiveModelPlaceholderErrors,
  loadAndValidateSkills,
} from "../validate/skills.js";
import { renderClaudeAgent } from "./claude.js";
import { renderCodexAgent } from "./codex.js";
import {
  hashDevcanonRuntimePayload,
  renderDevcanonRuntimeForTarget,
  writeRenderedDevcanonRuntime,
} from "./devcanon-runtime.js";
import { normalizePackagedShellTree } from "./packaged-shell.js";
import { renderSkillForTarget } from "./skill.js";

export interface RenderResult<
  TSkills extends readonly LoadedSkill[] = LoadedSkill[],
  TAgents extends readonly LoadedAgent[] = LoadedAgent[],
> {
  outputs: RenderedOutput[];
  skills: TSkills;
  agents: TAgents;
  mutationInventory: readonly RenderMutation[];
}

export type RenderMutation =
  | Readonly<{
      kind: "selected-output";
      path: string;
      target: "claude" | "codex";
      type: "agent" | "skill";
      name: string;
    }>
  | Readonly<{
      kind: "stale-cleanup-root";
      path: string;
      target: "claude" | "codex";
      type: "agent" | "skill";
    }>;

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
  const runtimeDir = devcanonRuntimeDir(config.library.skillsDir);
  const validatedRuntime = await validateDevcanonRuntime(runtimeDir, {
    adapterSourceDir: bundledDevcanonRuntimeDir(),
    operation: writeToGenerated ? "compose" : "read-only",
  });
  return renderAllWithValidatedRuntime(
    config,
    validatedRuntime,
    writeToGenerated,
    strict,
    targetFilter,
  );
}

/** @internal Reuses validation evidence only within one owning operation. */
export async function renderAllWithValidatedRuntime(
  config: ResolvedConfig,
  validatedRuntime: ValidatedDevcanonRuntime,
  writeToGenerated = true,
  strict = false,
  targetFilter?: "claude" | "codex",
): Promise<RenderResult> {
  const runtimeDir = devcanonRuntimeDir(config.library.skillsDir);
  if (path.resolve(validatedRuntime.runtimeDir) !== path.resolve(runtimeDir)) {
    throw new Error(
      "Validated devcanon-runtime evidence does not match config.",
    );
  }
  const skills = await loadAndValidateSkills(config.library.skillsDir);
  const agents = await loadAndValidateAgents(config.library.agentsDir, skills, {
    strict,
    codexEnabled: config.targets.codex.enabled,
  });

  return renderLoadedInternal({
    config,
    skills,
    agents,
    validatedSkills: skills,
    writeToGenerated,
    targetFilter,
    cleanStaleGenerated: true,
    runtimeDir,
    validatedRuntime,
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
  runtimeDir?: string;
  validatedRuntime?: ValidatedDevcanonRuntime;
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
  runtimeDir,
  validatedRuntime,
}: RenderLoadedInternalOptions<TSkills, TAgents>): Promise<
  RenderResult<TSkills, TAgents>
> {
  validateLoadedInputs(
    config,
    skills,
    agents,
    validatedSkills ?? skills,
    targetFilter,
  );

  const skillMap = new Map(skills.map((s) => [s.name, s]));

  const targets = ["claude", "codex"] as const;

  const outputs: RenderedOutput[] = [];
  const skillWrites: Array<{
    skill: LoadedSkill;
    rendered: RenderedSkill;
    extraFiles: Map<string, string>;
  }> = [];
  const runtimeWrites: RenderedSkill[] = [];
  const runtimeContentHash = runtimeDir
    ? await hashDevcanonRuntimePayload(runtimeDir, config, validatedRuntime)
    : undefined;

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
      skillWrites.push({ skill, rendered, extraFiles });
    }

    if (runtimeDir) {
      const rendered = await renderDevcanonRuntimeForTarget(
        runtimeDir,
        target,
        config,
        runtimeContentHash,
      );
      assertRenderedOutputPath(config, rendered);
      runtimeWrites.push(rendered);
      outputs.push(rendered);
    }
  }

  for (const output of outputs) {
    assertRenderedOutputPath(config, output);
  }
  const mutationInventory = buildMutationInventory(
    config,
    outputs,
    targets,
    targetFilter,
    cleanStaleGenerated,
  );
  let staleCleanupPlan = EMPTY_STALE_GENERATED_CLEANUP_PLAN;

  if (writeToGenerated) {
    await preflightGeneratedMutations(config, mutationInventory);
    if (cleanStaleGenerated) {
      staleCleanupPlan = await planStaleGeneratedCleanup(
        config,
        mutationInventory,
        outputs,
      );
    }
    for (const { skill, rendered, extraFiles } of skillWrites) {
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
        const generatedSubdir = path.join(rendered.generatedPath, sub);
        await cp(path.join(skill.dirPath, sub), generatedSubdir, {
          recursive: true,
          verbatimSymlinks: true,
        });
        if (sub === "scripts") {
          await normalizePackagedShellTree(generatedSubdir);
        }
      }
    }
    for (const runtime of runtimeWrites) {
      await assertNoSymlinkPathComponents(
        config.library.generatedDir,
        runtime.generatedPath,
        "devcanon-runtime generated directory",
      );
      await writeRenderedDevcanonRuntime(
        runtime.sourcePath,
        runtime.generatedPath,
        config,
        validatedRuntime,
      );
    }
  }

  // Write agent outputs to generated/ directory
  if (writeToGenerated) {
    for (const output of outputs) {
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
    await applyStaleGeneratedCleanupPlan(staleCleanupPlan);
  }

  return { outputs, skills, agents, mutationInventory };
}

interface StaleGeneratedCleanupPlan {
  readonly agentFiles: readonly string[];
  readonly skillDirectories: readonly string[];
}

const EMPTY_STALE_GENERATED_CLEANUP_PLAN: StaleGeneratedCleanupPlan =
  Object.freeze({ agentFiles: [], skillDirectories: [] });

async function planStaleGeneratedCleanup(
  config: ResolvedConfig,
  mutationInventory: readonly RenderMutation[],
  outputs: readonly RenderedOutput[],
): Promise<StaleGeneratedCleanupPlan> {
  const currentAgentPaths = new Set(
    outputs
      .filter((output): output is RenderedAgent => output.type === "agent")
      .map((output) => output.generatedPath),
  );
  const currentSkillPaths = new Set(
    outputs
      .filter((output): output is RenderedSkill => output.type === "skill")
      .map((output) => output.generatedPath),
  );
  const agentFiles: string[] = [];
  const skillDirectories: string[] = [];

  for (const root of mutationInventory) {
    if (root.kind !== "stale-cleanup-root") continue;
    await assertNoSymlinkPathComponents(
      config.library.generatedDir,
      root.path,
      `Generated ${root.type}s directory for "${root.target}"`,
    );
    let entries: string[];
    try {
      entries = await readdir(root.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      const entryPath = path.join(root.path, entry);
      await assertNoSymlinkPathComponents(
        config.library.generatedDir,
        entryPath,
        `Generated ${root.type} cleanup entry "${entry}"`,
      );
      if (root.type === "agent") {
        if (!(await lstat(entryPath)).isFile()) {
          throw new UserError(
            `Generated agent cleanup entry must be a regular file: ${entryPath}`,
            entryPath,
          );
        }
        if (!currentAgentPaths.has(entryPath)) agentFiles.push(entryPath);
      } else if (!currentSkillPaths.has(entryPath)) {
        skillDirectories.push(entryPath);
      }
    }
  }
  return Object.freeze({
    agentFiles: Object.freeze(agentFiles),
    skillDirectories: Object.freeze(skillDirectories),
  });
}

async function applyStaleGeneratedCleanupPlan(
  plan: StaleGeneratedCleanupPlan,
): Promise<void> {
  for (const filePath of plan.agentFiles) await unlink(filePath);
  for (const directoryPath of plan.skillDirectories) {
    await rm(directoryPath, { recursive: true, force: true });
  }
}

async function preflightGeneratedMutations(
  config: ResolvedConfig,
  mutations: readonly RenderMutation[],
): Promise<void> {
  for (const mutation of mutations) {
    await assertNoSymlinkPathComponents(
      config.library.generatedDir,
      mutation.path,
      `Generated ${mutation.type} path for "${mutation.target}"`,
    );
    if (mutation.kind === "selected-output") {
      await assertSelectedOutputLeafType(mutation);
    }
  }
}

async function assertSelectedOutputLeafType(
  mutation: Extract<RenderMutation, { kind: "selected-output" }>,
): Promise<void> {
  let stat: Stats;
  try {
    stat = await lstat(mutation.path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const expectedType = mutation.type === "agent" ? "regular file" : "directory";
  const valid = mutation.type === "agent" ? stat.isFile() : stat.isDirectory();
  if (!valid) {
    throw new UserError(
      `Generated ${mutation.type} output must be absent or a ${expectedType}: ${mutation.path}`,
      mutation.path,
    );
  }
}

function buildMutationInventory(
  config: ResolvedConfig,
  outputs: readonly RenderedOutput[],
  targets: readonly ("claude" | "codex")[],
  targetFilter: "claude" | "codex" | undefined,
  includeStaleCleanupRoots: boolean,
): readonly RenderMutation[] {
  const outputMutations = outputs
    .map((output) =>
      Object.freeze({
        kind: "selected-output" as const,
        path: path.resolve(output.generatedPath),
        target: output.target,
        type: output.type,
        name: output.name,
      }),
    )
    .sort(compareSelectedOutputMutations);
  if (!includeStaleCleanupRoots) {
    return Object.freeze(outputMutations);
  }

  const selectedTargets = targets.filter(
    (target) =>
      config.targets[target].enabled &&
      (targetFilter === undefined || targetFilter === target),
  );
  const cleanupRoots = (["agent", "skill"] as const).flatMap((type) =>
    selectedTargets.map((target) =>
      Object.freeze({
        kind: "stale-cleanup-root" as const,
        path: path.resolve(
          config.library.generatedDir,
          target,
          type === "agent" ? "agents" : "skills",
        ),
        target,
        type,
      }),
    ),
  );

  return Object.freeze([...outputMutations, ...cleanupRoots]);
}

function compareSelectedOutputMutations(
  left: Extract<RenderMutation, { kind: "selected-output" }>,
  right: Extract<RenderMutation, { kind: "selected-output" }>,
): number {
  const targetOrder = { claude: 0, codex: 1 } as const;
  const typeOrder = { agent: 0, skill: 1 } as const;
  return (
    targetOrder[left.target] - targetOrder[right.target] ||
    typeOrder[left.type] - typeOrder[right.type] ||
    compareBytewise(left.name, right.name) ||
    compareBytewise(left.path, right.path)
  );
}

function compareBytewise(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateLoadedInputs(
  config: ResolvedConfig,
  skills: readonly LoadedSkill[],
  agents: readonly LoadedAgent[],
  validatedSkills: readonly LoadedSkill[],
  targetFilter: "claude" | "codex" | undefined,
): void {
  const validatedSkillNames = new Set<string>();
  for (const skill of validatedSkills) {
    validateLoadedSkillReference(skill, validatedSkillNames);
  }
  const renderedSkillNames = new Set<string>();
  for (const skill of skills) {
    validateLoadedSkill(config, skill, renderedSkillNames, targetFilter);
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
    validateLoadedAgentLiteralModel(
      agent.name,
      "claude.model",
      agent.source.claude?.model,
    );
    validateLoadedAgentLiteralModel(
      agent.name,
      "codex.model",
      agent.source.codex?.model,
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

function validateLoadedAgentLiteralModel(
  agentName: string,
  fieldPath: "claude.model" | "codex.model",
  value: string | null | undefined,
): void {
  if (!value?.includes("{{model:")) return;

  throw new UserError(
    `Loaded agent "${agentName}": ${fieldPath} no longer supports model placeholders (received "${value}"); set top-level capability to efficient, balanced, or frontier, or use a literal target model.`,
  );
}

function validateLoadedSkill(
  config: ResolvedConfig,
  skill: LoadedSkill,
  names: Set<string>,
  targetFilter: "claude" | "codex" | undefined,
): void {
  validateLoadedSkillReference(skill, names);
  const selectedTargets = (["claude", "codex"] as const).filter(
    (target) =>
      config.targets[target].enabled &&
      (targetFilter === undefined || targetFilter === target),
  );
  const placeholderErrors = collectActiveModelPlaceholderErrors(
    skill.name,
    skill.source,
    skill.body,
    selectedTargets,
    path.join(skill.dirPath, "SKILL.md"),
  );
  if (placeholderErrors.length > 0) {
    throw new UserError(
      placeholderErrors.join("\n"),
      path.join(skill.dirPath, "SKILL.md"),
    );
  }
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
  if (skill.name === DEVCANON_RUNTIME_SKILL_NAME) {
    throw new UserError(
      `Loaded skill "${DEVCANON_RUNTIME_SKILL_NAME}" is reserved for passive runtime projection.`,
    );
  }
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
