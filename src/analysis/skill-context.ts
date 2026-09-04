import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  GPT_TOKEN_ESTIMATE_ENCODING,
  measureSkillPrompt,
} from "../utils/token-count.js";

export const ANALYSIS_PAYLOAD_SCHEMA = "devcanon-analysis/skill-context/v1";
export const ANALYSIS_RECORD_SCHEMA =
  "devcanon-analysis/skill-context-record/v1";
export const DISCOVERY_SERIALIZATION_ID =
  "devcanon-analysis/discovery-field/v1";
export const SCENARIO_AGGREGATION_ID = "devcanon-analysis/sum-of-components/v1";

const TARGETS = ["claude", "codex"] as const;
const SUBJECTS = ["base", "candidate"] as const;
const EXACT_KINDS = [
  "raw-source",
  "rendered-skill",
  "discovery-field",
  "support-file",
] as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export type AnalysisTarget = (typeof TARGETS)[number];
export type AnalysisSubject = (typeof SUBJECTS)[number];
export type ExactTextKind = (typeof EXACT_KINDS)[number];

export interface AnalysisIdentities {
  readonly rendererSemantic: string;
  readonly renderConfigSha256: string;
  readonly analyzerSemantic: string;
  readonly measureSkillPromptSemantic: string;
  readonly tokenizer: typeof GPT_TOKEN_ESTIMATE_ENCODING;
  readonly exactInputSerialization: string;
  readonly scenarioAggregation: typeof SCENARIO_AGGREGATION_ID;
}

interface ExactTextBase {
  readonly schema: typeof ANALYSIS_RECORD_SCHEMA;
  readonly key: string;
  readonly kind: ExactTextKind;
  readonly subject: AnalysisSubject;
  readonly skill: string;
  readonly target?: AnalysisTarget;
  readonly exactText: string;
  readonly exactInputSha256: string;
  readonly utf8Bytes: number;
  readonly tokenizer: typeof GPT_TOKEN_ESTIMATE_ENCODING;
  readonly estimatedTokens: number;
}

export interface RawSourceRecord extends ExactTextBase {
  readonly kind: "raw-source";
  readonly target?: undefined;
}

export interface RenderedSkillRecord extends ExactTextBase {
  readonly kind: "rendered-skill";
  readonly target: AnalysisTarget;
}

export interface DiscoveryFieldRecord extends ExactTextBase {
  readonly kind: "discovery-field";
  readonly target: AnalysisTarget;
  readonly name: string;
  readonly description: string;
  readonly invocationControls: readonly string[];
  readonly serialization: typeof DISCOVERY_SERIALIZATION_ID;
}

export interface SupportFileRecord extends ExactTextBase {
  readonly kind: "support-file";
  readonly target: AnalysisTarget;
  readonly path: string;
  readonly rawBytesSha256: string;
  readonly targetTextSha256: string;
}

export type ExactTextRecord =
  | RawSourceRecord
  | RenderedSkillRecord
  | DiscoveryFieldRecord
  | SupportFileRecord;

export interface ScenarioRecord {
  readonly schema: typeof ANALYSIS_RECORD_SCHEMA;
  readonly key: string;
  readonly kind: "declared-scenario";
  readonly subject: AnalysisSubject;
  readonly skill: string;
  readonly target: AnalysisTarget;
  readonly name: string;
  readonly aggregation: "sum-of-components";
  readonly componentKeys: readonly string[];
  readonly componentEstimatedTokensTotal: number;
}

export type SkillContextRecord = ExactTextRecord | ScenarioRecord;

export interface SkillContextPayload {
  readonly schema: typeof ANALYSIS_PAYLOAD_SCHEMA;
  readonly subject: AnalysisSubject;
  readonly skill: string;
  readonly targets: readonly AnalysisTarget[];
  readonly identities: AnalysisIdentities;
  readonly records: readonly SkillContextRecord[];
}

export interface SkillContextEnvelope {
  readonly payloadSha256: string;
  readonly payload: SkillContextPayload;
  /** Canonical UTF-8 envelope bytes; this is intentionally not serialized. */
  readonly bytes: Buffer;
}

