# Review Lease Lifecycle Contract

This reference is the authoritative lifecycle contract for
`pr-review/lease/v1`. `skills/pr-review/scripts/review-leases.sh` owns the
public helper command surface and delegates reducer-backed lifecycle writes to
`devcanon-runtime`'s `pr-review-leases` command. `skills/pr-review/SKILL.md`
owns operator flow.

## State Authority

The lease records lifecycle state and the result-manifest validation outcome
that justifies accepting or preserving review result evidence. It does not
store approval intent, review payload JSON, inline comments, findings content,
or thread-resolution decisions.

Lease identity and result evidence are separate authority boundaries. Trusted
lease identity decides whether a command may mutate lifecycle state. Result
manifest digest checks, artifact identity checks, and helper-backed result
command authority decide whether stored result evidence may be reported or
preserved as current. Failure and cleanup observation writers must not turn
stale result evidence into valid evidence; they either preserve evidence only
after current validation or record the lifecycle/cleanup observation without
invalid recovery pointers.

Evidence validation is selected by lifecycle question. A reviewed write accepts
a validated result manifest before preview presentation exists. Gated/live
status paths require current presentation evidence. Failure preservation
validates recovery evidence by family and clears invalid families with their
dependents instead of treating recovery as one result-centric boolean.

Valid states are:

- `created`: review worktree exists; optional handoff pointer may be added after
  the Phase 3 handoff validates.
