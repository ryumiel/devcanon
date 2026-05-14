# Example Workflow — `play-subagent-execution`

An end-to-end illustration of the multi-task subagent-driven flow. The procedure
itself lives in `SKILL.md` § The Process; this file is illustrative.

The example below shows a multi-task plan with coherent authored tasks, so
per-task reviewers run after every task. The executor follows the authored plan
boundaries; it does not do runtime regrouping or batching. For a
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

[Cleanup gate before Task 1 implementer spawn]
Ledger: no completed or superseded sessions to close

[Get Task 1 text and context (already extracted)]
[Lifecycle ledger update before Task 1 implementer dispatch]
Ledger:
  - Task 1 implementer: agent_id=pending, role=implementer, status=active, base SHA captured, closed=no

[Dispatch implementation subagent with full task text + context]

[Lifecycle ledger update after Task 1 implementer dispatch]
Ledger:
  - Task 1 implementer: agent_id=impl-1, role=implementer, status=active, base SHA captured, closed=no

Implementer: "Before I begin - should the hook be installed at user or system level?"

You: "User level (~/.config/agent-hooks/)"

Implementer: "Got it. Implementing now..."
[Later] Implementer:
  - Implemented install, verify, and remove hook lifecycle commands
  - Files changed: src/hooks/install.ts, tests/hooks/install.test.ts
  - Added tests, 12/12 passing
  - Self-review: Found I missed --force replacement coverage, added it
  - Committed

[Lifecycle ledger update]
Ledger:
  - Task 1 implementer: agent_id=impl-1, report captured, base/head SHA captured, changed files captured, snapshot captured, test state captured, closed=no because reviewer fix loops may still need same-session follow-up

[Cleanup gate before Task 1 spec reviewer spawn]
Controller keeps Task 1 implementer open for possible spec-review fixups.

[Lifecycle ledger update before Task 1 spec reviewer dispatch]
Ledger:
  - Task 1 spec reviewer: agent_id=pending, role=spec-compliance-reviewer, status=active, review scope=Task 1 diff, base/head SHA captured, closed=no

[Dispatch spec compliance reviewer]

[Lifecycle ledger update after Task 1 spec reviewer dispatch]
Ledger:
  - Task 1 spec reviewer: agent_id=spec-1, role=spec-compliance-reviewer, status=active, review scope=Task 1 diff, base/head SHA captured, closed=no

Spec reviewer: ✅ Spec compliant - all requirements met, nothing extra

[Cleanup gate before Task 1 code-quality reviewer spawn]
Ledger:
  - Task 1 spec reviewer: agent_id=spec-1, review scope captured, base/head SHA captured, report captured, reviewer result=PASS, closed=yes after PASS verdict recorded
  - Task 1 implementer: agent_id=impl-1, closed=no because code-quality fixups may still need same-session follow-up

[Get git SHAs]
[Lifecycle ledger update before Task 1 code-quality reviewer dispatch]
Ledger:
  - Task 1 code-quality reviewer: agent_id=pending, role=code-quality-reviewer, status=active, review scope=Task 1 diff, base/head SHA captured, closed=no

[Dispatch code quality reviewer]

[Lifecycle ledger update after Task 1 code-quality reviewer dispatch]
Ledger:
  - Task 1 code-quality reviewer: agent_id=quality-1, role=code-quality-reviewer, status=active, review scope=Task 1 diff, base/head SHA captured, closed=no

Code reviewer: Strengths: Good test coverage, clean. Issues: None. Approved.

[Lifecycle cleanup checkpoint]
Ledger:
  - Task 1 implementer: agent_id=impl-1, report captured, base/head SHA captured, changed files captured, snapshot captured, test state captured, closed=yes after reviewer loops passed
  - Task 1 spec reviewer: agent_id=spec-1, review scope captured, base/head SHA captured, report captured, reviewer result=PASS, closed=yes after PASS verdict recorded earlier
  - Task 1 code reviewer: agent_id=quality-1, review scope captured, base/head SHA captured, report captured, reviewer result=PASS, closed=yes after PASS verdict recorded

[Mark Task 1 complete]

Task 2: Recovery and repair modes

[Get Task 2 text and context (already extracted)]
[Cleanup gate before Task 2 implementer spawn]
Controller verifies Task 1 completed sessions are already closed before spawning Task 2.

[Lifecycle ledger update before Task 2 implementer dispatch]
Ledger:
  - Task 2 implementer: agent_id=pending, role=implementer, status=active, base SHA captured, closed=no

