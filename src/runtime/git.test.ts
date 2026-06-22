import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../__test-helpers__/fixtures.js";
import { gitRevParse, runGit, runGitRaw, runGitStdoutSha256 } from "./git.js";

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

  it("keeps raw stdout callers bounded by their explicit buffer limit", async () => {
    await runGit(["init", "--initial-branch=main"], { cwd: tempDir });
    await runGit(["config", "user.name", "Test User"], { cwd: tempDir });
    await runGit(["config", "user.email", "test@example.com"], {
      cwd: tempDir,
    });
    await writeFile(path.join(tempDir, "large.txt"), `${"x".repeat(2048)}\n`);
    await runGit(["add", "large.txt"], { cwd: tempDir });
    await runGit(["commit", "-m", "test: large file"], { cwd: tempDir });

    await expect(
      runGitRaw(["show", "HEAD:large.txt"], {
        cwd: tempDir,
        maxBuffer: 1024,
      }),
    ).rejects.toThrow();
  });

  it("hashes stdout without applying the raw stdout buffer limit", async () => {
    await runGit(["init", "--initial-branch=main"], { cwd: tempDir });
    await runGit(["config", "user.name", "Test User"], { cwd: tempDir });
    await runGit(["config", "user.email", "test@example.com"], {
      cwd: tempDir,
    });
    const content = `${"x".repeat(2048)}\n`;
    await writeFile(path.join(tempDir, "large.txt"), content);
    await runGit(["add", "large.txt"], { cwd: tempDir });
    await runGit(["commit", "-m", "test: large file"], { cwd: tempDir });

    await expect(
      runGitStdoutSha256(["show", "HEAD:large.txt"], {
        cwd: tempDir,
        stderrMaxBuffer: 1024,
      }),
    ).resolves.toMatchObject({
      stdoutSha256: createHash("sha256").update(content).digest("hex"),
    });
  });
});
