# Review manifests usage

## Role

Performs deterministic PR-review handoff, result, body, and findings operations.

## Invocation

Run `bash "$PR_REVIEW_DIR/scripts/review-manifests.sh" <operation>` with the operation's documented environment.

## Inputs

Each operation requires its named manifest facts and paths; `replace-findings` reads exactly one complete findings envelope from stdin. Optional environment is operation-specific.

## Working directory

Use the target review worktree root or primary repository root required by the selected operation.

## Outputs

It emits validated manifest paths or structured results on stdout and diagnostics on stderr.

## Refusal and failures

Unknown operations, malformed stdin, invalid manifests, stale evidence, unsafe paths, or unavailable runtime exit nonzero.

## Side effects

Write operations update only validated local manifests, artifacts, or result paths.

## Workflow boundary

[PR review workflow context](../SKILL.md) owns review interpretation, approval, and continuation.
