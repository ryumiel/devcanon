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

It emits separate cleanup outcomes on stdout and diagnostics on stderr.

## Refusal and failures

Missing merge evidence, invalid preflight context, unavailable runtime, or unsafe cleanup state exits nonzero.

## Side effects

Successful cleanup may remove a linked worktree, update the local base branch, and delete a local head branch. For a merged same-repository PR whose remote origin matches the base repository and whose remote head still equals `PR_HEAD_SHA`, it can also delete that remote branch with `git push origin :refs/heads/<head>`; mismatched origins, protected, dirty, or locked worktrees, changed remote tips, and failed remote lookup or deletion retain the branch and report the corresponding outcome. It does not verify or perform the merge.

## Workflow boundary

[PR merge workflow context](../SKILL.md) owns merge verification and manual-action decisions.
