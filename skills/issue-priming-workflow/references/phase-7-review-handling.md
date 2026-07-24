# Phase 7 Review Handling

Detailed `issue-priming-workflow` Phase 7 mechanics live here so the eager
workflow prompt can keep only orchestration and hard stops loaded by default.
Load this reference before classifying remaining findings, checking
branch-review-owned fix commit reruns, or preparing the Phase 8 `nits_file`.

## Review Artifact Parsing

After each `branch-review --fix` run, parse these exact notice lines from that
run:

- `Review head: <40-hex-sha>.`
- `Findings written to <path>.`

Use the immutable review head from the notice line as `HEAD_SHA` when reading
that run's findings. Do not recompute from current `HEAD`; `branch-review --fix`
may have committed auto-fixes after the findings file was created. Resolve
`PLAY_REVIEW_HELPER` to the installed `play-review/scripts/review-artifacts.sh`
helper and validate the findings path before reading the envelope.

Do not re-parse human-readable review markdown. The side-channel
`play-review/findings/v2` envelope is the consumer contract.

Once a run is candidate-final because all Phase 7 blocker, nit, and rerun
criteria are satisfied, also capture the approval-summary path from the exact
`Approval summary written to <path>.` notice emitted by that same run. Do not
parse approval-summary JSON fields, duplicate branch-review's
`branch-review/approval-summary/v1` schema, or reinterpret approval state here.
Branch-review owns producing and validating that artifact. Phase 7 owns
carrying the final notice path forward as handoff evidence.

Do not reuse an approval-summary path captured from an earlier branch-review
run. Approval-summary notice paths are final-run-only; any branch-review-owned
fix commit or other rerun invalidates earlier approval-summary paths for Phase
8 handoff. A missing final approval-summary notice is a hard stop before Phase 8.

## Blocker Stop Rules

Check remaining `findings[]` before nit classification.

- `critic: "INVALID"` findings are critic-rejected false positives. Ignore
  them for continuation and do not pass them to Phase 8.
- `critic: "DOWNGRADE"` findings are valid non-blocking feedback. They do not
  stop auto mode, but when selected for Phase 8 they are judgment-required nits.
- Any remaining `severity: "Blocking"` finding whose critic is neither
  `INVALID` nor `DOWNGRADE` stops `--auto`; surface those findings to the user.

Only continue to nit handling when every remaining finding is a Nit, a
`DOWNGRADE`, or an `INVALID`.

## Remaining Nit Classification

Use the final `branch-review --fix` findings envelope to identify which
`severity: "Nit"` findings still require judgment and therefore belong in the
Phase 8 `nits_file`. Fixable feedback is branch-review-owned and should have
been handled, removed, or left as judgment-required by `branch-review --fix`
before this workflow prepares the handoff.

- Fixable: a 1-3 line source change with one obvious correct fix, such as a
  typo, broken sentence with one reconstruction, or dead cross-reference.
  Branch-review owns resolving this class when `--fix` can do so.
- Judgment-required: subjective wording, structural suggestions, multiple
  plausible fixes, or anything else where a competent reviewer could defend
  more than one answer. Only this class is selected for Phase 8.

Treat every `critic: "DOWNGRADE"` finding as judgment-required without
fixing. Use `references/nit-classification.md` for the full taxonomy and
`references/auto-mode-discipline.md` for the conservative tie-breaker.

## Branch-Review-Owned Fix Commits

`branch-review --fix` owns fixable review feedback, including objectively
fixable nit-severity findings. Branch-review may group, edit, and commit those
fixes according to its own source contract before it emits the final findings
and approval-summary notices that this workflow consumes.

For fixed nit-severity findings, branch-review-owned fix commit bodies include
one trailer per addressed nit:

```text
Reported by branch-review at <path>:<line>
```

If `branch-review --fix` creates any fix commit, rerun `branch-review --fix` on
the new `HEAD` and restart Phase 7. Continue until a run reports zero blocking
findings auto-fixed, no unresolved true Blocking findings, captures that final
run's approval-summary notice path, and carries fresh final approval-summary
evidence after branch-review-owned fix commits.

## Judgment-Required Nits Envelope

For judgment-required nits and downgraded findings that remain after the final
branch-review run, leave source files unchanged and prepare a Phase 8 nits
envelope through the `play-review` helper. The controller supplies selected
`.findings[]` indexes after classification.

Invoke the helper command `prepare-judgment-nits` with:

- `HEAD_SHA`: immutable review head from the `Review head` notice.
- `FINDINGS_FILE`: validated findings path from the `Findings written to`
  notice.
- `JUDGMENT_REQUIRED_FINDING_INDEXES`: comma-separated zero-based indexes for
  selected judgment-required findings.

The helper validates the findings envelope, rejects unresolved true blockers,
rejects selected `INVALID` findings, preserves selected ordinary Nits,
normalizes selected `DOWNGRADE` copies to postable Nit form, writes the derived
`-nits-pending.json` envelope, and prints only the repo-relative nits path.

If the judgment-required set is empty, skip the helper and omit `nits_file`.
Empty selection is controller-owned; do not invoke the helper with an empty
index list.

## Phase 8 Handoff

Phase 8 receives only judgment-required items that remain after the final
branch-review run. Pass the helper-produced
`nits_file` to `play-branch-finish` Option 2 when present. Omit `nits_file`
when no judgment-required nits remain.

Phase 8 may start only after the final Phase 7 review run satisfies all of
these conditions:

- zero blocking findings auto-fixed in that final run;
- no unresolved remaining Blocking findings except `INVALID` or `DOWNGRADE`;
- final approval-summary notice path captured from that same final run;
- fresh final approval-summary evidence after any branch-review-owned fix
  commits.

Manual operators decide nit handling case by case; this reference's automatic
classification and helper handoff are for `--auto` only.
