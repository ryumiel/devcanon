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
- `resolving`: a proven review post has an execution receipt and one or more
  sealed `resolve` actions remain pending or failed. It is nonterminal and has
  no abort, cleanup, archive, or reentry authority.
- `posted`: GitHub review post succeeded for the frozen approved-review
  artifact.
- `aborted`: user explicitly abandoned the review lifecycle.
- `failed`: recoverable or unrecoverable failure occurred before a successful
  terminal state, or a post-success sealed thread became missing or outdated;
  failure audit metadata is recorded and valid recovery artifact pointers are
  preserved.

## Transition Matrix

Every valid transition is listed here. Missing rows fail closed. Same-state
updates are valid only when the matching row says so.

| Row   | Event                              | From                  | To          | Required inputs                                                                                                                                                                                                             |
| ----- | ---------------------------------- | --------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LC-01 | `create`                           | `none`                | `created`   | `CREATED_AT`, `UPDATED_AT`                                                                                                                                                                                                  |
| LC-02 | `attach-handoff`                   | `created`             | `created`   | `HANDOFF_FILE`, `UPDATED_AT`                                                                                                                                                                                                |
| LC-03 | `record-result`                    | `created`             | `reviewed`  | `RESULT_FILE`, `UPDATED_AT`; the helper records `validation.result_manifest.status=valid` and `validation.result_manifest.sha256` from the validated result file                                                            |
| LC-04 | `present-preview`                  | `reviewed`            | `gated`     | Existing or supplied `RESULT_FILE`, `PRESENTED_AT`, `PRESENTATION_STATUS`, `UPDATED_AT`; the helper refreshes `validation.result_manifest.sha256` from the validated result file                                            |
| LC-05 | `present-preview`                  | `gated`               | `gated`     | Existing or supplied `RESULT_FILE`, fresh `PRESENTED_AT`, `PRESENTATION_STATUS`, `UPDATED_AT`; the helper refreshes `validation.result_manifest.sha256` from the validated result file                                      |
| LC-06 | `abort`                            | `reviewed`            | `aborted`   | `FINISHED_AT`, `TERMINAL_REASON`, `UPDATED_AT`                                                                                                                                                                              |
| LC-07 | `abort`                            | `gated`               | `aborted`   | `FINISHED_AT`, `TERMINAL_REASON`, `UPDATED_AT`                                                                                                                                                                              |
| LC-08 | legacy `record-post-success`       | `gated`               | `posted`    | Historical read compatibility only; new writes use LC-19 through LC-23 and require an execution receipt                                                                                                                     |
| LC-09 | `record-failure`                   | `created`             | `failed`    | `FINISHED_AT`, `FAILURE_PHASE`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY`, `UPDATED_AT`                                                                                                                                    |
| LC-10 | `record-failure`                   | `reviewed`            | `failed`    | `FINISHED_AT`, `FAILURE_PHASE`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY`, `UPDATED_AT`                                                                                                                                    |
| LC-11 | `record-failure`                   | `gated`               | `failed`    | Pre-approval failure phase, `FINISHED_AT`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY`, `UPDATED_AT`                                                                                                                         |
| LC-12 | `record-failure`                   | `gated`               | `failed`    | `FAILURE_PHASE=approval-freeze`, `FINISHED_AT`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY`, `UPDATED_AT`                                                                                                                    |
| LC-13 | `record-failure`                   | `gated`               | `failed`    | `FAILURE_PHASE=github-post`, `APPROVED_REVIEW_FILE`, `GITHUB_POST_ATTEMPTED=true`, `GITHUB_POST_RESULT=failed`, `FINISHED_AT`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY`, `UPDATED_AT`                                     |
| LC-14 | `present-preview`                  | `failed`              | `gated`     | Existing or supplied `RESULT_FILE`, `PRESENTED_AT`, `PRESENTATION_STATUS`, `UPDATED_AT`; unavailable to an action-bearing `github-post` failure retaining a post intent                                                     |
| LC-15 | `abort`                            | `failed`              | `aborted`   | `FINISHED_AT`, `TERMINAL_REASON`, `UPDATED_AT`; unavailable to an action-bearing `github-post` failure retaining a post intent                                                                                              |
| LC-16 | `record-failure`                   | `failed`              | `failed`    | `FINISHED_AT`, `FAILURE_PHASE`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY`, `UPDATED_AT`; an action-bearing `github-post` failure may retain only identical failure evidence                                                |
| LC-17 | `retry-post-success`               | `failed`              | `posted`    | Prior failure is `github-post`, `FINISHED_AT`, `GITHUB_POSTED_AT`, `UPDATED_AT`                                                                                                                                             |
| LC-18 | `archive-terminal-and-create`      | `posted` or `aborted` | `created`   | `CREATED_AT`, `UPDATED_AT`                                                                                                                                                                                                  |
| LC-19 | `record-post-intent`               | `gated`               | `gated`     | `APPROVED_REVIEW_FILE`, `VALIDATED_REVIEW_PAYLOAD_FILE`, `POST_INTENT_FILE`, current validated result digest, `UPDATED_AT`; refreshes result validation to `UPDATED_AT`                                                     |
| LC-20 | `record-execution-receipt`         | `gated`               | `resolving` | Stored intent and valid receipt with one pending or failed sealed resolve, `GITHUB_POSTED_AT`, `PROVIDER_REVIEW_ID`, `UPDATED_AT`                                                                                           |
| LC-21 | `record-complete-receipt`          | `gated`               | `posted`    | Stored intent and valid terminal receipt, `GITHUB_POSTED_AT`, `PROVIDER_REVIEW_ID`, `FINISHED_AT`, `UPDATED_AT`                                                                                                             |
| LC-22 | `record-receipt-progress`          | `resolving`           | `resolving` | Same stored intent, valid replacement receipt with a pending or failed sealed resolve, `GITHUB_POSTED_AT`, `PROVIDER_REVIEW_ID`, `UPDATED_AT`                                                                               |
| LC-23 | `complete-receipt-progress`        | `resolving`           | `posted`    | Same stored intent, valid terminal replacement receipt, `GITHUB_POSTED_AT`, `PROVIDER_REVIEW_ID`, `FINISHED_AT`, `UPDATED_AT`                                                                                               |
| LC-24 | `recover-execution-receipt`        | `failed`              | `resolving` | Prior `github-post` failure preserves a stored intent and no receipt; valid receipt with a pending or failed sealed resolve, `GITHUB_POSTED_AT`, `PROVIDER_REVIEW_ID`, `UPDATED_AT`                                         |
| LC-25 | `recover-complete-receipt`         | `failed`              | `posted`    | Prior `github-post` failure preserves a stored intent and no receipt; valid terminal receipt, `GITHUB_POSTED_AT`, `PROVIDER_REVIEW_ID`, `FINISHED_AT`, `UPDATED_AT`                                                         |
| LC-26 | `record-thread-resolution-failure` | `resolving`           | `failed`    | `FAILURE_PHASE=thread-resolution`, exact stored intent and receipt, preserved post identity, `FAILURE_RECOVERABILITY=unrecoverable`, `FINISHED_AT`, `UPDATED_AT`; only for a sealed thread proven missing or newly outdated |

