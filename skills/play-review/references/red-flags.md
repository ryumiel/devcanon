# Red Flags — `play-review`

Behavioral signals that this skill is being violated. They restate the Hard
Rules in `SKILL.md` from a "what does the failure look like" angle.

- You called any `gh` command (`gh pr view`, `gh pr diff`, `gh api`, `gh pr review`) — that's the wrapper's job
- You modified files in `working_directory` other than the `.ephemeral/` findings file or shared review-context file (see § Output and Phase 2.5) — this skill emits findings, not edits
- You created or removed a worktree — the wrapper handles that
- You skipped the Data-safety agent because "there's no security-relevant code"
- You showed findings as a table with file:line but no code snippets
- You used a generic agent prompt without diff-specific file references
- You skipped the critic pass because "findings were straightforward"
- You proceeded with default values when a required input was missing — escalate to the wrapper instead

**All of these mean: STOP. Go back to the workflow.**
