# Phase 6 Auto-Handoff Reference

Use [phase-artifacts usage](phase-artifacts-usage.md) for the guarded plan
read and [write-auto-handoff usage](write-auto-handoff-usage.md) for handoff
creation. A nonzero helper result stops Phase 6 before executor dispatch; this
workflow does not provide an inline fallback.

## Artifact Schema

The handoff artifact has schema `issue-priming/auto-handoff/v1`, identifies
Phase 6 auto mode, the plan path, and the parent head, and records that Phase 7
requires branch-review fix handling, rerun after branch-review commits, and a
final approval-summary notice. It is audit evidence, not a bearer token.

## Parent State

Phase 6 carries `ISSUE_PRIMING_AUTO_PARENT_ACTIVE=true` and a pre-handoff
`ISSUE_PRIMING_AUTO_HEAD` only as controller-local state. Reduced-route
eligibility requires both that state and a validated matching artifact.

## Executor Route Boundary

The executor owns route computation under
[review-routing-policy.md](../../play-subagent-execution/references/review-routing-policy.md).
Missing, malformed, stale, ambiguous, unclear, invalid, or unverified route
state uses `spec-and-quality`; it does not itself abort implementation.

## Lifecycle Before Handoff

Before executor dispatch, run the `subagent-lifecycle` cleanup gate for
completed or superseded gate and research sessions. Capture role-specific state
first; close only when automatic close is supported, otherwise record
`close-unavailable` and continue.

## Single-Task Final-Review Carve-Out

The narrow carve-out applies only to a verified auto parent, matching handoff,
and exactly one extracted task. It skips only the executor's final
whole-implementation code-quality reviewer because this workflow immediately
requires Phase 7 whole-branch review. Direct or manual executor calls do not
receive it. Sanitized contract-example context may be included in terminal risk
signals, but never replaces Phase 7 review.

## Phase 7 Final-Review Guarantee

Successful execution returns here for Phase 7 and then Phase 8 unless blocked.
Phase 7 runs `branch-review --fix` on the full branch diff and reruns after any
branch-review-owned fix commit. Phase 8 starts only after final evidence shows
zero blocking findings auto-fixed, no unresolved blocking finding except
`INVALID` or `DOWNGRADE`, and fresh final approval-summary evidence.

## Failure Modes

Missing plan evidence or writer failure stops Phase 6. An invalid handoff or
copied direct/manual handoff prose uses `spec-and-quality`. Successful executor
completion returns to the mandatory Phase 7 final review.
