import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { runPlayReviewSharedContextCommand } from "./play-review-shared-context.js";
import {
  type PrReviewLease,
  canonicalLeaseIdentityPath,
  digestLeaseIdentityPath,
  normalizeComparablePath,
  reducePrReviewLease,
  runPrReviewLeasesCommand,
} from "./pr-review-leases.js";
import { runReviewArtifactsCommand } from "./review-artifacts.js";

const execFileAsync = promisify(execFile);

describe("pr-review comparable path identity", () => {
  it("canonicalizes Windows lease identities without collapsing POSIX backslashes", () => {
    expect(normalizeComparablePath("C:\\Work\\Review")).toBe("c:/work/review");
    expect(normalizeComparablePath("c:/work/review")).toBe("c:/work/review");
    expect(canonicalLeaseIdentityPath("C:\\Work/mixed\\Review")).toBe(
      "c:/work/mixed/review",
    );
    expect(canonicalLeaseIdentityPath("c:/WORK/mixed/review")).toBe(
      "c:/work/mixed/review",
    );
    expect(normalizeComparablePath("/x/a\\b")).toBe("/x/a\\b");
    expect(normalizeComparablePath("/x/a/b")).toBe("/x/a/b");
    expect(normalizeComparablePath("/x/a\\b")).not.toBe(
      normalizeComparablePath("/x/a/b"),
    );
    expect(canonicalLeaseIdentityPath("/x/a\\b")).toBe("/x/a\\b");
    expect(canonicalLeaseIdentityPath("/x/a/b")).toBe("/x/a/b");
    expect(digestLeaseIdentityPath("/x/a\\b")).not.toBe(
      digestLeaseIdentityPath("/x/a/b"),
    );
    expect(digestLeaseIdentityPath("C:\\Work\\Review")).toBe(
      digestLeaseIdentityPath("c:/work/review"),
    );
  });
});

describe("pr-review Windows canonical identity lifecycle", () => {
  it.skipIf(process.platform !== "win32")(
    "uses one persisted identity across create, read-status, cleanup, and missing-path derivation",
    async () => {
      const created = await makeRegisteredWorkspace(
        "pr-review-windows-identity-create-",
      );
      const gated = await makeGatedStatusWorkspace(
        "pr-review-windows-identity-read-",
      );

      try {
        process.chdir(created.physicalPrimary);
        setLeaseCommandEnv(
          created.physicalPrimary,
          windowsMixedSpelling(created.physicalWorktree),
        );
        const derived = await runPrReviewLeasesCommand(["derive-path"]);
        expect(derived.exitCode, derived.stderr).toBe(0);
        const leaseFile = derived.stdout.trim();
        process.env.LEASE_FILE = leaseFile;
        await writeLeaseCommandState({
          state: "created",
          updatedAt: "2026-06-11T00:00:00Z",
        });
        expect(await readLease(created.primary, leaseFile)).toMatchObject({
          worktree_path: canonicalLeaseIdentityPath(created.physicalWorktree),
          worktree_digest: digestLeaseIdentityPath(created.physicalWorktree),
          lease_file: leaseFile,
        });

        process.chdir(gated.physicalPrimary);
        setReadStatusEnv(gated);
        process.env.WORKTREE_PATH = windowsBackslashSpelling(
          gated.physicalWorktree,
        );
        const readStatus = await runPrReviewLeasesCommand(["read-status"]);
        expect(readStatus.exitCode, readStatus.stderr).toBe(0);
        expect(JSON.parse(readStatus.stdout)).toMatchObject({
          worktree_path: canonicalLeaseIdentityPath(gated.physicalWorktree),
          worktree_digest: digestLeaseIdentityPath(gated.physicalWorktree),
        });

        await writeFile(
          path.join(created.primary, leaseFile),
          `${JSON.stringify(
            abortedCommandLease(
              leaseFile,
              created.physicalWorktree,
              digestLeaseIdentityPath(created.physicalWorktree),
            ),
            null,
            2,
          )}\n`,
        );
        process.chdir(created.physicalPrimary);
        setLeaseCommandEnv(
          created.physicalPrimary,
          windowsBackslashSpelling(created.physicalWorktree),
        );
        process.env.LEASE_FILE = leaseFile;
        const cleanup = await runPrReviewLeasesCommand(["cleanup-worktree"]);
        expect(cleanup.exitCode, cleanup.stderr).toBe(0);
        expect(cleanup.stdout).toContain("OUTCOME=removed");

        unsetEnv("LEASE_FILE");
        process.env.WORKTREE_PATH = windowsMixedSpelling(
          created.physicalWorktree,
        );
        const missingDerived = await runPrReviewLeasesCommand(["derive-path"]);
        expect(missingDerived.exitCode, missingDerived.stderr).toBe(0);
        expect(missingDerived.stdout.trim()).toBe(leaseFile);
      } finally {
        process.chdir(originalCwd);
        await rm(created.tempRoot, { recursive: true, force: true });
        await rm(gated.tempRoot, { recursive: true, force: true });
      }
    },
  );
});

describe("pr-review absent worktree identity derivation", () => {
  it("derives the same lease path after the absolute worktree path is removed", async () => {
    const workspace = await makeRegisteredWorkspace(
      "pr-review-missing-identity-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      const beforeRemoval = await runPrReviewLeasesCommand(["derive-path"]);
      expect(beforeRemoval.exitCode, beforeRemoval.stderr).toBe(0);

      await rm(workspace.worktree, { recursive: true, force: true });

      const afterRemoval = await runPrReviewLeasesCommand(["derive-path"]);
      expect(afterRemoval.exitCode, afterRemoval.stderr).toBe(0);
      expect(afterRemoval.stdout).toBe(beforeRemoval.stdout);

      const write = await runPrReviewLeasesCommand(["write"]);
      expect(write.exitCode).toBe(1);
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });
});

const identity = {
  repository: "owner/repo",
  prNumber: 432,
  worktreePath: "/tmp/review-worktree",
  worktreeDigest:
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  leaseFile:
    ".ephemeral/pr-432-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-lease.json",
};
const resultDigest =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const refreshedResultDigest =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

const originalCwd = process.cwd();
const managedEnvKeys = [
  "REPOSITORY",
  "PR_NUMBER",
  "PRIMARY_REPOSITORY_ROOT",
  "WORKTREE_PATH",
  "LEASE_FILE",
  "HANDOFF_FILE",
  "RESULT_FILE",
  "FINDINGS_FILE",
  "HEAD_SHA",
  "REVIEW_CONTEXT_INPUT_FILE",
  "REVIEW_CONTEXT_INPUT_JSON",
  "STATE",
  "BASE_REF",
  "HEAD_REF",
  "CREATED_AT",
  "UPDATED_AT",
  "PRESENTED_AT",
  "PRESENTATION_STATUS",
  "FINISHED_AT",
  "TERMINAL_REASON",
  "FAILURE_PHASE",
  "FAILURE_REASON",
  "FAILURE_RECOVERABILITY",
  "GITHUB_POST_ATTEMPTED",
  "GITHUB_POST_RESULT",
  "GITHUB_POSTED_AT",
  "APPROVED_REVIEW_FILE",
  "VALIDATED_REVIEW_PAYLOAD_FILE",
  "VALIDATED_PAYLOAD_FILE",
  "EXPECTED_STATE",
  "ALLOW_POLICY_OVERRIDE",
  "PR_REVIEW_DIR",
  "PR_REVIEW_MANIFEST_HELPER_SCRIPT",
  "PR_REVIEW_LEASE_HELPER_SCRIPT",
  "PLAY_REVIEW_HELPER",
  "PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT",
  "DEVCANON_RUNTIME_DIR",
  "GIT_TRACE2_EVENT",
  "GIT_INDEX_FILE",
] as const;

afterEach(() => {
  process.chdir(originalCwd);
  for (const key of managedEnvKeys) {
    delete process.env[key];
  }
});

function createLease(): PrReviewLease {
  return reducePrReviewLease(null, identity, {
    state: "created",
    baseRef: "main",
    headRef: "topic",
    createdAt: "2026-06-11T00:00:00Z",
    updatedAt: "2026-06-11T00:00:00Z",
  });
}

function reviewedLease(): PrReviewLease {
  return reducePrReviewLease(createLease(), identity, {
    state: "reviewed",
    baseRef: "main",
    headRef: "topic",
    createdAt: "2026-06-11T00:00:00Z",
    updatedAt: "2026-06-11T00:01:00Z",
    resultFile: ".ephemeral/pr-432-result.json",
    resultSha256: resultDigest,
  });
}

function gatedLease(): PrReviewLease {
  return reducePrReviewLease(reviewedLease(), identity, {
    state: "gated",
    baseRef: "main",
    headRef: "topic",
    createdAt: "2026-06-11T00:00:00Z",
    updatedAt: "2026-06-11T00:02:00Z",
    presentedAt: "2026-06-11T00:02:00Z",
    presentationStatus: "preview-current",
    resultSha256: resultDigest,
  });
}

describe("pr-review lease reducer", () => {
  it("creates and advances created, reviewed, and gated leases", () => {
    expect(createLease()).toMatchObject({
      state: "created",
      artifacts: {
        handoff_file: null,
        result_file: null,
        approved_review_file: null,
      },
      github: { github_post_result: "not-attempted" },
    });

    expect(reviewedLease()).toMatchObject({
      state: "reviewed",
      artifacts: { result_file: ".ephemeral/pr-432-result.json" },
      validation: {
        result_manifest: {
          status: "valid",
          validated_at: "2026-06-11T00:01:00Z",
          sha256: resultDigest,
        },
      },
    });

    expect(gatedLease()).toMatchObject({
      state: "gated",
      presentation: {
        presented_at: "2026-06-11T00:02:00Z",
        status: "preview-current",
      },
      validation: {
        result_manifest: {
          status: "valid",
          validated_at: "2026-06-11T00:02:00Z",
          sha256: resultDigest,
        },
      },
    });
  });

  it("requires digest inputs for result-manifest reducer states", () => {
    expect(() =>
      reducePrReviewLease(createLease(), identity, {
        state: "reviewed",
        baseRef: "main",
        headRef: "topic",
        createdAt: "2026-06-11T00:00:00Z",
        updatedAt: "2026-06-11T00:01:00Z",
        resultFile: ".ephemeral/pr-432-result.json",
      }),
    ).toThrow("RESULT_SHA256 is required");

    expect(() =>
      reducePrReviewLease(reviewedLease(), identity, {
        state: "gated",
        baseRef: "main",
        headRef: "topic",
        createdAt: "2026-06-11T00:00:00Z",
        updatedAt: "2026-06-11T00:02:00Z",
        presentedAt: "2026-06-11T00:02:00Z",
        presentationStatus: "preview-current",
      }),
    ).toThrow("RESULT_SHA256 is required");
  });

  it("records post success and derives GitHub metadata", () => {
    const posted = reducePrReviewLease(gatedLease(), identity, {
      state: "posted",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:03:00Z",
      approvedReviewFile: ".ephemeral/topic-approved-review.json",
      validatedPayloadFile:
        ".ephemeral/pr-432-1111111111111111111111111111111111111111-validated-review-payload.json",
      finishedAt: "2026-06-11T00:03:00Z",
      githubPostedAt: "2026-06-11T00:03:00Z",
    });

    expect(posted).toMatchObject({
      state: "posted",
      artifacts: {
        approved_review_file: ".ephemeral/topic-approved-review.json",
        validated_payload_file:
          ".ephemeral/pr-432-1111111111111111111111111111111111111111-validated-review-payload.json",
      },
      github: {
        github_post_attempted: true,
        github_post_result: "succeeded",
        github_posted_at: "2026-06-11T00:03:00Z",
      },
      failure: { phase: null },
    });
  });

  it("rejects posted leases without a validated payload pointer", () => {
    expect(() =>
      reducePrReviewLease(gatedLease(), identity, {
        state: "posted",
        baseRef: "main",
        headRef: "topic",
        createdAt: "2026-06-11T00:00:00Z",
        updatedAt: "2026-06-11T00:03:00Z",
        approvedReviewFile: ".ephemeral/topic-approved-review.json",
        finishedAt: "2026-06-11T00:03:00Z",
        githubPostedAt: "2026-06-11T00:03:00Z",
      }),
    ).toThrow("VALIDATED_REVIEW_PAYLOAD_FILE is required");
  });

  it("preserves gated recovery evidence for GitHub post failures", () => {
    const failed = reducePrReviewLease(gatedLease(), identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:04:00Z",
      approvedReviewFile: ".ephemeral/topic-approved-review.json",
      finishedAt: "2026-06-11T00:04:00Z",
      failurePhase: "github-post",
      failureReason: "GitHub API rejected review",
      failureRecoverability: "recoverable",
      githubPostAttempted: true,
      githubPostResult: "failed",
    });

    expect(failed).toMatchObject({
      state: "failed",
      artifacts: {
        result_file: ".ephemeral/pr-432-result.json",
        approved_review_file: ".ephemeral/topic-approved-review.json",
      },
      presentation: { status: "preview-current" },
      github: {
        github_post_attempted: true,
        github_post_result: "failed",
        github_posted_at: null,
      },
    });
  });

  it("covers documented lifecycle transition rows", () => {
    const created = createLease();
    const attached = reducePrReviewLease(created, identity, {
      state: "created",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:00:30Z",
      handoffFile: ".ephemeral/pr-432-handoff.json",
    });
    expect(attached.artifacts.handoff_file).toBe(
      ".ephemeral/pr-432-handoff.json",
    );

    const reviewed = reviewedLease();
    const abortedFromReviewed = reducePrReviewLease(reviewed, identity, {
      state: "aborted",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:02:30Z",
      finishedAt: "2026-06-11T00:02:30Z",
      terminalReason: "user-aborted",
    });
    expect(abortedFromReviewed).toMatchObject({
      state: "aborted",
      artifacts: { result_file: ".ephemeral/pr-432-result.json" },
    });

    const gated = gatedLease();
    const refreshedGate = reducePrReviewLease(gated, identity, {
      state: "gated",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:02:30Z",
      presentedAt: "2026-06-11T00:02:30Z",
      presentationStatus: "edited",
      resultSha256: refreshedResultDigest,
    });
    expect(refreshedGate.presentation.status).toBe("edited");
    expect(refreshedGate.validation.result_manifest.sha256).toBe(
      refreshedResultDigest,
    );

    const abortedFromGated = reducePrReviewLease(gated, identity, {
      state: "aborted",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:03:30Z",
      finishedAt: "2026-06-11T00:03:30Z",
      terminalReason: "user-aborted",
    });
    expect(abortedFromGated.presentation.status).toBe("preview-current");

    const failedFromCreated = reducePrReviewLease(created, identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:04:00Z",
      finishedAt: "2026-06-11T00:04:00Z",
      failurePhase: "handoff-validation",
      failureReason: "handoff rejected",
      failureRecoverability: "recoverable",
    });
    expect(failedFromCreated.artifacts.result_file).toBeNull();

    const failedFromReviewed = reducePrReviewLease(reviewed, identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:05:00Z",
      finishedAt: "2026-06-11T00:05:00Z",
      failurePhase: "preview-render",
      failureReason: "preview failed",
      failureRecoverability: "recoverable",
    });
    expect(failedFromReviewed.artifacts.result_file).toBe(
      ".ephemeral/pr-432-result.json",
    );

    const failedPreApproval = reducePrReviewLease(gated, identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:06:00Z",
      finishedAt: "2026-06-11T00:06:00Z",
      failurePhase: "stale-head",
      failureReason: "head moved",
      failureRecoverability: "recoverable",
    });
    expect(failedPreApproval.presentation.status).toBe("preview-current");

    const failedApprovalFreeze = reducePrReviewLease(gated, identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:07:00Z",
      approvedReviewFile: ".ephemeral/topic-approved-review.json",
      finishedAt: "2026-06-11T00:07:00Z",
      failurePhase: "approval-freeze",
      failureReason: "approval artifact rejected",
      failureRecoverability: "recoverable",
    });
    expect(failedApprovalFreeze.artifacts.approved_review_file).toBe(
      ".ephemeral/topic-approved-review.json",
    );

    const recoveredGate = reducePrReviewLease(failedPreApproval, identity, {
      state: "gated",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:08:00Z",
      presentedAt: "2026-06-11T00:08:00Z",
      presentationStatus: "preview-current",
      resultSha256: resultDigest,
    });
    expect(recoveredGate.state).toBe("gated");

    const abortedFromFailed = reducePrReviewLease(failedPreApproval, identity, {
      state: "aborted",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:09:00Z",
      finishedAt: "2026-06-11T00:09:00Z",
      terminalReason: "not posting",
    });
    expect(abortedFromFailed.state).toBe("aborted");

    const repeatedFailure = reducePrReviewLease(failedPreApproval, identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:10:00Z",
      finishedAt: "2026-06-11T00:10:00Z",
      failurePhase: "preview-render",
      failureReason: "preview still failed",
      failureRecoverability: "recoverable",
    });
    expect(repeatedFailure.failure.reason).toBe("preview still failed");

    const githubFailure = reducePrReviewLease(gated, identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:11:00Z",
      approvedReviewFile: ".ephemeral/topic-approved-review.json",
      validatedPayloadFile:
        ".ephemeral/pr-432-1111111111111111111111111111111111111111-validated-review-payload.json",
      finishedAt: "2026-06-11T00:11:00Z",
      failurePhase: "github-post",
      failureReason: "GitHub API rejected review",
      failureRecoverability: "recoverable",
      githubPostAttempted: true,
      githubPostResult: "failed",
    });
    const retryPosted = reducePrReviewLease(githubFailure, identity, {
      state: "posted",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:12:00Z",
      finishedAt: "2026-06-11T00:12:00Z",
      githubPostedAt: "2026-06-11T00:12:00Z",
    });
    expect(retryPosted.github.github_post_result).toBe("succeeded");

    const recreated = reducePrReviewLease(abortedFromFailed, identity, {
      state: "created",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:13:00Z",
      updatedAt: "2026-06-11T00:13:00Z",
    });
    expect(recreated).toMatchObject({
      state: "created",
      artifacts: { result_file: null },
      validation: {
        result_manifest: { status: null, validated_at: null, sha256: null },
      },
    });
  });

  it("rejects invalid cross-state transitions", () => {
    expect(() =>
      reducePrReviewLease(createLease(), identity, {
        state: "posted",
        baseRef: "main",
        headRef: "topic",
        createdAt: "2026-06-11T00:00:00Z",
        updatedAt: "2026-06-11T00:05:00Z",
        approvedReviewFile: ".ephemeral/topic-approved-review.json",
        finishedAt: "2026-06-11T00:05:00Z",
        githubPostedAt: "2026-06-11T00:05:00Z",
      }),
    ).toThrow("invalid lease transition: created -> posted");
  });
});

