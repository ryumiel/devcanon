import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { MANIFEST_MANAGED_BY } from "../config/identity.js";
import {
  type ManagedRecord,
  type Manifest,
  ManifestSchema,
} from "../config/schema.js";
import { UserError } from "../utils/errors.js";
import { ensureDir } from "../utils/fs.js";

const activeBackupAuthorities = new Map<string, ManifestBackupAuthority>();
const authorityState = new WeakMap<ManifestBackupAuthority, AuthorityState>();
const validSnapshots = new WeakSet<ManifestSnapshot>();
type ManifestFaultStage =
  | "backup-open"
  | "backup-write"
  | "backup-sync"
  | "backup-close"
  | "backup-readback"
  | "replacement-write"
  | "replacement-sync"
  | "replacement-close"
  | "replacement-freshness"
  | "replacement-rename"
  | "save-before-lock"
  | "recovery-before-candidate"
  | "recovery-after-candidate"
  | "recovery-candidate-open"
  | "recovery-candidate-write"
  | "recovery-candidate-sync"
  | "recovery-candidate-close"
  | "recovery-candidate-stat"
  | "recovery-candidate-readback"
  | "recovery-retirement";
type ManifestFaultInjector = (
  stage: ManifestFaultStage,
) => void | Promise<void>;
let manifestFaultInjector: ManifestFaultInjector | undefined;
interface PersistenceStatIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly mode: number;
  readonly size: number;
  readonly isFile: boolean;
  readonly isSymbolicLink: boolean;
}

type CloseProbeSample =
  | Readonly<{ kind: "stat-ok"; identity: PersistenceStatIdentity }>
  | Readonly<{ kind: "stat-rejected"; error: unknown }>;

type UnlinkProbeSample =
  | Readonly<{ kind: "present"; identity: PersistenceStatIdentity }>
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "lstat-error"; error: unknown }>;

type PrimitiveSettlement =
  | Readonly<{ status: "fulfilled" }>
  | Readonly<{ status: "rejected"; error: unknown }>;

type PersistenceErrorEvidence = Readonly<
  | {
      kind: "error";
      name: string;
      message: string;
      code?: string;
    }
  | { kind: "unknown"; type: string }
  | { kind: "unreadable" }
>;

type ProjectedCloseProbeSample =
  | Readonly<{ kind: "stat-ok"; identity: PersistenceStatIdentity }>
  | Readonly<{ kind: "stat-rejected"; error: PersistenceErrorEvidence }>;

type ProjectedUnlinkProbeSample =
  | Readonly<{ kind: "present"; identity: PersistenceStatIdentity }>
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "lstat-error"; error: PersistenceErrorEvidence }>;

type ProjectedPrimitiveSettlement =
  | Readonly<{ status: "fulfilled" }>
  | Readonly<{ status: "rejected"; error: PersistenceErrorEvidence }>;

type ProjectedAttemptAtom = Readonly<{
  kind: "primitive" | "synthetic";
  error: PersistenceErrorEvidence;
}>;

type PersistenceObservation =
  | Readonly<{
      attemptId: number;
      operation: "candidate-close" | "recovery-lock-close";
      targetPath: string;
      before: ProjectedCloseProbeSample;
      primitive: ProjectedPrimitiveSettlement;
      after: ProjectedCloseProbeSample;
      atoms: readonly ProjectedAttemptAtom[];
    }>
  | Readonly<{
      attemptId: number;
      operation: "recovery-lock-unlink";
      targetPath: string;
      before: ProjectedUnlinkProbeSample;
      primitive: ProjectedPrimitiveSettlement;
      after: ProjectedUnlinkProbeSample;
      atoms: readonly ProjectedAttemptAtom[];
    }>;

interface PostAttemptOutcomeRequest {
  readonly attemptId: number;
  readonly operation: "recovery-lock-close" | "recovery-lock-unlink";
  readonly primitive: ProjectedPrimitiveSettlement;
}

interface CombinationProbe {
  readonly primary?: string;
  readonly primitive?: string;
  readonly synthetic?: string;
}

interface ProjectedCombinationProbe {
  readonly atoms: readonly Readonly<{
    kind: "primary" | "primitive" | "synthetic";
    label: string;
  }>[];
}

interface PersistenceHarnessDiagnostics {
  readonly observations: readonly PersistenceObservation[];
  readonly errors: readonly PersistenceErrorEvidence[];
  readonly combinationProbes: readonly ProjectedCombinationProbe[];
}

interface ManifestPersistenceTestHooks {
  readonly observe?: (
    observation: PersistenceObservation,
  ) => void | PromiseLike<void>;
  readonly injectPostAttemptOutcome?: (
    request: Readonly<PostAttemptOutcomeRequest>,
  ) => Error | undefined;
  readonly combinationProbes?: readonly CombinationProbe[];
  readonly settleDiagnostics?: (
    diagnostics: PersistenceHarnessDiagnostics,
  ) => void | PromiseLike<void>;
}

type AttemptFailure =
  | Readonly<{
      kind: "primitive";
      primary: unknown;
      errors: readonly [unknown];
    }>
  | Readonly<{
      kind: "injected";
      primary: Error;
      errors: readonly [Error];
    }>
  | Readonly<{
      kind: "combined";
      primary: unknown;
      errors: readonly [unknown, Error];
    }>;

type SeamDiagnosticEntry =
  | Readonly<{ kind: "settled"; error: unknown }>
  | Readonly<{
      kind: "pending";
      promise: Promise<ProjectedPendingDiagnostic | undefined>;
    }>;

type ProjectedPendingDiagnostic = Readonly<{
  kind: "projected";
  evidence: PersistenceErrorEvidence;
}>;

interface PersistenceTestContext {
  readonly observe?: ManifestPersistenceTestHooks["observe"];
  readonly injectPostAttemptOutcome?: ManifestPersistenceTestHooks["injectPostAttemptOutcome"];
  readonly settleDiagnostics?: ManifestPersistenceTestHooks["settleDiagnostics"];
  readonly combinationProbes: readonly ProjectedCombinationProbe[];
  readonly observations: PersistenceObservation[];
  readonly seamDiagnostics: SeamDiagnosticEntry[];
  nextAttemptId: number;
}

let persistenceTestContext: PersistenceTestContext | undefined;
let persistenceTestOwner: symbol | undefined;

/** @internal Scoped, test-only deterministic persistence fault seam. */
export async function withManifestPersistenceFaultsForTesting<T>(
  injector: ManifestFaultInjector,
  callback: () => Promise<T>,
  testHooks?: ManifestPersistenceTestHooks,
): Promise<T> {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Manifest persistence fault injection is test-only");
  }
  if (manifestFaultInjector || persistenceTestContext || persistenceTestOwner) {
    throw new Error(
      "Manifest persistence fault injection does not support nesting",
    );
  }
  const owner = Symbol("manifest-persistence-test-owner");
  persistenceTestOwner = owner;
  let context: PersistenceTestContext | undefined;
  try {
    const initialDiagnostics: SeamDiagnosticEntry[] = [];
    const capturedHooks = captureManifestTestHooks(
      testHooks,
      initialDiagnostics,
    );
    context = {
      ...capturedHooks,
      observations: [],
      seamDiagnostics: initialDiagnostics,
      nextAttemptId: 0,
    };
    manifestFaultInjector = injector;
    persistenceTestContext = context;
    let callbackResult: T | undefined;
    let callbackError: unknown;
    let callbackFailed = false;
    try {
      callbackResult = await callback();
    } catch (error) {
      callbackFailed = true;
      callbackError = error;
    }

    const observations = Object.freeze([...context.observations]);
    const observe = context.observe;
    const settleDiagnostics = context.settleDiagnostics;
    const combinationProbes = context.combinationProbes;

    // Detach all recording state before any user-provided observer runs.
    detachPersistenceTestContext(owner, context);

    const seamErrors: PersistenceErrorEvidence[] = [];
    for (const entry of context.seamDiagnostics) {
      if (entry.kind === "settled") {
        seamErrors.push(projectErrorEvidence(entry.error));
        continue;
      }
      const projected = await entry.promise;
      if (projected !== undefined) seamErrors.push(projected.evidence);
    }

    if (observe) {
      for (const observation of observations) {
        try {
          await assimilatePromiseLike(observe(observation));
        } catch (error) {
          seamErrors.push(projectErrorEvidence(error));
        }
      }
    }

    const diagnostics = Object.freeze({
      observations,
      errors: Object.freeze(seamErrors),
      combinationProbes,
    });
    if (settleDiagnostics) {
      try {
        await assimilatePromiseLike(settleDiagnostics(diagnostics));
      } catch {
        // Diagnostics delivery cannot affect the production operation channel.
      }
    }

    if (callbackFailed) throw callbackError;
    return callbackResult as T;
  } finally {
    detachPersistenceTestContext(owner, context);
  }
}

