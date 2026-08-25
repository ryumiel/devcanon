# Write assumptions comment usage

## Role

Prepares the deterministic destination for an assumptions-comment artifact.

## Invocation

Run `ISSUE_IDENTIFIER=<identifier> node "$ISSUE_PRIMING_WORKFLOW_DIR/scripts/write-assumptions-comment.mjs"` on POSIX. In PowerShell, set `$env:ISSUE_IDENTIFIER`, then run `node "$env:ISSUE_PRIMING_WORKFLOW_DIR/scripts/write-assumptions-comment.mjs"`. The adjacent `.sh` file is a POSIX compatibility adapter only.

## Inputs

`ISSUE_IDENTIFIER` is required; `ASSUMPTIONS_COMMENT_FILE` optionally selects a direct-child `.ephemeral/*-assumptions-comment.md` destination. It reads no stdin.

## Working directory

The issue worktree root is required.

## Outputs

It prints exactly one safe repo-relative `.ephemeral/<slug>-assumptions-comment.md` path with one trailing newline. The entrypoint rejects empty, multiline, or malformed runtime output; diagnostics go to stderr.

## Refusal and failures

Missing identifiers or unsafe, symlinked, directory, or nonregular existing targets exit nonzero.

## Side effects

It creates or checks `.ephemeral` and prepares the validated destination path without creating the final artifact file or publishing an external comment.

## Workflow boundary

[Issue priming workflow context](../SKILL.md) owns comment contents and publication decisions.
