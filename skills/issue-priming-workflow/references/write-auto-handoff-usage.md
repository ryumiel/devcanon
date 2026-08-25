# Write auto handoff usage

## Role

Writes the validated automatic-handoff artifact.

## Invocation

Run `PLAN_PATH=<path> node "$ISSUE_PRIMING_WORKFLOW_DIR/scripts/write-auto-handoff.mjs"` on POSIX. In PowerShell, set `$env:PLAN_PATH`, then run `node "$env:ISSUE_PRIMING_WORKFLOW_DIR/scripts/write-auto-handoff.mjs"`. The adjacent `.sh` file is a POSIX compatibility adapter only.

## Inputs

`PLAN_PATH` is required and must name a readable direct-child `.ephemeral/*-plan.md` file. The helper derives the current `HEAD`; it accepts no optional inputs or stdin.

## Working directory

The issue worktree root is required.

## Outputs

It prints exactly one safe repo-relative `.ephemeral/issue-priming-auto-handoff-<40-lowercase-hex>.json` path with one trailing newline. The entrypoint rejects empty, multiline, or malformed runtime output; diagnostics go to stderr.

## Refusal and failures

Missing, unsafe, unreadable, nonregular, or symlinked plan paths exit nonzero. The helper does not parse plan content or bind plan metadata to the current `HEAD`.

## Side effects

It creates or replaces the derived local auto-handoff JSON artifact; it does not dispatch a child.

## Workflow boundary

[Issue priming workflow context](../SKILL.md) owns handoff contents and dispatch continuation.
