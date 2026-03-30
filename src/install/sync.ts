import { rm } from "node:fs/promises";
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
import { loadManifest, saveManifest, updateManifest } from "./manifest.js";
import { computePlan } from "./plan.js";
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

  // Render outputs (filter by target, propagate strict mode)
  const { outputs } = await renderAll(
    config,
    !options.dryRun,
    options.strict,
    options.target,
  );

  // Filter for install planning (renderAll already filtered, but keep for clarity)
  const filteredOutputs = outputs;

  // Load manifest
  const manifest = await loadManifest(config.manifest.path);

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

  // Execute plan
  const newRecords: ManagedRecord[] = [];
  const removedPaths: string[] = [];

  for (const action of plan) {
    try {
      await executeAction(action, config, options);

      switch (action.kind) {
        case "install":
        case "update":
        case "force-overwrite":
          newRecords.push({
            target: action.target,
            type: action.type,
            sourcePath: action.sourcePath,
            generatedPath: action.generatedPath,
            installedPath: action.installedPath,
            installMode:
              options.mode ?? config.targets[action.target].installMode,
            contentHash: action.contentHash,
            timestamp: new Date().toISOString(),
          });
          if (action.kind === "install") totalResult.installed++;
          else if (action.kind === "update") totalResult.updated++;
          else totalResult.installed++;
          break;
        case "remove":
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
  try {
    const updatedManifest = updateManifest(manifest, newRecords, removedPaths);
    await saveManifest(config.manifest.path, updatedManifest);
  } catch (err) {
    totalResult.errors.push(
      `Failed to save manifest: ${(err as Error).message}`,
    );
  }

  return totalResult;
}

async function executeAction(
  action: PlanAction,
  config: ResolvedConfig,
  options: SyncOptions,
): Promise<void> {
  const logger = getLogger();

  switch (action.kind) {
    case "install":
    case "update":
    case "force-overwrite": {
      const installMode: InstallMode =
        options.mode ?? config.targets[action.target].installMode;

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
            } else {
              throw err;
            }
          }
        } else {
          await copyFile(action.generatedPath, action.installedPath);
        }
      } else if (action.type === "skill") {
        if (installMode === "symlink") {
          try {
            await createSymlink(action.sourcePath, action.installedPath, true);
          } catch (err) {
            if (
              (err as NodeJS.ErrnoException).code === "EPERM" &&
              config.platform.windowsSymlinkFallback === "copy"
            ) {
              await copyDirectory(action.sourcePath, action.installedPath);
            } else {
              throw err;
            }
          }
        } else {
          await copyDirectory(action.sourcePath, action.installedPath);
        }
      }

      logger.info(
        `  ${action.kind === "install" ? "+" : "~"} ${action.target}/${action.type}/${action.name}`,
      );
      break;
    }
    case "remove": {
      await rm(action.installedPath, { recursive: true, force: true });
      logger.info(`  - ${action.target}/${action.type}/${action.name}`);
      break;
    }
    case "skip-up-to-date":
      logger.verbose(
        `  = ${action.target}/${action.type}/${action.name} (up to date)`,
      );
      break;
    case "skip-conflict":
      logger.warn(
        `  ! ${action.target}/${action.type}/${action.name}: ${action.reason}`,
      );
      break;
  }
}

function printPlan(plan: PlanAction[]): void {
  const logger = getLogger();
  logger.info("Dry run — no changes will be made:\n");
  for (const action of plan) {
    const prefix =
      action.kind === "install"
        ? "+"
        : action.kind === "update"
          ? "~"
          : action.kind === "remove"
            ? "-"
            : action.kind === "skip-up-to-date"
              ? "="
              : "!";
    logger.info(
      `  ${prefix} [${action.kind}] ${action.target}/${action.type}/${action.name}`,
    );
    logger.verbose(`    ${action.reason}`);
  }
}
