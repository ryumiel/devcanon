import { execFile } from "node:child_process";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { UserError } from "../utils/errors.js";
import { pathOrSymlinkExists } from "../utils/fs.js";
import { DEVCANON_RUNTIME_SKILL_NAME } from "./skills.js";

export const RUNTIME_ENTRYPOINT = path.join("scripts", "devcanon-runtime.sh");
const RUNTIME_JS_DIR = path.join("scripts", "runtime");
const RUNTIME_JS_ENTRYPOINT = path.join(RUNTIME_JS_DIR, "cli.js");
const RUNTIME_JS_INDEX = path.join(RUNTIME_JS_DIR, "index.js");
const REQUIRED_RUNTIME_JS_FILES = [
  "artifacts.js",
  "bootstrap-cli.js",
  "bootstrap.js",
  "cleanup-git.js",
  "cli.js",
  "command.js",
  "git-diff-parser.js",
  "git-workspace-cleanup.js",
  "git.js",
  "index.js",
  "issue-worktree-setup.js",
  "paths.js",
  "play-review-shared-context.js",
  "pr-merge-worktree.js",
  "pr-review-leases.js",
  "pr-review-manifests.js",
  "pr-review-result-validation.js",
  "review-artifacts.js",
  "schema.js",
  "source-immutability.js",
] as const;
export const REQUIRED_RUNTIME_FILES = [
  RUNTIME_ENTRYPOINT,
  path.join(RUNTIME_JS_DIR, "package.json"),
  ...REQUIRED_RUNTIME_JS_FILES.map((fileName) =>
    path.join(RUNTIME_JS_DIR, fileName),
  ),
] as const;
const execFileAsync = promisify(execFile);

export function devcanonRuntimeDir(skillsDir: string): string {
  return path.join(skillsDir, DEVCANON_RUNTIME_SKILL_NAME);
}

export async function validateDevcanonRuntime(
  runtimeDir: string,
): Promise<void> {
  try {
    if (!(await lstat(runtimeDir)).isDirectory()) {
      throw runtimeSourceMissingError(runtimeDir);
    }
  } catch {
    throw runtimeSourceMissingError(runtimeDir);
  }

  for (const forbiddenPath of [
    "SKILL.md",
    path.join("agents", "openai.yaml"),
  ]) {
    if (await pathOrSymlinkExists(path.join(runtimeDir, forbiddenPath))) {
      throw new UserError(
        `${DEVCANON_RUNTIME_SKILL_NAME} support runtime must not contain ${forbiddenPath}.`,
        path.join(runtimeDir, forbiddenPath),
      );
    }
  }

  for (const relativePath of REQUIRED_RUNTIME_FILES) {
    if (!(await isRegularFile(path.join(runtimeDir, relativePath)))) {
      throw runtimeSourceIncompleteError(runtimeDir, relativePath);
    }
  }

  await requireRealDirectory(
    path.join(runtimeDir, "scripts"),
    runtimeDir,
    "scripts",
  );
  await requireRealDirectory(
    path.join(runtimeDir, RUNTIME_JS_DIR),
    runtimeDir,
    RUNTIME_JS_DIR,
  );
  await validateExactRuntimeTree(runtimeDir);

  const entrypoint = path.join(runtimeDir, RUNTIME_ENTRYPOINT);
  if (!(await hasExecutableBit(entrypoint))) {
    throw runtimeSourceIncompleteError(runtimeDir, RUNTIME_ENTRYPOINT);
  }
}

async function requireRealDirectory(
  directory: string,
  runtimeDir: string,
  relativePath: string,
): Promise<void> {
  try {
    if (!(await lstat(directory)).isDirectory()) {
      throw runtimeSourceIncompleteError(runtimeDir, relativePath);
    }
  } catch {
    throw runtimeSourceIncompleteError(runtimeDir, relativePath);
  }
}

async function validateExactRuntimeTree(runtimeDir: string): Promise<void> {
  await requireExactDirectoryEntries(runtimeDir, ["scripts"], runtimeDir);
  await requireExactDirectoryEntries(
    path.join(runtimeDir, "scripts"),
    ["devcanon-runtime.sh", "runtime"],
    runtimeDir,
  );
  await requireExactDirectoryEntries(
    path.join(runtimeDir, RUNTIME_JS_DIR),
    ["package.json", ...REQUIRED_RUNTIME_JS_FILES],
    runtimeDir,
  );
}

