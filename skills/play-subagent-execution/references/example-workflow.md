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
`branch-review --fix` after any auto-fix or mechanical-nit commit until the
final run reports zero blocking findings auto-fixed, no unresolved remaining
`Blocking` findings except findings whose `critic` verdict is `INVALID` or
`DOWNGRADE`, and no additional mechanical nit commits. For a
**single-task plan** the per-task reviewer dispatches are skipped (see
"Single-Task Plans" in `SKILL.md`). On a direct/manual single-task run, the
flow shrinks to: dispatch implementer -> implementer self-reviews and commits
-> mark task complete -> final whole-implementation code-quality reviewer ->
report final review passed and resolve branch-level review status -> stop for
`branch-review` before `play-branch-finish` when the active workflow requires
branch-level review before PR creation, otherwise invoke `play-branch-finish`.
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
Task 1 implementer: agent_id=pending, role=implementer, status=active, base/head SHA captured (head pending), closed=no
[Snapshot classification]
Controller requests a snapshot: install/sync behavior is hard-risk and benefits
from post-commit line-range extraction. Plan snapshot hints, if any, are
advisory only.
[Ledger update]
Task 1 implementer: snapshot state=requested.
[Dispatch implementation subagent with full task text + context]
[Ledger post-dispatch]
Task 1 implementer: agent_id=impl-1, role=implementer, status=active, base/head SHA captured (head pending), closed=no

[Ledger shorthand used below]
Every later implementer, reviewer, re-reviewer, and final reviewer dispatch gets its own row: `agent_id=pending` before dispatch, then the stable `agent_id` after dispatch, with role, scope or task context, base/head SHA, status=active, and closed=no. Cleanup checkpoints below still show separate completed-session rows.

Implementer: "Before I begin - should the hook be installed at user or system level?"
You: "User level (~/.config/agent-hooks/)"
[Later] Implementer:
  - Implemented install, verify, and remove hook lifecycle commands
  - Files changed: src/hooks/install.ts, tests/hooks/install.test.ts
  - Added tests, 12/12 passing
  - Self-review: Found I missed --force replacement coverage, added it
  - Committed

[Lifecycle ledger update]
Task 1 implementer: status=DONE, report captured, base/head SHA captured, changed files captured, snapshot state=emitted, test state captured, closed=no because reviewer fix loops may still need same-session follow-up

[Compute effective review route]
Hard-risk trigger detected: install/sync behavior or user-home writes.
Effective route: `spec-and-quality`.

[Parallel happy path: same-head spec and quality pass]
[Cleanup gate before Task 1 reviewer spawn]
Controller keeps Task 1 implementer open for possible reviewer fixups. Because
the effective route is `spec-and-quality`, the controller dispatches both
read-only reviewers against the same captured task head.

[Ledger pre-dispatch: Task 1 spec reviewer, agent_id=pending]
[Ledger pre-dispatch: Task 1 code-quality reviewer, agent_id=pending]
[Dispatch spec compliance reviewer and code-quality reviewer concurrently]
[Ledger post-dispatch: Task 1 spec reviewer, agent_id=spec-1]
[Ledger post-dispatch: Task 1 code-quality reviewer, agent_id=quality-1]
Spec reviewer: ✅ Spec compliant - all requirements met, nothing extra
Code-quality reviewer: Strengths: Good test coverage, clean. Issues: None. Approved.

[Lifecycle cleanup checkpoint]
Task 1 implementer: status=DONE, report captured, base/head SHA captured, changed files captured, snapshot state=emitted, test state captured, closed=yes after reviewer loops passed.
Task 1 spec reviewer: agent_id=spec-1, review scope captured, base/head SHA captured, reviewed head SHA=task-1-head, report captured, reviewer result disposition=final-pass, closed=yes after PASS verdict recorded.
Task 1 code-quality reviewer: agent_id=quality-1, review scope captured, base/head SHA captured, reviewed head SHA=task-1-head, report captured, reviewer result disposition=final-pass because same-head spec passed and task head stayed current, closed=yes after final quality disposition recorded.

[Mark Task 1 complete]

Task 2: Recovery and repair modes

[Get Task 2 text and context (already extracted)]
[Cleanup gate before Task 2 implementer spawn]
Controller verifies Task 1 completed sessions are already closed before spawning Task 2.

[Ledger pre-dispatch: Task 2 implementer, agent_id=pending]
[Snapshot classification]
Controller requests a snapshot: repair-mode behavior changes workflow policy.
The request is controller-computed; the plan's risk hint is not authoritative.
[Ledger update]
Task 2 implementer: snapshot state=requested.
[Dispatch implementation subagent with full task text + context]
[Ledger post-dispatch: Task 2 implementer, agent_id=impl-2]
Implementer:
  - Added verify/repair modes
  - 8/8 tests passing
  - Self-review: All good
  - Committed