[Dispatch implementation subagent with full task text + context]

[Lifecycle ledger update after Task 2 implementer dispatch]
Ledger:
  - Task 2 implementer: agent_id=impl-2, role=implementer, status=active, base SHA captured, closed=no

Implementer: [No questions, proceeds]
Implementer:
  - Added verify/repair modes
  - 8/8 tests passing
  - Self-review: All good
  - Committed

[Lifecycle ledger update]
Ledger:
  - Task 2 implementer: agent_id=impl-2, report captured, base/head SHA captured, changed files captured, snapshot captured, test state captured, closed=no because reviewer fix loops may still need same-session follow-up

[Cleanup gate before Task 2 spec reviewer spawn]
Controller keeps Task 2 implementer open for possible spec-review fixups.

[Lifecycle ledger update before Task 2 spec reviewer dispatch]
Ledger:
  - Task 2 spec reviewer: agent_id=pending, role=spec-compliance-reviewer, status=active, review scope=Task 2 diff, base/head SHA captured, closed=no

[Dispatch spec compliance reviewer]

[Lifecycle ledger update after Task 2 spec reviewer dispatch]
Ledger:
  - Task 2 spec reviewer: agent_id=spec-2, role=spec-compliance-reviewer, status=active, review scope=Task 2 diff, base/head SHA captured, closed=no

Spec reviewer: ❌ Issues:
  - Missing: Progress reporting (spec says "report every 100 items")
  - Extra: Added --json flag (not requested)

[Lifecycle ledger update]
Ledger:
  - Task 2 spec reviewer: agent_id=spec-2, status=findings-recorded, review scope captured, base/head SHA captured, report captured, reviewer result=findings recorded/routed, findings captured: Missing progress reporting; Extra --json flag, re-review target=spec-2-rereview, closed=yes after findings routed
  - Task 2 implementer: agent_id=impl-2, closed=no because routed spec findings need same-session fixup

[Implementer fixes issues]
Implementer: Removed --json flag, added progress reporting

[Lifecycle ledger update]
Ledger:
  - Task 2 implementer: fixup count=1, blocker state=none, report refreshed, changed files and head SHA refreshed, test state refreshed, snapshot refreshed, closed=no because spec re-review is pending

[Cleanup gate before Task 2 spec re-review spawn]
Controller keeps Task 2 implementer open until the spec reviewer passes.

[Lifecycle ledger update before Task 2 spec re-reviewer dispatch]
Ledger:
  - Task 2 spec re-reviewer: agent_id=pending, role=spec-compliance-reviewer, status=active, review scope=Task 2 spec fixup diff, base/head SHA captured, closed=no

[Spec re-reviewer reviews again]

[Lifecycle ledger update after Task 2 spec re-reviewer dispatch]
Ledger:
  - Task 2 spec re-reviewer: agent_id=spec-2-rereview, role=spec-compliance-reviewer, status=active, review scope=Task 2 spec fixup diff, base/head SHA captured, closed=no

Spec reviewer: ✅ Spec compliant now

[Cleanup gate before Task 2 code-quality reviewer spawn]
Ledger:
  - Task 2 spec re-reviewer: agent_id=spec-2-rereview, review scope captured, base/head SHA captured, report captured, reviewer result=PASS, closed=yes after PASS verdict recorded
  - Task 2 implementer: agent_id=impl-2, closed=no because code-quality fixups may still need same-session follow-up

[Lifecycle ledger update before Task 2 code-quality reviewer dispatch]
Ledger:
  - Task 2 code-quality reviewer: agent_id=pending, role=code-quality-reviewer, status=active, review scope=Task 2 diff, base/head SHA captured, closed=no

[Dispatch code quality reviewer]

[Lifecycle ledger update after Task 2 code-quality reviewer dispatch]
Ledger:
  - Task 2 code-quality reviewer: agent_id=quality-2, role=code-quality-reviewer, status=active, review scope=Task 2 diff, base/head SHA captured, closed=no

Code reviewer: Strengths: Solid. Issues (Nit): Magic number (100)

[Lifecycle ledger update]
Ledger:
  - Task 2 code reviewer: agent_id=quality-2, status=findings-recorded, review scope captured, base/head SHA captured, report captured, reviewer result=findings recorded/routed, findings captured: Magic number (100), re-review target=quality-2-rereview, closed=yes after findings routed
  - Task 2 implementer: agent_id=impl-2, closed=no because routed code-quality findings need same-session fixup

[Implementer fixes]
Implementer: Extracted PROGRESS_INTERVAL constant

