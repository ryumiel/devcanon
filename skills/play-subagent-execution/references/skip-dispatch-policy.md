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
verbatim artifact work or unambiguous identifier replacement, D13 permits
guarded inline execution or a dispatched `executor`, efficient/medium. All five
guardrails pass before either guarded inline execution or executor dispatch.
The controller chooses inline only when it can perform the exact operation
directly; otherwise it dispatches `executor-prompt.md` with the same validated
authorization.

All five guardrails must hold for D13. Guardrail #4 failure blocks before source
mutation; any other missing guardrail reclassifies to D12 and uses
`implementer-prompt.md`. Do not dispatch the executor on a partial guard set.

| #   | Guardrail                                     | Detection signal                                                                                                                                                                                                                                                                                                                                                   |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Plan is single-task                           | Task count from plan extraction = 1.                                                                                                                                                                                                                                                                                                                               |
| 2   | Task is fully mechanical                      | Task header carries `**Mode:** mechanical`.                                                                                                                                                                                                                                                                                                                        |
| 3   | No clarifying questions could plausibly arise | Implicit: the upstream two-gate `play-planning` return completed, meaning both Plan Review and Implementer Executability Review passed before `Plan written to <path>.` was emitted. Direct invocations without that upstream return fail this guardrail and fall back to dispatched implementation.                                                               |
| 4   | Task contract gate is satisfied               | The task declares `FULL`, `LIGHTWEIGHT`, or `NO-TRIGGER` and satisfies that tier's structure. Both `LIGHTWEIGHT` and `NO-TRIGGER` require the upstream two-gate `play-planning` return; without it, the task must use a structurally complete `FULL` contract. Contract Example Discipline obligations are additive and do not satisfy guardrail #4 by themselves. |
| 5   | No tests need to be authored                  | Task body contains no `**TDD expectation:**` field and no legacy TDD step-pair markers.                                                                                                                                                                                                                                                                            |

In the case when extracted plan/task execution context includes Contract
Example Discipline or an equivalent clearly labeled section/obligation, present
obligations are additive after `FULL`, `LIGHTWEIGHT`, or `NO-TRIGGER`
satisfaction and do not satisfy guardrail #4 by themselves. Apply the shared
consumer rule in
[`contract-example-discipline-consumer-rule.md`](contract-example-discipline-consumer-rule.md).

## D13 Execution Sequence

When all five guardrails hold, choose exactly one path:

- **Guarded inline:** the controller performs the exact operation through the
  sequence below. The branch has no child and no DONE-report snapshot request.
- **Executor dispatch:** the controller supplies the validated exact operation
  to `executor-prompt.md`. `executor-prompt.md` owns the dispatched child's
  action and report schema; `lifecycle-status-policy.md` owns every returned
  D13 disposition.

The guarded inline sequence is:

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

After step 4, return control to
[`lifecycle-status-policy.md`](lifecycle-status-policy.md), which owns every
post-selection D13, D16, and terminal disposition. This pre-dispatch policy
makes no final-review or terminal-routing decision.

## Fallback

If guardrail #4 fails, stop before implementation and report the contract gap;
do not execute inline, dispatch an executor, or dispatch an implementer against
a missing or invalid task contract. Other guardrail misses reclassify to D12
and use `implementer-prompt.md`; the `**Mode:** mechanical` hint alone never
selects the executor.

- Guardrail #1 fails: standard multi-task D12 flow with executor-computed
  per-task review routing.
- Guardrail #2 fails: single-task D12 flow with `implementer-prompt.md`.
- Guardrail #3 fails: single-task D12 flow with `implementer-prompt.md`.
- Guardrail #4 fails: stop before implementation and report
  BLOCKED/NEEDS_CONTEXT with the exact missing or invalid tier structure,
  absent reduced-tier provenance, unexplained `N/A`, or unconfirmed owner,
  authority, source-of-truth, consumer, generated-output, or evidence surface.
- Guardrail #5 fails: single-task D12 flow with `implementer-prompt.md`,
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
