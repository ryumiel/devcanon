# Common Mistakes — `play-branch-finish`

Failure modes the skill exists to prevent.

**Skipping test verification**

- **Problem:** Merge broken code, create failing PR
- **Fix:** Always verify tests before offering options

**Open-ended questions**

- **Problem:** "What should I do next?" → ambiguous
- **Fix:** Present exactly 4 structured options

**Automatic worktree cleanup**

- **Problem:** Remove worktree when might need it (Option 2, 3)
- **Fix:** Only cleanup for Options 1 and 4

**No confirmation for discard**

- **Problem:** Accidentally delete work
- **Fix:** Require typed "discard" confirmation

**Ignoring project PR guideline**

- **Problem:** PR uses generic format instead of project's required template
- **Fix:** Always glob for `**/pr-guideline*.md` before composing title/description

**Putting branch-review nits in the description body**

- **Problem:** Nits become locked into the durable description instead of being resolvable line-anchored review comments
- **Fix:** When a caller passes a `nits_file` arg, post via `gh api repos/.../pulls/<N>/reviews` with `event: "COMMENT"`. The description body stays free of review chatter
