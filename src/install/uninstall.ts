import { randomUUID } from "node:crypto";
import type { ResolvedConfig } from "../config/schema.js";
import type { PlanAction, UninstallOptions } from "../models/types.js";
import { UserError } from "../utils/errors.js";
import { getLogger } from "../utils/output.js";
import { verifyManagedOutputIdentity } from "./identity.js";
import { normalizeManifestIdentity } from "./manifest-identity.js";
import {
  type ManifestBackupAuthority,
  createManifestBackupAuthority,
  loadManifestWithSnapshot,
  releaseManifestBackupAuthority,
  saveManifest,
  updateManifest,
} from "./manifest.js";
import { executeRemove, formatRemoveDryRunLine } from "./remove.js";

export interface UninstallResult {
  removed: number;
  errors: string[];
}

export async function uninstall(
  config: ResolvedConfig,
  options: UninstallOptions,
): Promise<UninstallResult> {
  const logger = getLogger();
  const result: UninstallResult = { removed: 0, errors: [] };

  const loaded = await loadManifestWithSnapshot(config.manifest.path);
  let normalized: ReturnType<typeof normalizeManifestIdentity>;
  try {
    normalized = normalizeManifestIdentity(loaded.manifest, config);
  } catch (error) {
    throw new UserError(
      `Manifest boundary does not match the configured homes: ${(error as Error).message}`,
      config.manifest.path,
      "Use the manifest with its original configured homes; boundary mismatches cannot be reconciled.",
    );
  }
  if (normalized.records.some((record) => record.ownership === "foreign")) {
    throw new UserError(
      "Manifest contains foreign legacy records; run sync --reconcile-manifest before uninstalling.",
      config.manifest.path,
    );
  }
  const manifest = normalized.manifest;

  // Filter records by target
  const records = options.target
    ? manifest.records.filter((r) => r.target === options.target)
    : manifest.records;

  // Empty plan: nothing to remove
  if (records.length === 0) {
    logger.info("Nothing to remove.");
    return result;
  }

  // Build remove-only plan from manifest records
  const plan: PlanAction[] = records.map((record) => ({
    kind: "remove",
    target: record.target,
    type: record.type,
    name: recordName(record),
    sourcePath: record.sourcePath,
    generatedPath: record.generatedPath,
    installedPath: record.installedPath,
    contentHash: "",
    reason: "Uninstalling managed output.",
  }));

  // Dry run: print and return
  if (options.dryRun) {
    logger.info("Dry run — no changes will be made:\n");
    for (const action of plan) {
      logger.info(formatRemoveDryRunLine(action));
      logger.verbose(`    ${action.reason}`);
    }
    return result;
  }

  const operationId = `uninstall-${randomUUID()}`;
  let authority: ManifestBackupAuthority | undefined;
  try {
    if (!loaded.snapshot) {
      throw new Error(
        "Manifest cleanup requires a schema-valid loaded snapshot.",
      );
    }
    authority = await createManifestBackupAuthority(
      config.manifest.path,
      loaded.snapshot,
      operationId,
    );

    // Execute: remove each path, accumulate errors, continue on failure
    const removedPaths: string[] = [];
    for (const action of plan) {
      try {
        const record = records.find(
          (item) => item.installedPath === action.installedPath,
        );
        if (!record) {
          throw new Error("manifest record missing for uninstall action");
        }
        await verifyManagedOutputIdentity({
          config,
          record,
          allowMissing: true,
        });
        await executeRemove(action);
        removedPaths.push(action.installedPath);
        result.removed += 1;
      } catch (err) {
        result.errors.push(
          `Failed to remove ${action.installedPath}: ${(err as Error).message}`,
        );
      }
    }

    // Update manifest with whatever we successfully removed
    if (removedPaths.length > 0) {
      try {
        const updated = updateManifest(manifest, [], removedPaths);
        await saveManifest(config.manifest.path, updated, {
          authority,
          operationId,
        });
      } catch (err) {
        result.errors.push(
          `Failed to save manifest: ${(err as Error).message}`,
        );
      }
    }

    return result;
  } finally {
    if (authority) await releaseManifestBackupAuthority(authority);
  }
}

function recordName(record: { name?: string }): string {
  if (record.name === undefined) {
    throw new Error("Managed manifest record is missing its normalized name");
  }
  return record.name;
}
