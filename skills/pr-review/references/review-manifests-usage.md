# Review manifests usage

## Role

Performs deterministic PR-review handoff, result, body, findings, and pre-findings extraction operations.

## Invocation

Run `bash "$PR_REVIEW_DIR/scripts/review-manifests.sh"` followed by exactly one of `prepare-handoff-write`, `write-handoff`, `validate-handoff`, `prepare-result-write`, `write-result`, `validate-result`, `read-result-for-preview`, `read-result-for-baseline`, `write-review-body`, `recover-review-body-publication`, `replace-findings`, `render-phase5-audit-summary`, or `extract-pre-findings-markdown`.

## Inputs

`prepare-handoff-write`, `write-handoff`, `prepare-result-write`, `validate-handoff`, `validate-result`, and `read-result-for-preview` require ambient `PR_NUMBER` and `HEAD_SHA`. `validate-handoff` also requires `REPOSITORY` and `HANDOFF_FILE`; the handoff must carry matching valid identity. `write-handoff` additionally requires `REPOSITORY`, `EXECUTION_WORKING_DIRECTORY`, `BASE_REF`, `HEAD_REF`, `REVIEW_SCOPE_BASE_REF`, `ACTIVE_DIFF_RANGE`, `FULL_PR_DIFF_RANGE`, `MODE`, `LANGUAGE_HINTS_JSON`, `FOLLOW_UP_STATE`, `IS_FOLLOWUP_NARROW`, and `SCOPE_DECISION_FILE`; `PRIOR_THREADS_FILE` and `LAST_REVIEWED_SHA` are optional.

`write-result` requires `PR_NUMBER`, `HEAD_SHA`, `REPOSITORY`, `FINDINGS_FILE`, `SCOPE_DECISION_FILE`, and `PRESENTATION_STATUS`; `PRIOR_THREADS_FILE`, `REVIEW_BODY_FILE`, `CONTEXT_FILE`, `RENDERED_PREVIEW_FILE`, and `PRESENTATION_NOTES` are optional. `validate-result` and `read-result-for-preview` also require `REPOSITORY` and `RESULT_FILE`; the result must carry matching valid identity. `write-review-body` and `recover-review-body-publication` require `REPOSITORY`, `RESULT_FILE`, `PR_NUMBER`, and `HEAD_SHA` so they can require the canonical body path for that exact PR/head pair; `write-review-body` reads Markdown from stdin, while recovery does not. `replace-findings` requires `PR_NUMBER`, `HEAD_SHA`, `REPOSITORY`, `RESULT_FILE`, and `PLAY_REVIEW_HELPER`, reads exactly one complete findings envelope from stdin, and accepts no extra argument. It permits changes only to optional `presentation_overrides`; every canonical evidence field must equal the current artifact bytes authenticated by the result-bound digest. An already-overwritten unbound file requires manual recovery; submitted-digest recovery applies only after this invocation dispatches publication. Unknown/duplicate/INVALID IDs, malformed overrides, and evidence edits fail before publication. `render-phase5-audit-summary` requires `REPOSITORY`, `PR_NUMBER`, `HEAD_SHA`, `RESULT_FILE`, `PRIMARY_REPOSITORY_ROOT`, `WORKTREE_PATH`, and `LEASE_FILE`, and reads no stdin. `extract-pre-findings-markdown` requires no environment input and accepts no extra argument; it reads the complete play-review output from stdin.

`read-result-for-baseline` requires only `REPOSITORY`, positive `PR_NUMBER`,
and `RESULT_FILE`, with no arguments or stdin. Run at the verified same-repository
root containing that existing result. Result and consumed findings/scope files
must be readable regular nonsymlink direct `.ephemeral` children; historical
leaf names and current HEAD equality are not required. It checks existing result
identity, available immutable reviewed commit, valid findings and incomplete
routes, and consumed findings/scope integrity bindings. Presentation, optional
finalization artifacts, approval and lease metadata do not supply coverage.

It returns existing identity, findings, and scope data as JSON for wrapper
interpretation, excluding approval fields. Success establishes neither semantic
completion nor posting authority. Failure requests bounded existing lookup or
owner correction; if coverage remains unestablished use full review, retaining
any unresolved integrity incident. It never writes, rebinds, or scans for files.
The wrapper must reconcile any
independently retained result-level digest with its custody owner before
consumption; this read cannot authenticate a changed result against such an
external binding or replace it with a newly computed digest.
Strict current-result preview/publication operations remain unchanged.

## Working directory

Use the target review worktree root for result and findings operations and the primary repository root for lease-status and primary-repository operations.

## Outputs

It emits validated manifest paths or structured results on stdout and diagnostics on stderr. `extract-pre-findings-markdown` emits the Markdown preceding the first `## Findings` heading, or nothing when the output has no pre-findings text.

## Phase 5 audit retention

`render-phase5-audit-summary` remains read-only and emits the full Markdown
audit on stdout. After it succeeds, the Phase 5 caller saves that exact output
as `.ephemeral/pr-<PR_NUMBER>-<HEAD_SHA>-phase5-audit.md` in the target review
worktree, beside the current result and preview. Use the validated PR number
and trusted review head already supplied to the renderer.

Apply the existing local artifact-write conventions before writing: require a
real nonsymlink `.ephemeral` directory, create it if absent, and require the
computed target to be a direct child with no traversal. Unlink a target symlink
before writing; reject directories and other nonregular existing targets.
Replace the prior audit for this PR/head only after the new render succeeds.
Read back the saved file to confirm it is readable and contains the complete
current output before presenting its absolute local link at the approval gate.
A retention failure stops presentation; report it without using an older audit.

Refresh this file after every successful gated audit render, including edited
previews. It is human-readable local evidence, not a result-manifest field,
approval input, or freshness authority. The caller derives the short summary
from the current validated evidence; review completeness still comes from the
validated findings envelope, not an inference from the audit's counts or
validation status. Existing lease/worktree lifecycle handling owns retention
and cleanup with the other review artifacts. Do not publish this local audit
or its machine-local inventory as GitHub review content.

## Refusal and failures

Unknown operations, malformed stdin, invalid manifests, stale evidence, unsafe paths, unavailable runtime, a pre-findings block whose first non-blank line is a level-2 heading, or an existing findings-publication guard exit nonzero. A retained guard after a failed findings publication requires manual recovery before a later `replace-findings` call.

## Side effects

Write operations update only validated local manifests, artifacts, or result paths; `extract-pre-findings-markdown` writes nothing. `replace-findings` creates a per-result publication guard before reading stdin and invoking publication. It removes that guard when publication did not run or when the result rebinding succeeds; if publication ran but rebinding fails, it intentionally retains the guard for manual recovery.

## Workflow boundary

[PR review workflow context](../SKILL.md) owns review interpretation, approval, and continuation.
