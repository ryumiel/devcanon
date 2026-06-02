# Phase 7 Review Handling

Detailed `issue-priming-workflow` Phase 7 mechanics live here so the eager
workflow prompt can keep only orchestration and hard stops loaded by default.
Load this reference before classifying remaining findings, fixing mechanical
nits, or preparing the Phase 8 `nits_file`.

## Review Artifact Parsing

After `branch-review --fix`, parse two exact notice lines from that run:

- `Review head: <40-hex-sha>.`
- `Findings written to <path>.`

Use the immutable review head from the notice line as `HEAD_SHA` when reading
that run's findings. Do not recompute from current `HEAD`; `branch-review --fix`
may have committed auto-fixes after the findings file was created. Resolve
`PLAY_REVIEW_HELPER` to the installed `play-review/scripts/review-artifacts.sh`
helper and validate the findings path before reading the envelope.

Do not re-parse human-readable review markdown. The side-channel
`play-review/findings/v1` envelope is the consumer contract.

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

## Nit Classification

Classify each `severity: "Nit"` finding as mechanical or judgment-required
using the finding's JSON fields, especially `severity`, `category`, `why`, and
`recommendation`.

- Mechanical: a 1-3 line source change with one obvious correct fix, such as a
  typo, broken sentence with one reconstruction, or dead cross-reference.
- Judgment-required: subjective wording, structural suggestions, multiple
  plausible fixes, or anything else where a competent reviewer could defend
  more than one answer.

Treat every `critic: "DOWNGRADE"` finding as judgment-required without
mechanical auto-fix. Use `references/nit-classification.md` for the full
taxonomy and `references/auto-mode-discipline.md` for the conservative
tie-breaker and reclassification escape.

## Mechanical Nit Commits

Fix mechanical nits in the worktree and commit them before Phase 8. Use the
project's commit guideline when present; otherwise use conventional-commit
style.

Each mechanical-nit commit body must include one footer per addressed nit:

```text
Reported by branch-review at <path>:<line>
```

Multiple mechanical nits in the same file and scope may be grouped when every
included nit has one obvious fix. Re-read the target file from disk before each
edit; implementer snapshots from Phase 6 are stale after per-task review,
`branch-review --fix`, or earlier mechanical-nit commits.
`skills/play-subagent-execution/references/snapshot-consumption.md` §
Edit-Staleness Rule restates the same constraint for the per-task path.

If any mechanical-nit commit is made, rerun `branch-review --fix` on the new
`HEAD` and restart Phase 7. Continue until a run reports zero blocking findings
auto-fixed, no unresolved true Blocking findings, and no additional mechanical
nit commits after that review.

## Judgment-Required Nits Envelope

For judgment-required nits and downgraded findings, leave source files
unchanged and prepare a Phase 8 nits envelope through the `play-review` helper.
The controller supplies selected `.findings[]` indexes after classification.

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

Phase 8 receives only judgment-required items. Pass the helper-produced
`nits_file` to `play-branch-finish` Option 2 when present. Omit `nits_file`
when no judgment-required nits remain.

Phase 8 may start only after the final Phase 7 review run satisfies all of
these conditions:

- zero blocking findings auto-fixed in that final run;
- no unresolved remaining Blocking findings except `INVALID` or `DOWNGRADE`;
- no mechanical-nit commit after that final review.

Manual operators decide nit handling case by case; this reference's automatic
classification and helper handoff are for `--auto` only.