export interface ExactTextRecordInput {
  readonly kind: Exclude<ExactTextKind, "discovery-field">;
  readonly subject: AnalysisSubject;
  readonly skill: string;
  readonly target?: AnalysisTarget;
  readonly text: string;
  readonly path?: string;
  readonly rawBytesSha256?: string;
}

export interface DiscoveryFieldRecordInput {
  readonly subject: AnalysisSubject;
  readonly skill: string;
  readonly target: AnalysisTarget;
  readonly name: string;
  readonly description: string;
  readonly invocationControls: readonly string[];
}

export interface ScenarioRecordInput {
  readonly name: string;
  readonly subject: AnalysisSubject;
  readonly skill: string;
  readonly target: AnalysisTarget;
  readonly components: readonly ExactTextRecord[];
}

export interface SkillContextPayloadInput {
  readonly subject: AnalysisSubject;
  readonly skill: string;
  readonly targets: readonly AnalysisTarget[];
  readonly identities: AnalysisIdentities;
  readonly records: readonly SkillContextRecord[];
}

export interface ComparisonMetric {
  readonly recordKey: string;
  readonly estimatedTokensDelta: number;
  readonly reductionNumerator: number;
  readonly reductionDenominator: number;
  readonly reduction: boolean;
  readonly reductionRatio?: {
    readonly numerator: number;
    readonly denominator: number;
  };
}

export interface SkillContextComparison {
  readonly basePayloadSha256: string;
  readonly candidatePayloadSha256: string;
  readonly metrics: readonly ComparisonMetric[];
}

export async function createExactTextRecord(
  input: ExactTextRecordInput,
): Promise<ExactTextRecord> {
  validateExactInput(input);
  const metrics = await measureSkillPrompt(input.text);
  if (metrics.encoding !== GPT_TOKEN_ESTIMATE_ENCODING) {
    fail("measureSkillPrompt returned an unsupported tokenizer");
  }
  validateSafeNonnegative(metrics.estimatedTokens, "estimatedTokens");
  validateSafeNonnegative(metrics.bytes, "UTF-8 byte length");

  const common = {
    schema: ANALYSIS_RECORD_SCHEMA,
    key: recordKey(
      input.kind,
      input.subject,
      input.skill,
      input.target,
      input.path,
    ),
    kind: input.kind,
    subject: input.subject,
    skill: input.skill,
    ...(input.target === undefined ? {} : { target: input.target }),
    exactText: input.text,
    exactInputSha256: sha256(input.text),
    utf8Bytes: metrics.bytes,
    tokenizer: GPT_TOKEN_ESTIMATE_ENCODING,
    estimatedTokens: metrics.estimatedTokens,
  } as const;

  if (input.kind === "support-file") {
    return freeze({
      ...common,
      kind: "support-file",
      target: input.target as AnalysisTarget,
      path: input.path as string,
      rawBytesSha256: input.rawBytesSha256 as string,
      targetTextSha256: common.exactInputSha256,
    });
  }
  if (input.kind === "rendered-skill") {
    return freeze({
      ...common,
      kind: "rendered-skill",
      target: input.target as AnalysisTarget,
    });
  }
  return freeze({
    schema: ANALYSIS_RECORD_SCHEMA,
    key: recordKey("raw-source", input.subject, input.skill),
    kind: "raw-source",
    subject: input.subject,
    skill: input.skill,
    exactText: input.text,
    exactInputSha256: common.exactInputSha256,
    utf8Bytes: metrics.bytes,
    tokenizer: GPT_TOKEN_ESTIMATE_ENCODING,
    estimatedTokens: metrics.estimatedTokens,
  });
}

