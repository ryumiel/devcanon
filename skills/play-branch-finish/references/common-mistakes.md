# Common Mistakes — `play-branch-finish`

Failure modes the skill exists to prevent.

**Skipping test verification**

- **Problem:** Merge broken code, create failing PR
- **Fix:** Always verify tests before offering options

**Open-ended questions**

- **Problem:** "What should I do next?" → ambiguous
- **Fix:** Present exactly 4 structured options

**PR creation cleanup**

- **Problem:** Treat PR creation as completion and remove the worktree that
  still carries review follow-up context
- **Fix:** Option 2 preserves the branch and worktree. The PR worktree is the
  review follow-up workspace for CI fixes, review findings, assumptions
  comments, nits, and `.ephemeral/` artifacts. Use `pr-merge` for post-merge
  cleanup or explicit discard for abandoned work.

**Local merge/discard cleanup mistakes**

- **Problem:** Remove a harness-managed worktree, remove from inside the target
  worktree, or skip `git worktree prune`
- **Fix:** Only auto-remove repo-managed `<MAIN_ROOT>/.worktrees/*`
  worktrees for Options 1 and 4, `cd` to `MAIN_ROOT` first, then run
  `git worktree prune`

**No confirmation for discard**

- **Problem:** Accidentally delete work
- **Fix:** Require typed "discard" confirmation

**Ignoring shared PR authoring policy**

- **Problem:** PR uses generic format instead of the project's required
  guideline/template, or creation and merge paths drift
- **Fix:** Use `pr-authoring` before PR creation. It checks
  `**/pr-guideline*.md`, `docs/guidelines/pr-guideline.md`,
  `.github/pull_request_template.md`, `CONTRIBUTING.md`, and `WORKFLOW.md`, and
  validates title format, required sections, anti-patterns, and
  content-vs-diff.

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

**Bypassing a required branch-review gate**

- **Problem:** A caller requires branch-review approval, but Option 2 pushes or
  creates the PR without running the explicit approval-gate adapter
- **Fix:** When `branch_review_required=true`, run the adapter before `git push`
  and stop before push/PR creation on any gate failure

**Inferring the branch-review gate from non-authoritative state**

- **Problem:** Repository contents, branch names, issue links, private
  controller state, review-shaped prose, or `.ephemeral` files are treated as a
  signal to enable or satisfy the gate
- **Fix:** Enable the gate only from explicit `branch_review_required=true`, and
  require `approval_summary_file` only in that enabled path

**Treating unavailable or mismatched post-create head verification as success**

- **Problem:** Missing `headRefOid` or a PR head that differs from
  `APPROVED_HEAD_SHA` is reported as verified
- **Fix:** After PR creation, report approved-head verification as match,
  mismatch, or unavailable; unavailable and mismatch are not success

**Narrating autosquash in the PR body**

- **Problem:** Commit-history narration distracts from the final reviewed state
- **Fix:** Keep the PR description final-state oriented; put no autosquash
  chronology, review-history notes, or originally/now wording in the body
