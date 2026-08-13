# Prior thread artifacts usage

## Role

Prepares and validates prior-thread and scope-decision artifacts, and produces provider-scope evidence from a bound Phase 1 capture.

## Invocation

Run `bash "$PR_REVIEW_DIR/scripts/prior-thread-artifacts.sh"` followed by `prepare-prior-threads-write`, `validate-prior-threads`, `prepare-scope-decision-write`, `prepare-provider-scope-evidence-write`, `write-provider-scope-evidence`, or `validate-scope-decision`.

## Inputs

Every command requires `HEAD_SHA`. `prepare-prior-threads-write`, `prepare-scope-decision-write`, and `prepare-provider-scope-evidence-write` require no further input. `write-provider-scope-evidence` additionally requires `PROVIDER_SCOPE_CAPTURE_FILE`: exactly `.ephemeral/<branch-slug>-<HEAD_SHA>-provider-scope-capture.json`, a readable non-symlink file created in the target review worktree. Its closed `pr-review/provider-scope-capture/v1` object contains only `schema`, `provider`, `repository`, `pr_number`, `baseRefOid`, `headRefOid`, `evidence_complete`, `provider_files`, and `provider_diff`. Each complete provider file record has metadata plus `patch_base64`, which is `null` for GitHub `files[].patch` hunk fragments; set it only when complete byte-for-byte per-file diff bytes were extracted from the authoritative full diff. `provider_diff` has an allowed dialect and strict base64 of exact raw provider diff bytes. Do not place local metadata, digests, provenance, or merge-base claims in the capture. A prior producer failure leaves the exact capture for retry; reuse it rather than overwriting/refetching. A failed terminal materialization removes only its exact private scratch and may be retried. It resolves the sibling packaged `devcanon-runtime` support skill (or `DEVCANON_RUNTIME_DIR` for diagnostics), accepts only the exact one-line `pr-review-provider-scope-evidence` major-1 command contract, and forwards the capture directly to its distinct producer route. `validate-prior-threads` requires `PRIOR_THREADS_FILE`. `validate-scope-decision` requires `SCOPE_DECISION_FILE`, `BASE_REF`, and `PROVIDER_SCOPE_EVIDENCE_FILE`; `PRIOR_THREADS_FILE` is optional and changes the expected prior-context pair. When it is absent or unset, validation selects the existing canonical prior-threads artifact, if present, and requires the scope decision's prior-context pair to name it; without that artifact it expects the `none`/`null` pair. `PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT` is optional. No command reads stdin.

## Working directory

Run every command from the target review worktree root.

## Outputs

Each prepare command prints its validated repo-relative destination path; validation commands are silent on success. `write-provider-scope-evidence` prints exactly the canonical repo-relative `-provider-scope-evidence.json` path plus newline after successful production and capture deletion. Diagnostics use stderr.

## Refusal and failures

Unknown commands, missing metadata, unsafe paths, incompatible or malformed runtime contracts, invalid captures, Git-derived evidence mismatches, or invalid support validation exit nonzero without a success path. The existing prepare-only command remains compatible and does not produce evidence.

## Side effects

Prepare commands create or check `.ephemeral` and prepare destination paths without creating final artifact files; validation commands are read-only. The producer atomically writes and validates the canonical v2 evidence, then deletes exactly its accepted capture. Earlier failures preserve the capture; deletion failure preserves both the valid evidence and capture for retry. It never reads stdin, refetches provider data, or scans `.ephemeral` for cleanup.

## Workflow boundary

[PR review workflow context](../SKILL.md) owns thread interpretation and review scope continuation.
