# Review leases usage

## Role

Performs deterministic PR-review lease lifecycle operations.

## Invocation

Run `bash "$PR_REVIEW_DIR/scripts/review-leases.sh"` followed by exactly one of `derive-path`, `discover`, `retire-attempt`, `session-reconcile`, `session-create`, `write`, `record-audit-failure`, `validate`, `read-status`, `inspect-worktree`, or `cleanup-worktree`; remaining arguments are forwarded unchanged to the packaged `pr-review-leases` runtime command.

## Inputs

`derive-path` requires `REPOSITORY`, positive `PR_NUMBER`, `PRIMARY_REPOSITORY_ROOT`, and `WORKTREE_PATH`; `LEASE_FILE` is optional. `discover` requires `REPOSITORY`, `PR_NUMBER`, and `PRIMARY_REPOSITORY_ROOT`. `session-create` adds 40-character `HEAD_SHA` naming an available Git commit object itself (not an annotated tag that peels to a commit), nonblank `BASE_REF` and `HEAD_REF`, and optional UTC `UPDATED_AT`. `write`, `validate`, and `read-status` require `REPOSITORY`, `PR_NUMBER`, `PRIMARY_REPOSITORY_ROOT`, `WORKTREE_PATH`, and `LEASE_FILE`; `write` also requires `STATE` (`created`, `reviewed`, `gated`, `posted`, `aborted`, or `failed`), `BASE_REF` and `HEAD_REF`, while `read-status` additionally requires `RESULT_FILE` and `HEAD_SHA`.

