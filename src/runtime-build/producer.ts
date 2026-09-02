import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build, version as esbuildVersion } from "esbuild";
import { parse as parseYaml } from "yaml";
import {
  type AcceptedProvider,
  type ArtifactOrigin,
  PROVIDER_LEAVES,
  sha256,
  verifyProvider,
} from "./provider.js";

export interface CanonicalInputRecord {
  path: string;
  content: Uint8Array;
}

export interface DependencyEdge {
  key: string;
  name: string;
  alias: string;
  kind: string;
  target_id: string;
}

export interface ProductionPackageInstance {
  id: string;
  name: string;
  version: string;
  integrity: string;
  dependencies: readonly DependencyEdge[];
}

export interface ProduceProviderOptions {
  repositoryRoot: string;
  origin: ArtifactOrigin;
  devcanonVersion: string;
  destinationRoot?: string;
}

export function canonicalInputSha256(
  records: readonly CanonicalInputRecord[],
): string {
  const sorted = [...records].sort((left, right) =>
    Buffer.compare(
      Buffer.from(left.path, "utf8"),
      Buffer.from(right.path, "utf8"),
    ),
  );
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1].path === sorted[index].path) {
      throw new Error(`duplicate canonical path: ${sorted[index].path}`);
    }
  }
  const hash = createCanonicalHash();
  for (const record of sorted) {
    const pathBytes = Buffer.from(record.path, "utf8");
    const content = Buffer.from(record.content);
    hash.update(frame(pathBytes));
    hash.update(frame(content));
  }
  return hash.digest("hex");
}

export function canonicalizeDependencyProjection(
  instances: readonly ProductionPackageInstance[],
): ProductionPackageInstance[] {
  const ids = new Set<string>();
  const projected = instances.map((instance) => {
    if (
      !isNonemptyString(instance.id) ||
      !isNonemptyString(instance.name) ||
      !isNonemptyString(instance.version) ||
      !isNonemptyString(instance.integrity) ||
      ids.has(instance.id)
    ) {
      throw new Error(`duplicate package instance identity: ${instance.id}`);
    }
    ids.add(instance.id);
    const edgeBytes = new Set<string>();
    const edgeIdentities = new Set<string>();
    const dependencies = [...instance.dependencies].sort((left, right) =>
      Buffer.compare(
        Buffer.from(JSON.stringify(left)),
        Buffer.from(JSON.stringify(right)),
      ),
    );
    for (const edge of dependencies) {
      if (
        !isNonemptyString(edge.key) ||
        !isNonemptyString(edge.name) ||
        !isNonemptyString(edge.alias) ||
        !isNonemptyString(edge.kind) ||
        !isNonemptyString(edge.target_id)
      ) {
        throw new Error("incomplete dependency edge");
      }
      const serialized = JSON.stringify(edge);
      const identity = `${edge.kind}\u0000${edge.key}\u0000${edge.name}\u0000${edge.alias}`;
      if (edgeBytes.has(serialized) || edgeIdentities.has(identity)) {
        throw new Error("duplicate dependency edge");
      }
      edgeBytes.add(serialized);
      edgeIdentities.add(identity);
    }
    return {
      id: instance.id,
      name: instance.name,
      version: instance.version,
      integrity: instance.integrity,
      dependencies,
    };
  });
  const knownIds = new Set(projected.map((instance) => instance.id));
  for (const instance of projected) {
    for (const edge of instance.dependencies) {
      if (!knownIds.has(edge.target_id)) {
        throw new Error(
          `dependency edge targets unknown package instance: ${edge.target_id}`,
        );
      }
    }
  }
  return projected.sort((left, right) =>
    Buffer.compare(Buffer.from(left.id, "utf8"), Buffer.from(right.id, "utf8")),
  );
}

export function renderThirdPartyLicenses(
  instances: readonly ProductionPackageInstance[],
  attribution: ReadonlyMap<string, string>,
): Buffer {
  const ordered = canonicalizeDependencyProjection(instances);
  const entries = ordered.map((instance) => {
    const text = attribution.get(instance.id);
    if (text === undefined || text.length === 0) {
      throw new Error(
        `missing attribution for package instance: ${instance.id}`,
      );
    }
    return `${instance.id}\n${normalizeLf(text).replace(/\n+$/u, "")}\n`;
  });
  return Buffer.from(entries.join("\n"), "utf8");
}

