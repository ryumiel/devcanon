# ADR-0034: Calibrate Review Findings and Duplicate Retention

## Status

Accepted

## Context

Review findings decide whether a change may proceed, so a literal citation or
an applicable policy alone cannot make a finding blocking. The review process
needs to distinguish a current, supported problem from a hypothetical concern,
from a real but non-blocking concern, and from multiple reports of the same
problem. Without that distinction, reviewers can block on proof-for-proof or
over-engineering, or remove a real blocker while deduplicating a less severe
similar finding.

DevCanon has two layers of authority. Its local code-review guideline owns the
repository's judgment rule. The consumer-facing `play-review` skill applies
that rule while collecting and calibrating review findings for other
repositories. The durable rationale must be recorded without turning the skill
or its envelope into a second policy owner.

## Decision

A blocking finding must establish a current issue through a supported reachable
current-diff consequence or an actual breach of an applicable repository
obligation, then independently cross the repository's merge gate. Obligation
applicability alone is insufficient. A real, supported issue or actual
obligation breach below that gate is a non-blocking concern and remains eligible
as a `Nit`. Hypothetical consumers, missing premises, preference-only refactors,
proof-for-proof requests, and over-engineering do not establish either severity.
The consumer repository owns whether ADR coverage is an applicable obligation;
`play-review` discovers and fails closed on that policy when it exists, but does
not create an independent workflow-owned ADR requirement.

The critic falsifies the unchanged finding `why`, rather than an undeclared
assertion field. This retains the existing `play-review/findings/v2` contract
and leaves the controller unable to repair or strengthen a finding during
handoff.

For the critic-run mutation boundary, `play-review` produces exactly one
private same-controller invocation outcome: `completed-verification`,
`unavailable-fallback`, or `not-required-zero-input`. `branch-review` is the
sole consumer. Only `completed-verification` authorizes its existing
current-Nit mutation path; every other received state, including an
unavailable, zero-input, missing, or ambiguous state, fails closed and remains
non-mutating. This outcome has no schema, notice, artifact, renderer input, or
persistence. The source skills define this operational behavior and mutation
authority; this ADR records the decision and yields if those sources conflict.

Every current candidate is calibrated independently before duplicate retention.
Blockers receive `VALID`, `DOWNGRADE`, or `INVALID`; Nits receive transient
`RETAIN` or `INVALID` without promotion. Current candidates may share a
duplicate group only when their compatible severity/outcome class, remediation,
and effective anchor match, and they rely on the same supported reachable
consequence or the same violated obligation. The lowest stable ordinal is
retained only within that compatible group. A group never mixes Nits with
blockers or blocker verdicts, so a `VALID` blocker retains a `VALID`
representative; duplicate retained Nits may consolidate. Ambiguous support,
different anchors, and carry-forward candidates remain separate.

The DevCanon-local code-review guideline remains the normative owner of this
judgment. `play-review` is the consumer-repository operational method, and its
existing envelope schema remains unchanged.

## Consequences

- Reviewers can preserve obligation-backed findings without mistaking an
  applicable but unbreached rule for a defect.
- A real, non-blocking concern is checked for actionability and can be retained
  as a `Nit` rather than inflated into a merge gate.
- Duplicate reports of the same consequence can consolidate only in compatible
  severity/outcome classes, while a `VALID` blocker retains a `VALID`
  representative.
- Critic handoff passes each complete current finding unchanged except for a
  stable ordinal, so existing location and evidence stay available without a
  second handoff schema.
- `play-review/findings/v2` remains intentionally insufficient as mutation
  authorization because it does not carry the private critic-run outcome.

## Alternatives considered

- Treat an applicable obligation as sufficient. Rejected because policy scope
  alone does not show a current violation.
- Require an executable consequence for every finding. Rejected because some
  architecture, documentation, safety, and test obligations are violated
  without one executable path.
- Deduplicate only by violated obligation. Rejected because separate reports
  can describe the same supported reachable consequence without an obligation
  basis.
- Add an `assertion` field to the findings envelope. Rejected because the
  existing `why` field already carries the claim and a new schema field would
  create unnecessary contract surface.