describe("pr-review lease command validation", () => {
  it("writes result sha256 and same-cycle validation timestamps for every preview presentation", async () => {
    const {
      tempRoot,
      primary,
      worktree,
      physicalPrimary,
      physicalWorktree,
      reviewHead,
      prReviewDir,
      prReviewManifestHelperScript,
      prReviewLeaseHelperScript,
      playReviewHelper,
    } = await makeResultAuthorityWorkspace("pr-review-preview-digest-");
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir,
        prReviewManifestHelperScript,
        prReviewLeaseHelperScript,
        playReviewHelper,
      });
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });

      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "preview-current",
      );
      process.env.RESULT_FILE = resultFile;
      await writeLeaseCommandState({
        state: "reviewed",
        updatedAt: "2026-06-11T00:01:00Z",
      });
      const firstDigest = await sha256File(path.join(worktree, resultFile));

      process.env.PRESENTED_AT = "2026-06-11T00:02:00Z";
      process.env.PRESENTATION_STATUS = "preview-current";
      await writeLeaseCommandState({
        state: "gated",
        updatedAt: "2026-06-11T00:02:00Z",
      });
      const firstGate = await readLease(primary, leaseFile);
      expect(firstGate.validation.result_manifest).toEqual({
        status: "valid",
        validated_at: "2026-06-11T00:02:00Z",
        sha256: firstDigest,
      });
      expect(firstGate.validation.result_manifest.validated_at).toBe(
        firstGate.updated_at,
      );

      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "edited",
      );
      const secondDigest = await sha256File(path.join(worktree, resultFile));
      expect(secondDigest).not.toBe(firstDigest);
      process.env.PRESENTED_AT = "2026-06-11T00:03:00Z";
      process.env.PRESENTATION_STATUS = "edited";
      await writeLeaseCommandState({
        state: "gated",
        updatedAt: "2026-06-11T00:03:00Z",
      });
      const secondGate = await readLease(primary, leaseFile);
      expect(secondGate.artifacts.result_file).toBe(resultFile);
      expect(secondGate.validation.result_manifest).toEqual({
        status: "valid",
        validated_at: "2026-06-11T00:03:00Z",
        sha256: secondDigest,
      });
      expect(secondGate.validation.result_manifest.validated_at).toBe(
        secondGate.updated_at,
      );
      expect(secondGate.presentation.status).toBe("edited");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects legacy validation shapes without rewriting or migrating them", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeLeaseWorkspace("pr-review-legacy-validation-");
    const reviewHead = "1111111111111111111111111111111111111111";
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;

    try {
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "preview-current",
      );
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      const validLease = reviewedCommandLease(
        leaseFile,
        physicalWorktree,
        dynamicIdentity.worktreeDigest,
        resultFile,
        await sha256File(path.join(worktree, resultFile)),
      );
      const cases: Array<{
        name: string;
        lease: unknown;
        stderr: string;
      }> = [
        {
          name: "missing-validation",
          lease: omitKey(validLease, "validation"),
          stderr: "lease validation metadata missing",
        },
        {
          name: "missing-result-manifest",
          lease: {
            ...validLease,
            validation: {},
          },
          stderr: "lease result_manifest metadata missing",
        },
        {
          name: "missing-digest",
          lease: {
            ...validLease,
            validation: {
              result_manifest: {
                status: "valid",
                validated_at: "2026-06-11T00:01:00Z",
              },
            },
          },
          stderr: "result manifest digest missing",
        },
      ];

      for (const testCase of cases) {
        await writeFile(
          path.join(primary, leaseFile),
          `${JSON.stringify(testCase.lease, null, 2)}\n`,
        );
        const before = await readFile(path.join(primary, leaseFile), "utf8");

        process.env.LEASE_FILE = leaseFile;
        let result = await runPrReviewLeasesCommand(["validate"]);
        expect(result.exitCode, testCase.name).toBe(1);
        expect(result.stdout, testCase.name).toBe("");
        expect(result.stderr, testCase.name).toContain(testCase.stderr);
        await expect(
          readFile(path.join(primary, leaseFile), "utf8"),
        ).resolves.toBe(before);

        result = await runPrReviewLeasesCommand(["inspect-worktree"]);
        expect(result.exitCode, testCase.name).toBe(0);
        expect(result.stdout, testCase.name).toContain(
          "REFUSAL_REASON=invalid-lease",
        );
        await expect(
          readFile(path.join(primary, leaseFile), "utf8"),
        ).resolves.toBe(before);

        process.env.PRESENTED_AT = "2026-06-11T00:02:00Z";
        process.env.PRESENTATION_STATUS = "preview-current";
        process.env.RESULT_FILE = resultFile;
        process.env.STATE = "gated";
        process.env.BASE_REF = "main";
        process.env.HEAD_REF = "topic";
        process.env.UPDATED_AT = "2026-06-11T00:02:00Z";
        result = await runPrReviewLeasesCommand(["write"]);
        expect(result.exitCode, testCase.name).toBe(1);
        expect(result.stdout, testCase.name).toBe("");
        expect(result.stderr, testCase.name).toContain(testCase.stderr);
        await expect(
          readFile(path.join(primary, leaseFile), "utf8"),
        ).resolves.toBe(before);
      }
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects invalid result paths before hashing lifecycle write inputs", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeLeaseWorkspace("pr-review-result-path-");

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });
      const before = await readFile(path.join(primary, leaseFile), "utf8");
      await writeFile(
        path.join(tempRoot, "outside-result.json"),
        `${JSON.stringify({
          repository: "owner/repo",
          pr_number: 432,
          review_head_sha: "1111111111111111111111111111111111111111",
        })}\n`,
      );

      process.env.RESULT_FILE = "../outside-result.json";
      process.env.STATE = "reviewed";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:01:00Z";
      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("path traversal: ../outside-result.json");
      await expect(
        readFile(path.join(primary, leaseFile), "utf8"),
      ).resolves.toBe(before);
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("writes a digest when advancing valid reviewed leases to gated", async () => {
    const {
      tempRoot,
      primary,
      worktree,
      physicalPrimary,
      physicalWorktree,
      reviewHead,
      prReviewDir,
      prReviewManifestHelperScript,
      prReviewLeaseHelperScript,
      playReviewHelper,
    } = await makeResultAuthorityWorkspace("pr-review-valid-digest-");
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;

    try {
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "preview-current",
      );
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir,
        prReviewManifestHelperScript,
        prReviewLeaseHelperScript,
        playReviewHelper,
      });
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(
          reviewedCommandLease(
            leaseFile,
            physicalWorktree,
            dynamicIdentity.worktreeDigest,
            resultFile,
            await sha256File(path.join(worktree, resultFile)),
          ),
          null,
          2,
        )}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      process.env.PRESENTED_AT = "2026-06-11T00:02:00Z";
      process.env.PRESENTATION_STATUS = "preview-current";
      await writeLeaseCommandState({
        state: "gated",
        updatedAt: "2026-06-11T00:02:00Z",
      });
      const lease = await readLease(primary, leaseFile);
      expect(lease.validation.result_manifest.sha256).toBe(
        await sha256File(path.join(worktree, resultFile)),
      );
      const validateResult = await runPrReviewLeasesCommand(["validate"]);
      expect(validateResult.exitCode, validateResult.stderr).toBe(0);
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("accepts initial not-presented results for reviewed leases without making them live status", async () => {
    const {
      tempRoot,
      primary,
      worktree,
      physicalPrimary,
      physicalWorktree,
      reviewHead,
      prReviewDir,
      prReviewManifestHelperScript,
      prReviewLeaseHelperScript,
      playReviewHelper,
    } = await makeResultAuthorityWorkspace("pr-review-not-presented-");
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;

    try {
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "not-presented",
      );
      const resultSha256 = await sha256File(path.join(worktree, resultFile));
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir,
        prReviewManifestHelperScript,
        prReviewLeaseHelperScript,
        playReviewHelper,
      });
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });

      process.env.RESULT_FILE = resultFile;
      await writeLeaseCommandState({
        state: "reviewed",
        updatedAt: "2026-06-11T00:01:00Z",
      });

      const reviewed = await readLease(primary, leaseFile);
      expect(reviewed).toMatchObject({
        state: "reviewed",
        artifacts: { result_file: resultFile },
        validation: {
          result_manifest: {
            status: "valid",
            validated_at: "2026-06-11T00:01:00Z",
            sha256: resultSha256,
          },
        },
        presentation: { presented_at: null, status: null },
      });

      let result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode, result.stderr).toBe(0);

      process.env.HEAD_SHA = reviewHead;
      result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result).toMatchObject({ exitCode: 1, stdout: "" });
      expect(result.stderr).toContain("read-status requires gated lease");

      process.env.FINISHED_AT = "2026-06-11T00:02:00Z";
      process.env.TERMINAL_REASON = "not posting";
      await writeLeaseCommandState({
        state: "aborted",
        updatedAt: "2026-06-11T00:02:00Z",
      });

      const aborted = await readLease(primary, leaseFile);
      expect(aborted).toMatchObject({
        state: "aborted",
        artifacts: { result_file: resultFile },
        presentation: { presented_at: null, status: null },
      });

      result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode, result.stderr).toBe(0);
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects nested result artifact drift before fresh reviewed and gated writes", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-fresh-nested-drift-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);

      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await rm(path.join(workspace.primary, leaseFile), { force: true });
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });
      const createdBefore = await readFile(
        path.join(workspace.primary, leaseFile),
        "utf8",
      );

      await mutateNestedFindingsWithoutUpdatingResult(workspace);
      process.env.RESULT_FILE = workspace.resultFile;
      process.env.STATE = "reviewed";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:01:00Z";
      process.env.PR_REVIEW_DIR = workspace.prReviewDir;
      process.env.PR_REVIEW_MANIFEST_HELPER_SCRIPT =
        workspace.prReviewManifestHelperScript;
      process.env.PR_REVIEW_LEASE_HELPER_SCRIPT =
        workspace.prReviewLeaseHelperScript;
      process.env.PLAY_REVIEW_HELPER = workspace.playReviewHelper;

      let result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("findings digest mismatch");
      await expect(
        readFile(path.join(workspace.primary, leaseFile), "utf8"),
      ).resolves.toBe(createdBefore);

      await writeFile(
        path.join(workspace.primary, leaseFile),
        `${JSON.stringify(
          reviewedCommandLease(
            leaseFile,
            workspace.physicalWorktree,
            identityFromLeaseFile(leaseFile, workspace.physicalWorktree)
              .worktreeDigest,
            workspace.resultFile,
            workspace.resultSha256,
          ),
          null,
          2,
        )}\n`,
      );
      const reviewedBefore = await readFile(
        path.join(workspace.primary, leaseFile),
        "utf8",
      );
      process.env.PRESENTED_AT = "2026-06-11T00:02:00Z";
      process.env.PRESENTATION_STATUS = "preview-current";
      process.env.STATE = "gated";
      process.env.UPDATED_AT = "2026-06-11T00:02:00Z";
      result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("findings digest mismatch");
      await expect(
        readFile(path.join(workspace.primary, leaseFile), "utf8"),
      ).resolves.toBe(reviewedBefore);
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects malformed closed cleanup metadata", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-cleanup-shape-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      process.env.LEASE_FILE = workspace.leaseFile;
      for (const cleanup of [
        {
          last_outcome: "unknown",
          last_checked_at: null,
          removed_at: null,
        },
        {
          last_outcome: "removed",
          last_checked_at: "not-a-timestamp",
          removed_at: "2026-06-11T00:03:00Z",
        },
        {
          last_outcome: "removed",
          last_checked_at: "2026-02-30T00:00:00Z",
          removed_at: "2026-06-11T00:03:00Z",
        },
        {
          last_outcome: "removed",
          last_checked_at: "2026-06-11T00:03:00Z",
          removed_at: "2026-06-11T00:03:00Z",
          unexpected: true,
        },
      ]) {
        const lease = await readLease(workspace.primary, workspace.leaseFile);
        lease.cleanup = cleanup as PrReviewLease["cleanup"];
        await writeFile(
          path.join(workspace.primary, workspace.leaseFile),
          `${JSON.stringify(lease, null, 2)}\n`,
        );
        const result = await runPrReviewLeasesCommand(["validate"]);
        expect(result.exitCode).toBe(1);
      }
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears invalid strict failure evidence instead of rejecting failed writes", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-terminal-nested-drift-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      process.env.FAILURE_PHASE = "github-post";
      process.env.FAILURE_REASON = "GitHub API rejected review";
      process.env.GITHUB_POST_ATTEMPTED = "true";
      process.env.GITHUB_POST_RESULT = "failed";
      process.env.APPROVED_REVIEW_FILE = `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`;
      await writeApprovedReviewArtifact(
        workspace.worktree,
        process.env.APPROVED_REVIEW_FILE,
        workspace.reviewHead,
      );
      await writeValidatedPayloadArtifact(
        workspace.worktree,
        workspace.reviewHead,
      );
      const beforeFailure = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );
      await mutateNestedFindingsWithoutUpdatingResult(workspace);

      let result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      const failedAfterDrift = await readLease(
        workspace.primary,
        workspace.leaseFile,
      );
      expect(failedAfterDrift.state).toBe("failed");
      expect(failedAfterDrift.artifacts).toEqual({
        handoff_file: null,
        result_file: null,
        approved_review_file: null,
        validated_payload_file: null,
      });
      expect(failedAfterDrift.validation.result_manifest).toEqual({
        status: null,
        validated_at: null,
        sha256: null,
      });
      expect(failedAfterDrift.failure).toEqual({
        phase: "github-post",
        reason: "GitHub API rejected review",
        recoverability: "recoverable",
      });
      expect(failedAfterDrift.github).toEqual({
        github_post_attempted: true,
        github_post_result: "failed",
        github_posted_at: null,
      });

      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(
          {
            ...JSON.parse(beforeFailure),
            state: "failed",
            updated_at: "2026-06-11T00:03:00Z",
            artifacts: {
              ...JSON.parse(beforeFailure).artifacts,
              approved_review_file: process.env.APPROVED_REVIEW_FILE,
              validated_payload_file: `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`,
            },
            terminal: {
              finished_at: "2026-06-11T00:03:00Z",
              reason: null,
            },
            failure: {
              phase: "github-post",
              reason: "GitHub API rejected review",
              recoverability: "recoverable",
            },
            github: {
              github_post_attempted: true,
              github_post_result: "failed",
              github_posted_at: null,
            },
          },
          null,
          2,
        )}\n`,
      );
      const beforePosted = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );
      process.env.STATE = "posted";
      process.env.EXPECTED_STATE = "failed";
      process.env.UPDATED_AT = "2026-06-11T00:04:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:04:00Z";
      process.env.GITHUB_POSTED_AT = "2026-06-11T00:04:00Z";
      unsetEnv("FAILURE_PHASE");
      unsetEnv("FAILURE_REASON");
      unsetEnv("FAILURE_RECOVERABILITY");
      unsetEnv("GITHUB_POST_ATTEMPTED");
      unsetEnv("GITHUB_POST_RESULT");

      result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("findings digest mismatch");
      await expect(
        readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
      ).resolves.toBe(beforePosted);

      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(failedAfterDrift, null, 2)}\n`,
      );
      process.env.STATE = "posted";
      process.env.EXPECTED_STATE = "failed";
      process.env.UPDATED_AT = "2026-06-11T00:05:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:05:00Z";
      process.env.GITHUB_POSTED_AT = "2026-06-11T00:05:00Z";
      unsetEnv("FAILURE_PHASE");
      unsetEnv("FAILURE_REASON");
      unsetEnv("FAILURE_RECOVERABILITY");
      unsetEnv("GITHUB_POST_ATTEMPTED");
      unsetEnv("GITHUB_POST_RESULT");

      result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "APPROVED_REVIEW_FILE must match existing failed approved-review",
      );
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears invalid approval-freeze evidence while recording failed", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-approval-freeze-invalid-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      process.env.FAILURE_PHASE = "approval-freeze";
      process.env.FAILURE_REASON = "approved review validation failed";
      process.env.APPROVED_REVIEW_FILE = `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`;
      await writeApprovedReviewArtifact(
        workspace.worktree,
        process.env.APPROVED_REVIEW_FILE,
        "2222222222222222222222222222222222222222",
      );

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.state).toBe("failed");
      expect(failed.artifacts).toEqual({
        handoff_file: null,
        result_file: workspace.resultFile,
        approved_review_file: null,
        validated_payload_file: null,
      });
      expect(failed.validation.result_manifest).toEqual({
        status: "valid",
        validated_at: "2026-06-11T00:02:00Z",
        sha256: workspace.resultSha256,
      });
      expect(failed.presentation).toEqual({
        presented_at: "2026-06-11T00:02:00Z",
        status: "preview-current",
      });
      expect(failed.failure).toEqual({
        phase: "approval-freeze",
        reason: "approved review validation failed",
        recoverability: "recoverable",
      });
      expect(failed.github).toEqual({
        github_post_attempted: false,
        github_post_result: "not-attempted",
        github_posted_at: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("preserves handoff-only evidence when a created lease records failure", async () => {
    const {
      tempRoot,
      primary,
      worktree,
      physicalPrimary,
      physicalWorktree,
      reviewHead,
    } = await makeResultAuthorityWorkspace("pr-review-handoff-failure-");
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;
    const handoffFile = `.ephemeral/pr-432-${reviewHead}-handoff.json`;

    try {
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "not-presented",
      );
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });
      process.env.HANDOFF_FILE = handoffFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:01:00Z",
      });

      process.env.STATE = "failed";
      process.env.EXPECTED_STATE = "created";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:02:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:02:00Z";
      process.env.FAILURE_PHASE = "review";
      process.env.FAILURE_REASON = "review failed before result";
      process.env.FAILURE_RECOVERABILITY = "recoverable";
      unsetEnv("RESULT_FILE");

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      const failed = await readLease(primary, leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: handoffFile,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
      });
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("clears invalid handoff-only evidence when a created lease records failure", async () => {
    const {
      tempRoot,
      primary,
      worktree,
      physicalPrimary,
      physicalWorktree,
      reviewHead,
    } = await makeResultAuthorityWorkspace(
      "pr-review-invalid-handoff-failure-",
    );
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;
    const handoffFile = `.ephemeral/pr-432-${reviewHead}-handoff.json`;

    try {
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "not-presented",
      );
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });
      process.env.HANDOFF_FILE = handoffFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:01:00Z",
      });
      const handoffPath = path.join(worktree, handoffFile);
      const handoff = JSON.parse(await readFile(handoffPath, "utf8"));
      await writeFile(
        handoffPath,
        `${JSON.stringify({ ...handoff, repository: "other/repo" }, null, 2)}\n`,
      );

      process.env.STATE = "failed";
      process.env.EXPECTED_STATE = "created";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:02:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:02:00Z";
      process.env.FAILURE_PHASE = "review";
      process.env.FAILURE_REASON = "review failed before result";
      process.env.FAILURE_RECOVERABILITY = "recoverable";
      unsetEnv("RESULT_FILE");

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      const failed = await readLease(primary, leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
      });
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects stale or missing result digests during validate and cleanup classification", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-validate-digest-",
    );

    try {
      setReadStatusEnv(workspace);
      await writeFile(
        path.join(workspace.worktree, workspace.resultFile),
        `${JSON.stringify({
          repository: "owner/repo",
          pr_number: 432,
          review_head_sha: workspace.reviewHead,
          presentation: { status: "preview-current" },
          stale: true,
        })}\n`,
      );

      let result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("result manifest digest mismatch");

      result = await runPrReviewLeasesCommand(["inspect-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("REFUSAL_REASON=invalid-lease");

      await writeResultArtifact(
        workspace.worktree,
        workspace.physicalWorktree,
        workspace.resultFile,
        workspace.reviewHead,
        "preview-current",
      );
      await mutateLease(workspace, (lease) => {
        lease.validation.result_manifest.sha256 = null;
      });

      result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("result manifest digest missing");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects nested result artifact drift during validate", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-validate-nested-drift-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      await mutateNestedFindingsWithoutUpdatingResult(workspace);

      const result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("findings digest mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects terminal stored presentation evidence that mismatches the result", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-terminal-presentation-mismatch-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");

      let result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      await mutateLease(workspace, (lease) => {
        expect(lease.state).toBe("failed");
        lease.presentation.status = "edited";
      });

      setReadStatusEnv(workspace);
      result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("presentation status mismatch");

      result = await runPrReviewLeasesCommand(["inspect-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("REFUSAL_REASON=invalid-lease");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects lease ref mismatch against result handoff evidence during validate", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-validate-ref-mismatch-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.base_ref = "release";
      });
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);

      const result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("handoff base ref mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("fails closed instead of overwriting malformed existing leases", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "pr-review-lease-"));
    const primary = path.join(tempRoot, "primary");
    const worktree = path.join(tempRoot, "worktree");
    await mkdir(path.join(primary, ".ephemeral"), { recursive: true });
    await mkdir(worktree, { recursive: true });
    const physicalPrimary = await realpath(primary);
    const physicalWorktree = await realpath(worktree);

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      await writeFile(path.join(primary, leaseFile), "{not json\n");

      process.env.LEASE_FILE = leaseFile;
      process.env.STATE = "created";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.CREATED_AT = "2026-06-11T00:00:00Z";
      process.env.UPDATED_AT = "2026-06-11T00:00:00Z";

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      await expect(
        readFile(path.join(primary, leaseFile), "utf8"),
      ).resolves.toBe("{not json\n");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects legacy reviewed lease/v1 result pointers without validation metadata", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "pr-review-legacy-"));
    const primary = path.join(tempRoot, "primary");
    const worktree = path.join(tempRoot, "worktree");
    await mkdir(path.join(primary, ".ephemeral"), { recursive: true });
    await mkdir(path.join(worktree, ".ephemeral"), { recursive: true });
    const physicalPrimary = await realpath(primary);
    const physicalWorktree = await realpath(worktree);

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      const resultFile = ".ephemeral/pr-432-result.json";
      await writeFile(
        path.join(worktree, resultFile),
        `${JSON.stringify({
          repository: "owner/repo",
          pr_number: 432,
          review_head_sha: "1111111111111111111111111111111111111111",
        })}\n`,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify({
          schema: "pr-review/lease/v1",
          repository: "owner/repo",
          pr_number: 432,
          state: "reviewed",
          base_ref: "main",
          head_ref: "topic",
          worktree_path: canonicalLeaseIdentityPath(physicalWorktree),
          worktree_digest: dynamicIdentity.worktreeDigest,
          lease_file: leaseFile,
          created_at: "2026-06-11T00:00:00Z",
          updated_at: "2026-06-11T00:01:00Z",
          artifacts: {
            handoff_file: null,
            result_file: resultFile,
            approved_review_file: null,
            validated_payload_file: null,
          },
          presentation: { presented_at: null, status: null },
          terminal: { finished_at: null, reason: null },
          failure: { phase: null, reason: null, recoverability: null },
          github: {
            github_post_attempted: false,
            github_post_result: "not-attempted",
            github_posted_at: null,
          },
        })}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("lease validation metadata missing");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects unknown JSON lease states before state-invariant checks", async () => {
    const { tempRoot, primary, physicalPrimary, physicalWorktree } =
      await makeLeaseWorkspace("pr-review-unknown-state-");

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify({
          schema: "pr-review/lease/v1",
          repository: "owner/repo",
          pr_number: 432,
          state: "postd",
          base_ref: "main",
          head_ref: "topic",
          worktree_path: canonicalLeaseIdentityPath(physicalWorktree),
          worktree_digest: dynamicIdentity.worktreeDigest,
          lease_file: leaseFile,
          created_at: "2026-06-11T00:00:00Z",
          updated_at: "2026-06-11T00:01:00Z",
          artifacts: {
            handoff_file: null,
            result_file: null,
            approved_review_file: null,
            validated_payload_file: null,
          },
          validation: {
            result_manifest: { status: null, validated_at: null, sha256: null },
          },
          presentation: { presented_at: null, status: null },
          terminal: { finished_at: null, reason: null },
          failure: { phase: null, reason: null, recoverability: null },
          github: {
            github_post_attempted: false,
            github_post_result: "not-attempted",
            github_posted_at: null,
          },
        })}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown lease state: postd");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects approved reviews from a different result manifest head", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeLeaseWorkspace("pr-review-approved-head-");
    const resultHead = "1111111111111111111111111111111111111111";
    const approvedHead = "2222222222222222222222222222222222222222";
    const resultFile = `.ephemeral/pr-432-${resultHead}-result.json`;
    const approvedReviewFile = `.ephemeral/topic-${approvedHead}-approved-review.json`;

    try {
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        resultHead,
      );
      await writeApprovedReviewArtifact(
        worktree,
        approvedReviewFile,
        approvedHead,
      );
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(
          postedCommandLease({
            leaseFile,
            worktreePath: physicalWorktree,
            worktreeDigest: dynamicIdentity.worktreeDigest,
            resultFile,
            resultSha256: await sha256File(path.join(worktree, resultFile)),
            approvedReviewFile,
            validatedPayloadFile: `.ephemeral/pr-432-${approvedHead}-validated-review-payload.json`,
          }),
          null,
          2,
        )}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("approved review result head mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects non-deterministic validated payload paths", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeLeaseWorkspace("pr-review-payload-path-");
    const reviewHead = "1111111111111111111111111111111111111111";
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;
    const approvedReviewFile = `.ephemeral/topic-${reviewHead}-approved-review.json`;
    const validatedPayloadFile =
      ".ephemeral/copied-validated-review-payload.json";

    try {
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
      );
      await writeApprovedReviewArtifact(
        worktree,
        approvedReviewFile,
        reviewHead,
      );
      await writeFile(
        path.join(worktree, validatedPayloadFile),
        `${JSON.stringify(reviewPayload(reviewHead))}\n`,
      );
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(
          postedCommandLease({
            leaseFile,
            worktreePath: physicalWorktree,
            worktreeDigest: dynamicIdentity.worktreeDigest,
            resultFile,
            resultSha256: await sha256File(path.join(worktree, resultFile)),
            approvedReviewFile,
            validatedPayloadFile,
          }),
          null,
          2,
        )}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("validated payload path mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("refuses posted leases missing the validated payload before cleanup ownership", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-posted-missing-payload-",
    );
    const approvedReviewFile = `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`;

    try {
      await writeApprovedReviewArtifact(
        workspace.worktree,
        approvedReviewFile,
        workspace.reviewHead,
      );
      const posted = postedCommandLease({
        leaseFile: workspace.leaseFile,
        worktreePath: workspace.physicalWorktree,
        worktreeDigest: workspace.worktreeDigest,
        resultFile: workspace.resultFile,
        resultSha256: workspace.resultSha256,
        approvedReviewFile,
      });
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(posted, null, 2)}\n`,
      );

      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const result = await runPrReviewLeasesCommand(["inspect-worktree"]);

      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain("REFUSAL_REASON=invalid-lease");
      expect(result.stdout).not.toContain("CAN_REMOVE=yes");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("accepts a complete validated posted chain for cleanup ownership", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-complete-posted-chain-",
    );
    const approvedReviewFile = `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`;
    const validatedPayloadFile = await writeValidatedPayloadArtifact(
      workspace.worktree,
      workspace.reviewHead,
    );

    try {
      await writeApprovedReviewArtifact(
        workspace.worktree,
        approvedReviewFile,
        workspace.reviewHead,
      );
      const posted = postedCommandLease({
        leaseFile: workspace.leaseFile,
        worktreePath: workspace.physicalWorktree,
        worktreeDigest: workspace.worktreeDigest,
        resultFile: workspace.resultFile,
        resultSha256: workspace.resultSha256,
        approvedReviewFile,
        validatedPayloadFile,
      });
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(posted, null, 2)}\n`,
      );

      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const result = await runPrReviewLeasesCommand(["validate"]);

      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toBe("");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });
});

