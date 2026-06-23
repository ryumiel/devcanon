import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../__test-helpers__/fixtures.js";
import {
  gitRevParse,
  gitStatusCodeFromExecError,
  providerBoundGitArgs,
  providerBoundGitEnv,
  runGit,
  runGitRaw,
  runGitStatus,
  runGitStdoutSha256,
} from "./git.js";

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

  it("returns a deterministic failure status for nonnumeric execution errors", async () => {
    await rm(tempDir, { recursive: true, force: true });

    await expect(runGitStatus(["status"], { cwd: tempDir })).resolves.toBe(128);
  });

  it("maps only explicit integer exec status codes to git status results", () => {
    expect(gitStatusCodeFromExecError(null)).toBe(0);
    expect(gitStatusCodeFromExecError({ code: 1 })).toBe(1);
    expect(gitStatusCodeFromExecError({ code: 128 })).toBe(128);
    expect(gitStatusCodeFromExecError({ code: "1" })).toBe(128);
    expect(gitStatusCodeFromExecError({ code: null })).toBe(128);
    expect(gitStatusCodeFromExecError({})).toBe(128);
    expect(gitStatusCodeFromExecError(new Error("spawn failed"))).toBe(128);
  });

  it("builds provider-bound git args and scrubs inherited Git interpretation environment", () => {
    const previousConfigCount = process.env.GIT_CONFIG_COUNT;
    const previousConfigParameters = process.env.GIT_CONFIG_PARAMETERS;
    const previousCommonDir = process.env.GIT_COMMON_DIR;
    const previousExternalDiff = process.env.GIT_EXTERNAL_DIFF;
    const previousReplaceRefBase = process.env.GIT_REPLACE_REF_BASE;
    const previousWorkTree = process.env.GIT_WORK_TREE;
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_PARAMETERS = "'diff.external=cat'";
    process.env.GIT_COMMON_DIR = "/tmp/common-poison";
    process.env.GIT_EXTERNAL_DIFF = "cat";
    process.env.GIT_REPLACE_REF_BASE = "refs/replace";
    process.env.GIT_WORK_TREE = "/tmp/poison";
    try {
      expect(providerBoundGitArgs(["diff", "HEAD"])).toEqual([
        "--no-replace-objects",
        "diff",
        "HEAD",
      ]);

      const env = providerBoundGitEnv("/tmp/devcanon-global-config");
      expect(env.GIT_CONFIG_COUNT).toBeUndefined();
      expect(env.GIT_CONFIG_PARAMETERS).toBeUndefined();
      expect(env.GIT_COMMON_DIR).toBeUndefined();
      expect(env.GIT_EXTERNAL_DIFF).toBeUndefined();
      expect(env.GIT_REPLACE_REF_BASE).toBeUndefined();
      expect(env.GIT_WORK_TREE).toBeUndefined();
      expect(env.GIT_NO_REPLACE_OBJECTS).toBe("1");
      expect(env.GIT_CONFIG_GLOBAL).toBe("/tmp/devcanon-global-config");
      expect(env.GIT_CONFIG_NOSYSTEM).toBe("1");
      expect(env.GIT_ATTR_NOSYSTEM).toBe("1");
    } finally {
      restoreEnv("GIT_CONFIG_COUNT", previousConfigCount);
      restoreEnv("GIT_CONFIG_PARAMETERS", previousConfigParameters);
      restoreEnv("GIT_COMMON_DIR", previousCommonDir);
      restoreEnv("GIT_EXTERNAL_DIFF", previousExternalDiff);
      restoreEnv("GIT_REPLACE_REF_BASE", previousReplaceRefBase);
      restoreEnv("GIT_WORK_TREE", previousWorkTree);
    }
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, key);
  } else {
    process.env[key] = value;
  }
}
