import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../__test-helpers__/fixtures.js";
import { gitRevParse, runGit } from "./git.js";

describe("runtime Git utilities", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("executes git directly and returns stdout/stderr fragments", async () => {
    await runGit(["init", "--initial-branch=main"], { cwd: tempDir });
    await runGit(["config", "user.name", "Test User"], { cwd: tempDir });
    await runGit(["config", "user.email", "test@example.com"], {
      cwd: tempDir,
    });
    await writeFile(path.join(tempDir, "README.md"), "hello\n");
    await runGit(["add", "README.md"], { cwd: tempDir });
    await runGit(["commit", "-m", "test: commit"], { cwd: tempDir });

    expect(await gitRevParse("HEAD", { cwd: tempDir })).toMatch(
      /^[0-9a-f]{40}$/,
    );
  });
});
