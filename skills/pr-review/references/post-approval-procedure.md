# Post-Approval Procedure

This is the subordinate operating procedure for [PR Review](../SKILL.md).
The main skill owns approval, continuation routing, source freshness, and
cleanup policy. Existing helper usage documents and the
[lease lifecycle contract](review-lease-lifecycle-contract.md) retain their
non-overlapping ownership. This reference supplies no approval or cleanup
authority. For an authorized abort/failure cleanup, use only Phase 7; do not
enter Phase 6 or perform a GitHub mutation.

## Phase 6: Post

Only after the main skill’s Phase 5 user approval and Phase 6 entry checks:

1. **Revalidate the approved preview before binding approval intent.** Re-run
   the Phase 5 `read-result-for-preview` consumption against the same trusted
   `REVIEW_HEAD_SHA` and `REVIEW_RESULT_FILE`; it rebinds the approved findings,
   body, scope-decision, and optional artifact paths only if their digests still
   validate. Any post-preview mutation fails before event derivation, payload
   materialization, or GitHub mutation. This revalidation is not approval.

   ```bash
   APPROVAL_REVALIDATION_STATUS=0
   read_pr_review_result_manifest_for_preview || APPROVAL_REVALIDATION_STATUS=$?
   cd "$REVIEW_CALLER_DIR" || exit 1
   [ "$APPROVAL_REVALIDATION_STATUS" -eq 0 ] || exit "$APPROVAL_REVALIDATION_STATUS"
   ```

2. **Verify the latest result remains the user-gated lease result.** From the
   primary repository root, invoke the existing `review-leases.sh read-status`
   contract with the revalidated result. Its lease digest gate prevents a
   coordinated replacement of the result and its artifacts from inheriting
   prior approval. Any nonzero status fails closed before event derivation,
   payload materialization, or GitHub mutation.

   ```bash
   (
     cd "$REVIEW_CALLER_DIR" || exit 1
     REPOSITORY="<owner/repo>" \
     PR_NUMBER="$PR_NUMBER" \
     PRIMARY_REPOSITORY_ROOT="$REVIEW_CALLER_DIR" \
     WORKTREE_PATH="$WORKING_DIRECTORY" \
     LEASE_FILE="$LEASE_FILE" \
     RESULT_FILE="$REVIEW_RESULT_FILE" \
     HEAD_SHA="$REVIEW_HEAD_SHA" \
       bash "$PR_REVIEW_LEASE_HELPER" read-status >/dev/null
   ) || exit 1
   ```

3. **Bind the approved review event from the user-approved intent.** Do not
   reuse an ambient or previously exported `REVIEW_EVENT`; unset it first, then
   derive it from the explicit Phase 5 approval that applies to the latest
   rendered preview. Approval intent maps to GitHub review events as follows:
   approve => `APPROVE`; request-changes or blocking review => `REQUEST_CHANGES`;
   post as comment, comment-only review, or no-verdict review => `COMMENT`.
   Any unrecognized approval intent is a contract failure; stop before payload
   construction.

   ```bash
   unset REVIEW_EVENT
   case "$APPROVED_REVIEW_INTENT" in
     approve) REVIEW_EVENT="APPROVE" ;;
     request-changes | blocking | blocking-review) REVIEW_EVENT="REQUEST_CHANGES" ;;
     post-as-comment | comment | comment-only | no-verdict) REVIEW_EVENT="COMMENT" ;;
     *) echo "unrecognized approved review intent: $APPROVED_REVIEW_INTENT" >&2; exit 1 ;;
   esac
   ```

