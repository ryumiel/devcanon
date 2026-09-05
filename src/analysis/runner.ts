import { createHash } from "node:crypto";
import path from "node:path";
import type { ResolvedConfig } from "../config/schema.js";
import type {
  LoadedAgent,
  LoadedSkill,
  RenderedSkill,
} from "../models/types.js";
import { renderLoaded } from "../render/pipeline.js";
import {
  AnalysisFilesError,
  publishAnalysisResult,
  readComparisonResult,
  readDeclaredSupportFile,
  validateResultDirectory,
} from "./files.js";
import {
  type AnalysisTarget,
  type ExactTextRecord,
  SCENARIO_AGGREGATION_ID,
  type SkillContextComparison,
  type SkillContextEnvelope,
  canonicalizeSkillContext,
  compareSkillContextEnvelopes,
  createDiscoveryFieldRecord,
  createExactTextRecord,
  createScenarioRecord,
} from "./skill-context.js";

const TARGETS = ["claude", "codex"] as const;
const SUBJECTS = ["base", "candidate"] as const;
const SHA256 = /^[a-f0-9]{64}$/u;

export class AnalysisRunnerError extends Error {
  constructor(
    readonly category:
      | "request"
      | "render"
      | "file"
      | "comparison"
      | "publication",
    message: string,
  ) {
    super(message);
    this.name = "AnalysisRunnerError";
  }
}

export interface DeclaredAnalysisScenario {
  readonly name: string;
  readonly target: AnalysisTarget;
  readonly supportPaths: readonly string[];
}

export interface SkillContextAnalysisComparison {
  readonly path: string;
  readonly expectedPayloadSha256: string;
}

export interface SkillContextAnalysisRequest {
  readonly config: ResolvedConfig;
  readonly skills: readonly LoadedSkill[];
  readonly agents: readonly LoadedAgent[];
  readonly skill: string;
  readonly subject: "base" | "candidate";
  readonly targets: readonly AnalysisTarget[];
  readonly scenarios: readonly DeclaredAnalysisScenario[];
  readonly repositoryRoot: string;
  readonly resultDirectory: string;
  readonly comparison?: SkillContextAnalysisComparison;
}

export interface SkillContextAnalysisResult {
  readonly path: string;
  readonly payloadSha256: string;
  readonly envelope: SkillContextEnvelope;
  readonly comparison?: SkillContextComparison;
}

/**
 * Compose a skill-context envelope from already validated producer output.
 * This intentionally never invokes loading, validation, generated writes, or cleanup.
 */
