# Red Flags — `play-branch-finish`

Behavioral signals that this skill is being violated.

**Never:**

- Proceed with failing tests
- Merge without verifying tests on result
- Delete work without confirmation
- Force-push without explicit request
- Embed branch-review nits in the PR description body when the caller passed `nits_file` as an input

**Always:**

- Verify tests before offering options
- Present exactly 4 options
- Get typed confirmation for Option 4
- Clean up worktree for Options 1 & 4 only
