import { constants } from "node:fs";
import { access, lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RUNTIME_CONFIG_RELATIVE_PATH,
  loadRuntimeConfigCatalog,
} from "../config/runtime-config.js";
import type { AcceptedProvider } from "../runtime-build/provider.js";
import { UserError } from "../utils/errors.js";
import { pathOrSymlinkExists } from "../utils/fs.js";
import { DEVCANON_RUNTIME_SKILL_NAME } from "./skills.js";

export const RUNTIME_ENTRYPOINT = path.join("scripts", "devcanon-runtime.sh");
export const RUNTIME_BASH_RESOLVER = path.join("scripts", "resolve-bash.mjs");
export const RUNTIME_JS_DIR = path.join("scripts", "runtime");
export const RUNTIME_BUNDLE = path.join(RUNTIME_JS_DIR, "devcanon-runtime.mjs");
export const RUNTIME_MANIFEST = path.join(
  RUNTIME_JS_DIR,
  "runtime-manifest.json",
);
export const RUNTIME_LICENSES = path.join(
  RUNTIME_JS_DIR,
  "THIRD_PARTY_LICENSES",
);
export const REQUIRED_RUNTIME_FILES = [
  RUNTIME_ENTRYPOINT,
  RUNTIME_BASH_RESOLVER,
  RUNTIME_CONFIG_RELATIVE_PATH,
  RUNTIME_BUNDLE,
  RUNTIME_MANIFEST,
  RUNTIME_LICENSES,
] as const;

export type AdapterPairState = "current" | "pristine-legacy" | "invalid";

export interface RuntimeAdapterPair {
  readonly shell: Buffer;
  readonly resolver: Buffer;
}

export interface ValidateDevcanonRuntimeOptions {
  /** Required executing-distribution authority; never defaults to the candidate. */
  readonly adapterSourceDir?: string;
  readonly operation?: "read-only" | "compose";
  readonly pristineLegacyPair?: RuntimeAdapterPair;
  readonly provider?: AcceptedProvider;
}

declare const validatedDevcanonRuntimeBrand: unique symbol;

export interface ValidatedDevcanonRuntime {
  readonly runtimeDir: string;
  readonly adapterPair: RuntimeAdapterPair;
  readonly adapterState: Exclude<AdapterPairState, "invalid">;
  readonly providerLeaves: ReadonlyMap<string, Buffer>;
  /** Compatibility evidence retained for existing identity callers. */
  readonly closureRecords: readonly RuntimeClosureRecord[];
  readonly [validatedDevcanonRuntimeBrand]: true;
}

export interface RuntimeClosureRecord {
  readonly kind: "directory" | "file";
  readonly relativePath: string;
  readonly mode: string;
  readonly bytes?: Buffer;
}

export function devcanonRuntimeDir(skillsDir: string): string {
  return path.join(skillsDir, DEVCANON_RUNTIME_SKILL_NAME);
}

export function bundledDevcanonRuntimeDir(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../skills",
    DEVCANON_RUNTIME_SKILL_NAME,
  );
}

