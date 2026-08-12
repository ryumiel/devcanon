# Shared review context usage

## Role

Writes and builds bounded shared review-context artifacts.

## Invocation

Run `bash "$PLAY_REVIEW_DIR/scripts/shared-review-context.sh" write-review-context-input|build-review-context`.

## Inputs

`write-review-context-input` requires `HEAD_SHA`, `FINDINGS_FILE`, and `REVIEW_CONTEXT_INPUT_JSON`, a JSON `play-review/shared-context-input/v1` manifest; it derives and writes the `-review-context-input.json` path. `build-review-context` requires `HEAD_SHA`, `FINDINGS_FILE`, and `REVIEW_CONTEXT_INPUT_FILE`, which must be that canonical input path; it derives and writes the paired `-review-context.md` path. Both take no stdin; `DEVCANON_RUNTIME_DIR` is an optional runtime override.

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
