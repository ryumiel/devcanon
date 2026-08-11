# Validate snapshot manifest usage

## Role

Validates a requested implementer snapshot manifest against a base commit.

## Invocation

Run `BASE_SHA=<commit> SNAPSHOT_FILE=<repo-relative-path> bash "$PLAY_SUBAGENT_EXECUTION_DIR/scripts/validate-snapshot-manifest.sh"`.

## Inputs

`BASE_SHA` and `SNAPSHOT_FILE` are required; `CONTROLLER_HEAD_SHA` is optional. It reads no stdin.

## Working directory

The repository root is required.

## Outputs

Successful validation is silent; diagnostics go to stderr and failures exit nonzero.

## Refusal and failures

Missing environment, malformed manifests, unsafe paths, stale commits, or byte mismatches are rejected.

## Side effects

Validation is read-only apart from private `.ephemeral` validation scratch files that it removes.

## Workflow boundary

[Play subagent execution workflow context](../SKILL.md) owns whether validation evidence permits continuation.