[Lifecycle ledger update]
Task 2 implementer: agent_id=impl-2, status=DONE, report captured, base/head SHA captured, changed files captured, snapshot state=emitted, test state captured, closed=no because reviewer fix loops may still need same-session follow-up.

[Compute effective review route]
Plan hints high risk and `spec-and-quality`; repair-mode behavior changes
workflow policy, so a hard-risk trigger is present.
Effective route: `spec-and-quality`.

[Spec-failure stale-quality path]
[Cleanup gate before Task 2 reviewer spawn]
Controller keeps Task 2 implementer open for possible reviewer fixups. Because
the effective route is `spec-and-quality`, both reviewers inspect the same
captured task head before either result is final.

[Ledger pre-dispatch: Task 2 spec reviewer, agent_id=pending]
[Ledger pre-dispatch: Task 2 code-quality reviewer, agent_id=pending]
[Dispatch spec compliance reviewer and code-quality reviewer concurrently]
[Ledger post-dispatch: Task 2 spec reviewer, agent_id=spec-2]
[Ledger post-dispatch: Task 2 code-quality reviewer, agent_id=quality-2]
Spec reviewer: ❌ Issues:
  - Missing: Progress reporting (spec says "report every 100 items")
  - Extra: Added --json flag (not requested)
Code-quality reviewer: Strengths: Solid. Issues (Nit): Magic number (100)

[Lifecycle ledger update]
Task 2 spec reviewer: agent_id=spec-2, status=findings-recorded, review scope captured, base/head SHA captured, reviewed head SHA=task-2-head, report captured, reviewer result disposition=final-findings, findings captured: Missing progress reporting; Extra --json flag, routing target=Task 2 implementer, re-review target=spec-2-rereview, closed=yes after findings routed.
Task 2 code-quality reviewer: agent_id=quality-2, status=findings-recorded, review scope captured, base/head SHA captured, reviewed head SHA=task-2-head, report captured, reviewer result disposition=advisory, findings captured: Magic number (100), routing target=Task 2 implementer if combined same-head findings are routed, re-review target=quality-2-rereview, closed=yes after advisory findings captured and routed.
Controller records the combined spec and code-quality finding set routed to Task 2 implementer because both reviewers inspected the same head.
Task 2 implementer: closed=no because routed same-head findings need same-session fixup.

[Implementer fixes issues]
Implementer: Removed --json flag, added progress reporting, extracted PROGRESS_INTERVAL constant

[Lifecycle ledger update]
Task 2 implementer: fixup count=1, blocker state=none, report refreshed,
changed files and head SHA refreshed, test state refreshed, snapshot
state=emitted, closed=no because spec re-review and any required code-quality
re-review or disposition are pending.
Task 2 code-quality reviewer: quality result disposition=stale; rerun quality unless irrelevance is proven.

[Revalidate effective review route]
Controller compares the original Task 2 base SHA to the refreshed task head.
The route may only preserve or escalate; the refreshed diff still requires
`spec-and-quality`, so continue to spec re-review and code-quality re-review
unless quality irrelevance is proven. Unclear stale-result classification fails
closed to rerunning code quality.

[Cleanup gate before Task 2 spec re-review spawn]
Controller keeps Task 2 implementer open until spec and required quality
dispositions are final.

[Ledger pre-dispatch: Task 2 spec re-reviewer, agent_id=pending]
[Spec re-reviewer reviews again]
[Ledger post-dispatch: Task 2 spec re-reviewer, agent_id=spec-2-rereview]
Spec reviewer: ✅ Spec compliant now

[Cleanup gate before Task 2 code-quality re-reviewer spawn]
Task 2 spec re-reviewer: review scope captured, base/head SHA captured, reviewed head SHA=task-2-fixup-head, report captured, reviewer result disposition=final-pass, closed=yes after PASS verdict recorded.
Task 2 implementer: closed=no because code-quality fixups may still need same-session follow-up.

[Ledger pre-dispatch: Task 2 code-quality re-reviewer, agent_id=pending]
[Dispatch code-quality re-reviewer]
[Ledger post-dispatch: Task 2 code-quality re-reviewer, agent_id=quality-2-rereview]
Code-quality reviewer: ✅ Approved

[Lifecycle ledger update]
Task 2 code-quality re-reviewer: review scope captured, base/head SHA captured, reviewed head SHA=task-2-fixup-head, report captured, reviewer result disposition=final-pass after same-head spec pass and current task-head validation, closed=yes after PASS verdict recorded.

