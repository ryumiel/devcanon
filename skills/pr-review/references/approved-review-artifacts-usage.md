# Approved review artifacts usage

## Role

Validates and materializes approved PR-review artifacts.

## Invocation

Run `bash "$PR_REVIEW_DIR/scripts/approved-review-artifacts.sh" <operation>` with the operation's documented review environment.

## Inputs

Each operation requires its named review metadata and artifact paths; payload-producing operations may read one documented payload from stdin. Optional support inputs are operation-specific.

## Working directory

Run from the target review worktree root.

## Outputs

It emits validated paths or materialized payloads on stdout and diagnostics on stderr.

## Refusal and failures

Unknown operations, invalid review evidence, stale digests, unsafe paths, or malformed stdin exit nonzero.

## Side effects

Materialization operations write only their validated local approved-review targets.

## Workflow boundary

[PR review workflow context](../SKILL.md) owns approval and posting continuation.
