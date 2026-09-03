import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
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

const RECOGNIZED_LEGACY_ADAPTER_DIGESTS = Object.freeze({
  shell: "507f7be8a9f11f03ef3eb64ce964bb8cfd735ed46404ff993f0cd605f3cfc2ff",
  resolver: "9cf74a2caf4d782f09141251814ef0dcb04ee200c6eb12c7c91b4d13fcb62445",
});

/**
 * The adapter gate intentionally keeps every adoption outcome observable.
 * Callers must not turn a candidate into its own authority merely to make it
 * look current.
 */
export type AdapterPairState =
  | "current"
  | "pristine-legacy"
  | "mixed"
  | "missing"
  | "modified"
  | "linked"
  | "posix-mode-invalid";

export interface RuntimeAdapterPair {
  readonly shell: Buffer;
  readonly resolver: Buffer;
  /** Captured at validation time; publication and hashing consume these bytes. */
  readonly shellMode: number;
  readonly resolverMode: number;
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
  /** Physical identity captured with the read-only validation evidence. */
  readonly runtimeIdentity: string;
  /** Captured authority retained separately from the candidate-state result. */
  readonly authoritativeAdapterPair: RuntimeAdapterPair;
  readonly adapterPair: RuntimeAdapterPair;
  /** Candidate state. A compose-time legacy candidate still publishes current bytes. */
  readonly adapterState: "current" | "pristine-legacy";
  readonly sourceDisposition:
    | "current"
    | "repair-runtime"
    | "migrate-adapters-and-runtime";
  readonly providerLeaves: ReadonlyMap<string, Buffer>;
  /** Compatibility evidence retained for existing identity callers. */
  readonly closureRecords: readonly RuntimeClosureRecord[];
  readonly [validatedDevcanonRuntimeBrand]: true;
}

/**
 * A validated composition is a custody boundary, not a bag of Buffers. Every
 * public read receives fresh copies, so later consumers cannot mutate the
 * bytes or maps that hashing and publication will use.
 */
class RuntimeCompositionSnapshot implements ValidatedDevcanonRuntime {
  readonly #adapterPair: RuntimeAdapterPair;
  readonly #authoritativeAdapterPair: RuntimeAdapterPair;
  readonly #providerLeaves: ReadonlyMap<string, Buffer>;
  readonly runtimeDir: string;
  readonly runtimeIdentity: string;
  readonly adapterState: "current" | "pristine-legacy";
  readonly sourceDisposition:
    | "current"
    | "repair-runtime"
    | "migrate-adapters-and-runtime";
  readonly closureRecords: readonly RuntimeClosureRecord[];
  declare readonly [validatedDevcanonRuntimeBrand]: true;

