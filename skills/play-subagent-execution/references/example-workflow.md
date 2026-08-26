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
artifact, where a branch-review-owned fix commit invalidates downstream evidence
and returns through Candidate Closure and Source Freeze before the paired Phase
7 rerun of `branch-review --fix`, until the
final run reports zero blocking findings auto-fixed, no unresolved remaining
`Blocking` findings except findings whose `critic` verdict is `INVALID` or
`DOWNGRADE`, has a captured final approval-summary notice path, and provides
fresh final approval-summary evidence after branch-review-owned fix commits. For a
**single-task plan** the per-task reviewer dispatches are skipped (see
"Single-Task Plans" in `SKILL.md`). On a direct/manual single-task run, the
flow shrinks to: dispatch D12 implementer -> implementer self-reviews and commits
-> mark task complete -> fresh guarded D16 deep-reviewer over the whole range ->
report implementation and final review status -> resolve branch-level review
status -> hand off to `branch-review --fix` before `play-branch-finish` when
the active workflow requires branch-level review before PR creation and
owning-workflow or explicit operator authority allows auto-committing fixes;
otherwise hand off to branch-review without auto-fix authority, wait for review
approval evidence, or invoke `play-branch-finish` only when branch-level review
is not required.
On the `issue-priming-workflow --auto` single-task path, the flow returns to
the caller after task completion for Candidate Closure and Source Freeze, then
applicable downstream evidence, before Phase 7 `branch-review --fix` becomes
the whole-diff gate.

