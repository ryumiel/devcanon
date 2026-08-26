# ADR-0035: Path-Backed Task-Record Resolution

## Status

Accepted

## Context

Planning tasks identify execution context through kind-scoped boundary-row and
supporting-owner-supplement IDs. The execution controller must resolve those
IDs against the exact reviewed plan before it curates task context or
dispatches work.

Inline plan prose has neither a guarded repository path nor an independently
reviewed digest. Materializing or hashing inline prose inside the execution
controller would let that controller create its own review evidence and would
bypass the established phase-artifact boundary. It would also require a second
resolution route with different filesystem and identity guarantees.

ADR-0013 originally preserved inline execution compatibility for every
phase-artifact consumer. That compatibility predates exact task-record
resolution and cannot provide the identity evidence this execution boundary
now requires.

## Decision

`play-subagent-execution` requires both a guarded direct-child
`Plan: .ephemeral/*-plan.md` path and the exact reviewed SHA-256 digest before
it resolves task-record identifiers or dispatches work. The deterministic
resolver reads the path once, verifies the digest over those exact bytes,
requires valid UTF-8, and emits only closed kind-scoped identifier arrays.

The skill still recognizes inline `## Plan` content as a direct-invocation
input shape. Without the path and digest, it returns
`BLOCKED/NEEDS_CONTEXT` and asks the caller to save and review the plan through
the path-backed route. It does not persist, hash, structurally resolve, or
execute the inline content.

This decision supersedes only ADR-0013's inline-execution compatibility for
`play-subagent-execution`. ADR-0013's hybrid contract remains unchanged for
`play-brainstorm` and `play-planning`, and its other phase-artifact decisions
remain accepted.

## Consequences

- Task-record selection is bound to the exact reviewed plan bytes used by the
  execution controller.
- Direct inline execution now has a bounded recovery step: save the plan,
  review its digest, and invoke the path-backed route.
- The controller does not acquire artifact-persistence or review-attestation
  authority.
- Planning and brainstorming retain their existing direct-invocation inline
  compatibility because they do not consume exact task-record identities for
  execution dispatch.
- The execution helper remains a deterministic structural validator; semantic
  applicability, context curation, blocking continuation, and dispatch remain
  controller-owned.

## Alternatives considered

- **Persist and hash inline prose inside the execution controller.** Rejected
  because the consumer would manufacture the identity evidence it is supposed
  to verify and would duplicate phase-artifact write mechanics.
- **Maintain a second in-memory resolver.** Rejected because two resolution
  routes would drift and the inline route could not prove equality with a
  reviewed artifact.
- **Remove recognition of inline plan input.** Rejected because a bounded
  `BLOCKED/NEEDS_CONTEXT` response gives direct callers an explicit recovery
  path without misreading the prose as an ad hoc task.