export async function createDiscoveryFieldRecord(
  input: DiscoveryFieldRecordInput,
): Promise<DiscoveryFieldRecord> {
  validateSubject(input.subject);
  validateName(input.skill, "skill");
  validateTarget(input.target);
  validateName(input.name, "discovery name");
  validateName(input.description, "discovery description");
  const controls = [...input.invocationControls];
  for (const control of controls)
    validateSingleLine(control, "invocation control");
  const controlSet = new Set<string>();
  for (const control of controls) {
    if (controlSet.has(control)) fail("duplicate invocation control");
    controlSet.add(control);
  }
  const canonicalControls = controls.sort(compareUtf8);
  const exactText = serializeDiscoveryText(input.name, input.description);
  const metrics = await measureSkillPrompt(exactText);
  validateSafeNonnegative(metrics.estimatedTokens, "estimatedTokens");
  return freeze({
    schema: ANALYSIS_RECORD_SCHEMA,
    key: recordKey("discovery-field", input.subject, input.skill, input.target),
    kind: "discovery-field",
    subject: input.subject,
    skill: input.skill,
    target: input.target,
    exactText,
    exactInputSha256: sha256(exactText),
    utf8Bytes: metrics.bytes,
    tokenizer: GPT_TOKEN_ESTIMATE_ENCODING,
    estimatedTokens: metrics.estimatedTokens,
    name: input.name,
    description: input.description,
    invocationControls: freeze(canonicalControls),
    serialization: DISCOVERY_SERIALIZATION_ID,
  });
}

export function serializeDiscoveryText(
  name: string,
  description: string,
): string {
  validateName(name, "discovery name");
  validateName(description, "discovery description");
  return JSON.stringify({ name, description });
}

export function createScenarioRecord(
  input: ScenarioRecordInput,
): ScenarioRecord {
  validateName(input.name, "scenario name");
  validateSubject(input.subject);
  validateName(input.skill, "skill");
  validateTarget(input.target);
  if (!Array.isArray(input.components))
    fail("scenario components must be an array");

  let rendered: RenderedSkillRecord | undefined;
  const supportPaths = new Set<string>();
  const componentKeys = new Set<string>();
  let total = 0;
  for (const component of input.components) {
    validateExactTextRecord(component);
    if (component.subject !== input.subject)
      fail("scenario component subject mismatch");
    if (component.skill !== input.skill)
      fail("scenario component skill mismatch");
    if (component.target !== input.target)
      fail("scenario component target mismatch");
    if (componentKeys.has(component.key))
      fail("duplicate scenario component key");
    componentKeys.add(component.key);
    if (component.kind === "rendered-skill") {
      if (rendered !== undefined)
        fail("duplicate rendered-skill scenario component");
      rendered = component;
    } else if (component.kind === "support-file") {
      if (supportPaths.has(component.path))
        fail("duplicate normalized support path");
      supportPaths.add(component.path);
    } else {
      fail(
        "scenario components must be rendered-skill or support-file records",
      );
    }
    total = checkedAdd(
      total,
      component.estimatedTokens,
      "scenario component total",
    );
  }
  if (rendered === undefined)
    fail("scenario requires exactly one rendered-skill component");

  return freeze({
    schema: ANALYSIS_RECORD_SCHEMA,
    key: recordKey(
      "declared-scenario",
      input.subject,
      input.skill,
      input.target,
      input.name,
    ),
    kind: "declared-scenario",
    subject: input.subject,
    skill: input.skill,
    target: input.target,
    name: input.name,
    aggregation: "sum-of-components",
    componentKeys: freeze([...componentKeys].sort(compareUtf8)),
    componentEstimatedTokensTotal: total,
  });
}

export function canonicalizeSkillContext(
  input: SkillContextPayloadInput,
): SkillContextEnvelope {
  const payload = createCanonicalPayload(input);
  const payloadBytes = Buffer.from(`${JSON.stringify(payload)}\n`, "utf8");
  const payloadSha256 = sha256(payloadBytes);
  const envelope = { payloadSha256, payload } as const;
  const bytes = Buffer.from(`${JSON.stringify(envelope)}\n`, "utf8");
  return withBytes(envelope, bytes);
}

export function parseCanonicalSkillContextEnvelope(
  bytes: Uint8Array,
): SkillContextEnvelope {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("envelope bytes are not valid UTF-8");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("envelope bytes are not valid JSON");
  }
  const envelope = validateEnvelopeObject(parsed, Buffer.from(bytes));
  return envelope;
}

