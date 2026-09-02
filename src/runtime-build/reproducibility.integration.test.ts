import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../__test-helpers__/fixtures.js";
import { produceProvider, verifySourceProvider } from "./producer.js";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(cleanupTempDir));
});

describe("runtime provider reproducibility", () => {
  it("creates byte-identical source-build providers and dispatches runtime", async () => {
    const first = await createTempDir();
    const second = await createTempDir();
    tempDirs.push(first, second);
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
      runNode(path.join(first, "devcanon-runtime.mjs"), [
        "runtime",
        "contract",
      ]),
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

async function runNode(script: string, args: string[]) {
  return new Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
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
