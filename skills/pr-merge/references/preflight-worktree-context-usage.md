# Preflight worktree context usage

## Role

Reports deterministic context for a merge worktree.

## Invocation

Run `PR_HEAD_BRANCH=<branch> PR_BASE_BRANCH=<branch> bash "$PR_MERGE_DIR/scripts/preflight-worktree-context.sh"`.

## Inputs

`PR_HEAD_BRANCH` and `PR_BASE_BRANCH` are required; `DEVCANON_RUNTIME_DIR` is an optional runtime override. It reads no stdin.

## Working directory

Run from the primary repository root.

## Outputs

It emits parseable `KEY=VALUE` facts on stdout and diagnostics on stderr.

## Refusal and failures

Missing branch facts, invalid worktree context, or unavailable runtime exits nonzero.

## Side effects

Preflight inspects repository state and is read-only.

## Workflow boundary

[PR merge workflow context](../SKILL.md) owns merge selection and result interpretation.