All other transitions are forbidden. `stale-head` is a valid failure phase for
post-freeze refusal, but it is not eligible for LC-17 retry-to-post; it must
return through review discovery or a fresh approval path before posting.

## Post intent and execution receipt

The post intent is the exact direct child
`.ephemeral/pr-<PR_NUMBER>-<REVIEW_HEAD_SHA>-thread-action-post-intent.json`.
It is persisted while `gated`, before any provider POST, and binds the approved
review and validated payload digests, event, actor, canonical marked final body,
thread-action digest, and a recomputed request fingerprint. The fingerprint is
the SHA-256 of the compact UTF-8 JSON tuple `[schema, repository, pr_number,
reviewed_head_sha, provider_actor_id, review_event, body_without_marker,
thread_actions_sha256, comments]`; comments retain final payload order as
`[path, line, start_line_or_null, start_side_or_null, side, comment_body]`.
The execution receipt is the
same-name execution direct child ending in `-thread-action-execution.json`.
It binds that exact intent and provider review identity/submission time, and has
exactly one ordered disposition for every sealed action: `resolve` is
`pending`, `succeeded`, `already-resolved`, or `failed`; `leave` is only
`not-requested`.

Lease writes validate both closed artifacts, their current digests and frozen
approved action membership. A receipt may enter `resolving` only with a pending
or failed resolve; it may enter `posted` only when every resolve is succeeded
or already-resolved and every leave is not-requested. A failed replacement is
recoverable only when a reread is exactly the prior valid receipt or exactly
the intended replacement; any other bytes fail closed. A certain or
indeterminate post failure retains a valid intent without a receipt and grants
no resolution, repost, cleanup, archive, or reentry authority.