export async function runSkillContextAnalysis(
  request: SkillContextAnalysisRequest,
): Promise<SkillContextAnalysisResult> {
  validateRequest(request);
  let executionRequest: Readonly<SkillContextAnalysisRequest>;
  try {
    executionRequest = freezeDeep(structuredClone(request));
  } catch {
    fail("request", "analysis request must contain cloneable plain data");
  }
  const validated = validateRequest(executionRequest);
  try {
    await validateResultDirectory(
      executionRequest.repositoryRoot,
      executionRequest.resultDirectory,
    ).catch((error) => {
      throw new AnalysisRunnerError("request", (error as Error).message);
    });
    const raw = await createExactTextRecord({
      kind: "raw-source",
      subject: executionRequest.subject,
      skill: validated.skill.name,
      text: validated.skill.skillMdContent,
    });
    const records: Array<
      ExactTextRecord | ReturnType<typeof createScenarioRecord>
    > = [raw];
    const targetRenderings = new Map<AnalysisTarget, RenderedSkill>();
    const renderedRecords = new Map<AnalysisTarget, ExactTextRecord>();
    const supportRecords = new Map<string, ExactTextRecord>();

    for (const target of validated.targets) {
      const rendered = await renderExactSkill(
        executionRequest,
        validated.skill,
        target,
      );
      targetRenderings.set(target, rendered);
      const renderedRecord = await createExactTextRecord({
        kind: "rendered-skill",
        subject: executionRequest.subject,
        skill: validated.skill.name,
        target,
        text: rendered.content,
      });
      renderedRecords.set(target, renderedRecord);
      records.push(renderedRecord);
      records.push(
        await createDiscoveryFieldRecord({
          subject: executionRequest.subject,
          skill: validated.skill.name,
          target,
          name: validated.skill.source.name,
          description: validated.skill.source.description,
          invocationControls: targetControls(validated.skill, target),
        }),
      );
    }

    for (const scenario of validated.scenarios) {
      const rendered = targetRenderings.get(scenario.target);
      const renderedRecord = renderedRecords.get(scenario.target);
      if (!rendered || !renderedRecord)
        fail("render", "scenario target did not produce a rendered skill");
      const components: ExactTextRecord[] = [renderedRecord];
      for (const supportPath of scenario.supportPaths) {
        const supportKey = `${scenario.target}\u0000${supportPath}`;
        let supportRecord = supportRecords.get(supportKey);
        if (!supportRecord) {
          const support = await readDeclaredSupportFile({
            skill: validated.skill,
            target: scenario.target,
            path: supportPath,
          });
          supportRecord = await createExactTextRecord({
            kind: "support-file",
            subject: executionRequest.subject,
            skill: validated.skill.name,
            target: scenario.target,
            path: support.path,
            rawBytesSha256: support.rawBytesSha256,
            text: support.targetText,
          });
          supportRecords.set(supportKey, supportRecord);
          records.push(supportRecord);
        }
        components.push(supportRecord);
      }
      records.push(
        createScenarioRecord({
          name: scenario.name,
          subject: executionRequest.subject,
          skill: validated.skill.name,
          target: scenario.target,
          components,
        }),
      );
    }

    const envelope = await canonicalizeSkillContext({
      subject: executionRequest.subject,
      skill: validated.skill.name,
      targets: validated.targets,
      identities: identitiesFor(executionRequest.config),
      records,
    });
    let comparison: SkillContextComparison | undefined;
    if (validated.comparison !== undefined) {
      try {
        const prior = await readComparisonResult({
          repositoryRoot: executionRequest.repositoryRoot,
          resultPath: validated.comparison.path,
          expectedPayloadSha256: validated.comparison.expectedPayloadSha256,
        });
        comparison = await compareSkillContextEnvelopes(prior, envelope);
      } catch (error) {
        throw new AnalysisRunnerError(
          "comparison",
          `comparison failed: ${(error as Error).message}`,
        );
      }
    }
    const published = await publishEnvelope(executionRequest, envelope);
    return Object.freeze({
      path: published.relativePath,
      payloadSha256: envelope.payloadSha256,
      envelope,
      ...(comparison === undefined ? {} : { comparison }),
    });
  } catch (error) {
    if (error instanceof AnalysisRunnerError) throw error;
    const category =
      error instanceof AnalysisFilesError
        ? error.category === "comparison"
          ? "comparison"
          : error.category === "support-file"
            ? "file"
            : "publication"
        : "render";
    throw new AnalysisRunnerError(category, (error as Error).message);
  }
}

