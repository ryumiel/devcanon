# Example Workflow — `play-subagent-execution`

An end-to-end illustration of the multi-task subagent-driven flow. The
execution procedure itself lives in `SKILL.md` § The Process; the generic
lifecycle ledger, target capability classes, cleanup gate, target-honest
cleanup outcomes, and slot-limit recovery live in `subagent-lifecycle`. This
file is illustrative.

The example below shows a multi-task plan with coherent authored tasks. The
executor follows the authored plan boundaries; it does not do runtime regrouping or batching. Each multi-task task follows the executor-computed
review route: hard-risk and unclear tasks run `spec-and-quality`, medium-risk
tasks may run `spec-only`, and low-risk tasks may use `none-final-only` only
on the verified shared `issue-priming-workflow --auto` Phase 6 path with
controller-local parent state and a valid `issue-priming/auto-handoff/v1`
artifact, where Phase 7 reruns
`branch-review --fix` after any branch-review-owned fix commit until the
final run reports zero blocking findings auto-fixed, no unresolved remaining
`Blocking` findings except findings whose `critic` verdict is `INVALID` or
`DOWNGRADE`, has a captured final approval-summary notice path, and provides
fresh final approval-summary evidence after branch-review-owned fix commits. For a
**single-task plan** the per-task reviewer dispatches are skipped (see
"Single-Task Plans" in `SKILL.md`). On a direct/manual single-task run, the
flow shrinks to: dispatch implementer -> implementer self-reviews and commits
-> mark task complete -> final whole-implementation code-quality reviewer ->
report implementation and final review status -> resolve branch-level review
status -> hand off to `branch-review --fix` before `play-branch-finish` when
the active workflow requires branch-level review before PR creation and
owning-workflow or explicit operator authority allows auto-committing fixes;
otherwise hand off to branch-review without auto-fix authority, wait for review
approval evidence, or invoke `play-branch-finish` only when branch-level review
is not required.
On the `issue-priming-workflow --auto` single-task path, the flow instead
returns to the caller after task completion so Phase 7 `branch-review --fix`
becomes the whole-diff gate.

