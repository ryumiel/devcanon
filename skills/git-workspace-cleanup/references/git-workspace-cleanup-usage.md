# Git workspace cleanup usage

## Role

Performs the deterministic cleanup operation for a selected Git repository.

## Invocation

Run `bash "$SKILL_DIR/scripts/git-workspace-cleanup.sh" [--repo <path>] [--dry-run|--execute] [--force-branches] [--force-dirty-worktrees]`.

## Inputs

`--repo <path>` is optional and defaults to the current directory. `--dry-run` is the default mode; `--execute` enables cleanup. `--force-branches` and `--force-dirty-worktrees` are optional execute-mode overrides. It reads no stdin.

## Working directory

The caller may invoke it from any directory; `--repo` identifies the target.

## Outputs

It reports planned or completed cleanup outcomes on stdout and diagnostics on stderr.

## Refusal and failures

Unknown or incomplete flags, a non-worktree or bare repository, missing remote default branch, or a blocked cleanup state exits nonzero.

## Side effects

`--dry-run` fetches `origin --prune` before reporting; `--execute` can prune worktrees and remove worktrees and branches. Dry-run is not mutation-free.

## Workflow boundary

[Git workspace cleanup workflow context](../SKILL.md) owns authorization and result handling.