function detachPersistenceTestContext(
  owner: symbol,
  context: PersistenceTestContext | undefined,
): void {
  if (persistenceTestOwner !== owner) return;
  persistenceTestOwner = undefined;
  if (context === undefined || persistenceTestContext === context) {
    manifestFaultInjector = undefined;
    persistenceTestContext = undefined;
  }
}

function captureManifestTestHooks(
  hooks: ManifestPersistenceTestHooks | undefined,
  diagnostics: SeamDiagnosticEntry[],
): Pick<
  PersistenceTestContext,
  | "observe"
  | "injectPostAttemptOutcome"
  | "settleDiagnostics"
  | "combinationProbes"
> {
  if (!hooks) {
    return { combinationProbes: Object.freeze([]) };
  }

  // Read every accessor exactly once under containment before the operation.
  const settleDiagnostics = captureHookFunction(
    hooks,
    "settleDiagnostics",
    diagnostics,
  ) as ManifestPersistenceTestHooks["settleDiagnostics"];
  const observe = captureHookFunction(hooks, "observe", diagnostics) as
    | ManifestPersistenceTestHooks["observe"]
    | undefined;
  const rawCombinationProbes = captureHookProperty(
    hooks,
    "combinationProbes",
    diagnostics,
  );
  const injectPostAttemptOutcome = captureHookFunction(
    hooks,
    "injectPostAttemptOutcome",
    diagnostics,
  ) as ManifestPersistenceTestHooks["injectPostAttemptOutcome"];

  return {
    observe,
    injectPostAttemptOutcome,
    settleDiagnostics,
    combinationProbes: projectCombinationProbes(
      rawCombinationProbes,
      diagnostics,
    ),
  };
}

function captureHookFunction(
  hooks: ManifestPersistenceTestHooks,
  property: "observe" | "injectPostAttemptOutcome" | "settleDiagnostics",
  diagnostics: SeamDiagnosticEntry[],
): unknown {
  const value = captureHookProperty(hooks, property, diagnostics);
  if (value === undefined || typeof value === "function") return value;
  diagnostics.push({
    kind: "settled",
    error: new TypeError(
      `Manifest persistence ${property} hook must be a function`,
    ),
  });
  return undefined;
}

function captureHookProperty(
  hooks: ManifestPersistenceTestHooks,
  property: keyof ManifestPersistenceTestHooks,
  diagnostics: SeamDiagnosticEntry[],
): unknown {
  try {
    return Reflect.get(hooks, property);
  } catch (error) {
    diagnostics.push({ kind: "settled", error });
    return undefined;
  }
}

async function assimilatePromiseLike(value: unknown): Promise<void> {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return;
  }
  const then: unknown = Reflect.get(value, "then");
  await assimilateKnownThen(value, then);
}

async function assimilateKnownThen(
  value: object,
  then: unknown,
): Promise<void> {
  if (typeof then !== "function") return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const settleOnce = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };
    try {
      Reflect.apply(then, value, [
        () => settleOnce(resolve),
        (error: unknown) => settleOnce(() => reject(error)),
      ]);
    } catch (error) {
      settleOnce(() => reject(error));
    }
  });
}

async function injectManifestFault(stage: ManifestFaultStage): Promise<void> {
  await manifestFaultInjector?.(stage);
}

function persistenceIdentity(stat: {
  dev: number;
  ino: number;
  mode: number;
  size: number;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}): PersistenceStatIdentity {
  return Object.freeze({
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    size: stat.size,
    isFile: stat.isFile(),
    isSymbolicLink: stat.isSymbolicLink(),
  });
}

async function sampleCloseTarget(
  handle: Awaited<ReturnType<typeof open>>,
): Promise<CloseProbeSample> {
  try {
    return {
      kind: "stat-ok",
      identity: persistenceIdentity(await handle.stat()),
    };
  } catch (error) {
    return { kind: "stat-rejected", error };
  }
}

async function sampleUnlinkTarget(
  targetPath: string,
): Promise<UnlinkProbeSample> {
  try {
    return {
      kind: "present",
      identity: persistenceIdentity(await lstat(targetPath)),
    };
  } catch (error) {
    if (isNoEntryError(error)) return { kind: "absent" };
    return { kind: "lstat-error", error };
  }
}

function projectErrorEvidence(error: unknown): PersistenceErrorEvidence {
  if (
    error === null ||
    (typeof error !== "object" && typeof error !== "function")
  ) {
    return Object.freeze({ kind: "unknown", type: typeof error });
  }
  let isError = false;
  try {
    isError = error instanceof Error;
  } catch {
    return Object.freeze({ kind: "unreadable" });
  }
  if (!isError) {
    return Object.freeze({ kind: "unknown", type: typeof error });
  }
  try {
    const name = Reflect.get(error, "name");
    const message = Reflect.get(error, "message");
    const code = Reflect.get(error, "code");
    if (typeof name !== "string" || typeof message !== "string") {
      return Object.freeze({ kind: "unreadable" });
    }
    return Object.freeze({
      kind: "error",
      name,
      message,
      ...(typeof code === "string" || typeof code === "number"
        ? { code: String(code) }
        : {}),
    });
  } catch {
    return Object.freeze({ kind: "unreadable" });
  }
}

function projectPrimitiveSettlement(
  primitive: PrimitiveSettlement,
): ProjectedPrimitiveSettlement {
  return primitive.status === "fulfilled"
    ? Object.freeze({ status: "fulfilled" })
    : Object.freeze({
        status: "rejected",
        error: projectErrorEvidence(primitive.error),
      });
}

function projectCloseSample(
  sample: CloseProbeSample,
): ProjectedCloseProbeSample {
  return sample.kind === "stat-ok"
    ? Object.freeze({ kind: "stat-ok", identity: sample.identity })
    : Object.freeze({
        kind: "stat-rejected",
        error: projectErrorEvidence(sample.error),
      });
}

function projectUnlinkSample(
  sample: UnlinkProbeSample,
): ProjectedUnlinkProbeSample {
  if (sample.kind === "present") {
    return Object.freeze({ kind: "present", identity: sample.identity });
  }
  if (sample.kind === "absent") return Object.freeze({ kind: "absent" });
  return Object.freeze({
    kind: "lstat-error",
    error: projectErrorEvidence(sample.error),
  });
}

function projectAttemptAtoms(
  failure: AttemptFailure | undefined,
): readonly ProjectedAttemptAtom[] {
  if (!failure) return Object.freeze([]);
  if (failure.kind === "primitive") {
    return Object.freeze([
      Object.freeze({
        kind: "primitive" as const,
        error: projectErrorEvidence(failure.primary),
      }),
    ]);
  }
  if (failure.kind === "injected") {
    return Object.freeze([
      Object.freeze({
        kind: "synthetic" as const,
        error: projectErrorEvidence(failure.primary),
      }),
    ]);
  }
  return Object.freeze([
    Object.freeze({
      kind: "primitive" as const,
      error: projectErrorEvidence(failure.errors[0]),
    }),
    Object.freeze({
      kind: "synthetic" as const,
      error: projectErrorEvidence(failure.errors[1]),
    }),
  ]);
}

