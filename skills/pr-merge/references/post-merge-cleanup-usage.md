# Post merge cleanup usage

## Role

Performs deterministic local cleanup after a verified merge.

## Invocation

Run `bash "$PR_MERGE_DIR/scripts/post-merge-cleanup.sh"` with no arguments.

## Inputs

`PR_STATE`, `PR_HEAD_BRANCH`, `PR_BASE_BRANCH`, `PR_HEAD_SHA`, `PR_HEAD_REPO`, `PR_BASE_REPO`, `PR_BASE_DEFAULT_BRANCH`, `PR_BASE_REMOTE_URL`, and `PRIMARY_WORKTREE` are required. `HEAD_WORKTREE` and `CURRENT_WORKTREE` are optional and default to empty. `DEVCANON_RUNTIME_DIR` is optional. It reads no stdin.

## Working directory

Run from the repository context selected by the preflight result.

## Outputs

Its primary result channel is structured `KEY=VALUE` stdout: `WORKTREE_CLEANUP`, `BASE_UPDATE`, `LOCAL_BRANCH_CLEANUP`, and `REMOTE_BRANCH_CLEANUP`, each with a corresponding `_REASON`, plus `MANUAL_ACTION`. Thrown input or runtime errors are emitted on stderr.

## Refusal and failures

A present `PR_STATE` other than `MERGED`, dirty or locked worktrees, and individual Git cleanup-operation failures return exit zero with structured `skipped`, `retained`, `failed`, or manual-cleanup outcomes. A missing required `PR_STATE` (or other required input), invalid paths or branch names, and unavailable runtime are thrown errors that exit nonzero (the runtime reports these as exit 2 on stderr).

## Side effects

Successful cleanup may remove a linked worktree, update the local base branch, and delete a local head branch. Independently of dirty, locked, or locally protected worktree state, it can delete the remote head branch with `git push origin :refs/heads/<head>` only when the PR is merged and same-repository, the head is neither the base nor default branch, the `origin` URL matches the base repository, and `ls-remote` reports exactly `PR_HEAD_SHA`; origin mismatch, remote lookup failure, a changed or absent remote tip, or failed deletion retain the remote branch and report the corresponding outcome. It does not verify or perform the merge.

## Workflow boundary

[PR merge workflow context](../SKILL.md) owns merge verification and manual-action decisions.
