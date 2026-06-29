import { lstat, readdir, readlink, stat } from "node:fs/promises";
import path from "node:path";
import type { OverwritePolicy } from "../config/schema.js";
import type { Manifest } from "../config/schema.js";
import type { PlanAction, RenderedOutput } from "../models/types.js";
import type { PackagedSymlinkType } from "../render/mirrored-files.js";
import { pathExists, pathOrSymlinkExists } from "../utils/fs.js";
import { KNOWN_SUBDIRS } from "../validate/skills.js";

type DetectedSymlinkType = PackagedSymlinkType | "unknown";
type SymlinkKindEntry = { target: string; kind: PackagedSymlinkType };

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
    const record = manifestMap.get(output.installedPath);
    const exists = record
      ? await pathOrSymlinkExists(output.installedPath)
      : await pathExists(output.installedPath);

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
        const copyModeDrift = await getCopyModeDriftReason(
          output,
          record.installMode,
        );
        if (copyModeDrift !== null) {
          actions.push({
            kind: "update",
            target: output.target,
            type: output.type,
            name: output.name,
            sourcePath: output.sourcePath,
            generatedPath: output.generatedPath,
            installedPath: output.installedPath,
            contentHash: output.contentHash,
            reason: copyModeDrift,
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

async function getCopyModeDriftReason(
  output: RenderedOutput,
  installMode: string,
): Promise<string | null> {
  if (await hasCopyModeExecutableDrift(output, installMode)) {
    return "Executable file metadata changed since last sync.";
  }

  if (await hasCopyModeSymlinkKindDrift(output, installMode)) {
    return "Symlink kind metadata changed since last sync.";
  }

  return null;
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

  if (!(await pathExists(output.sourcePath))) {
    return false;
  }

  const executableModes = await collectMirroredFileExecutableModes(
    output.sourcePath,
  );
  for (const [relPath, desiredExecutable] of executableModes) {
    const installedPath = path.join(
      output.installedPath,
      ...relPath.split("/"),
    );
    try {
      const installedStat = await lstat(installedPath);
      if (!installedStat.isFile()) {
        return true;
      }
      const installedExecutable = (installedStat.mode & 0o111) !== 0;
      if (installedExecutable !== desiredExecutable) {
        return true;
      }
    } catch {
      return true;
    }
  }

  return false;
}

async function hasCopyModeSymlinkKindDrift(
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

  if (!(await pathExists(output.sourcePath))) {
    return false;
  }

  const symlinks = await collectMirroredSymlinkKinds(output.sourcePath);
  for (const [relPath, desiredSymlink] of symlinks) {
    const installedPath = path.join(
      output.installedPath,
      ...relPath.split("/"),
    );

    try {
      const installedStat = await lstat(installedPath);
      if (!installedStat.isSymbolicLink()) {
        return true;
      }
      if ((await readlink(installedPath)) !== desiredSymlink.target) {
        return true;
      }
      const installedKind = await getSymlinkKind(installedPath);
      if (
        installedKind === "unknown" ||
        installedKind !== desiredSymlink.kind
      ) {
        return true;
      }
    } catch {
      return true;
    }
  }

  return false;
}

async function collectMirroredSymlinkKinds(
  root: string,
): Promise<Map<string, SymlinkKindEntry>> {
  const symlinks = new Map<string, SymlinkKindEntry>();
  for (const subdir of KNOWN_SUBDIRS) {
    const subdirPath = path.join(root, subdir);
    if (!(await isRealDirectory(subdirPath))) continue;

    for (const [relPath, symlink] of await collectSymlinkKinds(root, subdir)) {
      symlinks.set(relPath, symlink);
    }
  }
  return symlinks;
}

async function collectMirroredFileExecutableModes(
  root: string,
): Promise<Map<string, boolean>> {
  const executableModes = new Map<string, boolean>();
  for (const subdir of KNOWN_SUBDIRS) {
    const subdirPath = path.join(root, subdir);
    if (!(await isRealDirectory(subdirPath))) continue;

    for (const [relPath, executable] of await collectFileExecutableModes(
      root,
      subdir,
    )) {
      executableModes.set(relPath, executable);
    }
  }
  return executableModes;
}

async function collectSymlinkKinds(
  root: string,
  base: string,
): Promise<Map<string, SymlinkKindEntry>> {
  const currentDir = path.join(root, ...base.split("/").filter(Boolean));
  const symlinks = new Map<string, SymlinkKindEntry>();
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const relPath = `${base}/${entry.name}`;
    const absolutePath = path.join(root, ...relPath.split("/"));

    if (entry.isDirectory()) {
      for (const [childPath, symlink] of await collectSymlinkKinds(
        root,
        relPath,
      )) {
        symlinks.set(childPath, symlink);
      }
      continue;
    }

    if (entry.isSymbolicLink()) {
      symlinks.set(relPath, {
        target: await readlink(absolutePath),
        kind: await getPackagedSymlinkKind(absolutePath),
      });
    }
  }

  return symlinks;
}

async function getPackagedSymlinkKind(
  symlinkPath: string,
): Promise<PackagedSymlinkType> {
  const symlinkKind = await getSymlinkKind(symlinkPath);
  return symlinkKind === "dir" ? "dir" : "file";
}

async function getSymlinkKind(
  symlinkPath: string,
): Promise<DetectedSymlinkType> {
  try {
    const targetStat = await stat(symlinkPath);
    return targetStat.isDirectory() ? "dir" : "file";
  } catch (err) {
    if (isNodeErrorCode(err, "ELOOP")) {
      return "file";
    }

    if (isNodeErrorCode(err, "ENOENT") || isNodeErrorCode(err, "EPERM")) {
      return getUnfollowableSymlinkKind(symlinkPath);
    }

    throw err;
  }
}

async function getUnfollowableSymlinkKind(
  symlinkPath: string,
): Promise<DetectedSymlinkType> {
  const target = await readlink(symlinkPath);
  const resolvedTarget = path.resolve(path.dirname(symlinkPath), target);
  try {
    await stat(resolvedTarget);
    return "unknown";
  } catch (err) {
    if (isNodeErrorCode(err, "ENOENT") || isNodeErrorCode(err, "ELOOP")) {
      return "file";
    }
    if (isNodeErrorCode(err, "EPERM")) {
      return "unknown";
    }
    throw err;
  }
}

async function isRealDirectory(targetPath: string): Promise<boolean> {
  try {
    return (await lstat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

async function collectFileExecutableModes(
  root: string,
  base: string,
): Promise<Map<string, boolean>> {
  const currentDir = base
    ? path.join(root, ...base.split("/").filter(Boolean))
    : root;
  const executableModes = new Map<string, boolean>();
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const relPath = base ? `${base}/${entry.name}` : entry.name;
    const absolutePath = path.join(root, ...relPath.split("/"));

    if (entry.isDirectory()) {
      for (const [childPath, executable] of await collectFileExecutableModes(
        root,
        relPath,
      )) {
        executableModes.set(childPath, executable);
      }
      continue;
    }

    if (!entry.isFile()) continue;

    const stat = await lstat(absolutePath);
    executableModes.set(relPath, (stat.mode & 0o111) !== 0);
  }

  return executableModes;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
