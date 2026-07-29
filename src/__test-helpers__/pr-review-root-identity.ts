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
  const stat = await lstat(physical);
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
    if (isComponentContained(variant, candidate)) return variant;
  }
  throw new RootIdentityError(
    "working directory spelling is not component-contained by root",
  );
}

async function assertDirectoryWalk(
  root: string,
  candidate: string,
): Promise<void> {
  const relative = path.relative(root, candidate);
  const components = relative === "" ? [] : relative.split(path.sep);
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

async function assertPhysicalAncestry(
  root: PathIdentity,
  cwd: PathIdentity,
): Promise<void> {
  const relative = path.relative(root.physical, cwd.physical);
  let current = cwd.physical;
  const depth = relative === "" ? 0 : relative.split(path.sep).length;

  for (let index = 0; index <= depth; index += 1) {
    const stat = await lstat(current);
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
  stat: Awaited<ReturnType<typeof lstat>>,
  expected: PathIdentity["type"],
): void {
  const matches = expected === "directory" ? stat.isDirectory() : stat.isFile();
  if (!matches) throw new RootIdentityError(`path is not a ${expected}`);
}

function stableIdentity(stat: Awaited<ReturnType<typeof lstat>>): {
  device: bigint;
  file: bigint;
} {
  if (
    !Number.isSafeInteger(stat.dev) ||
    !Number.isSafeInteger(stat.ino) ||
    stat.dev < 0 ||
    stat.ino < 0
  ) {
    throw new RootIdentityError("path has no reliable stable identity");
  }
  return { device: BigInt(stat.dev), file: BigInt(stat.ino) };
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

function encodeVariants(identity: PathIdentity): Uint8Array[] {
  const values = new Set([
    identity.logical,
    identity.normalized,
    identity.physical,
  ]);
  return [...values].map((value) => new TextEncoder().encode(value));
}
