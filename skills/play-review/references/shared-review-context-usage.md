# Shared review context usage

## Role

Writes and builds bounded shared review-context artifacts.

## Invocation

Run `bash "$PLAY_REVIEW_DIR/scripts/shared-review-context.sh" write-review-context-input|build-review-context`.

## Inputs

`write-review-context-input` requires the input fields accepted by the runtime and writes the input manifest. `build-review-context` requires that validated manifest path and writes the context file. Both take no stdin; `DEVCANON_RUNTIME_DIR` is an optional runtime override.

## Working directory

Run from the target repository root.

## Outputs

It prints the resulting repo-relative context path on stdout and diagnostics on stderr.

## Refusal and failures

Unknown commands, missing runtime, malformed inputs, or unsafe artifact paths exit nonzero.

## Side effects

Successful commands write only their validated `.ephemeral` input or context artifact.

## Workflow boundary

[Play review workflow context](../SKILL.md) owns reviewer routing and use of the context.
