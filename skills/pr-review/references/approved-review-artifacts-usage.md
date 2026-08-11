# Approved review artifacts usage

## Role

Materializes, freezes, validates, and inspects approved PR-review payload artifacts.

## Invocation

From the target review worktree root, run `bash "$PR_REVIEW_DIR/scripts/approved-review-artifacts.sh"` followed by one of: `materialize-review-payload`, `materialize-validated-review-payload`, `freeze-approved-review`, `validate-approved-review`, or `inspect-approved-review-ownership`. The current dispatcher selects the first positional command and ignores additional positional arguments. No operation reads stdin.

## Inputs

All commands require 40-character `HEAD_SHA` and positive `PR_NUMBER`. `materialize-review-payload` additionally requires `FINDINGS_FILE`, `REVIEW_BODY_FILE`, `REVIEW_SURFACE`, and `REVIEW_EVENT`; `REVIEW_PAYLOAD_FILE` is optional and otherwise derives from the head. `materialize-validated-review-payload` requires `APPROVED_REVIEW_FILE`. `freeze-approved-review` requires `FINDINGS_FILE`, `REVIEW_BODY_FILE`, and `REVIEW_PAYLOAD_FILE`; its scope-decision path derives from `HEAD_SHA`. `validate-approved-review` and `inspect-approved-review-ownership` require `APPROVED_REVIEW_FILE`.

`BASE_REF` is required for support-payload comparison. `SCOPE_DECISION_FILE` is an optional normal binding, but when supplied it must equal the canonical path derived from `HEAD_SHA`; otherwise that canonical path is used, and its missing or unreadable artifact is refused. `PRIOR_THREADS_FILE` is also optional, but when supplied it must match the scope decision's `github-prior-threads` prior-context path. It may be omitted, while the scope decision must still carry a valid prior-context pair and support validation refuses any required prior artifact that is missing or invalid. `PLAY_REVIEW_HELPER` and `PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT` are optional sibling-helper overrides. No command reads stdin.

## Working directory

Every operation requires the target review worktree root and a real nonsymlinked `.ephemeral` directory for artifacts.

## Outputs

`materialize-review-payload` and `materialize-validated-review-payload` print their new repo-relative payload path. `freeze-approved-review` prints the canonical approved-review path. `validate-approved-review` prints the validated payload JSON. `inspect-approved-review-ownership` prints one JSON object with `review_body_file` and `review_payload_file`. Diagnostics use stderr and refusals exit nonzero.

## Refusal and failures

The helper rejects missing or invalid PR/head metadata, invalid events, unsafe or unreadable artifact paths, malformed envelopes or payloads, stale or mismatched digests, absent scope evidence, unavailable support helpers, and an existing validated-payload target.

## Side effects

`materialize-review-payload` accepts an existing regular payload target and atomically replaces it with `mv -f`; it therefore can overwrite that artifact. `materialize-validated-review-payload` refuses a preexisting validated-payload target. `freeze-approved-review` writes the approved-review JSON after all input and support checks pass. Validation and ownership inspection are read-only.

## Workflow boundary

[PR review workflow context](../SKILL.md) owns command selection, approval, and continuation.
