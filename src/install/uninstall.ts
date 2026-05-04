import path from "node:path";
import type { ResolvedConfig } from "../config/schema.js";
import type { PlanAction, UninstallOptions } from "../models/types.js";
import { getLogger } from "../utils/output.js";
import { loadManifest, saveManifest, updateManifest } from "./manifest.js";
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

  const manifest = await loadManifest(config.manifest.path);

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
    name: path.basename(record.installedPath),
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

  // Execute: remove each path, accumulate errors, continue on failure
  const removedPaths: string[] = [];
  for (const action of plan) {
    try {
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
  try {
    const updated = updateManifest(manifest, [], removedPaths);
    await saveManifest(config.manifest.path, updated);
  } catch (err) {
    result.errors.push(`Failed to save manifest: ${(err as Error).message}`);
  }

  return result;
}
