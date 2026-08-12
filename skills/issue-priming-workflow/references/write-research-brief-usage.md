# Write research brief usage

## Role

Prepares the deterministic research-brief artifact destination.

## Invocation

Run `ISSUE_IDENTIFIER=<identifier> ISSUE_PRIMING_TODAY=<YYYY-MM-DD> bash "$ISSUE_PRIMING_WORKFLOW_DIR/scripts/write-research-brief.sh"`.

## Inputs

`ISSUE_IDENTIFIER` and `ISSUE_PRIMING_TODAY` are required.
`ISSUE_PRIMING_TODAY` must have `YYYY-MM-DD` syntax; calendar validity is not
checked. It reads no stdin and accepts no optional caller-selected path.

## Working directory

The issue worktree root is required.

## Outputs

It prints the repo-relative research-brief path on stdout; diagnostics go to stderr.

## Refusal and failures

Invalid identifiers, missing or malformed date syntax, or existing unsafe
targets exit nonzero.

## Side effects

It creates or checks `.ephemeral` and prepares the validated destination path without creating the final research-brief file or making an external mutation.

## Workflow boundary

[Issue priming workflow context](../SKILL.md) owns research content and next-phase routing.
