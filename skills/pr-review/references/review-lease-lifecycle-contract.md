# Review Lease Lifecycle Contract

This reference is the authoritative lifecycle contract for
`pr-review/lease/v1`. `skills/pr-review/scripts/review-leases.sh` owns
enforcement. `skills/pr-review/SKILL.md` owns operator flow.

The installed runtime remains Bash/JQ. The reducer contract below documents the
shell helper that ships with the skill; it does not introduce TypeScript
skill-script authoring or a Node.js runtime requirement. ADR-0019 remains
unchanged for this PR.

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

Public helper callers use `STATE` plus event-specific inputs. The helper derives
an internal reducer row from the prior lease state, target state, failure phase,
and supplied artifact inputs. Internal event names such as `record-result` or
`retry-post-success` are not operator commands.

## Transition Matrix

Every valid transition is listed here. Missing rows fail closed. Same-state
updates are valid only when the matching row says so.

| Row   | Event                         | From                  | To         | Required inputs                                                                                                                                                                         | Row-owned field behavior                                                                                                                                          |
| ----- | ----------------------------- | --------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LC-01 | `create`                      | `none`                | `created`  | `CREATED_AT`, `UPDATED_AT`                                                                                                                                                              | Set identity and timestamps; clear all artifact, presentation, terminal, failure, and GitHub post metadata.                                                       |
| LC-02 | `attach-handoff`              | `created`             | `created`  | `HANDOFF_FILE`, `UPDATED_AT`                                                                                                                                                            | Preserve identity and `created_at`; set handoff once; keep result and approved-review null; keep presentation, terminal, failure, and GitHub metadata clear.      |
| LC-03 | `record-result`               | `created`             | `reviewed` | `RESULT_FILE`, `UPDATED_AT`                                                                                                                                                             | Preserve identity and `created_at`; bind result to handoff; set result and canonical handoff; clear approved-review, presentation, terminal, failure, and GitHub. |
| LC-04 | `present-preview`             | `reviewed`            | `gated`    | `RESULT_FILE`, `PRESENTED_AT`, `PRESENTATION_STATUS`, `UPDATED_AT`                                                                                                                      | Bind result with `preview-current` result-manifest status; set fresh presentation; clear approved-review, terminal, failure, and GitHub metadata.                 |
| LC-05 | `present-preview`             | `gated`               | `gated`    | `RESULT_FILE`, `PRESENTED_AT`, `PRESENTATION_STATUS`, `UPDATED_AT`                                                                                                                      | Require materially fresh presentation data; bind current result; replace presentation; clear approved-review, terminal, failure, and GitHub metadata.             |
| LC-06 | `abort`                       | `reviewed`            | `aborted`  | `FINISHED_AT`, `TERMINAL_REASON`, `UPDATED_AT`                                                                                                                                          | Preserve bound result and handoff; set terminal fields; clear approved-review, failure, and GitHub metadata.                                                      |
| LC-07 | `abort`                       | `gated`               | `aborted`  | `FINISHED_AT`, `TERMINAL_REASON`, `UPDATED_AT`                                                                                                                                          | Preserve bound result, handoff, and presentation audit; set terminal fields; clear approved-review, failure, and GitHub metadata.                                 |
| LC-08 | `record-post-success`         | `gated`               | `posted`   | `APPROVED_REVIEW_FILE`, `FINISHED_AT`, `GITHUB_POSTED_AT`, `UPDATED_AT`                                                                                                                 | Preserve gated result and presentation; bind approved-review to the gated result; set terminal and successful GitHub metadata; clear failure.                     |
| LC-09 | `record-failure`              | `created`             | `failed`   | `FINISHED_AT`, `FAILURE_PHASE`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY`, `UPDATED_AT`                                                                                                | Preserve handoff if present; set failure and terminal timestamp; clear presentation, approved-review, and GitHub metadata.                                        |
| LC-10 | `record-failure`              | `reviewed`            | `failed`   | `FINISHED_AT`, `FAILURE_PHASE`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY`, `UPDATED_AT`                                                                                                | Preserve bound result and handoff; set failure and terminal timestamp; clear presentation, approved-review, and GitHub metadata.                                  |
| LC-11 | `record-failure`              | `gated`               | `failed`   | `FINISHED_AT`, `FAILURE_PHASE`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY`, `UPDATED_AT`                                                                                                | For pre-approval failure phases, preserve bound result and presentation; clear approved-review and GitHub metadata.                                               |
| LC-12 | `record-failure`              | `gated`               | `failed`   | `FAILURE_PHASE=approval-freeze`, `FINISHED_AT`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY`, `UPDATED_AT`                                                                                | Preserve bound result, presentation, and optional approved-review pointer; approved-review payload validation may be skipped, but path identity still validates.  |
| LC-13 | `record-failure`              | `gated`               | `failed`   | `FAILURE_PHASE=github-post`, `APPROVED_REVIEW_FILE`, `GITHUB_POST_ATTEMPTED=true`, `GITHUB_POST_RESULT=failed`, `FINISHED_AT`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY`, `UPDATED_AT` | Preserve bound result, presentation, and frozen approved-review pointer; set failed GitHub metadata; clear posted timestamp.                                      |
| LC-14 | `present-preview`             | `failed`              | `gated`    | `RESULT_FILE`, `PRESENTED_AT`, `PRESENTATION_STATUS`, `UPDATED_AT`                                                                                                                      | Recover through a fresh preview; bind result with `preview-current`; replace presentation; clear approved-review, terminal, failure, and GitHub metadata.         |
| LC-15 | `abort`                       | `failed`              | `aborted`  | `FINISHED_AT`, `TERMINAL_REASON`, `UPDATED_AT`                                                                                                                                          | Preserve result and handoff only when present; set terminal fields; clear approved-review, failure, and GitHub metadata.                                          |
| LC-16 | `record-failure`              | `failed`              | `failed`   | `FINISHED_AT`, `FAILURE_PHASE`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY`, `UPDATED_AT`                                                                                                | Require materially new failure audit data; preserve recovery artifacts allowed by the new phase; clear phase-inapplicable GitHub metadata.                        |
| LC-17 | `retry-post-success`          | `failed`              | `posted`   | Prior failure is LC-13, `FINISHED_AT`, `GITHUB_POSTED_AT`, `UPDATED_AT`                                                                                                                 | Reuse existing bound result and existing approved-review pointer; reject replacement result or approved-review inputs; set successful GitHub metadata.            |
| LC-18 | `archive-terminal-and-create` | `posted` or `aborted` | `created`  | `CREATED_AT`, `UPDATED_AT`                                                                                                                                                              | Archive the terminal lease, then create a fresh active lease for the same PR/worktree identity. The new active lease follows LC-01 field behavior.                |

