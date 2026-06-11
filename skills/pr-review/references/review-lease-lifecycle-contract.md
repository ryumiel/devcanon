# Review Lease Lifecycle Contract

This reference is the authoritative lifecycle contract for
`pr-review/lease/v1`. `skills/pr-review/scripts/review-leases.sh` owns the
public helper command surface and delegates reducer-backed lifecycle writes to
`devcanon-runtime`'s `pr-review-leases` command. `skills/pr-review/SKILL.md`
owns operator flow.

## State Authority

The lease records lifecycle state only. It does not store approval intent,
review payload JSON, inline comments, findings content, or thread-resolution
decisions.

Valid states are:

- `created`: review worktree exists; optional handoff pointer may be added after
  the Phase 3 handoff validates.
- `reviewed`: Phase 4 result manifest validates and points to review findings.
- `gated`: Phase 5 rendered preview is current and waiting for user action.
- `posted`: GitHub review post succeeded for the frozen approved-review
  artifact.
- `aborted`: user explicitly abandoned the review lifecycle.
- `failed`: recoverable or unrecoverable failure occurred before a successful
  terminal state; failure audit metadata is recorded and valid recovery
  artifact pointers are preserved.

## Transition Matrix

Every valid transition is listed here. Missing rows fail closed. Same-state
updates are valid only when the matching row says so.

| Row   | Event                         | From                  | To         | Required inputs                                                                                                                                                                         |
| ----- | ----------------------------- | --------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LC-01 | `create`                      | `none`                | `created`  | `CREATED_AT`, `UPDATED_AT`                                                                                                                                                              |
| LC-02 | `attach-handoff`              | `created`             | `created`  | `HANDOFF_FILE`, `UPDATED_AT`                                                                                                                                                            |
| LC-03 | `record-result`               | `created`             | `reviewed` | `RESULT_FILE`, `UPDATED_AT`                                                                                                                                                             |
| LC-04 | `present-preview`             | `reviewed`            | `gated`    | Existing or supplied `RESULT_FILE`, `PRESENTED_AT`, `PRESENTATION_STATUS`, `UPDATED_AT`                                                                                                 |
| LC-05 | `present-preview`             | `gated`               | `gated`    | Existing or supplied `RESULT_FILE`, fresh `PRESENTED_AT`, `PRESENTATION_STATUS`, `UPDATED_AT`                                                                                           |
| LC-06 | `abort`                       | `reviewed`            | `aborted`  | `FINISHED_AT`, `TERMINAL_REASON`, `UPDATED_AT`                                                                                                                                          |
| LC-07 | `abort`                       | `gated`               | `aborted`  | `FINISHED_AT`, `TERMINAL_REASON`, `UPDATED_AT`                                                                                                                                          |
| LC-08 | `record-post-success`         | `gated`               | `posted`   | `APPROVED_REVIEW_FILE`, `FINISHED_AT`, `GITHUB_POSTED_AT`, `UPDATED_AT`                                                                                                                 |
| LC-09 | `record-failure`              | `created`             | `failed`   | `FINISHED_AT`, `FAILURE_PHASE`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY`, `UPDATED_AT`                                                                                                |
| LC-10 | `record-failure`              | `reviewed`            | `failed`   | `FINISHED_AT`, `FAILURE_PHASE`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY`, `UPDATED_AT`                                                                                                |
| LC-11 | `record-failure`              | `gated`               | `failed`   | Pre-approval failure phase, `FINISHED_AT`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY`, `UPDATED_AT`                                                                                     |
| LC-12 | `record-failure`              | `gated`               | `failed`   | `FAILURE_PHASE=approval-freeze`, `FINISHED_AT`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY`, `UPDATED_AT`                                                                                |
| LC-13 | `record-failure`              | `gated`               | `failed`   | `FAILURE_PHASE=github-post`, `APPROVED_REVIEW_FILE`, `GITHUB_POST_ATTEMPTED=true`, `GITHUB_POST_RESULT=failed`, `FINISHED_AT`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY`, `UPDATED_AT` |
| LC-14 | `present-preview`             | `failed`              | `gated`    | Existing or supplied `RESULT_FILE`, `PRESENTED_AT`, `PRESENTATION_STATUS`, `UPDATED_AT`                                                                                                 |
| LC-15 | `abort`                       | `failed`              | `aborted`  | `FINISHED_AT`, `TERMINAL_REASON`, `UPDATED_AT`                                                                                                                                          |
| LC-16 | `record-failure`              | `failed`              | `failed`   | `FINISHED_AT`, `FAILURE_PHASE`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY`, `UPDATED_AT`                                                                                                |
| LC-17 | `retry-post-success`          | `failed`              | `posted`   | Prior failure is `github-post`, `FINISHED_AT`, `GITHUB_POSTED_AT`, `UPDATED_AT`                                                                                                         |
| LC-18 | `archive-terminal-and-create` | `posted` or `aborted` | `created`  | `CREATED_AT`, `UPDATED_AT`                                                                                                                                                              |

