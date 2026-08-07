import { realpath as realpathCallback } from "node:fs";
import { constants, access, lstat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const realpathNative = promisify(realpathCallback.native);
const MAX_PATH_BYTES = 8 * 1024;

export type PathIdentity = {
  logical: string;
  normalized: string;
  physical: string;
  type: "directory" | "file";
  device: bigint;
  file: bigint;
};

export type EnrolledExecutable = {
  identity: PathIdentity & { type: "file" };
  redactionVariants: readonly Uint8Array[];
};

export type EnrolledWorkingDirectory = {
  identity: PathIdentity & { type: "directory" };
  redactionVariants: readonly Uint8Array[];
};

export type WindowsPresentation = {
  readonly original: string;
  readonly volumeKey: string;
  readonly components: readonly string[];
};

export class RootIdentityError extends Error {
  constructor(message: string) {
    super(`Invalid cooperative command root identity: ${message}`);
    this.name = "RootIdentityError";
  }
}

export async function enrollPathIdentity<Type extends PathIdentity["type"]>(
  logical: string,
  expectedType: Type,
): Promise<PathIdentity & { type: Type }> {
  assertNativeAbsolutePath(logical);
  const normalized = path.normalize(path.resolve(logical));
  const physical = await resolvePhysicalPath(logical);
  const stat = await lstat(physical, { bigint: true });
  assertExpectedType(stat, expectedType);
  const identity = stableIdentity(stat);

  return {
    logical,
    normalized,
    physical,
    type: expectedType,
    ...identity,
  };
}

export async function enrollExecutable(
  logical: string,
): Promise<EnrolledExecutable> {
  const identity = await enrollPathIdentity(logical, "file");
  if (process.platform === "win32") {
    const extension = path.extname(identity.physical).toLowerCase();
    if (extension !== ".exe" && extension !== ".com") {
      throw new RootIdentityError(
        "Windows executable must end in .exe or .com",
      );
    }
  } else {
    try {
      await access(identity.physical, constants.X_OK);
    } catch {
      throw new RootIdentityError("executable lacks POSIX execute permission");
    }
  }

  return {
    identity,
    redactionVariants: encodeVariants(identity),
  };
}

export async function enrollWorkingDirectory(
  root: PathIdentity & { type: "directory" },
  logical: string,
): Promise<EnrolledWorkingDirectory> {
  assertNativeAbsolutePath(logical);
  const rootVariant = findContainingRootVariant(root, logical);
  await assertDirectoryWalk(rootVariant, logical);

  const identity = await enrollPathIdentity(logical, "directory");
  if (!isComponentContained(root.physical, identity.physical)) {
    throw new RootIdentityError(
      "working directory is not physically contained by root",
    );
  }
  await assertPhysicalAncestry(root, identity);

  return {
    identity,
    redactionVariants: encodeVariants(identity),
  };
}

export function assertNativeAbsolutePath(value: string): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    !path.isAbsolute(value) ||
    Buffer.byteLength(value, "utf8") > MAX_PATH_BYTES
  ) {
    throw new RootIdentityError("path must be a bounded native absolute path");
  }
}

function findContainingRootVariant(
  root: PathIdentity,
  candidate: string,
): string {
  for (const variant of [root.logical, root.normalized, root.physical]) {
    if (isRawComponentContained(variant, candidate)) return variant;
  }
  throw new RootIdentityError(
    "working directory spelling is not component-contained by root",
  );
}

async function assertDirectoryWalk(
  root: string,
  candidate: string,
): Promise<void> {
  const components = rawContainedComponents(root, candidate);
  let current = root;
  await assertDirectoryNotLink(current);
  for (const component of components) {
    if (component === "" || component === "." || component === "..") {
      throw new RootIdentityError("working directory has an invalid component");
    }
    current = path.join(current, component);
    await assertDirectoryNotLink(current);
  }
}

/**
 * Returns a presentation-only key for Windows textual preflight. It preserves
 * the original spelling; only the drive letter or UNC server/share volume key
 * uses Windows-equivalent case comparison. It is never physical authority.
 */