function recordPersistenceObservation(
  observation:
    | {
        attemptId: number;
        operation: "candidate-close" | "recovery-lock-close";
        targetPath: string;
        before: CloseProbeSample;
        primitive: PrimitiveSettlement;
        after: CloseProbeSample;
        failure: AttemptFailure | undefined;
      }
    | {
        attemptId: number;
        operation: "recovery-lock-unlink";
        targetPath: string;
        before: UnlinkProbeSample;
        primitive: PrimitiveSettlement;
        after: UnlinkProbeSample;
        failure: AttemptFailure | undefined;
      },
): void {
  const context = persistenceTestContext;
  if (!context) return;
  const shared = {
    attemptId: observation.attemptId,
    operation: observation.operation,
    targetPath: observation.targetPath,
    primitive: projectPrimitiveSettlement(observation.primitive),
    atoms: projectAttemptAtoms(observation.failure),
  };
  context.observations.push(
    observation.operation === "recovery-lock-unlink"
      ? Object.freeze({
          ...shared,
          operation: observation.operation,
          before: projectUnlinkSample(observation.before),
          after: projectUnlinkSample(observation.after),
        })
      : Object.freeze({
          ...shared,
          operation: observation.operation,
          before: projectCloseSample(observation.before),
          after: projectCloseSample(observation.after),
        }),
  );
}

function recordPersistenceSeamError(error: unknown): void {
  persistenceTestContext?.seamDiagnostics.push({
    kind: "settled",
    error,
  });
}

function requestPostAttemptOutcome(
  request: PostAttemptOutcomeRequest,
): Error | undefined {
  const context = persistenceTestContext;
  const injector = context?.injectPostAttemptOutcome;
  if (!injector) return undefined;
  try {
    const outcome: unknown = injector(
      Object.freeze({
        attemptId: request.attemptId,
        operation: request.operation,
        primitive: request.primitive,
      }),
    );
    if (outcome === undefined) return undefined;
    let isErrorOutcome = false;
    try {
      isErrorOutcome = outcome instanceof Error;
    } catch (error) {
      recordPersistenceSeamError(error);
    }
    if (isErrorOutcome) return outcome as Error;
    recordPersistenceSeamError(
      new TypeError(
        "Manifest persistence post-attempt injector must return Error or undefined",
      ),
    );
    context?.seamDiagnostics.push({
      kind: "pending",
      promise: consumeInvalidThenable(outcome),
    });
  } catch (error) {
    recordPersistenceSeamError(error);
  }
  return undefined;
}

function consumeInvalidThenable(
  outcome: unknown,
): Promise<ProjectedPendingDiagnostic | undefined> {
  if (
    outcome === null ||
    (typeof outcome !== "object" && typeof outcome !== "function")
  ) {
    return Promise.resolve(undefined);
  }
  let then: unknown;
  try {
    then = Reflect.get(outcome, "then");
  } catch (error) {
    return Promise.resolve(projectPendingDiagnostic(error));
  }
  if (typeof then !== "function") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    let settled = false;
    const settleOnce = (diagnostic: ProjectedPendingDiagnostic | undefined) => {
      if (settled) return;
      settled = true;
      resolve(diagnostic);
    };
    try {
      Reflect.apply(then, outcome, [
        () => settleOnce(undefined),
        (error: unknown) => settleOnce(projectPendingDiagnostic(error)),
      ]);
    } catch (error) {
      settleOnce(projectPendingDiagnostic(error));
    }
  });
}

function projectPendingDiagnostic(error: unknown): ProjectedPendingDiagnostic {
  return Object.freeze({
    kind: "projected",
    evidence: projectErrorEvidence(error),
  });
}

function projectCombinationProbes(
  probes: unknown,
  diagnostics: SeamDiagnosticEntry[],
): readonly ProjectedCombinationProbe[] {
  if (probes === undefined) return Object.freeze([]);
  let isArray = false;
  try {
    isArray = Array.isArray(probes);
  } catch (error) {
    diagnostics.push({ kind: "settled", error });
    return Object.freeze([]);
  }
  if (!isArray) {
    diagnostics.push({
      kind: "settled",
      error: new TypeError(
        "Manifest persistence combination probes must be an array",
      ),
    });
    return Object.freeze([]);
  }
  const probeArray = probes as object;
  let length: unknown;
  try {
    length = Reflect.get(probeArray, "length");
  } catch (error) {
    diagnostics.push({ kind: "settled", error });
    return Object.freeze([]);
  }
  if (!Number.isSafeInteger(length) || (length as number) < 0) {
    diagnostics.push({
      kind: "settled",
      error: new TypeError(
        "Manifest persistence combination probes have an invalid length",
      ),
    });
    return Object.freeze([]);
  }
  const projected: ProjectedCombinationProbe[] = [];
  for (let index = 0; index < (length as number); index++) {
    let probe: unknown;
    try {
      probe = Reflect.get(probeArray, index);
    } catch (error) {
      diagnostics.push({ kind: "settled", error });
      continue;
    }
    if (
      probe === null ||
      (typeof probe !== "object" && typeof probe !== "function")
    ) {
      diagnostics.push({
        kind: "settled",
        error: new TypeError(
          "Manifest persistence combination probe must be an object",
        ),
      });
      continue;
    }
    const atoms = orderOperationAtoms(
      captureCombinationLabel(probe, "primary", diagnostics),
      captureCombinationLabel(probe, "primitive", diagnostics),
      captureCombinationLabel(probe, "synthetic", diagnostics),
    );
    projected.push(
      Object.freeze({
        atoms: Object.freeze(
          atoms.map(({ kind, value }) => Object.freeze({ kind, label: value })),
        ),
      }),
    );
  }
  return Object.freeze(projected);
}

function captureCombinationLabel(
  probe: object,
  kind: "primary" | "primitive" | "synthetic",
  diagnostics: SeamDiagnosticEntry[],
): string | undefined {
  let value: unknown;
  try {
    value = Reflect.get(probe, kind);
  } catch (error) {
    diagnostics.push({ kind: "settled", error });
    return undefined;
  }
  if (value === undefined || typeof value === "string") return value;
  diagnostics.push({
    kind: "settled",
    error: new TypeError(
      "Manifest persistence combination probe label must be a string",
    ),
  });
  return value === null ? "<invalid:null>" : `<invalid:${typeof value}>`;
}

function combineAttemptFailure(
  primitive: PrimitiveSettlement,
  injected: Error | undefined,
): AttemptFailure | undefined {
  const atoms = orderOperationAtoms(
    undefined,
    primitive.status === "rejected" ? primitive.error : undefined,
    injected,
  );
  if (atoms.length === 0) return undefined;
  if (atoms.length === 1 && atoms[0]?.kind === "primitive") {
    return {
      kind: "primitive",
      primary: atoms[0].value,
      errors: [atoms[0].value],
    };
  }
  if (atoms.length === 1 && atoms[0]?.kind === "synthetic") {
    return {
      kind: "injected",
      primary: atoms[0].value as Error,
      errors: [atoms[0].value as Error],
    };
  }
  const primitiveAtom = atoms.find(({ kind }) => kind === "primitive");
  const syntheticAtom = atoms.find(({ kind }) => kind === "synthetic");
  if (!primitiveAtom || !syntheticAtom) {
    throw new Error("Attempt failure ordering is internally inconsistent");
  }
  return {
    kind: "combined",
    primary: primitiveAtom.value,
    errors: [primitiveAtom.value, syntheticAtom.value as Error],
  };
}