```
You: I'm using Subagent-Driven Development to execute this plan.

[Read plan file once: .ephemeral/feature-plan.md]
[Extract all 3 coherent authored tasks with full text and context]
[Create TodoWrite with all tasks]
[Use subagent-lifecycle to detect target lifecycle capability]
Target capability for this run: automatic-close-supported

[Route classification reminder]
D12 uses the source-mutable `implementer`, balanced/high, for judgment-bearing
scoped work. D13 uses guarded inline execution or the source-mutable `executor`,
efficient/medium, only when all five exact guardrails pass. A D13 executor
performs the exact validated operation and stops for controller reclassification
if judgment or a missing guardrail appears. Source-mutable task execution stays
serial.

[Fresh configuration examples]
Before each fresh D12-D16 capture, consume the controller/owner-supplied
already-rendered `D12_MODEL`, already-rendered `D13_MODEL`, already-rendered
`D14_MODEL`, already-rendered `D15_MODEL`, or already-rendered `D16_MODEL`
binding and validate the route's complete tuple, authority, self-contained
prompt/context, output, and termination. Apply the shared `subagent-lifecycle`
rule before creation. For this run the controller uses:

D12: task_name=d12_1, agent_type=implementer,
     model=D12_MODEL, reasoning_effort=high,
     fork_turns=none, message=full task/context/snapshot/report prompt
D13: task_name=d13_1, agent_type=executor,
     model=D13_MODEL, reasoning_effort=medium,
     fork_turns=none, message=exact guarded task/context/snapshot/report prompt
D14: task_name=d14_1, agent_type=deep-reviewer,
     model=D14_MODEL, reasoning_effort=xhigh,
     fork_turns=none, message=independent D14 same-head response-only prompt
D15: task_name=d15_1, agent_type=deep-reviewer,
     model=D15_MODEL, reasoning_effort=xhigh,
     fork_turns=none, message=independent D15 same-head response-only prompt
D16: task_name=d16_1, agent_type=deep-reviewer,
     model=D16_MODEL, reasoning_effort=xhigh,
     fork_turns=none, message=fresh D16 whole-range response-only prompt

Each `model` value above is the full nonblank owner-rendered resolution, not a
literal capability name. A missing, blank, unresolved, or mismatched binding
blocks before capture or spawn; do not locate a source checkout or use an
alias, nearby, or ambient model.

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
[D14 and D15 use separate no-handoff GUARD-001 baselines]
[For each route: capture -> spawn -> verify -> validate/retain -> cleanup -> apply]
[Dispatch fresh D14 and D15 deep-reviewers concurrently]
[Ledger post-dispatch: Task 1 spec reviewer, agent_id=spec-1]
[Ledger post-dispatch: Task 1 code-quality reviewer, agent_id=quality-1]
Spec reviewer: ✅ Spec compliant - all requirements met, nothing extra
Code-quality reviewer: Strengths: Good test coverage, clean. Issues: None. Approved.

[Lifecycle cleanup checkpoint]
Task 1 implementer: status=DONE, report captured, base/head SHA captured, changed files captured, snapshot state=emitted, test state captured, observed close result=success, closed=yes after reviewer loops passed.
Task 1 spec reviewer: agent_id=spec-1, review scope captured, base/head SHA captured, reviewed head SHA=task-1-head, report captured, reviewer result disposition=final-pass, observed close result=success, closed=yes after PASS verdict recorded.
Task 1 code-quality reviewer: agent_id=quality-1, review scope captured, base/head SHA captured, reviewed head SHA=task-1-head, report captured, reviewer result disposition=final-pass because same-head spec passed and task head stayed current, observed close result=success, closed=yes after final quality disposition recorded.

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
[D14 and D15 use separate no-handoff GUARD-001 baselines]
[For each route: capture -> spawn -> verify -> validate/retain -> cleanup -> apply]
[Dispatch fresh D14 and D15 deep-reviewers concurrently]
[Ledger post-dispatch: Task 2 spec reviewer, agent_id=spec-2]
[Ledger post-dispatch: Task 2 code-quality reviewer, agent_id=quality-2]
Spec reviewer: ❌ Issues:
  - Missing: Progress reporting (spec says "report every 100 items")
Code-quality reviewer: Strengths: Solid. Issues (Nit): Magic number (100)

[Lifecycle ledger update]
Task 2 spec reviewer: agent_id=spec-2, status=findings-recorded, review scope captured, base/head SHA captured, reviewed head SHA=task-2-head, report captured, reviewer result disposition=final-findings, findings captured: Missing progress reporting, disposition pending controller preview/classification, observed close result=success, closed=yes after findings retained.
Task 2 code-quality reviewer: agent_id=quality-2, status=findings-recorded, review scope captured, base/head SHA captured, reviewed head SHA=task-2-head, report captured, reviewer result disposition=advisory, findings captured: Magic number (100), disposition pending controller preview/classification, observed close result=success, closed=yes after advisory findings retained.
Controller first retains a bounded impact preview for every candidate and
classifies independently before grouping: the missing progress report is an
in-scope product blocker because the extracted Task 2 acceptance requires
progress reporting every 100 items, the reachable long-running batch path
otherwise leaves operators without its required liveness signal, and the
minimal behavioral regression is that single omitted emission; the magic-number
suggestion is an adjacent independently releasable defect. Because D14
authorizes a fix, the controller retains that D15 disposition provisionally but
does not emit a caller handoff. This complete same-head wave counts as failed
round 1, so only the progress-reporting correction can route to Task 2
implementer.

[Lifecycle ledger disposition update]
Task 2 spec reviewer: routing target=Task 2 implementer, re-review target=spec-2-rereview after the authorized fix.
Task 2 code-quality reviewer: provisional adjacent disposition, caller handoff deferred, routing target=none, re-review target=quality-2-rereview after the authorized fix.
Task 2 implementer: closed=no because routed same-head findings need same-session fixup.

[Implementer fixes issues]
The D12 tuple is unchanged, so the controller keeps `impl-2` and sends only the
incremental reviewer findings/task context with `followup_task`. When this is a
verified-auto route, the message also carries the freshly revalidated
controller-provided auto-route attestation as structured context; direct/manual
routes do not invent it. It does not resend the full implementer prompt, full
task context, role, model, effort, fork, or an equivalent configuration override.
Implementer: Added progress reporting

[Lifecycle ledger update]
Task 2 implementer: fixup count=1, blocker state=none, report refreshed,
changed files and head SHA refreshed, test state refreshed, snapshot
state=emitted, closed=no because spec re-review and any required code-quality
re-review or disposition are pending.
Task 2 D14 and D15 results: dispositions=stale; the fix invalidates both results, and the provisional D15 disposition becomes stale before any caller handoff.

[If the review-loop limit is reached]
After a third complete same-head wave that requires an authorized correction,
the controller records the failed round and returns `BLOCKED` with
`review-loop-limit` before D12. A current finding-bound approval can authorize
one identified fix attempt without resetting the count; a failed fresh wave
after it blocks again. Alternatively, only a material authoritative change to
the task scope or acceptance, followed by refreshed context, structural
validation, head/route revalidation, and reclassification, can reset the
current-episode fixup count and start a fresh review budget. Cosmetic wording
does not resume or dispatch.

[Revalidate effective review route]
Controller compares the original Task 2 base SHA to the refreshed task head.
The route may only preserve or escalate; the refreshed diff still requires
`spec-and-quality`, so continue to fresh D14 spec review and fresh D15 quality
review against the same refreshed task head. A fix has no irrelevance exception.

[Cleanup gate before Task 2 spec re-review spawn]
Controller keeps Task 2 implementer open until spec and required quality
dispositions are final.

[Ledger pre-dispatch: Task 2 spec re-reviewer, agent_id=pending]
[Spec re-reviewer reviews again]
[Ledger post-dispatch: Task 2 spec re-reviewer, agent_id=spec-2-rereview]
Spec reviewer: ✅ Spec compliant now

[Cleanup gate before Task 2 code-quality re-reviewer spawn]
Task 2 spec re-reviewer: review scope captured, base/head SHA captured, reviewed head SHA=task-2-fixup-head, report captured, reviewer result disposition=final-pass, observed close result=success, closed=yes after PASS verdict recorded.
Task 2 implementer: closed=no because code-quality fixups may still need same-session follow-up.

[Ledger pre-dispatch: Task 2 code-quality re-reviewer, agent_id=pending]
[Dispatch code-quality re-reviewer]
[Ledger post-dispatch: Task 2 code-quality re-reviewer, agent_id=quality-2-rereview]
Code-quality reviewer: ✅ Approved
The earlier magic-number candidate is absent, so no caller handoff is emitted;
only a fresh post-fix D15 candidate could support one.

[Lifecycle ledger update]
Task 2 code-quality re-reviewer: review scope captured, base/head SHA captured, reviewed head SHA=task-2-fixup-head, report captured, reviewer result disposition=final-pass after same-head spec pass and current task-head validation, observed close result=success, closed=yes after PASS verdict recorded.

[Lifecycle cleanup checkpoint]
Task 2 implementer: status=DONE, report captured, base/head SHA captured, changed files captured, snapshot state=emitted, test state captured, observed close result=success, closed=yes after reviewer loops passed.
Task 2 spec reviewer: agent_id=spec-2, review scope captured, base/head SHA captured, report captured, concrete findings captured, reviewer result disposition=final-findings, observed close result=success, closed=yes after findings routing.
Task 2 spec re-reviewer: agent_id=spec-2-rereview, review scope captured, base/head SHA captured, report captured, reviewer result disposition=final-pass, observed close result=success, closed=yes after PASS verdict.
Task 2 code-quality reviewer: agent_id=quality-2, review scope captured, base/head SHA captured, report captured, concrete findings captured, reviewer result disposition=stale after fixup changed head, observed close result=success, closed=yes after stale disposition recorded.
Task 2 code-quality re-reviewer: agent_id=quality-2-rereview, review scope captured, base/head SHA captured, report captured, reviewer result disposition=final-pass, observed close result=success, closed=yes after PASS verdict.

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
changed files captured, snapshot state=skipped, test state captured, observed
close result=success, closed=yes after the effective route completed. Controller uses its own git diff and
committed HEAD reads if it needs file content.

[Mark Task 3 complete]

...

[After all tasks]
[Cleanup gate before fresh D16 deep-reviewer spawn]
Controller verifies task implementers, reviewers, and re-reviewers are closed,
then records the distinct D16 pre-dispatch row: agent_id=pending,
role=deep-reviewer, review scope=whole implementation range, base/head SHA
captured, closed=no. The D15 task-quality session is not reused.

[D16 no-handoff GUARD-001]
Capture a fresh baseline -> spawn D16 and retain raw response/status -> verify
before semantic validation -> validate and retain the whole-range response in
memory -> cleanup the exact baseline -> apply only after cleanup.
[Ledger post-dispatch: D16 deep-reviewer, agent_id=final-quality]
D16 reviewer: All requirements met, ready for terminal handoff

[Lifecycle cleanup checkpoint]
D16 deep-reviewer: agent_id=final-quality, review scope captured, base/head SHA
captured, report captured, reviewer result=PASS, observed close result=success,
closed=yes after final verdict recorded and guard cleanup succeeded.

[D16 alternate finding loop]
D16 blocking findings route to a final fix, and any fix commit requires a fresh
D16 capture, spawn, verify, validate, cleanup, and apply cycle. The fresh D16
reviews the refreshed whole implementation range; it never reuses D15 or the
pre-fix D16 response.

[Changed-tuple continuation example]
A D14 finding routes to the compatible original D12 `impl-2` session, so the
controller sends only incremental findings/task context with `followup_task`.
The D12 tuple and stable task identity remain unchanged. The head-changing fix
makes the D14/D15 verdicts stale, then fresh one-shot D14 and D15 reviewers
inspect the refreshed head. By contrast, a D13 boundary reclassification or D16
final whole-implementation fix captures its role-specific result, records the
supersession decision, applies the lifecycle cleanup gate, and creates a
complete fresh `d12_<instance_ordinal>` child. If no compatible original D12
session exists, that fresh-child path also applies.

[D16 alternate ordinary failure]
After safe cleanup, an unavailable, failed, malformed, or
verification-rejected D16 keeps final review incomplete and returns `BLOCKED`
to the owning caller or direct/manual terminal-status path; it never enters
branch finish. D16 detected source mutation or cleanup failure is
guard-integrity terminal and leaves source visible.

[Return to owning caller]
`play-subagent-execution` returns to `issue-priming-workflow --auto`.

[Caller closes the candidate, then runs the final whole-diff gate]
`issue-priming-workflow` completes Candidate Closure and Source Freeze plus
applicable downstream evidence, then Phase 7 runs `branch-review --fix` until a run
reports zero blocking findings auto-fixed and captures that final run's
approval-summary notice path. If a branch-review-owned fix commit lands after
that review, it invalidates downstream evidence and returns through Candidate
Closure and Source Freeze before the paired Phase 7 rerun on the new `HEAD`,
which captures fresh final approval-summary evidence.
Branch review: no unresolved remaining `Blocking` findings except `INVALID` or
`DOWNGRADE` critic verdicts.

[Caller continues]
`issue-priming-workflow` proceeds to PR creation.

[Alternative target capability examples - separate runs, not the automatic-close run above]

[Responses API Multi-agent inventory-only target variant]
Using `subagent-lifecycle` target capability guidance:
Hosted actions: `spawn_agent`, `send_message`, `followup_task`, `wait_agent`, `interrupt_agent`, and `list_agents` — exactly these six.
Target capability for this separate run: inventory-only: target exposes session inventory but no hosted close operation.
Compact ledger observation: session identity=`impl-1`; role/scope=`implementer`/Task 1; current operational state=`interrupted`; wait observation=settled after `wait_agent`; observed reuse=retained context available to `followup_task`; inventory evidence=`list_agents` returned `impl-1`; captured role result=implementer report; current cleanup outcome=`close-unavailable: inventory-only; no close operation`.
`interrupt_agent` stopped the active turn without deleting its context; interruption is never closure. Waiting, inventory, retained-context reuse, and interruption remain separate from the cleanup outcome. Controller captures each completed session's role-specific state before cleanup or supersession and never claims closed=yes on this run.

[Slot-limit spawn failure on cleanup-unavailable target - separate run]
Using `subagent-lifecycle` slot-limit recovery:
Target capability for this separate run: cleanup-unavailable: target exposes neither inventory nor close operation
Controller classifies a slot-limit spawn failure as orchestration resource exhaustion, not task failure.
Controller runs the cleanup gate, records `close-unavailable: no inventory or close operation` for completed/superseded sessions, states that open-agent inventory is unavailable, gives explicit operator/UI cleanup guidance, waits for operator confirmation that manual cleanup is complete, reconstructs active task state from the lifecycle ledger and git, then retries the spawn exactly once.
Retry succeeds.
The retry uses the same previously validated role/model/effort pair; slot
recovery does not permit a different configuration.

[Repeated blocker-family branch in the cleanup-unavailable run]
Initial blocker-family record:
  - Task 2 implementer: agent_id=impl-2a, status=BLOCKED, blocker state=context-missing: needs target install path, close-unavailable: no inventory or close operation after BLOCKED report and reconstructed state are captured
If a later spawned implementer reports BLOCKED with blocker state=context-missing: needs target install path after slot-limit recovery succeeds, the controller escalates through existing BLOCKED handling instead of retrying cleanup again.

Done!
```
