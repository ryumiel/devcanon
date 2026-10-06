# Scope — `issue-priming-workflow`

Expanded list of what this skill does and does not do.

## Without `--auto`

- Does not write code or create PRs.
- Does not manage implementation — returns control to user after the selected Execution Note or brainstorming handoff.

## With `--auto`

- Does not merge PRs — the PR is the user's review gate.
- Selects useful preparation under `SKILL.md` Preparation Selection: fully specified work uses a guarded Execution Note and same-owner inline execution; unresolved decisions receive needed investigation, design and reviewed planning. Both routes preserve candidate closure, full checks, independent Phase 7 review and publication authority.
- On the brainstorming route, stops before planning when `play-brainstorm` emits the explicit durable owner referral notice, after cleaning up the issue worktree through the discard path.
- Does not make genuinely ambiguous design decisions — stops and asks if options are equally valid.
