# Setup worktree usage

## Role

Invokes the native issue-worktree setup adapter.

## Invocation

Run `node "$ISSUE_WORKTREE_SETUP_DIR/scripts/setup-worktree.mjs"` with the documented worktree environment.

## Inputs

The setup environment, including `BRANCH_NAME`, supplies required worktree facts; `DEVCANON_RUNTIME_DIR` is an optional runtime diagnostic override. It reads no stdin.

## Working directory

Run from the native host shell context selected by the owning skill.

## Outputs

It forwards the runtime setup result on stdout and diagnostics on stderr.

## Refusal and failures

Missing runtime, invalid setup inputs, or failed worktree setup exits nonzero.

## Side effects

Successful setup may create or update Git worktree state through the runtime adapter.

## Workflow boundary

[Issue worktree setup workflow context](../SKILL.md) owns fallback choice and result continuation.