An action-bearing `github-post` failure with its stored intent and no receipt
may proceed only through LC-24 or LC-25 after provider reconciliation and
receipt materialization. Those rows preserve the frozen approved review,
validated payload, post intent, and existing presentation without re-entering
`gated`. It must reject LC-14 presentation, LC-15 abort, and any LC-16 rewrite
other than identical `github-post` failure evidence; it cannot reach LC-18
through an abort. While `resolving`, each receipt replacement must retain the exact receipt path,
provider review ID, and post time already recorded by the lease. The controller
accepts only an exact reread of the intended replacement as committed, or an
exact reread of the prior valid receipt as a recoverable stop; it does not
replace provider identity. An action-bearing `github-post` failure preserves a
valid intent and likewise cannot use legacy failed-to-posted recovery without a
validated receipt.

LC-26 records the closed failed action disposition before replacing the lease.
That terminal failure preserves the successful provider-review identity and the
lease-owned approved review, validated payload, post intent, and execution
receipt. It has no lifecycle retry, abort, archive, reentry, stale-reclamation,
or provider-mutation path. Discovery treats it as terminal, and cleanup remains
manual through the existing explicit confirmation or policy-override boundary.

## Session creation boundary

`session-create` is private transaction state around a fresh LC-01 write, not
an LC-01 field, transition, or cleanup authority. The runtime alone may create
its direct-child reservation, canonical detached worktree, and initial
no-clobber lease. Its `manual-cleanup` outcome preserves invocation evidence
only; it grants no lifecycle cleanup, stale-reclaim, or alternate-owner
deletion authority. LC-18 remains outside this command.

### Operating model and guarantees

The transaction supports cooperating creators on one shared filesystem, within
the platform boundary in `docs/specs/platform.md`. Its guarantees are closed:

- **SC-01 — Exclusive reservation:** one direct-child reservation is acquired
  exclusively and verified before worktree mutation. Existing or unverifiable
  reservation evidence is preserved and never reclaimed by age or inference.
- **SC-02 — Canonical worktree:** the transaction creates and verifies one
  canonical detached worktree at the immutable provider head before lease
  publication.
- **SC-03 — No-clobber LC-01 publication:** the exact fresh LC-01 bytes are
  published without overwriting an existing lease. Successful publication is
  the transaction commit boundary; later failures preserve the discoverable
  lease.
- **SC-04 — Final verification:** success is returned only after worktree,
  registration, repository, head, lease, and discovery identity verify as one
  session.
- **SC-05 — Invocation-owned recovery:** before the commit boundary, complete
  rollback may remove only invocation-owned, unchanged evidence. Progressed,
  retained, replaced, or unverifiable evidence returns `manual-cleanup` and is
  preserved for the operator.
- **SC-06 — Crash retention:** evidence retained by a crash or incomplete
  recovery blocks later creation. The transaction performs no automatic stale
  reclamation.

The source-owned command contract remains closed. Required inputs are
`REPOSITORY`, `PR_NUMBER`, `PRIMARY_REPOSITORY_ROOT`, `HEAD_SHA`, `BASE_REF`,
`HEAD_REF`, and `UPDATED_AT`. Outcomes are `success`, `conflict`, and
`manual-cleanup`. Conflict reasons are `discovery-not-create`,
`reservation-contended`, `worktree-create-failed`, `lease-create-failed`,
`final-verification-failed`, `interrupted`, and
`lifecycle-reentry-required`; manual-cleanup reasons are
`reservation-unverifiable`, `worktree-unverifiable`, `lease-unverifiable`,
`rollback-incomplete`, and `interrupted`. Observed artifacts are only
`reservation`, `worktree`, `registration`, and `lease`, in that order. The
runtime types and validators remain authoritative for the exact result shape.

