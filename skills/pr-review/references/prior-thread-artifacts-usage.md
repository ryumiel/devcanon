# Prior thread artifacts usage

## Role

Prepares and validates prior-thread and scope-decision artifacts.

## Invocation

Run `bash "$PR_REVIEW_DIR/scripts/prior-thread-artifacts.sh"` followed by `prepare-prior-threads-write`, `validate-prior-threads`, `prepare-scope-decision-write`, `prepare-provider-scope-evidence-write`, or `validate-scope-decision`.

## Inputs

Every command requires `HEAD_SHA`. `prepare-prior-threads-write`, `prepare-scope-decision-write`, and `prepare-provider-scope-evidence-write` require no further input. `validate-prior-threads` requires `PRIOR_THREADS_FILE`. `validate-scope-decision` requires `SCOPE_DECISION_FILE`, `BASE_REF`, and `PROVIDER_SCOPE_EVIDENCE_FILE`; `PRIOR_THREADS_FILE` is optional and changes the expected prior-context pair. When it is absent or unset, validation selects the existing canonical prior-threads artifact, if present, and requires the scope decision's prior-context pair to name it; without that artifact it expects the `none`/`null` pair. `PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT` is optional. No command reads stdin.

## Working directory

Run every command from the target review worktree root.

## Outputs

Each prepare command prints its validated repo-relative destination path; validation commands are silent on success. Diagnostics use stderr.

## Refusal and failures

Unknown commands, missing metadata, unsafe paths, or invalid support validation exits nonzero.

## Side effects

Prepare commands create or check `.ephemeral` and prepare destination paths without creating final artifact files; validation commands are read-only.

## Workflow boundary

[PR review workflow context](../SKILL.md) owns thread interpretation and review scope continuation.
