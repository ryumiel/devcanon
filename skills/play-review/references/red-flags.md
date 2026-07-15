# Red Flags — `play-review`

Behavioral signals that this skill is being violated. They restate the Hard
Rules in `SKILL.md` from a "what does the failure look like" angle.

- You called any `gh` command (`gh pr view`, `gh pr diff`, `gh api`, `gh pr review`) — that's the wrapper's job
- You modified files in `working_directory` other than the direct-child `.ephemeral/` findings file, review-context input manifest, or rendered shared review-context file (see § Output and Phase 2.5) — this skill emits findings and bounded preparation artifacts, not unrelated edits
- You created or removed a worktree — the wrapper handles that
- You skipped the always-on `Code-quality` reviewer or omitted its baseline data-safety, language, tests, or external-invocation coverage
- You treated line count alone as enough to suppress risk-triggered `Architecture` or `Spec` review
- You treated a skill-local topical label as its own source-agent identity
  instead of routing D7-D9 through the configured semantic `reviewer`
- You routed D7-D9 through anything other than `reviewer` frontier/high, or
  routed D10 through anything other than `deep-reviewer` frontier/xhigh
- You spawned any D7-D10 child without its own no-handoff source-immutability
  capture, or consumed a response before verify, retain, and exact cleanup
- You let a failed, invalid, malformed, or verification-rejected child contribute
  findings or critic verdicts
- You let the D10 critic spawn another critic or reviewer
- You showed findings as a table with file:line but no code snippets
- You used a generic agent prompt without diff-specific file references
- You skipped the critic pass because "findings were straightforward"
- You proceeded with default values when a required input was missing — escalate to the wrapper instead

**All of these mean: STOP. Go back to the workflow.**