All other transitions are forbidden. `stale-head` is a valid failure phase for
post-freeze refusal, but it is not eligible for LC-17 retry-to-post; it must
return through review discovery or a fresh approval path before posting.

## Terminal Archive Behavior

LC-18 is the only transition that replaces a terminal active lease with a fresh
`created` lease. The helper first validates the existing terminal lease for
archive, then moves it to:

```text
.ephemeral/pr-${PR_NUMBER}-${WORKTREE_DIGEST}-${YYYYMMDDTHHMMSS}-${STATE}-archived-lease.json
```

If the first archive path already exists, the helper adds a numeric suffix
before `-archived-lease.json`. Archive preparation and validation must succeed
before the active lease is moved. If archive preparation fails, the terminal
lease remains active and no fresh `created` lease is written. If the active
write fails after the move, the archive remains as immutable audit evidence.

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

Referenced artifact identity is lease-owned after the existing artifact helpers
validate shape:

| Artifact               | Existing validator authority                            | Lease-owned binding checks                                                                                       | Accepted optional cases                                                                  | Rejected cases                                                                                       |
| ---------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Handoff manifest       | `review-manifests.sh validate-handoff`                  | Repository, PR number, base ref, head ref, review head, and execution worktree path match the lease identity.    | Optional only for early `created` before LC-02.                                          | Repository/ref/worktree/head mismatch, nested path, symlink, unreadable file.                        |
| Result manifest        | `review-manifests.sh validate-result`                   | Repository, PR number, review head, deterministic handoff chain, declared digests, and handoff pointer match.    | Optional for pre-result failures and LC-15 from such states.                             | Result whose handoff differs from the lease handoff, stale copied result, missing required artifact. |
| Gated result           | Result validator plus lease presentation guard          | Result manifest presentation status is `preview-current`; lease receives fresh `PRESENTED_AT` and status.        | None for `gated` rows; a result is required.                                             | `not-presented` result, stale presentation reuse, changed result without fresh gate.                 |
| Approved-review        | `approved-review-artifacts.sh validate-approved-review` | Review head, findings file, review body, payload, scope decision, and digests match the gated result chain.      | LC-12 may preserve an unvalidated approved-review pointer after approval-freeze failure. | Replacement approved payload on LC-17, approved artifact for a different result or head.             |
| Validated payload copy | Approved-review validation command output               | Direct-child path derived from PR number and review head; included in cleanup managed-artifact set when present. | Present after successful validation before GitHub API call.                              | Treating arbitrary payload-like JSON or user-authored JSON strings as managed cleanup evidence.      |

