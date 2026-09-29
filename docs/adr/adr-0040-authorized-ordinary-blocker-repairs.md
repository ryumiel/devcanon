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

This decision supersedes only ADR-0038's universal requirement that every
autonomous repair candidate have separately verified VALID evidence. ADR-0038
continues to own its remaining single-reviewer, targeted-verification, evidence,
and freshness decisions.

## Consequences

- An authorized ordinary blocker can receive the same bounded correction path
  as a selected blocker without fabricating a critic verdict.
- Repair owners must establish current exact implementation authority rather
  than deriving it from review findings or the fix mode.
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
