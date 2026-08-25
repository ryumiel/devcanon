import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function runtimeEntrypoint(runtimeDir) {
  return path.join(runtimeDir, "scripts", "runtime", "cli.js");
}

function isFileInsideDirectory(filePath, dirPath) {
  try {
    const fileStat = lstatSync(filePath);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) return false;
    const relative = path.relative(
      realpathSync(dirPath),
      realpathSync(filePath),
    );
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
    if (isFileInsideDirectory(runtimeEntrypoint(overrideDir), overrideDir))
      return overrideDir;
    fail(
      `devcanon-runtime JS entrypoint missing: ${runtimeEntrypoint(overrideDir)}. DEVCANON_RUNTIME_DIR must point to a packaged devcanon-runtime passive runtime bundle directory containing runtime files.`,
    );
  }

  const scriptDir = path.dirname(scriptPath);
  const logicalRuntimeDir = path.join(
    path.resolve(scriptDir, "..", ".."),
    "devcanon-runtime",
  );
  if (
    isFileInsideDirectory(
      runtimeEntrypoint(logicalRuntimeDir),
      logicalRuntimeDir,
    )
  )
    return logicalRuntimeDir;

  const physicalRuntimeDir = path.join(
    path.resolve(realpathSync(scriptDir), "..", ".."),
    "devcanon-runtime",
  );
  if (
    physicalRuntimeDir !== logicalRuntimeDir &&
    isFileInsideDirectory(
      runtimeEntrypoint(physicalRuntimeDir),
      physicalRuntimeDir,
    )
  )
    return physicalRuntimeDir;

  fail(
    `devcanon-runtime JS entrypoint missing: ${runtimeEntrypoint(logicalRuntimeDir)}. Ensure generated previews or installed skill homes include the sibling devcanon-runtime passive runtime bundle, rerun devcanon render/sync, or set DEVCANON_RUNTIME_DIR for tests.`,
  );
}

export function runRuntimeBackedHelper(
  scriptPath,
  runtimeArgs,
  validateStdout,
) {
  const runtimeDir = resolveRuntimeDir(scriptPath);
  const child = spawnSync(
    process.execPath,
    [runtimeEntrypoint(runtimeDir), ...runtimeArgs],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
      input: "",
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    },
  );

  if (child.error) fail(child.error.message);
  if (child.status !== 0) {
    if (child.stdout) process.stdout.write(child.stdout);
    if (child.stderr) process.stderr.write(child.stderr);
    process.exit(child.status ?? 1);
  }
  if (child.stderr) {
    fail(
      `${runtimeArgs[0]} returned unexpected stderr: ${child.stderr.trim()}`,
    );
  }
  try {
    validateStdout(child.stdout ?? "");
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  process.stdout.write(child.stdout ?? "");
}

export function requireExactSilentStdout(stdout, helperName) {
  if (stdout !== "")
    throw new Error(`${helperName} returned unexpected stdout`);
}

export function requireExactLineStdout(stdout, expected, helperName) {
  if (stdout !== `${expected}\n`)
    throw new Error(`${helperName} returned missing or malformed stdout`);
}

export function requirePathStdout(stdout, pattern, helperName) {
  if (!pattern.test(stdout))
    throw new Error(`${helperName} returned missing or malformed path stdout`);
}
