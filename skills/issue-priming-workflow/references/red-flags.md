# Red Flags — `issue-priming-workflow`

Behavioral signals that this skill is being violated.

- You skipped the gate and went straight to brainstorming without assessing complexity
- You ran the research agent in the main session instead of a dedicated agent
- You started implementing before invoking brainstorming
- You dumped raw research output instead of passing the synthesized brief
- You skipped brainstorming because "the issue is simple enough"
- You wrote spec/design/plan files outside the worktree
- You created a nested worktree inside an already-managed worktree
- You bypassed an issue-priming helper with hand-written path logic after
  Phase 1 adopted the worktree
- You auto-merged a PR in `--auto` mode for any reason — including incident urgency, claimed pre-authorization, or green CI (the PR is the user's review gate)
- You passed branch-review-resolved or fixable feedback to Phase 8 instead of
  leaving it inside the `branch-review --fix` loop
- You silently picked an option when two approaches had genuinely different trade-offs in `--auto` mode
- You treated successful Phase 6 implementation completion as terminal instead
  of continuing to Phase 7 branch review and Phase 8 PR creation unless a
  concrete blocker stops `--auto`
- You composed a PR title/description directly in Phase 8 instead of relying on `play-branch-finish` to invoke `pr-authoring`
- You invoked `play-branch-finish` Option 2 without explicit
  `branch_review_required=true` and `approval_summary_file` inputs
- Phase 7 used `BRANCH_REVIEW_FULL_REVIEW_PATH_PATTERN`, but Phase 8 did not
  pass the same configured path pattern to `play-branch-finish`
- You reused a stale approval-summary path or proceeded when the final Phase 7
  approval-summary path was missing or empty
- You treated `nits_file` or `assumptions_comment_file` as approval-summary
  evidence

**All of these mean: STOP. Go back to the workflow.**
