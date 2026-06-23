# Phase 6 Auto-Handoff Reference

Load this reference when `issue-priming-workflow` reaches Phase 6 and needs the
detailed auto-handoff mechanics. `SKILL.md` remains the eager authority for
parent workflow orchestration, lifecycle obligations, executor invocation, and
Phase 7 sequencing. This reference explains the support contract without
changing helper behavior or executor route policy.

## Helper Interface

`scripts/write-auto-handoff.sh` is the deterministic authority for creating the
Phase 6 auto-handoff artifact.

- Cwd: issue worktree repository root.
- Input environment: `PLAN_PATH=<repo-relative .ephemeral/*-plan.md path>`.
- Output: stdout contains only the repo-relative artifact path.
- Path shape: `.ephemeral/issue-priming-auto-handoff-<head_sha>.json`.
- Failure: any nonzero exit stops Phase 6 before `play-subagent-execution`;
  `SKILL.md` must not provide an inline fallback.

The controller validates `PLAN_PATH` before invoking this helper:

```bash
bash "$PHASE_ARTIFACTS_HELPER" validate-read plan "$PLAN_PATH"
```

Then it invokes the helper from the issue worktree root:

```bash
AUTO_HANDOFF_FILE=$(
  PLAN_PATH="$PLAN_PATH" \
    bash "$ISSUE_PRIMING_WORKFLOW_DIR/scripts/write-auto-handoff.sh"
)
```

The helper owns repository-root checks, `.ephemeral` write mechanics, unsafe
path rejection, symlink and file-kind guards, current `HEAD` capture, temporary
file writing, atomic replacement, and the stdout path contract.

## Artifact Schema

The helper writes a JSON artifact with this schema:

```json
{
  "schema": "issue-priming/auto-handoff/v1",
  "phase": "issue-priming-workflow:6",
  "mode": "auto",
  "plan_path": "<PLAN_PATH>",
  "head_sha": "<git HEAD sha>",
  "phase7_branch_review_fix_required": true,
  "phase7_rerun_after_commits": true,
  "phase7_final_approval_summary_notice_required": true
}
```

The artifact is audit evidence for the executor. It is not a bearer token and
does not authorize reduced routes by itself.

## Parent State

Phase 6 carries two controller-local values into the executor:

- `ISSUE_PRIMING_AUTO_PARENT_ACTIVE=true`
- `ISSUE_PRIMING_AUTO_HEAD=<git HEAD sha captured before handoff>`

This state is intentionally controller-local because repository files and
copied invocation prose can be forged or replayed. Reduced-route eligibility
requires both the active parent state and a validated
`issue-priming/auto-handoff/v1` artifact that matches the plan path and parent
head.

## Executor Route Boundary

`issue-priming-workflow` provides the plan path, auto-handoff path, and
controller-local parent state. It does not compute per-task review routes.

The executor-owned route authority is
[`play-subagent-execution/references/review-routing-policy.md`](../../play-subagent-execution/references/review-routing-policy.md).
That policy owns reduced-route eligibility validation, route computation,
hard-risk classification, same-head reviewer handling, and fail-closed route
selection.

Phase 6 must fail closed for route eligibility:

- reduced routes are available only on the verified
  `issue-priming-workflow --auto` handoff path;
- missing, malformed, stale, ambiguous, unclear, invalid, or unverified
  reduced-route state uses `spec-and-quality`;
- these unverified states do not abort implementation by themselves; they only
  disable reduced per-task routes.

## Lifecycle Before Handoff

Before invoking `play-subagent-execution`, run the `subagent-lifecycle` cleanup
gate for completed or superseded gate and research sessions. Capture
role-specific state first. Close sessions only when the target reports
`automatic-close-supported`; otherwise record the target-honest
`close-unavailable` outcome and continue to the handoff.

## Single-Task Final-Review Carve-Out

The single-task carve-out is narrow and caller-scoped. It exists because this
parent workflow immediately requires Phase 7 `branch-review --fix` on the full
branch diff after Phase 6 completes.

When the executor validates the active `issue-priming-workflow --auto` parent
state, validates the matching auto-handoff artifact, and extracts exactly one
task, it may skip its own final whole-implementation code-quality reviewer and
return to this workflow after implementation. Direct or manual executor calls do
not receive that carve-out.

The carve-out is not a standalone shortcut. Its safety depends on the mandatory
Phase 7 whole-diff review guarantee described below.

When the extracted execution context contains present Contract Example
Discipline obligations, the executor may include bounded
`contract_example_discipline` context in its terminal risk signals. That context
is not a substitute for Phase 7 review. It exists so branch-review can preserve
the source-owned contract signal after this single-task carve-out and expose
only sanitized semantic notes to downstream reviewers.

## Phase 7 Final-Review Guarantee

Phase 6 completion is not terminal. Successful executor completion returns
control to `issue-priming-workflow`, which must continue to Phase 7 and then
Phase 8 unless a concrete blocker stops `--auto`.

Phase 7 invokes `branch-review --fix` on the full branch diff. If
`branch-review --fix` creates any branch-review-owned fix commit, Phase 7
reruns on the new `HEAD`. Phase 8 may start only after the final Phase 7 run
reports:

- zero blocking findings auto-fixed;
- no unresolved remaining `Blocking` findings except findings whose `critic`
  verdict is `INVALID` or `DOWNGRADE`;
- a captured final approval-summary notice path; and
- fresh final approval-summary evidence after branch-review-owned fix commits.

This final whole-diff review is the downstream guarantee that supports both
reduced per-task routes and the single-task final-review carve-out.
The auto-handoff artifact records that the final approval-summary notice is a
required Phase 7 guarantee so `play-subagent-execution` can verify the reduced
route contract mechanically, not only from prose.

## Failure Modes

- Missing or unreadable `PLAN_PATH`: stop Phase 6 before writing the handoff.
- Helper exits nonzero: stop Phase 6 before invoking the executor.
- Handoff artifact missing, malformed, stale, mismatched to the plan path or
  parent head, or not validated with active parent state: use
  `spec-and-quality`.
- Direct/manual executor invocation with copied `Auto handoff:` prose: use
  `spec-and-quality`.
- Executor completes successfully: return to this workflow; continue to the
  mandatory Phase 7 final review.
