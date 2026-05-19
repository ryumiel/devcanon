# Common Mistakes — `play-branch-finish`

Failure modes the skill exists to prevent.

**Skipping test verification**

- **Problem:** Merge broken code, create failing PR
- **Fix:** Always verify tests before offering options

**Open-ended questions**

- **Problem:** "What should I do next?" → ambiguous
- **Fix:** Present exactly 4 structured options

**Automatic worktree cleanup**

- **Problem:** Remove a harness-managed worktree, remove from inside the
  target worktree, or skip `git worktree prune`
- **Fix:** Only auto-remove repo-managed `<MAIN_ROOT>/.worktrees/*`
  worktrees, `cd` to `MAIN_ROOT` first, then run `git worktree prune`

**No confirmation for discard**

- **Problem:** Accidentally delete work
- **Fix:** Require typed "discard" confirmation

**Ignoring project PR guideline**

- **Problem:** PR uses generic format instead of project's required template
- **Fix:** Always glob for `**/pr-guideline*.md` before composing title/description

**Putting branch-review nits in the description body**

- **Problem:** Nits become locked into the durable description instead of being kept as inline review comments or top-level PR review comments in the Reviews tab
- **Fix:** When a caller passes a `nits_file` arg, post anchorable nits via `gh api repos/.../pulls/<N>/reviews` with `event: "COMMENT"` and unanchorable nits via `gh pr review --comment --body-file -`. The description body stays free of review chatter

**Treating autosquash as default cleanup**

- **Problem:** Rewriting shared, already-pushed, open PR, reviewed, or
  audit-value commits loses useful review/audit context
- **Fix:** Autosquash is opt-in local cleanup only. Skip it unless the branch is
  local, the commit range has `fixup!` or `squash!` markers, and the user gives
  exact affirmative approval

**Skipping the autosquash tree check**

- **Problem:** A rebase conflict resolution or mistaken edit changes the final
  code before push
- **Fix:** Compare the pre-autosquash and post-autosquash trees, and stop before
  push unless the tree is unchanged

**Narrating autosquash in the PR body**

- **Problem:** Commit-history narration distracts from the final reviewed state
- **Fix:** Keep the PR description final-state oriented; put no autosquash
  chronology, review-history notes, or originally/now wording in the body
