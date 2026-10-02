# Prior thread artifacts usage

## Role

Prepares and validates prior-thread and scope-decision artifacts, owns the provider-capture scratch lifecycle and capture classification, produces provider-scope evidence from a bound Phase 1 capture, and renders the Phase 4 scope notice.

## Invocation

Run `bash "$PR_REVIEW_DIR/scripts/prior-thread-artifacts.sh"` followed by `prepare-prior-threads-write`, `validate-prior-threads`, `prepare-scope-decision-write`, `prepare-provider-scope-evidence-write`, `create-provider-scope-scratch`, `remove-provider-scope-scratch <scratch-dir>`, `reconcile-provider-scope-fetch <scratch-dir>`, `materialize-provider-scope-capture`, `classify-provider-scope-capture`, `write-provider-scope-evidence`, `read-provider-scope-evidence-field --field <name>`, `render-scope-notice`, or `validate-scope-decision`.

## Inputs

Every command requires `HEAD_SHA` except `create-provider-scope-scratch`, `remove-provider-scope-scratch`, `reconcile-provider-scope-fetch`, `read-provider-scope-evidence-field`, and `render-scope-notice`. `prepare-prior-threads-write`, `prepare-scope-decision-write`, and `prepare-provider-scope-evidence-write` require no further input. `materialize-provider-scope-capture` additionally requires `PR_REPOSITORY`, `PROVIDER_SCOPE_CAPTURE_FILE`, `PROVIDER_SCOPE_CAPTURE_TMP_FILE`, `PROVIDER_SCOPE_CAPTURE_PR_FILE`, `PROVIDER_SCOPE_CAPTURE_FILES_FILE`, and `PROVIDER_SCOPE_CAPTURE_DIFF_FILE`; its canonical capture target is the direct child `.ephemeral/<branch-slug>-<HEAD_SHA>-provider-scope-capture.json`, while its scratch and raw inputs are private regular files. It refuses an existing target without clobbering it, and may leave its private temp output on failure for the owning SKILL trap to remove; the canonical target remains absent or unchanged. `write-provider-scope-evidence` requires `HEAD_SHA` and `PROVIDER_SCOPE_CAPTURE_FILE`. The capture is a readable non-symlink file created in the target review worktree. Its closed `pr-review/provider-scope-capture/v1` object contains only `schema`, `provider`, `repository`, `pr_number`, `baseRefOid`, `headRefOid`, `evidence_complete`, `provider_files`, and `provider_diff`. For non-empty `provider_files`, `patch_base64` availability is uniform: all complete byte-for-byte patches as strict base64, or all `null`; GitHub `files[].patch` hunk fragments are `null`. `provider_diff.dialect` is exactly `canonical-git-diff/v1` or `github-provider-diff/v1`, and its strict base64 is exact raw provider diff bytes. Do not place local metadata, digests, provenance, or merge-base claims in the capture. A prior producer failure leaves the exact capture for retry; reuse it rather than overwriting/refetching. It resolves the sibling packaged `devcanon-runtime` passive runtime support bundle; `DEVCANON_RUNTIME_DIR` is optional for diagnostics. It accepts only the exact one-line `pr-review-provider-scope-evidence` major-1 command contract and forwards the capture directly to its distinct producer route. `create-provider-scope-scratch` takes no argument and no further input. `remove-provider-scope-scratch` and `reconcile-provider-scope-fetch` each take exactly one scratch directory path and no further input; the path must be a direct `.ephemeral` child whose leaf begins with `provider-scope-capture.`, and `reconcile-provider-scope-fetch` reads `pr.json` and `recheck.json` from inside it. `classify-provider-scope-capture` requires `HEAD_SHA`, `PROVIDER_SCOPE_CAPTURE_FILE`, `PR_BASE_OID`, `PR_REPOSITORY`, and `PR_NUMBER`. `read-provider-scope-evidence-field` requires `PROVIDER_SCOPE_EVIDENCE_FILE` and exactly one `--field` of `provider_pr_diff_base_sha` or `full_pr_diff_range`. `render-scope-notice` requires only `REVIEW_SCOPE_DECISION_FILE` and accepts any readable path for it. `validate-prior-threads` requires `PRIOR_THREADS_FILE`. `validate-scope-decision` requires `SCOPE_DECISION_FILE`, `BASE_REF`, and `PROVIDER_SCOPE_EVIDENCE_FILE`; `PRIOR_THREADS_FILE` is optional and changes the expected prior-context pair. When it is absent or unset, validation selects the existing canonical prior-threads artifact, if present, and requires the scope decision's prior-context pair to name it; without that artifact it expects the `none`/`null` pair. `PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT` is optional. No command reads stdin.

## Working directory

Run every command from the target review worktree root, except `render-scope-notice`, which reads only its bound scope-decision path and does not require a repository root.

## Outputs

Each prepare command prints its validated repo-relative destination path; materialization and validation commands are silent on success. `create-provider-scope-scratch` prints the fresh repo-relative scratch directory path plus newline; `remove-provider-scope-scratch` and `reconcile-provider-scope-fetch` are silent. `classify-provider-scope-capture` is silent and reports through exit status only: 0 when the capture binds this provider, repository, PR, base, and head; 2 when it is well formed but stale; 3 when it is unreadable, malformed, or unclassifiable. `read-provider-scope-evidence-field` prints the requested field value plus newline. `render-scope-notice` prints exactly `PR review scope: mode=..., selection=..., selected files=.... Review is continuing.` and never echoes changed-file text. `write-provider-scope-evidence` prints exactly the canonical repo-relative `-provider-scope-evidence.json` path plus newline after successful production and capture deletion. Its output is the exact closed `pr-review/provider-scope-evidence/v2` schema with required provider identity, bound base/head/range, completeness, digest provenance, provider/local file arrays, and provider/local full-diff digests. Diagnostics use stderr.

The v2 top-level keys are `schema`, `provider`, `repository`, `pr_number`, `baseRefOid`, `headRefOid`, `provider_pr_diff_base_sha`, `local_review_head_sha`, `full_pr_diff_range`, `evidence_complete`, `digest_provenance`, `provider_files`, `local_files`, `provider_diff_sha256`, and `local_diff_sha256`. `digest_provenance` keys are `schema`, `provider_diff`, `local_diff`, `provider_patches`, and `local_patches`; each provider/local file entry keys are `path`, `status`, `previous_path`, `additions`, `deletions`, `changes`, `patch_sha256`, and `patch_available`.

An empty `provider_files`/`local_files` pair may retain `github-provider-diff/v1` only when its provider full-diff digest equals the canonical local full-diff digest.

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

## Refusal and failures

Unknown commands, missing metadata, unsafe paths, incompatible or malformed runtime contracts, invalid captures, Git-derived evidence mismatches, or invalid support validation exit nonzero without a success path. The existing prepare-only command remains compatible and does not produce evidence.

## Side effects

Prepare commands create or check `.ephemeral` and prepare destination paths without creating final artifact files; validation, classification, field-read, and scope-notice commands are read-only. `create-provider-scope-scratch` creates one fresh private directory under `.ephemeral`; `remove-provider-scope-scratch` removes exactly the given scratch directory and succeeds when it is already absent, refusing any path outside `.ephemeral` or any non-directory. The producer atomically writes and validates the canonical v2 evidence, then deletes exactly its accepted capture. Earlier failures preserve the capture; deletion failure preserves both the valid evidence and capture for retry. It never reads stdin, refetches provider data, or scans `.ephemeral` for cleanup.

## Workflow boundary

[PR review workflow context](../SKILL.md) owns thread interpretation and review scope continuation.
