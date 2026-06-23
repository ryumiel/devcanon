---
name: play-validate-review-artifacts
description: Support-only validation contract for shared Play review artifacts. Use when a Play review wrapper or adapter must delegate deterministic review-artifact validation across PR review, branch review, or generated and installed review skill bundles.
---
# Play Validate Review Artifacts

Support skill for deterministic review-artifact validation across Play review
surfaces.

This skill is not a normal human workflow entry point. Do not invoke it as a
standalone review workflow, and do not use it to decide review judgment,
severity, category, routing, or user approval. Human-facing review workflows
remain `pr-review`, `branch-review`, and their `play-review` handoff.

## Authority

The sibling script
`skills/play-validate-review-artifacts/scripts/review-artifacts.sh` exposes the
shared deterministic validation command surface for review artifacts consumed
by Play review surfaces. It forwards those commands to the packaged
`devcanon-runtime` typed runtime, whose authority is limited to executable
mechanics for review-artifact contracts, including schema checks, Git-derived
artifact facts, scope range invariants, follow-up SHA usability, changed-file
and language-hint derivation, escalation reasons, diff-anchor validation, and
approved-review payload equivalence. It also owns deterministic validation and
gate-result interpretation for `branch-review/approval-summary/v1`; approval
summary artifacts store `terminal_state`, never `gate_passed`.

The script does not own:

- human review workflow entry points;
- review finding judgment, severity, category, or critic decisions;
- GitHub posting or thread-resolution approval;
- `play-review/findings/v1` envelope production;
- a general shared runtime utility model for unrelated skills.

This support skill is a narrow exception because multiple review surfaces must
share one deterministic artifact-validation authority. That exception does not
make the skill a user-facing workflow or a general shared runtime model.

## Consumer Relationship

Consumer scripts in `pr-review`, `branch-review`, and related Play review
wrappers are adapters. They remain responsible for their surface-specific
inputs, existing command names, current stdout contracts, and compatibility
with their owning skill prose. They translate surface-specific paths, expected
schemas, prior-context kinds, provider details, configured path patterns, and
review event intent into explicit support-validator flags.

Adapters must not copy shared validation policy into their own script bodies.
If the support validator is missing, adapters fail before validation with:

```text
play-validate-review-artifacts validator missing
```

A missing support validator is a packaging, render, sync, or install problem.
It is not permission to silently trust the adapter's input artifact.

## Script Resolution Contract

Adapters locate the support validator as a sibling skill script. Given an
adapter under:

```text
<skills-root>/<consumer-skill>/scripts/<adapter>.sh
```

the default validator path is:

```text
<skills-root>/play-validate-review-artifacts/scripts/review-artifacts.sh
```

This sibling layout is part of the contract because source skills, generated
preview skills, and installed skill homes all place skills beside each other.
Generated outputs remain disposable previews and are not source authority.

Resolution order:

1. Use `PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT` when set. It must point to a
   regular executable file.
2. Otherwise derive the logical sibling path from the adapter script's
   `BASH_SOURCE[0]` location.
3. If the logical sibling path is missing, try the physical resolved path for
   symlink install modes where invocation and source locations differ.
4. If no executable validator exists, fail with
   `play-validate-review-artifacts validator missing`.

## Command Surface

The support validator exposes explicit commands and long flags. Adapters may
read their existing environment variables, but shared policy inputs must be
forwarded as flags rather than hidden global state.

Commands:

| Command                     | Consumer surface                          | Contract owned here                                                                                                                                                            |
| --------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `validate-scope-decision`   | `pr-review`, `branch-review`              | Validates scope-decision shape, expected schema/kind/path, Git ranges, derived facts, and escalation policy.                                                                   |
| `validate-prior-threads`    | `pr-review`                               | Validates normalized GitHub prior-thread artifacts and shared review-thread invariants.                                                                                        |
| `validate-diff-anchors`     | `pr-review`                               | Validates that postable inline anchors target right-side lines in the selected review diff.                                                                                    |
| `compare-approved-payload`  | `pr-review` approved-review artifact flow | Regenerates the expected approved-review payload from validated scope and findings inputs and compares it to the supplied payload.                                             |
| `validate-approval-summary` | `branch-review` approval-summary flow     | Validates a `branch-review/approval-summary/v1` artifact, linked scope-decision and findings evidence, counts, digests, reviewed head, and terminal-state gate interpretation. |
| `validate-risk-signals`     | `branch-review` risk-signal handoff       | Validates a `branch-review/risk-signals/v1` artifact from `play-subagent-execution` before branch-review may use it as non-authoritative escalation context.                   |

