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
Task 1 implementer: agent_id=pending, role=implementer, operational state=pending, events=[dispatch-requested], workflow return status absent, base/head SHA captured (head pending), cleanup outcome=closed=no
[Snapshot classification]
Controller requests a snapshot: install/sync behavior is hard-risk and benefits
from post-commit line-range extraction. Plan snapshot hints, if any, are
advisory only.
[Ledger update]
Task 1 implementer: snapshot state=requested.
[Dispatch implementation subagent with full task text + context]
[Ledger post-dispatch]
Task 1 implementer: agent_id=impl-1, role=implementer, operational state=active, events=[dispatch-requested, identity-assigned], workflow return status absent, base/head SHA captured (head pending), cleanup outcome=closed=no

[Ledger shorthand used below]
Every later implementer, reviewer, re-reviewer, and final reviewer dispatch gets its own row: `agent_id=pending`, operational state=pending, and events=[dispatch-requested] before dispatch; then the observed stable `agent_id`, operational state=active, and events=[dispatch-requested, identity-assigned] after dispatch. Workflow return status and reviewer disposition are absent until observed or classified. Cleanup checkpoints retain the ordered events while projecting cleanup separately.

Implementer: "Before I begin - should the hook be installed at user or system level?"
You: "User level (~/.config/agent-hooks/)"
[Later] Implementer:
  - Implemented install, verify, and remove hook lifecycle commands
  - Files changed: src/hooks/install.ts, tests/hooks/install.test.ts
  - Added tests, 12/12 passing
  - Self-review: Found I missed --force replacement coverage, added it
  - Committed

[Lifecycle ledger update]
Task 1 implementer: operational state=completed, workflow return status=DONE, event=turn-completed appended after dispatch-requested and identity-assigned, report captured, base/head SHA captured, changed files captured, snapshot state=emitted, test state captured, cleanup outcome=closed=no because reviewer fix loops may still need same-session follow-up

[Compute effective review route]
Hard-risk trigger detected: install/sync behavior or user-home writes.
Effective route: `spec-and-quality`.

[Parallel happy path: same-head spec and quality pass]
[Cleanup gate before Task 1 reviewer spawn]
Controller keeps Task 1 implementer open for possible reviewer fixups. Because
the effective route is `spec-and-quality`, the controller dispatches both
read-only reviewers against the same captured task head.

[Ledger pre-dispatch: Task 1 spec reviewer, agent_id=pending, operational state=pending, events=[dispatch-requested]]
[Ledger pre-dispatch: Task 1 code-quality reviewer, agent_id=pending, operational state=pending, events=[dispatch-requested]]
[Dispatch spec compliance reviewer and code-quality reviewer concurrently]
[Ledger post-dispatch: Task 1 spec reviewer, agent_id=spec-1, operational state=active, events=[dispatch-requested, identity-assigned]]
[Ledger post-dispatch: Task 1 code-quality reviewer, agent_id=quality-1, operational state=active, events=[dispatch-requested, identity-assigned]]
Spec reviewer: ✅ Spec compliant - all requirements met, nothing extra
Code-quality reviewer: Strengths: Good test coverage, clean. Issues: None. Approved.

[Lifecycle cleanup checkpoint]
Task 1 implementer: operational state=completed, workflow return status=DONE, report captured, base/head SHA captured, changed files captured, snapshot state=emitted, test state captured, event=close-attempted then event=close-succeeded, cleanup outcome=closed=yes after reviewer loops passed; prior events retained.
Task 1 spec reviewer: agent_id=spec-1, operational state=completed, workflow return status=DONE, event=turn-completed, review scope captured, base/head SHA captured, reviewed head SHA=task-1-head, report captured, reviewer disposition=final-pass, event=close-attempted then event=close-succeeded, cleanup outcome=closed=yes.
Task 1 code-quality reviewer: agent_id=quality-1, operational state=completed, workflow return status=DONE, event=turn-completed, review scope captured, base/head SHA captured, reviewed head SHA=task-1-head, report captured, reviewer disposition=final-pass because same-head spec passed and task head stayed current, event=close-attempted then event=close-succeeded, cleanup outcome=closed=yes.

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
Task 2 implementer: agent_id=impl-2, operational state=completed, workflow return status=DONE, event=turn-completed, report captured, base/head SHA captured, changed files captured, snapshot state=emitted, test state captured, cleanup outcome=closed=no because reviewer fix loops may still need same-session follow-up.