### Failure equivalence classes

- **SC-F1 — Reservation phase:** a valid other-token reservation is clean
  contention; missing proof of reservation custody or shape is unverifiable
  evidence. Neither case permits worktree or lease mutation.
- **SC-F2 — Worktree phase:** a creation failure with proven absence or
  complete invocation-owned rollback is conflict; any present, registered,
  progressed, or unverifiable worktree state is manual cleanup.
- **SC-F3 — Lease phase:** a staging or publication failure is conflict only
  when publication did not occur, temporary evidence is proven removed, and
  invocation-owned worktree rollback completes. Unsupported publication,
  retained temporary bytes, ignored or untracked hook output, or any other
  rollback refusal is manual cleanup with the observed evidence preserved.
- **SC-F4 — Final-verification phase:** a pre-publication verification failure
  may be conflict only after complete invocation-owned rollback. Once LC-01 is
  published, verification or reservation-cleanup failure is manual cleanup and
  the lease remains discoverable.

Focused regressions identify the applicable `SC-F*` class and prove one
representative ordinary-use failure. They do not establish a general fault,
custody, race, or filesystem-proof framework.

## Session Discovery

`review-leases.sh discover` is a read-only preflight for one repository and PR.
It inventories only direct-child active lease names for that PR, separately
reports archived lease names, observes the canonical
`.worktrees/pr-<N>-review` path, and compares lease worktree paths with the
repository's registered worktrees. It returns exactly one disposition:
`create`, `resume`, `cleanup-required`, `ambiguous`, or `invalid`.

### Discover result schema

`discover` writes exactly one JSON object followed by a newline; it has no
notice line. Its closed `pr-review/session-discovery/v1` object uses this key
order and these values:

1. `schema`: the literal `"pr-review/session-discovery/v1"`.
2. `repository`: the requested `owner/name` string.
3. `pr_number`: the requested positive integer.
4. `primary_repository_root`: the physical absolute primary repository path.
5. `canonical_worktree_path`: the physical absolute
   `.worktrees/pr-<N>-review` path under that root; discovery resolves an
   existing canonical path, or its existing `.worktrees` parent, before using
   it for registration and LC-18 comparison.
6. `canonical_worktree_present`: whether that canonical path is present on
   disk.
7. `active`: active candidates sorted lexically by direct-child `lease_file`.
8. `archived_lease_files`: archived `.ephemeral/<name>` direct-child lease
   paths sorted lexically.
9. `disposition`: one of the five values above.
10. `resume`: `null`, or an object with `lease_file` and physical absolute
    `worktree_path`; it is non-null only for `resume`.

Each `active` candidate uses this key order: `lease_file` (direct-child active
lease path), `worktree_path` (physical absolute path or `null`), `state` (one
of `created`, `reviewed`, `gated`, `resolving`, `posted`, `aborted`, `failed`, or `null`),
`classification` (`resumable`, `terminal`, `reentry`, `missing`,
`unregistered`, or `invalid`), `worktree_dirty`, and
`unmanaged_ephemeral_artifacts`. The two observation fields are booleans only
for a present, registered, identity-valid candidate; otherwise both are `null`.
They never expose dirty file names or unmanaged artifact paths.

For an eligible candidate, discovery reuses the existing read-only dirty and
owned-artifact inspections without calling `inspect-worktree` or recording
cleanup metadata. An inspection or ownership failure is `invalid`, not a
guessed `false`; only missing worktree paths retain the documented missing or
LC-18 reentry classification. A true dirty or unmanaged observation selects
`cleanup-required` with `resume: null`; it grants no cleanup authority.

