import { describe, expect, it } from "vitest";
import {
  normalizeWhitespace,
  readRepoFile,
  readSkillSource,
} from "../__test-helpers__/skill-contracts.js";

function sliceBetween(content: string, start: string, end: string): string {
  const startIndex = content.indexOf(start);
  const endIndex = content.indexOf(end, startIndex + start.length);
  if (startIndex === -1 || endIndex === -1) {
    throw new Error(`Missing slice boundary: ${start} -> ${end}`);
  }
  return content.slice(startIndex, endIndex);
}

const lifecycleRows = Array.from(
  { length: 18 },
  (_value, index) => `LC-${String(index + 1).padStart(2, "0")}`,
);

describe("pr-review lease source contracts", () => {
  it("documents lease helper ownership without taking over manifest or GitHub authority", async () => {
    const prReview = await readSkillSource("pr-review");
    const leaseHelper = await readRepoFile(
      "skills/pr-review/scripts/review-leases.sh",
    );
    const normalizedPrReview = normalizeWhitespace(prReview);
    const normalizedPlainPrReview = normalizedPrReview.replaceAll("`", "");

    expect(prReview).toContain("scripts/review-leases.sh");
    expect(prReview).toContain('cleanup [label="7. Cleanup\\nlease-gated"]');
    expect(prReview).toContain("PR_REVIEW_LEASE_HELPER");
    expect(prReview).toContain("pr-review/lease/v1");
    expect(prReview).toContain(
      ".ephemeral/pr-${PR_NUMBER}-${WORKTREE_DIGEST}-lease.json",
    );
    for (const command of [
      "derive-path",
      "write",
      "validate",
      "inspect-worktree",
      "cleanup-worktree",
    ]) {
      expect(prReview).toContain(command);
      expect(leaseHelper).toContain(command);
    }

    expect(normalizedPrReview).toContain(
      "The lease records lifecycle state only; it does not store approval intent, review payload JSON, inline comments, findings content, or thread-resolution decisions",
    );
    expect(normalizedPlainPrReview).toContain(
      "review-leases.sh owns lease path derivation, closed-schema validation, transition enforcement, referenced-artifact validation, cleanup inspection, and cleanup refusal mechanics",
    );
    expect(normalizedPlainPrReview).toContain(
      "approved-review-artifacts.sh and play-review own approved-review payload and findings validation",
    );
    expect(normalizedPrReview).toContain(
      "The lease helper never posts to GitHub and never constructs GitHub review payloads",
    );
  });

  it("defines lifecycle writes, resume states, and fresh-PR compatibility", async () => {
    const prReview = await readSkillSource("pr-review");
    const leaseContract = await readRepoFile(
      "skills/pr-review/references/review-lease-lifecycle-contract.md",
    );
    const leaseSection = normalizeWhitespace(
      sliceBetween(
        prReview,
        "## Lease Lifecycle",
        "## Phase 3: Determine diff ranges",
      ),
    );
    const normalizedLeaseContract = normalizeWhitespace(leaseContract);

    for (const state of [
      "created",
      "reviewed",
      "gated",
      "posted",
      "aborted",
      "failed",
    ]) {
      expect(leaseSection).toContain(state);
    }
    expect(leaseSection).toContain(
      "Fresh PR reviews with no existing worktree follow the same Phase 1 through Phase 6 flow as before, except the lease is created and updated at the lifecycle boundaries below",
    );
    expect(leaseSection).toContain(
      "references/review-lease-lifecycle-contract.md",
    );
    expect(leaseSection).toContain(
      "Keep `SKILL.md` operator-facing; update the reference and focused tests when lease lifecycle behavior changes",
    );
    expect(leaseSection).toContain(
      "The reference names internal reducer events for auditability, but operators invoke only the helper command surface and public environment inputs shown here",
    );
    expect(leaseSection).not.toContain("| LC-01 |");
    expect(normalizedLeaseContract).toContain(
      "Review Lease Lifecycle Contract",
    );
    for (const row of lifecycleRows) {
      expect(normalizedLeaseContract).toContain(`| ${row} |`);
    }
    expect(normalizedLeaseContract).toContain(
      "| LC-01 | `create` | `none` | `created`",
    );
    expect(normalizedLeaseContract).toContain(
      "| LC-13 | `record-failure` | `gated` | `failed`",
    );
    expect(normalizedLeaseContract).toContain(
      "| LC-17 | `retry-post-success` | `failed` | `posted`",
    );
    expect(normalizedLeaseContract).toContain(
      "| LC-18 | `archive-terminal-and-create` | `posted` or `aborted` | `created`",
    );
    expect(normalizedLeaseContract).toContain("Terminal Archive Behavior");
    expect(normalizedLeaseContract).toContain(
      ".ephemeral/pr-${PR_NUMBER}-${WORKTREE_DIGEST}-${YYYYMMDDTHHMMSS}-${STATE}-archived-lease.json",
    );
    expect(normalizedLeaseContract).toContain(
      "Non-`github-post` failures clear GitHub post metadata",
    );
    expect(normalizedLeaseContract).toContain(
      "Approved-review path identity must mirror `approved-review-artifacts.sh`",
    );
    expect(normalizedLeaseContract).toContain("Validated payload copy");
    expect(normalizedLeaseContract).toContain(
      "Treating arbitrary payload-like JSON or user-authored JSON strings as managed cleanup evidence",
    );
    expect(normalizedLeaseContract).toContain(
      "Cleanup may preserve only lease-referenced artifacts and schema-declared artifact fields",
    );
    for (const field of [
      "`can_remove`",
      "`refusal_reason`",
      "`requires_confirmation`",
      "`metadata_outcome`",
      "`force_remove_allowed`",
    ]) {
      expect(normalizedLeaseContract).toContain(field);
    }
    expect(normalizedLeaseContract).toContain(
      "`dirty`, `invalid-lease`, `untracked-artifacts`, `identity-mismatch`, `confirmation-required`, `confirmation-token-mismatch`, `expected-state-mismatch`, `primary-worktree`, `non-worktree`, `missing-worktree`",
    );
    expect(leaseSection).toContain(
      "Write `created` after `WORKING_DIRECTORY` is resolved",
    );
    expect(leaseSection).toContain(
      "refresh `created` with `HANDOFF_FILE` after the Phase 3 handoff validates",
    );
    expect(leaseSection).toContain(
      "Write `reviewed` after the initial Phase 4 result manifest validates",
    );
    expect(leaseSection).toContain(
      "Write `gated` after each successful Phase 5 preview render",
    );
    expect(leaseSection).toContain(
      "Write `aborted` immediately after the user chooses `abort`, with `FINISHED_AT` and `TERMINAL_REASON`",
    );
    expect(leaseSection).toContain(
      "Write `posted` only after the GitHub review post succeeds, with `APPROVED_REVIEW_FILE`",
    );
    expect(leaseSection).toContain(
      "`failed` writes must include `FINISHED_AT`, `FAILURE_PHASE`, `FAILURE_REASON`, and `FAILURE_RECOVERABILITY`",
    );
    expect(leaseSection).toContain(
      "Resume `created`, `reviewed`, `gated`, and `failed` leases from validated lease and manifest artifacts",
    );
    expect(leaseSection).toContain(
      "Do not remove an existing review worktree during resume discovery",
    );
    expect(leaseSection).toContain(
      "Use `review-leases.sh validate` whenever resuming from an existing lease before trusting artifact paths",
    );
  });

  it("keeps lifecycle table evidence connected to helper and fixture coverage", async () => {
    const leaseContract = await readRepoFile(
      "skills/pr-review/references/review-lease-lifecycle-contract.md",
    );
    const leaseHelper = await readRepoFile(
      "skills/pr-review/scripts/review-leases.sh",
    );
    const reducerFixtures = await readRepoFile(
      "src/skill-scripts/pr-review-lease-reducer-contract.test.ts",
    );

    for (const row of lifecycleRows) {
      expect(leaseContract).toContain(`| ${row} |`);
      expect(leaseHelper).toContain(row);
      expect(reducerFixtures).toContain(row);
    }
    expect(reducerFixtures).toContain("LC-18-posted");
    expect(reducerFixtures).toContain("LC-18-aborted");
    expect(reducerFixtures).toContain(
      "rejects missing and stale artifact bindings separately from shell invocation",
    );
    expect(reducerFixtures).toContain(
      "rejects invalid state/event cross-products with boundary-specific failures",
    );
  });

  it("maps terminal, failure, and cleanup policy to the lease helper contract", async () => {
    const prReview = await readSkillSource("pr-review");
    const phase6 = normalizeWhitespace(
      sliceBetween(prReview, "## Phase 6: Post", "## Phase 7: Cleanup"),
    );
    const cleanup = normalizeWhitespace(
      sliceBetween(prReview, "## Phase 7: Cleanup", "## GitHub API Reference"),
    );
    const hardRules = normalizeWhitespace(
      sliceBetween(prReview, "## Hard Rules", "## Red Flags"),
    );

    expect(phase6).toContain(
      "After the GitHub review post succeeds, write `posted` with `APPROVED_REVIEW_FILE`",
    );
    expect(phase6).toContain(
      "If approved-review validation, stale-head verification, or GitHub posting fails after the approval freeze, write `failed` with `FINISHED_AT`, `FAILURE_PHASE`, `FAILURE_REASON`, and `FAILURE_RECOVERABILITY` before any cleanup decision",
    );
    expect(phase6).toContain(
      "Preserve the result manifest, findings file, review body, rendered preview, approved-review artifact, and validated payload file when available",
    );
    expect(phase6).toContain(
      "Do not retry or reconstruct a GitHub mutation from conversation text",
    );

    expect(cleanup).toContain("review-leases.sh inspect-worktree");
    expect(cleanup).toContain("review-leases.sh cleanup-worktree");
    expect(cleanup).toContain("METADATA_OUTCOME");
    expect(cleanup).toContain("FORCE_REMOVE_ALLOWED");
    expect(cleanup).toContain("ALLOW_POLICY_OVERRIDE");
    expect(cleanup).toContain("CONFIRM_REMOVE_TOKEN");
    expect(cleanup).toContain(
      "remove-pr-review-worktree-${PR_NUMBER}-${WORKTREE_DIGEST}",
    );
    expect(cleanup).toContain(
      "Dirty worktrees, unmanaged `.ephemeral` artifacts, identity mismatches, and invalid lease mechanics are absolute refusals",
    );
    expect(cleanup).toContain(
      "Lease-referenced managed artifacts may remain in terminal cleanup decisions",
    );
    expect(cleanup).toContain(
      "Non-worktree paths and missing physical paths are skipped outcomes, not removal permission",
    );
    expect(cleanup).toContain(
      "The helper's classifier is the single source of cleanup truth for both inspection and removal",
    );
    expect(cleanup).toContain(
      "`created`, `reviewed`, `gated`, missing-lease cleanup, and recoverable `failed` cleanup require explicit operator confirmation before passing `ALLOW_POLICY_OVERRIDE=yes`",
    );
    expect(cleanup).toContain(
      "Extract `WORKTREE_DIGEST` from `LEASE_FILE`: it is the 64-character hex segment between `.ephemeral/pr-${PR_NUMBER}-` and `-lease.json`",
    );
    expect(cleanup).not.toContain(
      "git worktree remove .worktrees/pr-<N>-review",
    );
    expect(hardRules).toContain(
      "Never remove a review worktree directly; use the lease helper cleanup contract",
    );
  });

  it("keeps ADR cleanup ownership distinct from lease lifecycle state", async () => {
    const adr0013 = await readRepoFile(
      "docs/adr/adr-0013-path-based-phase-artifact-handoff.md",
    );
    const normalizedAdr = normalizeWhitespace(adr0013);

    expect(normalizedAdr).toContain(
      "`pr-review/lease/v1` is a lifecycle artifact, not a generic phase artifact",
    );
    expect(normalizedAdr).toContain(
      "`pr-review` leases live in the primary repository `.ephemeral/` directory and are owned by `skills/pr-review/scripts/review-leases.sh`",
    );
    expect(normalizedAdr).toContain(
      "Lease cleanup does not introduce a broad `.ephemeral` sweep",
    );
    expect(normalizedAdr).toContain(
      "plain `git worktree remove` only after its safety and confirmation contract passes",
    );
    expect(normalizedAdr).toContain(
      "Lease-bound PR review artifacts are also part of the path-based handoff model",
    );
    expect(normalizedAdr).toContain(
      "The validated payload copy is managed cleanup evidence only after the approved-review validator emits it",
    );
    expect(normalizedAdr).toContain(
      "ADR-0012 remains unchanged by the lease reducer work because findings and nits delivery, retention, and manual sweep semantics do not change",
    );
    expect(normalizedAdr).toContain(
      "ADR-0019 also remains unchanged: the installed `pr-review` helper shipped by this decision is Bash/JQ",
    );
  });

  it("keeps lease helper and lifecycle contract discoverable from MAP", async () => {
    const map = await readRepoFile("MAP.md");
    const normalizedMap = normalizeWhitespace(map);

    expect(normalizedMap).toContain("Where is the PR review lease helper?");
    expect(normalizedMap).toContain(
      "skills/pr-review/scripts/review-leases.sh",
    );
    expect(normalizedMap).toContain(
      "Where is the PR review lease lifecycle contract?",
    );
    expect(normalizedMap).toContain(
      "skills/pr-review/references/review-lease-lifecycle-contract.md",
    );
  });
});
