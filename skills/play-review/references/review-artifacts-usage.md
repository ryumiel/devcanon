# Review artifacts usage

## Role

Performs validated review-artifact operations for play-review.

## Invocation

Run `bash "$PLAY_REVIEW_DIR/scripts/review-artifacts.sh" <operation>` with that operation's documented environment and files.

## Inputs

The operation selects required environment, paths, and payload inputs; some operations read one documented JSON payload from stdin. Optional values are operation-specific.

## Working directory

Run from the target repository root unless the selected operation documents another root.

## Outputs

It emits validated artifact paths or payloads on stdout and diagnostics on stderr.

## Refusal and failures

Unknown operations, invalid schemas, stale evidence, unsafe paths, or invalid stdin exit nonzero.

## Side effects

Write and materialization operations change only their validated local artifact targets.

## Workflow boundary

[Play review workflow context](../SKILL.md) owns operation selection, interpretation, and continuation.