Every command that validates or consumes a scope decision receives the same
explicit scope-policy inputs, including the surface, immutable head SHA,
scope-decision path, expected schema, prior-context kind and path, governed path
pattern, max narrow changed-file count, and optional configured path pattern.
Scope-consuming commands must not rely on hidden prior validation state.

`pr-review` `validate-scope-decision` calls must pass
`--provider-scope-evidence-file` in addition to the shared scope-policy inputs.
The provider evidence path must also be recorded in
`artifacts.provider_scope_evidence_file` on the scope-decision artifact, with
`artifacts.provider_scope_evidence_sha256` binding the exact evidence bytes.
The evidence artifact must use schema
`pr-review/provider-scope-evidence/v2`, provider `github`, explicit provider
OIDs, provider PR diff-base proof, normalized provider file entries,
normalized local file entries, provider/local diff digests, and
`digest_provenance` with schema `pr-review/digest-provenance/v1`. Digest
provenance must cover `provider_diff`, `local_diff`, `provider_patches`, and
`local_patches`; local digests must be `canonical-git-diff/v1`. The validator
computes canonical Git evidence through the hardened provider-bound Git
executor. That executor uses raw bytes, strips inherited `GIT_CONFIG*`
injection and other Git interpretation environment, disables global/system Git
config and attributes, uses empty explicit order/attributes files, disables and
rejects replacement refs and graft object-graph overrides, rejects local
diff-driver/textconv interpretation that can alter provider evidence, preserves
literal path identity instead of pathspec language, and accepts only valid
UTF-8 JSON path strings without NUL. Because Git always gives repository
`info/attributes` precedence and provides no per-command disable for that
source, non-empty repository `info/attributes` fails closed instead of being
hashed as canonical evidence.

The validator requires `provider_pr_diff_base_sha` to equal the single merge
base derived from provider `baseRefOid` and `headRefOid` under the hardened
provider-bound Git executor. `baseRefOid` remains provider base metadata inside
provider evidence; it is not a substitute for `review_scope_base_ref`,
`REVIEW_SCOPE_BASE_REF`, helper `BASE_REF`, or scope `full_range` base. The
validator requires the full PR range to be
`<provider_pr_diff_base_sha>..<headRefOid>` and rejects moving local base refs
such as `origin/main` or hidden `HEAD` expansion for `pr-review` full-range
proof. `validate-scope-decision` is the authority check for this binding before
review dispatch, and manifest/result/approved-review helpers must delegate to
it or prove the same merge-base authority before accepting artifacts.

The same provider-bound command-family semantics apply to scope and range
consumers that derive or check provider evidence: current/head resolution,
commit/ref existence, merge-base proof, range existence checks, changed-file
listing, `--name-status` metadata, `--numstat` metadata, per-file patch
hashing, full-diff digesting, `validate-diff-anchors` inline anchor hunk
lookup, `compare-approved-payload` approved payload hunk verification, and
relevant follow-up scope or `validate-risk-signals` range consumers. Provider
and local normalized file metadata must match exactly for `path`,
`previous_path`, `status`, `additions`, `deletions`, and `changes`, and local
metadata must match canonical Git evidence for the proven range. When provider
patch evidence is available, both provider and local file entries must set
`patch_available=true`, their `patch_sha256` values must match canonical Git
evidence, and provider/local patch provenance must be compatible. When textual
patch evidence is unavailable for a file, both provider and local entries must
represent that file with `patch_available=false` and `patch_sha256=null` while
metadata still matches.
Provider/local full diff digest mismatch is allowed only when every provider
and local file entry in a non-empty complete changed-file set is represented as
unavailable, provider full-diff provenance is declared
`github-provider-diff/v1`, local full-diff provenance is
`canonical-git-diff/v1`, and the local digest matches canonical Git evidence.
Mixed available/unavailable sets still fail closed on diff digest drift or
incompatible provenance. Stale heads, missing OIDs, missing or incomplete
evidence, missing digest provenance, duplicate file entries, unbound paths,
patch digest drift, file metadata drift, stale shaped
`provider_pr_diff_base_sha` without merge-base proof, replacement/graft
presence, local diff-driver influence, malformed Git machine records, invalid
UTF-8 path evidence, NUL-bearing paths, and provider/local diff identity drift
outside the all-files-unavailable exception fail closed before review dispatch.

