#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const DEFAULT_RUNTIME_PATH = "skills/devcanon-runtime/scripts/runtime";
const runtimeArgs = process.argv.slice(2);
const runtimePath =
  runtimeArgs.find((argument) => argument !== "--prepare") ??
  DEFAULT_RUNTIME_PATH;
const prepare = runtimeArgs.includes("--prepare");
const GFM_RUNTIME_PACKAGES = [
  "mdast-util-from-markdown",
  "mdast-util-gfm",
  "micromark-extension-gfm",
];

if (prepare) {
  await prepareRuntimeParserClosure(runtimePath);
}

function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    ...options,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  return result;
}

const diff = runGit(["diff", "--exit-code", "--", runtimePath], {
  stdio: "inherit",
});
if (diff.status !== 0) {
  process.exit(diff.status ?? 1);
}

const untracked = runGit([
  "ls-files",
  "--others",
  "--exclude-standard",
  "--",
  runtimePath,
]);
if (untracked.status !== 0) {
  process.stderr.write(untracked.stderr);
  process.exit(untracked.status ?? 1);
}

const untrackedFiles = untracked.stdout.trim();
if (untrackedFiles.length > 0) {
  console.error(`runtime build produced untracked files under ${runtimePath}:`);
  console.error(untrackedFiles);
  process.exit(1);
}

async function prepareRuntimeParserClosure(runtimeDirectory) {
  const nodeModules = path.join(runtimeDirectory, "node_modules");
  await rm(nodeModules, { recursive: true, force: true });
  await mkdir(nodeModules, { recursive: true });

  const packageVersions = {};
  const packages = new Map();
  for (const packageName of GFM_RUNTIME_PACKAGES) {
    const sourceDirectory = await resolvePackageDirectory(
      packageName,
      process.cwd(),
    );
    const packageJson = await packageManifest(sourceDirectory);
    packageVersions[packageName] = packageJson.version;
    await collectPackageClosure(packageName, sourceDirectory, packages);
  }
  for (const [packageName, sourceDirectory] of packages) {
    await cp(sourceDirectory, path.join(nodeModules, packageName), {
      recursive: true,
      dereference: true,
      filter: runtimePackageFilter,
    });
  }

  await writeFile(
    path.join(runtimeDirectory, "package.json"),
    `${JSON.stringify(
      {
        type: "module",
        private: true,
        dependencies: packageVersions,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function collectPackageClosure(packageName, sourceDirectory, packages) {
  const existing = packages.get(packageName);
  if (existing !== undefined) {
    if (existing !== sourceDirectory) {
      throw new Error(
        `approved GFM runtime package ${packageName} resolves to multiple versions`,
      );
    }
    return;
  }
  packages.set(packageName, sourceDirectory);
  const manifest = await packageManifest(sourceDirectory);
  for (const dependency of packageDependencies(manifest)) {
    const dependencySource = await resolvePackageDirectory(
      dependency,
      sourceDirectory,
    );
    await collectPackageClosure(dependency, dependencySource, packages);
  }
}

async function resolvePackageDirectory(packageName, fromDirectory) {
  try {
    const requireFrom = createRequire(path.join(fromDirectory, "package.json"));
    const entrypoint = requireFrom.resolve(packageName);
    return await packageDirectoryFor(entrypoint);
  } catch (error) {
    throw new Error(
      `unable to resolve approved GFM runtime package ${packageName} from ${fromDirectory}: ${error.message}`,
    );
  }
}

async function packageDirectoryFor(entrypoint) {
  let directory = path.dirname(entrypoint);
  while (directory !== path.dirname(directory)) {
    try {
      if ((await stat(path.join(directory, "package.json"))).isFile()) {
        return directory;
      }
    } catch {
      // Continue to the parent directory until the resolved package root.
    }
    directory = path.dirname(directory);
  }
  throw new Error(`unable to find package.json for ${entrypoint}`);
}

async function packageManifest(directory) {
  return JSON.parse(
    await readFile(path.join(directory, "package.json"), "utf8"),
  );
}

async function runtimePackageFilter(sourcePath) {
  const name = path.basename(sourcePath);
  if (name === "node_modules") return false;
  if ((await stat(sourcePath)).isDirectory()) return true;
  return name === "package.json" || /\.(?:c?js|mjs|json)$/u.test(name);
}

function packageDependencies(manifest) {
  return Object.keys({
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
  })
    .filter((packageName) => !packageName.startsWith("@types/"))
    .sort();
}
