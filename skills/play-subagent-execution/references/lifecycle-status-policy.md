# Lifecycle And Status Policy - `play-subagent-execution`

This file is the sole normative owner of returned D12/D13 dispositions,
D14/D15 result freshness and invalidation, D14-D16 guard capture and cleanup
failure, and incomplete or terminal outcomes. Load it after initial route
selection when updating the lifecycle ledger, interpreting returned statuses,
or deciding whether sessions may be closed.

Pre-dispatch D13 selection and fallback belong to
[`skip-dispatch-policy.md`](skip-dispatch-policy.md). Initial per-task review
selection belongs to
[`review-routing-policy.md`](review-routing-policy.md). Child prompts own child
actions and report schemas; they do not override the transitions below.

## Subagent Lifecycle

Use `subagent-lifecycle` for the generic controller lifecycle ledger, target
lifecycle capability classification, cleanup gate before spawns, target-honest
cleanup outcomes, and slot-limit recovery. `play-subagent-execution` owns only
the execution-specific lifecycle details below.

For this workflow, role-specific captured state includes D12 implementer and
D13 executor reports,
changed files, test results, snapshot state (`requested`, `emitted`, `skipped`,
or `malformed`), reviewer scope, reviewer report, concrete findings, reviewer
result disposition (`pending`, `final-pass`, `final-findings`, `advisory`,
`stale`, or `superseded`), routing target, re-review target, task base/head SHA,
reviewed head SHA, fixup count, and blocker state when applicable. Run the
shared cleanup gate before dispatching the next implementer, reviewer,
re-reviewer, or final reviewer.

The cleanup gate must not close a task implementer while same-session D14 or
D15 reviewer fix loops may still route fixups back to that implementer session.
For multi-task plans, preserve the implementer
session until every reviewer loop required by the task's effective route
passes, unless the target lacks same-session follow-up and a fresh implementer
can receive the complete captured state.

## Handling Mutable Task-Worker Status

Before acting on any returned D12 implementer or dispatched D13 executor
status, update the lifecycle ledger for that session with the status and the
artifacts that status actually provides. For
`DONE` and `DONE_WITH_CONCERNS`, capture the report, snapshot state
(`requested`, `emitted`, `skipped`, or `malformed`), changed-file list,
base/head SHA, and test result before dispatching reviewers. When snapshot
state is `skipped`, use the default DONE fields plus controller-computed git/disk
reads. When snapshot state is `malformed`, surface the incident and still fall
back to the default DONE fields plus controller-computed git/disk reads.

For `NEEDS_CONTEXT` and `BLOCKED`, capture the status, report or
blocker/context request, `agent_id`, and any available base/head SHA; do not
wait for snapshot, changed-file, or test artifacts that were not produced. Run
the cleanup gate before dispatching the next reviewer, re-reviewer,
implementer, or final reviewer.

Only a D13 `DONE` or `DONE_WITH_CONCERNS` enters DONE-report and snapshot
capture before task completion.

### DONE

For multi-task plans, apply the task's effective review route.
`spec-and-quality` dispatches separate D14 and D15 deep-review sessions against
the same captured task head when practical, then applies the same-head
disposition rules. `spec-only` proceeds to D14 spec review and then marks
the task complete after approval. `none-final-only` marks the task complete
after implementer self-review and commit. For single-task plans, mark the task
complete.

### DONE_WITH_CONCERNS

A D13 `DONE_WITH_CONCERNS` report with judgment-bearing concerns keeps the task
incomplete and routes the report to D12; purely observational concerns may
proceed through the selected route.

The implementer completed the work but flagged doubts. Read the concerns before
proceeding. If concerns are about correctness or scope, address them before
continuing. For multi-task plans, then apply the task's effective review route;
for single-task plans, mark the task complete after addressing concerns. If the
concerns are observations, note them and proceed to the next route step.

### Spec-And-Quality Reviewer Disposition

For multi-task `spec-and-quality` routes, D14 is a separate response-only
`deep-reviewer`, frontier/xhigh and source-immutable, with zero handoffs. D15 is
a separate response-only `deep-reviewer`, frontier/xhigh and source-immutable,
with zero handoffs. Dispatch both against the same captured task head when
practical and record both as `pending` until their reports are integrated. A
quality result may become final only after same-head spec pass and current
task-head validation. A same-head quality pass becomes
`final-pass` only when the spec reviewer also passes for that reviewed head;
same-head quality findings become `final-findings` only after same-head spec
pass and current task-head validation.

