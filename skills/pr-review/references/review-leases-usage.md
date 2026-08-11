# Review leases usage

## Role

Performs deterministic PR-review lease lifecycle operations.

## Invocation

Run `bash "$PR_REVIEW_DIR/scripts/review-leases.sh" <derive-path|discover|session-create|write|record-audit-failure|validate|read-status|inspect-worktree|cleanup-worktree>`.

## Inputs

The selected command requires its documented lease and worktree environment; `DEVCANON_RUNTIME_DIR` is optional for supported runtime diagnostics. It reads no stdin.

## Working directory

Use the primary repository root or review worktree root required by the selected command.

## Outputs

It emits the command's structured lease result on stdout and diagnostics on stderr.

## Refusal and failures

Unknown commands, invalid lease state, missing runtime, unsafe paths, or lifecycle conflicts exit nonzero.

## Side effects

Mutating commands write lease records or remove validated worktrees; inspection commands are read-only.

## Workflow boundary

[PR review workflow context](../SKILL.md) owns lifecycle judgment and cleanup continuation.
