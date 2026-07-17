# ADR-0030: Require Planning Readiness and Parallel Digest Gates

## Status

Accepted

## Context

An implementation plan can be internally clear while still resting on missing
or conflicting decisions about ownership, lifecycle, side effects, artifacts,
or verification. Discovering those gaps after drafting makes the plan encode
choices that the planning workflow does not have authority to make.

Plan review and implementer-executability review also answer distinct
questions. Running them as successive approval steps can expose related gaps
serially, and a plan edit prompted by either review can leave the other
reviewer's verdict attached to content that no longer exists. The handoff
boundary needs a deterministic identity for the reviewed plan and a rule that
prevents mixed-version approval without merging the two reviewer remits.

## Decision

`play-planning` requires a closed readiness determination before drafting a
plan. Readiness confirms that the decisions needed for planning have
authoritative owners and separates bounded implementation assumptions from
missing or conflicting authority. The bundle-owned readiness reference remains
the normative owner of those reusable semantics; this ADR records why the gate
exists rather than duplicating its executable procedure.

Each completed plan version is identified by a SHA-256 digest of the saved
file's exact bytes. Plan review and implementer-executability review remain
distinct reviewer sessions with their existing role, capability, effort, and
mutation authority. They review the same plan version as a parallel pair and
produce separate results bound to that digest. The controller joins the pair
only after both results settle through their source-immutability lifecycle.

Any edit changes the reviewed artifact and invalidates both verdicts. The
revised plan therefore needs a fresh pair of results for its new digest. A plan
may cross the execution-handoff boundary only when both distinct reviewers pass
the same current digest.

The paired gate is bounded: the first wave is exhaustive and the second wave is
convergent. The second pair verifies prior material gaps, checks that the
revision introduced no regression, and may add a new blocking gap only when
newly exposed concrete evidence makes it material. Regression checking is
necessary because a correction can preserve the original gap while breaking a
different load-bearing boundary. Bounded new-evidence rules preserve genuine
omission and safety detection without turning optional hardening or reviewer
preference into serial acceptance growth. Two waves are the architectural stop;
unresolved material gaps remain non-passing rather than being weakened or
routed through an unbounded review loop.

The `play-planning` source skill owns dispatch, lifecycle, revision, and handoff
mechanics. Its bundled planning references own readiness and shared review
criteria. The routing policy owns only the stable reviewer route inventory.
This decision introduces no persistent review-result artifact, runtime helper,
schema registry, or new reviewer identity.

The bounded convergence decision does not create a persistent review protocol
or result artifact; detailed materiality, reviewer-remit, and convergence
judgment remains owned by the bundled planning criteria and controller-local
state.

## Consequences

- Missing or conflicting planning authority stops before task drafting rather
  than becoming an implicit implementation choice.
- The two reviewer remits stay independent while their results become
  comparable against one immutable plan version.
- Both reviewers can run without serial approval latency, but the controller
  must wait for the complete pair before routing.
- Every plan edit requires both reviews again, including edits requested by
  only one reviewer.
- Review feedback converges within two paired waves while newly evidenced
  material omissions remain fail-closed.
- Exact file-byte identity avoids ambiguity from Markdown normalization or
  reconstructed content, at the cost of invalidating verdicts for any byte
  change.
- Planning remains a source-owned workflow contract rather than gaining a
  durable result format or generalized review infrastructure.

## Alternatives considered

- **Keep sequential Plan Review and Implementer Executability Review.**
  Rejected because it exposes related gaps serially and encourages retaining a
  verdict from an earlier plan version.
- **Collapse both remits into one reviewer.** Rejected because requirement
  coverage and implementer executability are distinct judgments with different
  failure modes.
- **Compare normalized Markdown or selected plan fields.** Rejected because
  normalization creates another content definition and can approve bytes that
  neither reviewer actually received.
- **Persist structured review results through a runtime helper or registry.**
  Rejected because controller-local digest-bound responses are sufficient and
  avoid a new artifact lifecycle, schema, and ownership surface.
- **Record the full operational procedure in this ADR.** Rejected because the
  source skill and its bundled references own executable behavior; duplicating
  it here would create a competing policy surface.