- `reviewed`: Phase 4 result manifest validates and points to review findings;
  the result manifest may still have `presentation.status=not-presented`, and
  the lease presentation fields remain null until the preview gate is rendered.
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
| LC-03 | `record-result`               | `created`             | `reviewed` | `RESULT_FILE`, `UPDATED_AT`; the helper records `validation.result_manifest.status=valid` and `validation.result_manifest.sha256` from the validated result file                        |
| LC-04 | `present-preview`             | `reviewed`            | `gated`    | Existing or supplied `RESULT_FILE`, `PRESENTED_AT`, `PRESENTATION_STATUS`, `UPDATED_AT`; the helper refreshes `validation.result_manifest.sha256` from the validated result file        |
| LC-05 | `present-preview`             | `gated`               | `gated`    | Existing or supplied `RESULT_FILE`, fresh `PRESENTED_AT`, `PRESENTATION_STATUS`, `UPDATED_AT`; the helper refreshes `validation.result_manifest.sha256` from the validated result file  |
| LC-06 | `abort`                       | `reviewed`            | `aborted`  | `FINISHED_AT`, `TERMINAL_REASON`, `UPDATED_AT`                                                                                                                                          |
| LC-07 | `abort`                       | `gated`               | `aborted`  | `FINISHED_AT`, `TERMINAL_REASON`, `UPDATED_AT`                                                                                                                                          |
| LC-08 | `record-post-success`         | `gated`               | `posted`   | `APPROVED_REVIEW_FILE`, `VALIDATED_REVIEW_PAYLOAD_FILE`, `FINISHED_AT`, `GITHUB_POSTED_AT`, `UPDATED_AT`                                                                                |
| LC-09 | `record-failure`              | `created`             | `failed`   | `FINISHED_AT`, `FAILURE_PHASE`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY`, `UPDATED_AT`                                                                                                |
| LC-10 | `record-failure`              | `reviewed`            | `failed`   | `FINISHED_AT`, `FAILURE_PHASE`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY`, `UPDATED_AT`                                                                                                |
| LC-11 | `record-failure`              | `gated`               | `failed`   | Pre-approval failure phase, `FINISHED_AT`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY`, `UPDATED_AT`                                                                                     |
| LC-12 | `record-failure`              | `gated`               | `failed`   | `FAILURE_PHASE=approval-freeze`, `FINISHED_AT`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY`, `UPDATED_AT`                                                                                |
| LC-13 | `record-failure`              | `gated`               | `failed`   | `FAILURE_PHASE=github-post`, `APPROVED_REVIEW_FILE`, `GITHUB_POST_ATTEMPTED=true`, `GITHUB_POST_RESULT=failed`, `FINISHED_AT`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY`, `UPDATED_AT` |
| LC-14 | `present-preview`             | `failed`              | `gated`    | Existing or supplied `RESULT_FILE`, `PRESENTED_AT`, `PRESENTATION_STATUS`, `UPDATED_AT`; the helper refreshes `validation.result_manifest.sha256` from the validated result file        |
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

`reviewed` and later states that preserve a result manifest must also preserve
`validation.result_manifest.status=valid`, the timestamp at which the helper
accepted that result manifest, and the digest of the accepted result file.
Leases without a result manifest keep the result validation outcome null.
That validation timestamp is policy-specific evidence:

- LC-03 records the reviewed result acceptance time and does not imply preview
  presentation.
- LC-04, LC-05, LC-14, `read-status`, and Phase 5 audit status require the
  result validation timestamp to match the current gated lease update.
- Terminal and failed recovery states may preserve older valid result evidence
  when artifact digest, identity, nested artifacts, and helper-backed authority
  still validate for the preserved family.

The result manifest digest is stored only in
`validation.result_manifest.sha256`. Do not expand the `pr-review/result/v1`
schema to carry lease freshness evidence.

Missing validation metadata, missing `validation.result_manifest`, or missing
required digest evidence makes a lease invalid. Classify it as
`invalid-lease`; do not rewrite missing evidence into a valid shape.

GitHub post metadata is phase-scoped:

- `github-post` failures must record `GITHUB_POST_ATTEMPTED=true` and
  `GITHUB_POST_RESULT=failed`.
- Non-`github-post` failures clear GitHub post metadata to
  `github_post_attempted=false`, `github_post_result=not-attempted`, and
  `github_posted_at=null`.
- `posted` writes set `github_post_attempted=true`,
  `github_post_result=succeeded`, and require `GITHUB_POSTED_AT`.

The lease stores the existing direct-child `validated_payload_file` only after
the approved-review helper materializes a validated payload. That pointer is
cleanup evidence only when the helper validates the complete approved-review
artifact, its canonical paths and digests, and the pointer is derived from the
PR number and review head.

## Read-Only Status

`review-leases.sh read-status` delegates to `devcanon-runtime runtime
pr-review-leases read-status`. It is read-only, must inspect git status with
optional locks disabled, and must not record cleanup metadata.

Stdout is one JSON object with exactly these keys:

- `lease_state`
- `worktree_path`
- `worktree_digest`
- `worktree_exists`
- `worktree_registered`
- `worktree_dirty`
- `identity_match`
- `result_file`
- `result_sha256`
- `result_validated_at`
- `lease_updated_at`
- `presentation_status`
- `presented_at`

Boolean fields are JSON booleans. Consumers must treat missing digest, stale
digest, stale validation timestamp, mismatched presentation status, missing
`presented_at`, identity mismatch, missing worktree, unregistered worktree, or
unreadable worktree as fail-closed audit failures. Failure to inspect git
status is also fail-closed read-status behavior. Successful status output also
requires the stored result evidence to pass lease-aware result command
authority, including nested result artifacts and lease base/head evidence. A
dirty-but-valid worktree is truthful status and does not by itself block the
Phase 5 gate.

`review-leases.sh record-audit-failure` is the recovery boundary for Phase 5
audit summary failures after a successful `gated` write. It must run from the
primary repository root, read the existing gated lease identity from
`LEASE_FILE`, and must not require `WORKTREE_PATH`. It records a
`preview-render` failure with `EXPECTED_STATE=gated`, including when the
worktree is missing. Existing recovery artifact pointers are preserved only
when the prior gated validation is current and the referenced artifacts still
pass worktree identity, digest validation, and result command authority;
missing worktrees, stale validation timestamps, missing digests, missing
presentation evidence, or invalid artifacts clear the recovery pointers before
the failed lease is written.

## Artifact Requirements

Referenced artifacts stay owned by their existing helpers. The lease reducer
validates direct-child paths, artifact identity, result digest freshness, and
result command authority before accepting or preserving pointers as current.
The policy selects which families are required:

- Handoff manifest: repository, PR number, refs, review head, and execution
  worktree path must match the lease identity. Handoff evidence can be
  preserved by itself for failures that occur after Phase 3 and before a result
  manifest exists.
- Result manifest: repository, PR number, review head, deterministic handoff
  chain, handoff pointer, `validation.result_manifest.sha256` digest, nested
  artifacts, and helper-backed result command authority must match. Reviewed
  result evidence may carry `presentation.status=not-presented`; gated/live/post
  policies require a presented status.
- Gated result: presentation status and timestamp must be current for the
  presented preview.
- Approved-review: the authoritative helper validates the complete
  `pr-review/approved-review/v1` artifact, review head, canonical body path,
  source paths, digests, and payload before its body and payload become owned.
- Validated payload copy: direct-child path must match the approved-review
  payload.

Recovery dependency order is strict: invalid result evidence clears result
validation, presentation, approved-review, and validated payload pointers;
invalid approval evidence clears the validated payload pointer; cleanup
metadata never adds or refreshes artifact authority.

## Terminal Archive Behavior

LC-18 is the only transition that replaces a terminal active lease with a fresh
`created` lease. The helper first validates the existing terminal lease for
archive, then moves it to:

```text
.ephemeral/pr-${PR_NUMBER}-${WORKTREE_DIGEST}-${YYYYMMDDTHHMMSS}-${STATE}-archived-lease.json
```

For a `posted` or `aborted` lease whose cleanup helper has recorded a closed
`cleanup` observation with a valid non-null `removed_at` timestamp, LC-18 may
archive after recreating the canonical worktree path without revalidating
historical artifacts in that new checkout. The helper writes `removed_at` only
after `git worktree remove` succeeds; a legacy `last_outcome: "removed"`
observation without that marker remains subject to strict historical-artifact
validation. That observation is narrowly scoped archive authority; it does not
refresh or create artifact authority. In every other case, LC-18 keeps strict
historical artifact validation before archive. A fresh `created` lease carries
none of the terminal lease's artifact, validation, presentation, terminal,
failure, GitHub, or cleanup metadata.

The optional `cleanup` object is closed: it has exactly `last_outcome`,
`last_checked_at`, and `removed_at`; outcomes are `removed`, `retained`,
`skipped`, `failed`, or `null`; and non-null timestamps are RFC 3339 UTC at
second precision with valid calendar dates. `removed_at` persists across later
cleanup retries, but is set only by a successfully completed removal. Invalid
cleanup metadata fails lease validation before archive or fresh creation.
The exact historical two-key shape without `removed_at` is accepted only for
backward-compatible strict validation; it can never grant archive authority.

Cleanup and archive are independently retryable. An interruption before a
successful helper-recorded removal leaves ordinary validation in force. An
interruption after recorded removal may use the narrow archive authority on a
later LC-18 attempt. Archive and fresh-creation retries must preserve historical
evidence or a valid active lease, and invalid authority must leave the active
lease unchanged without creating an archive. These are observable guarantees;
they do not prescribe a private removal/archive write order.

If removal succeeds but the helper cannot write the `removed` observation, the
helper reports that metadata failure without recording a false `failed` cleanup
outcome. The worktree is already gone, but no archive authority exists until the
cleanup metadata can be safely repaired; automatic re-entry must remain blocked
rather than treating the successful removal as a failed removal.

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

Cleanup metadata is an observation on a trusted cleanup decision, not proof
that historical result evidence remains current. When the lease identity
matches but the physical worktree is missing or the path is no longer
registered, `inspect-worktree` and `cleanup-worktree` may record skipped or
retained cleanup metadata without reading artifacts from that unavailable or
untrusted worktree. Present registered worktrees still require artifact
validation before removal can proceed.
