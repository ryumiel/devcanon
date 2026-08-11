# Write research brief usage

## Role

Prepares the deterministic research-brief artifact destination.

## Invocation

Run `ISSUE_IDENTIFIER=<identifier> ISSUE_PRIMING_TODAY=<YYYY-MM-DD> bash "$ISSUE_PRIMING_WORKFLOW_DIR/scripts/write-research-brief.sh"`.

## Inputs

`ISSUE_IDENTIFIER` and `ISSUE_PRIMING_TODAY` are required. It reads no stdin and accepts no optional caller-selected path.

## Working directory

The issue worktree root is required.

## Outputs

It prints the repo-relative research-brief path on stdout; diagnostics go to stderr.

## Refusal and failures

Invalid identifiers, dates, or existing unsafe targets exit nonzero.

## Side effects

It may create the validated local research-brief target; it makes no external mutation.

## Workflow boundary

[Issue priming workflow context](../SKILL.md) owns research content and next-phase routing.
