# Review Lease Lifecycle Contract

This reference is the authoritative lifecycle contract for
`pr-review/lease/v1`. `skills/pr-review/SKILL.md` owns operator flow;
`skills/pr-review/scripts/review-leases.sh` owns enforcement.

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
  terminal state; record failure audit metadata and preserve artifact pointers
  that are valid for recovery.

## Transition Table

| Row   | Transition            | Contract                                                                                                        |
| ----- | --------------------- | --------------------------------------------------------------------------------------------------------------- |
| LC-01 | `none -> created`     | Create the active lease after resolving the review worktree.                                                    |
| LC-02 | `created -> created`  | Add the validated handoff pointer once; repeated no-op refreshes are forbidden.                                 |
| LC-03 | `created -> reviewed` | Record the validated result pointer.                                                                            |
| LC-04 | `reviewed -> gated`   | Record a fresh preview presentation.                                                                            |
| LC-05 | `gated -> gated`      | Record a materially fresh presentation after result or preview changes.                                         |
| LC-06 | `reviewed -> aborted` | Record terminal user abort after result validation; preserve and validate the result pointer.                   |
| LC-07 | `gated -> aborted`    | Record terminal user abort after preview; preserve and validate the result pointer.                             |
| LC-08 | `gated -> posted`     | Record successful GitHub post for the frozen approved-review artifact.                                          |
| LC-09 | `created -> failed`   | Record failure before result validation.                                                                        |
| LC-10 | `reviewed -> failed`  | Record failure after result validation.                                                                         |
| LC-11 | `gated -> failed`     | Record pre-approval failure after preview.                                                                      |
| LC-12 | `gated -> failed`     | Record approval-freeze failure; an approved-review pointer may be preserved without approved-review validation. |
| LC-13 | `gated -> failed`     | Record GitHub post failure with `GITHUB_POST_ATTEMPTED=true` and `GITHUB_POST_RESULT=failed`.                   |
| LC-14 | `failed -> gated`     | Recover by validating artifacts and presenting a fresh preview.                                                 |
| LC-15 | `failed -> aborted`   | Terminally abandon a failed lease; a result pointer is optional for pre-result failures.                        |
| LC-16 | `failed -> failed`    | Update materially new failure audit metadata.                                                                   |
| LC-17 | `failed -> posted`    | Complete retry-to-post only from a prior LC-13 GitHub-post failure.                                             |
| LC-18 | `terminal -> created` | Archive a valid active `posted` or `aborted` lease, then create a fresh active lease for the same PR/worktree.  |

All other transitions are forbidden.

## Field Contract

`UPDATED_AT` is required on every write. `created_at`, `base_ref`, and
`head_ref` are immutable after lease creation.

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

## Artifact Identity

Referenced artifact identity is lease-owned after the existing artifact helpers
validate shape:

- Handoff repository, PR number, base ref, head ref,
  `execution.working_directory`, and review head must match the lease.
- Result repository, PR number, review head, deterministic handoff chain, and
  declared digests must match.
- Approved-review path identity must mirror
  `approved-review-artifacts.sh`: slash becomes `-`, unsupported characters are
  removed, empty/unsafe slugs become `unnamed`, and detached HEAD uses
  `detached`.
- Approved-review review head, findings file, review body file, scope decision
  file, and their digests must match the gated result chain, except LC-12
  approval-freeze failure writes may preserve an unvalidated approved-review
  pointer.
- Approved-review payload validation remains owned by
  `approved-review-artifacts.sh`.

## Cleanup Ownership

Cleanup may preserve only lease-referenced artifacts and schema-declared
artifact fields from those artifacts. Arbitrary strings in JSON content,
findings bodies, review text, payload bodies, or other user-authored content do
not prove cleanup ownership for `.ephemeral` files.

Dirty worktrees, unmanaged `.ephemeral` artifacts, identity mismatches, and
invalid lease mechanics remain absolute cleanup refusals.

After cleanup accepts that remaining `.ephemeral` entries are lease-managed and
all refusal checks are clear, the helper may use forced worktree removal so
accepted managed residue does not block terminal cleanup.
