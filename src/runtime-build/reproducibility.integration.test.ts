import { execFile, spawn } from "node:child_process";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../__test-helpers__/fixtures.js";
import { produceProvider, verifySourceProvider } from "./producer.js";
import { verifyProvider } from "./provider.js";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const tempDirs: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(cleanupTempDir));
});

describe("runtime provider reproducibility", () => {
  it("packs an isolated package provider and dispatches its runtime", async () => {
    const first = await createTempDir();
    const second = await createTempDir();
    const packed = await packInstalledPackageProvider();
    const installedPackage = packed.installedPackage;
    const packageProvider = path.join(
      installedPackage,
      "dist",
      "devcanon-runtime",
      "package",
    );
    tempDirs.push(first, second, packed.temporaryRoot);
    await produceProvider({
      repositoryRoot,
      origin: "source-build",
      devcanonVersion: "2.0.0",
      destinationRoot: first,
    });
    await produceProvider({
      repositoryRoot,
      origin: "source-build",
      devcanonVersion: "2.0.0",
      destinationRoot: second,
    });
    await expect(
      verifySourceProvider({
        repositoryRoot,
        root: first,
        devcanonVersion: "2.0.0",
      }),
    ).resolves.toMatchObject({ origin: "source-build" });

    await expect(readProviderBytes(first)).resolves.toEqual(
      await readProviderBytes(second),
    );
    await expect(
      verifyProvider({
        root: packageProvider,
        origin: "package",
        devcanonVersion: "2.0.0",
      }),
    ).resolves.toMatchObject({ origin: "package" });
    await expect(
      runNode(
        path.join(packageProvider, "devcanon-runtime.mjs"),
        ["runtime", "contract"],
        installedPackage,
      ),
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: `${JSON.stringify({ command_group: "devcanon-runtime", major_version: 1, helper_foundation: true })}\n`,
      stderr: "",
    });
    await expect(
      runNode(path.join(first, "devcanon-runtime.mjs"), []),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: "runtime bundle selector must be runtime or bootstrap\n",
    });
    const selectedRuntime = path.join(installedPackage, "selected-runtime");
    await mkdir(path.join(selectedRuntime, "scripts", "runtime"), {
      recursive: true,
    });
    await writeFile(
      path.join(selectedRuntime, "scripts", "runtime", "devcanon-runtime.mjs"),
      await readFile(path.join(packageProvider, "devcanon-runtime.mjs")),
    );
    await expect(
      runNode(
        path.join(packageProvider, "devcanon-runtime.mjs"),
        ["bootstrap", "--runtime-dir", selectedRuntime, "--", "contract"],
        installedPackage,
      ),
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: `${JSON.stringify({ command_group: "devcanon-runtime", major_version: 1, helper_foundation: true })}\n`,
      stderr: "",
    });
  });
});

async function readProviderBytes(root: string): Promise<Buffer[]> {
  return Promise.all(
    [
      "devcanon-runtime.mjs",
      "runtime-manifest.json",
      "THIRD_PARTY_LICENSES",
    ].map((leaf) => readFile(path.join(root, leaf))),
  );
}

async function packInstalledPackageProvider(): Promise<{
  temporaryRoot: string;
  installedPackage: string;
}> {
  const temporaryRoot = await createTempDir();
  const workspace = path.join(temporaryRoot, "workspace");
  const archives = path.join(temporaryRoot, "archives");
  const installedPackage = path.join(temporaryRoot, "installed-package");
  await mkdir(workspace);
  await Promise.all([
    cp(
      path.join(repositoryRoot, "package.json"),
      path.join(workspace, "package.json"),
    ),
    cp(
      path.join(repositoryRoot, "skills", "devcanon-runtime"),
      path.join(workspace, "skills", "devcanon-runtime"),
      { recursive: true },
    ),
  ]);
  await produceProvider({
    repositoryRoot,
    origin: "package",
    devcanonVersion: "2.0.0",
    destinationRoot: path.join(
      workspace,
      "dist",
      "devcanon-runtime",
      "package",
    ),
  });
  await mkdir(archives);
  await execFileAsync(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", archives],
    { cwd: workspace },
  );
  const [archive] = (await readdir(archives)).filter((entry) =>
    entry.endsWith(".tgz"),
  );
  if (archive === undefined)
    throw new Error("pnpm pack did not produce a tarball");
  await mkdir(installedPackage);
  await execFileAsync("tar", [
    "-xzf",
    path.join(archives, archive),
    "-C",
    installedPackage,
    "--strip-components=1",
  ]);
  return { temporaryRoot, installedPackage };
}

async function runNode(script: string, args: string[], cwd?: string) {
  return new Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}
