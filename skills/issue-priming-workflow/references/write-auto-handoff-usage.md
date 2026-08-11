# Write auto handoff usage

## Role

Prepares the deterministic automatic-handoff artifact destination.

## Invocation

Run `PLAN_PATH=<path> bash "$ISSUE_PRIMING_WORKFLOW_DIR/scripts/write-auto-handoff.sh"`.

## Inputs

`PLAN_PATH` is required and must name a readable direct-child `.ephemeral/*-plan.md` file. The helper derives the current `HEAD`; it accepts no optional inputs or stdin.

## Working directory

The issue worktree root is required.

## Outputs

It prints the repo-relative handoff path on stdout; diagnostics go to stderr.

## Refusal and failures

Missing, unsafe, stale, or mismatched plan inputs exit nonzero.

## Side effects

It may create the validated local handoff artifact target; it does not dispatch a child.

## Workflow boundary

[Issue priming workflow context](../SKILL.md) owns handoff contents and dispatch continuation.
