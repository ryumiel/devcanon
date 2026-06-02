# Issue 397 Pressure Results

Date: 2026-06-02

Baseline: current `skills/play-review-response/SKILL.md` before Task 2 source
edits.

## Summary

| Scenario | Baseline result | Evidence |
| --- | --- | --- |
| Structural planned review feedback | FAIL | Current prose routes structural planned work to a direct `.ephemeral/*-plan.md` created by `play-review-response`, then directly invokes `play-subagent-execution` with `Plan: <path>`. |
| Ordinary inline typo | PASS | Current prose keeps simple local typo feedback in `Inline execution - handle directly in this skill`, and the inline example fixes directly. |
| No-code invalid feedback | PASS | Current prose keeps technically invalid, stale, already-addressed, explanation-only, or unclear feedback in `No-code response - reply, report, or ask without changing code`. |
| GitHub side effects | PASS | Current prose keeps GitHub replies, refetching, resolution eligibility, Pre-Push Review Gate, and closeout in `play-review-response`. |

## Structural Planned Review Feedback

Observed baseline behavior:

- The skill says `Planned execution - write a review-response plan, then hand it
  to play-subagent-execution`.
- It instructs planned execution to create a direct/manual
  `.ephemeral/*-plan.md` handoff.
- It tells the parent to invoke the executor with `Plan: <path>`.
- It requires a written `.ephemeral/*-plan.md` before implementation.

Rationalization allowed by current prose:

- Because structural, policy-sensitive, lifecycle-sensitive, and generated-output
  feedback is planned work, the current skill text makes
  `play-review-response` the direct author of the executor plan.
- The current plan self-review language reinforces that the parent-created plan
  must contain acceptance criteria, TDD expectations, verification, and executor
  handoff suitability.

RED conclusion:

- This fails the approved design. Structural review-response planning input must
  be `.ephemeral/*-design.md`, passed to `play-planning` with
  `Design: <path>`, with the generated plan path captured from
  `Plan written to <path>.`.

## Ordinary Inline Typo

Observed baseline behavior:

- Current prose includes `Inline execution - handle directly in this skill`.
- Inline execution is allowed for one or two clear, low-risk, local comments
  with no contract, workflow-policy, schema, generated-output, security,
  lifecycle, data-loss, or cross-module risk.
- The inline example says to fix directly and run the focused check.

RED conclusion:

- This route is already correct and must be preserved.

## No-Code Invalid Feedback

Observed baseline behavior:

- Current prose includes `No-code response - reply, report, or ask without
  changing code`.
- No-code outcomes include technically invalid, stale, already-addressed,
  explanation-only, and needs-user-clarification feedback.
- The skill requires verified evidence and applicable GitHub lifecycle handling.

RED conclusion:

- This route is already correct and must be preserved.

## GitHub Side Effects And Closeout

Observed baseline behavior:

- Current prose keeps GitHub thread replies/refetching and resolution eligibility
  owned by `play-review-response`.
- Pre-Push Review Gate runs before push, reply, resolve, or comment side
  effects.
- The plan self-review example says GitHub closeout is left with
  `play-review-response`.
- It states GitHub reply, refetch, and resolution closeout must not be
  dispatched as `play-subagent-execution` implementation tasks.

RED conclusion:

- This ownership is already correct and must be preserved while the structural
  planning handoff changes.