4. **Materialize and freeze the approved payload artifact before posting.** On
   fresh or resumed posting, before the first approved-review helper invocation
   or result interpretation in Phase 6, read
   [approved-review-artifacts usage](approved-review-artifacts-usage.md)
   in full from the installed `pr-review` skill bundle. If the guidance is
   missing, blank, unreadable, or unavailable, stop before that dependent helper
   action; do not invoke the helper or interpret its result. The reference owns
   invocation mechanics, inputs, outputs, and refusals; this workflow owns
   approval, command selection, interpretation, and continuation.

   Use the approved Phase 5 artifacts; do not rebuild findings or the review body
   from conversation text. `PR_REVIEW_DIR` must resolve to the installed
   `pr-review` skill bundle, not the repository under review. Bind
   `PR_REVIEW_HELPER="$PR_REVIEW_DIR/scripts/approved-review-artifacts.sh"`.
   `materialize-review-payload` receives the caller-provided
   `REVIEW_SURFACE=pr-review` and `REVIEW_EVENT`, plus the approved findings and
   body inputs, and writes the deterministic payload. Then freeze it. Run this as a
   caller-shell function, not a subshell, so `APPROVED_REVIEW_FILE` remains
   bound for the stale-head, validation, and posting steps below. Save and
   restore the starting directory before those later repo-root-relative steps:

   ```bash
   PR_REVIEW_DIR="<installed-pr-review-skill-bundle>"
   PR_REVIEW_HELPER="$PR_REVIEW_DIR/scripts/approved-review-artifacts.sh"
   REVIEW_CALLER_DIR="$(pwd -P)" || exit 1
   : "${REVIEW_SCOPE_BASE_REF:?Phase 3 scope base ref missing}"
   : "${REVIEW_SCOPE_DECISION_FILE:?Phase 3 scope-decision artifact path missing}"

   build_and_freeze_approved_review() {
     cd "$WORKING_DIRECTORY" || return 1
     HEAD_SHA="$REVIEW_HEAD_SHA"  # immutable Phase 4 review head; current HEAD may differ before posting
     REVIEW_PAYLOAD_FILE=$(
       HEAD_SHA="$REVIEW_HEAD_SHA" \
       PR_NUMBER="$PR_NUMBER" \
       FINDINGS_FILE="$REVIEW_FINDINGS_FILE" \
       REVIEW_SURFACE="pr-review" \
       REVIEW_BODY_FILE="$REVIEW_BODY_FILE" \
       REVIEW_EVENT="$REVIEW_EVENT" \
         bash "$PR_REVIEW_HELPER" materialize-review-payload
     ) || return 1
     APPROVED_REVIEW_FILE=$(
       HEAD_SHA="$REVIEW_HEAD_SHA" \
       PR_NUMBER="$PR_NUMBER" \
       FINDINGS_FILE="$REVIEW_FINDINGS_FILE" \
       REVIEW_BODY_FILE="$REVIEW_BODY_FILE" \
       REVIEW_PAYLOAD_FILE="$REVIEW_PAYLOAD_FILE" \
       BASE_REF="$REVIEW_SCOPE_BASE_REF" \
       SCOPE_DECISION_FILE="$REVIEW_SCOPE_DECISION_FILE" \
         bash "$PR_REVIEW_HELPER" freeze-approved-review || return 1
     ) || return 1
     [ -n "$APPROVED_REVIEW_FILE" ] || { echo "approved review artifact path missing" >&2; return 1; }
   }

   BUILD_AND_FREEZE_STATUS=0
   build_and_freeze_approved_review || BUILD_AND_FREEZE_STATUS=$?
   cd "$REVIEW_CALLER_DIR" || exit 1
   [ "$BUILD_AND_FREEZE_STATUS" -eq 0 ] || exit "$BUILD_AND_FREEZE_STATUS"
   ```

   The frozen artifact schema is `pr-review/approved-review/v1`. It stores the
   approved `review_head_sha`, findings path, review body path, review payload
   path, Phase 3 scope-decision path, SHA-256 digests for all four source
   artifacts including the scope-decision artifact, and the exact payload
   object. The helper validates the stored scope-decision artifact and digest
   before posting. The helper ensures `commit_id`, `event`, `body`, and `comments` all land in the JSON body,
   and requires ranged inline comments to pair `start_line` with
   `start_side: "RIGHT"` while single-line comments omit both fields.
   Any nonzero helper exit is a contract failure; fail closed before posting.

5. **Refuse stale heads before posting.** Re-read the PR head SHA from GitHub
   immediately before posting. If it differs from `REVIEW_HEAD_SHA`, stop and
   return to Phase 1; do not post an approved artifact against a stale head.

   ```sh
   CURRENT_HEAD_SHA="$(gh pr view <N> --json headRefOid -q .headRefOid)"
   [ "$CURRENT_HEAD_SHA" = "$REVIEW_HEAD_SHA" ] || {
     echo "PR head changed since review; refusing to post stale approved review" >&2
     exit 1
   }
   ```