export function compareSkillContextEnvelopes(
  first: SkillContextEnvelope,
  second: SkillContextEnvelope,
): SkillContextComparison {
  const left = validateEnvelopeObject(first, first.bytes);
  const right = validateEnvelopeObject(second, second.bytes);
  if (left.payload.subject === right.payload.subject) {
    fail("comparison requires one base and one candidate envelope");
  }
  const base = left.payload.subject === "base" ? left : right;
  const candidate = left.payload.subject === "candidate" ? left : right;
  if (base.payload.skill !== candidate.payload.skill)
    fail("comparison skill mismatch");
  if (!sameArray(base.payload.targets, candidate.payload.targets)) {
    fail("comparison target mismatch");
  }
  if (!sameIdentities(base.payload.identities, candidate.payload.identities)) {
    fail("comparison identity mismatch");
  }

  const baseRecords = new Map(
    base.payload.records.map((record) => [record.key, record]),
  );
  const candidateRecords = new Map(
    candidate.payload.records.map((record) => [record.key, record]),
  );
  if (baseRecords.size !== candidateRecords.size)
    fail("comparison record-set mismatch");
  for (const key of baseRecords.keys()) {
    if (!candidateRecords.has(key)) fail("comparison record-set mismatch");
  }

  const metrics: ComparisonMetric[] = [];
  for (const key of [...baseRecords.keys()].sort(compareUtf8)) {
    const baseRecord = baseRecords.get(key) as SkillContextRecord;
    const candidateRecord = candidateRecords.get(key) as SkillContextRecord;
    if (baseRecord.kind !== candidateRecord.kind)
      fail("comparison record kind mismatch");
    const baseValue = metricValue(baseRecord);
    const candidateValue = metricValue(candidateRecord);
    const estimatedTokensDelta = checkedSubtract(
      candidateValue,
      baseValue,
      "comparison delta",
    );
    const reductionNumerator = checkedSubtract(
      baseValue,
      candidateValue,
      "comparison reduction numerator",
    );
    const reductionDenominator = baseValue;
    const reduction = candidateValue < baseValue;
    metrics.push(
      freeze({
        recordKey: key,
        estimatedTokensDelta,
        reductionNumerator,
        reductionDenominator,
        reduction,
        ...(baseValue === 0
          ? {}
          : {
              reductionRatio: freeze({
                numerator: reductionNumerator,
                denominator: reductionDenominator,
              }),
            }),
      }),
    );
  }
  return freeze({
    basePayloadSha256: base.payloadSha256,
    candidatePayloadSha256: candidate.payloadSha256,
    metrics: freeze(metrics),
  });
}

