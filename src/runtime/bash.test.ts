import { describe, expect, it } from "vitest";
import { isRejectedWindowsLauncher, runResolveBashCommand } from "./bash.js";

describe("verified Bash resolution", () => {
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
});
