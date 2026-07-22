import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  InstallMode,
  ManagedRecord,
  Manifest,
  ResolvedConfig,
} from "../config/schema.js";
import type { PlanAction, SyncOptions } from "../models/types.js";
import { type RenderMutation, renderAll } from "../render/pipeline.js";
import { UserError } from "../utils/errors.js";
import { ensureDir } from "../utils/fs.js";
import { getLogger } from "../utils/output.js";
import { copyDirectory, copyFile } from "./copy.js";
import { verifyManagedOutputIdentity } from "./identity.js";
import {
  type ManagedPathIdentity,
  ManifestIdentityError,
  assertNoManagedPathConflicts,
  normalizeManifestIdentity,
} from "./manifest-identity.js";
import {
  type LoadedManifest,
  type ManifestBackupAuthority,
  type ManifestRecoveryResult,
  createManifestBackupAuthority,
  inspectManifest,
  recoverInvalidManifest,
  releaseManifestBackupAuthority,
  saveManifest,
} from "./manifest.js";
import { computePlan } from "./plan.js";
import { executeRemove, formatRemoveDryRunLine } from "./remove.js";
import { createSymlink } from "./symlink.js";

export interface SyncResult {
  installed: number;
  updated: number;
  removed: number;
  skipped: number;
  conflicts: number;
  errors: string[];
  reconciliation?: ReconciliationResult;
}

export interface ReconciliationIdentity {
  target: "claude" | "codex";
  type: "skill" | "agent";
  name: string;
  installedPath: string;
}

export interface ReconciliationResult {
  retained: ReconciliationIdentity[];
  removed: ReconciliationIdentity[];
}