function createCanonicalPayload(
  input: SkillContextPayloadInput,
): SkillContextPayload {
  validateSubject(input.subject);
  validateName(input.skill, "skill");
  validateIdentities(input.identities);
  if (!Array.isArray(input.targets) || !Array.isArray(input.records)) {
    fail("payload targets and records must be arrays");
  }
  const targets = uniqueSortedTargets(input.targets);
  const records = [...input.records];
  const keys = new Set<string>();
  let rawCount = 0;
  const renderedTargets = new Set<AnalysisTarget>();
  const discoveryTargets = new Set<AnalysisTarget>();
  for (const record of records) {
    validateRecord(record);
    if (record.subject !== input.subject || record.skill !== input.skill) {
      fail("record subject or skill mismatch");
    }
    if (keys.has(record.key)) fail("duplicate record key");
    keys.add(record.key);
    if (record.kind === "raw-source") rawCount += 1;
    if (record.kind === "rendered-skill") renderedTargets.add(record.target);
    if (record.kind === "discovery-field") discoveryTargets.add(record.target);
    if (record.target !== undefined && !targets.includes(record.target)) {
      fail("record target is absent from payload targets");
    }
  }
  if (rawCount !== 1) fail("payload requires exactly one raw-source record");
  for (const target of targets) {
    if (!renderedTargets.has(target) || !discoveryTargets.has(target)) {
      fail(
        "payload requires rendered-skill and discovery-field records per target",
      );
    }
  }
  const recordsByKey = new Map(records.map((record) => [record.key, record]));
  for (const record of records) {
    if (record.kind !== "declared-scenario") continue;
    const components = record.componentKeys.map((key: string) => {
      const component = recordsByKey.get(key);
      if (component === undefined || component.kind === "declared-scenario") {
        fail("scenario references an unknown or aggregate component");
      }
      return component;
    });
    const rebuilt = createScenarioRecord({
      name: record.name,
      subject: record.subject,
      skill: record.skill,
      target: record.target,
      components,
    });
    if (JSON.stringify(rebuilt) !== JSON.stringify(record)) {
      fail("scenario aggregation mismatch");
    }
  }
  return freeze({
    schema: ANALYSIS_PAYLOAD_SCHEMA,
    subject: input.subject,
    skill: input.skill,
    targets: freeze(targets),
    identities: freeze({
      rendererSemantic: input.identities.rendererSemantic,
      renderConfigSha256: input.identities.renderConfigSha256,
      analyzerSemantic: input.identities.analyzerSemantic,
      measureSkillPromptSemantic: input.identities.measureSkillPromptSemantic,
      tokenizer: input.identities.tokenizer,
      exactInputSerialization: input.identities.exactInputSerialization,
      scenarioAggregation: input.identities.scenarioAggregation,
    }),
    records: freeze(
      records
        .sort((left, right) => compareUtf8(left.key, right.key))
        .map(canonicalizeRecord),
    ),
  });
}

function canonicalizeRecord(record: SkillContextRecord): SkillContextRecord {
  if (record.kind === "declared-scenario") {
    return freeze({
      schema: ANALYSIS_RECORD_SCHEMA,
      key: record.key,
      kind: "declared-scenario",
      subject: record.subject,
      skill: record.skill,
      target: record.target,
      name: record.name,
      aggregation: "sum-of-components",
      componentKeys: freeze([...record.componentKeys]),
      componentEstimatedTokensTotal: record.componentEstimatedTokensTotal,
    });
  }
  const common = {
    schema: ANALYSIS_RECORD_SCHEMA,
    key: record.key,
    kind: record.kind,
    subject: record.subject,
    skill: record.skill,
    ...(record.target === undefined ? {} : { target: record.target }),
    exactText: record.exactText,
    exactInputSha256: record.exactInputSha256,
    utf8Bytes: record.utf8Bytes,
    tokenizer: GPT_TOKEN_ESTIMATE_ENCODING,
    estimatedTokens: record.estimatedTokens,
  } as const;
  if (record.kind === "discovery-field") {
    return freeze({
      ...common,
      kind: "discovery-field",
      target: record.target,
      name: record.name,
      description: record.description,
      invocationControls: freeze([...record.invocationControls]),
      serialization: DISCOVERY_SERIALIZATION_ID,
    });
  }
  if (record.kind === "support-file") {
    return freeze({
      ...common,
      kind: "support-file",
      target: record.target,
      path: record.path,
      rawBytesSha256: record.rawBytesSha256,
      targetTextSha256: record.targetTextSha256,
    });
  }
  if (record.kind === "rendered-skill") {
    return freeze({ ...common, kind: "rendered-skill", target: record.target });
  }
  return freeze({
    schema: ANALYSIS_RECORD_SCHEMA,
    key: record.key,
    kind: "raw-source",
    subject: record.subject,
    skill: record.skill,
    exactText: record.exactText,
    exactInputSha256: record.exactInputSha256,
    utf8Bytes: record.utf8Bytes,
    tokenizer: GPT_TOKEN_ESTIMATE_ENCODING,
    estimatedTokens: record.estimatedTokens,
  });
}

