import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  targetedEnvelope,
  targetedEvidenceCases,
  targetedFinding,
} from "../__test-helpers__/review-evidence.js";
import {
  buildApprovedReviewPayload,
  validateTargetedReviewEvidence,
} from "./review-artifacts.js";

const head = "a".repeat(40);
const prior = "b".repeat(40);
const envelope = () => targetedEnvelope(head);
const finding = () => targetedFinding(head);

const briefingExample = () => {
  const template = readFileSync(
    new URL(
      "../../skills/play-review/references/agent-briefing-template.md",
      import.meta.url,
    ),
    "utf8",
  );
  const match = template.match(/~~~json\n([\s\S]*?)\n~~~/);
  if (!match) throw new Error("briefing JSON example missing");
  return JSON.parse(match[1]) as Record<string, unknown>;
};

describe("targeted review evidence", () => {
  it("accepts the briefing example and rejects independent closed-contract violations", () => {
    const example = briefingExample();
    expect(() => validateTargetedReviewEvidence(example)).not.toThrow();

    const withFinding = (
      change: (finding: Record<string, unknown>) => void,
    ) => {
      const value = structuredClone(example);
      const claim = (value.findings as Record<string, unknown>[])[0];
      change(claim);
      return value;
    };
    const unknownMember = withFinding((claim) => {
      (claim.assessment as Record<string, unknown>).selection_rationale =
        "invented";
    });
    expect(() => validateTargetedReviewEvidence(unknownMember)).toThrow();

    const unknownCategory = withFinding((claim) => {
      claim.category = "Invented";
      claim.body = (claim.body as string).replace(
        "Nit | Logic",
        "Nit | Invented",
      );
    });
    expect(() => validateTargetedReviewEvidence(unknownCategory)).toThrow();

    const staleAssessment = withFinding((claim) => {
      (claim.assessment as Record<string, unknown>).assessed_head_sha = prior;
    });
    expect(() => validateTargetedReviewEvidence(staleAssessment)).toThrow();

    const { review_head_sha: _reviewHeadSha, ...missingHead } =
      structuredClone(example);
    expect(() => validateTargetedReviewEvidence(missingHead)).toThrow();

    const missingEvidence = withFinding((claim) => {
      (claim.assessment as Record<string, unknown>).basis = " ";
    });
    expect(() => validateTargetedReviewEvidence(missingEvidence)).toThrow();
  });

  it.each(targetedEvidenceCases(head))(
    "$name (accepted=$accepted)",
    ({ value, accepted }) => {
      const validate = () => validateTargetedReviewEvidence(value);
      if (accepted) expect(validate).not.toThrow();
      else expect(validate).toThrow();
    },
  );
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
  it("refuses approval while an ordinary unverified blocker remains", () => {
    const value = envelope();
    value.findings.push(finding());

    expect(() =>
      buildApprovedReviewPayload({
        headSha: head,
        reviewEvent: "APPROVE",
        reviewBody: "Done",
        findings: value,
      }),
    ).toThrow("incomplete or blocking review cannot approve");
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
