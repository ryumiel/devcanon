import path from "node:path";
import type { OverwritePolicy } from "../config/schema.js";
import type { Manifest } from "../config/schema.js";
import type { PlanAction, RenderedOutput } from "../models/types.js";
import { pathExists, pathOrSymlinkExists } from "../utils/fs.js";

export async function computePlan(
  outputs: RenderedOutput[],
  manifest: Manifest,
  overwritePolicy: OverwritePolicy,
  force: boolean,
  cleanManagedOutputs: boolean,
  targetFilter?: "claude" | "codex",
): Promise<PlanAction[]> {
  const actions: PlanAction[] = [];
  const manifestMap = new Map(
    manifest.records.map((r) => [r.installedPath, r]),
  );
  const currentInstalledPaths = new Set(outputs.map((o) => o.installedPath));

  const effectivePolicy: OverwritePolicy = force
    ? "overwrite-all"
    : overwritePolicy;

  for (const output of outputs) {
    const exists = await pathExists(output.installedPath);
    const record = manifestMap.get(output.installedPath);

    if (!exists) {
      actions.push({
        kind: "install",
        target: output.target,
        type: output.type,
        name: output.name,
        sourcePath: output.sourcePath,
        generatedPath: output.generatedPath,
        installedPath: output.installedPath,
        contentHash: output.contentHash,
        reason: "Not yet installed.",
      });
      continue;
    }

    // Path exists
    if (record) {
      // Managed file
      if (record.contentHash === output.contentHash) {
        actions.push({
          kind: "skip-up-to-date",
          target: output.target,
          type: output.type,
          name: output.name,
          sourcePath: output.sourcePath,
          generatedPath: output.generatedPath,
          installedPath: output.installedPath,
          contentHash: output.contentHash,
          reason: "Already up to date.",
        });
      } else {
        actions.push({
          kind: "update",
          target: output.target,
          type: output.type,
          name: output.name,
          sourcePath: output.sourcePath,
          generatedPath: output.generatedPath,
          installedPath: output.installedPath,
          contentHash: output.contentHash,
          reason: "Content changed since last sync.",
        });
      }
    } else {
      // Unmanaged file at this path
      if (effectivePolicy === "overwrite-all") {
        actions.push({
          kind: "force-overwrite",
          target: output.target,
          type: output.type,
          name: output.name,
          sourcePath: output.sourcePath,
          generatedPath: output.generatedPath,
          installedPath: output.installedPath,
          contentHash: output.contentHash,
          reason: "Force overwriting unmanaged file.",
        });
      } else if (effectivePolicy === "skip-existing") {
        actions.push({
          kind: "skip-conflict",
          target: output.target,
          type: output.type,
          name: output.name,
          sourcePath: output.sourcePath,
          generatedPath: output.generatedPath,
          installedPath: output.installedPath,
          contentHash: output.contentHash,
          reason: "Unmanaged file exists (skip-existing policy).",
        });
      } else {
        // overwrite-managed — skip unmanaged
        actions.push({
          kind: "skip-conflict",
          target: output.target,
          type: output.type,
          name: output.name,
          sourcePath: output.sourcePath,
          generatedPath: output.generatedPath,
          installedPath: output.installedPath,
          contentHash: output.contentHash,
          reason: "Unmanaged file exists (overwrite-managed policy).",
        });
      }
    }
  }

  // Check for stale managed outputs to remove
  if (cleanManagedOutputs) {
    for (const record of manifest.records) {
      if (targetFilter && record.target !== targetFilter) continue;
      if (!currentInstalledPaths.has(record.installedPath)) {
        const exists = await pathOrSymlinkExists(record.installedPath);
        if (exists) {
          actions.push({
            kind: "remove",
            target: record.target,
            type: record.type,
            name: path.basename(record.installedPath),
            sourcePath: record.sourcePath,
            generatedPath: record.generatedPath,
            installedPath: record.installedPath,
            contentHash: "",
            reason: "Source removed; cleaning up managed output.",
          });
        }
      }
    }
  }

  return actions;
}
