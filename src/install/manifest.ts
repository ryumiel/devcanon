import { rename } from "node:fs/promises";
import path from "node:path";
import {
  type ManagedRecord,
  type Manifest,
  ManifestSchema,
} from "../config/schema.js";
import {
  atomicWriteFile,
  ensureDir,
  pathExists,
  readTextFile,
} from "../utils/fs.js";
import { getLogger } from "../utils/output.js";

export function emptyManifest(): Manifest {
  return {
    version: 1,
    managedBy: "agents-manager",
    lastSync: new Date().toISOString(),
    records: [],
  };
}

export async function loadManifest(manifestPath: string): Promise<Manifest> {
  if (!(await pathExists(manifestPath))) {
    return emptyManifest();
  }

  let raw: string;
  try {
    raw = await readTextFile(manifestPath);
  } catch {
    getLogger().warn(`Warning: could not read manifest at ${manifestPath}`);
    return emptyManifest();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    getLogger().warn(
      `Warning: manifest is corrupt JSON. Backing up to ${manifestPath}.bak`,
    );
    try {
      await rename(manifestPath, `${manifestPath}.bak`);
    } catch {
      // ignore backup failure
    }
    return emptyManifest();
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
    return emptyManifest();
  }

  return result.data;
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
    managedBy: "agents-manager",
    lastSync: new Date().toISOString(),
    records: Array.from(recordMap.values()),
  };
}

export async function saveManifest(
  manifestPath: string,
  manifest: Manifest,
): Promise<void> {
  await ensureDir(path.dirname(manifestPath));
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  await atomicWriteFile(manifestPath, content);
}
