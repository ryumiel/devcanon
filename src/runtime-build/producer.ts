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

export interface ProductionDependencyProjection {
  root: readonly DependencyEdge[];
  packages: readonly ProductionPackageInstance[];
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
    const keys = Object.keys(instance).sort();
    const expected = ["dependencies", "id", "integrity", "name", "version"];
    if (
      keys.length !== expected.length ||
      keys.some((key, index) => key !== expected[index]) ||
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
    const dependencies = canonicalizeDependencyEdges(instance.dependencies);
    for (const edge of dependencies) {
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
  const known = new Set(ordered.map((instance) => instance.id));
  for (const id of attribution.keys()) {
    if (!known.has(id)) {
      throw new Error(`unknown attribution for package instance: ${id}`);
    }
  }
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
  const devcanonVersion = await readDevcanonVersion(options.repositoryRoot);
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
    devcanonVersion,
    instances,
    result.metafile ?? {},
  );
  const inputSha256 = canonicalInputSha256(records);
  const licenses = renderThirdPartyLicenses(
    instances,
    await collectAttribution(bundled),
  );
  const manifest = {
    schema: "devcanon-runtime-build/v1",
    devcanon_version: devcanonVersion,
    artifact_origin: options.origin,
    input_sha256: inputSha256,
    bundle_sha256: sha256(bundle),
    licenses_sha256: sha256(licenses),
    node_target: "node24",
  } as const;
  await mkdir(path.dirname(destination), { recursive: true });
  const stage = await mkdtemp(
    path.join(
      path.dirname(destination),
      `.${path.basename(destination)}.stage-`,
    ),
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
      devcanonVersion,
      inputSha256,
    });
    await publishVerifiedProvider({
      stage,
      destination,
      origin: options.origin,
      devcanonVersion,
      inputSha256,
    });
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
  return verifyProvider({
    root: destination,
    origin: options.origin,
    devcanonVersion,
    inputSha256,
  });
}

/** Source-only acceptance recomputes the repository identity; callers cannot attest it. */
export async function verifySourceProvider(options: {
  repositoryRoot: string;
  root: string;
  devcanonVersion: string;
}): Promise<AcceptedProvider> {
  const devcanonVersion = await readDevcanonVersion(options.repositoryRoot);
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
  const bundled = await collectBundledInstances(
    options.repositoryRoot,
    result.metafile ?? {},
  );
  const inputSha256 = canonicalInputSha256(
    await collectCanonicalInputs(
      options.repositoryRoot,
      devcanonVersion,
      bundled.map(({ packageRoot: _packageRoot, ...instance }) => instance),
      result.metafile ?? {},
    ),
  );
  return verifyProvider({
    root: options.root,
    origin: "source-build",
    devcanonVersion,
    inputSha256,
  });
}

async function readDevcanonVersion(repositoryRoot: string): Promise<string> {
  const packageJson = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  ) as { version?: unknown };
  if (!isNonemptyString(packageJson.version)) {
    throw new Error("package.json must provide the producing DevCanon version");
  }
  return packageJson.version;
}

export async function publishVerifiedProvider(options: {
  stage: string;
  destination: string;
  origin: ArtifactOrigin;
  devcanonVersion: string;
  inputSha256: string;
}): Promise<void> {
  const backup = `${options.stage}.prior`;
  let hadPrior = false;
  try {
    await rename(options.destination, backup);
    hadPrior = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await rename(options.stage, options.destination);
    await verifyProvider({
      root: options.destination,
      origin: options.origin,
      devcanonVersion: options.devcanonVersion,
      inputSha256: options.inputSha256,
    });
    if (hadPrior) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (!hadPrior) {
      await rm(options.destination, { recursive: true, force: true });
      throw error;
    }
    const failed = `${options.stage}.failed`;
    try {
      await rename(options.destination, failed).catch(
        (renameError: NodeJS.ErrnoException) => {
          if (renameError.code !== "ENOENT") throw renameError;
        },
      );
      await rename(backup, options.destination);
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        "runtime provider publication failed and prior provider could not be restored",
      );
    }
    throw error;
  }
}