function orderOperationAtoms<T>(
  primary: T | undefined,
  primitive: T | undefined,
  synthetic: T | undefined,
): readonly Readonly<{
  kind: "primary" | "primitive" | "synthetic";
  value: T;
}>[] {
  return Object.freeze([
    ...(primary === undefined
      ? []
      : [Object.freeze({ kind: "primary" as const, value: primary })]),
    ...(primitive === undefined
      ? []
      : [Object.freeze({ kind: "primitive" as const, value: primitive })]),
    ...(synthetic === undefined
      ? []
      : [Object.freeze({ kind: "synthetic" as const, value: synthetic })]),
  ]);
}

function nextAttemptId(): number {
  const context = persistenceTestContext;
  if (!context) return 0;
  context.nextAttemptId++;
  return context.nextAttemptId;
}

interface ManifestLock {
  path: string;
  handle: Awaited<ReturnType<typeof open>>;
}

interface AuthorityState {
  lastAcceptedBytes: Buffer;
  lock: ManifestLock;
  tail: Promise<void>;
  closing: boolean;
  release?: Promise<void>;
}

export interface ManifestSnapshot {
  readonly manifestPath: string;
  readonly bytes: Buffer;
  readonly digest: string;
}

export interface LoadedManifest {
  manifest: Manifest;
  snapshot: ManifestSnapshot | null;
}

export interface ManifestSaveOptions {
  authority?: ManifestBackupAuthority;
  operationId?: string;
}

export type ManifestInspection =
  | { status: "valid"; manifest: Manifest; snapshot: ManifestSnapshot }
  | { status: "absent"; manifest: Manifest; snapshot: null }
  | { status: "invalid"; message: string };

export type ManifestRecoveryCleanup =
  | "clean"
  | "close-degraded"
  | "unlink-degraded"
  | "both-degraded";

export type ManifestRecoveryFailureCategory =
  | "source-changed"
  | "lock-unavailable"
  | "source-unavailable-or-unsafe"
  | "backup-create-or-verify-failed"
  | "source-retirement-failed";

export type ManifestRecoveryCandidateDisposition =
  | { status: "none-created" }
  | {
      status:
        | "owned-removed"
        | "retained-unverifiable"
        | "retained-owned"
        | "retained-replacement";
      path: string;
    };

export type ManifestRecoveryLockDisposition = {
  status:
    | "not-inspected-or-not-owned"
    | "pre-existing-blocker"
    | "owned-removed"
    | "retained-owned";
  path: string;
};

export type ManifestRecoveryResult =
  | {
      completed: true;
      backupPath: string;
      cleanup: ManifestRecoveryCleanup;
    }
  | {
      completed: false;
      category: ManifestRecoveryFailureCategory;
      cause: unknown;
      cleanup: ManifestRecoveryCleanup;
      candidate: ManifestRecoveryCandidateDisposition;
      lock: ManifestRecoveryLockDisposition;
    };

type UnrecoveredManifestRecoveryResult = Omit<
  Extract<ManifestRecoveryResult, { completed: false }>,
  "candidate" | "lock"
>;

type ManifestRecoveryTransitionResult =
  | Extract<ManifestRecoveryResult, { completed: true }>
  | UnrecoveredManifestRecoveryResult;

type InvalidManifestEvidence =
  | {
      kind: "bytes";
      manifestPath: string;
      bytes: Buffer;
      digest: string;
      invalidKind: "json" | "schema";
      cause: unknown;
    }
  | {
      kind: "lock";
      manifestPath: string;
      lockPath: string;
      cause: unknown;
    }
  | { kind: "source"; manifestPath: string; cause: unknown };

type ByteInvalidManifestEvidence = Extract<
  InvalidManifestEvidence,
  { kind: "bytes" }
>;

type InvalidManifestEvidenceInput =
  | Omit<ByteInvalidManifestEvidence, "digest">
  | Exclude<InvalidManifestEvidence, ByteInvalidManifestEvidence>;

const invalidManifestEvidence = new WeakMap<object, InvalidManifestEvidence>();

/** An opaque, operation-scoped capability; mutable state stays module-private. */
export interface ManifestBackupAuthority {
  readonly manifestPath: string;
  readonly backupPath: string;
  readonly operationId: string;
  toJSON(): never;
}

export function emptyManifest(): Manifest {
  return {
    version: 1,
    managedBy: MANIFEST_MANAGED_BY,
    lastSync: new Date().toISOString(),
    records: [],
  };
}

export async function loadManifest(manifestPath: string): Promise<Manifest> {
  return (await loadManifestWithSnapshot(manifestPath)).manifest;
}

/**
 * Inspect the configured manifest without mutating it. Invalid observations
 * deliberately do not grant empty-manifest or save authority.
 */
export async function inspectManifest(
  manifestPath: string,
): Promise<ManifestInspection> {
  const normalizedManifestPath = path.resolve(manifestPath);
  let rawBytes: Buffer;
  try {
    rawBytes = await readRegularManifestBytes(normalizedManifestPath);
  } catch (error) {
    if (isNoEntryError(error)) {
      return inspectAbsentManifest(normalizedManifestPath);
    }
    return createInvalidInspection(
      `Manifest is invalid: source ${normalizedManifestPath} is unavailable or unsafe`,
      { kind: "source", manifestPath: normalizedManifestPath, cause: error },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBytes.toString("utf-8"));
  } catch (error) {
    return createInvalidInspection("Manifest is invalid: corrupt JSON", {
      kind: "bytes",
      manifestPath: normalizedManifestPath,
      bytes: rawBytes,
      invalidKind: "json",
      cause: error,
    });
  }

  const result = ManifestSchema.safeParse(parsed);
  if (!result.success) {
    return createInvalidInspection(
      "Manifest is invalid: schema validation failed",
      {
        kind: "bytes",
        manifestPath: normalizedManifestPath,
        bytes: rawBytes,
        invalidKind: "schema",
        cause: new Error("Manifest schema validation failed"),
      },
    );
  }

  return {
    status: "valid",
    manifest: result.data,
    snapshot: createValidSnapshot(normalizedManifestPath, rawBytes),
  };
}

/**
 * Read-only compatibility facade for callers that need a usable manifest.
 * Invalid state remains actionable instead of being silently treated as empty.
 */
export async function loadManifestWithSnapshot(
  manifestPath: string,
): Promise<LoadedManifest> {
  const inspection = await inspectManifest(manifestPath);
  if (inspection.status === "invalid") {
    const error = new UserError(
      inspection.message,
      path.resolve(manifestPath),
      "Inspect the manifest and explicitly recover invalid state before retrying.",
    );
    const evidence = invalidManifestEvidence.get(inspection);
    if (evidence) {
      Object.defineProperty(error, "cause", { value: evidence.cause });
    }
    throw error;
  }
  return { manifest: inspection.manifest, snapshot: inspection.snapshot };
}

async function inspectAbsentManifest(
  manifestPath: string,
): Promise<ManifestInspection> {
  const lockPath = `${manifestPath}.lock`;
  try {
    await lstat(lockPath);
  } catch (error) {
    if (isNoEntryError(error)) {
      return { status: "absent", manifest: emptyManifest(), snapshot: null };
    }
    return createInvalidInspection(
      `Manifest is invalid: sibling lock ${lockPath} is unavailable or unsafe`,
      {
        kind: "lock",
        manifestPath,
        lockPath,
        cause: error,
      },
    );
  }
  return createInvalidInspection(
    `Manifest is invalid: sibling lock ${lockPath} is present`,
    {
      kind: "lock",
      manifestPath,
      lockPath,
      cause: new Error(`Manifest sibling lock ${lockPath} is present`),
    },
  );
}