function validateRequest(request: SkillContextAnalysisRequest): {
  readonly skill: LoadedSkill;
  readonly skills: readonly LoadedSkill[];
  readonly agents: readonly LoadedAgent[];
  readonly targets: readonly AnalysisTarget[];
  readonly scenarios: readonly DeclaredAnalysisScenario[];
  readonly comparison?: SkillContextAnalysisComparison;
} {
  if (!request || typeof request !== "object")
    fail("request", "analysis request must be an object");
  assertExactKeys(
    request,
    [
      "config",
      "skills",
      "agents",
      "skill",
      "subject",
      "targets",
      "scenarios",
      "repositoryRoot",
      "resultDirectory",
      "comparison",
    ],
    "analysis request",
  );
  if (!Array.isArray(request.skills) || !Array.isArray(request.agents))
    fail("request", "validated skills and agents must be arrays");
  for (const skill of request.skills) {
    if (
      !skill ||
      typeof skill !== "object" ||
      typeof skill.name !== "string" ||
      typeof skill.dirPath !== "string" ||
      typeof skill.skillMdContent !== "string" ||
      !skill.source ||
      typeof skill.source !== "object" ||
      !Array.isArray(skill.subdirs)
    ) {
      fail("request", "validated skills must contain loaded-skill objects");
    }
  }
  for (const agent of request.agents) {
    if (
      !agent ||
      typeof agent !== "object" ||
      typeof agent.name !== "string" ||
      typeof agent.filePath !== "string" ||
      !agent.source ||
      typeof agent.source !== "object"
    ) {
      fail("request", "validated agents must contain loaded-agent objects");
    }
  }
  if (!SUBJECTS.includes(request.subject))
    fail("request", "analysis subject must be base or candidate");
  if (typeof request.skill !== "string" || request.skill.length === 0)
    fail("request", "selected skill must be nonempty");
  if (!Array.isArray(request.targets) || request.targets.length === 0)
    fail("request", "analysis requires one or both targets");
  const targets: AnalysisTarget[] = [...request.targets];
  if (
    targets.length > 2 ||
    new Set(targets).size !== targets.length ||
    targets.some((target) => !TARGETS.includes(target))
  ) {
    fail("request", "analysis targets must be unique known targets");
  }
  const matches = request.skills.filter(
    (skill) => skill.name === request.skill,
  );
  if (matches.length !== 1)
    fail(
      "request",
      "selected skill must appear exactly once in validated skills",
    );
  const [skill] = matches;
  if (
    !skill ||
    skill.source.name !== skill.name ||
    typeof skill.skillMdContent !== "string"
  ) {
    fail("request", "selected skill is not a valid loaded skill");
  }
  validateAbsolutePath(skill.dirPath, "skill bundle root");
  if (!request.config || typeof request.config !== "object")
    fail("request", "resolved config is required");
  validateAbsolutePath(request.repositoryRoot, "repository root");
  validateAbsolutePath(request.resultDirectory, "result directory");
  if (
    !isPathWithin(
      path.join(path.resolve(request.repositoryRoot), ".ephemeral"),
      path.resolve(request.resultDirectory),
    )
  ) {
    fail("request", "result directory must be inside repository .ephemeral");
  }
  for (const target of targets) {
    if (request.config.targets?.[target]?.enabled !== true)
      fail("request", `analysis target ${target} is disabled`);
  }
  if (!Array.isArray(request.scenarios))
    fail("request", "scenario declarations must be an array");
  const scenarioKeys = new Set<string>();
  for (const scenario of request.scenarios) {
    if (
      !scenario ||
      typeof scenario !== "object" ||
      typeof scenario.name !== "string" ||
      scenario.name.length === 0
    ) {
      fail("request", "scenario name must be nonempty");
    }
    validateSingleLineName(scenario.name, "scenario name");
    assertExactKeys(scenario, ["name", "target", "supportPaths"], "scenario");
    if (!targets.includes(scenario.target))
      fail("request", "scenario target must be selected");
    if (!Array.isArray(scenario.supportPaths))
      fail("request", "scenario support paths must be an array");
    const rawSupportPaths = new Set<string>();
    for (const supportPath of scenario.supportPaths) {
      if (typeof supportPath !== "string" || supportPath.length === 0)
        fail("request", "scenario support path must be nonempty");
      validateSupportVocabulary(supportPath, skill);
      if (rawSupportPaths.has(supportPath))
        fail("request", "duplicate raw support path declaration");
      rawSupportPaths.add(supportPath);
    }
    const key = `${scenario.target}\u0000${scenario.name}`;
    if (scenarioKeys.has(key))
      fail("request", "duplicate scenario declaration");
    scenarioKeys.add(key);
  }
  if (request.comparison !== undefined) {
    if (
      !request.comparison ||
      typeof request.comparison.path !== "string" ||
      !SHA256.test(request.comparison.expectedPayloadSha256)
    ) {
      fail(
        "request",
        "comparison requires an exact path and expected payload hash",
      );
    }
    assertExactKeys(
      request.comparison,
      ["path", "expectedPayloadSha256"],
      "comparison",
    );
    validateAbsolutePath(request.comparison.path, "comparison path");
    if (
      !isPathWithin(
        path.join(path.resolve(request.repositoryRoot), ".ephemeral"),
        path.resolve(request.comparison.path),
      )
    ) {
      fail("request", "comparison path must be inside repository .ephemeral");
    }
  }
  return Object.freeze({
    skill,
    skills: Object.freeze([...request.skills]),
    agents: Object.freeze([...request.agents]),
    targets: Object.freeze(targets),
    scenarios: Object.freeze(
      request.scenarios.map((scenario) =>
        Object.freeze({
          name: scenario.name,
          target: scenario.target,
          supportPaths: Object.freeze([...scenario.supportPaths]),
        }),
      ),
    ),
    ...(request.comparison === undefined
      ? {}
      : {
          comparison: Object.freeze({
            path: request.comparison.path,
            expectedPayloadSha256: request.comparison.expectedPayloadSha256,
          }),
        }),
  });
}

async function renderExactSkill(
  request: SkillContextAnalysisRequest,
  selected: LoadedSkill,
  target: AnalysisTarget,
): Promise<RenderedSkill> {
  const projection = await renderProjection(request, target);
  const matching = projection.outputs.filter(
    (output): output is RenderedSkill =>
      output.type === "skill" &&
      output.name === selected.name &&
      output.target === target,
  );
  if (matching.length !== 1)
    fail("render", "render must produce exactly one matching rendered skill");
  return matching[0];
}