async function collectCanonicalInputs(
  repositoryRoot: string,
  devcanonVersion: string,
  instances: readonly ProductionPackageInstance[],
  metafile: { inputs?: Record<string, unknown> },
): Promise<CanonicalInputRecord[]> {
  const sourceFiles = await listBundledFirstPartySources(
    repositoryRoot,
    metafile,
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
  ) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const lockfileContents = await readFile(
    path.join(repositoryRoot, "pnpm-lock.yaml"),
    "utf8",
  );
  const projection = extractPnpmProjection(lockfileContents, [
    ...instances,
    {
      id: "esbuild@0.27.4",
      name: "esbuild",
      version: esbuildVersion,
      integrity: "",
      dependencies: [],
    },
  ]);
  const selected = selectProjection(projection, instances);
  const esbuild = projection.packages.find(
    (item) => item.name === "esbuild" && item.version === esbuildVersion,
  );
  if (
    packageJson.devDependencies?.esbuild !== "0.27.4" ||
    esbuild === undefined
  ) {
    throw new Error(
      "runtime producer requires the exact pinned esbuild lock resolution",
    );
  }
  const esbuildReference = (parseYaml(lockfileContents) as PnpmLock)
    .importers?.["."]?.devDependencies?.esbuild;
  const esbuildTarget =
    typeof esbuildReference === "string"
      ? esbuildReference
      : esbuildReference?.version;
  if (esbuildTarget !== "0.27.4") {
    throw new Error(
      "runtime producer requires root's exact esbuild resolution",
    );
  }
  records.push({
    path: "src/runtime-build/producer.ts",
    content: await readFile(
      path.join(repositoryRoot, "src", "runtime-build", "producer.ts"),
    ),
  });
  records.push({
    path: "src/runtime-build/provider.ts",
    content: await readFile(
      path.join(repositoryRoot, "src", "runtime-build", "provider.ts"),
    ),
  });
  records.push({
    path: "tsconfig.json",
    content: await readFile(path.join(repositoryRoot, "tsconfig.json")),
  });
  records.push({
    path: ".devcanon-runtime/bundler.json",
    content: Buffer.from(
      `${JSON.stringify({ name: "esbuild", version: esbuildVersion, entrypoint: "src/runtime/bundle-entry.ts", bundle: true, format: "esm", platform: "node", target: "node24", outfile: "devcanon-runtime.mjs", write: false, metafile: true, legalComments: "none", logLevel: "silent" })}\n`,
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
    content: Buffer.from(
      `${JSON.stringify(
        Object.fromEntries(
          selected.root.map((edge) => [
            edge.alias,
            edge.kind === "optionalDependencies"
              ? packageJson.optionalDependencies?.[edge.alias]
              : packageJson.dependencies?.[edge.alias],
          ]),
        ),
      )}\n`,
    ),
  });
  records.push({
    path: ".devcanon-runtime/production-dependencies.json",
    content: Buffer.from(`${JSON.stringify(selected)}\n`),
  });
  records.push({
    path: ".devcanon-runtime/esbuild-resolution.json",
    content: Buffer.from(
      `${JSON.stringify({ root_dev_dependency: esbuildTarget, package: esbuild })}\n`,
    ),
  });
  return records;
}

async function listBundledFirstPartySources(
  repositoryRoot: string,
  metafile: { inputs?: Record<string, unknown> },
): Promise<string[]> {
  return Object.keys(metafile.inputs ?? {})
    .map((input) => path.resolve(repositoryRoot, input))
    .filter(
      (absolute) =>
        isWithin(repositoryRoot, absolute) &&
        !path
          .relative(repositoryRoot, absolute)
          .split(path.sep)
          .includes("node_modules"),
    )
    .sort((left, right) =>
      Buffer.compare(Buffer.from(left), Buffer.from(right)),
    );
}

function selectProjection(
  projection: ProductionDependencyProjection,
  instances: readonly ProductionPackageInstance[],
): ProductionDependencyProjection {
  const ids = new Set(instances.map((instance) => instance.id));
  const packages = projection.packages
    .filter((item) => ids.has(item.id))
    .map((item) => ({
      ...item,
      dependencies: item.dependencies.filter((edge) => ids.has(edge.target_id)),
    }));
  const root = projection.root.filter((edge) => ids.has(edge.target_id));
  return Object.freeze({
    root: canonicalizeDependencyEdges(root),
    packages: canonicalizeDependencyProjection(packages),
  });
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
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
    const root = await nearestPackageRoot(repositoryRoot, absolute);
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
  return resolveLockInstances(repositoryRoot, packages);
}

type PnpmLock = {
  importers?: Record<string, PnpmImporter>;
  packages?: Record<string, { resolution?: { integrity?: string } }>;
  snapshots?: Record<
    string,
    {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    }
  >;
};

type PnpmImporter = {
  dependencies?: Record<string, PnpmReference>;
  optionalDependencies?: Record<string, PnpmReference>;
  devDependencies?: Record<string, PnpmReference>;
};

type PnpmReference = string | { version?: string };

/**
 * Extracts the lockfile's canonical instance records without depending on
 * node_modules paths. Callers select the relevant closure before serializing.
 */
export function extractPnpmProjection(
  lockfileContents: string,
  bundled?: readonly Pick<ProductionPackageInstance, "name" | "version">[],
): ProductionDependencyProjection {
  const lock = parseYaml(lockfileContents) as PnpmLock;
  const packages = lock.packages ?? {};
  const instanceIds = Object.keys(lock.snapshots ?? {}).filter((id) => {
    if (bundled === undefined) return true;
    const parsed = parsePackageIdentity(id);
    return bundled.some(
      (item) => item.name === parsed.name && item.version === parsed.version,
    );
  });
  const records: ProductionPackageInstance[] = (
    instanceIds.length > 0 ? instanceIds : Object.keys(packages)
  ).map((id) => {
    const parsed = parsePackageIdentity(id);
    const packageId = `${parsed.name}@${parsed.version}`;
    const integrity =
      packages[packageId]?.resolution?.integrity ??
      packages[id]?.resolution?.integrity;
    if (integrity === undefined) {
      throw new Error(`missing lockfile integrity for package: ${id}`);
    }
    return {
      id,
      name: parsed.name,
      version: parsed.version,
      integrity,
      dependencies: [],
    } satisfies ProductionPackageInstance;
  });
  const knownIds = new Set(records.map((record) => record.id));
  for (const record of records) {
    const snapshot = lock.snapshots?.[record.id] ?? {};
    const dependencies = [
      ["dependencies", snapshot.dependencies],
      ["optionalDependencies", snapshot.optionalDependencies],
    ] as const;
    record.dependencies = canonicalizeDependencyEdges(
      dependencies.flatMap(([kind, entries]) =>
        Object.entries(entries ?? {}).flatMap(([alias, target]) => {
          try {
            return [resolveLockEdge(record.id, alias, target, kind, knownIds)];
          } catch (error) {
            if (
              bundled !== undefined &&
              /unresolved lockfile dependency edge/u.test(String(error))
            )
              return [];
            throw error;
          }
        }),
      ),
    );
  }
  const canonical = canonicalizeDependencyProjection(records);
  const root = canonicalizeDependencyEdges(
    readImporterEdges(
      lock.importers?.["."] ?? {},
      knownIds,
      bundled !== undefined,
    ),
  );
  return Object.freeze({ root, packages: canonical });
}

function parsePackageIdentity(id: string): { name: string; version: string } {
  const separator = id.startsWith("@") ? id.indexOf("@", 1) : id.indexOf("@");
  if (separator <= 0)
    throw new Error(`invalid lockfile package identity: ${id}`);
  const name = id.slice(0, separator);
  const version = id.slice(separator + 1).split("(")[0];
  if (!name || !version)
    throw new Error(`invalid lockfile package identity: ${id}`);
  return { name, version };
}

function readImporterEdges(
  importer: PnpmImporter,
  knownIds: ReadonlySet<string>,
  ignoreUnresolved = false,
): DependencyEdge[] {
  return (
    [
      ["dependencies", importer.dependencies],
      ["optionalDependencies", importer.optionalDependencies],
    ] as const
  ).flatMap(([kind, entries]) =>
    Object.entries(entries ?? {}).flatMap(([alias, reference]) => {
      try {
        return [
          resolveLockEdge("root importer", alias, reference, kind, knownIds),
        ];
      } catch (error) {
        if (
          ignoreUnresolved &&
          /unresolved lockfile dependency edge/u.test(String(error))
        )
          return [];
        throw error;
      }
    }),
  );
}

function resolveLockEdge(
  from: string,
  alias: string,
  reference: PnpmReference,
  kind: string,
  knownIds: ReadonlySet<string>,
): DependencyEdge {
  const target = typeof reference === "string" ? reference : reference.version;
  if (!isNonemptyString(target)) {
    throw new Error(`unresolved lockfile dependency edge: ${from} -> ${alias}`);
  }
  const targetIdentity = isQualifiedLockIdentity(target)
    ? target
    : `${alias}@${target}`;
  const candidates = [...knownIds].filter(
    (id) => id === targetIdentity || id.startsWith(`${targetIdentity}(`),
  );
  if (candidates.length !== 1) {
    throw new Error(
      `unresolved lockfile dependency edge: ${from} -> ${targetIdentity}`,
    );
  }
  return {
    key: alias,
    name: parsePackageIdentity(candidates[0]).name,
    alias,
    kind,
    target_id: candidates[0],
  };
}

function isQualifiedLockIdentity(value: string): boolean {
  return value.startsWith("@")
    ? /^@[^/]+\/[^@]+@/u.test(value)
    : /^[^@()]+@/u.test(value);
}

function canonicalizeDependencyEdges(
  edges: readonly DependencyEdge[],
): DependencyEdge[] {
  return [...edges]
    .map((edge) => {
      const keys = Object.keys(edge).sort();
      const expected = ["alias", "key", "kind", "name", "target_id"];
      if (
        keys.length !== expected.length ||
        keys.some((key, index) => key !== expected[index]) ||
        !isNonemptyString(edge.key) ||
        !isNonemptyString(edge.name) ||
        !isNonemptyString(edge.alias) ||
        !isNonemptyString(edge.kind) ||
        !isNonemptyString(edge.target_id)
      ) {
        throw new Error("incomplete dependency edge");
      }
      return {
        key: edge.key,
        name: edge.name,
        alias: edge.alias,
        kind: edge.kind,
        target_id: edge.target_id,
      };
    })
    .sort((left, right) =>
      Buffer.compare(
        Buffer.from(JSON.stringify(left)),
        Buffer.from(JSON.stringify(right)),
      ),
    );
}

async function resolveLockInstances(
  repositoryRoot: string,
  packages: readonly BundledPackageInstance[],
): Promise<BundledPackageInstance[]> {
  const projection = extractPnpmProjection(
    await readFile(path.join(repositoryRoot, "pnpm-lock.yaml"), "utf8"),
    packages,
  );
  const idsByPackageRoot = new Map<string, string>();
  for (const item of packages) {
    const prefix = `${item.name}@${item.version}`;
    const candidates = projection.packages
      .map((entry) => entry.id)
      .filter((id) => id === prefix || id.startsWith(`${prefix}(`));
    const physicalMatch = candidates.find((id) =>
      matchesPhysicalPnpmIdentity(repositoryRoot, item.packageRoot, id),
    );
    if (physicalMatch === undefined && candidates.length !== 1) {
      throw new Error(
        `ambiguous lockfile identity for bundled package: ${prefix}`,
      );
    }
    const [id] = candidates;
    idsByPackageRoot.set(item.packageRoot, physicalMatch ?? id);
  }
  const knownIds = new Set(idsByPackageRoot.values());
  return packages.map((item) => {
    const id = idsByPackageRoot.get(item.packageRoot);
    if (id === undefined) throw new Error("missing resolved package identity");
    const record = projection.packages.find((entry) => entry.id === id);
    if (record === undefined)
      throw new Error("missing resolved lockfile package");
    const dependencies = record.dependencies.filter((edge) =>
      knownIds.has(edge.target_id),
    );
    return {
      ...item,
      id,
      integrity: record.integrity,
      dependencies,
    };
  });
}

function matchesPhysicalPnpmIdentity(
  repositoryRoot: string,
  packageRoot: string,
  snapshotId: string,
): boolean {
  const relative = path.relative(
    path.join(repositoryRoot, "node_modules", ".pnpm"),
    packageRoot,
  );
  const [physicalIdentity] = relative.split(path.sep);
  return (
    physicalIdentity ===
    snapshotId.replaceAll("/", "+").replaceAll("(", "_").replaceAll(")", "")
  );
}

async function nearestPackageRoot(
  repositoryRoot: string,
  file: string,
): Promise<string | undefined> {
  let cursor = path.dirname(file);
  while (isWithin(repositoryRoot, cursor)) {
    const packageJson = path.join(cursor, "package.json");
    try {
      await readFile(packageJson);
      if (
        path
          .relative(repositoryRoot, cursor)
          .split(path.sep)
          .includes("node_modules")
      ) {
        return cursor;
      }
    } catch {
      // Continue until the repository boundary or filesystem root.
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
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
