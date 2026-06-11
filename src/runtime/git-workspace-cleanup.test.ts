import { describe, expect, it } from "vitest";
import { reduceWorkspaceStatus } from "./git-workspace-cleanup.js";

describe("git workspace cleanup reducer", () => {
  const base = {
    mode: "execute" as const,
    forceBranches: false,
    forceDirtyWorktrees: false,
    dirtyPrimaryCount: 0,
    dirtyLinkedCount: 0,
    lockedWorktreeCount: 0,
    uniqueBranchCount: 0,
    defaultBranchAheadCommits: 0,
  };

  it("allows clean execute plans", () => {
    expect(reduceWorkspaceStatus(base)).toBe("ok");
  });

  it("retains dirty primary and locked worktrees even with force flags", () => {
    expect(
      reduceWorkspaceStatus({
        ...base,
        forceDirtyWorktrees: true,
        dirtyPrimaryCount: 1,
      }),
    ).toBe("blocked");
    expect(
      reduceWorkspaceStatus({
        ...base,
        forceDirtyWorktrees: true,
        lockedWorktreeCount: 1,
      }),
    ).toBe("blocked");
  });

  it("requires the specific force flag for dirty linked worktrees and unique branches", () => {
    expect(reduceWorkspaceStatus({ ...base, dirtyLinkedCount: 1 })).toBe(
      "blocked",
    );
    expect(
      reduceWorkspaceStatus({
        ...base,
        dirtyLinkedCount: 1,
        forceDirtyWorktrees: true,
      }),
    ).toBe("ok");
    expect(reduceWorkspaceStatus({ ...base, uniqueBranchCount: 1 })).toBe(
      "blocked",
    );
    expect(
      reduceWorkspaceStatus({
        ...base,
        uniqueBranchCount: 1,
        forceBranches: true,
      }),
    ).toBe("ok");
  });

  it("keeps dry-run blocked even when force flags are supplied", () => {
    expect(
      reduceWorkspaceStatus({
        ...base,
        mode: "dry-run",
        forceBranches: true,
        forceDirtyWorktrees: true,
        dirtyLinkedCount: 1,
        uniqueBranchCount: 1,
      }),
    ).toBe("blocked");
  });
});