async function requireExactDirectoryEntries(
  directory: string,
  expectedEntries: readonly string[],
  runtimeDir: string,
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const relativePath = path.relative(runtimeDir, entryPath);
    if (
      entry.isSymbolicLink() ||
      !(entry.isDirectory() || entry.isFile()) ||
      !expectedEntries.includes(entry.name)
    ) {
      throw runtimeSourceIncompleteError(runtimeDir, relativePath);
    }
  }
}

export async function validateBundledDevcanonRuntime(
  runtimeDir: string,
): Promise<void> {
  await validateDevcanonRuntime(runtimeDir);
  await requireRuntimeCommandContract(runtimeDir);
  await requireRuntimeModuleSurface(runtimeDir);
}

function runtimeSourceMissingError(runtimeDir: string): UserError {
  return new UserError(
    `Bundled ${DEVCANON_RUNTIME_SKILL_NAME} support skill is missing.`,
    runtimeDir,
    "Reinstall DevCanon or run from a complete source checkout.",
  );
}

function runtimeSourceIncompleteError(
  runtimeDir: string,
  relativePath: string,
): UserError {
  return new UserError(
    `Bundled ${DEVCANON_RUNTIME_SKILL_NAME} support skill is incomplete.`,
    path.join(runtimeDir, relativePath),
    `Reinstall DevCanon or restore ${relativePath} in the bundled support runtime.`,
  );
}

async function requireRuntimeCommandContract(
  runtimeDir: string,
): Promise<void> {
  const entrypoint = path.join(runtimeDir, RUNTIME_ENTRYPOINT);
  await requireRuntimeShellContract(entrypoint);
  await requireRuntimeNodeContract(
    path.join(runtimeDir, RUNTIME_JS_ENTRYPOINT),
  );
}

async function requireRuntimeShellContract(filePath: string): Promise<void> {
  if (process.platform === "win32") return;
  await requireRuntimeContract(filePath, async () => ({
    command: filePath,
    args: ["contract"],
  }));
}

async function requireRuntimeNodeContract(filePath: string): Promise<void> {
  await requireRuntimeContract(filePath, async () => ({
    command: process.execPath,
    args: [filePath, "contract"],
  }));
}

async function requireRuntimeContract(
  filePath: string,
  invocation: () => Promise<{ command: string; args: readonly string[] }>,
): Promise<void> {
  try {
    const { command, args } = await invocation();
    const { stdout } = await execFileAsync(command, [...args], {
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    if (!isRuntimeContract(JSON.parse(stdout) as unknown)) {
      throw new Error("contract output did not match devcanon-runtime/v1");
    }
  } catch (err) {
    throw new UserError(
      `Bundled ${DEVCANON_RUNTIME_SKILL_NAME} support skill contract check failed.`,
      filePath,
      `Reinstall DevCanon or restore the bundled ${DEVCANON_RUNTIME_SKILL_NAME} runtime payload. ${(err as Error).message}`,
    );
  }
}

async function requireRuntimeModuleSurface(runtimeDir: string): Promise<void> {
  const indexEntrypoint = path.join(runtimeDir, RUNTIME_JS_INDEX);
  try {
    const runtimeModule = (await import(
      pathToFileURL(indexEntrypoint).href
    )) as Record<string, unknown>;
    for (const exportName of [
      "normalizeRuntimePath",
      "runIssueWorktreeSetupCommand",
      "runRuntimeCommand",
      "validateRuntimeSchema",
    ]) {
      if (typeof runtimeModule[exportName] !== "function") {
        throw new Error(`runtime export missing: ${exportName}`);
      }
    }
  } catch (err) {
    throw new UserError(
      `Bundled ${DEVCANON_RUNTIME_SKILL_NAME} support skill module surface check failed.`,
      indexEntrypoint,
      `Reinstall DevCanon or restore the bundled ${DEVCANON_RUNTIME_SKILL_NAME} runtime payload. ${(err as Error).message}`,
    );
  }
}

function isRuntimeContract(
  value: unknown,
): value is { command_group: "devcanon-runtime"; major_version: 1 } {
  return (
    value !== null &&
    typeof value === "object" &&
    "command_group" in value &&
    value.command_group === "devcanon-runtime" &&
    "major_version" in value &&
    value.major_version === 1
  );
}

async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    return (await lstat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function hasExecutableBit(filePath: string): Promise<boolean> {
  if (process.platform === "win32") return true;
  try {
    return ((await lstat(filePath)).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}