[Compute effective review route]
Plan hints high risk and `spec-and-quality`; repair-mode behavior changes
workflow policy, so a hard-risk trigger is present.
Effective route: `spec-and-quality`.

[Spec-failure stale-quality path]
[Cleanup gate before Task 2 reviewer spawn]
Controller keeps Task 2 implementer open for possible reviewer fixups. Because
the effective route is `spec-and-quality`, both reviewers inspect the same
captured task head before either result is final.

[Ledger pre-dispatch: Task 2 spec reviewer, agent_id=pending, operational state=pending, events=[dispatch-requested]]
[Ledger pre-dispatch: Task 2 code-quality reviewer, agent_id=pending, operational state=pending, events=[dispatch-requested]]
[Dispatch spec compliance reviewer and code-quality reviewer concurrently]
[Ledger post-dispatch: Task 2 spec reviewer, agent_id=spec-2, operational state=active, events=[dispatch-requested, identity-assigned]]
[Ledger post-dispatch: Task 2 code-quality reviewer, agent_id=quality-2, operational state=active, events=[dispatch-requested, identity-assigned]]
Spec reviewer: ❌ Issues:
  - Missing: Progress reporting (spec says "report every 100 items")
  - Extra: Added --json flag (not requested)
Code-quality reviewer: Strengths: Solid. Issues (Nit): Magic number (100)

[Lifecycle ledger update]
Task 2 spec reviewer: agent_id=spec-2, operational state=completed, workflow return status=findings-recorded, event=turn-completed, review scope captured, base/head SHA captured, reviewed head SHA=task-2-head, report captured, reviewer disposition=final-findings, findings captured: Missing progress reporting; Extra --json flag, routing target=Task 2 implementer, re-review target=spec-2-rereview, event=close-attempted then event=close-succeeded, cleanup outcome=closed=yes after findings routed.
Task 2 code-quality reviewer: agent_id=quality-2, operational state=completed, workflow return status=findings-recorded, event=turn-completed, review scope captured, base/head SHA captured, reviewed head SHA=task-2-head, report captured, reviewer disposition=advisory, findings captured: Magic number (100), routing target=Task 2 implementer if combined same-head findings are routed, re-review target=quality-2-rereview, event=close-attempted then event=close-succeeded, cleanup outcome=closed=yes after advisory findings captured and routed.
Controller records the combined spec and code-quality finding set routed to Task 2 implementer because both reviewers inspected the same head.
Task 2 implementer: cleanup outcome=closed=no because routed same-head findings need same-session fixup.

[Implementer fixes issues]
[Same-session follow-up dispatch]
Task 2 implementer: agent_id=impl-2 retained, event=followup-dispatch-requested appended after the first turn-completed, operational state transitions from completed to active before follow-up work; all prior events retained.
Implementer: Removed --json flag, added progress reporting, extracted PROGRESS_INTERVAL constant

[Lifecycle ledger update]
Task 2 implementer: operational state=completed, workflow return status=DONE,
a second event=turn-completed appended, fixup count=1, blocker state=none, report
refreshed, changed files and head SHA refreshed, test state refreshed, snapshot
state=emitted, cleanup outcome=closed=no because spec re-review and any required
code-quality re-review or disposition are pending.
Task 2 code-quality reviewer: operational state=completed, workflow return status=findings-recorded, reviewer disposition=stale, close history remains close-attempted then close-succeeded, cleanup outcome remains closed=yes. Only the disposition changes because the reviewed head became stale; lifecycle state and prior events are not rewritten. Rerun quality unless irrelevance is proven.

[Revalidate effective review route]
Controller compares the original Task 2 base SHA to the refreshed task head.
The route may only preserve or escalate; the refreshed diff still requires
`spec-and-quality`, so continue to spec re-review and code-quality re-review
unless quality irrelevance is proven. Unclear stale-result classification fails
closed to rerunning code quality.

[Cleanup gate before Task 2 spec re-review spawn]
Controller keeps Task 2 implementer open until spec and required quality
dispositions are final.

