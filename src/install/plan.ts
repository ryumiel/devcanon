import { lstat, readdir } from "node:fs/promises";
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
        if (await hasCopyModeExecutableDrift(output, record.installMode)) {
          actions.push({
            kind: "update",
            target: output.target,
            type: output.type,
            name: output.name,
            sourcePath: output.sourcePath,
            generatedPath: output.generatedPath,
            installedPath: output.installedPath,
            contentHash: output.contentHash,
            reason: "Executable file metadata changed since last sync.",
          });
        } else {
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
        }
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

async function hasCopyModeExecutableDrift(
  output: RenderedOutput,
  installMode: string,
): Promise<boolean> {
  if (
    output.type !== "skill" ||
    installMode !== "copy" ||
    !output.generatedPath
  ) {
    return false;
  }

  const executableFiles = await collectExecutableFiles(output.generatedPath);
  for (const relPath of executableFiles) {
    const installedPath = path.join(
      output.installedPath,
      ...relPath.split("/"),
    );
    try {
      const installedStat = await lstat(installedPath);
      if (!installedStat.isFile() || (installedStat.mode & 0o111) === 0) {
        return true;
      }
    } catch {
      return true;
    }
  }

  return false;
}

async function collectExecutableFiles(
  root: string,
  base = "",
): Promise<string[]> {
  const currentDir = base
    ? path.join(root, ...base.split("/").filter(Boolean))
    : root;
  const executableFiles: string[] = [];
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const relPath = base ? `${base}/${entry.name}` : entry.name;
    const absolutePath = path.join(root, ...relPath.split("/"));

    if (entry.isDirectory()) {
      executableFiles.push(...(await collectExecutableFiles(root, relPath)));
      continue;
    }

    if (!entry.isFile()) continue;

    const stat = await lstat(absolutePath);
    if ((stat.mode & 0o111) !== 0) {
      executableFiles.push(relPath);
    }
  }

  return executableFiles;
}