describe("pr-review lease read-status", () => {
  it("emits the exact status envelope without cleanup fields or lease mutation", async () => {
    const workspace = await makeGatedStatusWorkspace("pr-review-status-");

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const before = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );
      const result = await runPrReviewLeasesCommand(["read-status"]);
      const after = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );

      expect(result.exitCode).toBe(0);
      expect(after).toEqual(before);
      const lease = JSON.parse(after) as PrReviewLease;
      expect(lease.worktree_path).toBe(
        canonicalLeaseIdentityPath(workspace.physicalWorktree),
      );
      expect(lease.worktree_digest).toBe(
        digestLeaseIdentityPath(workspace.physicalWorktree),
      );
      expect(lease.lease_file).toBe(
        `.ephemeral/pr-432-${digestLeaseIdentityPath(workspace.physicalWorktree)}-lease.json`,
      );
      const status = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(Object.keys(status)).toEqual([
        "lease_state",
        "worktree_path",
        "worktree_digest",
        "worktree_exists",
        "worktree_registered",
        "worktree_dirty",
        "identity_match",
        "result_file",
        "result_sha256",
        "result_validated_at",
        "lease_updated_at",
        "presentation_status",
        "presented_at",
      ]);
      expect(status).toMatchObject({
        lease_state: "gated",
        worktree_path: canonicalLeaseIdentityPath(workspace.physicalWorktree),
        worktree_digest: workspace.worktreeDigest,
        worktree_exists: true,
        worktree_registered: true,
        identity_match: true,
        result_file: workspace.resultFile,
        result_sha256: workspace.resultSha256,
        result_validated_at: "2026-06-11T00:02:00Z",
        lease_updated_at: "2026-06-11T00:02:00Z",
        presentation_status: "preview-current",
        presented_at: "2026-06-11T00:02:00Z",
      });
      expect(typeof status.worktree_dirty).toBe("boolean");
      for (const forbidden of [
        "can_remove",
        "force_remove_allowed",
        "refusal_reason",
        "requires_confirmation",
        "metadata_outcome",
      ]) {
        expect(status).not.toHaveProperty(forbidden);
      }
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("inspects worktree dirtiness with optional git locks disabled", async () => {
    const workspace = await makeGatedStatusWorkspace("pr-review-status-locks-");

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const traceFile = path.join(workspace.tempRoot, "git-trace2.jsonl");
      const originalTrace = process.env.GIT_TRACE2_EVENT;
      process.env.GIT_TRACE2_EVENT = traceFile;
      try {
        const result = await runPrReviewLeasesCommand(["read-status"]);
        expect(result.exitCode, result.stderr).toBe(0);
      } finally {
        if (originalTrace === undefined) {
          unsetEnv("GIT_TRACE2_EVENT");
        } else {
          process.env.GIT_TRACE2_EVENT = originalTrace;
        }
      }

      const statusArgs = (await readFile(traceFile, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { event?: unknown; argv?: unknown })
        .filter(
          (event): event is { event: "start"; argv: string[] } =>
            event.event === "start" &&
            Array.isArray(event.argv) &&
            event.argv.every((value) => typeof value === "string"),
        )
        .map((event) => event.argv)
        .find((argv) => argv.includes("status"));
      expect(statusArgs).toBeDefined();
      if (statusArgs === undefined) {
        throw new Error("missing git status trace2 start event");
      }
      expect(statusArgs).toEqual(
        expect.arrayContaining([
          "--no-optional-locks",
          "-C",
          workspace.physicalWorktree,
          "status",
          "--porcelain",
        ]),
      );
      expect(statusArgs.indexOf("--no-optional-locks")).toBeLessThan(
        statusArgs.indexOf("status"),
      );
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("accepts dirty but valid registered worktrees as status", async () => {
    const workspace = await makeGatedStatusWorkspace("pr-review-status-dirty-");

    try {
      await writeFile(path.join(workspace.worktree, "dirty.txt"), "dirty\n");
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        worktree_dirty: true,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when git status cannot inspect the worktree", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-status-git-failure-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const originalGitIndexFile = process.env.GIT_INDEX_FILE;
      process.env.GIT_INDEX_FILE = workspace.tempRoot;
      const result = await runPrReviewLeasesCommand(["read-status"]);
      if (originalGitIndexFile === undefined) {
        unsetEnv("GIT_INDEX_FILE");
      } else {
        process.env.GIT_INDEX_FILE = originalGitIndexFile;
      }
      expect(result).toMatchObject({ exitCode: 1, stdout: "" });
      expect(result.stderr).toContain("git status inspection failed");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("fails closed for missing, unregistered, unreadable where the platform enforces chmod permissions, and identity-mismatched worktrees", async () => {
    const missing = await makeGatedStatusWorkspace("pr-review-status-missing-");
    try {
      process.chdir(missing.physicalPrimary);
      setReadStatusEnv(missing);
      await rm(missing.worktree, { recursive: true, force: true });
      const result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result).toMatchObject({ exitCode: 1, stdout: "" });
    } finally {
      process.chdir(originalCwd);
      await rm(missing.tempRoot, { recursive: true, force: true });
    }

    const unregisteredBase = await makeRegisteredWorkspace(
      "pr-review-status-unregistered-",
    );
    try {
      const separate = path.join(unregisteredBase.tempRoot, "separate");
      await mkdir(path.join(separate, ".ephemeral"), { recursive: true });
      const physicalSeparate = await realpath(separate);
      process.chdir(unregisteredBase.physicalPrimary);
      setLeaseCommandEnv(unregisteredBase.physicalPrimary, physicalSeparate);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalSeparate,
      );
      const resultFile =
        ".ephemeral/pr-432-1111111111111111111111111111111111111111-result.json";
      await writeResultArtifact(
        separate,
        physicalSeparate,
        resultFile,
        "1111111111111111111111111111111111111111",
        "preview-current",
      );
      await writeFile(
        path.join(unregisteredBase.primary, leaseFile),
        `${JSON.stringify(
          gatedCommandLease({
            leaseFile,
            worktreePath: physicalSeparate,
            worktreeDigest: dynamicIdentity.worktreeDigest,
            resultFile,
            resultSha256: await sha256File(path.join(separate, resultFile)),
          }),
          null,
          2,
        )}\n`,
      );
      process.env.LEASE_FILE = leaseFile;
      process.env.RESULT_FILE = resultFile;
      process.env.HEAD_SHA = "1111111111111111111111111111111111111111";
      const result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result).toMatchObject({ exitCode: 1, stdout: "" });
      expect(result.stderr).toContain("not registered");
    } finally {
      process.chdir(originalCwd);
      await rm(unregisteredBase.tempRoot, { recursive: true, force: true });
    }

    if (process.platform !== "win32") {
      const unreadable = await makeGatedStatusWorkspace(
        "pr-review-status-unreadable-",
      );
      try {
        process.chdir(unreadable.physicalPrimary);
        setReadStatusEnv(unreadable);
        await chmod(unreadable.worktree, 0);
        const result = await runPrReviewLeasesCommand(["read-status"]);
        expect(result).toMatchObject({ exitCode: 1, stdout: "" });
      } finally {
        await chmod(unreadable.worktree, 0o755).catch(() => undefined);
        process.chdir(originalCwd);
        await rm(unreadable.tempRoot, { recursive: true, force: true });
      }
    }

    const mismatch = await makeGatedStatusWorkspace(
      "pr-review-status-mismatch-",
    );
    try {
      const lease = await readLease(mismatch.primary, mismatch.leaseFile);
      await writeFile(
        path.join(mismatch.primary, mismatch.leaseFile),
        `${JSON.stringify({ ...lease, repository: "other/repo" }, null, 2)}\n`,
      );
      process.chdir(mismatch.physicalPrimary);
      setReadStatusEnv(mismatch);
      const result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result).toMatchObject({ exitCode: 1, stdout: "" });
      expect(result.stderr).toContain("lease repository mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(mismatch.tempRoot, { recursive: true, force: true });
    }
  });

  for (const testCase of [
    {
      name: "wrong-result-file",
      env: () => {
        process.env.RESULT_FILE = ".ephemeral/pr-432-other-result.json";
      },
      stderr: "RESULT_FILE must match",
    },
    {
      name: "stale-digest",
      mutate: (workspace: GatedStatusWorkspace) =>
        mutateLease(workspace, (lease) => {
          lease.validation.result_manifest.sha256 = "0".repeat(64);
        }),
      stderr: "digest mismatch",
    },
    {
      name: "stale-timestamp",
      mutate: (workspace: GatedStatusWorkspace) =>
        mutateLease(workspace, (lease) => {
          lease.validation.result_manifest.validated_at =
            "2026-06-11T00:01:00Z";
        }),
      stderr: "validation is stale",
    },
    {
      name: "presentation-mismatch",
      mutate: (workspace: GatedStatusWorkspace) =>
        mutateLease(workspace, (lease) => {
          lease.presentation.status = "edited";
        }),
      stderr: "presentation status mismatch",
    },
    {
      name: "null-presented-at",
      mutate: (workspace: GatedStatusWorkspace) =>
        mutateLease(workspace, (lease) => {
          lease.presentation.presented_at = null;
        }),
      stderr: "lease schema mismatch",
    },
    {
      name: "missing-digest",
      mutate: (workspace: GatedStatusWorkspace) =>
        mutateLease(workspace, (lease) => {
          lease.validation.result_manifest.sha256 = null;
        }),
      stderr: "digest missing",
    },
    {
      name: "wrong-review-head",
      env: () => {
        process.env.HEAD_SHA = "2222222222222222222222222222222222222222";
      },
      stderr: "result review head mismatch",
    },
  ] as const) {
    it(`rejects stale or mismatched gated result evidence: ${testCase.name}`, async () => {
      const workspace = await makeGatedStatusWorkspace(
        `pr-review-status-${testCase.name}-`,
      );
      try {
        await testCase.mutate?.(workspace);
        process.chdir(workspace.physicalPrimary);
        setReadStatusEnv(workspace);
        testCase.env?.();
        const result = await runPrReviewLeasesCommand(["read-status"]);
        expect(result.exitCode, testCase.name).toBe(1);
        expect(result.stdout, testCase.name).toBe("");
        expect(result.stderr, testCase.name).toContain(testCase.stderr);
      } finally {
        process.chdir(originalCwd);
        await rm(workspace.tempRoot, { recursive: true, force: true });
      }
    });
  }

  it("fails closed for nested result artifact drift before status success", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-status-nested-drift-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      await mutateNestedFindingsWithoutUpdatingResult(workspace);

      const result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("findings digest mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("fails closed for lease base/head mismatch before status success", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-status-ref-mismatch-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.head_ref = "other-topic";
      });
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);

      const result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("handoff head ref mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("records post-gated preview-render failure without invalid recovery artifacts", async () => {
    const {
      tempRoot,
      primary,
      worktree,
      physicalPrimary,
      physicalWorktree,
      reviewHead,
      prReviewDir,
      prReviewManifestHelperScript,
      prReviewLeaseHelperScript,
      playReviewHelper,
    } = await makeResultAuthorityWorkspace("pr-review-preview-failure-");
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir,
        prReviewManifestHelperScript,
        prReviewLeaseHelperScript,
        playReviewHelper,
      });
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "preview-current",
      );
      process.env.RESULT_FILE = resultFile;
      await writeLeaseCommandState({
        state: "reviewed",
        updatedAt: "2026-06-11T00:01:00Z",
      });
      process.env.PRESENTED_AT = "2026-06-11T00:02:00Z";
      process.env.PRESENTATION_STATUS = "preview-current";
      await writeLeaseCommandState({
        state: "gated",
        updatedAt: "2026-06-11T00:02:00Z",
      });
      const gated = await readLease(primary, leaseFile);
      await rm(path.join(worktree, resultFile), { force: true });

      unsetEnv("RESULT_FILE");
      unsetEnv("PRESENTED_AT");
      unsetEnv("PRESENTATION_STATUS");
      process.env.EXPECTED_STATE = "gated";
      process.env.FINISHED_AT = "2026-06-11T00:03:00Z";
      process.env.FAILURE_PHASE = "preview-render";
      process.env.FAILURE_REASON = "audit summary render failed";
      process.env.FAILURE_RECOVERABILITY = "recoverable";
      await writeLeaseCommandState({
        state: "failed",
        updatedAt: "2026-06-11T00:03:00Z",
      });

      const failed = await readLease(primary, leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
        failure: {
          phase: "preview-render",
          reason: "audit summary render failed",
          recoverability: "recoverable",
        },
      });
      const validateResult = await runPrReviewLeasesCommand(["validate"]);
      expect(validateResult.exitCode, validateResult.stderr).toBe(0);
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("records reviewed failure after nested result drift by clearing invalid recovery artifacts", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-reviewed-failure-nested-drift-",
    );

    try {
      const reviewed = reviewedCommandLease(
        workspace.leaseFile,
        workspace.physicalWorktree,
        workspace.worktreeDigest,
        workspace.resultFile,
        workspace.resultSha256,
      );
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(reviewed, null, 2)}\n`,
      );
      await mutateNestedFindingsWithoutUpdatingResult(workspace);

      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir: workspace.prReviewDir,
        prReviewManifestHelperScript: workspace.prReviewManifestHelperScript,
        prReviewLeaseHelperScript: workspace.prReviewLeaseHelperScript,
        playReviewHelper: workspace.playReviewHelper,
      });
      process.env.LEASE_FILE = workspace.leaseFile;
      process.env.STATE = "failed";
      process.env.EXPECTED_STATE = "reviewed";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:03:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:03:00Z";
      process.env.FAILURE_PHASE = "preview-render";
      process.env.FAILURE_REASON = "preview failed";
      process.env.FAILURE_RECOVERABILITY = "recoverable";

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
        failure: {
          phase: "preview-render",
          reason: "preview failed",
          recoverability: "recoverable",
        },
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects failed-to-failed writes that replace the result pointer", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-repeated-failure-result-replacement-",
    );

    try {
      const failed: PrReviewLease = {
        ...(await readLease(workspace.primary, workspace.leaseFile)),
        state: "failed",
        updated_at: "2026-06-11T00:03:00Z",
        terminal: {
          finished_at: "2026-06-11T00:03:00Z",
          reason: null,
        },
        failure: {
          phase: "preview-render",
          reason: "preview failed",
          recoverability: "recoverable",
        },
      };
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(failed, null, 2)}\n`,
      );
      const before = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );

      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir: workspace.prReviewDir,
        prReviewManifestHelperScript: workspace.prReviewManifestHelperScript,
        prReviewLeaseHelperScript: workspace.prReviewLeaseHelperScript,
        playReviewHelper: workspace.playReviewHelper,
      });
      process.env.LEASE_FILE = workspace.leaseFile;
      process.env.RESULT_FILE = `.ephemeral/pr-432-${workspace.reviewHead}-replacement-result.json`;
      process.env.STATE = "failed";
      process.env.EXPECTED_STATE = "failed";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:04:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:04:00Z";
      process.env.FAILURE_PHASE = "preview-render";
      process.env.FAILURE_REASON = "preview still failed";
      process.env.FAILURE_RECOVERABILITY = "recoverable";

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "RESULT_FILE must match existing failed result",
      );
      await expect(
        readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
      ).resolves.toBe(before);
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("preserves valid failed recovery evidence without requiring failure timestamp freshness", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-repeated-failure-preserve-",
    );
    const approvedReviewFile = `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`;

    try {
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      process.env.FAILURE_PHASE = "github-post";
      process.env.FAILURE_REASON = "GitHub API rejected review";
      process.env.GITHUB_POST_ATTEMPTED = "true";
      process.env.GITHUB_POST_RESULT = "failed";
      process.env.APPROVED_REVIEW_FILE = approvedReviewFile;
      await writeApprovedReviewArtifact(
        workspace.worktree,
        approvedReviewFile,
        workspace.reviewHead,
      );

      let result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      let failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.updated_at).toBe("2026-06-11T00:03:00Z");
      expect(failed.validation.result_manifest.validated_at).toBe(
        "2026-06-11T00:02:00Z",
      );
      expect(failed.artifacts).toMatchObject({
        result_file: workspace.resultFile,
        approved_review_file: approvedReviewFile,
      });

      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir: workspace.prReviewDir,
        prReviewManifestHelperScript: workspace.prReviewManifestHelperScript,
        prReviewLeaseHelperScript: workspace.prReviewLeaseHelperScript,
        playReviewHelper: workspace.playReviewHelper,
      });
      process.env.LEASE_FILE = workspace.leaseFile;
      process.env.STATE = "failed";
      process.env.EXPECTED_STATE = "failed";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:04:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:04:00Z";
      process.env.FAILURE_PHASE = "github-post";
      process.env.FAILURE_REASON = "GitHub API rejected retry";
      process.env.FAILURE_RECOVERABILITY = "recoverable";
      process.env.GITHUB_POST_ATTEMPTED = "true";
      process.env.GITHUB_POST_RESULT = "failed";

      result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        updated_at: "2026-06-11T00:04:00Z",
        artifacts: {
          result_file: workspace.resultFile,
          approved_review_file: approvedReviewFile,
        },
        validation: {
          result_manifest: {
            status: "valid",
            validated_at: "2026-06-11T00:02:00Z",
            sha256: workspace.resultSha256,
          },
        },
        presentation: {
          presented_at: "2026-06-11T00:02:00Z",
          status: "preview-current",
        },
        failure: {
          phase: "github-post",
          reason: "GitHub API rejected retry",
          recoverability: "recoverable",
        },
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("records Phase 5 audit failure when the worktree is missing", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-missing-audit-worktree-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");
      await execFileAsync(
        "git",
        ["worktree", "remove", "--force", "worktree"],
        {
          cwd: workspace.primary,
        },
      );

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
        failure: {
          phase: "preview-render",
          reason: "audit summary render failed",
          recoverability: "recoverable",
        },
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("records Phase 5 audit failure with missing presentation timestamp after strict status rejection", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-missing-presentation-audit-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.presentation.presented_at = null;
      });
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);

      const validateBefore = await runPrReviewLeasesCommand(["validate"]);
      expect(validateBefore.exitCode).toBe(1);
      expect(validateBefore.stderr).toContain("lease schema mismatch");

      const statusBefore = await runPrReviewLeasesCommand(["read-status"]);
      expect(statusBefore).toMatchObject({ exitCode: 1, stdout: "" });
      expect(statusBefore.stderr).toContain("lease schema mismatch");

      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
        failure: {
          phase: "preview-render",
          reason: "audit summary render failed",
          recoverability: "recoverable",
        },
      });

      process.env.WORKTREE_PATH = workspace.physicalWorktree;
      const validateAfter = await runPrReviewLeasesCommand(["validate"]);
      expect(validateAfter.exitCode, validateAfter.stderr).toBe(0);
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("records Phase 5 audit failure with missing presentation status by clearing recovery artifacts", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-missing-presentation-status-audit-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.presentation.status = null;
      });
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
        failure: {
          phase: "preview-render",
          reason: "audit summary render failed",
          recoverability: "recoverable",
        },
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears recovery artifacts for Phase 5 audit failure when worktree directory is unregistered", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-unregistered-audit-worktree-",
    );

    try {
      await execFileAsync(
        "git",
        ["worktree", "remove", "--force", "worktree"],
        {
          cwd: workspace.primary,
        },
      );
      await mkdir(path.join(workspace.worktree, ".ephemeral"), {
        recursive: true,
      });
      await writeResultArtifact(
        workspace.worktree,
        workspace.physicalWorktree,
        workspace.resultFile,
        workspace.reviewHead,
        "preview-current",
      );
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.artifacts).toEqual({
        handoff_file: null,
        result_file: null,
        approved_review_file: null,
        validated_payload_file: null,
      });
      expect(failed.validation.result_manifest).toEqual({
        status: null,
        validated_at: null,
        sha256: null,
      });
      expect(failed.presentation).toEqual({
        presented_at: null,
        status: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("preserves current recovery artifacts for registered Phase 5 audit failures", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-current-audit-evidence-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.artifacts.result_file).toBe(workspace.resultFile);
      expect(failed.validation.result_manifest).toEqual({
        status: "valid",
        validated_at: "2026-06-11T00:02:00Z",
        sha256: workspace.resultSha256,
      });
      expect(failed.presentation).toEqual({
        presented_at: "2026-06-11T00:02:00Z",
        status: "preview-current",
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears recovery artifacts when nested result artifact digests drift", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-nested-digest-audit-evidence-",
    );

    try {
      await writeFile(
        path.join(workspace.worktree, workspace.findingsFile),
        `${JSON.stringify({ findings: [{ stale: true }], carry_forward: [] })}\n`,
      );
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.artifacts.result_file).toBeNull();
      expect(failed.validation.result_manifest).toEqual({
        status: null,
        validated_at: null,
        sha256: null,
      });
      expect(failed.presentation).toEqual({
        presented_at: null,
        status: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears stale recovery artifacts when recording Phase 5 audit failure", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-stale-audit-evidence-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.validation.result_manifest.validated_at = "2026-06-11T00:01:00Z";
      });
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.artifacts.result_file).toBeNull();
      expect(failed.validation.result_manifest).toEqual({
        status: null,
        validated_at: null,
        sha256: null,
      });
      expect(failed.presentation).toEqual({
        presented_at: null,
        status: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears missing-digest recovery artifacts when recording Phase 5 audit failure", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-missing-digest-audit-evidence-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.validation.result_manifest.sha256 = null;
      });
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.artifacts.result_file).toBeNull();
      expect(failed.validation.result_manifest).toEqual({
        status: null,
        validated_at: null,
        sha256: null,
      });
      expect(failed.presentation).toEqual({
        presented_at: null,
        status: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears presentation-mismatched recovery artifacts when recording Phase 5 audit failure", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-presentation-mismatch-audit-evidence-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.presentation.status = "edited";
      });
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.artifacts.result_file).toBeNull();
      expect(failed.validation.result_manifest).toEqual({
        status: null,
        validated_at: null,
        sha256: null,
      });
      expect(failed.presentation).toEqual({
        presented_at: null,
        status: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects audit failure recovery when the prior lease is not gated", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-audit-not-gated-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.state = "reviewed";
        lease.presentation = { presented_at: null, status: null };
      });
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "record-audit-failure requires gated preview-render failure",
      );
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });
});