/** Read-only authored and derived-state validation. Provider acceptance belongs upstream. */
export async function validateDevcanonRuntime(
  runtimeDir: string,
  options: ValidateDevcanonRuntimeOptions = {},
): Promise<ValidatedDevcanonRuntime> {
  const root = await lstat(runtimeDir).catch(() => undefined);
  if (root === undefined) throw runtimeSourceMissingError(runtimeDir);
  await requireDirectory(runtimeDir, runtimeDir, ".");

  // The pair gate deliberately precedes catalog and derived-runtime checks.
  const currentPair = await readAdapterPair(
    options.adapterSourceDir ?? bundledDevcanonRuntimeDir(),
  ).catch((error) => {
    throw adapterAdoptionError(
      runtimeDir,
      error instanceof Error ? error.message : "missing",
    );
  });
  const targetPair = await readAdapterPair(runtimeDir).catch((error) => {
    throw adapterAdoptionError(
      runtimeDir,
      error instanceof Error ? error.message : "missing",
    );
  });
  const adapterState = classifyAdapterPair(
    targetPair,
    currentPair,
    options.pristineLegacyPair,
  );
  if (adapterState === "invalid")
    throw adapterAdoptionError(runtimeDir, "unrecognized");
  if (adapterState === "pristine-legacy" && options.operation !== "compose") {
    throw renderMigrationError(runtimeDir);
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
  await requireExactEntries(runtimeDir, ["config", "scripts"]);
  await requireDirectory(path.join(runtimeDir, "config"), runtimeDir, "config");
  await requireDirectory(
    path.join(runtimeDir, "scripts"),
    runtimeDir,
    "scripts",
  );
  await loadRuntimeConfigCatalog(
    path.join(runtimeDir, RUNTIME_CONFIG_RELATIVE_PATH),
  );
  const providerLeaves = await readDerivedRuntime(
    runtimeDir,
    options.provider,
  ).catch((error) => {
    throw renderRepairError(
      runtimeDir,
      error instanceof Error ? error.message : "invalid runtime subtree",
    );
  });

  return Object.freeze({
    runtimeDir,
    adapterPair: targetPair,
    adapterState,
    providerLeaves,
    closureRecords: [],
  }) as unknown as ValidatedDevcanonRuntime;
}

export function classifyAdapterPair(
  candidate: RuntimeAdapterPair,
  current: RuntimeAdapterPair,
  legacy?: RuntimeAdapterPair,
): AdapterPairState {
  if (samePair(candidate, current)) return "current";
  if (legacy !== undefined && samePair(candidate, legacy))
    return "pristine-legacy";
  return "invalid";
}

export async function validateBundledDevcanonRuntime(
  runtimeDir: string,
): Promise<void> {
  const validated = await validateDevcanonRuntime(runtimeDir, {
    adapterSourceDir: bundledDevcanonRuntimeDir(),
  });
  if (validated.adapterState !== "current") {
    throw adapterAdoptionError(runtimeDir, "legacy adapter pair");
  }
  if (process.platform !== "win32") {
    await access(
      path.join(runtimeDir, RUNTIME_ENTRYPOINT),
      constants.X_OK,
    ).catch(() => {
      throw adapterAdoptionError(runtimeDir, "non-executable shell adapter");
    });
  }
  await requireRuntimeContract(path.join(runtimeDir, RUNTIME_BUNDLE));
}

async function readAdapterPair(root: string): Promise<RuntimeAdapterPair> {
  const shellPath = path.join(root, RUNTIME_ENTRYPOINT);
  const resolverPath = path.join(root, RUNTIME_BASH_RESOLVER);
  const [shell, resolver] = await Promise.all([
    readRegularFile(shellPath, RUNTIME_ENTRYPOINT),
    readRegularFile(resolverPath, RUNTIME_BASH_RESOLVER),
  ]);
  if (
    process.platform !== "win32" &&
    ((await lstat(shellPath)).mode & 0o111) === 0
  ) {
    throw new Error("non-executable shell adapter");
  }
  return Object.freeze({ shell, resolver });
}

async function readDerivedRuntime(
  runtimeDir: string,
  provider?: AcceptedProvider,
): Promise<ReadonlyMap<string, Buffer>> {
  const directory = path.join(runtimeDir, RUNTIME_JS_DIR);
  await requireDirectory(directory, runtimeDir, RUNTIME_JS_DIR);
  const leaves = [
    "THIRD_PARTY_LICENSES",
    "devcanon-runtime.mjs",
    "runtime-manifest.json",
  ];
  const entries = (await readdir(directory)).sort();
  if (
    entries.length !== leaves.length ||
    entries.some((entry, index) => entry !== leaves[index])
  ) {
    throw new Error(
      "runtime subtree must contain exactly devcanon-runtime.mjs, runtime-manifest.json, and THIRD_PARTY_LICENSES",
    );
  }
  const records = await Promise.all(
    leaves.map(
      async (leaf) =>
        [
          leaf,
          await readRegularFile(
            path.join(directory, leaf),
            path.join(RUNTIME_JS_DIR, leaf),
          ),
        ] as const,
    ),
  );
  const result = new Map(records);
  if (provider !== undefined) {
    const expected = new Map([
      ["devcanon-runtime.mjs", provider.bundle.copy()],
      ["runtime-manifest.json", provider.manifestBytes.copy()],
      ["THIRD_PARTY_LICENSES", provider.licenses.copy()],
    ]);
    for (const [leaf, bytes] of expected) {
      if (!Buffer.from(result.get(leaf) ?? []).equals(bytes)) {
        throw new Error(
          `runtime subtree ${leaf} does not match the accepted provider`,
        );
      }
    }
  }
  return result;
}

async function readRegularFile(
  filePath: string,
  relativePath: string,
): Promise<Buffer> {
  const stat = await lstat(filePath).catch(() => undefined);
  if (stat === undefined || !stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${relativePath} must be a readable regular non-link file`);
  }
  await access(filePath, constants.R_OK).catch(() => {
    throw new Error(`${relativePath} must be readable`);
  });
  return readFile(filePath);
}

async function requireDirectory(
  directory: string,
  runtimeDir: string,
  relativePath: string,
): Promise<void> {
  const stat = await lstat(directory).catch(() => undefined);
  if (stat === undefined || !stat.isDirectory() || stat.isSymbolicLink()) {
    throw new UserError(
      `Fixed passive runtime support bundle ${DEVCANON_RUNTIME_SKILL_NAME} is incomplete.`,
      path.join(runtimeDir, relativePath),
      "Run devcanon render to reconcile the passive runtime, or restore the bundled support runtime.",
    );
  }
}

async function requireExactEntries(
  directory: string,
  expected: readonly string[],
): Promise<void> {
  const entries = (await readdir(directory)).sort();
  if (
    entries.length !== expected.length ||
    entries.some((entry, index) => entry !== expected[index])
  ) {
    throw renderRepairError(directory, "unexpected support-runtime entry");
  }
}

function samePair(
  left: RuntimeAdapterPair,
  right: RuntimeAdapterPair,
): boolean {
  return left.shell.equals(right.shell) && left.resolver.equals(right.resolver);
}

function adapterAdoptionError(runtimeDir: string, state: string): UserError {
  return new UserError(
    `Passive runtime adapter pair is ${state}.`,
    path.join(runtimeDir, "scripts"),
    "Back up both adapters, diff both against this DevCanon distribution, explicitly adopt both files from that same distribution, then rerun the command.",
  );
}

function runtimeSourceMissingError(runtimeDir: string): UserError {
  return new UserError(
    `Fixed passive runtime support bundle ${DEVCANON_RUNTIME_SKILL_NAME} is missing.`,
    runtimeDir,
    "Reinstall DevCanon or run from a complete source checkout.",
  );
}

function renderRepairError(runtimeDir: string, detail: string): UserError {
  return new UserError(
    `Passive runtime derived subtree is missing or stale: ${detail}.`,
    path.join(runtimeDir, RUNTIME_JS_DIR),
    "Run devcanon render to reconcile the passive runtime subtree.",
  );
}

function renderMigrationError(runtimeDir: string): UserError {
  return new UserError(
    "Passive runtime adapter pair is a recognized pristine legacy pair.",
    path.join(runtimeDir, "scripts"),
    "Run devcanon render to migrate the adapter pair and reconcile the passive runtime subtree.",
  );
}

async function requireRuntimeContract(bundle: string): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [
      bundle,
      "runtime",
      "contract",
    ]);
    const value = JSON.parse(stdout) as {
      command_group?: unknown;
      major_version?: unknown;
    };
    if (value.command_group !== "devcanon-runtime" || value.major_version !== 1)
      throw new Error("contract output did not match devcanon-runtime/v1");
  } catch (error) {
    throw new UserError(
      `Fixed passive runtime support bundle ${DEVCANON_RUNTIME_SKILL_NAME} contract check failed.`,
      bundle,
      `Reinstall DevCanon or restore the bundled runtime payload. ${(error as Error).message}`,
    );
  }
}
