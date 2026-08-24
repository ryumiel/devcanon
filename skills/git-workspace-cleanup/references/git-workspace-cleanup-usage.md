# Git workspace cleanup usage

## Role

Performs the deterministic cleanup operation for a selected Git repository.

## Invocation

Run `bash "$SKILL_DIR/scripts/git-workspace-cleanup.sh" [--repo <path>] [--dry-run|--execute] [--force-branches] [--force-dirty-worktrees]`.

### Windows PowerShell to Bash

Choose the route for the Bash environment you will actually use. Convert both
the wrapper path and target repository path before invoking the helper. If the
named converter is unavailable, stop and install or select that Bash
environment; do not guess a POSIX path.

For Git Bash or MSYS2, convert both paths with `cygpath -u`:

```bash
SKILL_DIR_POSIX="$(cygpath -u "$SKILL_DIR")"
TARGET_REPO_POSIX="$(cygpath -u "$TARGET_REPO")"
bash "$SKILL_DIR_POSIX/scripts/git-workspace-cleanup.sh" --repo "$TARGET_REPO_POSIX" --dry-run
```

For WSL, invoke through `wsl.exe` and convert both paths with `wslpath` inside
that environment:

```powershell
wsl.exe bash -lc 'skill_dir="$(wslpath "$1")"; target_repo="$(wslpath "$2")"; bash "$skill_dir/scripts/git-workspace-cleanup.sh" --repo "$target_repo" --dry-run' -- $SKILL_DIR $TARGET_REPO
```

These path forms are environment-specific; do not substitute a Git Bash/MSYS2
path into WSL or the reverse. After the required dry-run, retain the approval
and force-flag rules from the workflow before changing `--dry-run` to
`--execute`.

## Inputs

`--repo <path>` is optional and defaults to the current directory. `--dry-run` is the default mode; `--execute` enables cleanup. `--force-branches` and `--force-dirty-worktrees` are optional execute-mode overrides. It reads no stdin.

## Working directory

The caller may invoke it from any directory; `--repo` identifies the target.

## Outputs

It reports planned or completed cleanup outcomes on stdout and diagnostics on stderr.

## Refusal and failures

Unknown or incomplete flags, a non-worktree or bare repository, or a missing remote default branch exits nonzero. A completed dry run exits zero and reports `STATUS=ok` or `STATUS=blocked` according to the collected facts. Execute mode exits nonzero when those facts are blocked.

## Side effects

`--dry-run` fetches `origin --prune` before reporting. `--execute` can prune and remove worktrees and branches; it also checks out the local default branch (creating it from `origin/<default>` when absent) and fast-forwards it to `origin/<default>`. Dry-run is not mutation-free.

## Workflow boundary

[Git workspace cleanup workflow context](../SKILL.md) owns authorization and result handling.
