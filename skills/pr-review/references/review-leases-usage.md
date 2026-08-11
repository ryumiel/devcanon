# Review leases usage

## Role

Performs deterministic PR-review lease lifecycle operations.

## Invocation

Run `bash "$PR_REVIEW_DIR/scripts/review-leases.sh"` followed by exactly one of `derive-path`, `discover`, `session-create`, `write`, `record-audit-failure`, `validate`, `read-status`, `inspect-worktree`, or `cleanup-worktree`; remaining arguments are forwarded unchanged to the packaged `pr-review-leases` runtime command.

## Inputs

The forwarded runtime command consumes its named lease/worktree arguments and environment; this shell adapter adds no arguments or stdin protocol. `DEVCANON_RUNTIME_DIR` is optional for runtime diagnostics. It reads no stdin.

## Working directory

Use the primary repository root for lease storage commands and the review worktree root for worktree inspection or cleanup.

## Outputs

It emits the command's structured lease result on stdout and diagnostics on stderr.

## Refusal and failures

Unknown commands, invalid lease state, missing runtime, unsafe paths, or lifecycle conflicts exit nonzero.

## Side effects

Mutating commands write lease records or remove validated worktrees; inspection commands are read-only.

## Workflow boundary

[PR review workflow context](../SKILL.md) owns lifecycle judgment and cleanup continuation.
