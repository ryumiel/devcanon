# ADR-0023: `play-planning` Implementer Executability Gate

## Status

Superseded by
[ADR-0030](adr-0030-play-planning-readiness-and-parallel-digest-gates.md)

## Context

`play-planning` already owns conversion from researched design intent into an
implementation plan and validates that plan against the source requirements
before any execution handoff. That validation catches requirement coverage and
scope drift, but it does not fully answer a different question: whether each
task is executable by an implementer from the written task text and named
source files.

Plans can be structurally aligned with a design while still depending on hidden
senior judgment, unstated call-site discovery, unclear side-effect ownership,
missing validation order, unspecified rollback behavior, or vague instructions
such as "preserve existing behavior" without concrete pass/fail criteria. Those
gaps are most expensive after execution starts, because the executor and
implementers then have to infer policy that should have been explicit at the
planning boundary.

## Decision

`play-planning` has a separate workflow-local Implementer Executability Review
after Plan Review and before Execution Handoff.

The gate validates implementation readiness, not requirement coverage or
executor review routing. It checks that boundary-touching tasks include
task-local operation maps when applicable, including current source, target
surface, required and optional inputs, missing or empty behavior, outputs,
errors, write targets or side-effect owner, validation order, failure behavior,
forbidden side effects, dirty or rollback behavior, and required verification.

Both Plan Review and Implementer Executability Review must pass on the same
final plan contents before `play-planning` may return a parent-owned handoff.
Failed, missing, or unreadable executability review blocks issue-priming auto
handoffs and review-response parent-owned handoffs before
`play-subagent-execution` can be invoked. If executability review causes a plan
edit, the edited plan returns through Plan Review before a fresh executability
pass. `play-planning` still does not start execution itself.

The reviewer remains workflow-local to `play-planning`. It is not promoted to a
source agent because the durable role currently has a single owning workflow
call site and no standalone identity beyond that planning boundary.

## Consequences

- Planning gains one additional review phase for implementation readiness.
- Parent workflows can treat `Plan written to <path>.` as a two-gate planning
  return for their owned routes.
- Execution routing remains owned by `play-subagent-execution`; the new gate
  does not choose per-task review routes or replace executor validation.
- Plans that are requirement-aligned but non-executable fail earlier, while the
  plan is still the right artifact to revise.
- The gate remains lighter than a promoted source agent unless reuse expands
  beyond the `play-planning` boundary.

## Alternatives considered

- **Fold executability into Plan Review.** Rejected because requirement
  conformance and implementer readiness are separate review questions with
  different failure modes.
- **Promote a source implementer-executability reviewer agent immediately.**
  Rejected because the role has one durable call site and should stay
  workflow-local until reuse or standalone constraints justify promotion.
- **Leave readiness to `play-subagent-execution` and implementers.** Rejected
  because that moves plan-authoring gaps into implementation, where fixes are
  slower and may require reverse-engineering unstated source policy.
- **Let parent workflows decide whether to require the gate.** Rejected because
  `play-planning` owns plan readiness; parent-owned execution handoffs should
  receive only plans that have passed both planning gates.
