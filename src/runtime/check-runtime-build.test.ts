import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
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
          "runtime build produced untracked files",
        ),
      });
    } finally {
      await cleanupTempDir(tempDir);
    }
  });
});