[Ledger pre-dispatch: Task 2 spec re-reviewer, agent_id=pending, operational state=pending, events=[dispatch-requested]]
[Spec re-reviewer reviews again]
[Ledger post-dispatch: Task 2 spec re-reviewer, agent_id=spec-2-rereview, operational state=active, events=[dispatch-requested, identity-assigned]]
Spec reviewer: ✅ Spec compliant now

[Cleanup gate before Task 2 code-quality re-reviewer spawn]
Task 2 spec re-reviewer: operational state=completed, workflow return status=DONE, event=turn-completed, review scope captured, base/head SHA captured, reviewed head SHA=task-2-fixup-head, report captured, reviewer disposition=final-pass, event=close-attempted then event=close-succeeded, cleanup outcome=closed=yes.
Task 2 implementer: cleanup outcome=closed=no because code-quality fixups may still need same-session follow-up.

[Ledger pre-dispatch: Task 2 code-quality re-reviewer, agent_id=pending, operational state=pending, events=[dispatch-requested]]
[Dispatch code-quality re-reviewer]
[Ledger post-dispatch: Task 2 code-quality re-reviewer, agent_id=quality-2-rereview, operational state=active, events=[dispatch-requested, identity-assigned]]
Code-quality reviewer: ✅ Approved

[Lifecycle ledger update]
Task 2 code-quality re-reviewer: operational state=completed, workflow return status=DONE, event=turn-completed, review scope captured, base/head SHA captured, reviewed head SHA=task-2-fixup-head, report captured, reviewer disposition=final-pass after same-head spec pass and current task-head validation, event=close-attempted then event=close-succeeded, cleanup outcome=closed=yes.

[Lifecycle cleanup checkpoint]
Task 2 implementer: operational state=completed, workflow return status=DONE, report captured, base/head SHA captured, changed files captured, snapshot state=emitted, test state captured, event=close-attempted then event=close-succeeded, cleanup outcome=closed=yes after reviewer loops passed.
Task 2 spec reviewer: agent_id=spec-2, operational state=completed, workflow return status=findings-recorded, event=turn-completed, review scope captured, base/head SHA captured, report captured, concrete findings captured, reviewer disposition=final-findings, cleanup outcome=closed=yes after its recorded close success.
Task 2 spec re-reviewer: agent_id=spec-2-rereview, operational state=completed, workflow return status=DONE, event=turn-completed, review scope captured, base/head SHA captured, report captured, reviewer disposition=final-pass, cleanup outcome=closed=yes after its recorded close success.
Task 2 code-quality reviewer: agent_id=quality-2, operational state=completed, workflow return status=findings-recorded, events retain turn-completed and close-succeeded, review scope captured, base/head SHA captured, report captured, concrete findings captured, reviewer disposition=stale, cleanup outcome=closed=yes after its recorded close success.
Task 2 code-quality re-reviewer: agent_id=quality-2-rereview, operational state=completed, workflow return status=DONE, event=turn-completed, review scope captured, base/head SHA captured, report captured, reviewer disposition=final-pass, cleanup outcome=closed=yes after its recorded close success.

[Mark Task 2 complete]

Task 3: Low-risk example copy

[Cleanup gate before Task 3 implementer spawn]
Controller verifies completed Task 2 sessions are closed or recorded with
target-honest `close-unavailable` outcomes before spawning Task 3.

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
Task 3 implementer: operational state=completed, workflow return status=DONE,
event=turn-completed, report captured, base/head SHA captured, changed files
captured, snapshot state=skipped, test state captured, event=close-attempted
then event=close-succeeded, cleanup outcome=closed=yes after the effective
route completed. Controller uses its own git diff and
committed HEAD reads if it needs file content.

[Mark Task 3 complete]

...

[After all tasks]
[Cleanup gate before final code-quality reviewer spawn]
Controller verifies task implementers, reviewers, and re-reviewers are closed, then records the final reviewer pre-dispatch row: agent_id=pending, role=final-code-quality-reviewer, operational state=pending, events=[dispatch-requested], workflow return status absent, reviewer disposition absent, review scope=whole implementation diff, base/head SHA captured, cleanup outcome=closed=no.

