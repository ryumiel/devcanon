import { execFile } from "node:child_process";
import { cp } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../__test-helpers__/fixtures.js";

const execFileAsync = promisify(execFile);
const runtimeScript = path.resolve(
  "skills/devcanon-runtime/scripts/devcanon-runtime.sh",
);

describe("devcanon-runtime typed entrypoint", () => {
  it("runs the packaged compiled JavaScript contract command through the shell adapter", async () => {
    const { stdout, stderr } = await execFileAsync("bash", [
      runtimeScript,
      "runtime",
      "contract",
    ]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      command_group: "devcanon-runtime",
      major_version: 1,
      helper_foundation: true,
    });
  });

  it("emits stable stderr JSON for path guard failures", async () => {
    await expect(
      execFileAsync("bash", [
        runtimeScript,
        "runtime",
        "ephemeral-child",
        "--path",
        ".ephemeral/nested/result.json",
      ]),
    ).rejects.toMatchObject({
      stderr:
        '{"ok":false,"code":"nested-path","message":"path must be a direct child under .ephemeral"}\n',
    });
  });

  it("runs from a copied support skill bundle without the repository package.json", async () => {
    const tempDir = await createTempDir();
    try {
      await cp(
        path.resolve("skills/devcanon-runtime"),
        path.join(tempDir, "devcanon-runtime"),
        { recursive: true },
      );
      const { stdout } = await execFileAsync("bash", [
        path.join(
          tempDir,
          "devcanon-runtime",
          "scripts",
          "devcanon-runtime.sh",
        ),
        "runtime",
        "path-info",
        "--path",
        "/tmp/../var/result.json",
        "--platform",
        "posix",
      ]);

      expect(JSON.parse(stdout)).toMatchObject({
        normalized: "/var/result.json",
        comparable: "/var/result.json",
      });
    } finally {
      await cleanupTempDir(tempDir);
    }
  });
});
