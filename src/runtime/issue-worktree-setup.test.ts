import { describe, expect, it } from "vitest";
import { runIssueWorktreeSetupCommand } from "./issue-worktree-setup.js";

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