[Dispatch final code-quality reviewer]
[Ledger post-dispatch: final-code-quality-reviewer, agent_id=final-quality, operational state=active, events=[dispatch-requested, identity-assigned]]
Final reviewer: All requirements met, ready to merge

[Lifecycle cleanup checkpoint]
final-code-quality-reviewer: agent_id=final-quality, operational state=completed, workflow return status=DONE, events retain dispatch-requested, identity-assigned, and turn-completed, review scope captured, base/head SHA captured, report captured, reviewer disposition=final-pass, event=close-attempted then event=close-succeeded, cleanup outcome=closed=yes after final verdict recorded.

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

[Isolated lifecycle supersession hypothetical - separate run, not an executor route]
An owning workflow authorizes one generic scoped support session; this does not add a reviewer or fanout branch to `play-subagent-execution`.
Pre-dispatch: agent_id=pending, role=scoped-support, operational state=pending, events=[dispatch-requested], workflow return status absent, cleanup outcome=closed=no.
Post-dispatch: agent_id=support-1, role=scoped-support, operational state=active, events=[dispatch-requested, identity-assigned], workflow return status absent, cleanup outcome=closed=no.
Before supersession, the controller captures role-specific state: assigned scope, source-state anchor, and the replacement routing reason. The owning workflow then replaces the still-active session, appends event=superseded, sets current operational state=superseded, preserves dispatch-requested and identity-assigned, and records no turn-completed event or workflow return status. With stable identity and usable closure, it appends event=close-attempted then event=close-succeeded and projects cleanup outcome=closed=yes.

[Inventory-only target variant]
Using `subagent-lifecycle` target capability guidance:
Target capability for this separate run: inventory-only: target exposes session inventory but no close operation
Controller first captures each completed session's role-specific state, records open inventory (`impl-1`, `spec-1`, `quality-1`), appends event=closure-unavailable, and projects cleanup outcome=`close-unavailable: inventory-only; no close operation` instead of claiming closed=yes before dispatching the next agent.

[Tracked-ID-only inventory-only target variant]
Target capability for this separate run: inventory-only: no inventory operation is exposed, but the controller retains tracked stable agent ids and no usable close operation
After capture, the controller appends event=closure-unavailable with reason=no close operation and projects cleanup outcome=`close-unavailable: tracked stable identity; no close operation`.

[Automatic-close retry projection - separate run]
The session has stable identity and an exposed close operation. The first close records event=close-attempted, event=close-failed, cleanup outcome=closed=no; prior lifecycle events remain. A later retry records event=close-attempted, event=close-succeeded, cleanup outcome=closed=yes without deleting the failed attempt.

[Slot-limit automatic-close failure - separate run]
The cleanup gate attempts a usable automatic close, appends event=close-failed, and projects cleanup outcome=closed=no. The controller does not retry the spawn yet. It follows the same sanitized operator/UI manual-cleanup guidance as unavailable cleanup, waits for operator confirmation, then retries the spawn exactly once.

[Slot-limit spawn failure on cleanup-unavailable target - separate run]
Using `subagent-lifecycle` slot-limit recovery:
Target capability for this separate run: cleanup-unavailable: target exposes neither inventory nor close operation
Controller classifies a slot-limit spawn failure as orchestration resource exhaustion, not task failure.
Controller runs the cleanup gate, appends event=closure-unavailable and projects `close-unavailable: no inventory or close operation` for completed/superseded sessions, states that open-agent inventory is unavailable, gives explicit operator/UI cleanup guidance, waits for operator confirmation that manual cleanup is complete, reconstructs active task state from the lifecycle ledger and git, then retries the spawn exactly once.
Retry succeeds.

[Repeated blocker-family branch in the cleanup-unavailable run]
Initial blocker-family record:
  - Task 2 implementer: agent_id=impl-2a, operational state=completed, workflow return status=BLOCKED, event=turn-completed, blocker state=context-missing: needs target install path, event=closure-unavailable, cleanup outcome=close-unavailable: no inventory or close operation after the BLOCKED report and reconstructed state are captured
If a later spawned implementer reports BLOCKED with blocker state=context-missing: needs target install path after slot-limit recovery succeeds, the controller escalates through existing BLOCKED handling instead of retrying cleanup again.

Done!
```