If spec fails, concurrent quality findings may be routed with the spec findings
as advisory same-head context, but the quality result remains `advisory` until a
same-head spec pass exists. The advisory, stale, and superseded quality results
remain lifecycle evidence but must not mark the task complete. Every fix commit
invalidates both D14 and D15 results, including a previously passing or
provisional result; both reviews must run fresh against the new same task head.

### Fixup Route Revalidation

When a reviewer routes findings back to the implementer and the implementer
commits a fixup, refresh the task head SHA and revalidate the effective review
route against the original task base before skipping any remaining reviewer or
marking the task complete. The route may only stay the same or escalate
(`none-final-only` -> `spec-only` or `spec-and-quality`; `spec-only` ->
`spec-and-quality`). It must not downgrade after fixups.

If revalidation escalates a `spec-only` task to `spec-and-quality` after a
head-changing fix, rerun both D14 and D15 fresh against the new same task head
before completion. If a `spec-and-quality` fixup lands, rerun both D14 and D15.
A fix never preserves either review verdict.

### Guarded Review Lifecycle

D14 and D15 inspect the same captured task head but use separate sessions,
separate prompts, separate baselines, and independent GUARD-001 lifecycles.
Each route follows this exact order: capture before spawn verify before
semantic validation or consumption validate and retain the response in
controller memory cleanup the exact retained baseline apply the retained result
only after cleanup. Every post-capture terminal path attempts cleanup.

After safe cleanup, an unavailable, failed, malformed, or
verification-rejected D14 or D15 keeps the task incomplete and returns
`BLOCKED` naming the failed review; no verdict passes. Detected source mutation
or cleanup failure is guard-integrity terminal. Keep the source visible and do
not repair it. Capture failure prevents spawn and returns the same
task-incomplete `BLOCKED` state without inventing cleanup evidence.

### D16 Final Review Lifecycle

D16 is a fresh response-only `deep-reviewer`, frontier/xhigh and
source-immutable, with zero handoffs, after all tasks complete. D16 reviews the
whole implementation range and never reuses or collapses the D15 task-quality
session. The only D16 skip is the exact ADR-0016 verified
`issue-priming-workflow --auto` single-task carve-out.

A passing retained D16 result continues to the owning-caller or direct/manual
terminal path only after cleanup. D16 blocking findings keep final review
incomplete, route to the D12 implementer for a fix, and require a fresh D16
capture, spawn, verify, validate, cleanup, and apply cycle after the fix commit.
After safe cleanup, an unavailable, failed,
malformed, or verification-rejected D16 keeps final review incomplete and
returns `BLOCKED` to the owning caller or direct/manual terminal-status path;
it never enters branch finish. D16 detected source mutation or cleanup failure
is guard-integrity terminal. Capture failure prevents spawn and returns the
same final-review-incomplete `BLOCKED` state without inventing cleanup evidence.

### D13 Exact-Task Boundary Failure

For a dispatched D13 executor, `NEEDS_CONTEXT` or `BLOCKED` caused by judgment,
policy interpretation, a clarifying question, missing authorization, or widened
scope stops D13 and reclassifies the task to D12. Do not redispatch D13 with
more context or a more capable model. The controller applies this boundary
check before the D12 status handling below.

### D13 Non-Boundary Operational Blocker

A non-boundary operational D13 `BLOCKED` also stops D13, keeps the task
incomplete, and routes the blocker plus any available base/head SHA and
snapshot state to D12 for judgment-bearing recovery. Never redispatch or
model-escalate D13, and never mark a non-DONE D13 result complete.

### NEEDS_CONTEXT

For a D12 implementer, `NEEDS_CONTEXT` means required information was not
provided; provide the missing context and redispatch D12 when the task remains
within its judgment-bearing scope.

### BLOCKED

D12 remains the shipped `implementer`, balanced/high; no `BLOCKED` disposition
changes its role, capability, or effort. If a context problem can be resolved
within the task's existing scope, provide that context and redispatch the same
D12 pair. Otherwise keep the task incomplete and route the blocker through the
owning caller's separately defined recovery or escalation policy. If no such
route is available, return `BLOCKED`; do not invent a dispatch-time model or
effort override.

Record blocker state as a stable family plus brief detail, for example
`context-missing: needs target install path` or `task-too-large: generated
prompt exceeds context`. The family is the text before the first colon and is
what repeated-blocker checks compare.

If a spawned D12 implementer reports BLOCKED after slot-limit recovery succeeds
and the blocker family already appears in the lifecycle ledger for that task,
treat it as repeated blocker-family behavior and escalate through the existing
path above instead of running another cleanup retry.

Never ignore an escalation or force the same model to retry without changes.