export async function sync(
  config: ResolvedConfig,
  options: SyncOptions,
): Promise<SyncResult> {
  const totalResult: SyncResult = {
    installed: 0,
    updated: 0,
    removed: 0,
    skipped: 0,
    conflicts: 0,
    errors: [],
  };

  // A manifest must be accepted before rendering can create generated output
  // or an install action can touch a configured home.
  const loaded = await loadManifestForSync(config, options);
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
  const legacy = !loaded.manifest.boundary;
  const foreignIndexes = normalized.records.flatMap((record, index) =>
    record.ownership === "foreign" ? [index] : [],
  );
  if (loaded.manifest.boundary && foreignIndexes.length > 0) {
    throw new UserError(
      "Bound manifest contains foreign records; automatic reconciliation is forbidden.",
      config.manifest.path,
      "Restore matching configured homes or repair the manifest from a verified backup.",
    );
  }
  if (legacy && foreignIndexes.length > 0 && !options.reconcileManifest) {
    throw new UserError(
      "Legacy manifest contains foreign records; rerun sync with --reconcile-manifest.",
      config.manifest.path,
    );
  }
  if (legacy && foreignIndexes.length > 0 && options.reconcileManifest) {
    totalResult.reconciliation = {
      retained: normalized.manifest.records
        .filter((_record, index) => !foreignIndexes.includes(index))
        .map(reconciliationIdentity),
      removed: foreignIndexes.map((index) =>
        reconciliationIdentity(normalized.manifest.records[index]),
      ),
    };
  }
  const protectedInstalledPathKeys = new Set(
    foreignIndexes.map((index) =>
      path.resolve(normalized.manifest.records[index].installedPath),
    ),
  );
  const reconciledForeignRecords = foreignIndexes.map(
    (index) => normalized.manifest.records[index],
  );
  assertReconciledForeignControlReservations(reconciledForeignRecords, config);
  const operationId = `sync-${randomUUID()}`;
  let authority: ManifestBackupAuthority | undefined;
  const ensureAuthority = async (): Promise<ManifestBackupAuthority> => {
    if (authority) return authority;
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
    return authority;
  };
  const save = async (nextManifest: typeof normalized.manifest) => {
    await saveManifest(
      config.manifest.path,
      nextManifest,
      authority ? { authority, operationId } : {},
    );
  };

  let manifest = normalized.manifest;
  if (foreignIndexes.length > 0) {
    manifest = {
      ...manifest,
      records: manifest.records.filter(
        (_record, index) => !foreignIndexes.includes(index),
      ),
    };
  }
  // Render the selected target without materializing generated output, then
  // validate active selected outputs alongside retained active/passive records
  // before any migration or generated-tree write.
  const { outputs: filteredOutputs, mutationInventory } = await renderAll(
    config,
    false,
    options.strict,
    options.target,
  );
  assertReconciledForeignGeneratedMutationReservations(
    reconciledForeignRecords,
    mutationInventory,
    config,
  );
  assertManagedPathConflicts(
    [
      ...manifest.records.map(
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
      ...filteredOutputs.map(
        (output): ManagedPathIdentity => ({
          target: output.target,
          type: output.type,
          name: output.name,
          installedPath: output.installedPath,
          activity: "active",
        }),
      ),
    ],
    config,
  );

  try {
    // An existing legacy manifest is a migration, while a missing manifest is
    // bound before the first generated or installed output is persisted.
    if (!options.dryRun && legacy) {
      if (loaded.snapshot) {
        await ensureAuthority();
      }
      await save(manifest);
    }

    // Render outputs (filter by target, propagate strict mode)
    const { outputs } = await renderAll(
      config,
      !options.dryRun,
      options.strict,
      options.target,
    );
    // Filter for install planning (renderAll already filtered, but keep for clarity)
    const filteredOutputs = outputs;

    // Compute plan
    const plannedActions = await computePlan(
      filteredOutputs,
      manifest,
      config.defaults.overwritePolicy,
      options.force,
      config.defaults.cleanManagedOutputs,
      options.target,
    );
    const plan = protectReconciledForeignPaths(
      plannedActions,
      protectedInstalledPathKeys,
    );

    // Dry run
    if (options.dryRun) {
      printReconciliationPreview(totalResult.reconciliation);
      printPlan(plan);
      return totalResult;
    }

    if (
      plan.some(
        (action) =>
          action.kind === "remove" || action.kind === "remove-missing",
      )
    ) {
      await ensureAuthority();
    }

    // Execute plan
    const newRecords: ManagedRecord[] = [];
    const removedActions: PlanAction[] = [];
    for (const action of plan) {
      try {
        const record = manifest.records.find((candidate) =>
          recordMatchesAction(candidate, action),
        );
        if (
          action.kind === "update" ||
          action.kind === "remove" ||
          action.kind === "remove-missing" ||
          action.kind === "skip-up-to-date" ||
          (action.kind === "install" && record)
        ) {
          if (!record) {
            throw new Error("manifest record missing for managed action");
          }
          await verifyManagedOutputIdentity({
            config,
            record,
            output: action.kind === "remove" ? undefined : action,
            allowMissing:
              action.kind === "install" || action.kind === "remove-missing",
          });
        }

        const actualInstallMode = await executeAction(action, config, options);

        switch (action.kind) {
          case "install":
          case "update":
          case "force-overwrite":
            newRecords.push({
              name: action.name,
              target: action.target,
              type: action.type,
              sourcePath: action.sourcePath,
              generatedPath: action.generatedPath,
              installedPath: action.installedPath,
              installMode: actualInstallMode,
              contentHash: action.contentHash,
              timestamp: new Date().toISOString(),
            });
            if (action.kind === "install") totalResult.installed++;
            else if (action.kind === "update") totalResult.updated++;
            else totalResult.installed++;
            break;
          case "remove":
          case "remove-missing":
            removedActions.push(action);
            totalResult.removed++;
            break;
          case "skip-up-to-date":
            totalResult.skipped++;
            break;
          case "skip-conflict":
            totalResult.conflicts++;
            break;
        }
      } catch (err) {
        totalResult.errors.push(
          `Failed to ${action.kind} ${action.installedPath}: ${(err as Error).message}`,
        );
      }
    }

    // Update manifest
    if (newRecords.length > 0 || removedActions.length > 0) {
      try {
        const updatedManifest = updateManifestByIdentity(
          manifest,
          newRecords,
          removedActions,
        );
        await save(updatedManifest);
      } catch (err) {
        totalResult.errors.push(
          `Failed to save manifest: ${(err as Error).message}`,
        );
      }
    }

    return totalResult;
  } finally {
    if (authority) await releaseManifestBackupAuthority(authority);
  }
}

function protectReconciledForeignPaths(
  plan: PlanAction[],
  protectedInstalledPathKeys: ReadonlySet<string>,
): PlanAction[] {
  return plan.map((action) => {
    if (
      !["install", "update", "force-overwrite", "remove"].includes(
        action.kind,
      ) ||
      ![...protectedInstalledPathKeys].some((protectedPath) =>
        pathsOverlapByComponent(action.installedPath, protectedPath),
      )
    ) {
      return action;
    }
    return {
      ...action,
      kind: "skip-conflict",
      reason:
        "A foreign legacy manifest record was reconciled at this path; same-sync mutation is blocked.",
    };
  });
}

function pathsOverlapByComponent(
  firstPath: string,
  secondPath: string,
): boolean {
  const first = path.resolve(firstPath);
  const second = path.resolve(secondPath);
  return (
    isComponentAncestor(first, second) || isComponentAncestor(second, first)
  );
}

function isComponentAncestor(ancestor: string, descendant: string): boolean {
  const relative = path.relative(ancestor, descendant);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && !relative.split(path.sep).includes(".."))
  );
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
      "Configure distinct target homes or remove the conflicting manifest record before retrying.",
    );
  }
}