export function parseWindowsPresentation(value: string): WindowsPresentation {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    Buffer.byteLength(value, "utf8") > MAX_PATH_BYTES
  ) {
    throw new RootIdentityError(
      "Windows presentation must be a bounded NUL-free string",
    );
  }
  const original = value;
  let presentation = value;
  if (presentation.startsWith("\\\\?\\")) {
    const extended = presentation.slice(4);
    if (/^UNC[\\/]/i.test(extended)) {
      presentation = `\\\\${extended.slice(4)}`;
    } else if (
      /^(?:GLOBALROOT|Volume\{|\\|\.)/i.test(extended) ||
      !/^[A-Za-z]:[\\/]/.test(extended)
    ) {
      throw new RootIdentityError("Windows path has an unsupported namespace");
    } else {
      presentation = extended;
    }
  }
  if (/^[\\/]{2}[?.][\\/]/.test(presentation)) {
    throw new RootIdentityError("Windows path has an unsupported namespace");
  }

  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(presentation);
  if (drive) {
    return {
      original,
      volumeKey: `drive:${drive[1].toLowerCase()}`,
      components: splitRawWindowsComponents(drive[2]),
    };
  }

  const unc = /^[\\/]{2}([^\\/]+)[\\/]([^\\/]+)(?:[\\/](.*))?$/.exec(
    presentation,
  );
  if (unc) {
    return {
      original,
      volumeKey: `unc:${unc[1].toLowerCase()}/${unc[2].toLowerCase()}`,
      components: splitRawWindowsComponents(unc[3] ?? ""),
    };
  }
  throw new RootIdentityError("Windows path has an unsupported presentation");
}

async function assertPhysicalAncestry(
  root: PathIdentity,
  cwd: PathIdentity,
): Promise<void> {
  const relative = path.relative(root.physical, cwd.physical);
  let current = cwd.physical;
  const depth = relative === "" ? 0 : relative.split(path.sep).length;

  for (let index = 0; index <= depth; index += 1) {
    const stat = await lstat(current, { bigint: true });
    assertExpectedType(stat, "directory");
    if (stat.isSymbolicLink()) {
      throw new RootIdentityError(
        "working directory physical ancestry contains a symbolic link",
      );
    }
    if (index === depth && !sameIdentity(root, stableIdentity(stat))) {
      throw new RootIdentityError(
        "working directory root identity does not match enrollment",
      );
    }
    if (index < depth) current = path.dirname(current);
  }
}

async function resolvePhysicalPath(value: string): Promise<string> {
  try {
    return await realpathNative(value);
  } catch {
    throw new RootIdentityError("path cannot be resolved physically");
  }
}

async function assertDirectoryNotLink(value: string): Promise<void> {
  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(value);
  } catch {
    throw new RootIdentityError("working directory component is missing");
  }
  if (stat.isSymbolicLink()) {
    throw new RootIdentityError(
      "working directory component is a symbolic link",
    );
  }
  assertExpectedType(stat, "directory");
}

function assertExpectedType(
  stat: Pick<import("node:fs").Stats, "isDirectory" | "isFile">,
  expected: PathIdentity["type"],
): void {
  const matches = expected === "directory" ? stat.isDirectory() : stat.isFile();
  if (!matches) throw new RootIdentityError(`path is not a ${expected}`);
}

function stableIdentity(stat: import("node:fs").BigIntStats): {
  device: bigint;
  file: bigint;
} {
  if (
    typeof stat.dev !== "bigint" ||
    typeof stat.ino !== "bigint" ||
    stat.dev < 0n ||
    stat.ino < 0n
  ) {
    throw new RootIdentityError("path has no reliable stable identity");
  }
  return { device: stat.dev, file: stat.ino };
}

function sameIdentity(
  expected: Pick<PathIdentity, "device" | "file">,
  actual: { device: bigint; file: bigint },
): boolean {
  return expected.device === actual.device && expected.file === actual.file;
}

function isComponentContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function isRawComponentContained(root: string, candidate: string): boolean {
  try {
    rawContainedComponents(root, candidate);
    return true;
  } catch {
    return false;
  }
}

function rawContainedComponents(root: string, candidate: string): string[] {
  if (process.platform === "win32") {
    const rootPresentation = parseWindowsPresentation(root);
    const candidatePresentation = parseWindowsPresentation(candidate);
    if (
      rootPresentation.volumeKey !== candidatePresentation.volumeKey ||
      rootPresentation.components.length >
        candidatePresentation.components.length ||
      rootPresentation.components.some(
        (component, index) =>
          component !== candidatePresentation.components[index],
      )
    ) {
      throw new RootIdentityError(
        "working directory spelling is not component-contained by root",
      );
    }
    return candidatePresentation.components.slice(
      rootPresentation.components.length,
    );
  }

  if (candidate === root) return [];
  if (!candidate.startsWith(`${root}${path.sep}`)) {
    throw new RootIdentityError(
      "working directory spelling is not component-contained by root",
    );
  }
  return candidate.slice(root.length + 1).split(path.sep);
}

function splitRawWindowsComponents(value: string): string[] {
  return value === "" ? [] : value.split(/[\\/]/);
}

function encodeVariants(identity: PathIdentity): Uint8Array[] {
  const values = new Set([
    identity.logical,
    identity.normalized,
    identity.physical,
  ]);
  return [...values].map((value) => new TextEncoder().encode(value));
}