`resume` is emitted only for one registered, schema-valid nonterminal lease.
Invalid evidence wins first, then dirty or unmanaged observations select
`cleanup-required`. More than one clean resumable lease is `ambiguous`, even
when one is canonical; canonical-path conflict handling applies only after that
selection. Terminal, missing, unregistered, or unleased canonical paths that
are present or still registered require an existing lifecycle or cleanup owner.
Stored active-lease `worktree_path` values must already be absolute physical
paths: relative paths, lexical aliases, and resolvable aliases are malformed
and `invalid`. For a missing path, discovery physicalizes the deepest existing
physical directory before that identity comparison. An `ENOTDIR` ancestor or
dangling-symlink ancestor is invalid before missing or LC-18 reentry, as is a
lexical or symlink-parent alias; a physical missing canonical or alternate path
retains its normal missing classification.
Malformed active lease evidence is `invalid`. The planner does not inspect or
repair arbitrary historical paths, infer cleanup authority, or mutate any
lifecycle state. Cleanup remains exclusively lease-gated.

When a `posted` or `aborted` lease has a valid helper-recorded
`cleanup.removed_at` marker and its stored physical worktree path is canonical,
its missing, unregistered worktree is eligible for the existing LC-18
archive-and-create reentry only after discovery reads that lease's exact
deterministic archive:
an absent archive or byte-equal archive permits reentry, a divergent archive
remains `missing` and therefore `cleanup-required`, and an unreadable archive
fails closed as `invalid`. Discovery establishes absence from that direct entry
before reading it, so a present dangling entry is unreadable rather than
absent. If a fresh LC-18 lease write is interrupted after that archive snapshot
and the canonical worktree has already been recreated, the same authority-valid,
clean, managed, registered canonical candidate is also `reentry`; `create`
reuses that worktree and retries only the fresh lease write. Later cleanup
observations may change `last_outcome` without revoking that marker. Other
terminal, missing, or unregistered leases remain `cleanup-required`.

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
- LC-19 revalidates the current result, preserves its accepted digest, and
  refreshes the result validation timestamp to that transition's `UPDATED_AT`.
- Terminal and failed recovery states may preserve older valid result evidence
  when artifact digest, identity, nested artifacts, and helper-backed authority
  still validate for the preserved family.

The result manifest digest is stored only in
`validation.result_manifest.sha256`. Do not expand the `pr-review/result/v2`
schema to carry lease freshness evidence.

Missing validation metadata, missing `validation.result_manifest`, or missing
required digest evidence makes a lease invalid. Classify it as
`invalid-lease`; do not rewrite missing evidence into a valid shape.

GitHub post metadata is phase-scoped:

- `github-post` failures must record `GITHUB_POST_ATTEMPTED=true` and
  `GITHUB_POST_RESULT=failed`.
- `thread-resolution` failures preserve the successful post metadata and
  provider review identity from the resolving lease.
- Other non-`github-post` failures clear GitHub post metadata to
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
archive, snapshots it to:

```text
.ephemeral/pr-${PR_NUMBER}-${WORKTREE_DIGEST}-${YYYYMMDDTHHMMSS}-${STATE}-archived-lease.json
```

The helper retains the valid terminal lease until the fresh `created` lease is
atomically installed. Terminal archive creation is exclusive: an existing
archive may be reused only when its bytes exactly equal the active terminal
lease; divergent bytes fail closed without overwriting either lease. If that
fresh write is interrupted after the archive snapshot, a retry can use the
still-active terminal lease and preserve the archived historical evidence.
Before discovery admits a missing canonical LC-18 reentry, it reads only this
exact archive: absent or byte-equal content permits the existing reentry/create
flow, while divergent or unreadable content never permits `create`.

For a `posted` or `aborted` lease whose cleanup helper has recorded a closed
`cleanup` observation with a valid non-null `removed_at` timestamp and whose
recorded physical worktree path is the canonical path, LC-18 may archive after
recreating that path without revalidating historical artifacts in the new
checkout. The helper writes `removed_at` only after `git worktree remove`
succeeds; a legacy `last_outcome: "removed"` observation without that marker
remains subject to strict historical-artifact validation. Later cleanup retries
may change `last_outcome` while `removed_at` remains the archive-authority
marker. That observation is narrowly scoped archive authority; it does not
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
