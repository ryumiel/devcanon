# ADR-0016: Single-Task `--auto` Final-Review Carve-Out

## Status

Accepted

## Context

ADR-0007 established that single-task plans in `play-subagent-execution`
skip the per-task spec-compliance and code-quality reviewers, but keep the
final whole-implementation code-quality reviewer at the end of the skill.
ADR-0015 later added the skip-dispatch optimization for fully mechanical
single-task plans while keeping that same final reviewer in place.

In the `issue-priming-workflow --auto` path, Phase 6 invokes
`play-subagent-execution` and Phase 7 immediately invokes
`branch-review --fix` on the resulting diff. For single-task plans, that
means two whole-diff review stages still run back-to-back:

1. `play-subagent-execution`'s final whole-implementation reviewer
2. `branch-review --fix`

This decision narrows the question deliberately: keep multi-task review
behavior unchanged, keep `branch-review --fix` mandatory, and only remove
the redundant final-review step on the `issue-priming-workflow --auto`
single-task path.

## Decision

Add a caller-scoped carve-out to `play-subagent-execution`.

When all of the following hold:

1. the controller is already executing verified controller-local
   `issue-priming-workflow --auto` state with a validated matching
   `issue-priming/auto-handoff/v1` artifact
2. the parent actively carries the plan path and digest it observed from the
   current `play-planning` return through the direct executor handoff
3. that parent state guarantees downstream `branch-review --fix` is the
   mandatory next step
4. the extracted plan has exactly one task
5. the plan has zero no-code entries

then `play-subagent-execution` skips its final whole-implementation
code-quality reviewer and returns directly to the caller after the
single-task implementation path completes. Any no-code entry requires D16 with
the whole implementation context before returning to Phase 7.

All other paths remain unchanged:

- multi-task plans kept their existing review behavior at the time of
  ADR-0016; ADR-0018 later refines that path to risk-based routing with
  `spec-and-quality` as the hard-risk and fail-closed route
- direct/manual single-task invocations still run the final
  whole-implementation reviewer
- ADR-0015's skip-dispatch optimization remains internal to Phase 6; it now
  inherits this caller-scoped carve-out instead of implying the final
  reviewer runs on every plan

The caller signal is not bearer prose. The active parent retains its observed
planning return through the direct handoff; copied or replayed text cannot
recreate it. No new provenance receipt, artifact, schema, leaf identity, or
plan-shape branching is introduced; the existing auto-handoff audit artifact
remains unchanged.

## Consequences

- The common `issue-priming-workflow --auto` single-task path drops one
  redundant whole-diff review pass only with zero no-code entries; otherwise
  D16 reviews the whole implementation context before Phase 7.
- Review-policy ownership stays inside `play-subagent-execution`, the skill
  that already owns reviewer dispatch.
- Manual/direct callers are not weakened; they keep the final
  whole-implementation reviewer unless a future ADR changes that path too.
- ADR-0007 and ADR-0015 must be updated so they no longer state the old
  "final reviewer always runs" invariant.

## Alternatives considered

- **Workflow-level branch in `issue-priming-workflow` Phase 6.** Rejected:
  duplicates execution-tier logic in the parent workflow and weakens the
  existing separation of concerns.
- **Broaden the skip to all single-task plans.** Rejected: direct/manual
  invocations would lose their only built-in whole-implementation reviewer.
- **Keep the current overlap and clarify the prose only.** Rejected: does
  not solve the redundant review cost.

## Related

- ADR-0007: review pipeline delineation between per-task and branch review
- ADR-0015: skip-dispatch path for trivial single-task plans
