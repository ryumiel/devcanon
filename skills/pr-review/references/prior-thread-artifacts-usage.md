# Prior thread artifacts usage

## Role

Prepares and validates prior-thread and scope-decision artifacts, owns the provider-capture scratch lifecycle and capture classification, produces provider-scope evidence from a bound Phase 1 capture, and renders the Phase 4 scope notice.

## Invocation

Run `bash "$PR_REVIEW_DIR/scripts/prior-thread-artifacts.sh"` followed by `prepare-prior-threads-write`, `validate-prior-threads`, `prepare-scope-decision-write`, `prepare-provider-scope-evidence-write`, `create-provider-scope-scratch`, `remove-provider-scope-scratch <scratch-dir>`, `reconcile-provider-scope-fetch <scratch-dir>`, `materialize-provider-scope-capture`, `classify-provider-scope-capture`, `write-provider-scope-evidence`, `read-provider-scope-evidence-field --field <name>`, `render-scope-notice`, `validate-scope-decision`, `allocate-original --record-file <path>`, `seal-original --record-file <path>`.

## Inputs

Every command requires `HEAD_SHA` except `allocate-original`, `seal-original`, `create-provider-scope-scratch`, `remove-provider-scope-scratch`, `reconcile-provider-scope-fetch`, `read-provider-scope-evidence-field`, and `render-scope-notice`. `prepare-prior-threads-write`, `prepare-scope-decision-write`, and `prepare-provider-scope-evidence-write` require no further input. `materialize-provider-scope-capture` additionally requires `PR_REPOSITORY`, `PROVIDER_SCOPE_CAPTURE_FILE`, `PROVIDER_SCOPE_CAPTURE_TMP_FILE`, `PROVIDER_SCOPE_CAPTURE_PR_FILE`, `PROVIDER_SCOPE_CAPTURE_FILES_FILE`, and `PROVIDER_SCOPE_CAPTURE_DIFF_FILE`; its canonical capture target is the direct child `.ephemeral/<branch-slug>-<HEAD_SHA>-provider-scope-capture.json`, while its scratch and raw inputs are private regular files. It refuses an existing target without clobbering it, and may leave its private temp output on failure for the owning SKILL trap to remove; the canonical target remains absent or unchanged. `write-provider-scope-evidence` requires `HEAD_SHA` and `PROVIDER_SCOPE_CAPTURE_FILE`. The capture is a readable non-symlink file created in the target review worktree. Its closed `pr-review/provider-scope-capture/v1` object contains only `schema`, `provider`, `repository`, `pr_number`, `baseRefOid`, `headRefOid`, `evidence_complete`, `provider_files`, and `provider_diff`. For non-empty `provider_files`, `patch_base64` availability is uniform: all complete byte-for-byte patches as strict base64, or all `null`; GitHub `files[].patch` hunk fragments are `null`. `provider_diff.dialect` is exactly `canonical-git-diff/v1` or `github-provider-diff/v1`, and its strict base64 is exact raw provider diff bytes. Do not place local metadata, digests, provenance, or merge-base claims in the capture. A prior producer failure leaves the exact capture for retry; reuse it rather than overwriting/refetching. It resolves the sibling packaged `devcanon-runtime` passive runtime support bundle; `DEVCANON_RUNTIME_DIR` is optional for diagnostics. It accepts only the exact one-line `pr-review-provider-scope-evidence` major-1 command contract and forwards the capture directly to its distinct producer route. `create-provider-scope-scratch` takes no argument and no further input. `reconcile-provider-scope-fetch` takes exactly one scratch directory path. `remove-provider-scope-scratch` takes a scratch path and optionally `--expected-snapshot-file <path>` for the guarded mode below; the path must be a direct `.ephemeral` child whose leaf begins with `provider-scope-capture.`, and `reconcile-provider-scope-fetch` reads `pr.json` and `recheck.json` from inside it. `classify-provider-scope-capture` requires `HEAD_SHA`, `PROVIDER_SCOPE_CAPTURE_FILE`, `PR_BASE_OID`, `PR_REPOSITORY`, and `PR_NUMBER`. `read-provider-scope-evidence-field` requires `PROVIDER_SCOPE_EVIDENCE_FILE` and exactly one `--field` of `provider_pr_diff_base_sha` or `full_pr_diff_range`. `render-scope-notice` requires only `REVIEW_SCOPE_DECISION_FILE` and accepts any readable path for it. `validate-prior-threads` requires `PRIOR_THREADS_FILE`. `validate-scope-decision` requires `SCOPE_DECISION_FILE`, `BASE_REF`, and `PROVIDER_SCOPE_EVIDENCE_FILE`; `PRIOR_THREADS_FILE` is optional and changes the expected prior-context pair. When it is absent or unset, validation selects the existing canonical prior-threads artifact, if present, and requires the scope decision's prior-context pair to name it; without that artifact it expects the `none`/`null` pair. `PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT` is optional. No command reads stdin.

