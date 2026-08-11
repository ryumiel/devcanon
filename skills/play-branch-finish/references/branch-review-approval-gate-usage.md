# Branch review approval gate usage

## Role

Validates branch-review approval-gate evidence.

## Invocation

Run `bash "$PLAY_BRANCH_FINISH_DIR/scripts/branch-review-approval-gate.sh"` with no arguments.

## Inputs

`BRANCH_REVIEW_REQUIRED` is optional and defaults to the disabled route; it accepts only `true` or `false`. When absent or `false`, no other input is required. When `true`, `APPROVAL_SUMMARY_FILE` is required. `BRANCH_REVIEW_FULL_REVIEW_PATH_PATTERN` and `PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT` are optional validator configuration. It reads no stdin.

## Working directory

Run from the repository root that owns the gate evidence.

## Outputs

The disabled route prints `GATE_REQUIRED=false`. A passing required route prints `GATE_REQUIRED=true`, `GATE_RESULT=passing`, and `APPROVED_HEAD_SHA=<sha>`; diagnostics use stderr.

## Refusal and failures

Missing, invalid, stale, or unreadable evidence and unavailable validation support exit nonzero.

## Side effects

The gate validates supplied evidence and does not post or otherwise mutate external state.

## Workflow boundary

[Play branch finish workflow context](../SKILL.md) owns whether and how to act on the gate result.
