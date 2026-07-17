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
import { ensureDir } from "../utils/fs.js";
import { getLogger } from "../utils/output.js";

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
  | "recovery-after-candidate";
type ManifestFaultInjector = (
  stage: ManifestFaultStage,
) => void | Promise<void>;
let manifestFaultInjector: ManifestFaultInjector | undefined;

/** @internal Scoped, test-only deterministic persistence fault seam. */
export async function withManifestPersistenceFaultsForTesting<T>(
  injector: ManifestFaultInjector,
  callback: () => Promise<T>,
): Promise<T> {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Manifest persistence fault injection is test-only");
  }
  if (manifestFaultInjector) {
    throw new Error(
      "Manifest persistence fault injection does not support nesting",
    );
  }
  manifestFaultInjector = injector;
  try {
    return await callback();
  } finally {
    manifestFaultInjector = undefined;
  }
}

async function injectManifestFault(stage: ManifestFaultStage): Promise<void> {
  await manifestFaultInjector?.(stage);
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

type InvalidManifestRecoveryResult =
  | { completed: true; backupPath: string }
  | { completed: false };

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
 * Load a manifest together with the exact bytes later guarded rewrites must
 * compare. Invalid JSON or schema inputs retain the established recovery path
 * and deliberately provide no migration snapshot.
 */
export async function loadManifestWithSnapshot(
  manifestPath: string,
): Promise<LoadedManifest> {
  let rawBytes: Buffer;
  try {
    rawBytes = await readRegularManifestBytes(manifestPath);
  } catch (error) {
    if (isNoEntryError(error)) {
      return { manifest: emptyManifest(), snapshot: null };
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBytes.toString("utf-8"));
  } catch {
    const recovery = await recoverInvalidManifest(manifestPath, rawBytes);
    if (recovery.completed) {
      getLogger().warn(
        `Warning: manifest is corrupt JSON. Backing up to ${recovery.backupPath}`,
      );
    }
    return { manifest: emptyManifest(), snapshot: null };
  }

  const result = ManifestSchema.safeParse(parsed);
  if (!result.success) {
    const recovery = await recoverInvalidManifest(manifestPath, rawBytes);
    if (recovery.completed) {
      getLogger().warn(
        `Warning: manifest schema invalid. Backing up to ${recovery.backupPath}`,
      );
    }
    return { manifest: emptyManifest(), snapshot: null };
  }

  return {
    manifest: result.data,
    snapshot: createValidSnapshot(manifestPath, rawBytes),
  };
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
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(
      manifestPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
  } catch (error) {
    throw new Error(
      `Manifest backup source must be a readable regular file: ${(error as Error).message}`,
      { cause: error },
    );
  }
  try {
    const before = await handle.stat();
    if (!before.isFile()) {
      throw new Error("Manifest backup source must be a readable regular file");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (after.dev !== before.dev || after.ino !== before.ino) {
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

async function recoverInvalidManifest(
  manifestPath: string,
  expectedBytes: Buffer,
): Promise<InvalidManifestRecoveryResult> {
  const normalizedPath = path.resolve(manifestPath);
  try {
    await assertNormalParent(normalizedPath);
    const lock = await acquireManifestLock(normalizedPath);
    try {
      const currentBytes = await readRegularManifestBytes(normalizedPath);
      if (!currentBytes.equals(expectedBytes)) return { completed: false };
      for (let suffix = 0; suffix < 10000; suffix++) {
        const backupPath =
          suffix === 0
            ? `${normalizedPath}.bak`
            : `${normalizedPath}.bak-${suffix}`;
        let created = false;
        let completed = false;
        try {
          // Revalidate immediately before and after candidate creation. The
          // candidate contains captured bytes, never a later path lookup.
          await injectManifestFault("recovery-before-candidate");
          const beforeCreate = await readRegularManifestBytes(normalizedPath);
          if (!beforeCreate.equals(expectedBytes)) return { completed: false };
          await writeExactExclusiveFile(backupPath, expectedBytes, () => {
            created = true;
          });
          await injectManifestFault("recovery-after-candidate");
          const candidateBytes = await readRegularManifestBytes(backupPath);
          const afterCreate = await readRegularManifestBytes(normalizedPath);
          if (
            !afterCreate.equals(expectedBytes) ||
            !candidateBytes.equals(expectedBytes)
          ) {
            return { completed: false };
          }
          await unlink(normalizedPath);
          completed = true;
          return { completed: true, backupPath };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST" && !created) {
            continue;
          }
          return { completed: false };
        } finally {
          // Any unsuccessful recovery attempt must not leave an unverified
          // candidate behind, while occupied collision siblings remain intact.
          if (created && !completed) await removeRecoveryCandidate(backupPath);
        }
      }
      return { completed: false };
    } finally {
      await releaseManifestLock(lock);
    }
  } catch {
    // Preserve established invalid-manifest recovery behavior on filesystem errors.
    return { completed: false };
  }
}

async function removeRecoveryCandidate(backupPath: string): Promise<void> {
  try {
    const candidate = await lstat(backupPath);
    if (!candidate.isDirectory()) await unlink(backupPath);
  } catch {
    // Recovery is intentionally best effort on filesystem errors.
  }
}

async function writeExactExclusiveFile(
  filePath: string,
  bytes: Buffer,
  onCreated: () => void,
): Promise<void> {
  const handle = await open(filePath, "wx", 0o600);
  onCreated();
  let writeError: unknown;
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    writeError = error;
  }
  let closeError: unknown;
  try {
    await handle.close();
  } catch (error) {
    closeError = error;
  }
  if (writeError) throw writeError;
  if (closeError) throw closeError;
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
