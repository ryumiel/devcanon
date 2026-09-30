# Phase 7 Review Handling

Use [play-review review-artifacts usage](../../play-review/references/review-artifacts-usage.md)
for `validate-findings` and `prepare-judgment-nits`. This reference owns
Phase 7 classification, reruns, and Phase 8 continuation.

The review-artifacts helper remains Bash-only. Before the first
`validate-findings` operation, resolve the installed `play-review` bundle and
the sibling passive runtime, invoke the helper's exact local `--help`, and reuse
the same verified Bash executable for every later review-artifacts operation.
Never use ambient `bash` on native Windows.

POSIX command shape:

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

Under findings/v3, `branch-review --fix` may fix only individually eligible
blockers under the shared review contract. Selected claims require verified
VALID evidence; ordinary claims may qualify only with the contract's current,
fresh, complete-review, exact-authority, and trigger-recheck predicates. Every
remaining Nit is report-only, including typos, unambiguous broken links, and
other apparently mechanical corrections; every `DOWNGRADE` is also nonblocking
handoff feedback. Phase 7 passes all of them through the existing `nits_file`
handoff to Phase 8, not only subjective findings. Verification-based exclusion
and proportionality withholding never make a nit disappear or authorize a
caller-owned fix. Findings and `--fix` do not establish authority.
Use `nit-classification.md` and `auto-mode-discipline.md` to describe the
feedback, not to grant mutation eligibility or filter ordinary nits out.

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

## Remaining Nits Envelope

Select every remaining Nit and DOWNGRADE for the existing handoff; exclude
INVALID findings and stop on true blockers first. The helper’s historical
`prepare-judgment-nits` name does not narrow that selection to subjective nits.
Use its v3 selection pool: current findings followed by carried entries with
previously unseen IDs. Include carried-only nits once and preserve their original
assessment provenance.
When selected items remain, reuse the installed `play-review` bundle and the
verified Bash executable established before validation. Then use
`prepare-judgment-nits` through the owning usage contract with that executable.
An empty selection is controller-owned: omit `nits_file` rather than calling
the helper. Leave source files unchanged during this handoff.

## Phase 8 Handoff

Pass the produced `nits_file` to `play-branch-finish` Option 2 only when it
exists. Phase 8 begins only after the final-run conditions above; manual
operators decide nits case by case.