function createInvalidInspection(
  message: string,
  evidence?: InvalidManifestEvidenceInput,
): ManifestInspection {
  const inspection = Object.freeze({ status: "invalid" as const, message });
  if (evidence) {
    invalidManifestEvidence.set(
      inspection,
      evidence.kind === "bytes"
        ? {
            ...evidence,
            bytes: Buffer.from(evidence.bytes),
            digest: digestBytes(evidence.bytes),
          }
        : evidence,
    );
  }
  return inspection;
}

export function updateManifest(
  existing: Manifest,
  newRecords: ManagedRecord[],
  removedPaths: string[],
): Manifest {
  const recordMap = new Map(existing.records.map((r) => [r.installedPath, r]));

  for (const record of newRecords) {
    recordMap.set(record.installedPath, record);
  }

  for (const removedPath of removedPaths) {
    recordMap.delete(removedPath);
  }

  return {
    version: 1,
    managedBy: MANIFEST_MANAGED_BY,
    lastSync: new Date().toISOString(),
    ...(existing.boundary ? { boundary: existing.boundary } : {}),
    records: Array.from(recordMap.values()),
  };
}

export async function saveManifest(
  manifestPath: string,
  manifest: Manifest,
  options: ManifestSaveOptions = {},
): Promise<void> {
  const normalizedManifestPath = path.resolve(manifestPath);
  const proposedResult = ManifestSchema.safeParse(manifest);
  if (!proposedResult.success) {
    throw new Error("Refusing to save a schema-invalid manifest");
  }
  const authority = validateSaveAuthority(normalizedManifestPath, options);
  if (authority) {
    return serializeAuthoritySave(authority, () =>
      saveManifestUnderLock(
        normalizedManifestPath,
        proposedResult.data,
        authority,
      ),
    );
  }
  return saveManifestUnderLock(
    normalizedManifestPath,
    proposedResult.data,
    undefined,
  );
}

async function saveManifestUnderLock(
  normalizedManifestPath: string,
  manifest: Manifest,
  authority: ManifestBackupAuthority | undefined,
): Promise<void> {
  let temporaryLock: ManifestLock | undefined;
  if (!authority) {
    await ensureDir(path.dirname(normalizedManifestPath));
    await assertNormalParent(normalizedManifestPath);
    await injectManifestFault("save-before-lock");
    temporaryLock = await acquireManifestLock(normalizedManifestPath);
  }
  try {
    if (!authority && activeBackupAuthorities.has(normalizedManifestPath)) {
      throw new Error("Manifest save requires its active backup authority");
    }
    const current = await loadCurrentManifestForSave(normalizedManifestPath);
    if (transitionRequiresAuthority(current, manifest) && !authority) {
      throw new Error(
        "Manifest removal or migration save requires an authority",
      );
    }
    const state = authority ? getAuthorityState(authority) : undefined;
    if (state) {
      if (!current.bytes || !current.bytes.equals(state.lastAcceptedBytes)) {
        throw new Error(
          "Manifest changed since its last accepted save; refusing guarded rewrite",
        );
      }
    }
    const content = Buffer.from(
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf-8",
    );
    await atomicReplaceManifest(normalizedManifestPath, content, current.bytes);
    if (state) {
      state.lastAcceptedBytes = Buffer.from(content);
    }
  } finally {
    if (temporaryLock) await releaseManifestLock(temporaryLock);
  }
}

/** Capture exact bytes from a readable regular manifest file. */
export async function captureManifestSnapshot(
  manifestPath: string,
): Promise<ManifestSnapshot> {
  const normalizedManifestPath = path.resolve(manifestPath);
  const bytes = await readRegularManifestBytes(normalizedManifestPath);
  assertSchemaValidManifestBytes(bytes);
  return createValidSnapshot(normalizedManifestPath, bytes);
}

/**
 * Make and verify one never-overwritten sibling backup before a migration or
 * cleanup rewrite. The source must still equal the loader snapshot exactly.
 */
export async function createManifestBackupAuthority(
  manifestPath: string,
  snapshot: ManifestSnapshot,
  operationId: string,
  timestamp = new Date(),
): Promise<ManifestBackupAuthority> {
  const normalizedManifestPath = path.resolve(manifestPath);
  if (!validSnapshots.has(snapshot)) {
    throw new Error("Manifest backup requires a schema-valid load snapshot");
  }
  if (snapshot.manifestPath !== normalizedManifestPath) {
    throw new Error("Manifest snapshot belongs to a different manifest path");
  }
  if (snapshot.digest !== digestBytes(snapshot.bytes)) {
    throw new Error("Manifest snapshot digest does not match its bytes");
  }
  if (operationId.length === 0) {
    throw new Error("Manifest backup operation identity must not be empty");
  }
  if (activeBackupAuthorities.has(normalizedManifestPath)) {
    throw new Error("Manifest already has an active backup authority");
  }

  await assertNormalParent(normalizedManifestPath);
  const lock = await acquireManifestLock(normalizedManifestPath);
  let backupPath: string | undefined;
  try {
    const currentBytes = await readRegularManifestBytes(normalizedManifestPath);
    if (!currentBytes.equals(snapshot.bytes)) {
      throw new Error("Manifest changed since it was loaded; refusing backup");
    }

    backupPath = await writeVerifiedBackup(
      normalizedManifestPath,
      currentBytes,
      timestamp,
    );
    let verifiedSourceBytes: Buffer;
    try {
      verifiedSourceBytes = await readRegularManifestBytes(
        normalizedManifestPath,
      );
      assertSchemaValidManifestBytes(verifiedSourceBytes);
    } catch {
      throw new Error("Manifest changed while its backup was verified");
    }
    if (
      !verifiedSourceBytes.equals(snapshot.bytes) ||
      digestBytes(verifiedSourceBytes) !== snapshot.digest
    ) {
      throw new Error("Manifest changed while its backup was verified");
    }
    const authority = Object.freeze({
      manifestPath: normalizedManifestPath,
      backupPath,
      operationId,
      toJSON(): never {
        throw new Error("Manifest backup authority must not be serialized");
      },
    });
    authorityState.set(authority, {
      lastAcceptedBytes: Buffer.from(currentBytes),
      lock,
      tail: Promise.resolve(),
      closing: false,
    });
    activeBackupAuthorities.set(normalizedManifestPath, authority);
    return authority;
  } catch (error) {
    if (backupPath) {
      try {
        await unlink(backupPath);
      } catch {
        // A failed cleanup must not mask the fresh-source verification error.
      }
    }
    await releaseManifestLock(lock);
    throw error;
  }
}

/** Explicitly end an operation and revoke its non-serializable capability. */
export async function releaseManifestBackupAuthority(
  authority: ManifestBackupAuthority,
): Promise<void> {
  const state = authorityState.get(authority);
  if (!state) return;
  if (!state.release) {
    state.closing = true;
    state.release = (async () => {
      await state.tail;
      if (activeBackupAuthorities.get(authority.manifestPath) === authority) {
        activeBackupAuthorities.delete(authority.manifestPath);
      }
      authorityState.delete(authority);
      await releaseManifestLock(state.lock);
    })();
  }
  await state.release;
}

/**
 * Convenience boundary for consumers that need authority to expire on both
 * ordinary return and throw paths.
 */
export async function withManifestBackupAuthority<T>(
  manifestPath: string,
  snapshot: ManifestSnapshot,
  operationId: string,
  operation: (authority: ManifestBackupAuthority) => Promise<T>,
): Promise<T> {
  const authority = await createManifestBackupAuthority(
    manifestPath,
    snapshot,
    operationId,
  );
  try {
    return await operation(authority);
  } finally {
    await releaseManifestBackupAuthority(authority);
  }
}

