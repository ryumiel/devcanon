import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { MANIFEST_MANAGED_BY } from "../config/identity.js";
import {
  type ManagedRecord,
  type Manifest,
  ManifestSchema,
} from "../config/schema.js";
import { ensureDir, pathExists } from "../utils/fs.js";
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
  | "replacement-rename";
let manifestFaultInjector: ((stage: ManifestFaultStage) => void) | undefined;

/** @internal Test-only deterministic persistence fault seam. */
export function setManifestPersistenceFaultInjectorForTest(
  injector: ((stage: ManifestFaultStage) => void) | undefined,
): void {
  manifestFaultInjector = injector;
}

function injectManifestFault(stage: ManifestFaultStage): void {
  manifestFaultInjector?.(stage);
}

interface ManifestLock {
  path: string;
  handle: Awaited<ReturnType<typeof open>>;
}

interface AuthorityState {
  lastAcceptedBytes: Buffer;
  lock: ManifestLock;
  tail: Promise<void>;
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
 * compare. Invalid and unreadable inputs retain the established recovery path
 * and deliberately provide no migration snapshot.
 */
export async function loadManifestWithSnapshot(
  manifestPath: string,
): Promise<LoadedManifest> {
  if (!(await pathExists(manifestPath))) {
    return { manifest: emptyManifest(), snapshot: null };
  }

  let rawBytes: Buffer;
  try {
    rawBytes = await readRegularManifestBytes(manifestPath);
  } catch {
    getLogger().warn(`Warning: could not read manifest at ${manifestPath}`);
    return { manifest: emptyManifest(), snapshot: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBytes.toString("utf-8"));
  } catch {
    getLogger().warn(
      `Warning: manifest is corrupt JSON. Backing up to ${manifestPath}.bak`,
    );
    await recoverInvalidManifest(manifestPath, rawBytes);
    return { manifest: emptyManifest(), snapshot: null };
  }

  const result = ManifestSchema.safeParse(parsed);
  if (!result.success) {
    getLogger().warn(
      `Warning: manifest schema invalid. Backing up to ${manifestPath}.bak`,
    );
    await recoverInvalidManifest(manifestPath, rawBytes);
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
  const authority = validateSaveAuthority(normalizedManifestPath, options);
  const requiresAuthority = await transitionRequiresAuthority(
    normalizedManifestPath,
    manifest,
  );
  if (requiresAuthority && !authority) {
    throw new Error("Manifest removal or migration save requires an authority");
  }
  if (authority) {
    return serializeAuthoritySave(authority, () =>
      saveManifestUnderLock(normalizedManifestPath, manifest, authority),
    );
  }
  return saveManifestUnderLock(normalizedManifestPath, manifest, undefined);
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
    temporaryLock = await acquireManifestLock(normalizedManifestPath);
  }
  try {
    const state = authority ? getAuthorityState(authority) : undefined;
    if (state) {
      const currentBytes = await readRegularManifestBytes(
        normalizedManifestPath,
      );
      if (!currentBytes.equals(state.lastAcceptedBytes)) {
        throw new Error(
          "Manifest changed since its last accepted save; refusing guarded rewrite",
        );
      }
    }
    const content = Buffer.from(
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf-8",
    );
    await atomicReplaceManifest(
      normalizedManifestPath,
      content,
      state?.lastAcceptedBytes,
    );
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
  try {
    const currentBytes = await readRegularManifestBytes(normalizedManifestPath);
    if (!currentBytes.equals(snapshot.bytes)) {
      throw new Error("Manifest changed since it was loaded; refusing backup");
    }

    const backupPath = await writeVerifiedBackup(
      normalizedManifestPath,
      currentBytes,
      timestamp,
    );
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
    });
    activeBackupAuthorities.set(normalizedManifestPath, authority);
    return authority;
  } catch (error) {
    await releaseManifestLock(lock);
    throw error;
  }
}

/** Explicitly end an operation and revoke its non-serializable capability. */
export async function releaseManifestBackupAuthority(
  authority: ManifestBackupAuthority,
): Promise<void> {
  const state = authorityState.get(authority);
  if (activeBackupAuthorities.get(authority.manifestPath) === authority) {
    activeBackupAuthorities.delete(authority.manifestPath);
  }
  authorityState.delete(authority);
  if (state) await releaseManifestLock(state.lock);
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
    if (!authorityState.has(authority)) {
      throw new Error("Manifest backup authority is no longer active");
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

async function transitionRequiresAuthority(
  manifestPath: string,
  proposed: Manifest,
): Promise<boolean> {
  const proposedResult = ManifestSchema.safeParse(proposed);
  if (!proposedResult.success) {
    throw new Error("Refusing to save a schema-invalid manifest");
  }
  try {
    const currentBytes = await readRegularManifestBytes(manifestPath);
    let current: unknown;
    try {
      current = JSON.parse(currentBytes.toString("utf-8"));
    } catch {
      return true;
    }
    const currentResult = ManifestSchema.safeParse(current);
    if (!currentResult.success) return true;
    const proposedPaths = new Set(
      proposed.records.map((record) => record.installedPath),
    );
    const removesRecord = currentResult.data.records.some(
      (record) => !proposedPaths.has(record.installedPath),
    );
    const migratesLegacy = !currentResult.data.boundary && !!proposed.boundary;
    return removesRecord || migratesLegacy;
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" ||
      (error as Error).message.includes("ENOENT")
    ) {
      return false;
    }
    throw error;
  }
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
      injectManifestFault("backup-open");
      handle = await open(backupPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw new Error(
        `Could not create manifest backup ${backupPath}: ${(error as Error).message}`,
      );
    }

    try {
      try {
        injectManifestFault("backup-write");
        await handle.writeFile(sourceBytes);
        injectManifestFault("backup-sync");
        await handle.sync();
      } finally {
        injectManifestFault("backup-close");
        await handle.close();
      }
      injectManifestFault("backup-readback");
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
): Promise<void> {
  const normalizedPath = path.resolve(manifestPath);
  try {
    await assertNormalParent(normalizedPath);
    const lock = await acquireManifestLock(normalizedPath);
    try {
      const currentBytes = await readRegularManifestBytes(normalizedPath);
      if (!currentBytes.equals(expectedBytes)) return;
      for (let suffix = 0; suffix < 10000; suffix++) {
        const backupPath =
          suffix === 0
            ? `${normalizedPath}.bak`
            : `${normalizedPath}.bak-${suffix}`;
        try {
          await link(normalizedPath, backupPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
          return;
        }
        const beforeRemoval = await readRegularManifestBytes(normalizedPath);
        if (!beforeRemoval.equals(expectedBytes)) return;
        await unlink(normalizedPath);
        return;
      }
    } finally {
      await releaseManifestLock(lock);
    }
  } catch {
    // Preserve established invalid-manifest recovery behavior on filesystem errors.
  }
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
    try {
      injectManifestFault("replacement-write");
      await handle.writeFile(content);
      injectManifestFault("replacement-sync");
      await handle.sync();
    } finally {
      injectManifestFault("replacement-close");
      await handle.close();
    }
    if (expectedCurrentBytes) {
      injectManifestFault("replacement-freshness");
      const currentBytes = await readRegularManifestBytes(manifestPath);
      if (!currentBytes.equals(expectedCurrentBytes)) {
        throw new Error(
          "Manifest changed before guarded replacement; refusing rewrite",
        );
      }
    }
    injectManifestFault("replacement-rename");
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
