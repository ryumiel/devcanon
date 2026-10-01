# ADR-0040: Authorized Ordinary Blocker Repairs

## Status

Accepted

## Context

The review contract distinguishes targeted verification from legitimate skipped
verification. A current, supported ordinary blocker may have no consequential,
disputed, or uncertain trigger, so its evidence remains `not-required` with a
null critic. Requiring a targeted verifier for that case would erase the
distinction and make a completed review unable to use an already authorized,
bounded correction.

At the same time, a finding or a `--fix` invocation cannot supply authority to
change source. The repair path must retain current evidence, exact scope,
proportionality, hard stops, bounded recurrence, fresh validation, and
independent review before approval.

A behavior-preserving compliance correction has a different proof target from
a product blocker: the owner must establish an applicable mandatory rule, a
current-source violation, exact implementation authority, and preservation of
existing behavior. When review response uses a generated implementation plan,
independent planning review proves the plan's correctness and executability;
it does not create implementation authority. Requiring a second approval solely
because that plan was generated would disregard explicit current authorization
that already covers its exact correction.

## Decision

The existing bounded remediation route accepts an ordinary blocker only when
the review is complete and current, the blocker is fresh and supported, its
assessment selects no targeted verification, its verification state is
`not-required`, and its critic is null. Current implementation authority must
cover the exact bounded correction. Before mutation, the repair owner rechecks
the closed targeted-verification triggers against current evidence; conflict or
uncertainty removes the ordinary path.

Selected consequential, disputed, and uncertain blockers continue to require
completed targeted verification with a VALID critic result. Nits, reused
evidence, incomplete review, INVALID or DOWNGRADE findings, missing or
ambiguous authority, exhausted same-family recurrence, and every existing
scope, proportionality, and hard-stop exclusion remain non-mutating. Safety and
Contracts hard-rule claims retain their immediate stop before later fixes.

Each repair changes the candidate. Applicable validation, a frozen new head,
and independent review are required before another qualification or final
approval. Existing evidence schemas, notices, custody rules, and both target
renderings remain unchanged.

For an eligible behavior-preserving compliance repair in planned review
response, the parent may satisfy its separate plan approval gate using explicit
current-session user authority only when the plan contains eligible
behavior-preserving compliance corrections and that authority covers every
correction in the exact combined-reviewed plan, every affected file, scope, and
proof obligation. The parent retains the authority source with the reviewed
plan digest and current producer provenance, then checks it again immediately
before execution. Missing, partial or ambiguous coverage, behavior or
control-flow changes, a changed public contract, a new interface or dependency,
widened scope or a crossed approval boundary keeps the existing explicit
approval or owning handoff. Other planned work still requires explicit reviewed
plan approval. A plan-byte edit invalidates review and approval; correction
uses the remaining bounded planning-review pass or its reassessment route and
requires a new authority assessment. The direct/manual executor's structural
gate and independent implementation and changed-head reviews remain required.

This narrowly qualifies ADR-0039's unconditional separate plan-approval rule
for review response; it does not change its combined planning review, digest,
provenance, or two-pass budget decisions.

This decision supersedes only ADR-0038's universal requirement that every
autonomous repair candidate have separately verified VALID evidence. ADR-0038
continues to own its remaining single-reviewer, targeted-verification, evidence,
and freshness decisions.

## Consequences

- An authorized ordinary blocker can receive the same bounded correction path
  as a selected blocker without fabricating a critic verdict.
- Repair owners must establish current exact implementation authority rather
  than deriving it from review findings or the fix mode.
- Exact current user authority can satisfy the reviewed-plan gate for the
  covered compliance correction without a repeated approval request.
- A changed candidate cannot reuse its pre-mutation qualification or approval
  evidence.
- The retained exclusions keep uncertain, consequential, disputed, or
  judgment-required claims on their existing stop or handoff routes.

## Alternatives considered

- Require targeted verification for every blocker: rejected because it erases
  the distinction between a selected claim and an ordinary supported claim.
- Treat a null critic as repair authority: rejected because evidence transport
  cannot grant implementation authority.
- Create a separate repair route or artifact: rejected because the existing
  bounded remediation route already owns execution and fresh-review handling.
- Require a new approval for every generated compliance plan despite complete
  current authority: rejected because plan generation does not revoke exact
  authorization; current combined review and provenance still protect the
  handoff.
