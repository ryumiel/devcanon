import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { access, lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const PROVIDER_LEAVES = {
  bundle: "devcanon-runtime.mjs",
  manifest: "runtime-manifest.json",
  licenses: "THIRD_PARTY_LICENSES",
} as const;

export type ArtifactOrigin = "source-build" | "package";

export interface RuntimeManifest {
  schema: "devcanon-runtime-build/v1";
  devcanon_version: string;
  artifact_origin: ArtifactOrigin;
  input_sha256: string;
  bundle_sha256: string;
  licenses_sha256: string;
  node_target: "node24";
}

export interface AcceptedProvider {
  readonly root: string;
  readonly origin: ArtifactOrigin;
  readonly manifest: Readonly<RuntimeManifest>;
  readonly bundle: ImmutableProviderBytes;
  readonly manifestBytes: ImmutableProviderBytes;
  readonly licenses: ImmutableProviderBytes;
}

/** Captured bytes cannot be mutated through an accepted-provider snapshot. */
export class ImmutableProviderBytes {
  readonly #bytes: Buffer;

  constructor(bytes: Uint8Array) {
    this.#bytes = Buffer.from(bytes);
    Object.freeze(this);
  }

  copy(): Buffer {
    return Buffer.from(this.#bytes);
  }

  toString(encoding: BufferEncoding = "utf8"): string {
    return this.#bytes.toString(encoding);
  }
}

export interface VerifyProviderOptions {
  root: string;
  origin: ArtifactOrigin;
  devcanonVersion: string;
  /** Required for source-build because that origin can prove its input identity. */
  inputSha256?: string;
}

const SHA256 = /^[0-9a-f]{64}$/;
const manifestKeys = [
  "schema",
  "devcanon_version",
  "artifact_origin",
  "input_sha256",
  "bundle_sha256",
  "licenses_sha256",
  "node_target",
] as const;

export async function verifyProvider(
  options: VerifyProviderOptions,
): Promise<AcceptedProvider> {
  const rootIdentity = await assertClosedProviderRoot(options.root);
  const bundle = await readProviderLeaf(options.root, PROVIDER_LEAVES.bundle);
  const manifestBytes = await readProviderLeaf(
    options.root,
    PROVIDER_LEAVES.manifest,
  );
  const licenses = await readProviderLeaf(
    options.root,
    PROVIDER_LEAVES.licenses,
  );
  const manifest = parseManifest(manifestBytes);
  await assertUnchangedRoot(options.root, rootIdentity);

  if (manifest.artifact_origin !== options.origin) {
    throw new Error(
      "runtime provider origin does not match the selected origin",
    );
  }
  if (manifest.devcanon_version !== options.devcanonVersion) {
    throw new Error("runtime provider version does not match this DevCanon");
  }
  if (manifest.bundle_sha256 !== sha256(bundle)) {
    throw new Error("runtime provider bundle digest does not match its bytes");
  }
  if (manifest.licenses_sha256 !== sha256(licenses)) {
    throw new Error(
      "runtime provider licenses digest does not match its bytes",
    );
  }
  if (options.origin === "source-build") {
    if (
      options.inputSha256 === undefined ||
      !SHA256.test(options.inputSha256)
    ) {
      throw new Error(
        "source-build provider requires a recomputed input digest",
      );
    }
    if (manifest.input_sha256 !== options.inputSha256) {
      throw new Error(
        "runtime provider input digest does not match source inputs",
      );
    }
  }

  return Object.freeze({
    root: options.root,
    origin: options.origin,
    manifest: Object.freeze({ ...manifest }),
    bundle: new ImmutableProviderBytes(bundle),
    manifestBytes: new ImmutableProviderBytes(manifestBytes),
    licenses: new ImmutableProviderBytes(licenses),
  });
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function assertClosedProviderRoot(root: string): Promise<StatsIdentity> {
  const rootStat = await lstat(root).catch(() => undefined);
  if (
    rootStat === undefined ||
    !rootStat.isDirectory() ||
    rootStat.isSymbolicLink()
  ) {
    throw new Error(
      "runtime provider root must be a readable physical directory",
    );
  }
  await access(root, constants.R_OK).catch(() => {
    throw new Error("runtime provider root must be readable");
  });
  const entries = (await readdir(root)).sort();
  const expected = Object.values(PROVIDER_LEAVES).sort();
  if (
    entries.length !== expected.length ||
    entries.some((entry, index) => entry !== expected[index])
  ) {
    throw new Error(
      "runtime provider root must contain exactly the required files",
    );
  }
  return identity(rootStat);
}

async function readProviderLeaf(root: string, leaf: string): Promise<Buffer> {
  const leafPath = path.join(root, leaf);
  const leafStat = await lstat(leafPath).catch(() => undefined);
  if (
    leafStat === undefined ||
    !leafStat.isFile() ||
    leafStat.isSymbolicLink()
  ) {
    throw new Error(
      `runtime provider ${leaf} must be a readable regular non-link file`,
    );
  }
  await access(leafPath, constants.R_OK).catch(() => {
    throw new Error(`runtime provider ${leaf} must be readable`);
  });
  const before = identity(leafStat);
  const bytes = await readFile(leafPath);
  const after = await lstat(leafPath).catch(() => undefined);
  if (
    after === undefined ||
    !after.isFile() ||
    after.isSymbolicLink() ||
    !sameIdentity(before, identity(after))
  ) {
    throw new Error(`runtime provider ${leaf} changed while being read`);
  }
  return bytes;
}

type StatsIdentity = { dev: number; ino: number };

function identity(value: { dev: number; ino: number }): StatsIdentity {
  return { dev: value.dev, ino: value.ino };
}

function sameIdentity(left: StatsIdentity, right: StatsIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function assertUnchangedRoot(
  root: string,
  before: StatsIdentity,
): Promise<void> {
  const after = await lstat(root).catch(() => undefined);
  if (
    after === undefined ||
    !after.isDirectory() ||
    after.isSymbolicLink() ||
    !sameIdentity(before, identity(after))
  ) {
    throw new Error("runtime provider root changed while being read");
  }
}

function parseManifest(bytes: Buffer): RuntimeManifest {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf-8")) as unknown;
  } catch {
    throw new Error("runtime provider manifest must be valid JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("runtime provider manifest must be an object");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== manifestKeys.length ||
    keys.some((key, index) => key !== [...manifestKeys].sort()[index])
  ) {
    throw new Error(
      "runtime provider manifest must have exactly the supported fields",
    );
  }
  if (
    record.schema !== "devcanon-runtime-build/v1" ||
    record.node_target !== "node24" ||
    (record.artifact_origin !== "source-build" &&
      record.artifact_origin !== "package") ||
    typeof record.devcanon_version !== "string" ||
    record.devcanon_version.length === 0 ||
    !isDigest(record.input_sha256) ||
    !isDigest(record.bundle_sha256) ||
    !isDigest(record.licenses_sha256)
  ) {
    throw new Error("runtime provider manifest has invalid required fields");
  }
  return record as unknown as RuntimeManifest;
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}
