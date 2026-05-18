# Example Workflow — `play-subagent-execution`

An end-to-end illustration of the multi-task subagent-driven flow. The procedure
itself lives in `SKILL.md` § The Process; this file is illustrative.

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
`play-branch-finish`. On the `issue-priming-workflow --auto` single-task path,
the flow instead returns to the caller after task completion so Phase 7
`branch-review --fix` becomes the whole-diff gate.

```
You: I'm using Subagent-Driven Development to execute this plan.

[Read plan file once: .ephemeral/feature-plan.md]
[Extract all 3 coherent authored tasks with full text and context]
[Create TodoWrite with all tasks]
[Detect target lifecycle capability]
Target capability for this run: automatic-close-supported

Task 1: Hook lifecycle

[Cleanup gate before spawn]
Ledger: no completed or superseded sessions to close.

[Get Task 1 text and context (already extracted)]
[Ledger pre-dispatch]
Task 1 implementer: agent_id=pending, role=implementer, status=active, base/head SHA captured (head pending), closed=no
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
Task 1 implementer: status=DONE, report captured, base/head SHA captured, changed files captured, snapshot captured, test state captured, closed=no because reviewer fix loops may still need same-session follow-up

[Compute effective review route]
Hard-risk trigger detected: install/sync behavior or user-home writes.
Effective route: `spec-and-quality`.

[Cleanup gate before Task 1 spec reviewer spawn]
Controller keeps Task 1 implementer open for possible spec-review fixups.

[Ledger pre-dispatch: Task 1 spec reviewer, agent_id=pending]
[Dispatch spec compliance reviewer]
[Ledger post-dispatch: Task 1 spec reviewer, agent_id=spec-1]
Spec reviewer: ✅ Spec compliant - all requirements met, nothing extra

[Cleanup gate before Task 1 code-quality reviewer spawn]
Task 1 spec reviewer: review scope captured, base/head SHA captured, report captured, reviewer result=PASS, closed=yes after PASS verdict recorded.
Task 1 implementer: closed=no because code-quality fixups may still need same-session follow-up.

[Ledger pre-dispatch: Task 1 code-quality reviewer, agent_id=pending]
[Dispatch code-quality reviewer]
[Ledger post-dispatch: Task 1 code-quality reviewer, agent_id=quality-1]
Code-quality reviewer: Strengths: Good test coverage, clean. Issues: None. Approved.

[Lifecycle cleanup checkpoint]
Task 1 implementer: status=DONE, report captured, base/head SHA captured, changed files captured, snapshot captured, test state captured, closed=yes after reviewer loops passed.
Task 1 spec reviewer: agent_id=spec-1, review scope captured, base/head SHA captured, report captured, reviewer result=PASS, closed=yes after PASS verdict recorded.
Task 1 code-quality reviewer: agent_id=quality-1, review scope captured, base/head SHA captured, report captured, reviewer result=PASS, closed=yes after PASS verdict recorded.

[Mark Task 1 complete]

Task 2: Recovery and repair modes

[Get Task 2 text and context (already extracted)]
[Cleanup gate before Task 2 implementer spawn]
Controller verifies Task 1 completed sessions are already closed before spawning Task 2.

[Ledger pre-dispatch: Task 2 implementer, agent_id=pending]
[Dispatch implementation subagent with full task text + context]
[Ledger post-dispatch: Task 2 implementer, agent_id=impl-2]
Implementer:
  - Added verify/repair modes
  - 8/8 tests passing
  - Self-review: All good
  - Committed

[Lifecycle ledger update]
Task 2 implementer: agent_id=impl-2, status=DONE, report captured, base/head SHA captured, changed files captured, snapshot captured, test state captured, closed=no because reviewer fix loops may still need same-session follow-up.

[Compute effective review route]
Plan hints high risk and `spec-and-quality`; repair-mode behavior changes
workflow policy, so a hard-risk trigger is present.
Effective route: `spec-and-quality`.

[Cleanup gate before Task 2 spec reviewer spawn]
Controller keeps Task 2 implementer open for possible spec-review fixups.

[Ledger pre-dispatch: Task 2 spec reviewer, agent_id=pending]
[Dispatch spec compliance reviewer]
[Ledger post-dispatch: Task 2 spec reviewer, agent_id=spec-2]
Spec reviewer: ❌ Issues:
  - Missing: Progress reporting (spec says "report every 100 items")
  - Extra: Added --json flag (not requested)

[Lifecycle ledger update]
Task 2 spec reviewer: agent_id=spec-2, status=findings-recorded, review scope captured, base/head SHA captured, report captured, reviewer result=findings recorded/routed, findings captured: Missing progress reporting; Extra --json flag, routing target=Task 2 implementer, re-review target=spec-2-rereview, closed=yes after findings routed.
Task 2 implementer: closed=no because routed spec findings need same-session fixup.

[Implementer fixes issues]
Implementer: Removed --json flag, added progress reporting

[Lifecycle ledger update]
Task 2 implementer: fixup count=1, blocker state=none, report refreshed, changed files and head SHA refreshed, test state refreshed, snapshot refreshed, closed=no because spec re-review is pending.

[Revalidate effective review route]
Controller compares the original Task 2 base SHA to the refreshed task head.
The route may only preserve or escalate; the refreshed diff still requires
`spec-and-quality`, so continue to spec re-review.

[Cleanup gate before Task 2 spec re-review spawn]
Controller keeps Task 2 implementer open until the spec reviewer passes.

[Ledger pre-dispatch: Task 2 spec re-reviewer, agent_id=pending]
[Spec re-reviewer reviews again]
[Ledger post-dispatch: Task 2 spec re-reviewer, agent_id=spec-2-rereview]
Spec reviewer: ✅ Spec compliant now

[Cleanup gate before Task 2 code-quality reviewer spawn]
Task 2 spec re-reviewer: review scope captured, base/head SHA captured, report captured, reviewer result=PASS, closed=yes after PASS verdict recorded.
Task 2 implementer: closed=no because code-quality fixups may still need same-session follow-up.

[Ledger pre-dispatch: Task 2 code-quality reviewer, agent_id=pending]
[Dispatch code-quality reviewer]
[Ledger post-dispatch: Task 2 code-quality reviewer, agent_id=quality-2]
Code-quality reviewer: Strengths: Solid. Issues (Nit): Magic number (100)

[Lifecycle ledger update]
Task 2 code-quality reviewer: status=findings-recorded, review scope captured, base/head SHA captured, report captured, reviewer result=findings recorded/routed, findings captured: Magic number (100), routing target=Task 2 implementer, re-review target=quality-2-rereview, closed=yes after findings routed.
Task 2 implementer: closed=no because routed code-quality findings need same-session fixup.

[Implementer fixes]
Implementer: Extracted PROGRESS_INTERVAL constant

[Lifecycle ledger update]
Task 2 implementer: fixup count=2, report refreshed, changed files and head SHA refreshed, test state refreshed, snapshot refreshed, closed=no because code-quality re-review is pending.

[Revalidate effective review route]
Controller compares the original Task 2 base SHA to the refreshed task head.
The route may only preserve or escalate; the refreshed diff still requires
`spec-and-quality`, so continue to code-quality re-review.

[Cleanup gate before Task 2 code-quality re-review spawn]
Controller keeps Task 2 implementer open until the code-quality reviewer passes.

[Ledger pre-dispatch: Task 2 code-quality re-reviewer, agent_id=pending]
[Code-quality re-reviewer reviews again]
[Ledger post-dispatch: Task 2 code-quality re-reviewer, agent_id=quality-2-rereview]
Code-quality reviewer: ✅ Approved

[Lifecycle cleanup checkpoint]
Task 2 implementer: status=DONE, report captured, base/head SHA captured, changed files captured, snapshot captured, test state captured, closed=yes after reviewer loops passed.
Task 2 spec reviewer: agent_id=spec-2, review scope captured, base/head SHA captured, report captured, concrete findings captured, closed=yes after findings routing.
Task 2 spec re-reviewer: agent_id=spec-2-rereview, review scope captured, base/head SHA captured, report captured, reviewer result=PASS, closed=yes after PASS verdict.
Task 2 code-quality reviewer: agent_id=quality-2, review scope captured, base/head SHA captured, report captured, concrete findings captured, closed=yes after findings routing.
Task 2 code-quality re-reviewer: agent_id=quality-2-rereview, review scope captured, base/head SHA captured, report captured, reviewer result=PASS, closed=yes after PASS verdict.

[Mark Task 2 complete]

Task 3: Low-risk example copy

[Dispatch implementation subagent with full task text + context]
Implementer:
  - Clarified one example sentence in a neutral demo note
  - Tests not applicable beyond final render/check suite
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
changed files captured, snapshot captured, test state captured, closed=yes
after the effective route completed.

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
Target capability for this separate run: inventory-only: target exposes session inventory but no close operation
Controller first captures each completed session's role-specific state, records open inventory (`impl-1`, `spec-1`, `quality-1`), and records `close-unavailable: inventory-only; no close operation` instead of claiming closed=yes before dispatching the next agent.

[Slot-limit spawn failure on cleanup-unavailable target - separate run]
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
