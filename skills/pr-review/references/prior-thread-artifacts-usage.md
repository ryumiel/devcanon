# Prior thread artifacts usage

## Role

Prepares and validates prior-thread and scope-decision artifacts, and produces provider-scope evidence from a bound Phase 1 capture.

## Invocation

Run `bash "$PR_REVIEW_DIR/scripts/prior-thread-artifacts.sh"` followed by `prepare-prior-threads-write`, `validate-prior-threads`, `prepare-scope-decision-write`, `prepare-provider-scope-evidence-write`, `materialize-provider-scope-capture`, `write-provider-scope-evidence`, or `validate-scope-decision`.

## Inputs

Every command requires `HEAD_SHA`. `prepare-prior-threads-write`, `prepare-scope-decision-write`, and `prepare-provider-scope-evidence-write` require no further input. `materialize-provider-scope-capture` additionally requires `PR_REPOSITORY`, `PROVIDER_SCOPE_CAPTURE_FILE`, `PROVIDER_SCOPE_CAPTURE_TMP_FILE`, `PROVIDER_SCOPE_CAPTURE_PR_FILE`, `PROVIDER_SCOPE_CAPTURE_FILES_FILE`, and `PROVIDER_SCOPE_CAPTURE_DIFF_FILE`; its canonical capture target is the direct child `.ephemeral/<branch-slug>-<HEAD_SHA>-provider-scope-capture.json`, while its scratch and raw inputs are private regular files. It refuses an existing target without clobbering it, and may leave its private temp output on failure for the owning SKILL trap to remove; the canonical target remains absent or unchanged. `write-provider-scope-evidence` requires `HEAD_SHA` and `PROVIDER_SCOPE_CAPTURE_FILE`. The capture is a readable non-symlink file created in the target review worktree. Its closed `pr-review/provider-scope-capture/v1` object contains only `schema`, `provider`, `repository`, `pr_number`, `baseRefOid`, `headRefOid`, `evidence_complete`, `provider_files`, and `provider_diff`. For non-empty `provider_files`, `patch_base64` availability is uniform: all complete byte-for-byte patches as strict base64, or all `null`; GitHub `files[].patch` hunk fragments are `null`. `provider_diff.dialect` is exactly `canonical-git-diff/v1` or `github-provider-diff/v1`, and its strict base64 is exact raw provider diff bytes. Do not place local metadata, digests, provenance, or merge-base claims in the capture. A prior producer failure leaves the exact capture for retry; reuse it rather than overwriting/refetching. It resolves the sibling packaged `devcanon-runtime` support skill; `DEVCANON_RUNTIME_DIR` is optional for diagnostics. It accepts only the exact one-line `pr-review-provider-scope-evidence` major-1 command contract and forwards the capture directly to its distinct producer route. `validate-prior-threads` requires `PRIOR_THREADS_FILE`. `validate-scope-decision` requires `SCOPE_DECISION_FILE`, `BASE_REF`, and `PROVIDER_SCOPE_EVIDENCE_FILE`; `PRIOR_THREADS_FILE` is optional and changes the expected prior-context pair. When it is absent or unset, validation selects the existing canonical prior-threads artifact, if present, and requires the scope decision's prior-context pair to name it; without that artifact it expects the `none`/`null` pair. `PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT` is optional. No command reads stdin.

## Working directory

Run every command from the target review worktree root.

## Outputs

Each prepare command prints its validated repo-relative destination path; materialization and validation commands are silent on success. `write-provider-scope-evidence` prints exactly the canonical repo-relative `-provider-scope-evidence.json` path plus newline after successful production and capture deletion. Its output is the exact closed `pr-review/provider-scope-evidence/v2` schema with required provider identity, bound base/head/range, completeness, digest provenance, provider/local file arrays, and provider/local full-diff digests. Diagnostics use stderr.

The v2 top-level keys are `schema`, `provider`, `repository`, `pr_number`, `baseRefOid`, `headRefOid`, `provider_pr_diff_base_sha`, `local_review_head_sha`, `full_pr_diff_range`, `evidence_complete`, `digest_provenance`, `provider_files`, `local_files`, `provider_diff_sha256`, and `local_diff_sha256`. `digest_provenance` keys are `schema`, `provider_diff`, `local_diff`, `provider_patches`, and `local_patches`; each provider/local file entry keys are `path`, `status`, `previous_path`, `additions`, `deletions`, `changes`, `patch_sha256`, and `patch_available`.

An empty `provider_files`/`local_files` pair may retain `github-provider-diff/v1` only when its provider full-diff digest equals the canonical local full-diff digest.

## Refusal and failures

Unknown commands, missing metadata, unsafe paths, incompatible or malformed runtime contracts, invalid captures, Git-derived evidence mismatches, or invalid support validation exit nonzero without a success path. The existing prepare-only command remains compatible and does not produce evidence.

## Side effects

Prepare commands create or check `.ephemeral` and prepare destination paths without creating final artifact files; validation commands are read-only. The producer atomically writes and validates the canonical v2 evidence, then deletes exactly its accepted capture. Earlier failures preserve the capture; deletion failure preserves both the valid evidence and capture for retry. It never reads stdin, refetches provider data, or scans `.ephemeral` for cleanup.

## Workflow boundary

[PR review workflow context](../SKILL.md) owns thread interpretation and review scope continuation.