## Working directory

Run every command from the target review worktree root, except `render-scope-notice`, which reads only its bound scope-decision path and does not require a repository root.

## Outputs

Each prepare command prints its validated repo-relative destination path; materialization and validation commands are silent on success. `create-provider-scope-scratch` prints the fresh repo-relative scratch directory path plus newline; `remove-provider-scope-scratch` and `reconcile-provider-scope-fetch` are silent. `classify-provider-scope-capture` is silent and reports through exit status only: 0 when the capture binds this provider, repository, PR, base, and head; 2 when it is well formed but stale; 3 when it is unreadable, malformed, or unclassifiable. `read-provider-scope-evidence-field` prints the requested field value plus newline. `render-scope-notice` prints exactly `PR review scope: mode=..., selection=..., selected files=.... Review is continuing.` and never echoes changed-file text. `write-provider-scope-evidence` prints exactly the canonical repo-relative `-provider-scope-evidence.json` path plus newline after successful production and capture deletion. Its output is the exact closed `pr-review/provider-scope-evidence/v2` schema with required provider identity, bound base/head/range, completeness, digest provenance, provider/local file arrays, and provider/local full-diff digests. Diagnostics use stderr.

The v2 top-level keys are `schema`, `provider`, `repository`, `pr_number`, `baseRefOid`, `headRefOid`, `provider_pr_diff_base_sha`, `local_review_head_sha`, `full_pr_diff_range`, `evidence_complete`, `digest_provenance`, `provider_files`, `local_files`, `provider_diff_sha256`, and `local_diff_sha256`. `digest_provenance` keys are `schema`, `provider_diff`, `local_diff`, `provider_patches`, and `local_patches`; each provider/local file entry keys are `path`, `status`, `previous_path`, `additions`, `deletions`, `changes`, `patch_sha256`, and `patch_available`.

An empty `provider_files`/`local_files` pair may retain `github-provider-diff/v1` only when its provider full-diff digest equals the canonical local full-diff digest.

## Prior-thread construction

From the target review worktree root, set `HEAD_SHA` to the current full head
SHA and `PR_NUMBER` to the verified positive GitHub PR number. Run
`prepare-prior-threads-write` and retain its exact returned path as
`PRIOR_THREADS_FILE`; retain it unchanged for construction, validation, and
handoff. Never reconstruct the basename or alias an artifact to a guessed path.
If a path was guessed incorrectly, reacquire the producer output and use only
correctly bound content. Missing or malformed content fails before use; arbitrary
historical evidence gains no authority. The controller writes a closed
`pr-review/prior-threads/v1` object with exactly `schema`, `provider`,
`pr_number`, `head_sha`, `threads`, and `dropped`; then it runs
`validate-prior-threads` with that unchanged path before handoff. The runtime
validator is the acceptance authority. A bare array, a missing field, or an
invalid thread is rejected. Do not fabricate thread IDs, file paths, or line
locations to represent a review-body finding.

