import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
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
});