function validateEnvelopeObject(
  value: unknown,
  bytes: Buffer,
): SkillContextEnvelope {
  if (!isObject(value)) fail("comparison envelope must be an object");
  requireKeys(value, ["payloadSha256", "payload"]);
  if (!isSha256(value.payloadSha256)) fail("invalid envelope hash");
  const payload = validatePayload(value.payload);
  const payloadBytes = Buffer.from(`${JSON.stringify(payload)}\n`, "utf8");
  if (sha256(payloadBytes) !== value.payloadSha256)
    fail("envelope self-hash mismatch");
  const canonical = Buffer.from(
    `${JSON.stringify({ payloadSha256: value.payloadSha256, payload })}\n`,
    "utf8",
  );
  if (!canonical.equals(bytes)) fail("noncanonical envelope bytes");
  return withBytes({ payloadSha256: value.payloadSha256, payload }, canonical);
}

function validatePayload(value: unknown): SkillContextPayload {
  if (!isObject(value)) fail("payload must be an object");
  requireKeys(value, [
    "schema",
    "subject",
    "skill",
    "targets",
    "identities",
    "records",
  ]);
  if (value.schema !== ANALYSIS_PAYLOAD_SCHEMA) fail("unknown payload schema");
  const input = {
    subject: value.subject,
    skill: value.skill,
    targets: value.targets,
    identities: value.identities,
    records: value.records,
  } as unknown as SkillContextPayloadInput;
  const canonical = createCanonicalPayload(input);
  if (JSON.stringify(canonical) !== JSON.stringify(value))
    fail("noncanonical payload");
  return canonical;
}

function validateRecord(record: unknown): asserts record is SkillContextRecord {
  if (!isObject(record) || typeof record.kind !== "string")
    fail("unknown record");
  if (record.kind === "declared-scenario") {
    requireKeys(record, [
      "schema",
      "key",
      "kind",
      "subject",
      "skill",
      "target",
      "name",
      "aggregation",
      "componentKeys",
      "componentEstimatedTokensTotal",
    ]);
    if (
      record.schema !== ANALYSIS_RECORD_SCHEMA ||
      record.aggregation !== "sum-of-components"
    ) {
      fail("unknown scenario record schema or aggregation");
    }
    validateCommonRecordIdentity(record, true);
    validateName(record.name, "scenario name");
    if (
      !Array.isArray(record.componentKeys) ||
      record.componentKeys.length === 0
    ) {
      fail("scenario component keys must be nonempty");
    }
    const unique = new Set<string>();
    for (const key of record.componentKeys) {
      validateName(key, "scenario component key");
      if (unique.has(key)) fail("duplicate scenario component key");
      unique.add(key);
    }
    if (!sameArray(record.componentKeys, [...unique].sort(compareUtf8))) {
      fail("noncanonical scenario component order");
    }
    validateSafeNonnegative(
      record.componentEstimatedTokensTotal,
      "scenario component total",
    );
    if (
      record.key !==
      recordKey(
        record.kind,
        record.subject as AnalysisSubject,
        record.skill as string,
        record.target as AnalysisTarget,
        record.name as string,
      )
    ) {
      fail("scenario record key mismatch");
    }
    return;
  }
  if (!EXACT_KINDS.includes(record.kind as ExactTextKind))
    fail("unknown exact-text record kind");
  validateExactTextRecord(record as unknown as ExactTextRecord);
}

function validateExactTextRecord(record: ExactTextRecord): void {
  if (!isObject(record)) fail("exact-text record must be an object");
  const kind = record.kind;
  const keys = [
    "schema",
    "key",
    "kind",
    "subject",
    "skill",
    "exactText",
    "exactInputSha256",
    "utf8Bytes",
    "tokenizer",
    "estimatedTokens",
  ];
  if (kind !== "raw-source") keys.splice(5, 0, "target");
  if (kind === "discovery-field") {
    keys.push("name", "description", "invocationControls", "serialization");
  }
  if (kind === "support-file")
    keys.push("path", "rawBytesSha256", "targetTextSha256");
  requireKeys(record, keys);
  if (!EXACT_KINDS.includes(kind)) fail("unknown exact-text record kind");
  if (record.schema !== ANALYSIS_RECORD_SCHEMA)
    fail("unknown exact-text record schema");
  validateCommonRecordIdentity(record, kind !== "raw-source");
  if (typeof record.exactText !== "string" || record.exactText.length === 0) {
    fail("exact text must be nonempty");
  }
  if (
    !isSha256(record.exactInputSha256) ||
    record.exactInputSha256 !== sha256(record.exactText)
  ) {
    fail("exact input hash mismatch");
  }
  if (record.utf8Bytes !== Buffer.byteLength(record.exactText, "utf8")) {
    fail("UTF-8 byte length mismatch");
  }
  if (record.tokenizer !== GPT_TOKEN_ESTIMATE_ENCODING)
    fail("unsupported tokenizer");
  validateSafeNonnegative(record.estimatedTokens, "estimatedTokens");
  if (
    record.key !==
    recordKey(
      kind,
      record.subject,
      record.skill,
      record.target,
      record.kind === "support-file" ? record.path : undefined,
    )
  ) {
    fail("exact-text record key mismatch");
  }
  if (kind === "discovery-field")
    validateDiscoveryRecord(record as DiscoveryFieldRecord);
  if (kind === "support-file")
    validateSupportRecord(record as SupportFileRecord);
}