For `write`, `CREATED_AT` is optional (otherwise `UPDATED_AT` is used); `HANDOFF_FILE`, `RESULT_FILE`, `APPROVED_REVIEW_FILE`, `VALIDATED_REVIEW_PAYLOAD_FILE`, `PRESENTED_AT`, `PRESENTATION_STATUS` (`preview-current` or `edited`), `FINISHED_AT`, `TERMINAL_REASON`, `FAILURE_PHASE`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY` (`recoverable`, `unrecoverable`, or `unknown`), `GITHUB_POST_ATTEMPTED`, `GITHUB_POST_RESULT`, `GITHUB_POSTED_AT`, and `EXPECTED_STATE` are transition-conditional. Aborted transitions require `TERMINAL_REASON`; posted transitions require `APPROVED_REVIEW_FILE`, `VALIDATED_REVIEW_PAYLOAD_FILE`, and `GITHUB_POSTED_AT`; failed transitions require `FAILURE_PHASE` (`handoff-validation`, `review`, `result-validation`, `preview-render`, `approval-freeze`, `stale-head`, or `github-post`), `FAILURE_REASON`, and `FAILURE_RECOVERABILITY`. A `github-post` failure additionally requires `GITHUB_POST_ATTEMPTED=true`, `GITHUB_POST_RESULT=failed`, and an approved-review file available through `APPROVED_REVIEW_FILE` or the existing lease's `artifacts.approved_review_file`; when supplied explicitly, normal source consistency and validation rules apply.

`record-audit-failure` requires `REPOSITORY`, `PR_NUMBER`, `PRIMARY_REPOSITORY_ROOT`, `LEASE_FILE`, `STATE=failed`, `BASE_REF`, `HEAD_REF`, `FAILURE_PHASE=preview-render`, `FAILURE_REASON`, `FAILURE_RECOVERABILITY`, and `EXPECTED_STATE=gated`; it is accepted only for an existing gated lease with gated preview-render evidence. `inspect-worktree` and `cleanup-worktree` require `REPOSITORY`, `PR_NUMBER`, `PRIMARY_REPOSITORY_ROOT`, `WORKTREE_PATH`, and `LEASE_FILE`. For `cleanup-worktree`, optional `ALLOW_POLICY_OVERRIDE=yes` permits removal from a non-`posted`/non-`aborted` state when all other cleanup guards permit it. `session-create` also accepts optional `ALLOW_TERMINAL_ADVANCE=yes`; absence preserves the default route and any other supplied value is invalid. No command reads stdin. `DEVCANON_RUNTIME_DIR` is optional for runtime diagnostics.

## Timestamp and presentation applicability

Absent routine timestamps use one current UTC operation instant: `UPDATED_AT`,
`CREATED_AT` on creation, `PRESENTED_AT` on gated writes, and `FINISHED_AT` on
terminal writes. Missing `CREATED_AT` uses the operation's `UPDATED_AT`.
Explicit empty or invalid applicable values fail rather than default.
`GITHUB_POSTED_AT` remains explicit evidence of a successful post.

UTC inputs accept real four-digit calendar dates in
`YYYY-MM-DDTHH:mm:ssZ` or `YYYY-MM-DDTHH:mm:ss.<one-or-more-decimal-digits>Z`.
Supplied strings and precision are preserved. Offsets, leap seconds,
whitespace, empty values and calendar rollover are refused.

Only gated writes consume `PRESENTATION_STATUS` and `PRESENTED_AT`; other
operations ignore ambient result-presentation inputs. Gated status remains
required and accepts only `preview-current` or `edited`. A reviewed write can
accept a result's `not-presented` status without lease presentation authority.

`write` supports LC-19 failed-to-created recovery only for the eligible
pre-handoff failure defined by the [lifecycle owner](review-lease-lifecycle-contract.md#preparation-recovery-and-retained-custody).
It requires exact current `HEAD_SHA`, fully validated `HANDOFF_FILE`, unchanged
base/head refs and fresh `UPDATED_AT`. Optional `PREPARATION_FAILURE_DIRS` is a
JSON array of distinct repo-relative controller-owned scratch directories.
Supply it when recording handoff-validation failure or recovering through LC-19;
claiming custody requires the corrected fully validated handoff even when the
failure write does not accept that handoff. `discover` may consume the same
explicit recovery handoff/head/scratch inputs read-only. Each scratch must pass
the lifecycle owner's closed content and byte-digest checks; absent or empty
input claims no additional directories. Duplicate candidates, broken custody,
stale head, identity mismatch and unrelated failure phases refuse before writes.

Each `preparation_failures` record has closed `directory`, `scope_sha256` and
`diagnostics_sha256` keys, plus optional closed `second_pair` with the two digest
keys. Two files bind the first pair; exactly four files bind both fixed pairs.
Every digest is immutable and candidate digests are unique within/across records.
Old/current explanatory notes must be strings and may differ only with a checked
or hint correction; substantive selection remains independently verified by the
original reviewer. Notes-only, missing pair, arbitrary extra entries and changed
substantive facts refuse.

Validated custody is stored in optional `preparation_failures` records and
inherited through later states. Supply only newly claimed directories; inherited
records are rechecked without repeating their paths in the input. `write`
archives exact preceding failed bytes
before LC-19 or repeated pre-handoff failure publication; unequal archive
collisions refuse. Until supported purpose-ended `retire-attempt` releases the
exact qualified family, cleanup retains worktrees carrying this history even with
`ALLOW_POLICY_OVERRIDE=yes` and after terminal completion. Preservation custody
alone never grants scratch deletion or advancement that erases unreleased history;
use the original-proven retirement boundary below to establish finite release.

## Working directory

Every operation, including inspection and cleanup, runs from `PRIMARY_REPOSITORY_ROOT`, which must be the physical primary Git worktree root.

## Outputs

It emits the command's structured lease result on stdout and diagnostics on stderr.

## Refusal and failures

Command-validation failures—unknown commands, missing runtime, unsafe or missing paths, and invalid lifecycle state for validation or write operations—exit nonzero with diagnostics on stderr. `session-create` conflicts and manual-cleanup outcomes instead exit 1 with a structured `pr-review/session-create/v1` JSON result on stdout and empty stderr. `inspect-worktree` and `cleanup-worktree` classify invalid lease state and other non-removable worktree conditions as exit-zero structured results, including `REFUSAL_REASON=invalid-lease`; cleanup reports its `retained`, `skipped`, or `failed` outcome on stdout.

## Side effects

`session-create` creates a reservation, registers a detached review worktree, publishes its lease, then removes its reservation on success. With the exact terminal-advance opt-in, it instead advances the same clean registered canonical detached path to the supplied provider head, archives the terminal lease, publishes a fresh empty-authority created lease, and removes only proven unchanged old lease-owned direct-child artifacts that are not tracked at the target head. A lease-owned direct-child artifact tracked at the old head refuses before archive creation or checkout with `conflict: discovery-not-create`, preserving the old head and evidence. The success and conflict/manual-cleanup result family is unchanged. Failed default fresh creation attempts roll back where possible; incomplete rollback or verification may retain the reservation, worktree, Git registration, or lease. After terminal-head advancement, incomplete work returns existing `manual-cleanup` with `rollback-incomplete`, preserves any still-present invocation-owned reservation and observable evidence, and reports the current observed artifacts truthfully. `write` and `record-audit-failure` write lease records; `cleanup-worktree` can remove a validated worktree and, for eligible leases, rewrites cleanup metadata for retained, skipped, failed, and removed outcomes. `inspect-worktree` can also write cleanup metadata when the lifecycle state requires recording it. `derive-path`, `discover`, `validate`, and `read-status` are read-only.

## Workflow boundary

[PR review workflow context](../SKILL.md) owns lifecycle judgment and cleanup continuation.

## Original-proven attempt retirement

From the **physical primary repository root**, invoke:

```sh
REPOSITORY="owner/repo" PR_NUMBER="432" PRIMARY_REPOSITORY_ROOT="$physical_primary" \
  bash "$PR_REVIEW_LEASE_HELPER" retire-attempt --request-file "$request_file"
