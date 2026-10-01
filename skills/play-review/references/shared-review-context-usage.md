# Shared review context usage

## Role

Writes and builds bounded shared review-context artifacts, then creates or validates their read-only family binding.

## Invocation

Run `bash "$PLAY_REVIEW_DIR/scripts/shared-review-context.sh" write-review-context-input|build-review-context|create-family-binding|validate-family-binding`.

## Inputs

`write-review-context-input` requires `HEAD_SHA`, `FINDINGS_FILE`, and `REVIEW_CONTEXT_INPUT_JSON`, a JSON `play-review/shared-context-input/v1` manifest; it derives and writes the `-review-context-input.json` path. `build-review-context` requires `HEAD_SHA`, `FINDINGS_FILE`, and `REVIEW_CONTEXT_INPUT_FILE`, which must be that canonical input path; it derives and writes the paired `-review-context.md` path. Both take no stdin; `DEVCANON_RUNTIME_DIR` is an optional runtime override.

`create-family-binding` requires `HEAD_SHA`, `FINDINGS_FILE`, `REVIEW_CONTEXT_INPUT_FILE`, and `REVIEW_CONTEXT_OUTPUT_FILE`. Pass the **original exact paths returned** by the write and build operations. `validate-family-binding` requires those same inputs and `REVIEW_CONTEXT_FAMILY_JSON`, the exact serialized supplied five-field family. The runtime checks the physical repository root, input header/head, canonical path association, regular files, rendered context equality, closed member set, and exact-byte SHA-256 digests. Neither operation takes stdin or writes files.

## Working directory

Run from the target repository root.

## Outputs

Write/build print the resulting repo-relative path. Create/validate print one canonical JSON `play-review/shared-context-family/v1` value with exactly `schema`, `input_file`, `input_sha256`, `context_file`, and `context_sha256`. Retain each returned path unchanged; consumers do not reconstruct paired paths from a filename convention.

## Refusal and failures

Unknown commands, missing runtime, malformed inputs, unsafe or nonregular artifact paths, wrong root/head, noncanonical or swapped paths, unknown/duplicate/missing family members, and digest mismatch exit nonzero with diagnostic stderr and no usable stdout. Validation does not repair an artifact.

## Side effects

Only successful write/build commands write their validated `.ephemeral` input or context artifact. Binding creation and validation are read-only.

## Workflow boundary

[Play review workflow context](../SKILL.md) owns reviewer routing and use of the context.