function validateSaveAuthority(
  normalizedManifestPath: string,
  options: ManifestSaveOptions,
): ManifestBackupAuthority | undefined {
  const authority = options.authority;
  if (authority) {
    if (authority.manifestPath !== normalizedManifestPath) {
      throw new Error(
        "Manifest backup authority belongs to a different manifest path",
      );
    }
    const state = authorityState.get(authority);
    if (!state) {
      throw new Error("Manifest backup authority is no longer active");
    }
    if (state.closing) {
      throw new Error("Manifest backup authority is closing");
    }
    if (activeBackupAuthorities.get(normalizedManifestPath) !== authority) {
      throw new Error(
        "Manifest backup authority is not active for this manifest",
      );
    }
    if (options.operationId !== authority.operationId) {
      throw new Error("Manifest backup authority operation mismatch");
    }
    return authority;
  }

  if (options.operationId !== undefined) {
    throw new Error("Manifest save operation identity requires an authority");
  }

  if (activeBackupAuthorities.has(normalizedManifestPath)) {
    throw new Error("Manifest save requires its active backup authority");
  }
  return undefined;
}

function getAuthorityState(authority: ManifestBackupAuthority): AuthorityState {
  const state = authorityState.get(authority);
  if (!state) throw new Error("Manifest backup authority is no longer active");
  return state;
}

async function serializeAuthoritySave<T>(
  authority: ManifestBackupAuthority,
  operation: () => Promise<T>,
): Promise<T> {
  const state = getAuthorityState(authority);
  const predecessor = state.tail;
  let release!: () => void;
  state.tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await predecessor;
  try {
    return await operation();
  } finally {
    release();
  }
}

function createValidSnapshot(
  manifestPath: string,
  bytes: Buffer,
): ManifestSnapshot {
  const snapshot: ManifestSnapshot = Object.freeze({
    manifestPath: path.resolve(manifestPath),
    bytes: Buffer.from(bytes),
    digest: digestBytes(bytes),
  });
  validSnapshots.add(snapshot);
  return snapshot;
}

function assertSchemaValidManifestBytes(bytes: Buffer): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf-8"));
  } catch {
    throw new Error("Manifest backup requires schema-valid JSON");
  }
  if (!ManifestSchema.safeParse(parsed).success) {
    throw new Error("Manifest backup requires a schema-valid manifest");
  }
}

interface CurrentManifestForSave {
  bytes: Buffer | undefined;
  manifest: Manifest | undefined;
}

async function loadCurrentManifestForSave(
  manifestPath: string,
): Promise<CurrentManifestForSave> {
  try {
    const currentBytes = await readRegularManifestBytes(manifestPath);
    let current: unknown;
    try {
      current = JSON.parse(currentBytes.toString("utf-8"));
    } catch {
      return { bytes: currentBytes, manifest: undefined };
    }
    const currentResult = ManifestSchema.safeParse(current);
    return {
      bytes: currentBytes,
      manifest: currentResult.success ? currentResult.data : undefined,
    };
  } catch (error) {
    if (isNoEntryError(error)) return { bytes: undefined, manifest: undefined };
    throw error;
  }
}

function transitionRequiresAuthority(
  current: CurrentManifestForSave,
  proposed: Manifest,
): boolean {
  // A missing file is an ordinary first save. An existing invalid file is not
  // an authorized baseline for a destructive replacement.
  if (!current.bytes) return false;
  if (!current.manifest) return true;
  if (!sameBoundary(current.manifest.boundary, proposed.boundary)) return true;

  const proposedIdentityCounts = new Map<string, number>();
  for (const record of proposed.records) {
    const identity = recordIdentity(record);
    proposedIdentityCounts.set(
      identity,
      (proposedIdentityCounts.get(identity) ?? 0) + 1,
    );
  }
  for (const record of current.manifest.records) {
    const identity = recordIdentity(record);
    const count = proposedIdentityCounts.get(identity) ?? 0;
    if (count === 0) return true;
    proposedIdentityCounts.set(identity, count - 1);
  }
  return false;
}

function sameBoundary(
  first: Manifest["boundary"],
  second: Manifest["boundary"],
): boolean {
  return (
    first?.claudeSkillsHome === second?.claudeSkillsHome &&
    first?.claudeAgentsHome === second?.claudeAgentsHome &&
    first?.codexSkillsHome === second?.codexSkillsHome &&
    first?.codexAgentsHome === second?.codexAgentsHome
  );
}

function recordIdentity(record: ManagedRecord): string {
  return JSON.stringify([
    record.target,
    record.type,
    record.name,
    record.installedPath,
  ]);
}