/** Produces only a staged, verified three-file root before publishing it. */
export async function produceProvider(
  options: ProduceProviderOptions,
): Promise<AcceptedProvider> {
  const destination =
    options.destinationRoot ??
    path.join(
      options.repositoryRoot,
      "dist",
      "devcanon-runtime",
      options.origin,
    );
  const result = await build({
    absWorkingDir: options.repositoryRoot,
    entryPoints: ["src/runtime/bundle-entry.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    outfile: "devcanon-runtime.mjs",
    write: false,
    metafile: true,
    legalComments: "none",
    logLevel: "silent",
  });
  const output = result.outputFiles.find((file) => file.path.endsWith(".mjs"));
  if (output === undefined) {
    throw new Error("esbuild did not produce a runtime bundle");
  }
  const bundle = Buffer.from(output.contents);
  const bundled = await collectBundledInstances(
    options.repositoryRoot,
    result.metafile ?? {},
  );
  const instances = bundled.map(
    ({ packageRoot: _packageRoot, ...instance }) => instance,
  );
  const records = await collectCanonicalInputs(
    options.repositoryRoot,
    options.devcanonVersion,
    instances,
  );
  const inputSha256 = canonicalInputSha256(records);
  const licenses = renderThirdPartyLicenses(
    instances,
    await collectAttribution(bundled),
  );
  const manifest = {
    schema: "devcanon-runtime-build/v1",
    devcanon_version: options.devcanonVersion,
    artifact_origin: options.origin,
    input_sha256: inputSha256,
    bundle_sha256: sha256(bundle),
    licenses_sha256: sha256(licenses),
    node_target: "node24",
  } as const;
  const stage = await mkdtemp(
    path.join(os.tmpdir(), "devcanon-runtime-stage-"),
  );
  try {
    await writeFile(path.join(stage, PROVIDER_LEAVES.bundle), bundle);
    await writeFile(
      path.join(stage, PROVIDER_LEAVES.manifest),
      `${JSON.stringify(manifest)}\n`,
    );
    await writeFile(path.join(stage, PROVIDER_LEAVES.licenses), licenses);
    await verifyProvider({
      root: stage,
      origin: options.origin,
      devcanonVersion: options.devcanonVersion,
      inputSha256,
    });
    await mkdir(path.dirname(destination), { recursive: true });
    const replacement = `${destination}.next`;
    await rm(replacement, { recursive: true, force: true });
    await rename(stage, replacement);
    const prior = `${destination}.prior`;
    await rm(prior, { recursive: true, force: true });
    let movedPrior = false;
    try {
      await rename(destination, prior).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      movedPrior = true;
      await rename(replacement, destination);
      await rm(prior, { recursive: true, force: true });
    } catch (error) {
      if (movedPrior) {
        await rename(prior, destination).catch(() => undefined);
      }
      throw error;
    }
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
  return verifyProvider({
    root: destination,
    origin: options.origin,
    devcanonVersion: options.devcanonVersion,
    inputSha256,
  });
}

async function collectCanonicalInputs(
  repositoryRoot: string,
  devcanonVersion: string,
  instances: readonly ProductionPackageInstance[],
): Promise<CanonicalInputRecord[]> {
  const sourceFiles = await listRuntimeSourceFiles(
    path.join(repositoryRoot, "src", "runtime"),
  );
  const records = await Promise.all(
    sourceFiles.map(async (absolutePath) => ({
      path: path
        .relative(repositoryRoot, absolutePath)
        .split(path.sep)
        .join("/"),
      content: await readFile(absolutePath),
    })),
  );
  const packageJson = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };
  records.push({
    path: ".devcanon-runtime/bundler.json",
    content: Buffer.from(
      `${JSON.stringify({ name: "esbuild", version: esbuildVersion, target: "node24", format: "esm", platform: "node" })}\n`,
    ),
  });
  records.push({
    path: ".devcanon-runtime/producing-version.json",
    content: Buffer.from(
      `${JSON.stringify({ devcanon_version: devcanonVersion })}\n`,
    ),
  });
  records.push({
    path: ".devcanon-runtime/root-production-dependencies.json",
    content: Buffer.from(`${JSON.stringify(packageJson.dependencies ?? {})}\n`),
  });
  records.push({
    path: ".devcanon-runtime/production-dependencies.json",
    content: Buffer.from(
      `${JSON.stringify(canonicalizeDependencyProjection(instances))}\n`,
    ),
  });
  return records;
}

async function listRuntimeSourceFiles(root: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const item = path.join(root, entry.name);
      if (entry.isDirectory()) return listRuntimeSourceFiles(item);
      return entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".test.ts") &&
        !entry.name.endsWith(".integration.test.ts")
        ? [item]
        : [];
    }),
  );
  return nested.flat();
}

interface BundledPackageInstance extends ProductionPackageInstance {
  packageRoot: string;
}

