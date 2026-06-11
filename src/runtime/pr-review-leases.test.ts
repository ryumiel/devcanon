import { describe, expect, it } from "vitest";
import { type PrReviewLease, reducePrReviewLease } from "./pr-review-leases.js";

const identity = {
  repository: "owner/repo",
  prNumber: 432,
  worktreePath: "/tmp/review-worktree",
  worktreeDigest:
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  leaseFile:
    ".ephemeral/pr-432-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-lease.json",
};

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
    });

    expect(gatedLease()).toMatchObject({
      state: "gated",
      presentation: {
        presented_at: "2026-06-11T00:02:00Z",
        status: "preview-current",
      },
    });
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
      },
      github: {
        github_post_attempted: true,
        github_post_result: "succeeded",
        github_posted_at: "2026-06-11T00:03:00Z",
      },
      failure: { phase: null },
    });
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
