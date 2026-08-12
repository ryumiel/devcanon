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
applicability alone is insufficient. A supported issue or actual obligation
breach below that gate is a non-blocking concern. Hypothetical consumers,
missing premises, preference-only refactors, proof-for-proof requests, and
over-engineering do not establish a blocking finding.

The critic falsifies the unchanged finding `why`, rather than an undeclared
assertion field. This retains the existing `play-review/findings/v2` contract
and leaves the controller unable to repair or strengthen a finding during
handoff.

Candidates are calibrated independently before duplicate retention. Current
candidates may share a duplicate group only when their calibrated verdict,
remediation, and effective anchor match, and they rely on the same supported
reachable consequence or the same violated obligation. The lowest stable
ordinal is retained only within that verdict-homogeneous group. Mixed verdicts,
ambiguous support, different anchors, and carry-forward candidates remain
separate.

The DevCanon-local code-review guideline remains the normative owner of this
judgment. `play-review` is the consumer-repository operational method, and its
existing envelope schema remains unchanged.

## Consequences

- Reviewers can preserve obligation-backed findings without mistaking an
  applicable but unbreached rule for a defect.
- A real, non-blocking concern can be retained as a `Nit` rather than inflated
  into a merge gate.
- Duplicate reports of the same consequence can consolidate, while mixed
  `VALID` and `DOWNGRADE` outcomes cannot erase a blocker.
- Critic handoff remains bounded to existing finding fields, at the cost of
  requiring reviewers to express the claim clearly in `why`.

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
