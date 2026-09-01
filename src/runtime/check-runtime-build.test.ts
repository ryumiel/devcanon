import { execFile } from "node:child_process";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
  it("forces LF for every canonical private runtime notice in the Git tree", async () => {
    const { stdout: noticeOutput } = await execFileAsync("git", [
      "ls-files",
      "--",
      `${runtimeDir}/node_modules/**/license`,
    ]);
    const notices = noticeOutput.trim().split("\n").filter(Boolean);
    const { stdout: attributeOutput } = await execFileAsync("git", [
      "check-attr",
      "text",
      "eol",
      "--",
      ...notices,
    ]);

    expect(notices).not.toEqual([]);
    const attributes = new Map(
      attributeOutput
        .trim()
        .split("\n")
        .map((line) => {
          const [entry, attribute, value] = line.split(": ");
          return [`${entry}:${attribute}`, value];
        }),
    );
    for (const notice of notices) {
      expect(attributes.get(`${notice}:text`)).toBe("set");
      expect(attributes.get(`${notice}:eol`)).toBe("lf");
    }
  });

  it("tracks every private runtime notice with the canonical lowercase filename", async () => {
    const { stdout } = await execFileAsync("git", [
      "ls-files",
      "--",
      `${runtimeDir}/node_modules`,
    ]);
    const notices = stdout
      .trim()
      .split("\n")
      .filter((entry) => /\/license(?:\.[a-z0-9]+)?$/iu.test(entry));

    expect(notices).not.toEqual([]);
    expect(notices).toEqual(
      notices.map((entry) =>
        entry.replace(/\/license(?:\.[a-z0-9]+)?$/iu, "/license"),
      ),
    );
    expect(notices).toContain(`${runtimeDir}/node_modules/debug/license`);
    expect(notices).not.toContain(`${runtimeDir}/node_modules/debug/LICENSE`);
  });

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

  it("refuses to prepare a substituted approved runtime without mutation", async () => {
    const tempDir = await createRuntimeBuildRepo();
    try {
      const approvedRuntime = path.join(tempDir, runtimeDir);
      const substitutedRuntime = path.join(tempDir, "substituted-runtime");
      const sentinel = path.join(
        substitutedRuntime,
        "node_modules",
        "sentinel.js",
      );
      await mkdir(path.dirname(sentinel), { recursive: true });
      await writeFile(sentinel, "unchanged\n", "utf-8");
      await rm(approvedRuntime, { recursive: true, force: true });
      await symlink(
        substitutedRuntime,
        approvedRuntime,
        process.platform === "win32" ? "junction" : "dir",
      );

      await expect(
        execFileAsync("node", [checkerScript, "--prepare", runtimeDir], {
          cwd: tempDir,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "runtime parser closure preparation refuses symlink or reparse-point path components",
        ),
      });
      await expect(readFile(sentinel, "utf-8")).resolves.toBe("unchanged\n");
    } finally {
      await cleanupTempDir(tempDir);
    }
  });
});
