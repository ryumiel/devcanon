#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function runtimeEntrypoint(runtimeDir) {
  return path.join(runtimeDir, "scripts", "runtime", "cli.js");
}

function isFileInsideDirectory(filePath, dirPath) {
  try {
    const fileStat = lstatSync(filePath);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) return false;

    const realFilePath = realpathSync(filePath);
    const realDirPath = realpathSync(dirPath);
    const relative = path.relative(realDirPath, realFilePath);
    return (
      relative.length > 0 &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative)
    );
  } catch {
    return false;
  }
}

function resolveRuntimeDir(scriptPath) {
  if (process.env.DEVCANON_RUNTIME_DIR) {
    const overrideDir = process.env.DEVCANON_RUNTIME_DIR;
    const overrideEntrypoint = runtimeEntrypoint(overrideDir);
    if (isFileInsideDirectory(overrideEntrypoint, overrideDir)) {
      return overrideDir;
    }
    fail(
      `devcanon-runtime JS entrypoint missing: ${overrideEntrypoint}. DEVCANON_RUNTIME_DIR must point to a packaged devcanon-runtime skill directory containing runtime files.`,
    );
  }

  const scriptDir = path.dirname(scriptPath);
  const skillsRoot = path.resolve(scriptDir, "..", "..");
  const candidateRuntimeDir = path.join(skillsRoot, "devcanon-runtime");
  const candidateEntrypoint = runtimeEntrypoint(candidateRuntimeDir);
  if (isFileInsideDirectory(candidateEntrypoint, candidateRuntimeDir)) {
    return candidateRuntimeDir;
  }

  const physicalScriptDir = realpathSync(scriptDir);
  const physicalSkillsRoot = path.resolve(physicalScriptDir, "..", "..");
  const physicalRuntimeDir = path.join(physicalSkillsRoot, "devcanon-runtime");
  const physicalEntrypoint = runtimeEntrypoint(physicalRuntimeDir);
  if (
    physicalRuntimeDir !== candidateRuntimeDir &&
    isFileInsideDirectory(physicalEntrypoint, physicalRuntimeDir)
  ) {
    return physicalRuntimeDir;
  }

  fail(
    `devcanon-runtime JS entrypoint missing: ${candidateEntrypoint}. Ensure generated previews or installed skill homes include the sibling devcanon-runtime support skill, rerun devcanon render/sync, or set DEVCANON_RUNTIME_DIR for tests.`,
  );
}

const scriptPath = fileURLToPath(import.meta.url);
const runtimeDir = resolveRuntimeDir(scriptPath);
const cliPath = runtimeEntrypoint(runtimeDir);

if (!existsSync(cliPath)) {
  fail(`devcanon-runtime JS entrypoint missing: ${cliPath}`);
}

const child = spawnSync(
  process.execPath,
  [cliPath, "issue-worktree-setup", ...process.argv.slice(2)],
  {
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  },
);

if (child.error) {
  fail(child.error.message);
}

process.exit(child.status ?? 1);
