# Phase 7 Review Handling

Use [play-review review-artifacts usage](../../play-review/references/review-artifacts-usage.md)
for `validate-findings` and `prepare-judgment-nits`. This reference owns
Phase 7 classification, reruns, and Phase 8 continuation.

## Review Evidence

After each `branch-review --fix` run, retain that run's immutable review-head,
findings-notice, and candidate-final approval-summary notice as side-channel
evidence. Do not parse human review prose, recompute a prior review head from
current `HEAD`, duplicate the approval-summary schema, or reuse evidence after
a branch-review rerun. Missing final approval-summary evidence stops Phase 8.

## Blocker Stop Rules

`INVALID` findings are ignored; `DOWNGRADE` findings are non-blocking but
judgment-required. Any remaining Blocking finding with another critic result
stops auto mode. Only then may Phase 7 classify remaining Nits.

## Remaining Nit Classification

`branch-review --fix` owns fixable review feedback. Phase 7 passes only subjective
or otherwise judgment-required Nits, plus every `DOWNGRADE`, to Phase 8. A
fixable nit withheld by a proportionality gate remains a non-mutating
judgment-required handoff. Use `nit-classification.md` and
`auto-mode-discipline.md` for the taxonomy and conservative tie-breaker.

## Branch-Review-Owned Fix Commits

Branch Review may group, edit, and commit its fixes. The first Phase 7 pass is
the full-diff `branch-review --fix` route. After a Branch Review fix commit,
the parent workflow invalidates the prior candidate and downstream evidence and
returns through Candidate Closure and Source Freeze. That checkpoint reconciles
the new head, reruns applicable acceptance and full validation, and freezes the
new candidate before Phase 7 uses its existing paired follow-up route with the
validated prior evidence. Preserve base, regenerated risk-signal, and
full-scope facts; prior findings remain non-authorizing context only. Only
newly discovered concrete source evidence may reopen remediation; Phase 7 never
applies a post-mutation veto.

Continue until the final run has no true Blocking finding, no new auto-fixed
blocker, and fresh final approval-summary evidence after branch-review-owned fix
commits.

## Judgment-Required Nits Envelope

When selected items remain, resolve the installed `play-review` bundle and use
its exact local help projection before preparing the handoff:

Resolve the remaining Bash-only helper through the sibling passive runtime;
never use ambient `bash` on native Windows. POSIX command shape:

```bash
PLAY_REVIEW_DIR="<installed-play-review-skill-bundle>"
DEVCANON_RUNTIME_BUNDLE="$PLAY_REVIEW_DIR/../devcanon-runtime"
VERIFIED_BASH="$(node "$DEVCANON_RUNTIME_BUNDLE/scripts/resolve-bash.mjs")"
"$VERIFIED_BASH" "$PLAY_REVIEW_DIR/scripts/review-artifacts.sh" --help
```

Native PowerShell command shape:

```powershell
$PlayReviewDir = "<installed-play-review-skill-bundle>"
$RuntimeBundle = Join-Path (Split-Path $PlayReviewDir) "devcanon-runtime"
$VerifiedBash = node (Join-Path $RuntimeBundle "scripts/resolve-bash.mjs")
if ($LASTEXITCODE -ne 0 -or $VerifiedBash.Count -ne 1) { throw "Git Bash resolution failed" }
& $VerifiedBash (Join-Path $PlayReviewDir "scripts/review-artifacts.sh") --help
if ($LASTEXITCODE -ne 0) { throw "review-artifacts help failed" }
```

Then use `prepare-judgment-nits` through that usage contract. An empty selection
is controller-owned: omit `nits_file` rather than calling the helper. Leave
source files unchanged during this handoff.

## Phase 8 Handoff

Pass the produced `nits_file` to `play-branch-finish` Option 2 only when it
exists. Phase 8 begins only after the final-run conditions above; manual
operators decide nits case by case.
