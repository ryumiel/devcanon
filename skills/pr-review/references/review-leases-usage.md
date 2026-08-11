# Review leases usage

## Role

Performs deterministic PR-review lease lifecycle operations.

## Invocation

Run `bash "$PR_REVIEW_DIR/scripts/review-leases.sh"` followed by exactly one of `derive-path`, `discover`, `session-create`, `write`, `record-audit-failure`, `validate`, `read-status`, `inspect-worktree`, or `cleanup-worktree`; remaining arguments are forwarded unchanged to the packaged `pr-review-leases` runtime command.

## Inputs

`derive-path` requires `REPOSITORY`, `PR_NUMBER`, `PRIMARY_REPOSITORY_ROOT`, and `WORKTREE_PATH`; `LEASE_FILE` is optional. `discover` and `session-create` require `REPOSITORY`, `PR_NUMBER`, and `PRIMARY_REPOSITORY_ROOT`; `session-create` also requires `HEAD_SHA`, `BASE_REF`, `HEAD_REF`, and `UPDATED_AT`. `write`, `validate`, and `read-status` require `REPOSITORY`, `PR_NUMBER`, `PRIMARY_REPOSITORY_ROOT`, `WORKTREE_PATH`, and `LEASE_FILE`; `write` also requires `STATE`, `BASE_REF`, `HEAD_REF`, and `UPDATED_AT`, with lifecycle artifact, timestamp, presentation, failure, and GitHub-post fields optional; `read-status` also requires `RESULT_FILE` and `HEAD_SHA`.

`record-audit-failure` requires the primary identity, `LEASE_FILE`, `STATE`, `BASE_REF`, `HEAD_REF`, `UPDATED_AT`, and the gated-failure fields. `inspect-worktree` and `cleanup-worktree` require `REPOSITORY`, `PR_NUMBER`, `PRIMARY_REPOSITORY_ROOT`, `WORKTREE_PATH`, and `LEASE_FILE`. No command reads stdin. `DEVCANON_RUNTIME_DIR` is optional for runtime diagnostics.

## Working directory

Use the primary repository root for lease storage commands and the review worktree root for worktree inspection or cleanup.

## Outputs

It emits the command's structured lease result on stdout and diagnostics on stderr.

## Refusal and failures

Unknown commands, invalid lease state, missing runtime, unsafe paths, or lifecycle conflicts exit nonzero.

## Side effects

`session-create`, `write`, and `record-audit-failure` write lease records; `cleanup-worktree` can remove a validated worktree. `inspect-worktree` can also write cleanup metadata when the lifecycle state requires recording it. `derive-path`, `discover`, `validate`, and `read-status` are read-only.

## Workflow boundary

[PR review workflow context](../SKILL.md) owns lifecycle judgment and cleanup continuation.
