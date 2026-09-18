# Direct/manual terminal handoff

Condition-scoped operating procedure for the
[play-subagent-execution workflow](../SKILL.md) when the invocation is direct
or manual and no verified owning caller final whole-diff gate exists. That
workflow owns terminal-handoff policy, the completion-boundary contract, the
rule against restating branch finish choices, and the parent-owned return path
when a verified owning caller gate does exist. This file supplies the
pre-finish reporting and branch-level review status resolution sequence for
the direct/manual route only.

## Report before any handoff

If the built-in final whole-implementation review passes, report implementation
status and final review status before any branch-review or finish handoff.
Before invoking `play-branch-finish`, also report these observable claims:
built-in final whole-implementation review passed; this skill did not run
branch-level review; run `branch-review` before `play-branch-finish` when the
active workflow requires branch-level review before PR creation; proceeding to
`play-branch-finish` is acceptable only when that workflow does not require
branch-level review.

## Resolve branch-level review status

When the active workflow requires branch-level review before PR creation, hand
off to `branch-review` before any `play-branch-finish` handoff. Use
`branch-review --fix` as the branch-level gate before finish only when the
owning workflow already grants auto-fix authority or the operator explicitly
confirms that branch-review may auto-commit fixes; otherwise hand off to
branch-review without auto-fix authority and wait for review approval evidence.
Do not invoke `play-branch-finish` until `branch-review` returns review
approval evidence or the active workflow explicitly waives branch-level review.
If that workflow does not require branch-level review, then invoke
`play-branch-finish`.