This executable example is for an illustrative PR #390 at a verified current
head. It represents a captured review body with a substantive finding and no
inline threads. The body is carried separately as untrusted prior-review
context, as described in the [shared review context](../../play-review/references/shared-review-context.md#review-body-example).
The empty arrays say only that there are no inline threads or dropped thread
records; they do not erase the body finding. Export the exact prepared path as
`PRIOR_THREADS_FILE` before running the example:

```sh
node --input-type=module <<'NODE'
import { writeFileSync } from 'node:fs';

const envelope = {
  schema: 'pr-review/prior-threads/v1',
  provider: 'github',
  pr_number: Number(process.env.PR_NUMBER),
  head_sha: process.env.HEAD_SHA,
  threads: [],
  dropped: [],
};
writeFileSync(process.env.PRIOR_THREADS_FILE, `${JSON.stringify(envelope, null, 2)}\n`, { flag: 'w' });
NODE
```

Use this empty-thread form only when the captured provider facts show no inline
threads. For actual inline threads, populate `threads` and `dropped` from the
verified capture under the runtime schema; do not substitute this example for
those facts. If validation refuses, stop and resolve the facts through the
existing custody path. The adapter prepares the destination and validates the
written file; the controller owns its bounded content write. Existing cleanup
remains unchanged.

## Local prior coverage

Completed local PR findings enter the existing untrusted prior-review context
with substantive finding IDs and origin commits for resolution checks. They are
not provider threads: do not fabricate thread IDs/locations, populate an empty
provider envelope as proof of local completion, or use branch-findings on the
PR surface. Supply the retained local result/findings reference as an existing
optional prior-review input before ordinary shared-context preparation. Under
the [shared review context](../../play-review/references/shared-review-context.md)
owner, retain original evidence identity/bytes separately and construct bounded
`prior_review_context.records` with the local source reference, substantive IDs
and origin commits in the sanitized summary, and `untrusted: true`. This uses
the existing open source-kind/reference fields, not a new manifest or provider
thread. Actual provider capture keeps the existing envelope contract.
Establish baseline identity, independent terminal completion, applicable findings,
coverage chain, and comparison before preparing scope. The existing scope
schema prior-context pair continues to describe only actual provider threads;
local claims are carried separately through shared review context. Preserve both
on full escalation, and recompute hints after final scope selection.

## Scope-decision construction

The runtime validator is the sole schema and acceptance authority. After
`prepare-scope-decision-write` returns its exact canonical path, the controller
may run this one installed JavaScript example from the review worktree root.
Set `SCOPE_VERIFIED_FACTS_FILE` to a controller-owned private JSON file of
**already verified** facts and export `SCOPE_DECISION_FILE` as the unchanged
path returned by the adapter. The example copies facts without deriving provider identity,
Git ranges, prior-review state, mechanical facts, or semantic judgment. It
does not grant acceptance: run `validate-scope-decision` before handoff.

```sh
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';

const facts = JSON.parse(readFileSync(process.env.SCOPE_VERIFIED_FACTS_FILE, 'utf8'));
const scope = { ...facts, schema: 'pr-review/scope-decision/v1', surface: 'pr-review' };
writeFileSync(process.env.SCOPE_DECISION_FILE, `${JSON.stringify(scope, null, 2)}\n`, { flag: 'w' });
NODE
```

The private facts object supplies exactly these values (and no `schema` or
`surface`): `mode` (`"initial"` or `"follow-up"`), `head_sha` (current 40-hex
SHA), `full_range`, `selected_range`, and `candidate_narrow_range` (nonempty
strings), `last_reviewed_sha` (40-hex SHA or `null`),
`is_followup_narrow` (boolean), `selection_reason` (nonempty string),
`escalation_reasons`, `changed_files`, and `language_hints` (string arrays),
`prior_context` (`{ "kind": "none" | "github-prior-threads", "path": null |
".ephemeral/<canonical-prior-threads-file>" }`), `mechanical_facts`
(`changed_file_count`: nonnegative integer, `followup_sha_usable` and
`mechanical_escalate_full`: booleans, `mechanical_escalation_reason`: string),
`semantic_decision` (`checked` and `ambiguous`: booleans, `notes`: string), and
`artifacts` (`provider_scope_evidence_file`: exact returned canonical provider
path, `provider_scope_evidence_sha256`: SHA-256 of its exact bytes). The
controller must verify every supplied fact before the example; it must not
default `semantic_decision.checked` to true. `scope_reason_codes` and
`scope_explanation` are branch-review-only and are prohibited in PR scope.

For an initial PR review, use the provider-evidence full range for all three
range fields, `last_reviewed_sha: null`, `is_followup_narrow: false`,
`prior_context: { "kind": "none", "path": null }`,
`escalation_reasons: ["not-followup"]`, and mechanical facts
`followup_sha_usable: false`, `mechanical_escalate_full: true`,
`mechanical_escalation_reason: "not-followup"`; derive the count and file/hint
arrays from the full range. This initial case requires no canonical prior-threads
artifact in the worktree: the adapter selects one if it exists, and the runtime
then rejects an initial scope with prior context. Resolve that conflicting
artifact through the existing custody/refusal path before preparation; do not
change the pair to make an initial review appear valid. For a follow-up, use the existing follow-up scope
policy: a usable prior SHA yields `candidate_narrow_range` equal to
`<last_reviewed_sha>..HEAD` even when escalation selects the full range; an
unusable prior SHA yields the full range as candidate. Set selected range,
escalation reasons, prior pair, mechanical facts, and semantic decision from
the current verified policy inputs. No placeholder is an accepted fact.

## Unaccepted candidate correction

Construct corrections through the same canonical facts and destination above;
full validation after each correction remains the sole acceptance gate. Preserve
failed bytes and stderr before replacing a never-accepted candidate. Distinct
mechanically determinable errors may be corrected by the existing owner while
head, provider path/digest, ranges, prior inputs and substantive decisions remain
verified. Actual semantic completion must precede a true checked flag; the flag
is never defaulted to make validation pass. Use validator-derived file-extension
language hints, such as `md` for Markdown, rather than display names.

The [PR-review operator flow](../SKILL.md) owns controller-local digest/error
progress checks and escalation. The [lease lifecycle contract](review-lease-lifecycle-contract.md#preparation-recovery-and-retained-custody)
owns the fixed two-file/four-file retained-failure family and LC-19 recovery.
An original four-file scratch retains both candidate/stderr pairs. Accompanying
explanatory notes may evolve only with checked/hint correction; both notes must
be strings and the reviewer independently confirms unchanged substantive
selection. All remaining scope facts match exactly; notes-only candidates refuse.
Scratch
preserved for that custody is never removed by successful correction or cleanup.
No scope correction creates a review verdict.

## Refusal and failures

Unknown commands, missing metadata, unsafe paths, incompatible or malformed runtime contracts, invalid captures, Git-derived evidence mismatches, or invalid support validation exit nonzero without a success path. The existing prepare-only command remains compatible and does not produce evidence.

## Side effects

Prepare commands create or check `.ephemeral` and prepare destination paths without creating final artifact files; validation, classification, field-read, and scope-notice commands are read-only. `create-provider-scope-scratch` creates one fresh private directory under `.ephemeral`; `remove-provider-scope-scratch` removes exactly the given scratch directory and succeeds when it is already absent, refusing any path outside `.ephemeral` or any non-directory. The producer atomically writes and validates the canonical v2 evidence, then deletes exactly its accepted capture. Earlier failures preserve the capture; deletion failure preserves both the valid evidence and capture for retry. It never reads stdin, refetches provider data, or scans `.ephemeral` for cleanup.

## Workflow boundary

[PR review workflow context](../SKILL.md) owns thread interpretation and review scope continuation.

## Original producer custody

These operations use the same existing adapter/runtime; they create no new CLI
command or semantic acceptance schema. Run from the physical disposable review
worktree root with exact `REPOSITORY` and `PR_NUMBER`. Record paths are absolute
physical regular nonsymlink direct children of the **same repository's primary**
`.ephemeral`, outside the disposable worktree.

```sh
scratch="$(bash "$PR_REVIEW_ARTIFACT_HELPER" allocate-original --record-file "$record_file")"
# Original producer writes the exact candidate/diagnostic leaves to "$scratch".
bash "$PR_REVIEW_ARTIFACT_HELPER" seal-original --record-file "$record_file"
```

Allocation returns one fresh repo-relative `provider-scope-capture.*` directory
and exclusively writes its original resource identity before production. Sealing
records exact produced regular nonsymlink leaf identities/digests and the closed
entry set before semantic acceptance or correction. Repeated sealing is allowed
only for identical bytes. It does not validate scope, create a handoff, or enroll
`preparation_failures`. Preserve failed bytes and seal them before replacement.
The allocating owner can remove a successful no-failure scratch and its unused
allocation record after their purposes end; failure bytes require lifecycle
retirement rather than ordinary `remove-provider-scope-scratch`.

`OriginalReviewArtifact` in `src/runtime/review-artifacts.ts` owns the closed
current-producer record: `schema: "pr-review/original-artifact/v1"`,
`producer: "pr-review/provider-scope"`, `operation_id`, `repository`, `pr_number`,
physical `worktree_path`, `old_head`, directory `resource`, `dev`, `ino`,
`production` (`allocated` or `sealed`), and closed regular-leaf `entries`
(`name`, `sha256`, `dev`, `ino`). Constructed sealed records are validated before
replacing allocated receipts. Unsupported leaf names refuse without changing
the allocated receipt. Receipt publication failure removes only its unchanged
empty allocation or reports the exact retained locator.

There is no general qualification command, recovered receipt production, source
reference/recovery fields, or standalone-file receipt compatibility. Historical
qualification packets are not executable inputs. Never fabricate a current
producer receipt or retroactively enroll failed bytes to bypass missing custody.

### Guarded cleanup of existing provider-scope scratch

The original owner/controller first establishes actual original custody, ends
consumers and recovery obligations, verifies useful-context publication and binds
current scoped action authority. Unknown ownership, an active reviewer, pending
publication or uncertain effects hold cleanup before invocation. Matching hashes
cannot make those decisions or grant ownership.

Once those conditions hold, run the existing boundary from the physical primary:

```sh
REPOSITORY="owner/repo" PR_NUMBER="$pr_number" PRIMARY_REPOSITORY_ROOT="$physical_primary" \
  bash "$PR_REVIEW_ARTIFACT_HELPER" remove-provider-scope-scratch "$scratch" \
    --expected-snapshot-file "$snapshot_file"
```

The physical primary `.ephemeral` snapshot file uses the closed retirement
bindings documented in [lease usage](review-leases-usage.md#guarded-scratch-cleanup),
with `schema: "pr-review/provider-scope-cleanup/v1"` and a nonempty `expected_scratch` family
instead of `original_records`. Each snapshot contains directory `resource`,
`dev`, `ino` and closed regular-leaf `entries` (`name`, `sha256`, `dev`, `ino`).
The scratch argument binds the first family member; the packet covers the complete
intended cleanup footprint. Partial filesystem effects are held and recoverable,
not atomic rollback. It is a deletion precondition, not an original-production or legacy receipt.
The mode shares the existing lease reservation and exact partial-effect recovery.
It refuses stale head/lease/identity, changed/extra/symlink/tracked/accepted evidence,
dirty or unregistered worktrees, concurrent owners and unresolved obligations.
Unguarded removal still refuses retained failed diagnostics. Active capture traps
and normal successful validation cleanup keep their existing behavior.

Replay only the identical invocation and snapshot bytes after a held operation;
missing leaves require its saved intent/progress. The result is the lease owner's
`attempt-retirement-result/v1` (`retired` or `held`), with observed current lease
SHA and exact operation locator. The lease is unchanged for unenrolled scratch;
only matching existing preparation metadata can release, with no LC-19 invention
or semantic acceptance. Historical live cleanup remains its original owner's
separate reviewed action; this interface alone authorizes no live effects.
