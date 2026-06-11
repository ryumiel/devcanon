import { describe, expect, it } from "vitest";
import { reduceCleanup, reducePreflight } from "./pr-merge-worktree.js";

describe("PR merge worktree preflight reducer", () => {
  const base = {
    metadataValid: true,
    outsideWorktree: false,
    currentWorktree: "/repo/main",
    currentBranch: "main",
    currentDetached: false,
    primaryWorktree: "/repo/main",
    headWorktree: "",
    baseWorktree: "/repo/main",
    knownCurrent: true,
  };

  it("routes base worktrees without local head worktrees to safe-direct", () => {
    expect(reducePreflight(base)).toMatchObject({
      mode: "safe-direct",
      reasonCode: "base-no-head-worktree",
    });
  });

  it("routes current head worktrees to remote-only", () => {
    expect(
      reducePreflight({
        ...base,
        currentWorktree: "/repo/feature",
        currentBranch: "feature/test",
        headWorktree: "/repo/feature",
      }),
    ).toMatchObject({
      mode: "remote-only",
      reasonCode: "current-head-worktree",
    });
  });

  it("stops on missing metadata, detached current worktrees, and unknown metadata", () => {
    expect(
      reducePreflight({
        ...base,
        metadataValid: false,
        metadataReason: "Missing or unsafe PR_HEAD_BRANCH",
      }),
    ).toMatchObject({ mode: "stop", reasonCode: "missing-pr-metadata" });
    expect(reducePreflight({ ...base, currentDetached: true })).toMatchObject({
      mode: "stop",
      reasonCode: "detached-current",
    });
    expect(reducePreflight({ ...base, knownCurrent: false })).toMatchObject({
      mode: "stop",
      reasonCode: "unclassifiable",
    });
    expect(reducePreflight({ ...base, primaryWorktree: "" })).toMatchObject({
      mode: "stop",
      reasonCode: "missing-primary",
    });
  });
});

describe("PR merge cleanup reducer", () => {
  const base = {
    prState: "MERGED",
    headWorktreeReal: "/repo/feature",
    primaryWorktreeReal: "/repo/main",
    headWorktreeDirty: false,
    primaryWorktreeDirty: false,
    headWorktreeLockedReason: null,
    prHeadBranch: "feature/test",
    prBaseBranch: "main",
    prBaseDefaultBranch: "main",
    localBranchExists: true,
    localTipMatches: true,
    branchCheckedOut: false,
    headBranchProtected: false,
    headBranchProtectedReason: "",
    prHeadRepo: "owner/repo",
    prBaseRepo: "owner/repo",
    originMatchesBase: true,
    remoteLookupFailed: false,
    remoteSha: "a".repeat(40),
    remoteTipMatches: true,
  };

  it("removes clean feature worktrees and deletes matching branches", () => {
    expect(reduceCleanup(base)).toMatchObject({
      worktreeCleanup: "removed",
      baseUpdate: "updated",
      localBranchCleanup: "deleted",
      remoteBranchCleanup: "deleted",
      manualActions: [],
    });
  });

  it("retains dirty worktrees and protects local branches", () => {
    expect(reduceCleanup({ ...base, headWorktreeDirty: true })).toMatchObject({
      worktreeCleanup: "retained",
      worktreeCleanupReason: "dirty-or-untracked-worktree",
      localBranchCleanup: "retained",
      localBranchCleanupReason: "dirty-or-untracked-head-worktree",
    });
  });

  it("retains local branches while recorded head worktrees are locked", () => {
    expect(
      reduceCleanup({
        ...base,
        headWorktreeLockedReason: "manual review",
      }),
    ).toMatchObject({
      worktreeCleanup: "retained",
      worktreeCleanupReason: "locked-worktree:manual review",
      localBranchCleanup: "retained",
      localBranchCleanupReason: "locked-worktree:manual review",
    });
  });

  it("retains branches on local tip, fork, and origin mismatch gates", () => {
    expect(reduceCleanup({ ...base, localTipMatches: false })).toMatchObject({
      localBranchCleanup: "retained",
      localBranchCleanupReason: "local-tip-mismatch",
    });
    expect(reduceCleanup({ ...base, prHeadRepo: "fork/repo" })).toMatchObject({
      remoteBranchCleanup: "retained",
      remoteBranchCleanupReason: "fork-head-repo",
    });
    expect(reduceCleanup({ ...base, originMatchesBase: false })).toMatchObject({
      remoteBranchCleanup: "retained",
      remoteBranchCleanupReason: "origin-not-base-remote",
    });
  });

  it("keeps PR-review lease cleanup out of the PR merge reducer surface", () => {
    expect(Object.keys(reduceCleanup(base)).join(" ")).not.toContain("lease");
  });
});