[Lifecycle cleanup checkpoint]
Task 2 implementer: status=DONE, report captured, base/head SHA captured, changed files captured, snapshot state=emitted, test state captured, closed=yes after reviewer loops passed.
Task 2 spec reviewer: agent_id=spec-2, review scope captured, base/head SHA captured, report captured, concrete findings captured, reviewer result disposition=final-findings, closed=yes after findings routing.
Task 2 spec re-reviewer: agent_id=spec-2-rereview, review scope captured, base/head SHA captured, report captured, reviewer result disposition=final-pass, closed=yes after PASS verdict.
Task 2 code-quality reviewer: agent_id=quality-2, review scope captured, base/head SHA captured, report captured, concrete findings captured, reviewer result disposition=stale after fixup changed head, closed=yes after stale disposition recorded.
Task 2 code-quality re-reviewer: agent_id=quality-2-rereview, review scope captured, base/head SHA captured, report captured, reviewer result disposition=final-pass, closed=yes after PASS verdict.

[Mark Task 2 complete]

Task 3: Low-risk example copy

[Cleanup gate before Task 3 implementer spawn]
Controller verifies completed Task 2 sessions are closed or recorded with
target-honest `close-unavailable` outcomes before spawning Task 3.

[Snapshot classification]
Controller skips the snapshot: this is a clearly localized low-risk example
copy change. The implementer must report the default DONE fields: status,
summary, tests, files changed, base SHA, and head SHA.
[Dispatch implementation subagent with full task text + context]
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
Task 3 implementer: status=DONE, report captured, base/head SHA captured,
changed files captured, snapshot state=skipped, test state captured, closed=yes
after the effective route completed. Controller uses its own git diff and
committed HEAD reads if it needs file content.

[Mark Task 3 complete]

...

[After all tasks]
[Cleanup gate before final code-quality reviewer spawn]
Controller verifies task implementers, reviewers, and re-reviewers are closed, then records the final reviewer pre-dispatch row: agent_id=pending, role=final-code-quality-reviewer, review scope=whole implementation diff, base/head SHA captured, closed=no.

[Dispatch final code-quality reviewer]
[Ledger post-dispatch: final-code-quality-reviewer, agent_id=final-quality]
Final reviewer: All requirements met, ready to merge

[Lifecycle cleanup checkpoint]
final-code-quality-reviewer: agent_id=final-quality, review scope captured, base/head SHA captured, report captured, reviewer result=PASS, closed=yes after final verdict recorded.

[Return to owning caller]
`play-subagent-execution` returns to `issue-priming-workflow --auto`.

[Caller runs final whole-diff gate]
`issue-priming-workflow` Phase 7 runs `branch-review --fix` until a run
reports zero blocking findings auto-fixed. If mechanical nit fixes commit
after that review, Phase 7 reruns on the new `HEAD`.
Branch review: no unresolved remaining `Blocking` findings except `INVALID` or
`DOWNGRADE` critic verdicts.

[Caller continues]
`issue-priming-workflow` proceeds to PR creation.

[Alternative target capability examples - separate runs, not the automatic-close run above]

[Inventory-only target variant]
Using `subagent-lifecycle` target capability guidance:
Target capability for this separate run: inventory-only: target exposes session inventory but no close operation
Controller first captures each completed session's role-specific state, records open inventory (`impl-1`, `spec-1`, `quality-1`), and records `close-unavailable: inventory-only; no close operation` instead of claiming closed=yes before dispatching the next agent.

[Slot-limit spawn failure on cleanup-unavailable target - separate run]
Using `subagent-lifecycle` slot-limit recovery:
Target capability for this separate run: cleanup-unavailable: target exposes neither inventory nor close operation
Controller classifies a slot-limit spawn failure as orchestration resource exhaustion, not task failure.
Controller runs the cleanup gate, records `close-unavailable: no inventory or close operation` for completed/superseded sessions, states that open-agent inventory is unavailable, gives explicit operator/UI cleanup guidance, waits for operator confirmation that manual cleanup is complete, reconstructs active task state from the lifecycle ledger and git, then retries the spawn exactly once.
Retry succeeds.

[Repeated blocker-family branch in the cleanup-unavailable run]
Initial blocker-family record:
  - Task 2 implementer: agent_id=impl-2a, status=BLOCKED, blocker state=context-missing: needs target install path, close-unavailable: no inventory or close operation after BLOCKED report and reconstructed state are captured
If a later spawned implementer reports BLOCKED with blocker state=context-missing: needs target install path after slot-limit recovery succeeds, the controller escalates through existing BLOCKED handling instead of retrying cleanup again.

Done!
```