```
You: I'm using Subagent-Driven Development to execute this plan.

[Read plan file once: .ephemeral/feature-plan.md]
[Extract all 3 coherent authored tasks with full text and context]
[Create TodoWrite with all tasks]
[Use subagent-lifecycle to detect target lifecycle capability]
Target capability for this run: automatic-close-supported

Task 1: Hook lifecycle

[Cleanup gate before spawn]
Ledger: no completed or superseded sessions to close.

[Get Task 1 text and context (already extracted)]
[Ledger pre-dispatch]
Task 1 implementer: agent_id=pending, role=implementer, operational state=pending, events=[dispatch-requested], workflow return status absent, base/head SHA captured (head pending), cleanup evaluation=not-evaluated, cleanup outcome=closed=no
[Snapshot classification]
Controller requests a snapshot: install/sync behavior is hard-risk and benefits
from post-commit line-range extraction. Plan snapshot hints, if any, are
advisory only.
[Ledger update]
Task 1 implementer: snapshot state=requested.
[Dispatch implementation subagent with full task text + context]
[Ledger post-dispatch]
Task 1 implementer: agent_id=impl-1, role=implementer, operational state=active, events=[dispatch-requested, identity-assigned], workflow return status absent, base/head SHA captured (head pending), cleanup evaluation=not-evaluated, cleanup outcome=closed=no

[Ledger shorthand used below]
Every later implementer, reviewer, re-reviewer, and final reviewer dispatch gets its own row: `agent_id=pending`, operational state=pending, and events=[dispatch-requested] before dispatch; then the observed stable `agent_id`, operational state=active, and events=[dispatch-requested, identity-assigned] after dispatch. Workflow return status and reviewer disposition are absent until observed or classified. Every returned turn appends `turn-completed(status=<value>)` to workflow return history, and every reviewer classification appends `reviewer-disposition-classified(disposition=<value>, reason=<reason>, source-state=<anchor>)` to disposition history; current projections use the latest values. Cleanup checkpoints retain the ordered events while projecting cleanup separately.
For every executor row below, cleanup evaluation is `not-evaluated` only before that row's first cleanup gate. Every cleanup gate transitions each examined row to `evaluated` before deciding whether to close or retain it. An evaluated row deliberately retained for required same-session follow-up records `event=close-deferred(reason=<concrete workflow reason>)`, the matching current retention reason, and `cleanup outcome=closed=no` without fabricating `close-attempted` or `close-failed`; later turns and gates keep the event-associated reason as append-only history. Rows with `close-succeeded` remain terminal `closed=yes`.

Implementer: "Before I begin - should the hook be installed at user or system level?"
You: "User level (~/.config/agent-hooks/)"
[Later] Implementer:
  - Implemented install, verify, and remove hook lifecycle commands
  - Files changed: src/hooks/install.ts, tests/hooks/install.test.ts
  - Added tests, 12/12 passing
  - Self-review: Found I missed --force replacement coverage, added it
  - Committed

[Lifecycle ledger update]
Task 1 implementer: operational state=completed, event=turn-completed(status=DONE) appended after dispatch-requested and identity-assigned, workflow return history=[DONE], current workflow return status=DONE, report captured, base/head SHA captured, changed files captured, snapshot state=emitted, test state captured, cleanup evaluation=not-evaluated, cleanup outcome=closed=no because reviewer fix loops may still need same-session follow-up

[Compute effective review route]
Hard-risk trigger detected: install/sync behavior or user-home writes.
Effective route: `spec-and-quality`.

[Parallel happy path: same-head spec and quality pass]
[Cleanup gate before Task 1 reviewer spawn]
Controller keeps Task 1 implementer open for possible reviewer fixups. Because
the effective route is `spec-and-quality`, the controller dispatches both
read-only reviewers against the same captured task head.
Task 1 implementer: cleanup evaluation=evaluated, event=close-deferred(reason=the same implementer session must remain available for reviewer fixups), current retention reason=the same implementer session must remain available for reviewer fixups, cleanup outcome=closed=no; no close attempt or failure is recorded for this decision.

[Ledger pre-dispatch: Task 1 spec reviewer, agent_id=pending, operational state=pending, events=[dispatch-requested]]
[Ledger pre-dispatch: Task 1 code-quality reviewer, agent_id=pending, operational state=pending, events=[dispatch-requested]]
[Dispatch spec compliance reviewer and code-quality reviewer concurrently]
[Ledger post-dispatch: Task 1 spec reviewer, agent_id=spec-1, operational state=active, events=[dispatch-requested, identity-assigned]]
[Ledger post-dispatch: Task 1 code-quality reviewer, agent_id=quality-1, operational state=active, events=[dispatch-requested, identity-assigned]]
Spec reviewer: ✅ Spec compliant - all requirements met, nothing extra
Code-quality reviewer: Strengths: Good test coverage, clean. Issues: None. Approved.

[Lifecycle cleanup checkpoint]
Task 1 implementer: operational state=completed, event=turn-completed(status=DONE) retained, workflow return history=[DONE], current workflow return status=DONE, report captured, base/head SHA captured, changed files captured, snapshot state=emitted, test state captured, cleanup evaluation=evaluated, close-deferred reason history=[same implementer session must remain available for reviewer fixups] retained, event=retention-resolved(evidence=reviewer loops passed and same-session follow-up finished), post-resolution cleanup evaluation=evaluated, current cleanup decision=none, current retention reason=absent, current unavailable-cleanup reason=absent, cleanup outcome=closed=no, then event=close-attempted and event=close-succeeded select the successful-close family, cleanup outcome=closed=yes after reviewer loops passed.
Task 1 spec reviewer: agent_id=spec-1, operational state=completed, event=turn-completed(status=DONE), workflow return history=[DONE], current workflow return status=DONE, review scope captured, base/head SHA captured, reviewed head SHA=task-1-head, report captured, event=reviewer-disposition-classified(disposition=final-pass, reason=spec requirements satisfied, source-state=task-1-head), reviewer disposition history=[final-pass(reason=spec requirements satisfied, source-state=task-1-head)], current reviewer disposition=final-pass, cleanup evaluation=evaluated, event=close-attempted then event=close-succeeded, cleanup outcome=closed=yes.
Task 1 code-quality reviewer: agent_id=quality-1, operational state=completed, event=turn-completed(status=DONE), workflow return history=[DONE], current workflow return status=DONE, review scope captured, base/head SHA captured, reviewed head SHA=task-1-head, report captured, event=reviewer-disposition-classified(disposition=final-pass, reason=same-head spec passed and task head stayed current, source-state=task-1-head), reviewer disposition history=[final-pass(reason=same-head spec passed and task head stayed current, source-state=task-1-head)], current reviewer disposition=final-pass, cleanup evaluation=evaluated, event=close-attempted then event=close-succeeded, cleanup outcome=closed=yes.

[Mark Task 1 complete]

Task 2: Recovery and repair modes

[Get Task 2 text and context (already extracted)]
[Cleanup gate before Task 2 implementer spawn]
Controller verifies Task 1 completed sessions are already closed before spawning Task 2.

[Ledger pre-dispatch: Task 2 implementer, agent_id=pending, operational state=pending, events=[dispatch-requested]]
[Snapshot classification]
Controller requests a snapshot: repair-mode behavior changes workflow policy.
The request is controller-computed; the plan's risk hint is not authoritative.
[Ledger update]
Task 2 implementer: snapshot state=requested.
[Dispatch implementation subagent with full task text + context]
[Ledger post-dispatch: Task 2 implementer, agent_id=impl-2, operational state=active, events=[dispatch-requested, identity-assigned]]
Implementer:
  - Added verify/repair modes
  - 8/8 tests passing
  - Self-review: All good
  - Committed

[Lifecycle ledger update]
Task 2 implementer: agent_id=impl-2, operational state=completed, event=turn-completed(status=DONE), workflow return history=[DONE], current workflow return status=DONE, report captured, base/head SHA captured, changed files captured, snapshot state=emitted, test state captured, cleanup evaluation=not-evaluated, cleanup outcome=closed=no because reviewer fix loops may still need same-session follow-up.

[Compute effective review route]
Plan hints high risk and `spec-and-quality`; repair-mode behavior changes
workflow policy, so a hard-risk trigger is present.
Effective route: `spec-and-quality`.

[Spec-failure stale-quality path]
[Cleanup gate before Task 2 reviewer spawn]
Controller keeps Task 2 implementer open for possible reviewer fixups. Because
the effective route is `spec-and-quality`, both reviewers inspect the same
captured task head before either result is final.
Task 2 implementer: cleanup evaluation=evaluated, event=close-deferred(reason=the same implementer session must remain available for reviewer fixups), current retention reason=the same implementer session must remain available for reviewer fixups, cleanup outcome=closed=no; no close attempt or failure is recorded for this decision.

[Ledger pre-dispatch: Task 2 spec reviewer, agent_id=pending, operational state=pending, events=[dispatch-requested]]
[Ledger pre-dispatch: Task 2 code-quality reviewer, agent_id=pending, operational state=pending, events=[dispatch-requested]]
[Dispatch spec compliance reviewer and code-quality reviewer concurrently]
[Ledger post-dispatch: Task 2 spec reviewer, agent_id=spec-2, operational state=active, events=[dispatch-requested, identity-assigned]]
[Ledger post-dispatch: Task 2 code-quality reviewer, agent_id=quality-2, operational state=active, events=[dispatch-requested, identity-assigned]]
Spec reviewer: ❌ Issues:
  - Missing: Progress reporting (spec says "report every 100 items")
  - Extra: Added --json flag (not requested)
Code-quality reviewer: Strengths: Solid. Issues (Nit): Magic number (100)

[Same-head integration checkpoint before classification]
Task 2 spec reviewer: operational state=completed, event=turn-completed(status=findings-recorded), workflow return history=[findings-recorded], current workflow return status=findings-recorded, controller-local integration-result state=pending, reviewer disposition absent.
Task 2 code-quality reviewer: operational state=completed, event=turn-completed(status=findings-recorded), workflow return history=[findings-recorded], current workflow return status=findings-recorded, controller-local integration-result state=pending, reviewer disposition absent.

[Lifecycle ledger update]
Task 2 spec reviewer: agent_id=spec-2, operational state=completed, event=turn-completed(status=findings-recorded), workflow return history=[findings-recorded], current workflow return status=findings-recorded, controller-local integration-result state=integrated, review scope captured, base/head SHA captured, reviewed head SHA=task-2-head, report captured, event=reviewer-disposition-classified(disposition=final-findings, reason=spec gaps require fixup, source-state=task-2-head), reviewer disposition history=[final-findings(reason=spec gaps require fixup, source-state=task-2-head)], current reviewer disposition=final-findings, findings captured: Missing progress reporting; Extra --json flag, routing target=Task 2 implementer, re-review target=spec-2-rereview, cleanup evaluation=evaluated, event=close-attempted then event=close-succeeded, cleanup outcome=closed=yes after findings routed.
Task 2 code-quality reviewer: agent_id=quality-2, operational state=completed, event=turn-completed(status=findings-recorded), workflow return history=[findings-recorded], current workflow return status=findings-recorded, controller-local integration-result state=integrated, review scope captured, base/head SHA captured, reviewed head SHA=task-2-head, report captured, event=reviewer-disposition-classified(disposition=advisory, reason=same-head quality findings are non-final until spec disposition, source-state=task-2-head), reviewer disposition history=[advisory(reason=same-head quality findings are non-final until spec disposition, source-state=task-2-head)], current reviewer disposition=advisory, findings captured: Magic number (100), routing target=Task 2 implementer if combined same-head findings are routed, re-review target=quality-2-rereview, cleanup evaluation=evaluated, event=close-attempted then event=close-succeeded, cleanup outcome=closed=yes after advisory findings captured and routed.
Controller records the combined spec and code-quality finding set routed to Task 2 implementer because both reviewers inspected the same head.
Task 2 implementer: cleanup evaluation=evaluated, event=close-deferred(reason=routed same-head findings need same-session fixup) appended, prior deferral reason retained, current retention reason=routed same-head findings need same-session fixup, cleanup outcome=closed=no.

[Implementer fixes issues]
[Same-session follow-up dispatch]
Task 2 implementer: agent_id=impl-2 is stable and retained, prior operational state=completed with event=turn-completed(status=DONE), observed same-session reuse capability=positive, operational state=active, workflow return history=[DONE] retained, current workflow return status=DONE, cleanup evaluation=evaluated, close-deferred reason history=[same implementer session must remain available for reviewer fixups; routed same-head findings need same-session fixup] retained, current retention reason=routed same-head findings need same-session fixup, cleanup outcome=closed=no, event=followup-dispatch-requested(session-id=impl-2) appended after the first turn-completed; all prior events retained with their associated reasons, and no attempt or failure event is fabricated for the deferral.
Implementer: Removed --json flag, added progress reporting, extracted PROGRESS_INTERVAL constant

[Lifecycle ledger update]
Task 2 implementer: operational state=completed,
event=turn-completed(status=DONE_WITH_CONCERNS) appended, workflow return
history=[DONE, DONE_WITH_CONCERNS], current workflow return
status=DONE_WITH_CONCERNS, fixup count=1, blocker state=none, report
refreshed, changed files and head SHA refreshed, test state refreshed, snapshot
state=emitted, cleanup evaluation=evaluated,
event=close-deferred(reason=spec re-review and any required code-quality
re-review or disposition are pending) appended, prior deferral reasons retained,
current retention reason=spec re-review and any required code-quality re-review
or disposition are pending, cleanup outcome=closed=no.
Task 2 code-quality reviewer: operational state=completed, workflow return history=[findings-recorded], current workflow return status=findings-recorded, event=reviewer-disposition-classified(disposition=stale, reason=task head advanced after fixup, source-state=task-2-fixup-head) appended, reviewer disposition history=[advisory(reason=same-head quality findings are non-final until spec disposition, source-state=task-2-head), stale(reason=task head advanced after fixup, source-state=task-2-fixup-head)], current reviewer disposition=stale, close history remains close-attempted then close-succeeded, cleanup outcome remains closed=yes. Only the current disposition changes; prior classification history remains append-only. Rerun quality unless irrelevance is proven.

[Revalidate effective review route]
Controller compares the original Task 2 base SHA to the refreshed task head.
The route may only preserve or escalate; the refreshed diff still requires
`spec-and-quality`, so continue to spec re-review and code-quality re-review
unless quality irrelevance is proven. Unclear stale-result classification fails
closed to rerunning code quality.

[Cleanup gate before Task 2 spec re-review spawn]
Controller keeps Task 2 implementer open until spec and required quality
dispositions are final.
Task 2 implementer: cleanup evaluation=evaluated, event=close-deferred(reason=spec and required quality dispositions are not yet final) appended, prior deferral reasons retained, current retention reason=spec and required quality dispositions are not yet final, cleanup outcome=closed=no.

[Ledger pre-dispatch: Task 2 spec re-reviewer, agent_id=pending, operational state=pending, events=[dispatch-requested]]
[Spec re-reviewer reviews again]
[Ledger post-dispatch: Task 2 spec re-reviewer, agent_id=spec-2-rereview, operational state=active, events=[dispatch-requested, identity-assigned]]
Spec reviewer: ✅ Spec compliant now

[Cleanup gate before Task 2 code-quality re-reviewer spawn]
Task 2 spec re-reviewer: operational state=completed, event=turn-completed(status=DONE), workflow return history=[DONE], current workflow return status=DONE, review scope captured, base/head SHA captured, reviewed head SHA=task-2-fixup-head, report captured, event=reviewer-disposition-classified(disposition=final-pass, reason=spec findings resolved, source-state=task-2-fixup-head), reviewer disposition history=[final-pass(reason=spec findings resolved, source-state=task-2-fixup-head)], current reviewer disposition=final-pass, cleanup evaluation=evaluated, event=close-attempted then event=close-succeeded, cleanup outcome=closed=yes.
Task 2 implementer: cleanup evaluation=evaluated, event=close-deferred(reason=code-quality findings may still require same-session follow-up) appended, prior deferral reasons retained, current retention reason=code-quality findings may still require same-session follow-up, cleanup outcome=closed=no.

[Ledger pre-dispatch: Task 2 code-quality re-reviewer, agent_id=pending, operational state=pending, events=[dispatch-requested]]
[Dispatch code-quality re-reviewer]
[Ledger post-dispatch: Task 2 code-quality re-reviewer, agent_id=quality-2-rereview, operational state=active, events=[dispatch-requested, identity-assigned]]
Code-quality reviewer: ✅ Approved

[Lifecycle ledger update]
Task 2 code-quality re-reviewer: operational state=completed, event=turn-completed(status=DONE), workflow return history=[DONE], current workflow return status=DONE, review scope captured, base/head SHA captured, reviewed head SHA=task-2-fixup-head, report captured, event=reviewer-disposition-classified(disposition=final-pass, reason=same-head spec passed and task head stayed current, source-state=task-2-fixup-head), reviewer disposition history=[final-pass(reason=same-head spec passed and task head stayed current, source-state=task-2-fixup-head)], current reviewer disposition=final-pass, cleanup evaluation=evaluated, event=close-attempted then event=close-succeeded, cleanup outcome=closed=yes.

[Lifecycle cleanup checkpoint]
Task 2 implementer: operational state=completed, turn-completed status history=[DONE, DONE_WITH_CONCERNS] retained, workflow return history=[DONE, DONE_WITH_CONCERNS], current workflow return status=DONE_WITH_CONCERNS, report captured, base/head SHA captured, changed files captured, snapshot state=emitted, test state captured, cleanup evaluation=evaluated, close-deferred reason history=[same implementer session must remain available for reviewer fixups; routed same-head findings need same-session fixup; spec re-review and any required code-quality re-review or disposition are pending; spec and required quality dispositions are not yet final; code-quality findings may still require same-session follow-up] retained, event=retention-resolved(evidence=all required reviewer loops passed and same-session fixup need finished), post-resolution cleanup evaluation=evaluated, current cleanup decision=none, current retention reason=absent, current unavailable-cleanup reason=absent, cleanup outcome=closed=no, then event=close-attempted and event=close-succeeded select the successful-close family, cleanup outcome=closed=yes after reviewer loops passed.
Task 2 spec reviewer: agent_id=spec-2, operational state=completed, event=turn-completed(status=findings-recorded) retained, workflow return history=[findings-recorded], current workflow return status=findings-recorded, review scope captured, base/head SHA captured, report captured, concrete findings captured, reviewer disposition history=[final-findings(reason=spec gaps require fixup, source-state=task-2-head)], current reviewer disposition=final-findings, cleanup evaluation=evaluated, event=close-attempted then event=close-succeeded, cleanup outcome=closed=yes.
Task 2 spec re-reviewer: agent_id=spec-2-rereview, operational state=completed, event=turn-completed(status=DONE) retained, workflow return history=[DONE], current workflow return status=DONE, review scope captured, base/head SHA captured, report captured, reviewer disposition history=[final-pass(reason=spec findings resolved, source-state=task-2-fixup-head)], current reviewer disposition=final-pass, cleanup evaluation=evaluated, event=close-attempted then event=close-succeeded, cleanup outcome=closed=yes.
Task 2 code-quality reviewer: agent_id=quality-2, operational state=completed, workflow return history=[findings-recorded], current workflow return status=findings-recorded, event=turn-completed(status=findings-recorded) retained, review scope captured, base/head SHA captured, report captured, concrete findings captured, reviewer disposition history=[advisory(reason=same-head quality findings are non-final until spec disposition, source-state=task-2-head), stale(reason=task head advanced after fixup, source-state=task-2-fixup-head)], current reviewer disposition=stale, cleanup evaluation=evaluated, event=close-attempted then event=close-succeeded retained, cleanup outcome=closed=yes.
Task 2 code-quality re-reviewer: agent_id=quality-2-rereview, operational state=completed, event=turn-completed(status=DONE) retained, workflow return history=[DONE], current workflow return status=DONE, review scope captured, base/head SHA captured, report captured, reviewer disposition history=[final-pass(reason=same-head spec passed and task head stayed current, source-state=task-2-fixup-head)], current reviewer disposition=final-pass, cleanup evaluation=evaluated, event=close-attempted then event=close-succeeded, cleanup outcome=closed=yes.

[Mark Task 2 complete]

Task 3: Low-risk example copy

[Cleanup gate before Task 3 implementer spawn]
Controller verifies every Task 2 row in this automatic-close run already has
event=close-succeeded and cleanup outcome=closed=yes before the Task 3 spawn.

[Snapshot classification]
Controller skips the snapshot: this is a clearly localized low-risk example
copy change. The implementer must report the default DONE fields: status,
summary, tests, files changed, base SHA, and head SHA.
[Ledger pre-dispatch: Task 3 implementer, agent_id=pending, operational state=pending, events=[dispatch-requested]]
[Dispatch implementation subagent with full task text + context]
[Ledger post-dispatch: Task 3 implementer, agent_id=impl-3, operational state=active, events=[dispatch-requested, identity-assigned]]
Implementer:
  - Status: DONE
  - Summary: Clarified one example sentence in a neutral demo note
  - Tests: Not applicable beyond final render/check suite
  - Files changed: docs/examples/demo-note.md
  - Base SHA: task-3-base
  - Head SHA: task-3-head
  - Self-review: Wording matches the plan and no linked identifiers changed
  - Committed

[Compute effective review route]
Plan hints low risk and `none-final-only`; no hard-risk trigger is present;
the verified shared `issue-priming-workflow --auto` Phase 6 path,
controller-local parent state, and valid `issue-priming/auto-handoff/v1`
artifact guarantee final whole-diff review through `branch-review --fix`.
If that later review leaves unresolved remaining `Blocking` findings, the
workflow stops.
Effective route: `none-final-only`.

[Lifecycle cleanup checkpoint]
Task 3 implementer: operational state=completed,
event=turn-completed(status=DONE), workflow return history=[DONE], current
workflow return status=DONE, report captured, base/head SHA captured, changed files
captured, snapshot state=skipped, test state captured, cleanup evaluation=evaluated,
event=close-attempted
then event=close-succeeded, cleanup outcome=closed=yes after the effective
route completed. Controller uses its own git diff and
committed HEAD reads if it needs file content.

[Mark Task 3 complete]

...

[After all tasks]
[Cleanup gate before final code-quality reviewer spawn]
Controller verifies task implementers, reviewers, and re-reviewers are closed, then records the final reviewer pre-dispatch row.
final-code-quality-reviewer: agent_id=pending, role=final-code-quality-reviewer, operational state=pending, events=[dispatch-requested], workflow return status absent, reviewer disposition absent, review scope=whole implementation diff, base/head SHA captured, cleanup evaluation=not-evaluated, cleanup outcome=closed=no.

[Dispatch final code-quality reviewer]
[Ledger post-dispatch: final-code-quality-reviewer, agent_id=final-quality, operational state=active, events=[dispatch-requested, identity-assigned]]
Final reviewer: All requirements met, ready to merge

[Lifecycle cleanup checkpoint]
final-code-quality-reviewer: agent_id=final-quality, operational state=completed, events retain dispatch-requested, identity-assigned, and turn-completed(status=DONE), workflow return history=[DONE], current workflow return status=DONE, review scope captured, base/head SHA captured, report captured, event=reviewer-disposition-classified(disposition=final-pass, reason=whole implementation diff approved, source-state=final-head), reviewer disposition history=[final-pass(reason=whole implementation diff approved, source-state=final-head)], current reviewer disposition=final-pass, cleanup evaluation=evaluated, event=close-attempted then event=close-succeeded, cleanup outcome=closed=yes after final verdict recorded.

[Return to owning caller]
`play-subagent-execution` returns to `issue-priming-workflow --auto`.

[Caller runs final whole-diff gate]
`issue-priming-workflow` Phase 7 runs `branch-review --fix` until a run
reports zero blocking findings auto-fixed and captures that final run's
approval-summary notice path. If a branch-review-owned fix commit lands after
that review, Phase 7 reruns on the new `HEAD` and captures fresh final
approval-summary evidence.
Branch review: no unresolved remaining `Blocking` findings except `INVALID` or
`DOWNGRADE` critic verdicts.

[Caller continues]
`issue-priming-workflow` proceeds to PR creation.

[Alternative target capability examples - separate runs, not the automatic-close run above]

[Abnormal terminal lifecycle variants - separate runs]
Timed-out research row: operational state=timed-out, event=turn-timed-out(reason=runtime deadline elapsed before a return), workflow return status absent, workflow return history absent, research scope and sanitized timeout/blocker detail captured before cleanup.
Failed research row: operational state=failed, event=turn-failed(error=session transport ended before a return), workflow return status absent, workflow return history absent, research scope and sanitized runtime error/blocker detail captured before cleanup.

Returned reviewer follow-up timeout: agent_id=reviewer-timeout is stable, prior operational state=completed, observed same-session reuse capability=positive, prior events=[turn-completed(status=findings-recorded), reviewer-disposition-classified(disposition=advisory, reason=same-head findings await spec integration, source-state=followup-base), followup-dispatch-requested(session-id=reviewer-timeout)], then event=turn-timed-out(reason=follow-up deadline elapsed) appends and current operational state=timed-out. workflow return history=[findings-recorded] and current workflow return status=findings-recorded remain unchanged; reviewer disposition history=[advisory(reason=same-head findings await spec integration, source-state=followup-base)] and current reviewer disposition=advisory remain unchanged; the abnormal follow-up adds no new return value. Reviewer scope, prior report/findings, and sanitized timeout detail are captured before cleanup.

Returned reviewer follow-up failure: agent_id=reviewer-failure is stable, prior operational state=completed, observed same-session reuse capability=positive, prior events=[turn-completed(status=findings-recorded), reviewer-disposition-classified(disposition=final-findings, reason=integrated findings require fixup, source-state=followup-base), followup-dispatch-requested(session-id=reviewer-failure)], then event=turn-failed(error=follow-up transport failed) appends and current operational state=failed. workflow return history=[findings-recorded] and current workflow return status=findings-recorded remain unchanged; reviewer disposition history=[final-findings(reason=integrated findings require fixup, source-state=followup-base)] and current reviewer disposition=final-findings remain unchanged; the abnormal follow-up adds no new return value. Reviewer scope, prior report/findings, and sanitized runtime error are captured before cleanup.

Timed-out then superseded: events retain turn-timed-out(reason=deadline elapsed) then append superseded, current operational state=superseded, abnormal capture state=missing, cleanup evaluation=not-evaluated, cleanup outcome=closed=no, and cleanup eligibility=blocked. Supersession does not make the row cleanup-eligible. Only after the reviewer scope, available report/findings, sanitized timeout detail, and blocker context are captured may the cleanup gate evaluate it.

Failed then superseded: events retain turn-failed(error=runtime disconnected) then append superseded, current operational state=superseded, abnormal capture state=missing, cleanup evaluation=not-evaluated, cleanup outcome=closed=no, and cleanup eligibility=blocked. Supersession does not make the row cleanup-eligible. Only after the reviewer scope, available report/findings, sanitized runtime error, and blocker context are captured may the cleanup gate evaluate it.

[Normal cleanup gate projection variants - separate runs]
The separate families are successful closure, deliberate deferral with reason, failed-attempt `closed=no`, and unavailable closure with reason. After role state capture, a successful row records event=close-attempted then event=close-succeeded and closed=yes; a retained row records event=close-deferred(reason=same-session follow-up remains required) and closed=no; a supported failed attempt records event=close-attempted then event=close-failed and closed=no; an unavailable row records event=closure-unavailable(reason=no usable close operation), unavailable-reason history=[no usable close operation], current unavailable-cleanup reason=no usable close operation, and close-unavailable: no usable close operation. With no slot exhaustion, each target-honest projection may continue through the normal gate.

[Open capacity-blocker classification variants - separate runs]
Active row: wait or steer to a safe boundary and capture required state. After fresh capture, deliberate retention requires no replacement; supersession requires current event=replacement-secured. If capture is unsafe, stop and escalate. Waiting row: capture the open question and context, then retain or safely replace. Reusable interrupted row example: agent_id=support-1 is stable, observed reuse capability=positive, current operational state=interrupted, and events end with interrupted then required-state-captured, so capture is newer than interruption. The controller appends event=interrupted-reuse-dispatch-requested(session-id=support-1), projects current operational state=active, preserves all prior events, and adds no turn-completed event or workflow return. After fresh capture, guarded reuse or deliberate retention requires no replacement; supersession alone requires event=replacement-secured first. Pending or unknown row: resolve identity or stop; do not fabricate cleanup or close another row.

[Isolated lifecycle supersession hypothetical - separate run, not an executor route]
An owning workflow authorizes one generic scoped support session; this does not add a reviewer or fanout branch to `play-subagent-execution`.
Pre-dispatch: agent_id=pending, role=scoped-support, operational state=pending, events=[dispatch-requested], workflow return status absent, cleanup evaluation=not-evaluated, cleanup outcome=closed=no.
Post-dispatch: agent_id=support-1, role=scoped-support, operational state=active, events=[dispatch-requested, identity-assigned], workflow return status absent, cleanup evaluation=not-evaluated, cleanup outcome=closed=no.
Before supersession, the controller captures role-specific state: assigned scope, source-state anchor, and the replacement routing reason. The owning workflow then replaces the still-active session, appends event=superseded, sets current operational state=superseded, preserves dispatch-requested and identity-assigned, and records no turn-completed event or workflow return status. The cleanup gate sets cleanup evaluation=evaluated; with stable identity and usable closure, it appends event=close-attempted then event=close-succeeded and projects cleanup outcome=closed=yes.

[Inventory-only target variant]
Using `subagent-lifecycle` target capability guidance:
Target capability for this separate run: inventory-only: target exposes session inventory but no close operation
Controller first captures each completed session's role-specific state, records open inventory (`impl-1`, `spec-1`, `quality-1`), appends event=closure-unavailable(reason=inventory-only; no close operation), records unavailable-reason history=[inventory-only; no close operation] and current unavailable-cleanup reason=inventory-only; no close operation, and projects cleanup outcome=`close-unavailable: inventory-only; no close operation` instead of claiming closed=yes before dispatching the next agent.

[Tracked-ID-only inventory-only target variant]
Target capability for this separate run: inventory-only: no inventory operation is exposed, but the controller retains tracked stable agent ids and no usable close operation
After capture, the controller appends event=closure-unavailable(reason=tracked stable identity; no close operation), records unavailable-reason history=[tracked stable identity; no close operation] and current unavailable-cleanup reason=tracked stable identity; no close operation, and projects cleanup outcome=`close-unavailable: tracked stable identity; no close operation`.

[Unavailable-to-close reevaluation - separate run]
The evaluated row first appends event=closure-unavailable(reason=stable identity missing), records unavailable-reason history=[stable identity missing] and current unavailable-cleanup reason=stable identity missing, and projects close-unavailable: stable identity missing. When stable identity and a usable close operation later appear, the row appends event=close-attempted then event=close-succeeded and projects cleanup outcome=closed=yes. The current unavailable-cleanup reason is cleared, while event=closure-unavailable(reason=stable identity missing) and unavailable-reason history=[stable identity missing] remain append-only.

[Automatic-close retry projection - separate run]
The session has stable identity and an exposed close operation. The first close records event=close-attempted, event=close-failed, cleanup outcome=closed=no; prior lifecycle events remain. A later retry records event=close-attempted, event=close-succeeded, cleanup outcome=closed=yes without deleting the failed attempt.

[Slot-limit retained-session capacity blocker - separate run]
Controller appends event=slot-recovery-started(episode=recovery-retained-1, blockers=[impl-retained]) and treats that snapshot as the only blocker authority for this recovery attempt. A retained implementer row `impl-retained` blocks capacity with historical event=close-deferred(reason=reviewer fixups require same-session follow-up), close-deferred reason history=[reviewer fixups require same-session follow-up], current cleanup decision=retained, current retention reason=reviewer fixups require same-session follow-up, and cleanup outcome=closed=no. The owning workflow resolves whether same-session follow-up remains required. If it no longer remains, or the controller captures the required state and safely replaces the follow-up need, it appends event=retention-resolved(evidence=reviewer fixup state captured and replacement handoff prepared), preserves the historical close-deferred event and its associated reason, keeps cleanup evaluation=evaluated, sets current cleanup decision=none, sets current retention reason=absent and current unavailable-cleanup reason=absent, and projects cleanup outcome=closed=no. The supported automatic close then appends event=close-attempted(episode=recovery-retained-1, blocker=impl-retained) followed by event=close-failed(episode=recovery-retained-1, blocker=impl-retained), so cleanup outcome remains closed=no. After operator cleanup, the controller separately appends event=manual-cleanup-confirmed(episode=recovery-retained-1, blocker=impl-retained, provenance=operator UI, observed-at=2026-07-11T20:01:00Z); this current-episode, blocker-scoped event authorizes the one retry but is not closure proof, retention resolution, or a cleanup projection family. The historical close-deferred reason and retention-resolved evidence remain append-only, and closed=no remains unchanged. Only then does it reconstruct state and retry the spawn exactly once. Evidence from any earlier recovery episode remains history and cannot authorize this retry. If the need remains and cannot be safely replaced or cleaned up, follow the shared owner: stop and escalate without retrying.

[Resolved-retention cleanup projection variants - separate runs]
Unavailable after resolution: prior event=close-deferred(reason=same-session follow-up required), then event=retention-resolved(evidence=follow-up state captured), cleanup evaluation remains evaluated, current cleanup decision=none, current retention reason=absent, current unavailable-cleanup reason=absent, and cleanup outcome=closed=no. The later unavailable family appends event=closure-unavailable(reason=no usable close operation), records unavailable-reason history=[no usable close operation] and current unavailable-cleanup reason=no usable close operation, and projects cleanup outcome=close-unavailable: no usable close operation while preserving the close-deferred reason and retention-resolved evidence.
Successful close after resolution: prior event=close-deferred(reason=same-session follow-up required), then event=retention-resolved(evidence=follow-up finished), cleanup evaluation remains evaluated, current cleanup decision=none, current retention reason=absent, current unavailable-cleanup reason=absent, and cleanup outcome=closed=no. The later supported close appends event=close-attempted then event=close-succeeded and projects cleanup outcome=closed=yes while preserving the close-deferred reason and retention-resolved evidence.

[Slot-limit automatic-close failure - separate run]
Controller appends event=slot-recovery-started(episode=recovery-failed-1, blockers=[impl-failed-close]). Blocking row `impl-failed-close` appends event=close-attempted(episode=recovery-failed-1, blocker=impl-failed-close) then event=close-failed(episode=recovery-failed-1, blocker=impl-failed-close) and projects cleanup outcome=closed=no. The controller does not retry yet. After operator cleanup, it appends event=manual-cleanup-confirmed(episode=recovery-failed-1, blocker=impl-failed-close, provenance=operator UI, observed-at=2026-07-11T20:02:00Z); closed=no remains unchanged. It then reconstructs state and retries the spawn exactly once using only recovery-failed-1 evidence; an earlier episode's confirmation cannot authorize this retry.

[Slot-limit spawn failure on cleanup-unavailable target - separate run]
Using `subagent-lifecycle` slot-limit recovery:
Target capability for this separate run: cleanup-unavailable: target exposes neither inventory nor close operation
Controller classifies a slot-limit spawn failure as orchestration resource exhaustion, not task failure.
Controller appends event=slot-recovery-started(episode=recovery-unavailable-1, blockers=[impl-unavailable]); open-agent inventory is unavailable beyond that sanitized blocker snapshot. Blocking row `impl-unavailable` captures its completed role state, appends event=closure-unavailable(reason=no inventory or close operation), records unavailable-reason history=[no inventory or close operation] and current unavailable-cleanup reason=no inventory or close operation, and projects `close-unavailable: no inventory or close operation`. After operator cleanup, the controller appends event=manual-cleanup-confirmed(episode=recovery-unavailable-1, blocker=impl-unavailable, provenance=operator UI, observed-at=2026-07-11T20:03:00Z) while the close-unavailable outcome remains unchanged; unavailable-reason history and the current unavailable-cleanup reason also remain unchanged. It reconstructs active task state from the lifecycle ledger and git, then retries the spawn exactly once using only recovery-unavailable-1 evidence. Evidence from an earlier episode cannot authorize this retry.
Retry succeeds.

[Repeated blocker-family branch in the cleanup-unavailable run]
Initial blocker-family record:
  - Task 2 implementer: agent_id=impl-2a, operational state=completed, event=turn-completed(status=BLOCKED), workflow return history=[BLOCKED], current workflow return status=BLOCKED, blocker state=context-missing: needs target install path, event=closure-unavailable(reason=no inventory or close operation), unavailable-reason history=[no inventory or close operation], current unavailable-cleanup reason=no inventory or close operation, cleanup outcome=close-unavailable: no inventory or close operation after the BLOCKED report and reconstructed state are captured
If a later spawned implementer reports BLOCKED with blocker state=context-missing: needs target install path after slot-limit recovery succeeds, the controller escalates through existing BLOCKED handling instead of retrying cleanup again.

Done!
```