[Lifecycle ledger update]
Ledger:
  - Task 2 implementer: fixup count=2, report refreshed, changed files and head SHA refreshed, test state refreshed, snapshot refreshed, closed=no because code-quality re-review is pending

[Cleanup gate before Task 2 code-quality re-review spawn]
Controller keeps Task 2 implementer open until the code-quality reviewer passes.

[Lifecycle ledger update before Task 2 code-quality re-reviewer dispatch]
Ledger:
  - Task 2 code-quality re-reviewer: agent_id=pending, role=code-quality-reviewer, status=active, review scope=Task 2 code-quality fixup diff, base/head SHA captured, closed=no

[Code-quality re-reviewer reviews again]

[Lifecycle ledger update after Task 2 code-quality re-reviewer dispatch]
Ledger:
  - Task 2 code-quality re-reviewer: agent_id=quality-2-rereview, role=code-quality-reviewer, status=active, review scope=Task 2 code-quality fixup diff, base/head SHA captured, closed=no

Code reviewer: ✅ Approved

[Lifecycle cleanup checkpoint]
Ledger:
  - Task 2 implementer: agent_id=impl-2, report captured, base/head SHA captured, changed files captured, snapshot captured, test state captured, closed=yes after reviewer loops passed
  - Task 2 spec reviewer: agent_id=spec-2, review scope captured, base/head SHA captured, report captured, reviewer result=findings recorded/routed, findings captured: Missing progress reporting; Extra --json flag, closed=yes after findings routed
  - Task 2 spec re-reviewer: agent_id=spec-2-rereview, review scope captured, base/head SHA captured, report captured, reviewer result=PASS, closed=yes after PASS verdict recorded earlier
  - Task 2 code reviewer: agent_id=quality-2, review scope captured, base/head SHA captured, report captured, reviewer result=findings recorded/routed, findings captured: Magic number (100), closed=yes after findings routed
  - Task 2 code-quality re-reviewer: agent_id=quality-2-rereview, review scope captured, base/head SHA captured, report captured, reviewer result=PASS, closed=yes after PASS verdict recorded

[Mark Task 2 complete]

...

[After all tasks]
[Cleanup gate before final code-reviewer spawn]
Controller verifies task implementers, reviewers, and re-reviewers are closed, then records the final reviewer pre-dispatch row as active.
Ledger:
  - final-code-quality-reviewer: agent_id=pending, role=final-code-quality-reviewer, status=active, review scope=whole implementation diff, base/head SHA captured, closed=no

[Dispatch final code-reviewer]

[Lifecycle ledger update after final code-reviewer dispatch]
Ledger:
  - final-code-quality-reviewer: agent_id=final-quality, role=final-code-quality-reviewer, status=active, review scope=whole implementation diff, base/head SHA captured, closed=no

Final reviewer: All requirements met, ready to merge

[Lifecycle cleanup checkpoint]
Ledger:
  - final-code-quality-reviewer: agent_id=final-quality, review scope captured, base/head SHA captured, report captured, reviewer result=PASS, closed=yes after final verdict recorded

[Alternative target capability examples - separate runs, not the automatic-close run above]

[Inventory-only target variant]
Target capability for this separate run: inventory-only: target exposes session inventory but no close operation
Controller first captures each completed session's role-specific state, records open inventory (`impl-1`, `spec-1`, `quality-1`), and records `close-unavailable: inventory-only; no close operation` instead of claiming closed=yes before dispatching the next agent.

[Slot-limit spawn failure on cleanup-unavailable target - separate run]
Target capability for this separate run: cleanup-unavailable: target exposes neither inventory nor close operation
Controller classifies a slot-limit spawn failure as orchestration resource exhaustion, not task failure.
Controller runs the cleanup gate, records `close-unavailable: no inventory or close operation` for completed/superseded sessions, states that open-agent inventory is unavailable, gives explicit operator/UI cleanup guidance, reconstructs active task state from the lifecycle ledger and git, then retries the spawn exactly once.
Retry succeeds.

[Repeated blocker-family branch in the cleanup-unavailable run]
Initial blocker-family record:
  - Task 2 implementer: agent_id=impl-2a, status=BLOCKED, blocker state=context-missing, close-unavailable: no inventory or close operation after BLOCKED report and reconstructed state are captured
If a later spawned implementer reports BLOCKED with blocker state=context-missing after slot-limit recovery succeeds, the controller escalates through existing BLOCKED handling instead of retrying cleanup again.

Done!
```
