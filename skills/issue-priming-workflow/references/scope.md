# Scope — `issue-priming-workflow`

Expanded list of what this skill does and does not do.

## Without `--auto`

- Does not write code or create PRs.
- Does not manage implementation — returns control to user after brainstorming.

## With `--auto`

- Does not merge PRs — the PR is the user's review gate.
- Does not skip brainstorming or planning — runs the full pipeline, just without user checkpoints.
- Does not make genuinely ambiguous design decisions — stops and asks if options are equally valid.
