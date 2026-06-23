# Phase 8 PR Handoff Reference

Load this reference when `issue-priming-workflow` reaches Phase 8 and is ready
to invoke `play-branch-finish` Option 2. `SKILL.md` remains the eager authority
for Phase 7 completion criteria, the no-auto-merge hard stop, branch/worktree
preservation, and the handoff arguments.

## Boundary Decisions

Phase 8 changes from workflow-owned review completion to downstream-owned PR
creation.

- `issue-priming-workflow` owns when Phase 8 may start and which arguments are
  passed to `play-branch-finish`.
- `play-branch-finish` owns approval-gate validation, push, `gh pr create`,
  assignee translation, post-creation assumptions comments, post-creation nit
  review comments, and branch/worktree preservation after PR creation.
- `play-validate-review-artifacts` owns approval-summary interpretation when
  `play-branch-finish` Option 2 receives an explicit review gate.
- `pr-authoring` owns PR title/body composition and validation through
  `play-branch-finish` Option 2.
- `scripts/write-assumptions-comment.sh` owns assumptions comment path
  preparation and deterministic path guards.
- Phase 7 owns selecting judgment-required remaining findings and preparing any
  `nits_file`.

Do not move these responsibilities across boundaries for prompt-size reasons.
If a future design creates or changes a boundary, record the owner, contract
surface, and non-owner responsibilities in source prose or tests.

## PR Creation Handoff

Invoke `play-branch-finish` Option 2 in `--auto` mode. Do not merge. The PR is
the user's review gate, and PR creation preserves the branch and worktree for
review, CI, and follow-up fixes until `pr-merge` performs post-merge cleanup or
the operator explicitly discards the work.

Always pass `assignee=@me` to `play-branch-finish` Option 2. The parent
workflow owns this handoff argument. `play-branch-finish` owns the GitHub side
effect and translates that input into the assignee behavior needed for
`gh pr create`.

Always pass `branch_review_required=true`, and pass the final Phase 7
approval-summary path as `approval_summary_file`. If that final
approval-summary path is absent or empty, stop before invoking
`play-branch-finish`. If Phase 7 branch-review used
`BRANCH_REVIEW_FULL_REVIEW_PATH_PATTERN`, pass that same configured path
pattern through to `play-branch-finish` Option 2. Phase 8 does not validate
approval-summary JSON, parse approval-summary fields, or duplicate
`play-branch-finish` or `play-validate-review-artifacts` gate semantics. Its
responsibility is limited to requiring the final Phase 7 path to exist in
controller state and passing it, plus any configured path pattern used by the
linked scope evidence, as explicit Option 2 input.

## PR Title and Body

Do not compose PR titles or descriptions directly in Phase 8. Before `gh pr
create`, rely on `play-branch-finish` Option 2 to invoke `pr-authoring` in
`compose` mode.

`pr-authoring` reads project PR guideline/template surfaces and validates title
format, required sections, anti-patterns, and content-vs-diff before PR
creation. It owns both project-specific guideline handling and default fallback
title/body structure; `issue-priming-workflow` must not duplicate fallback PR
defaults.

The description body must contain only durable final-state content accepted by
`pr-authoring`. Do not embed auto-mode assumptions, unaddressed review nits,
commit-by-commit changelogs, "originally / now" chronology, "Notes from
review" sections, or any logbook content.

## Assumptions

When Phase 4 made reasonable auto-mode assumptions that reviewers need to see,
write only those resolved, reviewer-relevant assumptions to the
`assumptions_comment_file` prepared by
`scripts/write-assumptions-comment.sh`, then pass that path to
`play-branch-finish`.

If there are no auto-mode assumptions to surface, omit
`assumptions_comment_file` entirely. Absence means "no assumptions comment,"
not an error.

Ambiguous decisions still stop `--auto` and ask the user. Do not downgrade an
unresolved ambiguity into an assumptions comment, and do not embed assumptions
in the PR description.

`approval_summary_file` is not a nits envelope or assumptions comment. Do not
use `assumptions_comment_file` as approval-summary evidence.

## Nits

Pass `nits_file` only when Phase 7 prepared a judgment-required-nits envelope
from findings that remained after the final branch-review run. The value is the
repo-relative path to the envelope Phase 7 wrote, with schema and side-channel
transport owned by `skills/play-review/SKILL.md` and preparation owned by
`references/phase-7-review-handling.md`.

If Phase 7 produced no judgment-required nits, omit `nits_file` entirely.
`play-branch-finish` skips post-creation nit posting when the input is absent.

Do not pass branch-review-resolved fixable feedback to Phase 8. Do not pass
`critic: "INVALID"` findings. Do not classify findings in Phase 8. Remaining
judgment-required nits are routed to `play-branch-finish` and posted as PR
review comments after PR creation; they must not be embedded in the PR
description body.

`approval_summary_file` is separate from `nits_file`; do not use `nits_file`
as approval-summary evidence, and do not conflate review approval with
judgment-required nit posting.
