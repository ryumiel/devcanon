# Review leases usage

## Role

Performs deterministic PR-review lease lifecycle operations.

## Invocation

Run `bash "$PR_REVIEW_DIR/scripts/review-leases.sh"` followed by exactly one of `derive-path`, `discover`, `session-create`, `write`, `record-audit-failure`, `validate`, `read-status`, `inspect-worktree`, or `cleanup-worktree`; remaining arguments are forwarded unchanged to the packaged `pr-review-leases` runtime command.

## Inputs

`derive-path` requires `REPOSITORY`, positive `PR_NUMBER`, `PRIMARY_REPOSITORY_ROOT`, and `WORKTREE_PATH`; `LEASE_FILE` is optional. `discover` requires `REPOSITORY`, `PR_NUMBER`, and `PRIMARY_REPOSITORY_ROOT`. `session-create` adds 40-character `HEAD_SHA` naming an available Git commit object itself (not an annotated tag that peels to a commit), nonblank `BASE_REF` and `HEAD_REF`, and UTC `UPDATED_AT`. `write`, `validate`, and `read-status` require `REPOSITORY`, `PR_NUMBER`, `PRIMARY_REPOSITORY_ROOT`, `WORKTREE_PATH`, and `LEASE_FILE`; `write` also requires `STATE` (`created`, `reviewed`, `gated`, `posted`, `aborted`, or `failed`), `BASE_REF`, `HEAD_REF`, and `UPDATED_AT`, while `read-status` additionally requires `RESULT_FILE` and `HEAD_SHA`.

For `write`, `CREATED_AT` is optional (otherwise `UPDATED_AT` is used); `HANDOFF_FILE`, `RESULT_FILE`, `APPROVED_REVIEW_FILE`, `VALIDATED_REVIEW_PAYLOAD_FILE`, `PRESENTED_AT`, `PRESENTATION_STATUS` (`preview-current` or `edited`), `FINISHED_AT`, `TERMINAL_REASON`, `FAILURE_PHASE`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY` (`recoverable`, `unrecoverable`, or `unknown`), `GITHUB_POST_ATTEMPTED`, `GITHUB_POST_RESULT`, `GITHUB_POSTED_AT`, and `EXPECTED_STATE` are transition-conditional. Aborted transitions require `FINISHED_AT` and `TERMINAL_REASON`; posted transitions require `APPROVED_REVIEW_FILE`, `VALIDATED_REVIEW_PAYLOAD_FILE`, `FINISHED_AT`, and `GITHUB_POSTED_AT`; failed transitions require `FINISHED_AT`, `FAILURE_PHASE` (`handoff-validation`, `review`, `result-validation`, `preview-render`, `approval-freeze`, `stale-head`, or `github-post`), `FAILURE_REASON`, and `FAILURE_RECOVERABILITY`. A `github-post` failure additionally requires `GITHUB_POST_ATTEMPTED=true`, `GITHUB_POST_RESULT=failed`, and an approved-review file available through `APPROVED_REVIEW_FILE` or the existing lease's `artifacts.approved_review_file`; when supplied explicitly, normal source consistency and validation rules apply.

`record-audit-failure` requires `REPOSITORY`, `PR_NUMBER`, `PRIMARY_REPOSITORY_ROOT`, `LEASE_FILE`, `STATE=failed`, `BASE_REF`, `HEAD_REF`, `UPDATED_AT`, `FINISHED_AT`, `FAILURE_PHASE=preview-render`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY`, and `EXPECTED_STATE=gated`; it is accepted only for an existing gated lease with gated preview-render evidence. `inspect-worktree` and `cleanup-worktree` require `REPOSITORY`, `PR_NUMBER`, `PRIMARY_REPOSITORY_ROOT`, `WORKTREE_PATH`, and `LEASE_FILE`. For `cleanup-worktree`, optional `ALLOW_POLICY_OVERRIDE=yes` permits removal from a non-`posted`/non-`aborted` state when all other cleanup guards permit it. `session-create` also accepts optional `ALLOW_TERMINAL_ADVANCE=yes`; absence preserves the default route and any other supplied value is invalid. No command reads stdin. `DEVCANON_RUNTIME_DIR` is optional for runtime diagnostics.

## Working directory

Every operation, including inspection and cleanup, runs from `PRIMARY_REPOSITORY_ROOT`, which must be the physical primary Git worktree root.

## Outputs

It emits the command's structured lease result on stdout and diagnostics on stderr.

## Refusal and failures

Command-validation failures—unknown commands, missing runtime, unsafe or missing paths, and invalid lifecycle state for validation or write operations—exit nonzero with diagnostics on stderr. `session-create` conflicts and manual-cleanup outcomes instead exit 1 with a structured `pr-review/session-create/v1` JSON result on stdout and empty stderr. `inspect-worktree` and `cleanup-worktree` classify invalid lease state and other non-removable worktree conditions as exit-zero structured results, including `REFUSAL_REASON=invalid-lease`; cleanup reports its `retained`, `skipped`, or `failed` outcome on stdout.

## Side effects

`session-create` creates a reservation, registers a detached review worktree, publishes its lease, then removes its reservation on success. With the exact terminal-advance opt-in, it instead advances the same clean registered canonical detached path to the supplied provider head, archives the terminal lease, publishes a fresh empty-authority created lease, and removes only proven unchanged old lease-owned direct-child artifacts that are not tracked at the target head. The success and conflict/manual-cleanup result family is unchanged. Failed default fresh creation attempts roll back where possible; incomplete rollback or verification may retain the reservation, worktree, Git registration, or lease. After terminal-head advancement, incomplete work returns existing `manual-cleanup` with `rollback-incomplete` and retains observable evidence and the reservation. `write` and `record-audit-failure` write lease records; `cleanup-worktree` can remove a validated worktree and, for eligible leases, rewrites cleanup metadata for retained, skipped, failed, and removed outcomes. `inspect-worktree` can also write cleanup metadata when the lifecycle state requires recording it. `derive-path`, `discover`, `validate`, and `read-status` are read-only.

## Workflow boundary

[PR review workflow context](../SKILL.md) owns lifecycle judgment and cleanup continuation.