6. **Post exactly the validated approved payload.** After the stale-head guard
   passes, have the approved-review helper materialize the guarded canonical
   payload and bind its returned path. Only invoke `gh api`
   after materialization exits zero. Do not call `build-github-review-payload` again after user approval.
   Do not edit, reformat, filter, or reconstruct the payload between validation
   and posting.

   ```sh
   VALIDATED_REVIEW_PAYLOAD_FILE=$( (
     cd "$WORKING_DIRECTORY" || exit 1
     HEAD_SHA="$REVIEW_HEAD_SHA" \
       PR_NUMBER="$PR_NUMBER" \
       BASE_REF="$REVIEW_SCOPE_BASE_REF" \
       APPROVED_REVIEW_FILE="$APPROVED_REVIEW_FILE" \
       bash "$PR_REVIEW_HELPER" materialize-validated-review-payload
   ) ) || exit 1
   [ -n "$VALIDATED_REVIEW_PAYLOAD_FILE" ] || exit 1
   (
     cd "$WORKING_DIRECTORY" || exit 1
     gh api repos/{owner}/{repo}/pulls/<N>/reviews \
       --method POST \
       --silent \
       --input "$VALIDATED_REVIEW_PAYLOAD_FILE"
   )
   ```

7. Resolve threads via GraphQL only after the approved review post succeeds and
   only for threads the user approved for resolution:

   ```sh
   gh api graphql --silent -f query='mutation { resolveReviewThread(input: {threadId: "<id>"}) { thread { isResolved } } }'
   ```

8. Verify each API response succeeded. Report failures, stop on error.

After the GitHub review post succeeds, write `posted` with
`APPROVED_REVIEW_FILE`, `VALIDATED_REVIEW_PAYLOAD_FILE`, `FINISHED_AT`, and `GITHUB_POSTED_AT`. If
approved-review validation, stale-head verification, or GitHub posting fails
after the approval freeze, write `failed` with `FINISHED_AT`, `FAILURE_PHASE`,
`FAILURE_REASON`, and `FAILURE_RECOVERABILITY` before any cleanup decision.
Preserve the result manifest, findings file, review body, rendered preview,
approved-review artifact, and validated payload file when available. Do not
retry or reconstruct a GitHub mutation from conversation text.

## Phase 7: Cleanup

Before a lease-gated cleanup attempt that may remove the review worktree or its
owned artifacts, apply Phase 2 validation/extraction, then clear the live family
and association. Retain bounded detached navigation only after successful
same-PR continuation. A failed or refused cleanup discards pending candidates
and does not restore live custody.

Never remove a review worktree directly. Use `review-leases.sh
inspect-worktree` before every cleanup decision and `review-leases.sh
cleanup-worktree` for every removal attempt. The helper owns safety mechanics
and removes worktrees only after all checks pass. Dirty worktrees, unmanaged
`.ephemeral` artifacts, identity mismatches, invalid lease mechanics,
non-worktree paths, and missing paths remain removal refusals or skipped
outcomes.

Cleanup prints fixed keys: `OUTCOME` and `MESSAGE`. It also prints classifier
keys for inspection and cleanup decisions: `CAN_REMOVE`, `REFUSAL_REASON`,
`DIRTY`, `LEASE_STATE`, `IDENTITY_MATCH`, `REQUIRES_CONFIRMATION`,
`METADATA_OUTCOME`, and `FORCE_REMOVE_ALLOWED`. Treat `failed` or a nonzero
exit as a cleanup failure and report the lease path, worktree path, classifier
fields, and message for manual recovery. Do not run a broad `.ephemeral` sweep.

## GitHub API Reference

For the `gh api` flag conventions used here, see [docs/guidelines/gh-api-hygiene.md](../../../docs/guidelines/gh-api-hygiene.md).

**Posting boundary reference:** the only review-creation path in this skill is
Phase 6's explicitly user-approved artifact flow: after approval,
caller-derived review event, `materialize-review-payload`,
`freeze-approved-review`, stale-head refusal,
`materialize-validated-review-payload`, and then `gh api --input
"$VALIDATED_REVIEW_PAYLOAD_FILE"`. Do not manually construct a `jq` payload
here, do not fetch `commit_id` from live `gh pr view` for posting, and do not
call `gh api` until the approved artifact has validated successfully.

The sealed payload uses `line` (absolute file line in HEAD), not `position`
(diff offset). `side` is `"RIGHT"` for PR head lines.

**Reply to inline comment** (use the correct endpoint):

```sh
gh api repos/{owner}/{repo}/pulls/<N>/comments/<comment-id>/replies --jq '.id' -f body="<text>"
```

Verify the response includes the new comment ID. Do not assume success.