function validateDiscoveryRecord(record: DiscoveryFieldRecord): void {
  validateName(record.name, "discovery name");
  validateName(record.description, "discovery description");
  if (record.serialization !== DISCOVERY_SERIALIZATION_ID)
    fail("unknown discovery serialization");
  if (
    record.exactText !== serializeDiscoveryText(record.name, record.description)
  ) {
    fail("discovery exact text mismatch");
  }
  if (!Array.isArray(record.invocationControls))
    fail("invocation controls must be an array");
  for (const control of record.invocationControls) {
    validateSingleLine(control, "invocation control");
  }
}

function validateSupportRecord(record: SupportFileRecord): void {
  validateNormalizedPath(record.path);
  if (!isSha256(record.rawBytesSha256) || !isSha256(record.targetTextSha256)) {
    fail("support identity must be SHA-256");
  }
  if (record.targetTextSha256 !== record.exactInputSha256) {
    fail("support target-text identity mismatch");
  }
}

function validateExactInput(input: ExactTextRecordInput): void {
  if (
    !isObject(input) ||
    !EXACT_KINDS.includes(input.kind as ExactTextKind) ||
    (input.kind as unknown) === "discovery-field"
  ) {
    fail("unknown exact-text record kind");
  }
  validateSubject(input.subject);
  validateName(input.skill, "skill");
  if (typeof input.text !== "string" || input.text.length === 0)
    fail("exact text must be nonempty");
  if (input.kind === "raw-source") {
    if (
      input.target !== undefined ||
      input.path !== undefined ||
      input.rawBytesSha256 !== undefined
    ) {
      fail("raw-source records cannot carry target or support metadata");
    }
    return;
  }
  validateTarget(input.target);
  if (input.kind === "rendered-skill") {
    if (input.path !== undefined || input.rawBytesSha256 !== undefined) {
      fail("rendered-skill records cannot carry support metadata");
    }
    return;
  }
  validateNormalizedPath(input.path);
  if (!isSha256(input.rawBytesSha256))
    fail("support raw-byte identity must be SHA-256");
}

function validateCommonRecordIdentity(
  record: Record<string, unknown>,
  requiresTarget: boolean,
): void {
  validateSubject(record.subject);
  validateName(record.skill, "skill");
  validateName(record.key, "record key");
  if (requiresTarget) validateTarget(record.target);
  else if (record.target !== undefined)
    fail("raw-source records cannot have a target");
}

function validateIdentities(
  value: unknown,
): asserts value is AnalysisIdentities {
  if (!isObject(value)) fail("identities must be an object");
  requireKeys(value, [
    "rendererSemantic",
    "renderConfigSha256",
    "analyzerSemantic",
    "measureSkillPromptSemantic",
    "tokenizer",
    "exactInputSerialization",
    "scenarioAggregation",
  ]);
  validateName(value.rendererSemantic, "renderer semantic identity");
  if (!isSha256(value.renderConfigSha256))
    fail("render config identity must be SHA-256");
  validateName(value.analyzerSemantic, "analyzer semantic identity");
  validateName(
    value.measureSkillPromptSemantic,
    "measureSkillPrompt semantic identity",
  );
  if (value.tokenizer !== GPT_TOKEN_ESTIMATE_ENCODING)
    fail("unsupported tokenizer identity");
  validateName(
    value.exactInputSerialization,
    "exact-input serialization identity",
  );
  if (value.scenarioAggregation !== SCENARIO_AGGREGATION_ID) {
    fail("unknown scenario aggregation identity");
  }
}

