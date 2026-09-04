import { execFile } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../__test-helpers__/fixtures.js";

const execFileAsync = promisify(execFile);
const runtimeScript = path.resolve(
  "skills/devcanon-runtime/scripts/devcanon-runtime.sh",
);
const runtimeBundle = path.resolve(
  "skills/devcanon-runtime/scripts/runtime/devcanon-runtime.mjs",
);

describe("devcanon-runtime typed entrypoint", () => {
  it("runs the prebuilt ESM bundle through the shell adapter", async () => {
    const { stdout, stderr } = await execFileAsync("bash", [
      runtimeScript,
      "runtime",
      "contract",
    ]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      command_group: "devcanon-runtime",
      major_version: 1,
      helper_foundation: true,
    });
  });

  it("forwards direct bundle runtime selection and preserves sanitized execution", async () => {
    await expect(
      execFileAsync(process.execPath, [runtimeBundle, "runtime", "contract"], {
        env: {
          ...process.env,
          NODE_OPTIONS: "--conditions=development",
          DEBUG: "*",
        },
      }),
    ).resolves.toMatchObject({ stderr: "" });
  });

  it("runs from a copied passive runtime bundle without repository files", async () => {
    const tempDir = await createTempDir();
    try {
      const copied = path.join(tempDir, "devcanon-runtime");
      await cp(path.resolve("skills/devcanon-runtime"), copied, {
        recursive: true,
      });
      await mkdir(path.join(tempDir, "unrelated"));
      const { stdout } = await execFileAsync(
        "bash",
        [
          path.join(copied, "scripts", "devcanon-runtime.sh"),
          "runtime",
          "path-info",
          "--path",
          "/tmp/../var/result.json",
          "--platform",
          "posix",
        ],
        { cwd: path.join(tempDir, "unrelated") },
      );
      expect(JSON.parse(stdout)).toMatchObject({
        normalized: "/var/result.json",
      });
    } finally {
      await cleanupTempDir(tempDir);
    }
  });

  it("uses the copied sibling catalog", async () => {
    const tempDir = await createTempDir();
    try {
      const copied = path.join(tempDir, "devcanon-runtime");
      await cp(path.resolve("skills/devcanon-runtime"), copied, {
        recursive: true,
      });
      const bundle = path.join(
        copied,
        "scripts",
        "runtime",
        "devcanon-runtime.mjs",
      );
      const result = await execFileAsync(process.execPath, [
        bundle,
        "runtime",
        "config",
        "get",
        "--key",
        "capabilityProfiles.balanced.codex",
      ]);
      expect(JSON.parse(result.stdout)).toMatchObject({
        value: "gpt-5.6-terra",
      });
      await writeFile(
        path.join(copied, "config", "runtime-config.json"),
        "{}\n",
      );
      await expect(
        execFileAsync(process.execPath, [bundle, "runtime", "config", "path"]),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "invalid runtime configuration catalog",
        ),
      });
    } finally {
      await cleanupTempDir(tempDir);
    }
  });

  it("contains no runtime dependency closure", async () => {
    const entries = await import("node:fs/promises").then(({ readdir }) =>
      readdir(path.dirname(runtimeBundle)),
    );
    expect(entries.sort()).toEqual([
      "THIRD_PARTY_LICENSES",
      "devcanon-runtime.mjs",
      "runtime-manifest.json",
    ]);
    await expect(readFile(runtimeBundle)).resolves.toBeInstanceOf(Buffer);
  });
});
