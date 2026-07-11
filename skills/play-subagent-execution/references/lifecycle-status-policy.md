# Lifecycle And Status Policy - `play-subagent-execution`

This file contains execution-specific lifecycle and implementer status details.
Load it when updating the lifecycle ledger, interpreting implementer statuses,
or deciding whether sessions may be closed.

## Subagent Lifecycle

Use `subagent-lifecycle` for the generic controller lifecycle ledger, target
lifecycle capability classification, cleanup gate before spawns, target-honest
cleanup outcomes, and slot-limit recovery. `play-subagent-execution` owns only
the execution-specific lifecycle details below.

For this workflow, role-specific captured state includes implementer reports,
changed files, test results, snapshot state (`requested`, `emitted`, `skipped`,
or `malformed`), reviewer scope, reviewer report, concrete findings, reviewer
integration-result state (`pending` or `integrated`), reviewer disposition
(`final-pass`, `final-findings`, `advisory`, `stale`, or `superseded`), routing
target, re-review target, task base/head SHA, reviewed head SHA, fixup count,
and blocker state when applicable. Run the
shared cleanup gate before dispatching the next implementer, reviewer,
re-reviewer, or final reviewer.

The cleanup gate must not close a task implementer while same-session
spec-compliance or code-quality reviewer fix loops may still route fixups back
to that implementer session. For multi-task plans, preserve the implementer
session until every reviewer loop required by the task's effective route
passes, unless the target lacks same-session follow-up and a fresh implementer
can receive the complete captured state.

When an executor-retained implementer no longer needs same-session follow-up,
append `retention-resolved` with evidence that the need finished or its state
was captured and safely replaced. Preserve each historical `close-deferred`
event and reason. The canonical immediate projection keeps cleanup evaluation
`evaluated`, sets current cleanup decision to `none`, clears current retention
and unavailable reasons, and projects `closed=no`; histories and resolution
evidence remain append-only. A later close or `closure-unavailable` event
selects an existing cleanup family.

For slot exhaustion, record a new current recovery episode identity and its
capacity-blocker snapshot before cleanup. Bind every close or
`manual-cleanup-confirmed` event used for retry to that episode and blocker.
Earlier episode evidence remains history but never authorizes a later retry.
`manual-cleanup-confirmed` is separate row-scoped retry authorization, not
closure proof, `retention-resolved`, or another cleanup family.

## Handling Implementer Status

Before acting on any returned status, update the lifecycle ledger for that
session with the status and the artifacts that status actually provides. For
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

### DONE

For multi-task plans, apply the task's effective review route.
`spec-and-quality` dispatches spec-compliance and code-quality review against
the same captured task head when practical, then applies the same-head
disposition rules. `spec-only` proceeds to spec-compliance review and then marks
the task complete after approval. `none-final-only` marks the task complete
after implementer self-review and commit. For single-task plans, mark the task
complete.

### DONE_WITH_CONCERNS

The implementer completed the work but flagged doubts. Read the concerns before
proceeding. If concerns are about correctness or scope, address them before
continuing. For multi-task plans, then apply the task's effective review route;
for single-task plans, mark the task complete after addressing concerns. If the
concerns are observations, note them and proceed to the next route step.

### Spec-And-Quality Reviewer Disposition

For multi-task `spec-and-quality` routes, dispatch both reviewers against the
same captured task head when practical and record each controller-local
integration-result state as `pending` until its report is integrated. This is
not a reviewer disposition: reviewer disposition remains absent until the
controller classifies the integrated result, then appends a value-bearing
classification with reason and source-state history. A quality result may
become final only after same-head spec pass and current task-head validation. A
same-head quality pass becomes
`final-pass` only when the spec reviewer also passes for that reviewed head;
same-head quality findings become `final-findings` only after same-head spec
pass and current task-head validation.

If spec fails, concurrent quality findings may be routed with the spec findings
as advisory same-head context, but the quality result remains `advisory` until a
same-head spec pass exists. The advisory, stale, and superseded quality results
remain lifecycle evidence but must not mark the task complete. After a spec
fixup or any other head-changing commit, the prior quality result is `stale` or
`superseded` for final disposition. Rerun quality after any spec fixup unless
irrelevance is proven from the refreshed diff; unclear freshness or unclear
irrelevance fails closed to rerunning code quality.

### Fixup Route Revalidation

When a reviewer routes findings back to the implementer and the implementer
commits a fixup, refresh the task head SHA and revalidate the effective review
route against the original task base before skipping any remaining reviewer or
marking the task complete. The route may only stay the same or escalate
(`none-final-only` -> `spec-only` or `spec-and-quality`; `spec-only` ->
`spec-and-quality`). It must not downgrade after fixups.

If revalidation escalates a `spec-only` task to `spec-and-quality` after spec
review has already passed, dispatch the code-quality reviewer before
completion. If a `spec-and-quality` spec fixup lands, rerun spec and rerun
quality unless irrelevance is proven; when unsure, rerun quality.

### NEEDS_CONTEXT

The implementer needs information that was not provided. Provide the missing
context and re-dispatch.

### BLOCKED

Assess the blocker:

1. If it is a context problem, provide more context and re-dispatch with the
   same model.
2. If the task requires more reasoning, re-dispatch with a more capable model.
3. If the task is too large, break it into smaller pieces.
4. If the plan itself is wrong, escalate to the user.

Record blocker state as a stable family plus brief detail, for example
`context-missing: needs target install path` or `task-too-large: generated
prompt exceeds context`. The family is the text before the first colon and is
what repeated-blocker checks compare.

If a spawned implementer reports BLOCKED after slot-limit recovery succeeds and
the blocker family already appears in the lifecycle ledger for that task, treat
it as repeated blocker-family behavior and escalate through the existing path
above instead of running another cleanup retry.

Never ignore an escalation or force the same model to retry without changes.
