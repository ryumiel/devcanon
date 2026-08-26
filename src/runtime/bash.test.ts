import { realpath, symlink } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../__test-helpers__/fixtures.js";
import { isRejectedWindowsLauncher, runResolveBashCommand } from "./bash.js";

describe("verified Bash resolution", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) await cleanupTempDir(tempDir);
    tempDir = undefined;
  });

  it.each([
    "C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe",
    "C:\\Windows\\System32\\bash.exe",
    "C:\\Windows\\System32\\wsl.exe",
  ])("rejects Windows launcher %s", (candidate) => {
    expect(isRejectedWindowsLauncher(candidate)).toBe(true);
  });

  it("fails clearly when no POSIX Bash candidate is acceptable", async () => {
    await expect(
      runResolveBashCommand([], { PATH: "" }, "linux"),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr:
        "Bash is unavailable or unusable. Install Bash or rerun from a supported POSIX environment.\n",
    });
  });

  it.skipIf(process.platform === "win32")(
    "accepts a POSIX Bash executable reached through a symlink",
    async () => {
      tempDir = await createTempDir();
      const systemBash = await realpath("/bin/bash");
      await symlink(systemBash, path.join(tempDir, "bash"));

      await expect(
        runResolveBashCommand([], { PATH: tempDir }, process.platform),
      ).resolves.toEqual({
        exitCode: 0,
        stdout: `${systemBash}\n`,
        stderr: "",
      });
    },
  );
});