  constructor(input: {
    runtimeDir: string;
    runtimeIdentity: string;
    adapterPair: RuntimeAdapterPair;
    authoritativeAdapterPair: RuntimeAdapterPair;
    adapterState: "current" | "pristine-legacy";
    sourceDisposition:
      | "current"
      | "repair-runtime"
      | "migrate-adapters-and-runtime";
    providerLeaves: ReadonlyMap<string, Buffer>;
  }) {
    this.runtimeDir = input.runtimeDir;
    this.runtimeIdentity = input.runtimeIdentity;
    this.#adapterPair = copyAdapterPair(input.adapterPair);
    this.#authoritativeAdapterPair = copyAdapterPair(
      input.authoritativeAdapterPair,
    );
    this.#providerLeaves = copyProviderLeaves(input.providerLeaves);
    this.adapterState = input.adapterState;
    this.sourceDisposition = input.sourceDisposition;
    this.closureRecords = Object.freeze([]);
    Object.freeze(this);
  }

  get adapterPair(): RuntimeAdapterPair {
    return copyAdapterPair(this.#adapterPair);
  }

  get authoritativeAdapterPair(): RuntimeAdapterPair {
    return copyAdapterPair(this.#authoritativeAdapterPair);
  }

  get providerLeaves(): ReadonlyMap<string, Buffer> {
    return copyProviderLeaves(this.#providerLeaves);
  }
}

export interface RuntimeClosureRecord {
  readonly kind: "directory" | "file";
  readonly relativePath: string;
  readonly mode: string;
  readonly bytes?: Buffer;
}

export interface ValidateBundledDevcanonRuntimeOptions {
  /** Test-only bounded authority seam; defaults to this executing distribution. */
  readonly adapterSourceDir?: string;
  /** Accepted package/source provider may materialize an absent derived subtree. */
  readonly provider?: AcceptedProvider;
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
  const physicalRuntimeDir = await realpath(runtimeDir);

  // The pair gate deliberately precedes catalog and derived-runtime checks.
  const currentPair = await readAdapterPair(
    options.adapterSourceDir ?? bundledDevcanonRuntimeDir(),
  ).catch((error) => {
    throw adapterAdoptionError(
      runtimeDir,
      error instanceof Error ? error.message : "missing",
    );
  });
  const candidate = await inspectAdapterPair(runtimeDir);
  const adapterState = classifyAdapterPair(
    candidate,
    currentPair,
    options.pristineLegacyPair,
  );
  if (adapterState !== "current" && adapterState !== "pristine-legacy")
    throw adapterAdoptionError(runtimeDir, adapterState);
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
  await requireExactEntries(path.join(runtimeDir, "config"), [
    "runtime-config.json",
  ]);
  const derivedPath = path.join(runtimeDir, RUNTIME_JS_DIR);
  const derivedExists = await pathOrSymlinkExists(derivedPath);
  await requireExactEntries(
    path.join(runtimeDir, "scripts"),
    !derivedExists && options.operation === "compose" && options.provider
      ? ["devcanon-runtime.sh", "resolve-bash.mjs"]
      : ["devcanon-runtime.sh", "resolve-bash.mjs", "runtime"],
  );
  await loadRuntimeConfigCatalog(
    path.join(runtimeDir, RUNTIME_CONFIG_RELATIVE_PATH),
  );
  let providerLeaves: ReadonlyMap<string, Buffer>;
  let runtimeNeedsRepair = false;
  try {
    providerLeaves = await readDerivedRuntime(runtimeDir, options.provider);
  } catch (error) {
    if (options.operation !== "compose" || options.provider === undefined) {
      throw renderRepairError(
        runtimeDir,
        error instanceof Error ? error.message : "invalid runtime subtree",
      );
    }
    runtimeNeedsRepair = true;
    providerLeaves = providerLeavesFromAcceptedProvider(options.provider);
  }

  return new RuntimeCompositionSnapshot({
    runtimeDir,
    runtimeIdentity: physicalRuntimeDir,
    // A pristine legacy pair is evidence for migration, never publication
    // input. The immutable composition snapshot always owns current bytes.
    adapterPair: currentPair,
    authoritativeAdapterPair: currentPair,
    adapterState,
    sourceDisposition:
      adapterState === "pristine-legacy"
        ? "migrate-adapters-and-runtime"
        : runtimeNeedsRepair
          ? "repair-runtime"
          : "current",
    providerLeaves,
  });
}

export function classifyAdapterPair(
  candidate: RuntimeAdapterPair | AdapterPairState,
  current: RuntimeAdapterPair,
  legacy?: RuntimeAdapterPair,
): AdapterPairState {
  if (typeof candidate === "string") return candidate;
  if (samePair(candidate, current)) return "current";
  if (
    (legacy !== undefined && samePair(candidate, legacy)) ||
    isRecognizedLegacyPair(candidate)
  )
    return "pristine-legacy";
  const shellCurrent = candidate.shell.equals(current.shell);
  const resolverCurrent = candidate.resolver.equals(current.resolver);
  const shellLegacy =
    (legacy !== undefined && candidate.shell.equals(legacy.shell)) ||
    sha256(candidate.shell) === RECOGNIZED_LEGACY_ADAPTER_DIGESTS.shell;
  const resolverLegacy =
    (legacy !== undefined && candidate.resolver.equals(legacy.resolver)) ||
    sha256(candidate.resolver) === RECOGNIZED_LEGACY_ADAPTER_DIGESTS.resolver;
  if (
    (shellCurrent || shellLegacy) !== (resolverCurrent || resolverLegacy) ||
    (shellCurrent && resolverLegacy) ||
    (shellLegacy && resolverCurrent)
  )
    return "mixed";
  return "modified";
}

export async function validateBundledDevcanonRuntime(
  runtimeDir: string,
  options: ValidateBundledDevcanonRuntimeOptions = {},
): Promise<void> {
  const authority = options.adapterSourceDir ?? bundledDevcanonRuntimeDir();
  const validated = await validateDevcanonRuntime(runtimeDir, {
    adapterSourceDir: authority,
    operation: options.provider ? "compose" : undefined,
    provider: options.provider,
  });
  if (validated.adapterState !== "current") {
    throw adapterAdoptionError(runtimeDir, "legacy adapter pair");
  }
  if (options.provider === undefined) {
    await requireAdapterContracts(authority);
    await requireRuntimeContract(path.join(runtimeDir, RUNTIME_BUNDLE));
  } else {
    await requireComposedAdapterContracts(
      validated.authoritativeAdapterPair,
      options.provider,
    );
  }
}

async function readAdapterPair(root: string): Promise<RuntimeAdapterPair> {
  const shellPath = path.join(root, RUNTIME_ENTRYPOINT);
  const resolverPath = path.join(root, RUNTIME_BASH_RESOLVER);
  const [shellRecord, resolverRecord] = await Promise.all([
    readRegularFile(shellPath, RUNTIME_ENTRYPOINT),
    readRegularFile(resolverPath, RUNTIME_BASH_RESOLVER),
  ]);
  if (process.platform !== "win32" && (shellRecord.mode & 0o111) === 0) {
    throw new Error("non-executable shell adapter");
  }
  return Object.freeze({
    shell: shellRecord.bytes,
    resolver: resolverRecord.bytes,
    shellMode: shellRecord.mode & 0o777,
    resolverMode: resolverRecord.mode & 0o777,
  });
}

async function inspectAdapterPair(
  root: string,
): Promise<RuntimeAdapterPair | AdapterPairState> {
  const shellPath = path.join(root, RUNTIME_ENTRYPOINT);
  const resolverPath = path.join(root, RUNTIME_BASH_RESOLVER);
  const [shellStat, resolverStat] = await Promise.all([
    lstat(shellPath).catch(() => undefined),
    lstat(resolverPath).catch(() => undefined),
  ]);
  if (shellStat === undefined || resolverStat === undefined) return "missing";
  if (shellStat.isSymbolicLink() || resolverStat.isSymbolicLink())
    return "linked";
  if (!shellStat.isFile() || !resolverStat.isFile()) return "modified";
  if (process.platform !== "win32" && (shellStat.mode & 0o111) === 0)
    return "posix-mode-invalid";
  try {
    return Object.freeze({
      shell: await readFile(shellPath),
      resolver: await readFile(resolverPath),
      shellMode: shellStat.mode & 0o777,
      resolverMode: resolverStat.mode & 0o777,
    });
  } catch {
    return "modified";
  }
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
          (
            await readRegularFile(
              path.join(directory, leaf),
              path.join(RUNTIME_JS_DIR, leaf),
            )
          ).bytes,
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

function providerLeavesFromAcceptedProvider(
  provider: AcceptedProvider,
): ReadonlyMap<string, Buffer> {
  return new Map([
    ["devcanon-runtime.mjs", provider.bundle.copy()],
    ["runtime-manifest.json", provider.manifestBytes.copy()],
    ["THIRD_PARTY_LICENSES", provider.licenses.copy()],
  ]);
}

async function readRegularFile(
  filePath: string,
  relativePath: string,
): Promise<{ readonly bytes: Buffer; readonly mode: number }> {
  const stat = await lstat(filePath).catch(() => undefined);
  if (stat === undefined || !stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${relativePath} must be a readable regular non-link file`);
  }
  await access(filePath, constants.R_OK).catch(() => {
    throw new Error(`${relativePath} must be readable`);
  });
  return { bytes: await readFile(filePath), mode: stat.mode };
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

function isRecognizedLegacyPair(pair: RuntimeAdapterPair): boolean {
  return (
    sha256(pair.shell) === RECOGNIZED_LEGACY_ADAPTER_DIGESTS.shell &&
    sha256(pair.resolver) === RECOGNIZED_LEGACY_ADAPTER_DIGESTS.resolver
  );
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function copyAdapterPair(pair: RuntimeAdapterPair): RuntimeAdapterPair {
  return Object.freeze({
    shell: Buffer.from(pair.shell),
    resolver: Buffer.from(pair.resolver),
    shellMode: pair.shellMode,
    resolverMode: pair.resolverMode,
  });
}

function copyProviderLeaves(
  leaves: ReadonlyMap<string, Buffer>,
): ReadonlyMap<string, Buffer> {
  return new Map(
    [...leaves.entries()].map(([leaf, bytes]) => [leaf, Buffer.from(bytes)]),
  );
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

async function requireAdapterContracts(authority: string): Promise<void> {
  const shell = path.join(authority, RUNTIME_ENTRYPOINT);
  const resolver = path.join(authority, RUNTIME_BASH_RESOLVER);
  try {
    if (process.platform !== "win32") {
      await access(shell, constants.X_OK);
    }
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    if (process.platform !== "win32") {
      const { stdout: shellStdout } = await promisify(execFile)("bash", [
        shell,
        "runtime",
        "resolve-bash",
      ]);
      await assertBashExecutable(shellStdout, "shell adapter");
    }
    const { stdout: resolverStdout } = await promisify(execFile)(
      process.execPath,
      [resolver],
    );
    await assertBashExecutable(resolverStdout, "resolver");
  } catch (error) {
    throw new UserError(
      `Fixed passive runtime support bundle ${DEVCANON_RUNTIME_SKILL_NAME} adapter contract check failed.`,
      authority,
      `Reinstall DevCanon or restore the bundled adapter pair. ${(error as Error).message}`,
    );
  }
}

async function requireComposedAdapterContracts(
  pair: RuntimeAdapterPair,
  provider: AcceptedProvider,
): Promise<void> {
  const stage = await mkdtemp(path.join(os.tmpdir(), "devcanon-runtime-"));
  try {
    const scripts = path.join(stage, "scripts");
    const runtime = path.join(scripts, "runtime");
    await mkdir(runtime, { recursive: true });
    await writeFile(path.join(scripts, "devcanon-runtime.sh"), pair.shell);
    await writeFile(path.join(scripts, "resolve-bash.mjs"), pair.resolver);
    if (process.platform !== "win32") {
      await chmod(path.join(scripts, "devcanon-runtime.sh"), pair.shellMode);
    }
    await writeFile(
      path.join(runtime, "devcanon-runtime.mjs"),
      provider.bundle.copy(),
    );
    await writeFile(
      path.join(runtime, "runtime-manifest.json"),
      provider.manifestBytes.copy(),
    );
    await writeFile(
      path.join(runtime, "THIRD_PARTY_LICENSES"),
      provider.licenses.copy(),
    );
    await requireRuntimeContract(path.join(runtime, "devcanon-runtime.mjs"));
    await requireAdapterContracts(stage);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function assertBashExecutable(
  stdout: string,
  source: string,
): Promise<void> {
  const executable = stdout.trim();
  if (!path.isAbsolute(executable) || executable.includes("\n"))
    throw new Error(`${source} did not emit an absolute bash path`);
  const stat = await lstat(executable).catch(() => undefined);
  if (stat === undefined || !stat.isFile() || stat.isSymbolicLink())
    throw new Error(`${source} emitted a missing bash path`);
  await access(executable, constants.X_OK).catch(() => {
    throw new Error(`${source} emitted a non-executable bash path`);
  });
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const bashVersion = await promisify(execFile)(executable, [
    "-c",
    'printf "%s\\n" "${BASH_VERSION-}"',
  ])
    .then(({ stdout }) => stdout)
    .catch(() => "");
  if (!isBashIdentity(bashVersion))
    throw new Error(`${source} emitted a non-Bash executable path`);
}

function isBashIdentity(stdout: string): boolean {
  const identity = stdout.trim();
  return (
    identity.length > 0 &&
    !identity.includes("\n") &&
    !identity.includes("\r") &&
    /^[0-9]+(?:\.[0-9]+)+(?:[A-Za-z0-9()._-]*)$/.test(identity)
  );
}

function assertRuntimeContract(stdout: string): void {
  const value = JSON.parse(stdout) as {
    command_group?: unknown;
    major_version?: unknown;
  };
  if (value.command_group !== "devcanon-runtime" || value.major_version !== 1)
    throw new Error("contract output did not match devcanon-runtime/v1");
}
