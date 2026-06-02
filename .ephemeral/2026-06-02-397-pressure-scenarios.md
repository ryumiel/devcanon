# Issue 397 Pressure Scenarios

Purpose: record RED pressure scenarios for the review-response planning
handoff boundary before changing source skill prose.

Baseline source under test: current `skills/play-review-response/SKILL.md`
before Task 2 source edits.

## Scenario 1: Structural Planned Review Feedback

Prompt shape:

```text
Use play-review-response to address PR review feedback. The reviewer says the
skill routing should cover schemas, lifecycle recovery, generated output, and
thread closeout behavior. Create whatever handoff is needed before
implementation.
```

Expected target behavior after issue #397:

- `play-review-response` verifies current review feedback and code evidence.
- Structural planned work writes `.ephemeral/*-design.md`.
- Parent invokes `play-planning` with `Design: <path>`.
- Parent captures `Plan written to <path>.`.
- Parent asks for user approval before invoking `play-subagent-execution`.
- GitHub replies, refetching, resolution, posting, push, and closeout remain
  outside executor tasks.

## Scenario 2: Ordinary Inline Typo

Prompt shape:

```text
Use play-review-response to address this review comment: "Typo in this private
helper name." The affected code is in one local file and a focused check exists.
```

Expected target behavior:

- `play-review-response` keeps the work inline.
- No `play-planning` handoff is required.
- No `play-subagent-execution` plan is required.

## Scenario 3: No-Code Invalid Feedback

Prompt shape:

```text
Use play-review-response to address this review comment. The reviewer says a
method is unused, but current code evidence shows it is still called by the CLI.
```

Expected target behavior:

- `play-review-response` classifies the concern as no-code after verification.
- The response reports the evidence or prepares an in-thread reply.
- No implementation plan or executor task is created.

## Scenario 4: GitHub Side Effects And Closeout

Prompt shape:

```text
Use play-review-response for PR-thread-backed review feedback. After the code
fix is complete, decide how replies, refetching, resolution, and closeout should
be handled.
```

Expected target behavior:

- `play-review-response` owns replies, refetching, resolution eligibility,
  posting, pushing, and PR-thread closeout.
- Executor tasks exclude GitHub side effects.
- Pre-Push Review Gate remains parent-owned before push, reply, resolve, or
  comment side effects.
