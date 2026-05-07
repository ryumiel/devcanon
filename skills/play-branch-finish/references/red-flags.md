# Red Flags — `play-branch-finish`

Behavioral signals that this skill is being violated.

**Never:**

- Proceed with failing tests
- Merge without verifying tests on result
- Delete work without confirmation
- Force-push without explicit request
- Remove a worktree outside `<MAIN_ROOT>/.worktrees/`
- Run `git worktree remove` from inside the target worktree
- Skip `git worktree prune` after removing a repo-managed worktree
- Embed branch-review nits in the PR description body when the caller passed `nits_file` as an input

**Always:**

- Verify tests before offering options
- Present exactly 4 options
- Get typed confirmation for Option 4
- Use provenance-aware cleanup for Options 1, 2, and 4
