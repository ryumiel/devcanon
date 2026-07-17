import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  InstallMode,
  ManagedRecord,
  ResolvedConfig,
} from "../config/schema.js";
import type { PlanAction, SyncOptions } from "../models/types.js";
import { renderAll } from "../render/pipeline.js";
import { ensureDir } from "../utils/fs.js";
import { getLogger } from "../utils/output.js";
import { copyDirectory, copyFile } from "./copy.js";
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
  const loaded = await loadManifestWithSnapshot(config.manifest.path);
  const normalized = normalizeManifestIdentity(loaded.manifest, config);
  const legacy = !loaded.manifest.boundary;
  const foreignIndexes = normalized.records.flatMap((record, index) =>
    record.ownership === "foreign" ? [index] : [],
  );
  if (loaded.manifest.boundary && foreignIndexes.length > 0) {
    throw new Error("Manifest contains foreign records; refusing to continue.");
  }
  if (legacy && foreignIndexes.length > 0 && !options.reconcileManifest) {
    throw new Error(
      "Legacy manifest contains foreign records; rerun sync with --reconcile-manifest.",
    );
  }
  if (
    legacy &&
    foreignIndexes.length > 0 &&
    options.reconcileManifest &&
    options.dryRun
  ) {
    getLogger().info(
      `Dry run — would retain ${normalized.manifest.records.length - foreignIndexes.length} owned manifest records and remove ${foreignIndexes.length} foreign records.`,
    );
    return totalResult;
  }

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
  try {
    // A non-empty legacy manifest is a migration, while an empty manifest is
    // bound before the first generated or installed output is persisted.
    if (!options.dryRun && legacy) {
      if (foreignIndexes.length > 0 || loaded.manifest.records.length > 0) {
        await ensureAuthority();
        if (foreignIndexes.length > 0) {
          manifest = {
            ...manifest,
            records: manifest.records.filter(
              (_record, index) => !foreignIndexes.includes(index),
            ),
          };
        }
        await save(manifest);
      } else {
        await save(manifest);
      }
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
    const plan = await computePlan(
      filteredOutputs,
      manifest,
      config.defaults.overwritePolicy,
      options.force,
      config.defaults.cleanManagedOutputs,
      options.target,
    );

    // Dry run
    if (options.dryRun) {
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
    const removedPaths: string[] = [];
    const manifestRecords = new Map(
      manifest.records.map((record) => [record.installedPath, record]),
    );

    for (const action of plan) {
      try {
        const record = manifestRecords.get(action.installedPath);
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
            removedPaths.push(action.installedPath);
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
    if (newRecords.length > 0 || removedPaths.length > 0) {
      try {
        const updatedManifest = updateManifest(
          manifest,
          newRecords,
          removedPaths,
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
