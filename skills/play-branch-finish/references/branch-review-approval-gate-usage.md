# Branch review approval gate usage

## Role

Validates branch-review approval-gate evidence.

## Invocation

Run `bash "$PLAY_BRANCH_FINISH_DIR/scripts/branch-review-approval-gate.sh"` with the gate environment documented by the owning workflow.

## Inputs

The gate requires branch-review evidence environment values and paths; `PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT` is an optional support-validator override. It reads no stdin.

## Working directory

Run from the repository root that owns the gate evidence.

## Outputs

It emits the gate result on stdout and diagnostics on stderr.

## Refusal and failures

Missing, invalid, stale, or unreadable evidence and unavailable validation support exit nonzero.

## Side effects

The gate validates supplied evidence and does not post or otherwise mutate external state.

## Workflow boundary

[Play branch finish workflow context](../SKILL.md) owns whether and how to act on the gate result.
