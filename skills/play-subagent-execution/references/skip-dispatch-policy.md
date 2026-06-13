# Skip-Dispatch Policy - `play-subagent-execution`

This file contains the detailed policy for the inline controller path. Load it
when evaluating mechanical task eligibility, skip-dispatch guardrails, fallback
behavior, or examples.

## Mechanical Task Taxonomy

Use the mechanical hint when the task fits one of these positive shapes:

- Approved verbatim file create: single-file create from content fully
  specified in the plan, explicitly labeled as approved verbatim artifact
  content with its authority source.
- Unambiguous identifier replacement: single-file rename where the plan
  provides exact before/after strings and there is only one correct
  substitution.

Do not use the hint for these negative shapes; the default template applies:

- TDD work. Any task with a `**TDD expectation:**` field, or legacy `Step 1:
Write the failing test` and `Step 3: Write minimal implementation` markers.
- Multi-file coordinated change where the relationship between edits is
  non-trivial.
- New module or public interface requiring naming, boundary, or API decisions.
- Plans containing the words "design", "decide", or "choose."

## Conditions

For the single-task subset of plans that are also fully mechanical approved
verbatim artifact work or unambiguous identifier replacement, the implementer
dispatch itself is skipped. The controller executes Write/Edit, satisfies
verification expectations, and commits inline.

All five guardrails must hold for inline execution. If condition #4 fails, stop
before implementation and report BLOCKED/NEEDS_CONTEXT for the task contract.
Other misses fall back to the dispatched-implementer flow.

| # | Guardrail | Detection signal |
| --- | --- | --- |
| 1 | Plan is single-task | Task count from plan extraction = 1. |
| 2 | Task is fully mechanical | Task header carries `**Mode:** mechanical`. |
| 3 | No clarifying questions could plausibly arise | Implicit: the upstream two-gate `play-planning` return completed, meaning both Plan Review and Implementer Executability Review passed before `Plan written to <path>.` was emitted. Direct invocations without that upstream return fail this guardrail and fall back to dispatched implementation. |
| 4 | Task contract gate is satisfied | The task has either a structurally complete `**Contract checklist:**` naming every required checklist surface, or a task-specific no-trigger omission reason backed by the upstream two-gate `play-planning` return. Present Contract Example Discipline obligations also satisfy the gate rule below. |
| 5 | No tests need to be authored | Task body contains no `**TDD expectation:**` field and no legacy TDD step-pair markers. |

In the case when task text includes Contract Example Discipline or an
equivalent clearly labeled section/obligation, present obligations are part of
guardrail #4: positive examples match the target post-change contract, not the
pre-change contract; invalid examples mutate exactly one named contract
dimension unless multi-fault behavior is intentional and named; and derived
fields stay consistent with source facts or are explicitly justified.

## Inline Execution Sequence

When all five guardrails hold:

1. Write/Edit. Apply the file change as the plan specifies. For approved
   verbatim file create, this is a single Write call. For unambiguous identifier
   replacement, use exact before/after strings from the plan.
2. Verify. Satisfy the task's `**Verification expectations:**` field by
   choosing an appropriate check from source-owned project docs, config, tests,
   or file inspection after applying the change. Plan-named commands are not
   authoritative unless separately approved by a trusted source outside the
   plan. Treat verification as unnecessary only when the task explicitly says
   no additional verification is required and the controller can justify that
   from the task contract.
3. Commit. Glob for `**/commit-guideline*.md` and follow it; otherwise use
   Conventional Commits in imperative mood.
4. Mark task complete in TodoWrite.

After step 4, if the controller validates both controller-local parent state
and an `issue-priming/auto-handoff/v1` audit artifact proving this single-task
run came from `issue-priming-workflow --auto` and that downstream
`branch-review --fix` is mandatory, return to the caller immediately.
Otherwise, dispatch the existing final whole-implementation code-quality
reviewer as on the dispatched path.

There is no DONE-report step and no DONE-report snapshot request. No
DONE-report contract applies because there is no dispatched implementer.

## Fallback

If guardrail #4 fails, stop before implementation and report the contract gap;
do not execute inline, dispatch a mechanical implementer, or dispatch a full
implementer against a missing or invalid task contract. Other guardrail misses
fall back to dispatched implementation. Template choice for those fallback cases
is driven by `**Mode:** mechanical` in the task header, except when guardrail #5
fails; TDD work uses `implementer-prompt.md` regardless of any mechanical hint.

- Guardrail #1 fails: standard multi-task flow with executor-computed per-task
  review routing.
- Guardrail #2 fails: single-task dispatched flow with
  `implementer-prompt.md`.
- Guardrail #4 fails: stop before implementation and report
  BLOCKED/NEEDS_CONTEXT with the exact missing checklist, unexplained `N/A`, or
  unconfirmed owner, authority, source-of-truth, consumer, generated-output, or
  evidence surface.
- Guardrail #5 fails: single-task dispatched flow with `implementer-prompt.md`,
  overriding any `**Mode:** mechanical` hint.

## Skip-Dispatch Examples

Positive: a single-task plan whose Task 1 header includes `**Mode:** mechanical`,
whose body specifies a docs-only ADR file write with full approved
verbatim artifact content, whose contract checklist is complete, and whose body
has no TDD markers. All five guardrails hold; the controller writes the file,
commits, and marks the task complete.

Negative: a single-task plan whose Task 1 lacks `**Mode:** mechanical` and
includes a `**TDD expectation:**` field. Guardrail #1 holds, but guardrail #2
and #5 fail. The controller falls back to dispatched mode with
`implementer-prompt.md`.
