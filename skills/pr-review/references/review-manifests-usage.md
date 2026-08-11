# Review manifests usage

## Role

Performs deterministic PR-review handoff, result, body, and findings operations.

## Invocation

Run `bash "$PR_REVIEW_DIR/scripts/review-manifests.sh"` followed by exactly one of `prepare-handoff-write`, `write-handoff`, `validate-handoff`, `prepare-result-write`, `write-result`, `validate-result`, `read-result-for-preview`, `write-review-body`, `recover-review-body-publication`, `replace-findings`, or `render-phase5-audit-summary`.

## Inputs

`prepare-handoff-write` and `prepare-result-write` require `PR_NUMBER` and `HEAD_SHA`. `write-handoff` also requires `REPOSITORY`, `EXECUTION_WORKING_DIRECTORY`, `BASE_REF`, `HEAD_REF`, `REVIEW_SCOPE_BASE_REF`, `ACTIVE_DIFF_RANGE`, `FULL_PR_DIFF_RANGE`, `MODE`, `LANGUAGE_HINTS_JSON`, `FOLLOW_UP_STATE`, `IS_FOLLOWUP_NARROW`, and `SCOPE_DECISION_FILE`; `PRIOR_THREADS_FILE` and `LAST_REVIEWED_SHA` are optional. `validate-handoff` requires `REPOSITORY` and `HANDOFF_FILE`; that handoff must carry its own valid `pr_number` and `review_head_sha`.

`write-result` requires `PR_NUMBER`, `HEAD_SHA`, `REPOSITORY`, `FINDINGS_FILE`, `SCOPE_DECISION_FILE`, and `PRESENTATION_STATUS`; `PRIOR_THREADS_FILE`, `REVIEW_BODY_FILE`, `CONTEXT_FILE`, `RENDERED_PREVIEW_FILE`, and `PRESENTATION_NOTES` are optional. `validate-result` and `read-result-for-preview` require `REPOSITORY` and `RESULT_FILE`; the result must carry matching valid `pr_number` and `review_head_sha`. `write-review-body` and `recover-review-body-publication` additionally require `PR_NUMBER` and `HEAD_SHA` so they can require the canonical body path for that exact PR/head pair; `write-review-body` reads Markdown from stdin, while recovery does not. `replace-findings` requires `PR_NUMBER`, `HEAD_SHA`, `REPOSITORY`, `RESULT_FILE`, and `PLAY_REVIEW_HELPER`, reads exactly one complete findings envelope from stdin, and accepts no extra argument. `render-phase5-audit-summary` requires `REPOSITORY`, `PR_NUMBER`, `HEAD_SHA`, `RESULT_FILE`, `PRIMARY_REPOSITORY_ROOT`, `WORKTREE_PATH`, and `LEASE_FILE`, and reads no stdin.

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