```

`request_file` is an absolute physical regular nonsymlink direct child of the
primary `.ephemeral`, outside the disposable checkout. Runtime source
`AttemptRetirementRequest` in `src/runtime/pr-review-leases.ts` owns the closed
shape; unknown or duplicate JSON members refuse. Required fields are:

| Field                                 | Binding                                                                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`                              | `pr-review/attempt-retirement/v1`                                                                                                      |
| `operation_id`                        | Unique 1–80 character identifier using letters, digits, `_`, `-`; reuse only the identical operation                                   |
| `repository`, `pr_number`             | Exact current repository and positive PR number                                                                                        |
| `worktree_path`, `old_head`           | Physical registered canonical worktree and actual 40-hex old head                                                                      |
| `lease_file`, `lease_sha256`          | Current primary-relative direct-child lease and exact original lease byte digest                                                       |
| `original_records`                    | Nonempty unique closed `{file, sha256}` references to artifact-owner original production records in the physical primary               |
| `authority_ref`                       | Nonblank current action-authority evidence locator, independently checked by the invoking owner                                        |
| `active_consumers`, `pending_effects` | Both empty only after the invoking owner resolves actual readers/reviewers, findings, diagnosis, replay, recovery and delivery effects |
| `publication`                         | Closed `{status, references}`; `not-required` with an empty list, or `published` with actual verified GitHub issue/PR URLs             |

Digests are lowercase 64-hex SHA-256. A producer record is custody evidence, not
approval. The helper verifies bindings and bytes; the wrapper/original owner
qualifies original production, purpose exhaustion, actual durable publication
and applicable human authority. Pending/failed/unknown publication refuses.
Do not synthesize empty consumers or not-required from task completion alone.

The helper emits `pr-review/attempt-retirement-result/v1` JSON with `outcome`
(`retired` or `held`), `operation_file`, `request_sha256`, resulting
`lease_sha256`, and nullable `reason`. The digest reflects verified current lease
bytes for both held and retired outcomes; it is null when current bytes cannot
be safely observed, and never substitutes the planned released digest. `retired` exits 0; held or invalid input
exits 1. Pre-effect invalid input emits a stderr diagnostic. `held` truthfully
reports partial/uncertain effects; it does not promise rollback.

The deterministic primary operation file is
`.ephemeral/pr-<number>-retirement-<operation_id>.json`. It retains the exact
request digest, reservation, original/released lease bytes, original resource
records and per-step progress. The same PR reservation also covers lease writes,
audit failure writes and cleanup metadata/removal. Each destructive step rechecks
current head, registration, clean source, lease/request/reservation and original
bytes. Changed, extra, nested, symlinked, unknown, current-hash-only, active,
unpublished, dirty, concurrent and uncertain resources remain.

Retry **the identical invocation with identical request bytes** to resume a held
operation. A missing leaf/resource is idempotent only with retained exact
same-operation intent/progress; divergent requests, altered operation evidence or
another owner's reservation refuse. Do not clear a reservation, substitute files,
reset progress or remove scratch manually. Keep request, original records and
operation evidence while replay or reconciliation needs them. Resolved diagnostic
inputs have no age-based or blanket archive obligation; the original owner retires
them only when remaining compact replay guards cover their consumers.

Known successful posting is a settled effect: a validated `posted` lease with
its succeeded posting evidence can retire exhausted diagnostics. Accepted
handoff/result, approval and validated-payload pointers and bytes remain intact;
active frozen actions and unresolved or attempted unsuccessful posting still refuse.

Retirement releases only exact proven current `preparation_failures` metadata.
It does not enroll invalid candidates or delete any member of the complete
accepted evidence family, including indirect scope/provider, findings, body,
shared-context and approval-owned files. Original custody alone cannot make
accepted evidence disposable.
Historical records remain context. After retirement, the ordinary classifier and
posted/aborted canonical advancement remain supported.

