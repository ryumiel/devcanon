# Write assumptions comment usage

## Role

Prepares the deterministic destination for an assumptions-comment artifact.

## Invocation

Run `ISSUE_IDENTIFIER=<identifier> bash "$ISSUE_PRIMING_WORKFLOW_DIR/scripts/write-assumptions-comment.sh"`.

## Inputs

`ISSUE_IDENTIFIER` is required; `ASSUMPTIONS_COMMENT_FILE` is optional when an existing target is being checked. It reads no stdin.

## Working directory

The issue worktree root is required.

## Outputs

It prints the repo-relative artifact path on stdout; diagnostics go to stderr.

## Refusal and failures

Missing identifiers or unsafe, conflicting, or unreadable targets exit nonzero.

## Side effects

It may create the validated local artifact target; it does not publish an external comment.

## Workflow boundary

[Issue priming workflow context](../SKILL.md) owns comment contents and publication decisions.
