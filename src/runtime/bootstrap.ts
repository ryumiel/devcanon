import { spawn } from "node:child_process";
import { constants, type Stats } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type RuntimeDirectoryPath,
  RuntimePathError,
  parseRuntimeDirectoryPath,
} from "./paths.js";

const runtimeEntrypointRelativePath = ["scripts", "devcanon-runtime.sh"];
const typedEntrypointRelativePath = ["scripts", "runtime", "cli.js"];
const forwardedSignals: readonly NodeJS.Signals[] = [
  "SIGINT",
  "SIGTERM",
  "SIGHUP",
  ...(process.platform === "win32" ? [] : ["SIGQUIT" as const]),
];

export class RuntimeBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeBootstrapError";
  }
}

export interface ValidatedRuntimeOverride {
  rawPath: string;
  inspectionPath: string;
  runtimeDirectory: string;
  entrypoint: string;
  typedEntrypoint: string;
}

export interface RuntimeDispatchResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

/**
 * Validates an override without executing or importing anything it owns.
 * Lexical input validation happens before filesystem normalization; physical
 * containment uses real paths and path.relative rather than text prefixes.
 */
export async function validateRuntimeOverride(
  rawPath: string,
): Promise<ValidatedRuntimeOverride> {
  let parsed: RuntimeDirectoryPath;
  try {
    parsed = parseRuntimeDirectoryPath(rawPath);
  } catch (error) {
    if (
      error instanceof RuntimePathError &&
      error.problem === "path-traversal"
    ) {
      throw new RuntimeBootstrapError(
        "DEVCANON_RUNTIME_DIR must not contain a parent-directory component",
      );
    }
    throw error;
  }
  let directoryStat: Stats;
  try {
    directoryStat = await lstat(parsed.inspectionPath);
  } catch {
    throw new RuntimeBootstrapError(
      "DEVCANON_RUNTIME_DIR must name a non-symlink packaged runtime directory",
    );
  }
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new RuntimeBootstrapError(
      "DEVCANON_RUNTIME_DIR must name a non-symlink packaged runtime directory",
    );
  }

  const lexicalEntrypoint = path.join(
    parsed.inspectionPath,
    ...runtimeEntrypointRelativePath,
  );
  await assertNoSymlinkedEntrypointComponent(
    parsed.inspectionPath,
    runtimeEntrypointRelativePath,
    "devcanon-runtime entrypoint",
  );
  let entrypointStat: Stats;
  try {
    entrypointStat = await lstat(lexicalEntrypoint);
    await access(lexicalEntrypoint, constants.X_OK);
  } catch {
    throw new RuntimeBootstrapError(
      "devcanon-runtime entrypoint must be an executable non-symlink file",
    );
  }
  if (!entrypointStat.isFile() || entrypointStat.isSymbolicLink()) {
    throw new RuntimeBootstrapError(
      "devcanon-runtime entrypoint must be an executable non-symlink file",
    );
  }

  const runtimeDirectory = await realpath(parsed.inspectionPath);
  const entrypoint = await realpath(lexicalEntrypoint);
  if (isOutsideDirectory(runtimeDirectory, entrypoint)) {
    throw new RuntimeBootstrapError(
      "devcanon-runtime entrypoint resolves outside DEVCANON_RUNTIME_DIR",
    );
  }
  const typedEntrypoint = await validateTypedEntrypoint(
    parsed.inspectionPath,
    runtimeDirectory,
  );
  if (process.platform === "win32") {
    assertWindowsTypedEntrypointDispatchable(typedEntrypoint);
  }

  return {
    rawPath,
    inspectionPath: parsed.inspectionPath,
    runtimeDirectory,
    entrypoint,
    typedEntrypoint,
  };
}

