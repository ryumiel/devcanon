# Review leases usage

## Role

Performs deterministic PR-review lease lifecycle operations.

## Invocation

Run `bash "$PR_REVIEW_DIR/scripts/review-leases.sh"` followed by exactly one of `derive-path`, `discover`, `session-create`, `write`, `record-audit-failure`, `validate`, `read-status`, `inspect-worktree`, or `cleanup-worktree`; remaining arguments are forwarded unchanged to the packaged `pr-review-leases` runtime command.

## Inputs

`derive-path` requires `REPOSITORY`, positive `PR_NUMBER`, `PRIMARY_REPOSITORY_ROOT`, and `WORKTREE_PATH`; `LEASE_FILE` is optional. `discover` requires `REPOSITORY`, `PR_NUMBER`, and `PRIMARY_REPOSITORY_ROOT`. `session-create` adds 40-character `HEAD_SHA`, nonblank `BASE_REF` and `HEAD_REF`, and UTC `UPDATED_AT`. `write`, `validate`, and `read-status` require `REPOSITORY`, `PR_NUMBER`, `PRIMARY_REPOSITORY_ROOT`, `WORKTREE_PATH`, and `LEASE_FILE`; `write` also requires `STATE` (`created`, `reviewed`, `gated`, `posted`, `aborted`, or `failed`), `BASE_REF`, `HEAD_REF`, and `UPDATED_AT`, while `read-status` additionally requires `RESULT_FILE` and `HEAD_SHA`.

For `write`, `CREATED_AT` is optional (otherwise `UPDATED_AT` is used); `HANDOFF_FILE`, `RESULT_FILE`, `APPROVED_REVIEW_FILE`, `VALIDATED_REVIEW_PAYLOAD_FILE`, `PRESENTED_AT`, `PRESENTATION_STATUS` (`preview-current` or `edited`), `FINISHED_AT`, `TERMINAL_REASON`, `FAILURE_PHASE`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY` (`recoverable`, `unrecoverable`, or `unknown`), `GITHUB_POST_ATTEMPTED`, `GITHUB_POST_RESULT`, `GITHUB_POSTED_AT`, and `EXPECTED_STATE` are transition-conditional. Aborted transitions require `FINISHED_AT` and `TERMINAL_REASON`; posted transitions require `APPROVED_REVIEW_FILE`, `VALIDATED_REVIEW_PAYLOAD_FILE`, `FINISHED_AT`, and `GITHUB_POSTED_AT`; failed transitions require `FINISHED_AT`, `FAILURE_PHASE` (`handoff-validation`, `review`, `result-validation`, `preview-render`, `approval-freeze`, `stale-head`, or `github-post`), `FAILURE_REASON`, and `FAILURE_RECOVERABILITY`. A `github-post` failure additionally requires `GITHUB_POST_ATTEMPTED=true` and `GITHUB_POST_RESULT=failed`.

`record-audit-failure` requires `REPOSITORY`, `PR_NUMBER`, `PRIMARY_REPOSITORY_ROOT`, `LEASE_FILE`, `STATE=failed`, `BASE_REF`, `HEAD_REF`, `UPDATED_AT`, `FINISHED_AT`, `FAILURE_PHASE=preview-render`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY`, and `EXPECTED_STATE=gated`; it is accepted only for an existing gated lease with gated preview-render evidence. `inspect-worktree` and `cleanup-worktree` require `REPOSITORY`, `PR_NUMBER`, `PRIMARY_REPOSITORY_ROOT`, `WORKTREE_PATH`, and `LEASE_FILE`. No command reads stdin. `DEVCANON_RUNTIME_DIR` is optional for runtime diagnostics.

## Working directory

Every operation, including inspection and cleanup, runs from `PRIMARY_REPOSITORY_ROOT`, which must be the physical primary Git worktree root.

## Outputs

It emits the command's structured lease result on stdout and diagnostics on stderr.

## Refusal and failures

Unknown commands, invalid lease state, missing runtime, unsafe paths, or lifecycle conflicts exit nonzero.

## Side effects

`session-create` creates a reservation, registers a detached review worktree, publishes its lease, then removes its reservation on success. Failed creation attempts roll back where possible; if rollback or verification is incomplete, the command returns a manual-cleanup outcome and may retain its reservation, worktree, Git registration, or lease artifacts. `write` and `record-audit-failure` write lease records; `cleanup-worktree` can remove a validated worktree. `inspect-worktree` can also write cleanup metadata when the lifecycle state requires recording it. `derive-path`, `discover`, `validate`, and `read-status` are read-only.

## Workflow boundary

[PR review workflow context](../SKILL.md) owns lifecycle judgment and cleanup continuation.
