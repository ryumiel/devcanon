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
Target capability: automatic-close-supported

Task 1: Hook lifecycle

[Cleanup gate before Task 1 implementer spawn]
Ledger: no completed or superseded sessions to close

[Get Task 1 text and context (already extracted)]
[Dispatch implementation subagent with full task text + context]

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
  - Task 1 implementer: agent_id=impl-1, base/head SHA captured, changed files captured, snapshot captured, test state captured, closed=no because reviewer fix loops may still need same-session follow-up

[Cleanup gate before Task 1 spec reviewer spawn]
Controller keeps Task 1 implementer open for possible spec-review fixups.

[Dispatch spec compliance reviewer]
Spec reviewer: ✅ Spec compliant - all requirements met, nothing extra

[Cleanup gate before Task 1 code-quality reviewer spawn]
Ledger:
  - Task 1 spec reviewer: agent_id=spec-1, reviewer result=PASS, closed=yes after PASS verdict recorded
  - Task 1 implementer: agent_id=impl-1, closed=no because code-quality fixups may still need same-session follow-up

[Get git SHAs, dispatch code quality reviewer]
Code reviewer: Strengths: Good test coverage, clean. Issues: None. Approved.

[Lifecycle cleanup checkpoint]
Ledger:
  - Task 1 implementer: agent_id=impl-1, base/head SHA captured, changed files captured, snapshot captured, test state captured, closed=yes after reviewer loops passed
  - Task 1 spec reviewer: agent_id=spec-1, reviewer result=PASS, closed=yes after PASS verdict recorded earlier
  - Task 1 code reviewer: agent_id=quality-1, reviewer result=PASS, closed=yes after PASS verdict recorded

[Inventory-only target variant]
Target capability: inventory-only: target exposes session inventory but no close operation
Controller records `close-unavailable: inventory-only; no close operation` instead of claiming closed=yes before dispatching the next agent.

[Cleanup-unavailable target variant]
Target capability: cleanup-unavailable: target exposes neither inventory nor close operation
Controller records that inventory is unavailable and gives explicit operator/UI cleanup guidance when slot pressure occurs.

[Mark Task 1 complete]

Task 2: Recovery and repair modes

[Get Task 2 text and context (already extracted)]
[Cleanup gate before Task 2 implementer spawn]
Controller verifies Task 1 completed sessions are already closed or marked close-unavailable before spawning Task 2.

[Dispatch implementation subagent with full task text + context]

[Slot-limit spawn failure on cleanup-unavailable target]
Controller classifies this as orchestration resource exhaustion, not task failure.
Controller reconstructs active task state from the lifecycle ledger and git, states that open-agent inventory is unavailable, gives explicit operator/UI cleanup guidance, then retries the spawn exactly once.
Retry succeeds.

Implementer: [No questions, proceeds]
Implementer:
  - Added verify/repair modes
  - 8/8 tests passing
  - Self-review: All good
  - Committed

[Dispatch spec compliance reviewer]
Spec reviewer: ❌ Issues:
  - Missing: Progress reporting (spec says "report every 100 items")
  - Extra: Added --json flag (not requested)

[Implementer fixes issues]
Implementer: Removed --json flag, added progress reporting

[Spec reviewer reviews again]
Spec reviewer: ✅ Spec compliant now

[Dispatch code quality reviewer]
Code reviewer: Strengths: Solid. Issues (Nit): Magic number (100)

[Implementer fixes]
Implementer: Extracted PROGRESS_INTERVAL constant

[Code reviewer reviews again]
Code reviewer: ✅ Approved

[Mark Task 2 complete]

...

[After all tasks]
[Dispatch final code-reviewer]
Final reviewer: All requirements met, ready to merge

Done!
```
