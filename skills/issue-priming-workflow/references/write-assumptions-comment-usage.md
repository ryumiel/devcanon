# Write assumptions comment usage

## Role

Prepares the deterministic destination for an assumptions-comment artifact.

## Invocation

Run `ISSUE_IDENTIFIER=<identifier> bash "$ISSUE_PRIMING_WORKFLOW_DIR/scripts/write-assumptions-comment.sh"`.

## Inputs

`ISSUE_IDENTIFIER` is required; `ASSUMPTIONS_COMMENT_FILE` optionally selects a direct-child `.ephemeral/*-assumptions-comment.md` destination. It reads no stdin.

## Working directory

The issue worktree root is required.

## Outputs

It prints the repo-relative artifact path on stdout; diagnostics go to stderr.

## Refusal and failures

Missing identifiers or unsafe, symlinked, directory, or nonregular existing targets exit nonzero.

## Side effects

It creates or checks `.ephemeral` and prepares the validated destination path without creating the final artifact file or publishing an external comment.

## Workflow boundary

[Issue priming workflow context](../SKILL.md) owns comment contents and publication decisions.
