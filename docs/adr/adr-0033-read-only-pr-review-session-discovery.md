# ADR-0033: Read-Only PR-Review Session Discovery

## Status

Accepted

## Context

The PR-review workflow must select a session before a transaction owner creates
or checks out a worktree. Existing direct-child leases and Git worktree
registrations may describe a reusable session, an operational blocker, an
invalid claim, or no claim at all. Selection therefore needs deterministic
evidence without turning observation into authority to mutate lifecycle state,
artifacts, worktrees, or cleanup records.

[ADR-0019](adr-0019-script-authority-for-deterministic-skill-mechanics.md)
requires deterministic mechanics to live in executable helpers rather than
prompt prose. [ADR-0024](adr-0024-shared-support-skill-runtime.md) assigns
stateful and platform-sensitive mechanics to the shared runtime behind thin
skill adapters. Neither decision allocates session-selection authority or its
boundary with existing lifecycle owners.

## Decision

PR-review session discovery is an inactive read-only runtime substrate. Its
inputs are repository identity, pull-request number, and primary repository
root. It inventories direct-child active leases, separately named archives,
the canonical worktree target, and hermetically inspected Git registrations
and status. It performs no creation, rollback, cleanup, lifecycle transition,
artifact-content validation, provider operation, or other mutation.

The planner emits exactly five dispositions with deterministic precedence:

1. `invalid`
2. `ambiguous`
3. `cleanup-required`
4. `resume`
5. `create`

Automatic resume evidence is limited to exactly one clean, registered,
artifact-free `created` lease with no blocker. The worktree may be canonical or
an alternate schema-bound path. Progressed, terminal, unsupported, or
artifact-bearing leases stop and delegate their exact identity tuple to the
existing lifecycle or artifact owner. Discovery does not consume those
artifacts and does not authorize cleanup. A null-lease canonical collision is
a manual stop.

The producer and direct consumer use a closed, identity-bound discovery object.
Before routing, validation checks repository and pull-request identity,
normalized primary-root identity, canonical-target observations, finite
classifications and reasons, deterministic selection, and
disposition-dependent tuple correlation. Contradictory or unverifiable output
fails closed.

Git inspection is side-effect-free and hermetic: routing, trace, prompt,
executable filter, include, hook, background maintenance, and optional-lock
authority are excluded or rejected. Discovery performs two complete
collections of the same filesystem and Git authorities and accepts a result
only when those observations are exactly equal. The returned result is
optimistic repeated-observation evidence, not an atomic snapshot or
transaction, and does not establish a linearization point. Equal observations
do not prove that the combined state existed at one instant. Discovery does
not promise to detect every direct or untrusted filesystem mutation, ABA
change, or mutation concurrent with a read. Lifecycle, creation, and cleanup
owners must revalidate their own authority immediately before mutation and
retain their transaction and conflict handling. Platform spelling is normalized
only at filesystem and comparison boundaries; stored lease identity remains
governed by the lifecycle contract.

The substrate remains inactive until the transactional session-creation owner
is implemented and integrated. `create` is selection evidence only and must
stop; it cannot authorize raw fetch, worktree creation, LC-01 writes, rollback,
or cleanup. Activation must retain immediate owner-side revalidation and
conflict handling.

That future owner may use the helper's closed
`validate-discovery --resume-acceptance` mode immediately before mutation. Its
inputs are the three discovery identity fields plus the previously validated
lease file and worktree path. It reruns read-only discovery and emits only a
`pr-review/resume-acceptance/v1` identity projection when the same tuple
remains the unique `resume` result; otherwise it fails without routing output.
This evidence neither activates the substrate nor grants mutation authority.

## Consequences

- Worktree selection is deterministic without granting mutation authority to
  discovery.
- Existing lifecycle, artifact, creation, rollback, and cleanup owners remain
  authoritative. Each owner must revalidate its own authority immediately
  before mutation and retain its existing transaction and conflict handling.
- `cleanup-required` communicates a stop and selected blocker; it is not proof
  that cleanup is permitted.
- The bounded discovery object is validated by its direct consumer. General
  schema evolution and reusable cross-consumer authority remain separate.
- Conservative classification can require manual or lifecycle-owned handling
  even when a later authority could safely resume a progressed session.
- Two equal complete collections and pure reduction provide deterministic
  repeated-observation evidence. Every observed mismatch or inspection failure
  invalidates discovery; undetected concurrent changes remain the
  responsibility of a future mutation owner's immediate revalidation.
- Shipping the inactive substrate does not change the current PR-review
  workflow or fresh-review behavior.

## Alternatives considered

- **Let operator prose discover and mutate sessions directly.** Rejected
  because deterministic, platform-sensitive mechanics require executable
  runtime ownership and tests.
- **Combine discovery with creation, rollback, or cleanup.** Rejected because
  observation would become mutation authority and concurrency failures would
  broaden the planner into a transaction owner.
- **Validate handoff, result, or approved-review semantics during discovery.**
  Rejected because artifact owners already define those semantics and parallel
  validation would create conflicting authority.
- **Resume every nonterminal lease.** Rejected because progressed sessions need
  lifecycle- and artifact-specific validation beyond session selection.
- **Infer ownership from branch, age, path appearance, or commit identity.**
  Rejected because those signals do not establish lease ownership.
