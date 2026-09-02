import { execFile } from "node:child_process";
import { mkdtemp, readdir, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const checker = path.resolve("scripts/check-runtime-build.mjs");

describe("runtime build checker", () => {
  it("verifies the derived three-leaf source sibling without a node_modules closure", async () => {
    await expect(execFileAsync("node", [checker])).resolves.toMatchObject({
      stderr: "",
    });
    await expect(
      readdir(path.resolve("skills/devcanon-runtime/scripts/runtime")),
    ).resolves.toEqual([
      "THIRD_PARTY_LICENSES",
      "devcanon-runtime.mjs",
      "runtime-manifest.json",
    ]);
  });

  it("rejects the removed closure preparation interface", async () => {
    await expect(
      execFileAsync("node", [checker, "--prepare"]),
    ).rejects.toMatchObject({ stderr: expect.stringContaining("usage:") });
  });

  it("materializes and checks source runtime from a clean ignored-output state", async () => {
    const scratch = await mkdtemp(path.join(os.tmpdir(), "devcanon-runtime-"));
    const sourceProvider = path.resolve("dist/devcanon-runtime/source-build");
    const derivedRuntime = path.resolve(
      "skills/devcanon-runtime/scripts/runtime",
    );
    const sourceBackup = path.join(scratch, "source-build");
    const runtimeBackup = path.join(scratch, "runtime");
    await rename(sourceProvider, sourceBackup).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
    await rename(derivedRuntime, runtimeBackup).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
    try {
      await expect(
        execFileAsync("pnpm", ["run", "check:runtime"]),
      ).resolves.toMatchObject({ stderr: "" });
      await expect(readdir(derivedRuntime)).resolves.toEqual([
        "THIRD_PARTY_LICENSES",
        "devcanon-runtime.mjs",
        "runtime-manifest.json",
      ]);
    } finally {
      await rm(sourceProvider, { recursive: true, force: true });
      await rm(derivedRuntime, { recursive: true, force: true });
      await rename(sourceBackup, sourceProvider).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
      await rename(runtimeBackup, derivedRuntime).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