function assertReconciledForeignControlReservations(
  records: readonly ManagedRecord[],
  config: ResolvedConfig,
): void {
  const manifestPath = path.resolve(config.manifest.path);
  const controls = [
    { kind: "manifest" as const, path: manifestPath },
    { kind: "manifest-lock" as const, path: `${manifestPath}.lock` },
  ];
  try {
    for (const record of records) {
      assertNoManagedPathConflicts(
        [
          {
            target: record.target,
            type: record.type,
            name: recordName(record),
            installedPath: record.installedPath,
            activity: "active",
          },
        ],
        controls,
      );
    }
  } catch (error) {
    if (!(error instanceof ManifestIdentityError)) throw error;
    throw new UserError(
      error.message,
      config.manifest.path,
      "Move the foreign manifest record away from the manifest control paths before retrying reconciliation.",
    );
  }
}

function assertReconciledForeignGeneratedMutationReservations(
  records: readonly ManagedRecord[],
  mutationInventory: readonly RenderMutation[],
  config: ResolvedConfig,
): void {
  for (const record of records) {
    const foreignPath = path.resolve(record.installedPath);
    for (const mutation of mutationInventory) {
      if (!pathsOverlapByComponent(foreignPath, mutation.path)) continue;
      const mutationIdentity =
        mutation.kind === "selected-output"
          ? `${mutation.target}/${mutation.type}/${mutation.name}`
          : `${mutation.target}/${mutation.type} stale-cleanup`;
      throw new UserError(
        `Reconciled foreign path overlaps renderer mutation inventory: ${foreignPath} (${record.target}/${record.type}/${recordName(record)}) and ${mutation.kind} ${mutation.path} (${mutationIdentity})`,
        config.manifest.path,
        "Move the foreign manifest record away from selected generated outputs and cleanup roots before retrying reconciliation.",
      );
    }
  }
}

async function loadManifestForSync(
  config: ResolvedConfig,
  options: SyncOptions,
): Promise<LoadedManifest> {
  const inspection = await inspectManifest(config.manifest.path);
  if (inspection.status !== "invalid") {
    return { manifest: inspection.manifest, snapshot: inspection.snapshot };
  }
  if (options.dryRun) {
    throw new UserError(
      inspection.message,
      config.manifest.path,
      dryInvalidManifestHint(inspection.message, config.manifest.path),
    );
  }

  const recovery = await recoverInvalidManifest(inspection);
  if (!recovery.completed) {
    const cause = recoveryCauseMessage(recovery.cause);
    const error = new UserError(
      `Manifest recovery did not complete (${recovery.category}; cleanup ${recovery.cleanup}).${cause ? ` Primary cause: ${cause}` : ""}`,
      config.manifest.path,
      unrecoveredManifestHint(recovery),
    );
    Object.defineProperty(error, "cause", { value: recovery.cause });
    throw error;
  }

  if (recovery.cleanup !== "clean") {
    getLogger().warn(
      `Manifest recovery committed to verified backup ${recovery.backupPath}, but cleanup degraded (${recovery.cleanup}).`,
    );
    throw new UserError(
      `Manifest recovery committed to ${recovery.backupPath}, but cleanup was ${recovery.cleanup}.`,
      config.manifest.path,
      "Resolve the recovery lock state before retrying sync.",
    );
  }
  getLogger().warn(
    `Recovered invalid manifest to verified backup ${recovery.backupPath}.`,
  );

  const afterRecovery = await inspectManifest(config.manifest.path);
  if (afterRecovery.status !== "absent") {
    throw new UserError(
      "Manifest state changed after invalid recovery completed.",
      config.manifest.path,
      "Inspect the current manifest state before retrying sync.",
    );
  }
  return {
    manifest: afterRecovery.manifest,
    snapshot: afterRecovery.snapshot,
  };
}

