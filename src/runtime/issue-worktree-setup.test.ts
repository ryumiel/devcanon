import { describe, expect, it } from "vitest";
import {
  isUnsupportedWindowsGitMetadata,
  runIssueWorktreeSetupCommand,
} from "./issue-worktree-setup.js";

describe("issue worktree setup runtime command", () => {
  it("fails before Git mutation when required environment is missing", async () => {
    const result = await runIssueWorktreeSetupCommand([], {});

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "Missing required environment variable: BRANCH_NAME",
    );
    expect(result.stderr).not.toContain('"ok":false');
  });

  it("preserves plain helper diagnostics for unsafe inputs", async () => {
    const result = await runIssueWorktreeSetupCommand([], {
      BRANCH_NAME: "feat/test",
      WORKTREE_LEAF: "../escape",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unsafe WORKTREE_LEAF: ../escape");
    expect(result.stderr).not.toContain('"ok":false');
  });

  it("rejects unexpected command arguments", async () => {
    const result = await runIssueWorktreeSetupCommand(["--help"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "issue-worktree-setup does not accept arguments",
    );
  });
});

describe("Windows Git metadata detection", () => {
  it("rejects Windows drive metadata from POSIX hosts", () => {
    expect(isUnsupportedWindowsGitMetadata("C:/repo/.git", "linux")).toBe(true);
    expect(isUnsupportedWindowsGitMetadata("D:\\repo\\.git", "darwin")).toBe(
      true,
    );
  });

  it("allows Windows drive metadata from native Windows hosts", () => {
    expect(isUnsupportedWindowsGitMetadata("C:/repo/.git", "win32")).toBe(
      false,
    );
    expect(isUnsupportedWindowsGitMetadata("D:\\repo\\.git", "win32")).toBe(
      false,
    );
  });

  it("allows POSIX and WSL-mounted metadata paths from POSIX hosts", () => {
    expect(isUnsupportedWindowsGitMetadata("/repo/.git", "linux")).toBe(false);
    expect(
      isUnsupportedWindowsGitMetadata("/mnt/c/Users/me/repo/.git", "linux"),
    ).toBe(false);
  });
});