Approved-review path identity must mirror `approved-review-artifacts.sh`: slash
becomes `-`, unsupported characters are removed, empty or unsafe slugs become
`unnamed`, and detached HEAD uses `detached`.

## Cleanup Classifier

`inspect-worktree` and `cleanup-worktree` share one classifier. The classifier
does not mutate the filesystem; it returns a decision record. The command
adapters record cleanup metadata and perform `git worktree remove` only after
classification.

The classifier fields and value domains are:

| Field                   | Values                                                                                                                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `can_remove`            | `yes`, `no`                                                                                                                                                                                                            |
| `refusal_reason`        | empty, `dirty`, `invalid-lease`, `untracked-artifacts`, `identity-mismatch`, `confirmation-required`, `confirmation-token-mismatch`, `expected-state-mismatch`, `primary-worktree`, `non-worktree`, `missing-worktree` |
| `requires_confirmation` | `yes`, `no`                                                                                                                                                                                                            |
| `metadata_outcome`      | empty, `removed`, `retained`, `skipped`, `failed`                                                                                                                                                                      |
| `force_remove_allowed`  | `yes`, `no`                                                                                                                                                                                                            |

Dirty worktrees, unmanaged `.ephemeral` artifacts, identity mismatches, and
invalid lease mechanics remain cleanup refusals. Primary worktrees are never
removable through this helper. Missing physical worktrees and non-worktree
paths are skipped, not removable.

Missing leases may be removable only when the worktree is registered,
non-dirty, not the primary worktree, has no unmanaged `.ephemeral` residue, and
the caller supplies the exact confirmation token required by the missing-lease
policy.

Cleanup may preserve only lease-referenced artifacts and schema-declared
artifact fields from those artifacts. Arbitrary strings in JSON content,
findings bodies, review text, payload bodies, or other user-authored content do
not prove cleanup ownership for `.ephemeral` files.

Forced removal is allowed only after the classifier accepts removal and
remaining `.ephemeral` residue is lease-managed. `cleanup-worktree` executes the
classifier decision; it must not duplicate classification logic.

## Adjacent Governance

ADR-0012 remains unchanged because this lifecycle contract does not change
`play-review` findings or nits side-channel delivery, retention, or manual
sweep semantics.

ADR-0019 remains unchanged because the installed skill-script runtime remains
Bash/JQ. TypeScript skill-script authoring is deferred and no TypeScript
runtime is shipped by this PR.
