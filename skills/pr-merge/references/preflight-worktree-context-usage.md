# Preflight worktree context usage

## Role

Reports deterministic context for a merge worktree.

## Invocation

Run `PR_HEAD_BRANCH=<branch> PR_BASE_BRANCH=<branch> bash "$PR_MERGE_DIR/scripts/preflight-worktree-context.sh"`.

## Inputs

`PR_HEAD_BRANCH` and `PR_BASE_BRANCH` are required; `DEVCANON_RUNTIME_DIR` is an optional runtime override. It reads no stdin.

## Working directory

Run from and inspect the caller's current registered Git worktree.

## Outputs

It emits `MODE`, `REASON_CODE`, `CURRENT_WORKTREE`, `CURRENT_BRANCH`, `CURRENT_DETACHED`, `PRIMARY_WORKTREE`, `HEAD_WORKTREE`, `BASE_WORKTREE`, and `REASON` as `KEY=VALUE` lines. Missing or invalid PR metadata and unclassifiable worktree context route through exit-zero `MODE=stop`; diagnostics use stderr only for runtime failure.

## Refusal and failures

Unavailable runtime exits nonzero. Missing branch facts and invalid or unavailable caller context are reported by the exit-zero `MODE=stop` route.

## Side effects

Preflight inspects repository state and is read-only.

## Workflow boundary

[PR merge workflow context](../SKILL.md) owns merge selection and result interpretation.
