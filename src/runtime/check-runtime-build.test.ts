import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../__test-helpers__/fixtures.js";

const execFileAsync = promisify(execFile);
const checkerScript = path.resolve("scripts/check-runtime-build.mjs");
const runtimeDir = "skills/devcanon-runtime/scripts/runtime";

async function git(cwd: string, args: readonly string[]): Promise<void> {
  await execFileAsync("git", [...args], { cwd });
}

async function createRuntimeBuildRepo(): Promise<string> {
  const tempDir = await createTempDir();
  await git(tempDir, ["init", "--initial-branch=main"]);
  await git(tempDir, ["config", "user.name", "Test User"]);
  await git(tempDir, ["config", "user.email", "test@example.com"]);
  await mkdir(path.join(tempDir, runtimeDir), { recursive: true });
  await writeFile(path.join(tempDir, runtimeDir, "cli.js"), "baseline\n");
  await git(tempDir, ["add", "."]);
  await git(tempDir, ["commit", "-m", "chore: baseline"]);
  return tempDir;
}

describe("runtime build checker", () => {
  it("passes when generated runtime files match the git index", async () => {
    const tempDir = await createRuntimeBuildRepo();
    try {
      await expect(
        execFileAsync("node", [checkerScript, runtimeDir], { cwd: tempDir }),
      ).resolves.toMatchObject({ stdout: "", stderr: "" });
    } finally {
      await cleanupTempDir(tempDir);
    }
  });

  it("fails when generated runtime files are untracked", async () => {
    const tempDir = await createRuntimeBuildRepo();
    try {
      await writeFile(path.join(tempDir, runtimeDir, "extra.js"), "extra\n");

      await expect(
        execFileAsync("node", [checkerScript, runtimeDir], { cwd: tempDir }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "runtime build produced untracked or ignored files",
        ),
      });
    } finally {
      await cleanupTempDir(tempDir);
    }
  });

  it("fails when generated runtime files are ignored", async () => {
    const tempDir = await createRuntimeBuildRepo();
    try {
      await writeFile(path.join(tempDir, ".gitignore"), "node_modules/\n");
      await mkdir(path.join(tempDir, runtimeDir, "node_modules", "parser"), {
        recursive: true,
      });
      await writeFile(
        path.join(tempDir, runtimeDir, "node_modules", "parser", "extra.js"),
        "extra\n",
      );

      await expect(
        execFileAsync("node", [checkerScript, runtimeDir], { cwd: tempDir }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "runtime build produced untracked or ignored files",
        ),
      });
    } finally {
      await cleanupTempDir(tempDir);
    }
  });

  it("refuses to prepare a runtime outside the approved payload without mutation", async () => {
    const tempDir = await createRuntimeBuildRepo();
    try {
      const outsideRuntime = path.join(tempDir, "outside-runtime");
      const packageJson = path.join(outsideRuntime, "package.json");
      const sentinel = path.join(outsideRuntime, "node_modules", "sentinel.js");
      await mkdir(path.dirname(sentinel), { recursive: true });
      await writeFile(packageJson, '{"private":false}\n', "utf-8");
      await writeFile(sentinel, "unchanged\n", "utf-8");

      await expect(
        execFileAsync("node", [checkerScript, "--prepare", outsideRuntime], {
          cwd: tempDir,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "runtime parser closure preparation is limited to",
        ),
      });
      await expect(readFile(packageJson, "utf-8")).resolves.toBe(
        '{"private":false}\n',
      );
      await expect(readFile(sentinel, "utf-8")).resolves.toBe("unchanged\n");
    } finally {
      await cleanupTempDir(tempDir);
    }
  });
});