describe("pr-review lease discovery", () => {
  it("creates a deterministic read-only plan when no lease or canonical worktree exists", async () => {
    const workspace = await makeRegisteredWorkspace(
      "pr-review-discovery-create-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setDiscoveryEnv(workspace.physicalPrimary);
      const before = await readdir(path.join(workspace.primary, ".ephemeral"));
      const result = await runPrReviewLeasesCommand(["discover"]);
      const after = await readdir(path.join(workspace.primary, ".ephemeral"));

      expect(result.exitCode, result.stderr).toBe(0);
      expect(after).toEqual(before);
      expect(JSON.parse(result.stdout)).toEqual({
        schema: "pr-review/discovery/v1",
        repository: "owner/repo",
        pr_number: 432,
        primary_repository_root: workspace.physicalPrimary,
        canonical_worktree: {
          path: canonicalLeaseIdentityPath(
            path.join(workspace.physicalPrimary, ".worktrees", "pr-432-review"),
          ),
          exists: false,
          registered: false,
          dirty: null,
          status: "absent",
        },
        worktree_registrations: [
          canonicalLeaseIdentityPath(workspace.physicalPrimary),
          canonicalLeaseIdentityPath(workspace.physicalWorktree),
        ],
        active_leases: [],
        archived_leases: [],
        invalid_lease_files: [],
        disposition: "create",
        resume: null,
        cleanup: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it.each(["file", "symlink"])(
    "fails closed when the unleased canonical path is occupied by a %s",
    async (kind) => {
      const workspace = await makeRegisteredWorkspace(
        "pr-review-discovery-occupied-",
      );
      const canonical = path.join(
        workspace.primary,
        ".worktrees",
        "pr-432-review",
      );

      try {
        await mkdir(path.dirname(canonical), { recursive: true });
        if (kind === "file") {
          await writeFile(canonical, "occupied\\n");
        } else {
          await symlink(workspace.worktree, canonical);
        }
        process.chdir(workspace.physicalPrimary);
        setDiscoveryEnv(workspace.physicalPrimary);

        const result = await runPrReviewLeasesCommand(["discover"]);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          disposition: "cleanup-required",
          canonical_worktree: { exists: true, status: "unleased-canonical" },
        });
      } finally {
        process.chdir(originalCwd);
        await rm(workspace.tempRoot, { recursive: true, force: true });
      }
    },
  );

  it.each(["file", "symlink", "directory"])(
    "keeps an authorized terminal lease cleanup-required when the canonical target is occupied by a %s",
    async (kind) => {
      const workspace = await makeRegisteredWorkspace(
        "pr-review-discovery-authorized-terminal-occupied-",
      );
      const canonical = path.join(
        workspace.physicalPrimary,
        ".worktrees",
        "pr-432-review",
      );
      const leaseFile = discoveryLeaseFile(canonical);

      try {
        await mkdir(path.dirname(canonical), { recursive: true });
        if (kind === "file") {
          await writeFile(canonical, "occupied\n");
        } else if (kind === "symlink") {
          await symlink(workspace.worktree, canonical);
        } else {
          await mkdir(canonical);
        }
        const terminal = {
          ...abortedCommandLease(
            leaseFile,
            canonical,
            digestLeaseIdentityPath(canonical),
          ),
          cleanup: {
            last_outcome: "removed" as const,
            last_checked_at: "2026-06-11T00:03:00Z",
            removed_at: "2026-06-11T00:03:00Z",
          },
        };
        await writeFile(
          path.join(workspace.primary, leaseFile),
          `${JSON.stringify(terminal, null, 2)}\n`,
        );
        process.chdir(workspace.physicalPrimary);
        setDiscoveryEnv(workspace.physicalPrimary);

        const result = await runPrReviewLeasesCommand(["discover"]);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          disposition: "cleanup-required",
          canonical_worktree: { exists: true, status: "unleased-canonical" },
          active_leases: [
            {
              lease_file: leaseFile,
              state: "aborted",
              status: "terminal",
              reason:
                kind === "symlink"
                  ? "symlink-worktree"
                  : "unregistered-worktree",
            },
          ],
          cleanup: {
            lease_file: leaseFile,
            reason:
              kind === "symlink" ? "symlink-worktree" : "unregistered-worktree",
          },
        });
      } finally {
        process.chdir(originalCwd);
        await rm(workspace.tempRoot, { recursive: true, force: true });
      }
    },
  );

  it("keeps an authorized terminal lease cleanup-required when the canonical worktree is dirty", async () => {
    const workspace = await makeRegisteredWorkspace(
      "pr-review-discovery-authorized-terminal-dirty-",
    );
    const canonical = path.join(
      workspace.physicalPrimary,
      ".worktrees",
      "pr-432-review",
    );
    const leaseFile = discoveryLeaseFile(canonical);

    try {
      await mkdir(path.dirname(canonical), { recursive: true });
      await execFileAsync(
        "git",
        ["worktree", "add", "-b", "canonical-review-topic", canonical],
        { cwd: workspace.primary },
      );
      await writeFile(path.join(canonical, "dirty.txt"), "dirty\n");
      const terminal = {
        ...abortedCommandLease(
          leaseFile,
          canonical,
          digestLeaseIdentityPath(canonical),
        ),
        cleanup: {
          last_outcome: "removed" as const,
          last_checked_at: "2026-06-11T00:03:00Z",
          removed_at: "2026-06-11T00:03:00Z",
        },
      };
      await writeFile(
        path.join(workspace.primary, leaseFile),
        `${JSON.stringify(terminal, null, 2)}\n`,
      );
      process.chdir(workspace.physicalPrimary);
      setDiscoveryEnv(workspace.physicalPrimary);

      const result = await runPrReviewLeasesCommand(["discover"]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        disposition: "cleanup-required",
        canonical_worktree: {
          exists: true,
          registered: true,
          dirty: true,
          status: "unleased-canonical",
        },
        active_leases: [
          {
            lease_file: leaseFile,
            state: "aborted",
            status: "terminal",
            reason: "dirty",
          },
        ],
        cleanup: { lease_file: leaseFile, reason: "dirty" },
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("resumes exactly one valid schema-bound alternate worktree lease", async () => {
    const workspace = await makeRegisteredWorkspace(
      "pr-review-discovery-resume-",
    );

    try {
      await writeDiscoveryLease(workspace.primary, workspace.physicalWorktree);
      process.chdir(workspace.physicalPrimary);
      setDiscoveryEnv(workspace.physicalPrimary);

      const result = await runPrReviewLeasesCommand(["discover"]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        disposition: "resume",
        resume: {
          lease_file: discoveryLeaseFile(workspace.physicalWorktree),
          worktree_path: canonicalLeaseIdentityPath(workspace.physicalWorktree),
        },
        active_leases: [
          {
            lease_file: discoveryLeaseFile(workspace.physicalWorktree),
            state: "created",
            status: "resumable",
            worktree: {
              exists: true,
              registered: true,
              dirty: false,
              unmanaged_ephemeral_artifacts: [],
            },
          },
        ],
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("resumes exactly one valid schema-bound canonical worktree lease", async () => {
    const workspace = await makeRegisteredWorkspace(
      "pr-review-discovery-canonical-resume-",
    );
    const canonical = path.join(
      workspace.physicalPrimary,
      ".worktrees",
      "pr-432-review",
    );

    try {
      await mkdir(path.dirname(canonical), { recursive: true });
      await execFileAsync(
        "git",
        ["worktree", "add", "-b", "canonical-review-topic", canonical],
        { cwd: workspace.primary },
      );
      await mkdir(path.join(canonical, ".ephemeral"), { recursive: true });
      const leaseFile = await writeDiscoveryLease(workspace.primary, canonical);
      process.chdir(workspace.physicalPrimary);
      setDiscoveryEnv(workspace.physicalPrimary);

      const result = await runPrReviewLeasesCommand(["discover"]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        disposition: "resume",
        canonical_worktree: {
          exists: true,
          registered: true,
          dirty: false,
          status: "registered",
        },
        resume: {
          lease_file: leaseFile,
          worktree_path: canonicalLeaseIdentityPath(canonical),
        },
        cleanup: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps a moved registered canonical worktree replaced by a symlink cleanup-required", async () => {
    const workspace = await makeRegisteredWorkspace(
      "pr-review-discovery-canonical-symlink-move-",
    );
    const canonical = path.join(
      workspace.physicalPrimary,
      ".worktrees",
      "pr-432-review",
    );
    const moved = path.join(workspace.tempRoot, "moved-review");

    try {
      await mkdir(path.dirname(canonical), { recursive: true });
      await execFileAsync(
        "git",
        ["worktree", "add", "-b", "canonical-review-topic", canonical],
        { cwd: workspace.primary },
      );
      await mkdir(path.join(canonical, ".ephemeral"), { recursive: true });
      const leaseFile = await writeDiscoveryLease(workspace.primary, canonical);
      await rename(canonical, moved);
      await symlink(moved, canonical);
      process.chdir(workspace.physicalPrimary);
      setDiscoveryEnv(workspace.physicalPrimary);

      const result = await runPrReviewLeasesCommand(["discover"]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        disposition: "cleanup-required",
        canonical_worktree: {
          exists: true,
          registered: true,
          dirty: null,
          status: "unleased-canonical",
        },
        resume: null,
        cleanup: { lease_file: leaseFile, reason: "symlink-worktree" },
        active_leases: [
          {
            lease_file: leaseFile,
            status: "cleanup-required",
            reason: "symlink-worktree",
          },
        ],
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects a self-consistently rehashed malformed findings envelope during discovery", async () => {
    await withDiscoveryOnlyApprovedReviewFixture(async (fixture) => {
      await writeFile(
        fixture.findingsPath,
        `${JSON.stringify({
          schema: "play-review/findings/v1",
          findings: [],
          carry_forward: [],
          incomplete_topical_routes: [],
        })}\n`,
      );
      await fixture.rewriteApprovedEvidence();
      await fixture.expectInvalidDiscovery();
    });
  });

  it("rejects a self-consistently rehashed finding outside the selected diff during discovery", async () => {
    await withDiscoveryOnlyApprovedReviewFixture(async (fixture) => {
      await writeFile(
        fixture.findingsPath,
        `${JSON.stringify({
          schema: "play-review/findings/v2",
          findings: [
            {
              path: "README.md",
              line: 1,
              start_line: null,
              severity: "Blocking",
              category: "Logic",
              critic: "VALID",
              anchor: "natural",
              why: "The anchor must be in the selected diff.",
              recommendation: "Keep findings bound to the reviewed range.",
              body: "Out-of-range inline finding.",
            },
          ],
          carry_forward: [],
          incomplete_topical_routes: [],
        })}\n`,
      );
      await fixture.rewriteApprovedEvidence({
        ...fixture.canonicalPayload,
        comments: [
          {
            path: "README.md",
            line: 1,
            side: "RIGHT",
            body: "Out-of-range inline finding.",
          },
        ],
      });
      await fixture.expectInvalidDiscovery();
    });
  });

  it("rejects a self-consistent payload with unbound comments during discovery", async () => {
    await withDiscoveryOnlyApprovedReviewFixture(async (fixture) => {
      await writeFile(fixture.reviewBodyPath, "Rewritten review body.\n");
      await fixture.rewriteApprovedEvidence({
        ...fixture.canonicalPayload,
        body: "Rewritten review body.",
        comments: [
          {
            path: "README.md",
            line: 1,
            side: "RIGHT",
            body: "Self-consistent but unbound comment.",
          },
        ],
      });
      await fixture.expectInvalidDiscovery();
    });
  });

  it("rejects a self-consistently rehashed tampered scope authority during discovery", async () => {
    await withDiscoveryOnlyApprovedReviewFixture(async (fixture) => {
      const scope = JSON.parse(
        await readFile(fixture.scopeDecisionPath, "utf8"),
      ) as Record<string, unknown>;
      scope.semantic_decision = {
        checked: false,
        ambiguous: false,
        notes: "Tampered authority decision.",
      };
      await writeFile(fixture.scopeDecisionPath, `${JSON.stringify(scope)}\n`);
      await fixture.rewriteApprovedEvidence();
      await fixture.expectInvalidDiscovery();
    });
  });

  it.each([
    "arbitrary validated-payload pointer",
    "arbitrary approved-review pointer",
    "wrong approved review head",
    "wrong approved artifact path",
    "validated-payload drift",
    "approved payload digest drift",
    "extra approved-review key",
  ])("rejects %s with an isolated discovery fixture", async (caseName) => {
    await withDiscoveryOnlyApprovedReviewFixture(async (fixture) => {
      const approved = JSON.parse(fixture.originalApproved) as Record<
        string,
        unknown
      >;
      switch (caseName) {
        case "arbitrary validated-payload pointer": {
          const lease = JSON.parse(fixture.originalLease) as {
            artifacts: Record<string, unknown>;
          };
          const arbitrary = `.ephemeral/arbitrary-${fixture.reviewHead}-validated-review-payload.json`;
          await writeFile(
            path.join(fixture.worktreePath, arbitrary),
            fixture.originalValidatedPayload,
          );
          lease.artifacts.validated_payload_file = arbitrary;
          await writeFile(fixture.leasePath, `${JSON.stringify(lease)}\n`);
          break;
        }
        case "arbitrary approved-review pointer": {
          const lease = JSON.parse(fixture.originalLease) as {
            artifacts: Record<string, unknown>;
          };
          const arbitrary = `.ephemeral/arbitrary-${fixture.reviewHead}-approved-review.json`;
          await writeFile(
            path.join(fixture.worktreePath, arbitrary),
            fixture.originalApproved,
          );
          lease.artifacts.approved_review_file = arbitrary;
          await writeFile(fixture.leasePath, `${JSON.stringify(lease)}\n`);
          break;
        }
        case "wrong approved review head":
          approved.review_head_sha = "0".repeat(40);
          await writeFile(
            fixture.approvedPath,
            `${JSON.stringify(approved)}\n`,
          );
          break;
        case "wrong approved artifact path":
          approved.review_payload_file = ".ephemeral/wrong-review-payload.json";
          await writeFile(
            fixture.approvedPath,
            `${JSON.stringify(approved)}\n`,
          );
          break;
        case "validated-payload drift":
          await writeFile(
            fixture.validatedPayloadPath,
            `${JSON.stringify({ ...fixture.canonicalPayload, body: "drift" })}\n`,
          );
          break;
        case "approved payload digest drift":
          approved.review_payload_sha256 = "0".repeat(64);
          await writeFile(
            fixture.approvedPath,
            `${JSON.stringify(approved)}\n`,
          );
          break;
        case "extra approved-review key":
          approved.unexpected = true;
          await writeFile(
            fixture.approvedPath,
            `${JSON.stringify(approved)}\n`,
          );
          break;
      }
      await fixture.expectInvalidDiscovery();
    });
  });

  it("accepts reordered approved-review payload objects during discovery", async () => {
    await withDiscoveryOnlyApprovedReviewFixture(async (fixture) => {
      await fixture.rewriteApprovedEvidence(
        reverseJsonObject(fixture.canonicalPayload) as Record<string, unknown>,
      );
      await fixture.expectTerminalDiscovery();
    });
  });

  it.each(["result", "handoff"])(
    "rejects a result artifact with a foreign declared %s path during discovery",
    async (kind) => {
      await withDiscoveryOnlyApprovedReviewFixture(async (fixture) => {
        const foreign = `.ephemeral/foreign-${kind}.txt`;
        await writeFile(path.join(fixture.worktreePath, foreign), "foreign\n");
        const result = JSON.parse(
          await readFile(fixture.resultPath, "utf8"),
        ) as {
          artifacts: Record<string, unknown>;
          digests: Record<string, unknown>;
        };
        if (kind === "result") {
          result.artifacts.rendered_preview_file = foreign;
          result.digests.rendered_preview_sha256 = await sha256File(
            path.join(fixture.worktreePath, foreign),
          );
        } else {
          result.artifacts.handoff_file = foreign;
        }
        await writeFile(fixture.resultPath, `${JSON.stringify(result)}\n`);
        const lease = JSON.parse(fixture.originalLease) as {
          validation: { result_manifest: { sha256: string } };
        };
        lease.validation.result_manifest.sha256 = await sha256File(
          fixture.resultPath,
        );
        await writeFile(fixture.leasePath, `${JSON.stringify(lease)}\n`);
        await fixture.expectInvalidDiscovery();
      });
    },
  );

  it("rejects a foreign valid-suffix lease handoff pointer during discovery", async () => {
    await withDiscoveryOnlyApprovedReviewFixture(async (fixture) => {
      const foreign = ".ephemeral/foreign-handoff.json";
      await writeFile(path.join(fixture.worktreePath, foreign), "{}\n");
      const lease = JSON.parse(fixture.originalLease) as {
        artifacts: Record<string, unknown>;
      };
      lease.artifacts.handoff_file = foreign;
      await writeFile(fixture.leasePath, `${JSON.stringify(lease)}\n`);
      await fixture.expectInvalidDiscovery();
    });
  });

  it.each([
    {
      name: "dirty",
      prepare: async (canonical: string) => {
        await writeFile(path.join(canonical, "dirty.txt"), "dirty\n");
      },
      reason: "dirty",
    },
    {
      name: "unmanaged",
      prepare: async (canonical: string) => {
        await writeFile(path.join(canonical, ".gitignore"), ".ephemeral/\n");
        await execFileAsync("git", ["add", ".gitignore"], {
          cwd: canonical,
        });
        await execFileAsync("git", ["commit", "-m", "chore: ignore runtime"], {
          cwd: canonical,
        });
        await writeFile(
          path.join(canonical, ".ephemeral", "unmanaged.json"),
          "{}\n",
        );
      },
      reason: "unmanaged-ephemeral-artifacts",
    },
  ])(
    "keeps a canonical $name lease cleanup-required instead of resuming it",
    async ({ prepare, reason }) => {
      const workspace = await makeRegisteredWorkspace(
        "pr-review-discovery-canonical-blocking-",
      );
      const canonical = path.join(
        workspace.physicalPrimary,
        ".worktrees",
        "pr-432-review",
      );

      try {
        await mkdir(path.dirname(canonical), { recursive: true });
        await execFileAsync(
          "git",
          ["worktree", "add", "-b", "canonical-review-topic", canonical],
          { cwd: workspace.primary },
        );
        await mkdir(path.join(canonical, ".ephemeral"), { recursive: true });
        await prepare(canonical);
        const leaseFile = await writeDiscoveryLease(
          workspace.primary,
          canonical,
        );
        process.chdir(workspace.physicalPrimary);
        setDiscoveryEnv(workspace.physicalPrimary);

        const result = await runPrReviewLeasesCommand(["discover"]);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          disposition: "cleanup-required",
          canonical_worktree: { status: "unleased-canonical" },
          resume: null,
          cleanup: { lease_file: leaseFile, reason },
          active_leases: [
            {
              lease_file: leaseFile,
              status: "cleanup-required",
              reason,
            },
          ],
        });
      } finally {
        process.chdir(originalCwd);
        await rm(workspace.tempRoot, { recursive: true, force: true });
      }
    },
  );

  it("keeps a missing but registered canonical target cleanup-required", async () => {
    const workspace = await makeRegisteredWorkspace(
      "pr-review-discovery-canonical-stale-registration-",
    );
    const canonical = path.join(
      workspace.physicalPrimary,
      ".worktrees",
      "pr-432-review",
    );

    try {
      await mkdir(path.dirname(canonical), { recursive: true });
      await execFileAsync(
        "git",
        ["worktree", "add", "-b", "canonical-review-topic", canonical],
        { cwd: workspace.primary },
      );
      await rm(canonical, { recursive: true, force: true });
      process.chdir(workspace.physicalPrimary);
      setDiscoveryEnv(workspace.physicalPrimary);

      const result = await runPrReviewLeasesCommand(["discover"]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        disposition: "cleanup-required",
        canonical_worktree: {
          exists: false,
          registered: true,
          status: "absent",
        },
        resume: null,
        cleanup: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("returns ambiguous for multiple valid active leases without mutation", async () => {
    const workspace = await makeRegisteredWorkspace(
      "pr-review-discovery-ambiguous-",
    );
    const second = path.join(workspace.tempRoot, "second-review");

    try {
      await execFileAsync(
        "git",
        ["worktree", "add", "-b", "second-review-topic", second],
        { cwd: workspace.primary },
      );
      const physicalSecond = await realpath(second);
      await mkdir(path.join(second, ".ephemeral"), { recursive: true });
      await writeDiscoveryLease(workspace.primary, workspace.physicalWorktree);
      await writeDiscoveryLease(workspace.primary, physicalSecond);
      const before = await readFile(
        path.join(workspace.primary, discoveryLeaseFile(physicalSecond)),
        "utf8",
      );
      process.chdir(workspace.physicalPrimary);
      setDiscoveryEnv(workspace.physicalPrimary);

      const result = await runPrReviewLeasesCommand(["discover"]);
      const after = await readFile(
        path.join(workspace.primary, discoveryLeaseFile(physicalSecond)),
        "utf8",
      );
      expect(result.exitCode, result.stderr).toBe(0);
      expect(after).toBe(before);
      expect(JSON.parse(result.stdout)).toMatchObject({
        disposition: "ambiguous",
        resume: null,
        cleanup: null,
        active_leases: [{ status: "resumable" }, { status: "resumable" }],
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("requires lease-gated cleanup for terminal and missing worktrees while ignoring archived leases", async () => {
    const workspace = await makeRegisteredWorkspace(
      "pr-review-discovery-terminal-",
    );

    try {
      const leaseFile = discoveryLeaseFile(workspace.physicalWorktree);
      const terminal = abortedCommandLease(
        leaseFile,
        workspace.physicalWorktree,
        digestLeaseIdentityPath(workspace.physicalWorktree),
      );
      await writeFile(
        path.join(workspace.primary, leaseFile),
        `${JSON.stringify(terminal, null, 2)}\n`,
      );
      process.chdir(workspace.physicalPrimary);
      setDiscoveryEnv(workspace.physicalPrimary);

      let result = await runPrReviewLeasesCommand(["discover"]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        disposition: "cleanup-required",
        active_leases: [{ state: "aborted", status: "terminal" }],
      });

      await execFileAsync(
        "git",
        ["worktree", "remove", "-f", workspace.worktree],
        {
          cwd: workspace.primary,
        },
      );
      result = await runPrReviewLeasesCommand(["discover"]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        disposition: "cleanup-required",
        active_leases: [
          {
            state: "aborted",
            status: "terminal",
            reason: "missing-worktree",
          },
        ],
      });

      const archiveTimestamp = (
        terminal.terminal.finished_at ?? terminal.updated_at
      ).replace(/[-:Z]/gu, "");
      const archivedLeaseFile = `.ephemeral/pr-432-${terminal.worktree_digest}-${archiveTimestamp}-aborted-archived-lease.json`;
      await rename(
        path.join(workspace.primary, leaseFile),
        path.join(workspace.primary, archivedLeaseFile),
      );
      result = await runPrReviewLeasesCommand(["discover"]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        disposition: "create",
        active_leases: [],
        archived_leases: [
          {
            archived_lease_file: archivedLeaseFile,
            state: "aborted",
            status: "valid",
          },
        ],
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when an archived lease filename timestamp disagrees with its terminal lease", async () => {
    const workspace = await makeRegisteredWorkspace(
      "pr-review-discovery-archive-timestamp-",
    );

    try {
      const leaseFile = discoveryLeaseFile(workspace.physicalWorktree);
      const terminal = abortedCommandLease(
        leaseFile,
        workspace.physicalWorktree,
        digestLeaseIdentityPath(workspace.physicalWorktree),
      );
      const archiveFile = `.ephemeral/pr-432-${terminal.worktree_digest}-20260611T000001-aborted-archived-lease.json`;
      await writeFile(
        path.join(workspace.primary, archiveFile),
        `${JSON.stringify(terminal, null, 2)}\n`,
      );
      process.chdir(workspace.physicalPrimary);
      setDiscoveryEnv(workspace.physicalPrimary);

      const result = await runPrReviewLeasesCommand(["discover"]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        disposition: "invalid",
        archived_leases: [
          {
            archived_lease_file: archiveFile,
            status: "invalid",
            reason: "lease-identity-mismatch",
          },
        ],
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "malformed JSON",
      write: async (
        file: string,
        workspace: Awaited<ReturnType<typeof makeRegisteredWorkspace>>,
      ) => {
        await writeFile(file, "{\n");
      },
      reason: "invalid-lease",
    },
    {
      name: "a symlink",
      write: async (
        file: string,
        workspace: Awaited<ReturnType<typeof makeRegisteredWorkspace>>,
      ) => {
        await symlink(workspace.worktree, file);
      },
      reason: "lease-file-symlink",
    },
  ])(
    "fails closed for an archived lease with $name",
    async ({ write, reason }) => {
      const workspace = await makeRegisteredWorkspace(
        "pr-review-discovery-invalid-archived-",
      );
      const archiveFile = path.join(
        workspace.primary,
        `.ephemeral/pr-432-${digestLeaseIdentityPath(workspace.physicalWorktree)}-20260611T000001-aborted-archived-lease.json`,
      );

      try {
        await write(archiveFile, workspace);
        process.chdir(workspace.physicalPrimary);
        setDiscoveryEnv(workspace.physicalPrimary);

        const result = await runPrReviewLeasesCommand(["discover"]);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          disposition: "invalid",
          active_leases: [],
          archived_leases: [
            {
              archived_lease_file: path
                .relative(workspace.primary, archiveFile)
                .replaceAll("\\", "/"),
              status: "invalid",
              reason,
            },
          ],
        });
      } finally {
        process.chdir(originalCwd);
        await rm(workspace.tempRoot, { recursive: true, force: true });
      }
    },
  );

  it("classifies a posted lease with approved-review pointers using discovery-only inputs", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-discovery-approved-review-",
    );

    try {
      const reviewBase = workspace.reviewHead;
      await execFileAsync(
        "git",
        ["commit", "--allow-empty", "-m", "test: approved review evidence"],
        { cwd: workspace.worktree },
      );
      const { stdout: reviewHeadOutput } = await execFileAsync("git", [
        "-C",
        workspace.worktree,
        "rev-parse",
        "HEAD",
      ]);
      workspace.reviewHead = reviewHeadOutput.trim();
      workspace.resultFile = `.ephemeral/pr-432-${workspace.reviewHead}-result.json`;
      await rm(path.join(workspace.worktree, ".ephemeral"), {
        recursive: true,
        force: true,
      });
      await mkdir(path.join(workspace.worktree, ".ephemeral"), {
        recursive: true,
      });
      const { findingsFile } = await writeResultArtifact(
        workspace.worktree,
        workspace.physicalWorktree,
        workspace.resultFile,
        workspace.reviewHead,
        "preview-current",
        true,
        reviewBase,
      );
      workspace.findingsFile = findingsFile;
      workspace.resultSha256 = await sha256File(
        path.join(workspace.worktree, workspace.resultFile),
      );
      const approvedReviewFile = `.ephemeral/review-topic-${workspace.reviewHead}-approved-review.json`;
      const reviewPayloadFile = `.ephemeral/review-topic-${workspace.reviewHead}-review-payload.json`;
      const canonicalPayload = {
        ...reviewPayload(workspace.reviewHead),
        body: "Review preview.",
      };
      await writeFile(
        path.join(workspace.primary, ".git", "info", "exclude"),
        ".ephemeral/\n",
      );
      await writeFile(
        path.join(workspace.worktree, reviewPayloadFile),
        `${JSON.stringify(canonicalPayload)}\n`,
      );
      const resultArtifact = JSON.parse(
        await readFile(
          path.join(workspace.worktree, workspace.resultFile),
          "utf8",
        ),
      ) as {
        artifacts: { scope_decision_file: string };
        findings_file: string;
        review_body_file: string;
      };
      await writeFile(
        path.join(workspace.worktree, approvedReviewFile),
        `${JSON.stringify({
          schema: "pr-review/approved-review/v1",
          review_head_sha: workspace.reviewHead,
          findings_file: resultArtifact.findings_file,
          review_body_file: resultArtifact.review_body_file,
          review_payload_file: reviewPayloadFile,
          scope_decision_file: resultArtifact.artifacts.scope_decision_file,
          findings_sha256: await sha256File(
            path.join(workspace.worktree, resultArtifact.findings_file),
          ),
          review_body_sha256: await sha256File(
            path.join(workspace.worktree, resultArtifact.review_body_file),
          ),
          review_payload_sha256: await sha256File(
            path.join(workspace.worktree, reviewPayloadFile),
          ),
          scope_decision_sha256: await sha256File(
            path.join(
              workspace.worktree,
              resultArtifact.artifacts.scope_decision_file,
            ),
          ),
          payload: canonicalPayload,
        })}\n`,
      );
      const validatedPayloadFile = `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`;
      await writeFile(
        path.join(workspace.worktree, validatedPayloadFile),
        `${JSON.stringify(canonicalPayload)}\n`,
      );
      const posted = postedCommandLease({
        leaseFile: workspace.leaseFile,
        worktreePath: workspace.physicalWorktree,
        worktreeDigest: workspace.worktreeDigest,
        resultFile: workspace.resultFile,
        resultSha256: workspace.resultSha256,
        approvedReviewFile,
        validatedPayloadFile,
      });
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(posted, null, 2)}\n`,
      );
      process.chdir(workspace.physicalPrimary);
      setDiscoveryEnv(workspace.physicalPrimary);
      process.env.PR_REVIEW_DIR = undefined;
      process.env.PR_REVIEW_MANIFEST_HELPER_SCRIPT = undefined;
      process.env.PR_REVIEW_LEASE_HELPER_SCRIPT = undefined;
      process.env.PLAY_REVIEW_HELPER = undefined;

      process.chdir(workspace.physicalWorktree);
      const compared = await runReviewArtifactsCommand([
        "compare-approved-payload",
        "--surface",
        "pr-review",
        "--head-sha",
        workspace.reviewHead,
        "--base-ref",
        reviewBase,
        "--scope-decision-file",
        resultArtifact.artifacts.scope_decision_file,
        "--provider-scope-evidence-file",
        `.ephemeral/review-topic-${workspace.reviewHead}-provider-scope-evidence.json`,
        "--expected-schema",
        "pr-review/scope-decision/v1",
        "--expected-prior-context-kind",
        "none",
        "--expected-prior-context-path",
        "null",
        "--governed-path-pattern",
        "^(docs/(adr|arch|product-requirements|specs|guidelines)/|MAP\\.md$|AGENTS\\.md$|CONTRIBUTING\\.md$)",
        "--configured-path-pattern",
        "^$",
        "--max-narrow-changed-files",
        "5",
        "--allow-ambiguous-full-escalation",
        "true",
        "--findings-file",
        resultArtifact.findings_file,
        "--review-body-file",
        resultArtifact.review_body_file,
        "--review-event",
        "COMMENT",
        "--review-payload-file",
        reviewPayloadFile,
      ]);
      expect(compared.exitCode, compared.stderr).toBe(0);
      expect(JSON.parse(compared.stdout)).toEqual(canonicalPayload);
      process.chdir(workspace.physicalPrimary);

      const result = await runPrReviewLeasesCommand(["discover"]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        disposition: "cleanup-required",
        active_leases: [
          {
            lease_file: workspace.leaseFile,
            state: "posted",
            status: "terminal",
            reason: "terminal-lease",
          },
        ],
        cleanup: { lease_file: workspace.leaseFile, reason: "terminal-lease" },
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "legacy cleanup metadata without removed_at",
      cleanup: {
        last_outcome: "removed" as const,
        last_checked_at: "2026-06-11T00:03:00Z",
      },
      disposition: "cleanup-required",
      status: "terminal",
    },
    {
      name: "malformed removed_at metadata",
      cleanup: {
        last_outcome: "removed" as const,
        last_checked_at: "2026-06-11T00:03:00Z",
        removed_at: "not-a-timestamp",
      },
      disposition: "invalid",
      status: "invalid",
    },
    {
      name: "a removal timestamp later than its last cleanup observation",
      cleanup: {
        last_outcome: "removed" as const,
        last_checked_at: "2026-06-11T00:03:00Z",
        removed_at: "2026-06-11T00:03:01Z",
      },
      disposition: "cleanup-required",
      status: "terminal",
    },
  ])(
    "does not grant post-cleanup recreation for $name",
    async ({ cleanup, disposition, status }) => {
      const workspace = await makeRegisteredWorkspace(
        "pr-review-discovery-incomplete-cleanup-",
      );

      try {
        const leaseFile = discoveryLeaseFile(workspace.physicalWorktree);
        const terminal = {
          ...abortedCommandLease(
            leaseFile,
            workspace.physicalWorktree,
            digestLeaseIdentityPath(workspace.physicalWorktree),
          ),
          cleanup,
        };
        await writeFile(
          path.join(workspace.primary, leaseFile),
          `${JSON.stringify(terminal, null, 2)}\n`,
        );
        process.chdir(workspace.physicalPrimary);
        setDiscoveryEnv(workspace.physicalPrimary);

        const result = await runPrReviewLeasesCommand(["discover"]);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          disposition,
          active_leases: [{ status }],
        });
      } finally {
        process.chdir(originalCwd);
        await rm(workspace.tempRoot, { recursive: true, force: true });
      }
    },
  );

  it("keeps another blocking terminal lease cleanup-required beside a post-cleanup terminal", async () => {
    const workspace = await makeRegisteredWorkspace(
      "pr-review-discovery-post-cleanup-coexistence-",
    );
    const second = path.join(workspace.tempRoot, "second-review");

    try {
      await execFileAsync(
        "git",
        ["worktree", "add", "-b", "second-review-topic", second],
        { cwd: workspace.primary },
      );
      const physicalSecond = await realpath(second);
      const archiveEligibleFile = discoveryLeaseFile(
        workspace.physicalWorktree,
      );
      const blockingFile = discoveryLeaseFile(physicalSecond);
      const archiveEligible = {
        ...abortedCommandLease(
          archiveEligibleFile,
          workspace.physicalWorktree,
          digestLeaseIdentityPath(workspace.physicalWorktree),
        ),
        cleanup: {
          last_outcome: "removed" as const,
          last_checked_at: "2026-06-11T00:03:00Z",
          removed_at: "2026-06-11T00:03:00Z",
        },
      };
      const blocking = abortedCommandLease(
        blockingFile,
        physicalSecond,
        digestLeaseIdentityPath(physicalSecond),
      );
      await writeFile(
        path.join(workspace.primary, archiveEligibleFile),
        `${JSON.stringify(archiveEligible, null, 2)}\n`,
      );
      await writeFile(
        path.join(workspace.primary, blockingFile),
        `${JSON.stringify(blocking, null, 2)}\n`,
      );
      process.chdir(workspace.physicalPrimary);
      setDiscoveryEnv(workspace.physicalPrimary);

      const result = await runPrReviewLeasesCommand(["discover"]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        disposition: "cleanup-required",
        active_leases: [{ status: "terminal" }, { status: "terminal" }],
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("does not resume when a cleanup-required terminal lease accompanies one resumable lease", async () => {
    const workspace = await makeRegisteredWorkspace(
      "pr-review-discovery-resume-cleanup-precedence-",
    );
    const second = path.join(workspace.tempRoot, "second-review");

    try {
      await execFileAsync(
        "git",
        ["worktree", "add", "-b", "second-review-topic", second],
        { cwd: workspace.primary },
      );
      const physicalSecond = await realpath(second);
      await mkdir(path.join(second, ".ephemeral"), { recursive: true });
      const resumableFile = await writeDiscoveryLease(
        workspace.primary,
        workspace.physicalWorktree,
      );
      const blockingFile = discoveryLeaseFile(physicalSecond);
      await writeFile(
        path.join(workspace.primary, blockingFile),
        `${JSON.stringify(
          abortedCommandLease(
            blockingFile,
            physicalSecond,
            digestLeaseIdentityPath(physicalSecond),
          ),
          null,
          2,
        )}\n`,
      );
      process.chdir(workspace.physicalPrimary);
      setDiscoveryEnv(workspace.physicalPrimary);

      const result = await runPrReviewLeasesCommand(["discover"]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        disposition: "cleanup-required",
        resume: null,
        cleanup: {
          lease_file: blockingFile,
          reason: "terminal-lease",
        },
      });
      expect(JSON.parse(result.stdout).active_leases).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            lease_file: resumableFile,
            status: "resumable",
          }),
          expect.objectContaining({
            lease_file: blockingFile,
            status: "terminal",
            reason: "terminal-lease",
          }),
        ]),
      );
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("reports terminal, missing, dirty, unmanaged, invalid, and unleased canonical cases distinctly", async () => {
    const workspace = await makeRegisteredWorkspace(
      "pr-review-discovery-classify-",
    );

    try {
      const leaseFile = await writeDiscoveryLease(
        workspace.primary,
        workspace.physicalWorktree,
      );
      await writeFile(path.join(workspace.worktree, "dirty.txt"), "dirty\n");
      await writeFile(
        path.join(workspace.worktree, ".ephemeral", "unmanaged.json"),
        "{}\n",
      );
      await writeFile(
        path.join(workspace.primary, ".ephemeral", "pr-432-bad-lease.json"),
        "{}\n",
      );
      await mkdir(path.join(workspace.primary, ".worktrees"), {
        recursive: true,
      });
      await mkdir(path.join(workspace.primary, ".worktrees", "pr-432-review"));
      process.chdir(workspace.physicalPrimary);
      setDiscoveryEnv(workspace.physicalPrimary);

      const result = await runPrReviewLeasesCommand(["discover"]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        disposition: "invalid",
        canonical_worktree: { status: "unleased-canonical" },
        invalid_lease_files: [
          {
            lease_file: ".ephemeral/pr-432-bad-lease.json",
            reason: "malformed-lease-path",
          },
        ],
        active_leases: [
          {
            lease_file: leaseFile,
            status: "cleanup-required",
            reason: "dirty",
            worktree: {
              dirty: true,
              unmanaged_ephemeral_artifacts: [".ephemeral/unmanaged.json"],
            },
          },
        ],
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });
});

describe("pr-review lease Git cleanup safety", () => {
  it("reports missing worktrees as skipped cleanup when lease identity matches", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeRegisteredWorkspace("pr-review-missing-worktree-");

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(
          abortedCommandLease(
            leaseFile,
            physicalWorktree,
            dynamicIdentity.worktreeDigest,
          ),
          null,
          2,
        )}\n`,
      );
      await rm(worktree, { recursive: true, force: true });

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["cleanup-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("OUTCOME=skipped");
      expect(result.stdout).toContain("REFUSAL_REASON=missing-worktree");
      expect(result.stdout).toContain("METADATA_OUTCOME=skipped");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("records skipped cleanup metadata for missing terminal worktrees with historical result pointers", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-missing-terminal-result-cleanup-",
    );

    try {
      const posted = postedCommandLease({
        leaseFile: workspace.leaseFile,
        worktreePath: workspace.physicalWorktree,
        worktreeDigest: workspace.worktreeDigest,
        resultFile: workspace.resultFile,
        resultSha256: workspace.resultSha256,
        approvedReviewFile: `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`,
        validatedPayloadFile: `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`,
      });
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(posted, null, 2)}\n`,
      );
      await rm(workspace.worktree, { recursive: true, force: true });

      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      process.env.LEASE_FILE = workspace.leaseFile;
      const result = await runPrReviewLeasesCommand(["cleanup-worktree"]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain("OUTCOME=skipped");
      expect(result.stdout).toContain("REFUSAL_REASON=missing-worktree");
      expect(result.stdout).toContain("METADATA_OUTCOME=skipped");

      const lease = await readLease(workspace.primary, workspace.leaseFile);
      expect(lease.artifacts.result_file).toBe(workspace.resultFile);
      expect(lease.validation.result_manifest.sha256).toBe(
        workspace.resultSha256,
      );
      expect(lease.cleanup?.last_outcome).toBe("skipped");
      expect(lease.cleanup?.last_checked_at).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u,
      );
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects archive-on-recreate writes without authority before nested artifact validation", async () => {
    for (const state of ["posted", "aborted"] as const) {
      const workspace = await makeGatedStatusWorkspace(
        `pr-review-${state}-archive-nested-drift-`,
      );

      try {
        process.chdir(workspace.physicalPrimary);
        const prior =
          state === "posted"
            ? postedCommandLease({
                leaseFile: workspace.leaseFile,
                worktreePath: workspace.physicalWorktree,
                worktreeDigest: workspace.worktreeDigest,
                resultFile: workspace.resultFile,
                resultSha256: workspace.resultSha256,
                approvedReviewFile: `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`,
                validatedPayloadFile: `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`,
              })
            : {
                ...withCanonicalHandoffPointer(
                  await readLease(workspace.primary, workspace.leaseFile),
                ),
                state: "aborted" as const,
                updated_at: "2026-06-11T00:03:00Z",
                terminal: {
                  finished_at: "2026-06-11T00:03:00Z",
                  reason: "user-aborted",
                },
              };
        if (state === "posted") {
          await writeApprovedReviewArtifact(
            workspace.worktree,
            prior.artifacts.approved_review_file ?? "",
            workspace.reviewHead,
          );
          await writeValidatedPayloadArtifact(
            workspace.worktree,
            workspace.reviewHead,
          );
        }
        await writeFile(
          path.join(workspace.primary, workspace.leaseFile),
          `${JSON.stringify(prior, null, 2)}\n`,
        );
        const before = await readFile(
          path.join(workspace.primary, workspace.leaseFile),
          "utf8",
        );
        await mutateNestedFindingsWithoutUpdatingResult(workspace);

        setLeaseCommandEnv(
          workspace.physicalPrimary,
          workspace.physicalWorktree,
        );
        process.env.LEASE_FILE = workspace.leaseFile;
        process.env.STATE = "created";
        process.env.BASE_REF = "main";
        process.env.HEAD_REF = "topic";
        process.env.CREATED_AT = "2026-06-11T00:04:00Z";
        process.env.UPDATED_AT = "2026-06-11T00:04:00Z";
        process.env.PR_REVIEW_DIR = workspace.prReviewDir;
        process.env.PR_REVIEW_MANIFEST_HELPER_SCRIPT =
          workspace.prReviewManifestHelperScript;
        process.env.PR_REVIEW_LEASE_HELPER_SCRIPT =
          workspace.prReviewLeaseHelperScript;
        process.env.PLAY_REVIEW_HELPER = workspace.playReviewHelper;

        const result = await runPrReviewLeasesCommand(["write"]);
        expect(result.exitCode, state).toBe(1);
        expect(result.stderr, state).toContain(
          "LC-18 requires recorded post-cleanup archive authority",
        );
        await expect(
          readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
        ).resolves.toBe(before);
        const archived = await readdir(
          path.join(workspace.primary, ".ephemeral"),
        );
        expect(
          archived.some((entry) => entry.includes("-archived-lease.json")),
        ).toBe(false);
      } finally {
        process.chdir(originalCwd);
        await rm(workspace.tempRoot, { recursive: true, force: true });
      }
    }
  });

  it.each(["posted", "aborted"] as const)(
    "archives helper-recorded removed $state terminal leases before fresh creation",
    async (state) => {
      const workspace = await makeGatedStatusWorkspace(
        `pr-review-${state}-archive-after-cleanup-`,
        { canonicalWorktree: true },
      );

      try {
        const prior =
          state === "posted"
            ? postedCommandLease({
                leaseFile: workspace.leaseFile,
                worktreePath: workspace.physicalWorktree,
                worktreeDigest: workspace.worktreeDigest,
                resultFile: workspace.resultFile,
                resultSha256: workspace.resultSha256,
                approvedReviewFile: `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`,
                validatedPayloadFile: `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`,
              })
            : {
                ...withCanonicalHandoffPointer(
                  await readLease(workspace.primary, workspace.leaseFile),
                ),
                state: "aborted" as const,
                updated_at: "2026-06-11T00:03:00Z",
                terminal: {
                  finished_at: "2026-06-11T00:03:00Z",
                  reason: "user-aborted",
                },
              };
        if (state === "posted") {
          await writeApprovedReviewArtifact(
            workspace.worktree,
            prior.artifacts.approved_review_file ?? "",
            workspace.reviewHead,
          );
          await writeValidatedPayloadArtifact(
            workspace.worktree,
            workspace.reviewHead,
          );
        }
        await writeFile(
          path.join(workspace.primary, workspace.leaseFile),
          `${JSON.stringify(prior, null, 2)}\n`,
        );
        await writeFile(
          path.join(workspace.primary, ".git", "info", "exclude"),
          ".ephemeral/\n",
        );
        process.chdir(workspace.physicalPrimary);
        setReadStatusEnv(workspace);
        const cleanup = await runPrReviewLeasesCommand(["cleanup-worktree"]);
        expect(cleanup.exitCode, state).toBe(0);
        expect(cleanup.stdout, state).toContain("OUTCOME=removed");
        const removedLease = await readLease(
          workspace.primary,
          workspace.leaseFile,
        );
        expect(removedLease.cleanup).toMatchObject({ last_outcome: "removed" });
        expect(removedLease.cleanup?.removed_at).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u,
        );
        const removedAt = removedLease.cleanup?.removed_at;
        const retry = await runPrReviewLeasesCommand(["cleanup-worktree"]);
        expect(retry.exitCode, state).toBe(0);
        expect(retry.stdout, state).toContain("OUTCOME=skipped");
        const retriedLease = await readLease(
          workspace.primary,
          workspace.leaseFile,
        );
        expect(retriedLease.cleanup).toMatchObject({
          last_outcome: "skipped",
          removed_at: removedAt,
        });

        setDiscoveryEnv(workspace.physicalPrimary);
        const discovery = await runPrReviewLeasesCommand(["discover"]);
        expect(discovery.exitCode, state).toBe(0);
        expect(JSON.parse(discovery.stdout)).toMatchObject({
          disposition: "create",
          active_leases: [
            {
              state,
              status: "terminal",
              reason: "missing-worktree",
            },
          ],
        });
        await execFileAsync(
          "git",
          ["worktree", "add", workspace.worktree, "review-topic"],
          { cwd: workspace.primary },
        );

        process.chdir(workspace.physicalPrimary);
        setLeaseCommandEnv(
          workspace.physicalPrimary,
          workspace.physicalWorktree,
        );
        process.env.LEASE_FILE = workspace.leaseFile;
        process.env.STATE = "created";
        process.env.BASE_REF = "main";
        process.env.HEAD_REF = "topic";
        process.env.CREATED_AT = "2026-06-11T00:04:00Z";
        process.env.UPDATED_AT = "2026-06-11T00:04:00Z";

        const result = await runPrReviewLeasesCommand(["write"]);
        expect(result.exitCode, state).toBe(0);
        const fresh = await readLease(workspace.primary, workspace.leaseFile);
        expect(fresh).toMatchObject({
          state: "created",
          artifacts: {
            handoff_file: null,
            result_file: null,
            approved_review_file: null,
            validated_payload_file: null,
          },
        });
        expect("cleanup" in fresh).toBe(false);
        const entries = await readdir(
          path.join(workspace.primary, ".ephemeral"),
        );
        expect(
          entries.some((entry) =>
            entry.includes(`-${state}-archived-lease.json`),
          ),
        ).toBe(true);
      } finally {
        process.chdir(originalCwd);
        await rm(workspace.tempRoot, { recursive: true, force: true });
      }
    },
  );

  it("does not recreate an alternate removed terminal lease at the canonical path", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-alternate-removed-terminal-",
    );

    try {
      const prior = {
        ...withCanonicalHandoffPointer(
          await readLease(workspace.primary, workspace.leaseFile),
        ),
        state: "aborted" as const,
        updated_at: "2026-06-11T00:03:00Z",
        terminal: {
          finished_at: "2026-06-11T00:03:00Z",
          reason: "user-aborted",
        },
      };
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(prior, null, 2)}\n`,
      );
      await writeFile(
        path.join(workspace.primary, ".git", "info", "exclude"),
        ".ephemeral/\n",
      );
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const cleanup = await runPrReviewLeasesCommand(["cleanup-worktree"]);
      expect(cleanup.exitCode, cleanup.stderr).toBe(0);
      expect(cleanup.stdout).toContain("OUTCOME=removed");

      setDiscoveryEnv(workspace.physicalPrimary);
      const discovery = await runPrReviewLeasesCommand(["discover"]);
      expect(discovery.exitCode, discovery.stderr).toBe(0);
      expect(JSON.parse(discovery.stdout)).toMatchObject({
        disposition: "cleanup-required",
        cleanup: {
          lease_file: workspace.leaseFile,
          reason: "missing-worktree",
        },
      });
      const entries = await readdir(path.join(workspace.primary, ".ephemeral"));
      expect(
        entries.some((entry) => entry.includes("-archived-lease.json")),
      ).toBe(false);
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects legacy removed cleanup observations before archive validation", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-legacy-cleanup-authority-",
    );

    try {
      const lease = await readLease(workspace.primary, workspace.leaseFile);
      const legacy = {
        ...lease,
        state: "aborted" as const,
        updated_at: "2026-06-11T00:03:00Z",
        terminal: {
          finished_at: "2026-06-11T00:03:00Z",
          reason: "user-aborted",
        },
        cleanup: {
          last_outcome: "removed" as const,
          last_checked_at: "2026-06-11T00:03:00Z",
        },
      };
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(legacy, null, 2)}\n`,
      );
      const before = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );
      await execFileAsync(
        "git",
        ["worktree", "remove", "-f", workspace.worktree],
        { cwd: workspace.primary },
      );
      await execFileAsync(
        "git",
        ["worktree", "add", workspace.worktree, "review-topic"],
        { cwd: workspace.primary },
      );

      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      process.env.LEASE_FILE = workspace.leaseFile;
      process.env.STATE = "created";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.CREATED_AT = "2026-06-11T00:04:00Z";
      process.env.UPDATED_AT = "2026-06-11T00:04:00Z";

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "LC-18 requires recorded post-cleanup archive authority",
      );
      await expect(
        readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
      ).resolves.toBe(before);
      const entries = await readdir(path.join(workspace.primary, ".ephemeral"));
      expect(
        entries.some((entry) => entry.includes("-archived-lease.json")),
      ).toBe(false);
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "legacy cleanup metadata without removed_at",
      cleanup: {
        last_outcome: "removed" as const,
        last_checked_at: "2026-06-11T00:03:00Z",
      },
    },
    {
      name: "a removal timestamp later than its last cleanup observation",
      cleanup: {
        last_outcome: "removed" as const,
        last_checked_at: "2026-06-11T00:03:00Z",
        removed_at: "2026-06-11T00:03:01Z",
      },
    },
  ])(
    "rejects artifact-free aborted LC-18 writes without authority for $name",
    async ({ cleanup }) => {
      const workspace = await makeRegisteredWorkspace(
        "pr-review-lc18-missing-authority-",
      );

      try {
        const leaseFile = discoveryLeaseFile(workspace.physicalWorktree);
        const prior = {
          ...abortedCommandLease(
            leaseFile,
            workspace.physicalWorktree,
            digestLeaseIdentityPath(workspace.physicalWorktree),
          ),
          cleanup,
        };
        await writeFile(
          path.join(workspace.primary, leaseFile),
          `${JSON.stringify(prior, null, 2)}\n`,
        );
        const before = await readFile(
          path.join(workspace.primary, leaseFile),
          "utf8",
        );
        process.chdir(workspace.physicalPrimary);
        setLeaseCommandEnv(
          workspace.physicalPrimary,
          workspace.physicalWorktree,
        );
        process.env.LEASE_FILE = leaseFile;
        process.env.STATE = "created";
        process.env.BASE_REF = "main";
        process.env.HEAD_REF = "topic";
        process.env.CREATED_AT = "2026-06-11T00:04:00Z";
        process.env.UPDATED_AT = "2026-06-11T00:04:00Z";

        const result = await runPrReviewLeasesCommand(["write"]);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(
          "LC-18 requires recorded post-cleanup archive authority",
        );
        await expect(
          readFile(path.join(workspace.primary, leaseFile), "utf8"),
        ).resolves.toBe(before);
        const entries = await readdir(
          path.join(workspace.primary, ".ephemeral"),
        );
        expect(
          entries.some((entry) => entry.includes("-archived-lease.json")),
        ).toBe(false);
      } finally {
        process.chdir(originalCwd);
        await rm(workspace.tempRoot, { recursive: true, force: true });
      }
    },
  );

  it.each([
    {
      name: "an invalid cleanup timestamp",
      mutate: (lease: Record<string, unknown>) => {
        lease.cleanup = {
          last_outcome: "removed",
          last_checked_at: "2026-06-11T00:03:00Z",
          removed_at: "not-a-timestamp",
        };
      },
    },
    {
      name: "an extra cleanup key",
      mutate: (lease: Record<string, unknown>) => {
        lease.cleanup = {
          last_outcome: "removed",
          last_checked_at: "2026-06-11T00:03:00Z",
          removed_at: "2026-06-11T00:03:00Z",
          unexpected: true,
        };
      },
    },
    {
      name: "a malformed terminal object",
      mutate: (lease: Record<string, unknown>) => {
        lease.terminal = {
          finished_at: "not-a-timestamp",
          reason: "user-aborted",
        };
        lease.cleanup = {
          last_outcome: "removed",
          last_checked_at: "2026-06-11T00:03:00Z",
          removed_at: "2026-06-11T00:03:00Z",
        };
      },
    },
    {
      name: "an extra terminal key",
      mutate: (lease: Record<string, unknown>) => {
        lease.terminal = {
          finished_at: "2026-06-11T00:03:00Z",
          reason: "user-aborted",
          unexpected: true,
        };
        lease.cleanup = {
          last_outcome: "removed",
          last_checked_at: "2026-06-11T00:03:00Z",
          removed_at: "2026-06-11T00:03:00Z",
        };
      },
    },
    {
      name: "an extra top-level key",
      mutate: (lease: Record<string, unknown>) => {
        lease.unexpected = true;
        lease.cleanup = {
          last_outcome: "removed",
          last_checked_at: "2026-06-11T00:03:00Z",
          removed_at: "2026-06-11T00:03:00Z",
        };
      },
    },
    {
      name: "a non-string terminal timestamp",
      mutate: (lease: Record<string, unknown>) => {
        lease.terminal = { finished_at: 1, reason: "user-aborted" };
        lease.cleanup = {
          last_outcome: "removed",
          last_checked_at: "2026-06-11T00:03:00Z",
          removed_at: "2026-06-11T00:03:00Z",
        };
      },
    },
    {
      name: "an invalid aborted terminal reason",
      mutate: (lease: Record<string, unknown>) => {
        lease.terminal = {
          finished_at: "2026-06-11T00:03:00Z",
          reason: "",
        };
        lease.cleanup = {
          last_outcome: "removed",
          last_checked_at: "2026-06-11T00:03:00Z",
          removed_at: "2026-06-11T00:03:00Z",
        };
      },
    },
    {
      name: "a malformed nested GitHub object",
      mutate: (lease: Record<string, unknown>) => {
        lease.github = {
          github_post_attempted: "false",
          github_post_result: "not-attempted",
          github_posted_at: null,
        };
        lease.cleanup = {
          last_outcome: "removed",
          last_checked_at: "2026-06-11T00:03:00Z",
          removed_at: "2026-06-11T00:03:00Z",
        };
      },
    },
  ])(
    "rejects LC-18 atomically before consulting authority for $name",
    async ({ mutate }) => {
      const workspace = await makeRegisteredWorkspace(
        "pr-review-lc18-invalid-terminal-shape-",
      );

      try {
        const leaseFile = discoveryLeaseFile(workspace.physicalWorktree);
        const prior = JSON.parse(
          JSON.stringify(
            abortedCommandLease(
              leaseFile,
              workspace.physicalWorktree,
              digestLeaseIdentityPath(workspace.physicalWorktree),
            ),
          ),
        ) as Record<string, unknown>;
        mutate(prior);
        await writeFile(
          path.join(workspace.primary, leaseFile),
          `${JSON.stringify(prior, null, 2)}\n`,
        );
        const before = await readFile(
          path.join(workspace.primary, leaseFile),
          "utf8",
        );
        process.chdir(workspace.physicalPrimary);
        setLeaseCommandEnv(
          workspace.physicalPrimary,
          workspace.physicalWorktree,
        );
        process.env.LEASE_FILE = leaseFile;
        process.env.STATE = "created";
        process.env.BASE_REF = "main";
        process.env.HEAD_REF = "topic";
        process.env.CREATED_AT = "2026-06-11T00:04:00Z";
        process.env.UPDATED_AT = "2026-06-11T00:04:00Z";

        const result = await runPrReviewLeasesCommand(["write"]);
        expect(result.exitCode).toBe(1);
        await expect(
          readFile(path.join(workspace.primary, leaseFile), "utf8"),
        ).resolves.toBe(before);
        const entries = await readdir(
          path.join(workspace.primary, ".ephemeral"),
        );
        expect(
          entries.some((entry) => entry.includes("-archived-lease.json")),
        ).toBe(false);
      } finally {
        process.chdir(originalCwd);
        await rm(workspace.tempRoot, { recursive: true, force: true });
      }
    },
  );

  it("keeps post-removal metadata writes outside git-removal failure handling", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/runtime/pr-review-leases.ts"),
      "utf8",
    );
    const cleanupStart = source.indexOf("async function cleanupWorktree()");
    const cleanupEnd = source.indexOf(
      "\nfunction shouldRecordCleanupMetadata",
      cleanupStart,
    );
    const cleanupSource = source.slice(cleanupStart, cleanupEnd);
    const removalCall = cleanupSource.indexOf(
      'await execFileAsync("git", args);',
    );
    const removalCatch = cleanupSource.indexOf("  } catch {", removalCall);
    const postRemovalSuccessPath = cleanupSource.indexOf(
      "\n\n  if (shouldRecordCleanupMetadata(decision)) {",
      removalCatch,
    );
    const removedMetadata = cleanupSource.indexOf(
      '"removed",\n      false,',
      postRemovalSuccessPath,
    );

    expect(cleanupStart).toBeGreaterThan(-1);
    expect(cleanupEnd).toBeGreaterThan(cleanupStart);
    expect(removalCall).toBeGreaterThan(-1);
    expect(removalCatch).toBeGreaterThan(removalCall);
    expect(postRemovalSuccessPath).toBeGreaterThan(removalCatch);
    expect(removedMetadata).toBeGreaterThan(postRemovalSuccessPath);
  });

  it("skips cleanup targets that are clean separate clones, not registered worktrees", async () => {
    const { tempRoot, primary, physicalPrimary } =
      await makeRegisteredWorkspace("pr-review-separate-clone-");
    const separateClone = path.join(tempRoot, "separate-clone");

    try {
      await execFileAsync("git", ["clone", primary, separateClone]);
      const physicalSeparateClone = await realpath(separateClone);
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalSeparateClone);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalSeparateClone,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(
          abortedCommandLease(
            leaseFile,
            physicalSeparateClone,
            dynamicIdentity.worktreeDigest,
          ),
          null,
          2,
        )}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["cleanup-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("OUTCOME=skipped");
      expect(result.stdout).toContain("REFUSAL_REASON=not-registered-worktree");
      expect(result.stdout).toContain("METADATA_OUTCOME=skipped");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("records skipped cleanup metadata for unregistered terminal worktrees with historical result pointers", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-unregistered-terminal-result-cleanup-",
    );

    try {
      const posted = postedCommandLease({
        leaseFile: workspace.leaseFile,
        worktreePath: workspace.physicalWorktree,
        worktreeDigest: workspace.worktreeDigest,
        resultFile: workspace.resultFile,
        resultSha256: workspace.resultSha256,
        approvedReviewFile: `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`,
        validatedPayloadFile: `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`,
      });
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(posted, null, 2)}\n`,
      );
      await execFileAsync(
        "git",
        ["worktree", "remove", "--force", "worktree"],
        { cwd: workspace.primary },
      );
      await mkdir(path.join(workspace.worktree, ".ephemeral"), {
        recursive: true,
      });

      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      process.env.LEASE_FILE = workspace.leaseFile;
      const result = await runPrReviewLeasesCommand(["cleanup-worktree"]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain("OUTCOME=skipped");
      expect(result.stdout).toContain("REFUSAL_REASON=not-registered-worktree");
      expect(result.stdout).toContain("METADATA_OUTCOME=skipped");

      const lease = await readLease(workspace.primary, workspace.leaseFile);
      expect(lease.artifacts.result_file).toBe(workspace.resultFile);
      expect(lease.validation.result_manifest.sha256).toBe(
        workspace.resultSha256,
      );
      expect(lease.cleanup?.last_outcome).toBe("skipped");
      expect(lease.cleanup?.last_checked_at).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u,
      );
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("retains cleanup targets when git status inspection fails", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeRegisteredWorkspace("pr-review-status-cleanup-failure-");

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(
          abortedCommandLease(
            leaseFile,
            physicalWorktree,
            dynamicIdentity.worktreeDigest,
          ),
          null,
          2,
        )}\n`,
      );
      await rm(path.join(worktree, ".git"), {
        recursive: true,
        force: true,
      });

      process.env.LEASE_FILE = leaseFile;
      let result = await runPrReviewLeasesCommand(["inspect-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        "REFUSAL_REASON=status-inspection-failed",
      );
      expect(result.stdout).toContain("OUTCOME=inspect");

      result = await runPrReviewLeasesCommand(["cleanup-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("OUTCOME=retained");
      expect(result.stdout).toContain(
        "REFUSAL_REASON=status-inspection-failed",
      );
      expect(result.stdout).toContain("METADATA_OUTCOME=retained");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("refuses cleanup metadata rewrites when nested result artifact digests drift", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-cleanup-nested-drift-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const before = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );
      await mutateNestedFindingsWithoutUpdatingResult(workspace);

      const result = await runPrReviewLeasesCommand(["inspect-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("REFUSAL_REASON=invalid-lease");
      await expect(
        readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
      ).resolves.toBe(before);
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("treats provider scope evidence referenced by valid result chains as owned", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-owned-provider-evidence-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);

      const result = await runPrReviewLeasesCommand(["inspect-worktree"]);

      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).not.toContain(
        "REFUSAL_REASON=unmanaged-ephemeral-artifacts",
      );
      expect(result.stdout).not.toContain("provider-scope-evidence.json");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("refuses cleanup when ignored worktree ephemeral artifacts are unmanaged", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeRegisteredWorkspace("pr-review-cleanup-");
    await writeFile(path.join(worktree, ".ephemeral/unmanaged.txt"), "keep\n");

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      const lease: PrReviewLease = {
        schema: "pr-review/lease/v1",
        repository: "owner/repo",
        pr_number: 432,
        state: "aborted",
        base_ref: "main",
        head_ref: "topic",
        worktree_path: canonicalLeaseIdentityPath(physicalWorktree),
        worktree_digest: dynamicIdentity.worktreeDigest,
        lease_file: leaseFile,
        created_at: "2026-06-11T00:00:00Z",
        updated_at: "2026-06-11T00:01:00Z",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
        terminal: {
          finished_at: "2026-06-11T00:01:00Z",
          reason: "user-aborted",
        },
        failure: { phase: null, reason: null, recoverability: null },
        github: {
          github_post_attempted: false,
          github_post_result: "not-attempted",
          github_posted_at: null,
        },
      };
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(lease, null, 2)}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["inspect-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        "REFUSAL_REASON=unmanaged-ephemeral-artifacts",
      );
      expect(result.stdout).toContain(
        "MESSAGE=unmanaged .ephemeral artifacts: .ephemeral/unmanaged.txt",
      );
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("treats malformed result metadata as invalid before cleanup ownership", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeRegisteredWorkspace("pr-review-owned-");
    const resultFile = ".ephemeral/pr-432-result.json";
    const findingsFile = ".ephemeral/topic-findings.json";
    await writeFile(path.join(worktree, ".ephemeral/unmanaged.txt"), "keep\n");
    await writeFile(path.join(worktree, findingsFile), "{}\n");
    await writeFile(
      path.join(worktree, resultFile),
      `${JSON.stringify({
        repository: "owner/repo",
        pr_number: 432,
        review_head_sha: "1111111111111111111111111111111111111111",
        findings_file: findingsFile,
        review_body_file: null,
        context_file: null,
        artifacts: {
          handoff_file: ".ephemeral/pr-432-handoff.json",
          scope_decision_file: ".ephemeral/pr-432-scope-decision.json",
          prior_threads_file: null,
          rendered_preview_file: null,
          extra: ".ephemeral/unmanaged.txt",
        },
      })}\n`,
    );

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      const lease = reviewedCommandLease(
        leaseFile,
        physicalWorktree,
        dynamicIdentity.worktreeDigest,
        resultFile,
        await sha256File(path.join(worktree, resultFile)),
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(lease, null, 2)}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["inspect-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("REFUSAL_REASON=invalid-lease");
      expect(result.stdout).not.toContain("METADATA_OUTCOME=retained");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

function setLeaseCommandEnv(primary: string, worktree: string): void {
  process.env.REPOSITORY = "owner/repo";
  process.env.PR_NUMBER = "432";
  process.env.PRIMARY_REPOSITORY_ROOT = primary;
  process.env.WORKTREE_PATH = worktree;
  unsetEnv("LEASE_FILE");
  unsetEnv("RESULT_FILE");
  unsetEnv("HEAD_SHA");
}

function setDiscoveryEnv(primary: string): void {
  process.env.REPOSITORY = "owner/repo";
  process.env.PR_NUMBER = "432";
  process.env.PRIMARY_REPOSITORY_ROOT = primary;
  unsetEnv("WORKTREE_PATH");
  unsetEnv("LEASE_FILE");
  unsetEnv("RESULT_FILE");
  unsetEnv("HEAD_SHA");
}

function discoveryLeaseFile(worktreePath: string): string {
  const digest = digestLeaseIdentityPath(worktreePath);
  return `.ephemeral/pr-432-${digest}-lease.json`;
}

async function writeDiscoveryLease(
  primary: string,
  worktreePath: string,
): Promise<string> {
  const leaseFile = discoveryLeaseFile(worktreePath);
  const lease = reducePrReviewLease(
    null,
    {
      repository: "owner/repo",
      prNumber: 432,
      worktreePath: canonicalLeaseIdentityPath(worktreePath),
      worktreeDigest: digestLeaseIdentityPath(worktreePath),
      leaseFile,
    },
    {
      state: "created",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:00:00Z",
    },
  );
  await writeFile(
    path.join(primary, leaseFile),
    `${JSON.stringify(lease, null, 2)}\n`,
  );
  return leaseFile;
}

function unsetEnv(key: (typeof managedEnvKeys)[number]): void {
  delete process.env[key];
}

function windowsMixedSpelling(value: string): string {
  return value
    .replace(/^([A-Za-z]):/u, (_, drive: string) => {
      return `${drive.toLowerCase()}:`;
    })
    .replace(/\\/gu, "/");
}

function windowsBackslashSpelling(value: string): string {
  return windowsMixedSpelling(value).replace(/\//gu, "\\");
}

async function writeLeaseCommandState({
  state,
  updatedAt,
}: {
  state: PrReviewLease["state"];
  updatedAt: string;
}): Promise<void> {
  process.env.STATE = state;
  process.env.BASE_REF = "main";
  process.env.HEAD_REF = "topic";
  process.env.UPDATED_AT = updatedAt;
  const result = await runPrReviewLeasesCommand(["write"]);
  expect(result.exitCode, result.stderr).toBe(0);
}

async function readLease(
  primary: string,
  leaseFile: string,
): Promise<PrReviewLease> {
  return JSON.parse(await readFile(path.join(primary, leaseFile), "utf8"));
}

function reverseJsonObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reverseJsonObject);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, nested]) => [key, reverseJsonObject(nested)]),
    );
  }
  return value;
}

async function sha256File(file: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

type GatedStatusWorkspace = Awaited<
  ReturnType<typeof makeRegisteredWorkspace>
> & {
  leaseFile: string;
  worktreeDigest: string;
  resultFile: string;
  resultSha256: string;
  reviewHead: string;
  findingsFile: string;
  prReviewDir: string;
  prReviewManifestHelperScript: string;
  prReviewLeaseHelperScript: string;
  playReviewHelper: string;
};

async function makeGatedStatusWorkspace(
  prefix: string,
  options: { canonicalWorktree?: boolean } = {},
): Promise<GatedStatusWorkspace> {
  const workspace = await makeRegisteredWorkspace(prefix, options);
  const { stdout: reviewHeadOutput } = await execFileAsync("git", [
    "-C",
    workspace.worktree,
    "rev-parse",
    "HEAD",
  ]);
  const reviewHead = reviewHeadOutput.trim();
  const helpers = await writeReviewHelperScripts(workspace.tempRoot);
  const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;
  const { findingsFile } = await writeResultArtifact(
    workspace.worktree,
    workspace.physicalWorktree,
    resultFile,
    reviewHead,
    "preview-current",
    true,
  );
  const resultSha256 = await sha256File(
    path.join(workspace.worktree, resultFile),
  );
  process.chdir(workspace.physicalPrimary);
  setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
  const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
  expect(pathResult.exitCode).toBe(0);
  const leaseFile = pathResult.stdout.trim();
  const dynamicIdentity = identityFromLeaseFile(
    leaseFile,
    workspace.physicalWorktree,
  );
  await writeFile(
    path.join(workspace.primary, leaseFile),
    `${JSON.stringify(
      gatedCommandLease({
        leaseFile,
        worktreePath: workspace.physicalWorktree,
        worktreeDigest: dynamicIdentity.worktreeDigest,
        resultFile,
        resultSha256,
      }),
      null,
      2,
    )}\n`,
  );
  return {
    ...workspace,
    leaseFile,
    worktreeDigest: dynamicIdentity.worktreeDigest,
    resultFile,
    resultSha256,
    reviewHead,
    findingsFile,
    ...helpers,
  };
}

function setReadStatusEnv(workspace: GatedStatusWorkspace): void {
  setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
  setHelperAuthorityEnv({
    prReviewDir: workspace.prReviewDir,
    prReviewManifestHelperScript: workspace.prReviewManifestHelperScript,
    prReviewLeaseHelperScript: workspace.prReviewLeaseHelperScript,
    playReviewHelper: workspace.playReviewHelper,
  });
  process.env.LEASE_FILE = workspace.leaseFile;
  process.env.RESULT_FILE = workspace.resultFile;
  process.env.HEAD_SHA = workspace.reviewHead;
}

function setAuditFailureEnv(
  workspace: GatedStatusWorkspace,
  updatedAt: string,
): void {
  process.env.REPOSITORY = "owner/repo";
  process.env.PR_NUMBER = "432";
  process.env.PRIMARY_REPOSITORY_ROOT = workspace.physicalPrimary;
  process.env.LEASE_FILE = workspace.leaseFile;
  process.env.STATE = "failed";
  process.env.EXPECTED_STATE = "gated";
  process.env.BASE_REF = "main";
  process.env.HEAD_REF = "topic";
  process.env.UPDATED_AT = updatedAt;
  process.env.RESULT_FILE = workspace.resultFile;
  process.env.FINISHED_AT = updatedAt;
  process.env.FAILURE_PHASE = "preview-render";
  process.env.FAILURE_REASON = "audit summary render failed";
  process.env.FAILURE_RECOVERABILITY = "recoverable";
  process.env.PR_REVIEW_DIR = workspace.prReviewDir;
  process.env.PR_REVIEW_MANIFEST_HELPER_SCRIPT =
    workspace.prReviewManifestHelperScript;
  process.env.PR_REVIEW_LEASE_HELPER_SCRIPT =
    workspace.prReviewLeaseHelperScript;
  process.env.PLAY_REVIEW_HELPER = workspace.playReviewHelper;
}

function setHelperAuthorityEnv({
  prReviewDir,
  prReviewManifestHelperScript,
  prReviewLeaseHelperScript,
  playReviewHelper,
}: {
  prReviewDir: string;
  prReviewManifestHelperScript: string;
  prReviewLeaseHelperScript: string;
  playReviewHelper: string;
}): void {
  process.env.PR_REVIEW_DIR = prReviewDir;
  process.env.PR_REVIEW_MANIFEST_HELPER_SCRIPT = prReviewManifestHelperScript;
  process.env.PR_REVIEW_LEASE_HELPER_SCRIPT = prReviewLeaseHelperScript;
  process.env.PLAY_REVIEW_HELPER = playReviewHelper;
}

async function mutateLease(
  workspace: GatedStatusWorkspace,
  mutate: (lease: PrReviewLease) => void,
): Promise<void> {
  const lease = await readLease(workspace.primary, workspace.leaseFile);
  mutate(lease);
  await writeFile(
    path.join(workspace.primary, workspace.leaseFile),
    `${JSON.stringify(lease, null, 2)}\n`,
  );
}

async function mutateNestedFindingsWithoutUpdatingResult(
  workspace: GatedStatusWorkspace,
): Promise<void> {
  await writeFile(
    path.join(workspace.worktree, workspace.findingsFile),
    `${JSON.stringify(
      {
        schema: "play-review/findings/v2",
        findings: [{ stale: true }],
        carry_forward: [],
      },
      null,
      2,
    )}\n`,
  );
}

async function makeLeaseWorkspace(prefix: string): Promise<{
  tempRoot: string;
  primary: string;
  worktree: string;
  physicalPrimary: string;
  physicalWorktree: string;
}> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), prefix));
  const primary = path.join(tempRoot, "primary");
  const worktree = path.join(tempRoot, "worktree");
  await mkdir(path.join(primary, ".ephemeral"), { recursive: true });
  await mkdir(path.join(worktree, ".ephemeral"), { recursive: true });
  return {
    tempRoot,
    primary,
    worktree,
    physicalPrimary: await realpath(primary),
    physicalWorktree: await realpath(worktree),
  };
}

async function makeResultAuthorityWorkspace(prefix: string): Promise<
  Awaited<ReturnType<typeof makeRegisteredWorkspace>> & {
    reviewHead: string;
    prReviewDir: string;
    prReviewManifestHelperScript: string;
    prReviewLeaseHelperScript: string;
    playReviewHelper: string;
  }
> {
  const workspace = await makeRegisteredWorkspace(prefix);
  const { stdout } = await execFileAsync("git", [
    "-C",
    workspace.worktree,
    "rev-parse",
    "HEAD",
  ]);
  return {
    ...workspace,
    reviewHead: stdout.trim(),
    ...(await writeReviewHelperScripts(workspace.tempRoot)),
  };
}

async function makeRegisteredWorkspace(
  prefix: string,
  options: { canonicalWorktree?: boolean } = {},
): Promise<{
  tempRoot: string;
  primary: string;
  worktree: string;
  physicalPrimary: string;
  physicalWorktree: string;
}> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), prefix));
  const primary = path.join(tempRoot, "primary");
  const worktree =
    options.canonicalWorktree === true
      ? path.join(primary, ".worktrees", "pr-432-review")
      : path.join(tempRoot, "worktree");
  await mkdir(primary, { recursive: true });
  await execFileAsync("git", ["init", "--initial-branch=main"], {
    cwd: primary,
  });
  await execFileAsync("git", ["config", "user.name", "Test User"], {
    cwd: primary,
  });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd: primary,
  });
  await writeFile(path.join(primary, "README.md"), "baseline\n");
  await execFileAsync("git", ["add", "README.md"], { cwd: primary });
  await execFileAsync("git", ["commit", "-m", "chore: baseline"], {
    cwd: primary,
  });
  await mkdir(path.dirname(worktree), { recursive: true });
  await execFileAsync(
    "git",
    ["worktree", "add", "-b", "review-topic", worktree],
    { cwd: primary },
  );
  await mkdir(path.join(primary, ".ephemeral"), { recursive: true });
  await mkdir(path.join(worktree, ".ephemeral"), { recursive: true });
  return {
    tempRoot,
    primary,
    worktree,
    physicalPrimary: await realpath(primary),
    physicalWorktree: await realpath(worktree),
  };
}

function identityFromLeaseFile(
  leaseFile: string,
  worktreePath: string,
): typeof identity {
  const match = /^\.ephemeral\/pr-432-([0-9a-f]{64})-lease\.json$/u.exec(
    leaseFile,
  );
  if (match === null) {
    throw new Error(`unexpected lease path: ${leaseFile}`);
  }
  return {
    ...identity,
    worktreePath: canonicalLeaseIdentityPath(worktreePath),
    worktreeDigest: match[1],
    leaseFile,
  };
}

function abortedCommandLease(
  leaseFile: string,
  worktreePath: string,
  worktreeDigest: string,
): PrReviewLease {
  return {
    schema: "pr-review/lease/v1",
    repository: "owner/repo",
    pr_number: 432,
    state: "aborted",
    base_ref: "main",
    head_ref: "topic",
    worktree_path: canonicalLeaseIdentityPath(worktreePath),
    worktree_digest: worktreeDigest,
    lease_file: leaseFile,
    created_at: "2026-06-11T00:00:00Z",
    updated_at: "2026-06-11T00:01:00Z",
    artifacts: {
      handoff_file: null,
      result_file: null,
      approved_review_file: null,
      validated_payload_file: null,
    },
    validation: {
      result_manifest: { status: null, validated_at: null, sha256: null },
    },
    presentation: { presented_at: null, status: null },
    terminal: {
      finished_at: "2026-06-11T00:01:00Z",
      reason: "user-aborted",
    },
    failure: { phase: null, reason: null, recoverability: null },
    github: {
      github_post_attempted: false,
      github_post_result: "not-attempted",
      github_posted_at: null,
    },
  };
}

function postedCommandLease({
  leaseFile,
  worktreePath,
  worktreeDigest,
  resultFile,
  resultSha256,
  approvedReviewFile,
  validatedPayloadFile = null,
}: {
  leaseFile: string;
  worktreePath: string;
  worktreeDigest: string;
  resultFile: string;
  resultSha256: string;
  approvedReviewFile: string;
  validatedPayloadFile?: string | null;
}): PrReviewLease {
  return {
    schema: "pr-review/lease/v1",
    repository: "owner/repo",
    pr_number: 432,
    state: "posted",
    base_ref: "main",
    head_ref: "topic",
    worktree_path: canonicalLeaseIdentityPath(worktreePath),
    worktree_digest: worktreeDigest,
    lease_file: leaseFile,
    created_at: "2026-06-11T00:00:00Z",
    updated_at: "2026-06-11T00:03:00Z",
    artifacts: {
      handoff_file: handoffFileFromResultFile(resultFile),
      result_file: resultFile,
      approved_review_file: approvedReviewFile,
      validated_payload_file: validatedPayloadFile,
    },
    validation: {
      result_manifest: {
        status: "valid",
        validated_at: "2026-06-11T00:02:00Z",
        sha256: resultSha256,
      },
    },
    presentation: {
      presented_at: "2026-06-11T00:02:00Z",
      status: "preview-current",
    },
    terminal: { finished_at: "2026-06-11T00:03:00Z", reason: null },
    failure: { phase: null, reason: null, recoverability: null },
    github: {
      github_post_attempted: true,
      github_post_result: "succeeded",
      github_posted_at: "2026-06-11T00:03:00Z",
    },
  };
}

function handoffFileFromResultFile(resultFile: string): string {
  const match = /^\.ephemeral\/pr-432-([0-9a-f]{40})-result\.json$/u.exec(
    resultFile,
  );
  if (match === null) {
    throw new Error(`unexpected result path: ${resultFile}`);
  }
  return `.ephemeral/pr-432-${match[1]}-handoff.json`;
}

function withCanonicalHandoffPointer(lease: PrReviewLease): PrReviewLease {
  if (lease.artifacts.result_file === null) {
    throw new Error("result-backed lease is required");
  }
  return {
    ...lease,
    artifacts: {
      ...lease.artifacts,
      handoff_file: handoffFileFromResultFile(lease.artifacts.result_file),
    },
  };
}

async function writeReviewHelperScripts(tempRoot: string): Promise<{
  prReviewDir: string;
  prReviewManifestHelperScript: string;
  prReviewLeaseHelperScript: string;
  playReviewHelper: string;
}> {
  const skillsRoot = path.join(tempRoot, "skills");
  const prReviewDir = path.join(skillsRoot, "pr-review");
  const prReviewScripts = path.join(prReviewDir, "scripts");
  const playReviewScripts = path.join(skillsRoot, "play-review", "scripts");
  await mkdir(prReviewScripts, { recursive: true });
  await mkdir(playReviewScripts, { recursive: true });
  const scopeHelper = path.join(prReviewScripts, "prior-thread-artifacts.sh");
  const prReviewManifestHelperScript = path.join(
    prReviewScripts,
    "review-manifests.sh",
  );
  const prReviewLeaseHelperScript = path.join(
    prReviewScripts,
    "review-leases.sh",
  );
  const playReviewHelper = path.join(playReviewScripts, "review-artifacts.sh");
  const passThrough = "#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n";
  const approvedReviewHelper = path.join(
    prReviewScripts,
    "approved-review-artifacts.sh",
  );
  await writeFile(scopeHelper, passThrough);
  await writeFile(prReviewManifestHelperScript, passThrough);
  await writeFile(prReviewLeaseHelperScript, passThrough);
  await writeFile(
    approvedReviewHelper,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'command_name="${1:-}"',
      'if [ "$command_name" = "inspect-approved-review-ownership" ]; then',
      '  jq -cn --arg review_body_file ".ephemeral/pr-${PR_NUMBER}-${HEAD_SHA}-review-body.md" --arg review_payload_file ".ephemeral/review-topic-${HEAD_SHA}-review-payload.json" \'{review_body_file: $review_body_file, review_payload_file: $review_payload_file}\'',
      "  exit 0",
      "fi",
      "exit 1",
      "",
    ].join("\n"),
  );
  await writeFile(playReviewHelper, passThrough);
  await chmod(scopeHelper, 0o755);
  await chmod(prReviewManifestHelperScript, 0o755);
  await chmod(prReviewLeaseHelperScript, 0o755);
  await chmod(approvedReviewHelper, 0o755);
  await chmod(playReviewHelper, 0o755);
  return {
    prReviewDir,
    prReviewManifestHelperScript,
    prReviewLeaseHelperScript,
    playReviewHelper,
  };
}

type DiscoveryOnlyApprovedReviewFixture = {
  canonicalPayload: Record<string, unknown>;
  worktreePath: string;
  reviewHead: string;
  leasePath: string;
  approvedPath: string;
  validatedPayloadPath: string;
  reviewPayloadPath: string;
  resultPath: string;
  originalLease: string;
  originalApproved: string;
  originalValidatedPayload: string;
  findingsPath: string;
  reviewBodyPath: string;
  scopeDecisionPath: string;
  rewriteApprovedEvidence: (payload?: Record<string, unknown>) => Promise<void>;
  expectInvalidDiscovery: () => Promise<void>;
  expectTerminalDiscovery: () => Promise<void>;
};

async function withDiscoveryOnlyApprovedReviewFixture(
  callback: (fixture: DiscoveryOnlyApprovedReviewFixture) => Promise<void>,
): Promise<void> {
  const workspace = await makeGatedStatusWorkspace(
    "pr-review-discovery-approved-review-semantic-",
  );

  try {
    const reviewBase = workspace.reviewHead;
    await execFileAsync(
      "git",
      ["commit", "--allow-empty", "-m", "test: approved review evidence"],
      { cwd: workspace.worktree },
    );
    const { stdout: reviewHeadOutput } = await execFileAsync("git", [
      "-C",
      workspace.worktree,
      "rev-parse",
      "HEAD",
    ]);
    workspace.reviewHead = reviewHeadOutput.trim();
    workspace.resultFile = `.ephemeral/pr-432-${workspace.reviewHead}-result.json`;
    await rm(path.join(workspace.worktree, ".ephemeral"), {
      recursive: true,
      force: true,
    });
    await mkdir(path.join(workspace.worktree, ".ephemeral"), {
      recursive: true,
    });
    const { findingsFile } = await writeResultArtifact(
      workspace.worktree,
      workspace.physicalWorktree,
      workspace.resultFile,
      workspace.reviewHead,
      "preview-current",
      true,
      reviewBase,
    );
    workspace.findingsFile = findingsFile;
    workspace.resultSha256 = await sha256File(
      path.join(workspace.worktree, workspace.resultFile),
    );
    const approvedReviewFile = `.ephemeral/review-topic-${workspace.reviewHead}-approved-review.json`;
    const reviewPayloadFile = `.ephemeral/review-topic-${workspace.reviewHead}-review-payload.json`;
    const canonicalPayload: Record<string, unknown> = {
      ...reviewPayload(workspace.reviewHead),
      body: "Review preview.",
    };
    await writeFile(
      path.join(workspace.primary, ".git", "info", "exclude"),
      ".ephemeral/\n",
    );
    const resultArtifact = JSON.parse(
      await readFile(
        path.join(workspace.worktree, workspace.resultFile),
        "utf8",
      ),
    ) as {
      artifacts: { scope_decision_file: string };
      findings_file: string;
      review_body_file: string;
    };
    const findingsPath = path.join(
      workspace.worktree,
      resultArtifact.findings_file,
    );
    const reviewBodyPath = path.join(
      workspace.worktree,
      resultArtifact.review_body_file,
    );
    const reviewPayloadPath = path.join(workspace.worktree, reviewPayloadFile);
    const scopeDecisionPath = path.join(
      workspace.worktree,
      resultArtifact.artifacts.scope_decision_file,
    );
    const validatedPayloadFile = `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`;
    await writeFile(reviewPayloadPath, `${JSON.stringify(canonicalPayload)}\n`);
    const approvedPath = path.join(workspace.worktree, approvedReviewFile);
    await writeFile(
      approvedPath,
      `${JSON.stringify({
        schema: "pr-review/approved-review/v1",
        review_head_sha: workspace.reviewHead,
        findings_file: resultArtifact.findings_file,
        review_body_file: resultArtifact.review_body_file,
        review_payload_file: reviewPayloadFile,
        scope_decision_file: resultArtifact.artifacts.scope_decision_file,
        findings_sha256: await sha256File(findingsPath),
        review_body_sha256: await sha256File(reviewBodyPath),
        review_payload_sha256: await sha256File(reviewPayloadPath),
        scope_decision_sha256: await sha256File(scopeDecisionPath),
        payload: canonicalPayload,
      })}\n`,
    );
    const validatedPayloadPath = path.join(
      workspace.worktree,
      validatedPayloadFile,
    );
    await writeFile(
      validatedPayloadPath,
      `${JSON.stringify(canonicalPayload)}\n`,
    );
    const posted = postedCommandLease({
      leaseFile: workspace.leaseFile,
      worktreePath: workspace.physicalWorktree,
      worktreeDigest: workspace.worktreeDigest,
      resultFile: workspace.resultFile,
      resultSha256: workspace.resultSha256,
      approvedReviewFile,
      validatedPayloadFile,
    });
    await writeFile(
      path.join(workspace.primary, workspace.leaseFile),
      `${JSON.stringify(posted, null, 2)}\n`,
    );
    process.chdir(workspace.physicalPrimary);
    setDiscoveryEnv(workspace.physicalPrimary);
    process.env.PR_REVIEW_DIR = undefined;
    process.env.PR_REVIEW_MANIFEST_HELPER_SCRIPT = undefined;
    process.env.PR_REVIEW_LEASE_HELPER_SCRIPT = undefined;
    process.env.PLAY_REVIEW_HELPER = undefined;

    const rewriteApprovedEvidence = async (
      payload: Record<string, unknown> = canonicalPayload,
    ): Promise<void> => {
      const approved = JSON.parse(
        await readFile(approvedPath, "utf8"),
      ) as Record<string, unknown>;
      await writeFile(reviewPayloadPath, `${JSON.stringify(payload)}\n`);
      approved.findings_sha256 = await sha256File(findingsPath);
      approved.review_body_sha256 = await sha256File(reviewBodyPath);
      approved.review_payload_sha256 = await sha256File(reviewPayloadPath);
      approved.scope_decision_sha256 = await sha256File(scopeDecisionPath);
      approved.payload = payload;
      await writeFile(approvedPath, `${JSON.stringify(approved)}\n`);
      await writeFile(validatedPayloadPath, `${JSON.stringify(payload)}\n`);
    };
    const expectInvalidDiscovery = async (): Promise<void> => {
      const result = await runPrReviewLeasesCommand(["discover"]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        disposition: "invalid",
        active_leases: [{ lease_file: workspace.leaseFile, status: "invalid" }],
      });
    };
    const expectTerminalDiscovery = async (): Promise<void> => {
      const result = await runPrReviewLeasesCommand(["discover"]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        disposition: "cleanup-required",
        active_leases: [
          {
            lease_file: workspace.leaseFile,
            status: "terminal",
            reason: "terminal-lease",
          },
        ],
      });
    };
    const originalLease = await readFile(
      path.join(workspace.primary, workspace.leaseFile),
      "utf8",
    );
    const originalApproved = await readFile(approvedPath, "utf8");
    const originalValidatedPayload = await readFile(
      validatedPayloadPath,
      "utf8",
    );

    await callback({
      canonicalPayload,
      worktreePath: workspace.worktree,
      reviewHead: workspace.reviewHead,
      leasePath: path.join(workspace.primary, workspace.leaseFile),
      approvedPath,
      validatedPayloadPath,
      reviewPayloadPath,
      resultPath: path.join(workspace.worktree, workspace.resultFile),
      originalLease,
      originalApproved,
      originalValidatedPayload,
      findingsPath,
      reviewBodyPath,
      scopeDecisionPath,
      rewriteApprovedEvidence,
      expectInvalidDiscovery,
      expectTerminalDiscovery,
    });
  } finally {
    process.chdir(originalCwd);
    await rm(workspace.tempRoot, { recursive: true, force: true });
  }
}

async function writeResultArtifact(
  worktree: string,
  physicalWorktree: string,
  resultFile: string,
  reviewHead: string,
  presentationStatus:
    | "not-presented"
    | "preview-current"
    | "edited" = "preview-current",
  includeSharedContext = false,
  reviewBase = reviewHead,
): Promise<{ findingsFile: string }> {
  const handoffFile = `.ephemeral/pr-432-${reviewHead}-handoff.json`;
  const findingsFile = `.ephemeral/review-topic-${reviewHead}-findings.json`;
  const reviewBodyFile = `.ephemeral/pr-432-${reviewHead}-review-body.md`;
  const scopeDecisionFile = `.ephemeral/review-topic-${reviewHead}-scope-decision.json`;
  const providerScopeEvidenceFile = `.ephemeral/review-topic-${reviewHead}-provider-scope-evidence.json`;
  const providerPrDiffRange = `${reviewBase}..${reviewHead}`;
  await writeFile(
    path.join(worktree, providerScopeEvidenceFile),
    `${JSON.stringify(
      {
        schema: "pr-review/provider-scope-evidence/v2",
        provider: "github",
        repository: "owner/repo",
        pr_number: 432,
        baseRefOid: reviewBase,
        headRefOid: reviewHead,
        provider_pr_diff_base_sha: reviewBase,
        local_review_head_sha: reviewHead,
        full_pr_diff_range: providerPrDiffRange,
        evidence_complete: true,
        digest_provenance: {
          schema: "pr-review/digest-provenance/v1",
          provider_diff: "canonical-git-diff/v1",
          local_diff: "canonical-git-diff/v1",
          provider_patches: "canonical-git-diff/v1",
          local_patches: "canonical-git-diff/v1",
        },
        provider_files: [],
        local_files: [],
        provider_diff_sha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        local_diff_sha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      },
      null,
      2,
    )}\n`,
  );
  const providerScopeEvidenceSha256 = await sha256File(
    path.join(worktree, providerScopeEvidenceFile),
  );
  const scopeDecision = {
    schema: "pr-review/scope-decision/v1",
    surface: "pr-review",
    head_sha: reviewHead,
    selected_range: providerPrDiffRange,
    full_range: providerPrDiffRange,
    candidate_narrow_range: providerPrDiffRange,
    language_hints: [],
    mode: "initial",
    is_followup_narrow: false,
    selection_reason: "Initial review scope.",
    escalation_reasons: ["not-followup"],
    last_reviewed_sha: null,
    changed_files: [],
    prior_context: { kind: "none", path: null },
    mechanical_facts: {
      changed_file_count: 0,
      followup_sha_usable: false,
      mechanical_escalate_full: true,
      mechanical_escalation_reason: "not-followup",
    },
    semantic_decision: {
      checked: true,
      ambiguous: false,
      notes: "No semantic narrowing for initial PR review.",
    },
    artifacts: {
      provider_scope_evidence_file: providerScopeEvidenceFile,
      provider_scope_evidence_sha256: providerScopeEvidenceSha256,
    },
  };
  await writeFile(
    path.join(worktree, scopeDecisionFile),
    `${JSON.stringify(scopeDecision, null, 2)}\n`,
  );
  await writeFile(
    path.join(worktree, findingsFile),
    `${JSON.stringify(
      {
        schema: "play-review/findings/v2",
        findings: [],
        carry_forward: [],
        incomplete_topical_routes: [],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(path.join(worktree, reviewBodyFile), "Review preview.\n");
  const sharedContext = includeSharedContext
    ? await writeSharedContextFamily(
        physicalWorktree,
        findingsFile,
        reviewHead,
        providerPrDiffRange,
      )
    : null;
  const handoff = {
    schema: "pr-review/handoff/v1",
    pr_number: 432,
    repository: "owner/repo",
    execution: {
      kind: "review-worktree",
      working_directory: physicalWorktree,
    },
    base_ref: "main",
    head_ref: "topic",
    review_scope_base_ref: reviewBase,
    active_diff_range: providerPrDiffRange,
    full_pr_diff_range: providerPrDiffRange,
    review_head_sha: reviewHead,
    mode: "github-post",
    language_hints: [],
    follow_up: {
      state: "initial",
      last_reviewed_sha: null,
      is_followup_narrow: false,
    },
    artifacts: {
      scope_decision_file: scopeDecisionFile,
      prior_threads_file: null,
      provider_scope_evidence_file: providerScopeEvidenceFile,
      provider_scope_evidence_sha256: providerScopeEvidenceSha256,
    },
  };
  await writeFile(
    path.join(worktree, handoffFile),
    `${JSON.stringify(handoff, null, 2)}\n`,
  );
  const result = {
    schema: "pr-review/result/v1",
    repository: "owner/repo",
    pr_number: 432,
    review_head_sha: reviewHead,
    findings_file: findingsFile,
    review_body_file: reviewBodyFile,
    context_file: sharedContext?.contextFile ?? null,
    artifacts: {
      handoff_file: handoffFile,
      scope_decision_file: scopeDecisionFile,
      prior_threads_file: null,
      rendered_preview_file: null,
      provider_scope_evidence_file: providerScopeEvidenceFile,
    },
    digests: {
      handoff_sha256: await sha256File(path.join(worktree, handoffFile)),
      findings_sha256: await sha256File(path.join(worktree, findingsFile)),
      review_body_sha256: await sha256File(path.join(worktree, reviewBodyFile)),
      context_sha256: sharedContext?.contextSha256 ?? null,
      scope_decision_sha256: await sha256File(
        path.join(worktree, scopeDecisionFile),
      ),
      prior_threads_sha256: null,
      rendered_preview_sha256: null,
      provider_scope_evidence_sha256: providerScopeEvidenceSha256,
    },
    scope_decision: {
      summary: "Initial review scope.",
      selected_range: providerPrDiffRange,
      full_range: providerPrDiffRange,
      is_followup_narrow: false,
    },
    presentation: { status: presentationStatus, notes: null },
    validation: {
      status: "valid",
      findings_validated: true,
      scope_decision_validated: true,
    },
  };
  await writeFile(
    path.join(worktree, resultFile),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  return { findingsFile };
}

async function writeSharedContextFamily(
  physicalWorktree: string,
  findingsFile: string,
  reviewHead: string,
  diffRange: string,
): Promise<{ contextFile: string; contextSha256: string }> {
  const priorCwd = process.cwd();
  const contextEnv = [
    "HEAD_SHA",
    "FINDINGS_FILE",
    "REVIEW_CONTEXT_INPUT_FILE",
    "REVIEW_CONTEXT_INPUT_JSON",
  ] as const;
  const priorEnv = new Map(contextEnv.map((key) => [key, process.env[key]]));

  try {
    process.chdir(physicalWorktree);
    process.env.HEAD_SHA = reviewHead;
    process.env.FINDINGS_FILE = findingsFile;
    process.env.REVIEW_CONTEXT_INPUT_JSON = JSON.stringify({
      schema: "play-review/shared-context-input/v1",
      header: {
        working_directory: physicalWorktree,
        base_ref: "main",
        head_sha: reviewHead,
        active_diff_range: diffRange,
        full_pr_diff_range: diffRange,
        mode: "github-post",
        language_hints: [],
      },
      changed_files: {
        command: "fixture",
        total_count: 0,
        truncated: false,
        records: [],
      },
      doc_impact_summary: {
        arch_files: [],
        new_adrs: [],
        modified_adrs: [],
        architecture_routing_risks: {
          mechanical_path_signals: [],
          semantic_classification_notes: [],
        },
        spec_routing_risks: {
          mechanical_path_signals: [],
          semantic_classification_notes: [],
        },
        notes: "fixture",
      },
      adr_references: [],
      discovered_guidelines: { records: [] },
      output_format: { markdown: "fixture" },
      prior_review_context: null,
    });
    const input = await runPlayReviewSharedContextCommand([
      "write-review-context-input",
    ]);
    if (input.exitCode !== 0) {
      throw new Error(input.stderr);
    }
    process.env.REVIEW_CONTEXT_INPUT_FILE = input.stdout.trim();
    const output = await runPlayReviewSharedContextCommand([
      "build-review-context",
    ]);
    if (output.exitCode !== 0) {
      throw new Error(output.stderr);
    }
    const contextFile = output.stdout.trim();
    return {
      contextFile,
      contextSha256: await sha256File(path.join(physicalWorktree, contextFile)),
    };
  } finally {
    process.chdir(priorCwd);
    for (const [key, value] of priorEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function writeApprovedReviewArtifact(
  worktree: string,
  approvedReviewFile: string,
  reviewHead: string,
): Promise<void> {
  await writeFile(
    path.join(worktree, approvedReviewFile),
    `${JSON.stringify({
      schema: "pr-review/approved-review/v1",
      review_head_sha: reviewHead,
      review_body_file: `.ephemeral/pr-432-${reviewHead}-review-body.md`,
      payload: reviewPayload(reviewHead),
    })}\n`,
  );
}

async function writeValidatedPayloadArtifact(
  worktree: string,
  reviewHead: string,
): Promise<string> {
  const validatedPayloadFile = `.ephemeral/pr-432-${reviewHead}-validated-review-payload.json`;
  await writeFile(
    path.join(worktree, validatedPayloadFile),
    `${JSON.stringify(reviewPayload(reviewHead))}\n`,
  );
  return validatedPayloadFile;
}

function reviewPayload(reviewHead: string): Record<string, unknown> {
  return {
    commit_id: reviewHead,
    event: "COMMENT",
    body: "Review body\n",
    comments: [],
  };
}

function omitKey<T extends object, K extends keyof T>(
  object: T,
  key: K,
): Omit<T, K> {
  const { [key]: _omitted, ...rest } = object;
  return rest;
}

function reviewedCommandLease(
  leaseFile: string,
  worktreePath: string,
  worktreeDigest: string,
  resultFile: string,
  resultSha256: string,
): PrReviewLease {
  return {
    schema: "pr-review/lease/v1",
    repository: "owner/repo",
    pr_number: 432,
    state: "reviewed",
    base_ref: "main",
    head_ref: "topic",
    worktree_path: canonicalLeaseIdentityPath(worktreePath),
    worktree_digest: worktreeDigest,
    lease_file: leaseFile,
    created_at: "2026-06-11T00:00:00Z",
    updated_at: "2026-06-11T00:01:00Z",
    artifacts: {
      handoff_file: null,
      result_file: resultFile,
      approved_review_file: null,
      validated_payload_file: null,
    },
    validation: {
      result_manifest: {
        status: "valid",
        validated_at: "2026-06-11T00:01:00Z",
        sha256: resultSha256,
      },
    },
    presentation: { presented_at: null, status: null },
    terminal: { finished_at: null, reason: null },
    failure: { phase: null, reason: null, recoverability: null },
    github: {
      github_post_attempted: false,
      github_post_result: "not-attempted",
      github_posted_at: null,
    },
  };
}

function gatedCommandLease({
  leaseFile,
  worktreePath,
  worktreeDigest,
  resultFile,
  resultSha256,
}: {
  leaseFile: string;
  worktreePath: string;
  worktreeDigest: string;
  resultFile: string;
  resultSha256: string;
}): PrReviewLease {
  return {
    schema: "pr-review/lease/v1",
    repository: "owner/repo",
    pr_number: 432,
    state: "gated",
    base_ref: "main",
    head_ref: "topic",
    worktree_path: canonicalLeaseIdentityPath(worktreePath),
    worktree_digest: worktreeDigest,
    lease_file: leaseFile,
    created_at: "2026-06-11T00:00:00Z",
    updated_at: "2026-06-11T00:02:00Z",
    artifacts: {
      handoff_file: null,
      result_file: resultFile,
      approved_review_file: null,
      validated_payload_file: null,
    },
    validation: {
      result_manifest: {
        status: "valid",
        validated_at: "2026-06-11T00:02:00Z",
        sha256: resultSha256,
      },
    },
    presentation: {
      presented_at: "2026-06-11T00:02:00Z",
      status: "preview-current",
    },
    terminal: { finished_at: null, reason: null },
    failure: { phase: null, reason: null, recoverability: null },
    github: {
      github_post_attempted: false,
      github_post_result: "not-attempted",
      github_posted_at: null,
    },
  };
}