All other transitions are forbidden. `stale-head` is a valid failure phase for
post-freeze refusal, but it is not eligible for LC-17 retry-to-post; it must
return through review discovery or a fresh approval path before posting.

## Field Contract

`UPDATED_AT` is required on every write. `created_at`, `base_ref`, `head_ref`,
`worktree_path`, `worktree_digest`, and `lease_file` are immutable after lease
creation.

Terminal writes require `FINISHED_AT`. `aborted` writes also require
`TERMINAL_REASON`. `failed` writes require `FAILURE_PHASE`, `FAILURE_REASON`,
and `FAILURE_RECOVERABILITY`.

GitHub post metadata is phase-scoped:

- `github-post` failures must record `GITHUB_POST_ATTEMPTED=true` and
  `GITHUB_POST_RESULT=failed`.
- Non-`github-post` failures clear GitHub post metadata to
  `github_post_attempted=false`, `github_post_result=not-attempted`, and
  `github_posted_at=null`.
- `posted` writes set `github_post_attempted=true`,
  `github_post_result=succeeded`, and require `GITHUB_POSTED_AT`.

The lease stores a direct-child validated payload pointer only after
approved-review validation produced a payload copy. That pointer is cleanup
evidence only when it is derived from the PR number and review head and matches
the frozen approved-review payload.

## Artifact Requirements

Referenced artifacts stay owned by their existing helpers. The lease reducer
validates direct-child paths and artifact identity before accepting pointers:

- Handoff manifest: repository, PR number, refs, review head, and execution
  worktree path must match the lease identity.
- Result manifest: repository, PR number, review head, deterministic handoff
  chain, and handoff pointer must match.
- Gated result: presentation status must be current for the presented preview.
- Approved-review: review head and payload commit must bind to the gated result.
- Validated payload copy: direct-child path must match the approved-review
  payload.

## Terminal Archive Behavior

LC-18 is the only transition that replaces a terminal active lease with a fresh
`created` lease. The helper first validates the existing terminal lease for
archive, then moves it to:

```text
.ephemeral/pr-${PR_NUMBER}-${WORKTREE_DIGEST}-${YYYYMMDDTHHMMSS}-${STATE}-archived-lease.json
```

## Cleanup Classifier

`inspect-worktree` and `cleanup-worktree` share one classifier. The classifier
does not mutate the filesystem; it returns a decision record. Dirty worktrees,
unmanaged `.ephemeral` artifacts, identity mismatches, and invalid lease
mechanics remain cleanup refusals. Primary worktrees are never removable
through this helper. Missing physical worktrees and non-worktree paths are
skipped, not removable.

Classifier fields:

- `can_remove`
- `refusal_reason`
- `requires_confirmation`
- `metadata_outcome`
- `force_remove_allowed`

Cleanup may preserve only lease-referenced artifacts and schema-declared
artifact fields from those artifacts. Arbitrary strings in JSON content,
findings bodies, review text, payload bodies, or other user-authored content do
not prove cleanup ownership for `.ephemeral` files.