Adapters must pass the evidence path as an explicit support-validator flag.
They may prepare that path from their own surface-specific inputs, but adapters
must not satisfy provider evidence through environment variables, default paths,
cached files, or other hidden global state inside the support validator. A
scope decision that references provider evidence without the explicit
`--provider-scope-evidence-file` flag is invalid for `pr-review`.

`validate-approval-summary` requires `--approval-summary-file`, `--head-sha`,
and `--surface branch-review`. Callers that already captured linked evidence
may also pass `--expected-findings-file` and
`--expected-scope-decision-file`; supplied paths must exactly match the paths
embedded in the summary before the linked evidence is trusted. The validator
recomputes approval counts from the linked findings using true-blocking
semantics: `severity: "Blocking"` findings and carry-forward entries count as
blockers only when `critic` is neither `INVALID` nor `DOWNGRADE`; downgraded
blocking entries count as non-blocking feedback for the `approved_with_nits`
path; invalidated blocking entries count as neither blockers nor postable
nits. Callers must also pass the same `--configured-path-pattern` value used
for the linked branch-review scope decision when configured path escalation is
part of that evidence. With `--emit-gate-result`, successful validation prints
one JSON object containing `terminal_state` and `gate_result`, where
`gate_result` is exactly `passing` for `approved` and `approved_with_nits`, and
`blocking` for `blocked` and `invalid`. Without `--emit-gate-result`, callers
rely on the zero exit status. The command rejects non-`branch-review` surfaces,
stale heads, unsafe or missing paths, malformed linked evidence, digest drift,
count drift, terminal-state drift, unknown terminal states, and any
`gate_passed` field.
Consumers must use this validator output for pass/block interpretation rather
than deriving pass/fail from summary fields themselves.

`validate-risk-signals` requires `--surface branch-review`, `--head-sha`,
`--risk-signals-file`, `--expected-schema branch-review/risk-signals/v1`, and
`--expected-reviewed-range`. Successful validation prints no stdout and exits
zero. The command rejects non-branch-review surfaces, unsupported schemas,
unsafe paths or suffixes, stale heads, base-ref/range mismatch, changed-file
drift including duplicate file entries, malformed producer/evidence fields,
missing or extra signal keys, invalid signal values, missing booleans, false
contract-example proof values, and irrelevant scope-only flags such as
`--base-ref` or `--emit-gate-result`.
Adapters consume failures as fail-closed branch-review context; a valid artifact
can only preserve or escalate scrutiny and never authorizes narrow review.
The optional `contract_example_discipline` field is accepted only with the
exact bounded shape produced by `play-subagent-execution`: `present: true`,
`source: "extracted-plan-task-execution-context"`, non-empty `obligations` and
`consumer_rule` strings of at most 4000 characters with no NUL, and exact
`true` `proof_obligations.valid_examples_pass` and
`proof_obligations.invalid_families_fail` fields. Any missing, extra, stale, or
malformed content rejects the artifact.

The validator is runtime-backed through the packaged `devcanon-runtime` support
skill. It may require Node.js through that packaged support runtime, but it must
not require the installed `devcanon` CLI solely to validate review artifacts.

## Failure Contract

On success, validation commands print only their documented stdout, if any, and
exit zero. On failure, they exit nonzero and expose a specific stderr fragment
for known policy failures so adapters and tests can diagnose the rejected
artifact.

Adapters may wrap failures for their existing operator-facing contract, but the
shared failure must remain visible enough for tests and reviewers to identify
the violated invariant.