function recoveryCauseMessage(cause: unknown): string | undefined {
  if (!(cause instanceof Error)) return undefined;
  const message = cause.message.replaceAll(/\s+/g, " ").trim();
  return message || undefined;
}

function unrecoveredManifestHint(
  recovery: Extract<ManifestRecoveryResult, { completed: false }>,
): string {
  const actions: string[] = [];
  switch (recovery.candidate.status) {
    case "retained-unverifiable":
      actions.push(
        `Inspect and preserve the unverifiable recovery candidate at ${recovery.candidate.path}; do not remove it by pathname alone.`,
      );
      break;
    case "retained-owned":
      actions.push(
        `Inspect the retained owned recovery candidate at ${recovery.candidate.path} before any manual removal.`,
      );
      break;
    case "retained-replacement":
      actions.push(
        `Preserve and inspect the unmanaged replacement at ${recovery.candidate.path}; it is not owned by recovery and must not be auto-deleted.`,
      );
      break;
    case "none-created":
    case "owned-removed":
      break;
  }
  switch (recovery.lock.status) {
    case "pre-existing-blocker":
      actions.push(
        `Confirm no DevCanon manifest operation is active, then manually correct the pre-existing sibling lock at ${recovery.lock.path}.`,
      );
      break;
    case "retained-owned":
      actions.push(
        `Confirm no DevCanon manifest operation is active, then manually remove or correct the retained owned recovery lock at ${recovery.lock.path}.`,
      );
      break;
    case "not-inspected-or-not-owned":
    case "owned-removed":
      break;
  }
  return actions.length > 0
    ? actions.join(" ")
    : "Resolve the reported manifest state before retrying sync.";
}

function dryInvalidManifestHint(message: string, manifestPath: string): string {
  if (
    message === "Manifest is invalid: corrupt JSON" ||
    message === "Manifest is invalid: schema validation failed"
  ) {
    return "Recover the byte-backed invalid manifest with an explicit non-dry sync before retrying.";
  }
  if (message.includes("sibling lock")) {
    return `Confirm no DevCanon manifest operation is active, then manually correct the exact sibling lock for ${manifestPath} before retrying.`;
  }
  return `Restore ${manifestPath} as a readable regular file, or manually remove the unsafe source after verifying its custody, before retrying.`;
}

function updateManifestByIdentity(
  manifest: Manifest,
  newRecords: ManagedRecord[],
  removedActions: PlanAction[],
): Manifest {
  const withoutRemoved = manifest.records.filter(
    (record) =>
      !removedActions.some((action) => recordMatchesAction(record, action)),
  );
  const records = [...withoutRemoved];
  for (const newRecord of newRecords) {
    const index = records.findIndex((record) =>
      sameIdentity(record, newRecord),
    );
    if (index >= 0) records[index] = newRecord;
    else records.push(newRecord);
  }
  return { ...manifest, lastSync: new Date().toISOString(), records };
}

function sameIdentity(
  first: Pick<ManagedRecord, "target" | "type" | "name" | "installedPath">,
  second: Pick<ManagedRecord, "target" | "type" | "name" | "installedPath">,
): boolean {
  return (
    first.target === second.target &&
    first.type === second.type &&
    first.name === second.name &&
    first.installedPath === second.installedPath
  );
}

