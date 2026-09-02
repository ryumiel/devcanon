import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const checker = path.resolve("scripts/check-runtime-build.mjs");
const repositoryRoot = process.cwd();
const isolatedCheckTimeoutMs = 55_000;
const isolatedTestTimeoutMs = 60_000;

async function createIsolatedCheckout(): Promise<string> {
  const checkout = await mkdtemp(path.join(os.tmpdir(), "devcanon-runtime-#"));
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

async function runIsolatedRuntimeCheck(checkout: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), isolatedCheckTimeoutMs);
  try {
    return await execFileAsync("pnpm", ["run", "check:runtime"], {
      cwd: checkout,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

describe("runtime build checker", () => {
  it("prepares the runtime before each independently invoked project test", async () => {
    const packageJson = JSON.parse(
      await readFile(path.resolve("package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["test:prepare-runtime"]).toBe(
      "pnpm run build:runtime",
    );
    for (const [scriptName, project] of Object.entries({
      "test:unit": "unit",
      "test:integration:posix": "integration-posix",
      "test:integration:render-install": "integration-render-install",
      "test:integration:windows": "integration-windows-helper",
    })) {
      expect(packageJson.scripts?.[scriptName]).toBe(
        `pnpm run test:prepare-runtime && vitest run --project ${project}`,
      );
    }
  });

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

  it(
    "materializes and checks source runtime from a clean URL-sensitive ignored-output state",
    async () => {
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
        await expect(runIsolatedRuntimeCheck(checkout)).resolves.toMatchObject({
          stderr: "",
        });
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
    },
    isolatedTestTimeoutMs,
  );
});
