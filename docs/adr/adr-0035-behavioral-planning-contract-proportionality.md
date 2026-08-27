# ADR-0035: Classify Planning Contracts by Behavioral Risk

## Status

Accepted

## Context

Planning contracts need enough detail to make work executable without making
every persistent file write or implementation mechanism carry the same
contract weight as public, security-sensitive, externally mutating, or
multi-owner behavior. Treating persistence or filesystem effects as sufficient
for the strongest tier produces exhaustive prose that does not improve the
implementation decision. It also obscures the existing authorities for
mutation permission, failure behavior, cleanup, and recovery.

The planning workflow therefore needs one proportionality decision that is
global to planning rather than owned by an individual execution optimization.
The operational criteria remain source-owned by the canonical planning skill;
this ADR records only the durable rationale and ownership boundary.

## Decision

Planning classifies a task as `LIGHTWEIGHT` only when all five behavioral
dimensions are true:

1. exactly one behavioral owner;
2. no public schema or API;
3. no security-sensitive or untrusted boundary;
4. no external mutation; and
5. outputs and side effects are bounded and recoverable.

Any false dimension, ambiguity, or independently applicable material authority
requires the stronger applicable treatment. Persistence, artifact type,
language, path, repository layout, and filesystem effects do not decide the
tier by themselves.

External mutation includes provider or network state, user-home or system-wide
state, state outside the authorized worktree, and otherwise externally
controlled state. An authorized, bounded, recoverable worktree-local output is
not external solely because it persists.

This classification does not replace existing safety ownership. Mutation
permission remains governed by mutation-authority and `SIDE-EFFECT` validation.
Recovery remains governed by the bounded-and-recoverable dimension and any
applicable lifecycle behavior. A `LIGHTWEIGHT` task records its material write
or side-effect owner, failure and cleanup behavior, focused verification, and
the explicit reason all five dimensions are true; it does not duplicate
permission and recovery as additional compact-record fields.

Planning owns semantic classification and completeness. Execution consumes the
reviewed declared tier and validates its assembled structure without
reclassifying it. Equivalent prose, ordering, or carrier placement is not a
defect when the required semantic context is complete.

## Consequences

- Contract detail scales with behavioral risk instead of persistent syntax or
  implementation mechanism.
- Bounded local writes can use a compact contract while remaining subject to
  existing permission, cleanup, and recoverability checks.
- Planning and execution retain separate responsibilities: planning decides
  the tier; execution validates and consumes it.
- The canonical planning criteria remain the operational owner and may refine
  examples without turning this ADR into a duplicated procedure.
- Ambiguous or materially governed tasks still fail closed to the stronger
  treatment.

## Alternatives considered

- Treat every persistent or filesystem output as `FULL`. Rejected because
  persistence alone does not establish public, trust-boundary, multi-owner, or
  external-mutation risk.
- Add permission and recovery as mandatory compact-record fields. Rejected
  because existing mutation-authority and lifecycle owners already govern
  those decisions.
- Introduce a parser, sidecar, schema, or runtime registry to decide the tier.
  Rejected because tier selection is reviewed semantic judgment, and another
  representation would add an authority surface without improving that
  judgment.