## Completed or failed current-head continuation

`session-create` additionally accepts `CONTINUATION_REQUEST_FILE`, an absolute
physical primary `.ephemeral` direct-child JSON file. Existing default creation
and `ALLOW_TERMINAL_ADVANCE=yes` posted/aborted behavior remain. The continuation
file is a source-owned closed `pr-review/attempt-continuation/v1` packet:

- Exact `repository`, `pr_number`, `worktree_path`, `old_head`, `target_head`,
  `lease_file`, `lease_sha256` and nonblank `authority_ref`.
- Empty qualified `active_consumers` and `pending_effects`, plus the same closed
  `publication` disposition above.
- Closed `provider_evidence: {file, sha256}` referencing accessible physical
  primary evidence independently verified by the wrapper. Its JSON binds
  `repository`, `pr_number` and `headRefOid` to `target_head`; a file body is not
  itself proof of provider retrieval.
- `baseline: "completed"` for a valid completed result, or `"incomplete"` for an
  exhausted semantically incomplete failed attempt. Mechanical finalization
  failure does not change the former to the latter.
- `continuity`, a list of unique closed `{file, sha256}` references to exact
  accessible regular nonsymlink primary evidence actually needed after replacement.
  An empty list is valid when no local-only comparison consumer needs it; do not
  introduce mandatory baseline or whole-tree copies. A soon-deleted checkout path
  is not continuity.

Supply the normal `HEAD_SHA`, `BASE_REF`, `HEAD_REF`, identity and optional
`UPDATED_AT` inputs. The target head must differ, resolve as an exact commit and
match the independently verified provider proof. One clean registered canonical
lease, no frozen approval/payload, no attempted/unknown posting and resolved
scratch obligations are required. `reviewed`, `gated` and exhausted `failed`
leases are eligible; a result-bearing mechanical failure retains a completed
historical baseline, while an incomplete failure cannot invent one.

The existing reservation and collision-safe exact historical lease snapshot
protect replacement. The old archive preserves its truthful state and bytes;
the fresh active `created` lease clears result, validation, presentation,
approval/payload, terminal/failure, posting, cleanup and live shared-context
custody. Scope selection and fresh independent current-byte review remain with
shared scope/wrapper owners. Success/conflict/manual-cleanup uses the existing
`session-create/v1` result. Partial head or lease advancement retains observed
reservation/snapshot evidence and holds for exact owner reconciliation; blind
retry and fabricated abort/post/completion refuse.

Before any head advancement, failed first operation publication releases only
this invocation's reservation when the old lease, head, artifacts, archive and
reservation still verify and its absent or exclusively created invalid intent
remains exactly bound. Invalid publication bytes remain primary-owned diagnostics;
a fresh reserved invocation can retry safely. A complete intent retains supported same-operation
reconciliation; changed or unknown custody remains held.

## Exact interrupted session reconciliation

From the physical primary, use the exact `invocation_token` returned by the held
`session-create` operation:

```sh
REPOSITORY="owner/repo" PR_NUMBER="432" PRIMARY_REPOSITORY_ROOT="$physical_primary" \
  bash "$PR_REVIEW_LEASE_HELPER" session-reconcile --invocation-token "$invocation_token"
```

For completed/failed continuation, supply the same `CONTINUATION_REQUEST_FILE`
with identical qualified action bytes. The source-owned primary operation is
`.ephemeral/pr-<number>-session-advance-<token>.json`; it binds the exact existing
reservation, old archive digest/head, cleared successor bytes/head, optional
continuation request digest, original artifact identity/digests and per-step
intent/progress. It stores no whole artifact-tree copy.

Reconciliation accepts only that same immutable operation with accessible exact
archive/action and unchanged known resources. Changed/reappeared files, unknown
absence, another reservation, dirty/unregistered resources, divergent leases or
unobserved heads hold. It can complete a proven old-head operation, publish the
exact already-bound cleared successor and finish only unchanged original artifact
removal. Each step rechecks bindings. A prior removal is idempotent only with exact
same-operation intent/progress. It never clears another owner's reservation or
inherits old approval. Success uses the existing `session-create/v1` success JSON;
held results emit `session-reconciliation/v1` with token, operation path and reason
and exit 1. A completed operation replays only while the exact current successor
and retired resource absence still verify. Keep its compact guard while delayed
replay needs it; older operation evidence is never new action authority.
