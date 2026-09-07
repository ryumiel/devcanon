# Edited-preview recovery

## Role

Use this subordinate route-local guidance only after the main Phase 5 skill has
recognized a body edit, a finding drop or reclassification, or an interruption
after `write-review-body` and before body-publication recovery. Load it before
the first dependent authoring, rebuilding, validation, publication, recovery,
rendering, or result-consumption operation.

The main Phase 5 skill remains authoritative for approval, trusted-current-head
checks, result and lease freshness, manifest/preview ordering, audit failure,
retained-guard disposition, cleanup, and continuation to Phase 6. This
reference grants no provider, posting, approval, cleanup, or recovery authority.
Use the existing public manifest, play-review artifact, and lease owners; do
not inspect helpers or runtime, write governed artifacts directly, or compose
private calls.

## Body edit or interrupted body publication

Author revised review-body Markdown in the caller and pass it to
`write-review-body` with the current `REVIEW_RESULT_FILE`. Rebind
`REVIEW_BODY_FILE` from stdout, then run `recover-review-body-publication` to
bind only the canonical body digest, clear the stale rendered-preview binding,
and mark the result edited before rendering.

If interrupted after `write-review-body` and before that recovery, run
`recover-review-body-publication` first. It revalidates unaffected result
authority before allowing a retry or render. Then render with the same
`REVIEW_HEAD_SHA`, `REVIEW_FINDINGS_FILE`, `REVIEW_SURFACE=pr-review`, and
`REVIEW_BODY_FILE`.

## Dropped or reclassified findings

Author one complete valid-UTF-8 `play-review/findings/v2` replacement envelope
in the caller. Recompute a changed finding's canonical `body` from its final
severity, category, `why`, and `recommendation`, and preserve all other
coherence rules, including `critic: null` for Nit findings. From the target
worktree root, pass that single envelope to the public
`review-manifests.sh replace-findings` command. Its stdout is the canonical
rebound result path: bind it as `REVIEW_RESULT_FILE` and clear
`RENDERED_PREVIEW_FILE`. A refusal stops Phase 5 continuation.

If the findings-publication guard is retained after publication dispatch or an
ambiguous termination, stop and request explicit manual recovery outside
`replace-findings`. Do not reclaim a retained guard or automatically recover a
crash. A successful replacement removes only its own guard after the rebound
result validates.

After a successful replacement, write the review body and run
`recover-review-body-publication` when needed. If the change removes synthesis
support, clear the old synthesis and use one or two concrete narrative sentences
about what the implementation got right; the first nonblank review-body line
must not be `## Root-Cause Synthesis`.

## Re-enter the Phase 5 gate

For an ordinary body edit or successful findings replacement, continue through
existing public owners in this order: `write-review-body`,
`recover-review-body-publication` when needed, `render-review-preview`,
`update_pr_review_result_manifest "edited"`, `gated` lease write with
`PRESENTATION_STATUS="edited"`, then `render-phase5-audit-summary`. For an
already interrupted `write-review-body`, run
`recover-review-body-publication` first before any retry, render, result
update, lease write, or audit; then continue through the remaining applicable
owners in that order. Do not move later owners into `replace-findings`.
Present the re-rendered artifact-backed stdout and the updated result-manifest
notice, then wait for a new explicit approval of that latest preview. Do not
rebuild the preview from conversation text or current checkout state, reuse
approval for the earlier preview, or proceed to Phase 6 before renewed
approval.
