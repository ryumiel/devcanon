import { createHash } from "node:crypto";
import { lstat, open, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { MANIFEST_MANAGED_BY } from "../config/identity.js";
import {
  type ManagedRecord,
  type Manifest,
  ManifestSchema,
} from "../config/schema.js";
import { atomicWriteFile, ensureDir, pathExists } from "../utils/fs.js";
import { getLogger } from "../utils/output.js";

const backupAuthorityBrand = Symbol("manifest-backup-authority");
const activeBackupAuthorities = new Map<string, ManifestBackupAuthority>();

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

/**
 * An operation-scoped capability. Its private brand and active registry keep
 * it out of the serialized manifest and prevent a backup from authorizing a
 * later, unrelated operation.
 */
export class ManifestBackupAuthority {
  readonly [backupAuthorityBrand] = true;
  active = true;

  constructor(
    readonly manifestPath: string,
    readonly originalBytes: Buffer,
    readonly originalDigest: string,
    readonly backupPath: string,
    readonly operationId: string,
    private lastAcceptedBytes: Buffer,
    private lastAcceptedDigest: string,
  ) {}

  getLastAcceptedBytes(): Buffer {
    return this.lastAcceptedBytes;
  }

  getLastAcceptedDigest(): string {
    return this.lastAcceptedDigest;
  }

  acceptDescendant(bytes: Buffer): void {
    this.lastAcceptedBytes = bytes;
    this.lastAcceptedDigest = digestBytes(bytes);
  }

  toJSON(): never {
    throw new Error("Manifest backup authority must not be serialized");
  }
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
    rawBytes = await readFile(manifestPath);
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
    try {
      await rename(manifestPath, `${manifestPath}.bak`);
    } catch {
      // ignore backup failure
    }
    return { manifest: emptyManifest(), snapshot: null };
  }

  const result = ManifestSchema.safeParse(parsed);
  if (!result.success) {
    getLogger().warn(
      `Warning: manifest schema invalid. Backing up to ${manifestPath}.bak`,
    );
    try {
      await rename(manifestPath, `${manifestPath}.bak`);
    } catch {
      // ignore backup failure
    }
    return { manifest: emptyManifest(), snapshot: null };
  }

  return {
    manifest: result.data,
    snapshot: {
      manifestPath: path.resolve(manifestPath),
      bytes: rawBytes,
      digest: digestBytes(rawBytes),
    },
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
  if (authority) {
    const currentBytes = await readRegularManifestBytes(normalizedManifestPath);
    if (!currentBytes.equals(authority.getLastAcceptedBytes())) {
      throw new Error(
        "Manifest changed since its last accepted save; refusing guarded rewrite",
      );
    }
  }
  await ensureDir(path.dirname(manifestPath));
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  await atomicWriteFile(manifestPath, content);
  authority?.acceptDescendant(Buffer.from(content, "utf-8"));
}

/** Capture exact bytes from a readable regular manifest file. */
export async function captureManifestSnapshot(
  manifestPath: string,
): Promise<ManifestSnapshot> {
  const normalizedManifestPath = path.resolve(manifestPath);
  const bytes = await readRegularManifestBytes(normalizedManifestPath);
  return {
    manifestPath: normalizedManifestPath,
    bytes,
    digest: digestBytes(bytes),
  };
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
  const currentBytes = await readRegularManifestBytes(normalizedManifestPath);
  if (!currentBytes.equals(snapshot.bytes)) {
    throw new Error("Manifest changed since it was loaded; refusing backup");
  }

  const backupPath = await writeVerifiedBackup(
    normalizedManifestPath,
    currentBytes,
    timestamp,
  );
  const authority = new ManifestBackupAuthority(
    normalizedManifestPath,
    Buffer.from(snapshot.bytes),
    snapshot.digest,
    backupPath,
    operationId,
    Buffer.from(currentBytes),
    digestBytes(currentBytes),
  );
  activeBackupAuthorities.set(normalizedManifestPath, authority);
  return authority;
}

/** Explicitly end an operation and revoke its non-serializable capability. */
export function releaseManifestBackupAuthority(
  authority: ManifestBackupAuthority,
): void {
  authority.active = false;
  if (activeBackupAuthorities.get(authority.manifestPath) === authority) {
    activeBackupAuthorities.delete(authority.manifestPath);
  }
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
    releaseManifestBackupAuthority(authority);
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
    if (!authority.active || authority[backupAuthorityBrand] !== true) {
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

  if (activeBackupAuthorities.has(normalizedManifestPath)) {
    throw new Error("Manifest save requires its active backup authority");
  }
  return undefined;
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
  const before = await lstat(manifestPath);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error("Manifest backup source must be a readable regular file");
  }
  const bytes = await readFile(manifestPath);
  const after = await lstat(manifestPath);
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    after.dev !== before.dev ||
    after.ino !== before.ino
  ) {
    throw new Error("Manifest backup source changed while it was read");
  }
  return bytes;
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
      handle = await open(backupPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw new Error(
        `Could not create manifest backup ${backupPath}: ${(error as Error).message}`,
      );
    }

    try {
      await handle.writeFile(sourceBytes);
      await handle.sync();
    } finally {
      await handle.close();
    }

    const readback = await readRegularManifestBytes(backupPath);
    if (!readback.equals(sourceBytes)) {
      throw new Error(`Manifest backup verification failed for ${backupPath}`);
    }
    return backupPath;
  }
}
