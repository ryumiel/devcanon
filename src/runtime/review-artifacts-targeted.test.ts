import { describe, expect, it } from "vitest";
import {
  buildApprovedReviewPayload,
  validateTargetedReviewEvidence,
} from "./review-artifacts.js";

const head = "a".repeat(40);
const prior = "b".repeat(40);
function envelope() {
  return {
    schema: "play-review/findings/v3",
    review_head_sha: head,
    findings: [] as Record<string, unknown>[],
    carry_forward: [] as Record<string, unknown>[],
    prior_dispositions: [],
    incomplete_review_routes: [] as Record<string, string>[],
    verification: {
      state: "not-required",
      reason: "No blocking triggers",
      selected_ids: [] as string[],
    },
  };
}
function finding() {
  return {
    id: "F1",
    origin_head_sha: head,
    path: "src/a.ts",
    line: 1,
    start_line: null,
    severity: "Blocking",
    category: "Logic",
    critic: null,
    anchor: "natural",
    why: "A supported consequence",
    recommendation: "Restore the invariant",
    body: "**Blocking | Logic** — A supported consequence\n\n**Recommendation:** Restore the invariant",
    assessment: {
      state: "fresh",
      assessed_head_sha: head,
      reuse_checked_head_sha: null,
      basis: "Inspected source, dependencies, contract and anchor",
      selection: "none",
      verification: "not-required",
    },
  };
}
describe("targeted review evidence", () => {
  it("accepts a legitimately skipped verifier and an ordinary blocker", () => {
    const value = envelope();
    value.findings.push(finding());
    expect(() => validateTargetedReviewEvidence(value)).not.toThrow();
  });
  it("rejects missing explicit verifier evidence", () => {
    const value = envelope();
    (value as Partial<typeof value>).verification = undefined;
    expect(() => validateTargetedReviewEvidence(value)).toThrow();
  });
  it("requires D10 incompleteness when required verification failed", () => {
    const value = envelope();
    const claim = finding();
    claim.assessment.selection = "consequential";
    claim.assessment.verification = "incomplete";
    value.findings.push(claim);
    value.verification = {
      state: "incomplete",
      selected_ids: ["F1"],
      reason: "Unavailable",
    };
    expect(() => validateTargetedReviewEvidence(value)).toThrow();
    value.incomplete_review_routes.push({
      route: "D10",
      disposition: "FAILED",
    });
    expect(() => validateTargetedReviewEvidence(value)).not.toThrow();
  });
  it("rejects borrowed verification and selected nits", () => {
    const value = envelope();
    const claim = finding();
    value.findings.push({ ...claim, critic: "VALID" });
    expect(() => validateTargetedReviewEvidence(value)).toThrow();
    claim.severity = "Nit";
    claim.body = claim.body.replace("**Blocking", "**Nit");
    claim.assessment.selection = "disputed";
    value.findings = [claim];
    expect(() => validateTargetedReviewEvidence(value)).toThrow();
  });
  it("requires current reuse checks while preserving original nit assessment", () => {
    const value = envelope();
    const claim = finding();
    claim.severity = "Nit";
    claim.body = claim.body.replace("**Blocking", "**Nit");
    claim.origin_head_sha = prior;
    value.findings.push({
      ...claim,
      assessment: {
        ...claim.assessment,
        state: "reused",
        assessed_head_sha: prior,
        reuse_checked_head_sha: head,
      },
    });
    expect(() => validateTargetedReviewEvidence(value)).not.toThrow();
    (
      value.findings[0].assessment as Record<string, unknown>
    ).reuse_checked_head_sha = prior;
    expect(() => validateTargetedReviewEvidence(value)).toThrow();
  });
  it("rejects duplicate identities but permits exact post-fix mirrors", () => {
    const value = envelope();
    value.findings.push(finding());
    value.carry_forward.push(finding());
    expect(() => validateTargetedReviewEvidence(value)).not.toThrow();
    value.carry_forward[0].why = "Different claim";
    expect(() => validateTargetedReviewEvidence(value)).toThrow();
    value.carry_forward = [];
    value.findings.push(finding());
    expect(() => validateTargetedReviewEvidence(value)).toThrow();
  });
  it("fails approval after required verifier failure even with no surviving blocker", () => {
    const value = envelope();
    const claim = finding();
    claim.assessment.selection = "uncertain";
    claim.assessment.verification = "completed";
    value.findings.push({ ...claim, critic: "INVALID" });
    value.verification = {
      state: "completed",
      reason: "Counterevidence established",
      selected_ids: ["F1"],
    };
    expect(() =>
      buildApprovedReviewPayload({
        headSha: head,
        reviewEvent: "APPROVE",
        reviewBody: "Done",
        findings: value,
      }),
    ).not.toThrow();
    value.incomplete_review_routes.push({
      route: "D10",
      disposition: "FAILED",
    });
    expect(() =>
      buildApprovedReviewPayload({
        headSha: head,
        reviewEvent: "APPROVE",
        reviewBody: "Done",
        findings: value,
      }),
    ).toThrow();
  });
  it("rejects stale current evidence at the publication boundary", () => {
    expect(() =>
      buildApprovedReviewPayload({
        headSha: prior,
        reviewEvent: "APPROVE",
        reviewBody: "Done",
        findings: envelope(),
      }),
    ).toThrow("head mismatch");
  });
  it("renders a verified downgrade as nonblocking without rewriting its evidence", () => {
    const value = envelope();
    const claim = finding();
    claim.assessment.selection = "disputed";
    claim.assessment.verification = "completed";
    value.findings.push({ ...claim, critic: "DOWNGRADE" });
    value.verification = {
      state: "completed",
      reason: "Severity settled",
      selected_ids: ["F1"],
    };
    const payload = buildApprovedReviewPayload({
      headSha: head,
      reviewEvent: "APPROVE",
      reviewBody: "Nits",
      findings: value,
    });
    expect((payload.comments as Record<string, unknown>[])[0].body).toContain(
      "**Nit | Logic**",
    );
    expect(value.findings[0].severity).toBe("Blocking");
  });
  it("rejects malformed presentation evidence in v3", () => {
    const value = envelope();
    value.findings.push({ ...finding(), why: " ", body: "invented" });
    expect(() => validateTargetedReviewEvidence(value)).toThrow();
  });
});