function uniqueSortedTargets(
  targets: readonly AnalysisTarget[],
): AnalysisTarget[] {
  const seen = new Set<AnalysisTarget>();
  for (const target of targets) {
    validateTarget(target);
    if (seen.has(target)) fail("duplicate payload target");
    seen.add(target);
  }
  return [...seen].sort(compareUtf8);
}

function metricValue(record: SkillContextRecord): number {
  const value =
    record.kind === "declared-scenario"
      ? record.componentEstimatedTokensTotal
      : record.estimatedTokens;
  validateSafeNonnegative(value, "comparison metric");
  return value;
}

function recordKey(
  kind: string,
  _subject: AnalysisSubject,
  skill: string,
  target?: AnalysisTarget,
  suffix?: string,
): string {
  return [kind, skill, target, suffix]
    .filter((part): part is string => part !== undefined)
    .join(":");
}

function sameIdentities(
  left: AnalysisIdentities,
  right: AnalysisIdentities,
): boolean {
  return (
    left.rendererSemantic === right.rendererSemantic &&
    left.renderConfigSha256 === right.renderConfigSha256 &&
    left.analyzerSemantic === right.analyzerSemantic &&
    left.measureSkillPromptSemantic === right.measureSkillPromptSemantic &&
    left.tokenizer === right.tokenizer &&
    left.exactInputSerialization === right.exactInputSerialization &&
    left.scenarioAggregation === right.scenarioAggregation
  );
}

function checkedAdd(left: number, right: number, label: string): number {
  validateSafeNonnegative(left, label);
  validateSafeNonnegative(right, label);
  const result = left + right;
  if (!Number.isSafeInteger(result)) fail(`${label} overflow`);
  return result;
}

function checkedSubtract(left: number, right: number, label: string): number {
  validateSafeNonnegative(left, label);
  validateSafeNonnegative(right, label);
  const result = left - right;
  if (!Number.isSafeInteger(result)) fail(`${label} overflow`);
  return result;
}

function validateSafeNonnegative(
  value: unknown,
  label: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a nonnegative safe integer`);
  }
}

function validateSubject(value: unknown): asserts value is AnalysisSubject {
  if (!SUBJECTS.includes(value as AnalysisSubject)) fail("unknown subject");
}

function validateTarget(value: unknown): asserts value is AnalysisTarget {
  if (!TARGETS.includes(value as AnalysisTarget)) fail("unknown target");
}

function validateName(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    /[\r\n]/u.test(value) ||
    value.includes("\u0000")
  ) {
    fail(`${label} must be a nonempty single-line string`);
  }
}

function validateSingleLine(
  value: unknown,
  label: string,
): asserts value is string {
  validateName(value, label);
}

function validateNormalizedPath(value: unknown): asserts value is string {
  validateName(value, "support path");
  if (
    value.includes("\\") ||
    value.startsWith("/") ||
    value
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    fail("support path must be normalized bundle-relative path");
  }
}

function requireKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Object.keys(value).sort(compareUtf8);
  const sortedExpected = [...expected].sort(compareUtf8);
  if (!sameArray(actual, sortedExpected))
    fail("unknown or missing object members");
}

function sameArray<T>(left: readonly T[], right: readonly T[]): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withBytes(
  envelope: {
    readonly payloadSha256: string;
    readonly payload: SkillContextPayload;
  },
  bytes: Buffer,
): SkillContextEnvelope {
  const result = { ...envelope } as SkillContextEnvelope;
  Object.defineProperty(result, "bytes", {
    value: Buffer.from(bytes),
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(result);
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function fail(message: string): never {
  throw new Error(`skill-context: ${message}`);
}
