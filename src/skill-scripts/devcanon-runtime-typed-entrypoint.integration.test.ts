import { execFile } from "node:child_process";
import { cp, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../__test-helpers__/fixtures.js";

const execFileAsync = promisify(execFile);
const runtimeScript = path.resolve(
  "skills/devcanon-runtime/scripts/devcanon-runtime.sh",
);

describe("devcanon-runtime typed entrypoint", () => {
  it("tracks the compiled JavaScript entrypoint as executable", async () => {
    const { stdout } = await execFileAsync("git", [
      "ls-files",
      "-s",
      "skills/devcanon-runtime/scripts/runtime/cli.js",
    ]);

    expect(stdout).toMatch(/^100755 /u);
  });

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

  it("runs from a copied passive runtime bundle without the repository package.json", async () => {
    const tempDir = await createTempDir();
    try {
      await cp(
        path.resolve("skills/devcanon-runtime"),
        path.join(tempDir, "devcanon-runtime"),
        { recursive: true },
      );
      const { stdout } = await execFileAsync(
        "bash",
        [
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
        ],
        {
          env: { ...process.env, MSYS2_ARG_CONV_EXCL: "/tmp" },
        },
      );

      expect(JSON.parse(stdout)).toMatchObject({
        normalized: "/var/result.json",
        comparable: "/var/result.json",
      });
    } finally {
      await cleanupTempDir(tempDir);
    }
  });

  it("reads config path and values from the copied sibling catalog outside the repository", async () => {
    const tempDir = await createTempDir();
    try {
      const runtimeDir = path.join(tempDir, "devcanon-runtime");
      const unrelatedCwd = path.join(tempDir, "unrelated");
      await cp(path.resolve("skills/devcanon-runtime"), runtimeDir, {
        recursive: true,
      });
      await mkdir(unrelatedCwd);
      const script = path.join(runtimeDir, "scripts", "devcanon-runtime.sh");

      const catalogPath = await execFileAsync(
        "bash",
        [script, "runtime", "config", "path"],
        { cwd: unrelatedCwd },
      );
      const catalogValue = await execFileAsync(
        "bash",
        [
          script,
          "runtime",
          "config",
          "get",
          "--key",
          "capabilityProfiles.balanced.codex",
        ],
        { cwd: unrelatedCwd },
      );

      expect(JSON.parse(catalogPath.stdout)).toEqual({
        path: await realpath(
          path.join(runtimeDir, "config", "runtime-config.json"),
        ),
      });
      expect(JSON.parse(catalogValue.stdout)).toEqual({
        key: "capabilityProfiles.balanced.codex",
        value: "gpt-5.6-terra",
      });
    } finally {
      await cleanupTempDir(tempDir);
    }
  });

  it("packages every shared runtime helper module in the copied passive runtime bundle", async () => {
    const tempDir = await createTempDir();
    try {
      await cp(
        path.resolve("skills/devcanon-runtime"),
        path.join(tempDir, "devcanon-runtime"),
        { recursive: true },
      );

      const runtimeModule = await import(
        pathToFileURL(
          path.join(
            tempDir,
            "devcanon-runtime",
            "scripts",
            "runtime",
            "index.js",
          ),
        ).href
      );

      expect(runtimeModule).toMatchObject({
        assertNoSymlinkOrReparsePoint: expect.any(Function),
        gitRevParse: expect.any(Function),
        normalizeRuntimePath: expect.any(Function),
        runGit: expect.any(Function),
        runRuntimeCommand: expect.any(Function),
        validateRuntimeSchema: expect.any(Function),
        writeTextAtomically: expect.any(Function),
      });
    } finally {
      await cleanupTempDir(tempDir);
    }
  });
});
