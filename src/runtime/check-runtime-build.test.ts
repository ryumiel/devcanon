import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const checker = path.resolve("scripts/check-runtime-build.mjs");
const repositoryRoot = process.cwd();

async function createIsolatedCheckout(): Promise<string> {
  const checkout = await mkdtemp(path.join(os.tmpdir(), "devcanon-runtime-"));
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
  });
  for (const sourcePath of stdout.split("\0")) {
    if (!sourcePath) continue;
    const destination = path.join(checkout, sourcePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(repositoryRoot, sourcePath), destination);
  }
  await cp(
    path.join(repositoryRoot, "node_modules"),
    path.join(checkout, "node_modules"),
    { recursive: true, verbatimSymlinks: true },
  );
  return checkout;
}

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
    const checkout = await createIsolatedCheckout();
    const sourceProvider = path.join(
      checkout,
      "dist/devcanon-runtime/source-build",
    );
    const derivedRuntime = path.join(
      checkout,
      "skills/devcanon-runtime/scripts/runtime",
    );
    try {
      await expect(
        execFileAsync("pnpm", ["run", "check:runtime"], { cwd: checkout }),
      ).resolves.toMatchObject({ stderr: "" });
      await expect(readdir(sourceProvider)).resolves.toEqual([
        "THIRD_PARTY_LICENSES",
        "devcanon-runtime.mjs",
        "runtime-manifest.json",
      ]);
      await expect(readdir(derivedRuntime)).resolves.toEqual([
        "THIRD_PARTY_LICENSES",
        "devcanon-runtime.mjs",
        "runtime-manifest.json",
      ]);
    } finally {
      await rm(checkout, { recursive: true, force: true });
    }
  });
});