async function collectBundledInstances(
  repositoryRoot: string,
  metafile: { inputs?: Record<string, unknown> },
): Promise<BundledPackageInstance[]> {
  const packageRoots = new Set<string>();
  for (const input of Object.keys(metafile.inputs ?? {})) {
    const absolute = path.resolve(repositoryRoot, input);
    const root = await nearestPackageRoot(absolute);
    if (root !== undefined) packageRoots.add(root);
  }
  const packages = await Promise.all(
    [...packageRoots].map(async (packageRoot) => {
      const packageJson = JSON.parse(
        await readFile(path.join(packageRoot, "package.json"), "utf8"),
      ) as { name: string; version: string };
      return {
        id: `${packageJson.name}@${packageJson.version}`,
        name: packageJson.name,
        version: packageJson.version,
        integrity: "bundled-local-resolution",
        dependencies: [],
        packageRoot,
      };
    }),
  );
  const ids = new Set<string>();
  if (packages.some((item) => ids.has(item.id) || !ids.add(item.id))) {
    throw new Error("ambiguous bundled package attribution identity");
  }
  return resolveLockInstances(repositoryRoot, packages);
}

type PnpmLock = {
  packages?: Record<string, { resolution?: { integrity?: string } }>;
  snapshots?: Record<string, { dependencies?: Record<string, string> }>;
};

async function resolveLockInstances(
  repositoryRoot: string,
  packages: readonly BundledPackageInstance[],
): Promise<BundledPackageInstance[]> {
  const lock = parseYaml(
    await readFile(path.join(repositoryRoot, "pnpm-lock.yaml"), "utf8"),
  ) as PnpmLock;
  const lockPackages = lock.packages ?? {};
  const idsByNameAndVersion = new Map<string, string>();
  for (const item of packages) {
    const prefix = `${item.name}@${item.version}`;
    const candidates = Object.keys(lockPackages).filter(
      (id) => id === prefix || id.startsWith(`${prefix}(`),
    );
    if (candidates.length !== 1) {
      throw new Error(
        `ambiguous lockfile identity for bundled package: ${prefix}`,
      );
    }
    const [id] = candidates;
    const integrity = lockPackages[id]?.resolution?.integrity;
    if (typeof integrity !== "string" || integrity.length === 0) {
      throw new Error(`missing lockfile integrity for bundled package: ${id}`);
    }
    idsByNameAndVersion.set(prefix, id);
  }
  const knownIds = new Set(idsByNameAndVersion.values());
  return packages.map((item) => {
    const id = idsByNameAndVersion.get(`${item.name}@${item.version}`);
    if (id === undefined) throw new Error("missing resolved package identity");
    const dependencies = Object.entries(
      lock.snapshots?.[id]?.dependencies ?? {},
    ).flatMap(([key, version]) => {
      const candidates = [...knownIds].filter(
        (targetId) =>
          targetId === `${key}@${version}` ||
          targetId.startsWith(`${key}@${version}(`),
      );
      if (candidates.length === 0) return [];
      if (candidates.length > 1) {
        throw new Error(
          `ambiguous lockfile dependency edge: ${id} -> ${key}@${version}`,
        );
      }
      return [
        {
          key,
          name: key,
          alias: key,
          kind: "dependencies",
          target_id: candidates[0],
        },
      ];
    });
    return {
      ...item,
      id,
      integrity: lockPackages[id]?.resolution?.integrity ?? "",
      dependencies,
    };
  });
}

async function nearestPackageRoot(file: string): Promise<string | undefined> {
  let cursor = path.dirname(file);
  while (cursor !== path.dirname(cursor)) {
    const packageJson = path.join(cursor, "package.json");
    try {
      await readFile(packageJson);
      if (cursor.includes(`${path.sep}node_modules${path.sep}`)) return cursor;
    } catch {
      // Continue until the repository boundary or filesystem root.
    }
    cursor = path.dirname(cursor);
  }
  return undefined;
}

async function collectAttribution(
  instances: readonly BundledPackageInstance[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const instance of instances) {
    const licenseFiles = (await readdir(instance.packageRoot))
      .filter((name) => /^(?:license|copying|notice)(?:\..*)?$/iu.test(name))
      .sort((left, right) =>
        Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
      );
    if (licenseFiles.length === 0) {
      throw new Error(
        `missing attribution for package instance: ${instance.id}`,
      );
    }
    const text = await Promise.all(
      licenseFiles.map(async (file) =>
        readFile(path.join(instance.packageRoot, file), "utf8"),
      ),
    );
    result.set(instance.id, text.map(normalizeLf).join("\n"));
  }
  return result;
}

function frame(value: Buffer): Buffer {
  const prefix = Buffer.alloc(8);
  prefix.writeBigUInt64BE(BigInt(value.length));
  return Buffer.concat([prefix, value]);
}

function normalizeLf(value: string): string {
  return value.replace(/\r\n?/gu, "\n");
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function createCanonicalHash() {
  return createHash("sha256");
}
