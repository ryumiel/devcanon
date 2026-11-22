import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Manifest, ResolvedConfig } from "../config/schema.js";
import type { PlanAction, UninstallOptions } from "../models/types.js";
import { UserError } from "../utils/errors.js";
import { getLogger } from "../utils/output.js";
import { verifyManagedOutputIdentity } from "./identity.js";
import {
  type ManagedPathIdentity,
  ManifestIdentityError,
  assertNoManagedPathConflicts,
  normalizeManifestIdentity,
} from "./manifest-identity.js";
import { loadInspectedManifest } from "./manifest-recovery.js";
import {
  type ManifestBackupAuthority,
  createManifestBackupAuthority,
  inspectManifest,
  releaseManifestBackupAuthority,
  saveManifest,
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

  const inspection = await inspectManifest(config.manifest.path);
  const loaded = await loadInspectedManifest(
    config.manifest.path,
    inspection,
    "uninstall",
    options.dryRun,
  );
  let normalized: ReturnType<typeof normalizeManifestIdentity>;
  try {
    normalized = normalizeManifestIdentity(loaded.manifest, config);
  } catch (error) {
    if (!(error instanceof ManifestIdentityError)) throw error;
    const message = (error as Error).message;
    if (!message.startsWith("Manifest boundary mismatch")) {
      throw new UserError(
        `Manifest identity is invalid: ${message}`,
        config.manifest.path,
      );
    }
    throw new UserError(
      `Manifest boundary does not match the configured homes: ${message}`,
      config.manifest.path,
      "Use the manifest with its original configured homes; boundary mismatches cannot be reconciled.",
    );
  }
  if (normalized.records.some((record) => record.ownership === "foreign")) {
    if (!loaded.manifest.boundary) {
      throw new UserError(
        "Legacy manifest contains foreign records; rerun sync with --reconcile-manifest.",
        config.manifest.path,
        "Run sync --reconcile-manifest to safely reconcile the legacy manifest.",
      );
    }
    throw new UserError(
      "Bound manifest contains foreign records; automatic reconciliation is forbidden.",
      config.manifest.path,
      "Restore matching configured homes or repair the manifest from a verified backup.",
    );
  }
  const manifest = normalized.manifest;

  assertManagedPathConflicts(
    manifest.records.map(
      (record): ManagedPathIdentity => ({
        target: record.target,
        type: record.type,
        name: recordName(record),
        installedPath: record.installedPath,
        activity:
          options.target === undefined || options.target === record.target
            ? "active"
            : "passive",
      }),
    ),
    config,
  );

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
    const removedActions: PlanAction[] = [];
    for (const action of plan) {
      try {
        const record = records.find((item) =>
          recordMatchesAction(item, action),
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
        removedActions.push(action);
        result.removed += 1;
      } catch (err) {
        result.errors.push(
          `Failed to remove ${action.installedPath}: ${(err as Error).message}`,
        );
      }
    }

    // Update manifest with whatever we successfully removed
    if (removedActions.length > 0) {
      try {
        const updated = removeManifestRecords(manifest, removedActions);
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

function assertManagedPathConflicts(
  entries: readonly ManagedPathIdentity[],
  config: ResolvedConfig,
): void {
  const manifestPath = path.resolve(config.manifest.path);
  try {
    assertNoManagedPathConflicts(entries, [
      { kind: "manifest", path: manifestPath },
      { kind: "manifest-lock", path: `${manifestPath}.lock` },
    ]);
  } catch (error) {
    if (!(error instanceof ManifestIdentityError)) throw error;
    throw new UserError(
      error.message,
      config.manifest.path,
      "Configure distinct target homes or repair the conflicting manifest records before uninstalling.",
    );
  }
}

function removeManifestRecords(
  manifest: Manifest,
  actions: PlanAction[],
): Manifest {
  return {
    ...manifest,
    lastSync: new Date().toISOString(),
    records: manifest.records.filter(
      (record) =>
        !actions.some((action) => recordMatchesAction(record, action)),
    ),
  };
}

function recordMatchesAction(
  record: Manifest["records"][number],
  action: PlanAction,
): boolean {
  return (
    record.target === action.target &&
    record.type === action.type &&
    record.name === action.name &&
    record.installedPath === action.installedPath
  );
}

function recordName(record: { name?: string }): string {
  if (record.name === undefined) {
    throw new Error("Managed manifest record is missing its normalized name");
  }
  return record.name;
}
