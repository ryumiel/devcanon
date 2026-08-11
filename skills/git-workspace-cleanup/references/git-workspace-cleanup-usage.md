# Git workspace cleanup usage

## Role

Performs the deterministic cleanup operation for a selected Git repository.

## Invocation

Run `bash "$SKILL_DIR/scripts/git-workspace-cleanup.sh" --repo "$TARGET_REPO" --dry-run` or the documented execute form.

## Inputs

`--repo` is required. `--dry-run` or `--execute` selects the mode; force flags are optional. It reads no stdin.

## Working directory

The caller may invoke it from any directory; `--repo` identifies the target.

## Outputs

It reports planned or completed cleanup outcomes on stdout and diagnostics on stderr.

## Refusal and failures

Missing repository input, invalid mode, or unsafe repository state exits nonzero; dry-run does not mutate.

## Side effects

`--execute` can remove worktrees and branches under its documented cleanup contract.

## Workflow boundary

[Git workspace cleanup workflow context](../SKILL.md) owns authorization and result handling.