function reconciliationIdentity(record: ManagedRecord): ReconciliationIdentity {
  return {
    target: record.target,
    type: record.type,
    name: recordName(record),
    installedPath: record.installedPath,
  };
}

function recordMatchesAction(
  record: ManagedRecord,
  action: PlanAction,
): boolean {
  return (
    record.target === action.target &&
    record.type === action.type &&
    record.name === action.name &&
    record.installedPath === action.installedPath
  );
}

function recordName(record: ManagedRecord): string {
  if (record.name === undefined) {
    throw new Error("Managed manifest record is missing its normalized name");
  }
  return record.name;
}

async function executeAction(
  action: PlanAction,
  config: ResolvedConfig,
  options: SyncOptions,
): Promise<InstallMode> {
  const logger = getLogger();

  switch (action.kind) {
    case "install":
    case "update":
    case "force-overwrite": {
      const installMode: InstallMode =
        options.mode ?? config.targets[action.target].installMode;
      let actualInstallMode = installMode;

      await ensureDir(path.dirname(action.installedPath));

      if (action.type === "agent" && action.generatedPath) {
        if (installMode === "symlink") {
          try {
            await createSymlink(
              action.generatedPath,
              action.installedPath,
              false,
            );
          } catch (err) {
            if (
              (err as NodeJS.ErrnoException).code === "EPERM" &&
              config.platform.windowsSymlinkFallback === "copy"
            ) {
              await copyFile(action.generatedPath, action.installedPath);
              actualInstallMode = "copy";
            } else {
              throw err;
            }
          }
        } else {
          await copyFile(action.generatedPath, action.installedPath);
        }
      } else if (action.type === "skill") {
        const sourceDir = action.generatedPath ?? action.sourcePath;
        if (installMode === "symlink") {
          try {
            await createSymlink(sourceDir, action.installedPath, true);
          } catch (err) {
            if (
              (err as NodeJS.ErrnoException).code === "EPERM" &&
              config.platform.windowsSymlinkFallback === "copy"
            ) {
              await copyDirectory(sourceDir, action.installedPath);
              actualInstallMode = "copy";
            } else {
              throw err;
            }
          }
        } else {
          await copyDirectory(sourceDir, action.installedPath);
        }
      }

      logger.info(
        `  ${action.kind === "install" ? "+" : "~"} ${action.target}/${action.type}/${action.name}`,
      );
      return actualInstallMode;
    }
    case "remove": {
      await executeRemove(action);
      return config.targets[action.target].installMode;
    }
    case "remove-missing":
      return config.targets[action.target].installMode;
    case "skip-up-to-date":
      logger.verbose(
        `  = ${action.target}/${action.type}/${action.name} (up to date)`,
      );
      return config.targets[action.target].installMode;
    case "skip-conflict":
      logger.warn(
        `  ! ${action.target}/${action.type}/${action.name}: ${action.reason}`,
      );
      return config.targets[action.target].installMode;
  }
}

function printPlan(plan: PlanAction[]): void {
  const logger = getLogger();
  logger.info("Dry run — no changes will be made:\n");
  for (const action of plan) {
    if (action.kind === "remove" || action.kind === "remove-missing") {
      logger.info(formatRemoveDryRunLine(action));
    } else {
      const prefix =
        action.kind === "install"
          ? "+"
          : action.kind === "update"
            ? "~"
            : action.kind === "skip-up-to-date"
              ? "="
              : "!";
      logger.info(
        `  ${prefix} [${action.kind}] ${action.target}/${action.type}/${action.name}`,
      );
    }
    logger.verbose(`    ${action.reason}`);
  }
}

function printReconciliationPreview(
  reconciliation: ReconciliationResult | undefined,
): void {
  if (!reconciliation) return;
  const logger = getLogger();
  logger.info(
    `Manifest reconciliation: ${reconciliation.retained.length} retained, ${reconciliation.removed.length} removed.`,
  );
  for (const record of reconciliation.retained) {
    logger.info(
      `  = [retain] ${record.target}/${record.type}/${record.name} ${record.installedPath}`,
    );
  }
  for (const record of reconciliation.removed) {
    logger.info(
      `  - [remove-record] ${record.target}/${record.type}/${record.name} ${record.installedPath}`,
    );
  }
}