export async function dispatchRuntimeOverride(
  rawPath: string,
  childArguments: readonly string[],
): Promise<RuntimeDispatchResult> {
  const runtime = await validateRuntimeOverride(rawPath);
  return new Promise((resolve, reject) => {
    const command =
      process.platform === "win32" ? process.execPath : runtime.entrypoint;
    const args =
      process.platform === "win32"
        ? [runtime.typedEntrypoint, ...childArguments]
        : ["runtime", ...childArguments];
    const child = spawn(command, args, {
      detached: process.platform !== "win32",
      env: process.env,
      stdio: "inherit",
    });
    const signalHandlers = new Map<NodeJS.Signals, () => void>();
    for (const signal of forwardedSignals) {
      const handler = () => {
        forwardSignalToChild(child, signal);
      };
      signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }
    const cleanupSignalHandlers = () => {
      for (const [signal, handler] of signalHandlers) {
        process.removeListener(signal, handler);
      }
    };
    child.once("error", (error) => {
      cleanupSignalHandlers();
      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      cleanupSignalHandlers();
      resolve({ exitCode, signal });
    });
  });
}

function forwardSignalToChild(
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals,
): void {
  try {
    if (process.platform === "win32") {
      child.kill(signal);
      return;
    }
    if (child.pid === undefined) {
      throw new Error("child process did not provide a process id");
    }
    process.kill(-child.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    throw error;
  }
}

async function validateTypedEntrypoint(
  runtimeDirectory: string,
  physicalRuntimeDirectory: string,
): Promise<string> {
  const lexicalEntrypoint = path.join(
    runtimeDirectory,
    ...typedEntrypointRelativePath,
  );
  await assertNoSymlinkedEntrypointComponent(
    runtimeDirectory,
    typedEntrypointRelativePath,
    "devcanon-runtime typed entrypoint",
  );
  let stat: Stats;
  try {
    stat = await lstat(lexicalEntrypoint);
  } catch {
    throw new RuntimeBootstrapError(
      "devcanon-runtime typed entrypoint must be a non-symlink file",
    );
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new RuntimeBootstrapError(
      "devcanon-runtime typed entrypoint must be a non-symlink file",
    );
  }
  const typedEntrypoint = await realpath(lexicalEntrypoint);
  if (isOutsideDirectory(physicalRuntimeDirectory, typedEntrypoint)) {
    throw new RuntimeBootstrapError(
      "devcanon-runtime typed entrypoint resolves outside DEVCANON_RUNTIME_DIR",
    );
  }
  return typedEntrypoint;
}

async function assertNoSymlinkedEntrypointComponent(
  runtimeDirectory: string,
  components: readonly string[],
  entrypointName: string,
): Promise<void> {
  let cursor = runtimeDirectory;
  for (const component of components) {
    cursor = path.join(cursor, component);
    let stat: Stats;
    try {
      stat = await lstat(cursor);
    } catch {
      throw new RuntimeBootstrapError(
        `${entrypointName} must be a non-symlink file`,
      );
    }
    if (stat.isSymbolicLink()) {
      throw new RuntimeBootstrapError(
        `${entrypointName} must not contain a symlink or reparse-point component`,
      );
    }
  }
}

function isOutsideDirectory(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  );
}

function assertWindowsTypedEntrypointDispatchable(
  typedEntrypoint: string,
): void {
  let roundTripPath: string;
  try {
    roundTripPath = fileURLToPath(pathToFileURL(typedEntrypoint));
  } catch {
    throw new RuntimeBootstrapError(
      "devcanon-runtime typed entrypoint is not representable as a Windows file URL",
    );
  }
  const normalizeIdentity = (value: string) =>
    path.win32.normalize(value).toLowerCase();
  if (normalizeIdentity(roundTripPath) !== normalizeIdentity(typedEntrypoint)) {
    throw new RuntimeBootstrapError(
      "devcanon-runtime typed entrypoint is not representable as a Windows file URL",
    );
  }
}

export function formatBootstrapError(error: unknown): string {
  if (
    error instanceof RuntimePathError ||
    error instanceof RuntimeBootstrapError
  ) {
    return error.message;
  }
  return (error as Error).message;
}