function isNoEntryError(error: unknown): boolean {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
  if (!(error instanceof Error)) return false;
  return (error.cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

async function assertNormalParent(manifestPath: string): Promise<void> {
  const parent = path.dirname(manifestPath);
  let parentStat: Awaited<ReturnType<typeof lstat>>;
  try {
    parentStat = await lstat(parent);
  } catch (error) {
    throw new Error(
      `Manifest backup parent is not readable: ${(error as Error).message}`,
    );
  }
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error("Manifest backup parent must be a normal directory");
  }
}

async function readRegularManifestBytes(manifestPath: string): Promise<Buffer> {
  let beforePath: Awaited<ReturnType<typeof lstat>>;
  try {
    beforePath = await lstat(manifestPath);
  } catch (error) {
    throw new Error(
      `Manifest source ${manifestPath} must be a readable regular file: ${(error as Error).message}`,
      { cause: error },
    );
  }
  if (!beforePath.isFile() || beforePath.isSymbolicLink()) {
    throw new Error(
      `Manifest source ${manifestPath} must be a readable regular file`,
    );
  }
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(
      manifestPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    throw new Error(
      `Manifest source ${manifestPath} must be a readable regular file: ${(error as Error).message}`,
      { cause: error },
    );
  }
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.dev !== beforePath.dev ||
      before.ino !== beforePath.ino
    ) {
      throw new Error(
        `Manifest source ${manifestPath} must be a readable regular file`,
      );
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const afterPath = await lstat(manifestPath);
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      !afterPath.isFile() ||
      afterPath.isSymbolicLink() ||
      afterPath.dev !== beforePath.dev ||
      afterPath.ino !== beforePath.ino
    ) {
      throw new Error("Manifest backup source changed while it was read");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function digestBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeVerifiedBackup(
  manifestPath: string,
  sourceBytes: Buffer,
  timestamp: Date,
): Promise<string> {
  const timestampPart = timestamp.toISOString().replaceAll(":", "-");
  const basePath = `${manifestPath}.backup-${timestampPart}`;

  for (let suffix = 0; ; suffix++) {
    const backupPath = suffix === 0 ? basePath : `${basePath}-${suffix}`;
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      await injectManifestFault("backup-open");
      handle = await open(backupPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw new Error(
        `Could not create manifest backup ${backupPath}: ${(error as Error).message}`,
      );
    }

    try {
      let writeError: unknown;
      try {
        await injectManifestFault("backup-write");
        await handle.writeFile(sourceBytes);
        await injectManifestFault("backup-sync");
        await handle.sync();
      } catch (error) {
        writeError = error;
      }
      let closeError: unknown;
      try {
        await closeHandleWithFault(handle, "backup-close");
      } catch (error) {
        closeError = error;
      }
      if (writeError) throw writeError;
      if (closeError) throw closeError;
      await injectManifestFault("backup-readback");
      const readback = await readRegularManifestBytes(backupPath);
      if (!readback.equals(sourceBytes)) {
        throw new Error(
          `Manifest backup verification failed for ${backupPath}`,
        );
      }
      return backupPath;
    } catch (error) {
      try {
        await unlink(backupPath);
      } catch {
        // A failed cleanup must not mask the original backup verification error.
      }
      throw error;
    }
  }
}

/** Always close the real descriptor even when the test seam faults at close. */
async function closeHandleWithFault(
  handle: Awaited<ReturnType<typeof open>>,
  stage: Extract<ManifestFaultStage, "backup-close" | "replacement-close">,
): Promise<void> {
  let injectedError: unknown;
  try {
    await injectManifestFault(stage);
  } catch (error) {
    injectedError = error;
  }
  let closeError: unknown;
  try {
    await handle.close();
  } catch (error) {
    closeError = error;
  }
  if (injectedError) throw injectedError;
  if (closeError) throw closeError;
}

async function acquireManifestLock(
  manifestPath: string,
): Promise<ManifestLock> {
  const lockPath = `${manifestPath}.lock`;
  try {
    return { path: lockPath, handle: await open(lockPath, "wx", 0o600) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Manifest operation is already active");
    }
    throw new Error(
      `Could not acquire manifest operation lock: ${(error as Error).message}`,
    );
  }
}

async function releaseManifestLock(lock: ManifestLock): Promise<void> {
  await lock.handle.close();
  try {
    await unlink(lock.path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/**
 * Recover only the module-private invalid bytes produced by inspectManifest.
 * A successful source unlink is the irreversible recovery commit.
 */
export async function recoverInvalidManifest(
  inspection: ManifestInspection,
): Promise<ManifestRecoveryResult> {
  const evidence = invalidManifestEvidence.get(inspection);
  if (!evidence) {
    throw new Error(
      "Manifest recovery requires an invalid inspection from this module",
    );
  }
  invalidManifestEvidence.delete(inspection);

  if (evidence.kind === "lock") {
    return withRecoveryDispositions(
      unrecovered("lock-unavailable", evidence.cause, "clean"),
      { status: "none-created" },
      { status: "pre-existing-blocker", path: evidence.lockPath },
    );
  }
  if (evidence.kind === "source") {
    return withRecoveryDispositions(
      unrecovered("source-unavailable-or-unsafe", evidence.cause, "clean"),
      { status: "none-created" },
      {
        status: "not-inspected-or-not-owned",
        path: `${evidence.manifestPath}.lock`,
      },
    );
  }

  try {
    await assertNormalParent(evidence.manifestPath);
  } catch (error) {
    return withRecoveryDispositions(
      unrecovered("source-unavailable-or-unsafe", error, "clean"),
      { status: "none-created" },
      {
        status: "not-inspected-or-not-owned",
        path: `${evidence.manifestPath}.lock`,
      },
    );
  }

  let lock: ManifestLock;
  try {
    lock = await acquireManifestLock(evidence.manifestPath);
  } catch (error) {
    return withRecoveryDispositions(
      unrecovered("lock-unavailable", error, "clean"),
      { status: "none-created" },
      {
        status: "pre-existing-blocker",
        path: `${evidence.manifestPath}.lock`,
      },
    );
  }

  const transition = await performInvalidRecovery(evidence);
  const candidate = transition.committed
    ? undefined
    : await disposeRecoveryCandidate(transition.candidate);
  const released = await releaseRecoveryLock(lock);
  if (transition.result.completed) {
    return { ...transition.result, cleanup: released.cleanup };
  }
  return withRecoveryDispositions(
    { ...transition.result, cleanup: released.cleanup },
    candidate ?? { status: "none-created" },
    released.lock,
  );
}

interface RecoveryTransition {
  result: ManifestRecoveryTransitionResult;
  candidate?: RecoveryCandidateCustody;
  committed: boolean;
}

async function performInvalidRecovery(
  evidence: ByteInvalidManifestEvidence,
): Promise<RecoveryTransition> {
  let candidate: RecoveryCandidateCustody | undefined;
  try {
    const initial = await readRecoverySource(evidence);
    if (!initial.ok) return { result: initial.result, committed: false };

    for (let suffix = 0; suffix < 10000; suffix++) {
      const backupPath =
        suffix === 0
          ? `${evidence.manifestPath}.bak`
          : `${evidence.manifestPath}.bak-${suffix}`;
      try {
        await injectManifestFault("recovery-before-candidate");
        const beforeCreate = await readRecoverySource(evidence);
        if (!beforeCreate.ok) {
          return { result: beforeCreate.result, candidate, committed: false };
        }
        candidate = await writeRecoveryCandidate(
          backupPath,
          evidence.bytes,
          (created) => {
            candidate = created;
          },
        );
        await injectManifestFault("recovery-after-candidate");
        await injectManifestFault("recovery-candidate-readback");
        const candidateBytes = await readRegularManifestBytes(backupPath);
        if (!candidateBytes.equals(evidence.bytes)) {
          return {
            result: unrecovered(
              "backup-create-or-verify-failed",
              new Error(
                `Manifest recovery backup verification failed for ${backupPath}`,
              ),
              "clean",
            ),
            candidate,
            committed: false,
          };
        }
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST" && !candidate) {
          continue;
        }
        return {
          result: unrecovered("backup-create-or-verify-failed", error, "clean"),
          candidate,
          committed: false,
        };
      }
    }

    if (!candidate) {
      return {
        result: unrecovered(
          "backup-create-or-verify-failed",
          new Error("Manifest recovery backup suffixes are exhausted"),
          "clean",
        ),
        committed: false,
      };
    }

    const freshness = await readRecoverySource(evidence);
    if (!freshness.ok) {
      return { result: freshness.result, candidate, committed: false };
    }
    try {
      await injectManifestFault("recovery-retirement");
      await unlink(evidence.manifestPath);
    } catch (error) {
      return {
        result: unrecovered("source-retirement-failed", error, "clean"),
        candidate,
        committed: false,
      };
    }
    return {
      result: { completed: true, backupPath: candidate.path, cleanup: "clean" },
      candidate,
      committed: true,
    };
  } catch (error) {
    return {
      result: unrecovered("source-unavailable-or-unsafe", error, "clean"),
      candidate,
      committed: false,
    };
  }
}

function unrecovered(
  category: ManifestRecoveryFailureCategory,
  cause: unknown,
  cleanup: ManifestRecoveryCleanup,
): UnrecoveredManifestRecoveryResult {
  return { completed: false, category, cause, cleanup };
}

function withRecoveryDispositions(
  result: UnrecoveredManifestRecoveryResult,
  candidate: ManifestRecoveryCandidateDisposition,
  lock: ManifestRecoveryLockDisposition,
): ManifestRecoveryResult {
  return { ...result, candidate, lock };
}

async function readRecoverySource(
  evidence: ByteInvalidManifestEvidence,
): Promise<
  { ok: true } | { ok: false; result: UnrecoveredManifestRecoveryResult }
> {
  try {
    const currentBytes = await readRegularManifestBytes(evidence.manifestPath);
    if (
      !currentBytes.equals(evidence.bytes) ||
      digestBytes(currentBytes) !== evidence.digest
    ) {
      return {
        ok: false,
        result: unrecovered(
          "source-changed",
          new Error("Manifest changed since invalid inspection"),
          "clean",
        ),
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      result: unrecovered("source-unavailable-or-unsafe", error, "clean"),
    };
  }
}

interface RecoveryCandidate {
  kind: "owned";
  path: string;
  dev: number;
  ino: number;
}

interface ProvisionalRecoveryCandidateCustody {
  kind: "provisional";
  path: string;
}

type RecoveryCandidateCustody =
  | RecoveryCandidate
  | ProvisionalRecoveryCandidateCustody;

interface ProvisionalRecoveryCandidate {
  path: string;
  handle: Awaited<ReturnType<typeof open>>;
  closed: boolean;
}

async function writeRecoveryCandidate(
  filePath: string,
  bytes: Buffer,
  onCreated: (candidate: RecoveryCandidateCustody) => void,
): Promise<RecoveryCandidate> {
  await injectManifestFault("recovery-candidate-open");
  const handle = await open(filePath, "wx", 0o600);
  const provisional: ProvisionalRecoveryCandidate = {
    path: filePath,
    handle,
    closed: false,
  };
  onCreated({ kind: "provisional", path: filePath });
  let primaryError: unknown;
  let candidate: RecoveryCandidate | undefined;
  try {
    await injectManifestFault("recovery-candidate-stat");
    const stat = await handle.stat();
    candidate = { kind: "owned", path: filePath, dev: stat.dev, ino: stat.ino };
    onCreated(candidate);
    await injectManifestFault("recovery-candidate-write");
    await handle.writeFile(bytes);
    await injectManifestFault("recovery-candidate-sync");
    await handle.sync();
  } catch (error) {
    primaryError = error;
  }
  let closeError: unknown;
  try {
    await closeCandidateHandle(provisional);
  } catch (error) {
    closeError = error;
  }
  if (primaryError) throw primaryError;
  if (closeError) throw closeError;
  if (!candidate)
    throw new Error("Recovery candidate identity was not captured");
  return candidate;
}

async function closeCandidateHandle(
  provisional: ProvisionalRecoveryCandidate,
): Promise<void> {
  if (provisional.closed) return;
  provisional.closed = true;
  let injectedError: unknown;
  try {
    await injectManifestFault("recovery-candidate-close");
  } catch (error) {
    injectedError = error;
  }
  const failure = await attemptHandleClose(
    "candidate-close",
    provisional.path,
    provisional.handle,
  );
  if (injectedError) throw injectedError;
  if (failure) throw materializeAttemptFailure(failure);
}

async function disposeRecoveryCandidate(
  candidate: RecoveryCandidateCustody | undefined,
): Promise<ManifestRecoveryCandidateDisposition> {
  if (!candidate) return { status: "none-created" };
  if (candidate.kind === "provisional") {
    return { status: "retained-unverifiable", path: candidate.path };
  }
  try {
    const stat = await lstat(candidate.path);
    if (
      stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.dev === candidate.dev &&
      stat.ino === candidate.ino
    ) {
      try {
        await unlink(candidate.path);
        return { status: "owned-removed", path: candidate.path };
      } catch {
        return { status: "retained-owned", path: candidate.path };
      }
    }
    return { status: "retained-replacement", path: candidate.path };
  } catch (error) {
    return isNoEntryError(error)
      ? { status: "owned-removed", path: candidate.path }
      : { status: "retained-owned", path: candidate.path };
  }
}

async function releaseRecoveryLock(lock: ManifestLock): Promise<{
  cleanup: ManifestRecoveryCleanup;
  lock: ManifestRecoveryLockDisposition;
}> {
  let closeDegraded = false;
  try {
    await closeRecoveryHandle(lock.path, lock.handle);
  } catch {
    closeDegraded = true;
  }
  let unlinkDegraded = false;
  try {
    const failure = await attemptRecoveryLockUnlink(lock.path);
    if (failure) throw materializeAttemptFailure(failure);
  } catch {
    unlinkDegraded = true;
  }
  const cleanup = closeDegraded
    ? unlinkDegraded
      ? "both-degraded"
      : "close-degraded"
    : unlinkDegraded
      ? "unlink-degraded"
      : "clean";
  return {
    cleanup,
    lock: {
      status: (await recoveryLockPathIsAbsent(lock.path))
        ? "owned-removed"
        : "retained-owned",
      path: lock.path,
    },
  };
}

async function recoveryLockPathIsAbsent(lockPath: string): Promise<boolean> {
  try {
    await lstat(lockPath);
    return false;
  } catch (error) {
    return isNoEntryError(error);
  }
}

/** Always attempt the real close once even when the test seam faults. */
async function closeRecoveryHandle(
  targetPath: string,
  handle: Awaited<ReturnType<typeof open>>,
): Promise<void> {
  const failure = await attemptHandleClose(
    "recovery-lock-close",
    targetPath,
    handle,
  );
  if (failure) throw materializeAttemptFailure(failure);
}

async function attemptHandleClose(
  operation: "candidate-close" | "recovery-lock-close",
  targetPath: string,
  handle: Awaited<ReturnType<typeof open>>,
): Promise<AttemptFailure | undefined> {
  const attemptId = nextAttemptId();
  const before = await sampleCloseTarget(handle);
  let primitive: PrimitiveSettlement;
  try {
    await handle.close();
    primitive = { status: "fulfilled" };
  } catch (error) {
    primitive = { status: "rejected", error };
  }
  const after = await sampleCloseTarget(handle);
  const injected =
    operation === "recovery-lock-close"
      ? requestPostAttemptOutcome({
          attemptId,
          operation,
          primitive: projectPrimitiveSettlement(primitive),
        })
      : undefined;
  const failure = combineAttemptFailure(primitive, injected);
  recordPersistenceObservation({
    attemptId,
    operation,
    targetPath,
    before,
    primitive,
    after,
    failure,
  });
  return failure;
}

async function attemptRecoveryLockUnlink(
  targetPath: string,
): Promise<AttemptFailure | undefined> {
  const attemptId = nextAttemptId();
  const before = await sampleUnlinkTarget(targetPath);
  let primitive: PrimitiveSettlement;
  try {
    await unlink(targetPath);
    primitive = { status: "fulfilled" };
  } catch (error) {
    primitive = { status: "rejected", error };
  }
  const after = await sampleUnlinkTarget(targetPath);
  const injected = requestPostAttemptOutcome({
    attemptId,
    operation: "recovery-lock-unlink",
    primitive: projectPrimitiveSettlement(primitive),
  });
  const effectivePrimitive =
    primitive.status === "rejected" && isNoEntryError(primitive.error)
      ? ({ status: "fulfilled" } as const)
      : primitive;
  const failure = combineAttemptFailure(effectivePrimitive, injected);
  recordPersistenceObservation({
    attemptId,
    operation: "recovery-lock-unlink",
    targetPath,
    before,
    primitive,
    after,
    failure,
  });
  return failure;
}

function materializeAttemptFailure(failure: AttemptFailure): unknown {
  return failure.kind === "combined"
    ? new AggregateError(
        failure.errors,
        "Manifest persistence primitive and injected outcome failed",
      )
    : failure.primary;
}

async function atomicReplaceManifest(
  manifestPath: string,
  content: Buffer,
  expectedCurrentBytes: Buffer | undefined,
): Promise<void> {
  const tempPath = `${manifestPath}.tmp.${randomUUID()}`;
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(tempPath, "wx", 0o600);
  } catch (error) {
    throw new Error(
      `Could not allocate manifest replacement file: ${(error as Error).message}`,
    );
  }

  try {
    let writeError: unknown;
    try {
      await injectManifestFault("replacement-write");
      await handle.writeFile(content);
      await injectManifestFault("replacement-sync");
      await handle.sync();
    } catch (error) {
      writeError = error;
    }
    let closeError: unknown;
    try {
      await closeHandleWithFault(handle, "replacement-close");
    } catch (error) {
      closeError = error;
    }
    if (writeError) throw writeError;
    if (closeError) throw closeError;
    if (expectedCurrentBytes) {
      await injectManifestFault("replacement-freshness");
      const currentBytes = await readRegularManifestBytes(manifestPath);
      if (!currentBytes.equals(expectedCurrentBytes)) {
        throw new Error(
          "Manifest changed before guarded replacement; refusing rewrite",
        );
      }
    }
    await injectManifestFault("replacement-rename");
    if (expectedCurrentBytes) {
      const currentBytes = await readRegularManifestBytes(manifestPath);
      if (!currentBytes.equals(expectedCurrentBytes)) {
        throw new Error(
          "Manifest changed before guarded replacement; refusing rewrite",
        );
      }
    }
    await rename(tempPath, manifestPath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // The replacement was never installed; best-effort temporary cleanup.
    }
    throw error;
  }
}
