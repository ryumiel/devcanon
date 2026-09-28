# ADR-0038: Single Reviewer and Targeted Verification

## Status

Accepted as the coordinated source and consumer contract; the introducing PR
requires independent review under the pre-change policy.

## Context

Topical reviewers provide independent scrutiny but can rediscover the same
defect. Verifying every nonblocking finding adds work without resolving a
publication blocker. Reducing dispatches must preserve complete coverage,
independence, honest evidence freshness, and the distinction between evidence
and authority to approve or modify source.

The current verification outcome also gates automatic fixes. Changing only
dispatch selection would leave consumers unable to distinguish intentional
non-verification from missing required verification, or could accidentally
authorize mutation of claims that no verifier examined.

## Decision

Only findings/v3 and approval-summary/v2 are accepted by artifact consumers.
Older artifacts require fresh review, with no legacy reads or conversion.
Current-schema earlier-candidate evidence remains subject to existing freshness
and head-binding rules. The routing policy names the active route set,
D1–D7 and D10–D18; no retired-route tombstones are maintained.

Use one independent reviewer covering baseline quality/data safety and all
applicable architecture, specification, documentation, example, platform, and
external-invocation checks. Preserve semantic context assessment. Risk selects
checks within that reviewer. A separate targeted verifier examines only
consequential, disputed, or uncertain blocking claims, with failure blocking
approval whenever verification is required.

The [routing guideline](../guidelines/agent-routing-and-mutation-policy.md#review-route-contract)
owns route identities and tuples. The
[workflow contract](../../skills/play-review/references/single-reviewer-contract.md)
owns selection, coverage, evidence transport, failure rules, acceptance
scenarios, and migration. The code-review guideline continues to own local
finding admission and duplicate retention; consumer repositories retain their
own merge obligations. This record does not create a second procedure owner.

Use versioned findings and approval evidence to distinguish completed,
unnecessary, and incomplete verification. Preserve unchanged nit identity and
original evidence provenance after a current reuse check; do not describe
carried evidence as fresh verification. Unverified findings remain outside
automatic fix qualification. Every changed candidate requires fresh validation
and review. Repeated blocking failures in the same family require bounded
scope/design reassessment rather than indefinite identical fix waves.

This decision supersedes only ADR-0007’s branch-review reviewer/verifier and
findings/approval-summary evidence versions, automatic nit-fix eligibility, and
judgment-only nit handoff
provisions. Its implementation-review ownership and per-task-review decisions
remain unchanged.

This decision supersedes ADR-0012’s findings/v2 schema and D7–D9 completeness
representation, old-head post-fix subtraction, and fixable-versus-judgment-required
nit consumer provisions. Its side-channel transport, deterministic notice/path,
write/read guards, data residency, and lifecycle cleanup remain unchanged.
New candidate review supplies final evidence after fixes; all remaining nits
use the existing report-only handoff.

Publication binds evidence to the requested head and emits each finding identity
once. User edits to posting are presentation overrides on retained evidence;
they never rewrite verification history or clear approval or automatic-fix gates.

This decision supersedes ADR-0022's topical fanout
and critic-always-for-nits requirements. It supersedes only ADR-0034's
all-candidate independent critic calibration, unchanged-v2 transport, and
private all-input verification outcome as the mutation gate. Preserve its
supported-consequence/obligation judgment, unchanged-claim verification,
severity discipline, and compatible duplicate-retention rationale. Those records retain their historical rationale with explicit successor pointers.

## Consequences

- One reviewer bears the complete applicable coverage obligation; missing
  coverage remains a failed review, never an empty success.
- Verification concentrates on claims where mistaken adjudication is
  consequential or evidence conflicts. Ordinary blockers still block.
- Nit-only results avoid a verifier but also lose autonomous nit-fix
  eligibility. Targeted verification cannot authorize unrelated fixes.
- Both wrappers, evidence validators, approval consumers, and target renders
  require coordinated migration. Mixed old/new evidence cannot approve a new
  pipeline run.
- Publication, CI, repository approval, merge, source protection, and lifecycle
  owners remain unchanged. Reviewer model defaults are a separate decision.
- Reduced dispatch count is a structural outcome; quality equivalence and
  elapsed-time savings require measured evidence and are not asserted here.

## Alternatives considered

- Retain topical fanout and only narrow critic selection: smaller migration,
  but retains duplicated topical discovery and does not achieve one-reviewer
  coverage ownership.
- Verify every blocker: simpler selection, but repeats independent adjudication
  for ordinary undisputed defects without the proposed consequence/dispute
  distinction.
- Allow the controller to replace required verification: rejected because it
  loses independent adjudication and obscures incomplete required review.
- Treat an absent critic verdict as successful verification: rejected because
  intentional skipping and required failure have different approval semantics.