async function renderProjection(
  request: SkillContextAnalysisRequest,
  target: AnalysisTarget,
) {
  try {
    return await renderLoaded({
      config: request.config,
      skills: request.skills,
      agents: request.agents,
      validatedSkills: request.skills,
      writeToGenerated: false,
      targetFilter: target,
    });
  } catch (error) {
    fail("render", `write-disabled render failed: ${(error as Error).message}`);
  }
}

async function publishEnvelope(
  request: SkillContextAnalysisRequest,
  envelope: SkillContextEnvelope,
) {
  try {
    return await publishAnalysisResult({
      repositoryRoot: request.repositoryRoot,
      resultDirectory: request.resultDirectory,
      envelope,
    });
  } catch (error) {
    throw new AnalysisRunnerError(
      "publication",
      `publication failed: ${(error as Error).message}`,
    );
  }
}

function targetControls(skill: LoadedSkill, target: AnalysisTarget): string[] {
  const controls: string[] = [];
  if (skill.source["allowed-tools"] !== undefined) {
    controls.push(`allowed-tools:${stableJson(skill.source["allowed-tools"])}`);
  }
  if (target === "claude") {
    for (const [key, value] of Object.entries(skill.source.claude ?? {})) {
      if (value !== undefined)
        controls.push(`claude.${key}:${stableJson(value)}`);
    }
  }
  if (target === "codex") {
    const sidecar = skill.source.codex_sidecar;
    if (sidecar?.policy !== undefined) {
      controls.push(`codex_sidecar.policy:${stableJson(sidecar.policy)}`);
    }
    if (sidecar?.dependencies !== undefined) {
      controls.push(
        `codex_sidecar.dependencies:${stableJson(sidecar.dependencies)}`,
      );
    }
    if (sidecar?.interface?.default_prompt !== undefined) {
      controls.push(
        `codex_sidecar.interface.default_prompt:${stableJson(sidecar.interface.default_prompt)}`,
      );
    }
  }
  return controls.sort(compareUtf8);
}

function identitiesFor(config: ResolvedConfig) {
  return Object.freeze({
    rendererSemantic: "devcanon-renderer/write-disabled-render-loaded/v1",
    renderConfigSha256: hash(
      stableJson({
        codexSkillDisplayNameSuffix:
          config.targets.codex.skillDisplayNameSuffix,
        capabilityProfiles: config.capabilityProfiles,
        toolNames: config.toolNames,
        fileArtifacts: config.fileArtifacts,
      }),
    ),
    analyzerSemantic: "devcanon-analysis/skill-context/v1",
    measureSkillPromptSemantic: "devcanon-measure-skill-prompt/v1",
    tokenizer: "o200k_base" as const,
    exactInputSerialization: "devcanon-exact-input/v1",
    scenarioAggregation: SCENARIO_AGGREGATION_ID,
  });
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort(compareUtf8)
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(",")}}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function compareUtf8(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(
  category: AnalysisRunnerError["category"],
  message: string,
): never {
  throw new AnalysisRunnerError(category, message);
}

function freezeDeep<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value as Record<string, unknown>)) {
    freezeDeep(child);
  }
  return Object.freeze(value);
}

function assertExactKeys(
  value: object,
  allowed: readonly string[],
  label: string,
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key))
      fail("request", `${label} contains unknown member ${key}`);
  }
}

function validateAbsolutePath(value: unknown, label: string): void {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    fail("request", `${label} must be an absolute path`);
  }
}

function validateSupportVocabulary(
  pathValue: string,
  skill: LoadedSkill,
): void {
  if (
    pathValue.includes("\\") ||
    pathValue.includes("\u0000") ||
    /[\r\n]/u.test(pathValue) ||
    path.posix.isAbsolute(pathValue)
  ) {
    fail(
      "request",
      "support path must be a normalized repository-style relative path",
    );
  }
  const segments = pathValue.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    ) ||
    !skill.subdirs.includes(segments[0])
  ) {
    fail("request", "support path must be under a declared skill subdirectory");
  }
}

function validateSingleLineName(value: string, label: string): void {
  if (value.includes("\u0000") || /[\r\n]/u.test(value)) {
    fail("request", `${label} must be a nonempty single-line string`);
  }
}

function isPathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      !relative.startsWith(`..${path.sep}`) &&
      relative !== "..")
  );
}
