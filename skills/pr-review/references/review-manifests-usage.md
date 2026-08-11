# Review manifests usage

## Role

Performs deterministic PR-review handoff, result, body, and findings operations.

## Invocation

Run `bash "$PR_REVIEW_DIR/scripts/review-manifests.sh"` followed by exactly one of `prepare-handoff-write`, `write-handoff`, `validate-handoff`, `prepare-result-write`, `write-result`, `validate-result`, `read-result-for-preview`, `write-review-body`, `recover-review-body-publication`, `replace-findings`, or `render-phase5-audit-summary`.

## Inputs

The runtime consumes each command's named manifest arguments and environment without shell translation. `replace-findings` requires `PR_NUMBER`, `HEAD_SHA`, `REPOSITORY`, `RESULT_FILE`, and `PLAY_REVIEW_HELPER`, reads exactly one complete findings envelope from stdin, and accepts no extra argument. The other ten commands read no stdin.

## Working directory

Use the target review worktree root for result and findings operations and the primary repository root for lease-status and primary-repository operations.

## Outputs

It emits validated manifest paths or structured results on stdout and diagnostics on stderr.

## Refusal and failures

Unknown operations, malformed stdin, invalid manifests, stale evidence, unsafe paths, or unavailable runtime exit nonzero.

## Side effects

Write operations update only validated local manifests, artifacts, or result paths.

## Workflow boundary

[PR review workflow context](../SKILL.md) owns review interpretation, approval, and continuation.
