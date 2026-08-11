# Setup worktree usage

## Role

Invokes the native issue-worktree setup adapter.

## Invocation

Run `node "$ISSUE_WORKTREE_SETUP_DIR/scripts/setup-worktree.mjs"` with no arguments.

## Inputs

`BRANCH_NAME` and `WORKTREE_LEAF` are required environment values. `BASE_REF` is optional and defaults to `origin/<remote default branch>`. `DEVCANON_RUNTIME_DIR` is an optional runtime diagnostic override. It reads no stdin.

## Working directory

Run from the native host shell context selected by the owning skill.

## Outputs

It emits one `MODE=...`, `WORKTREE_PATH=...`, and `MESSAGE=...` result on stdout; diagnostics use stderr.

## Refusal and failures

Missing runtime, invalid setup inputs, or failed worktree setup exits nonzero.

## Side effects

Successful setup may create or update Git worktree state through the runtime adapter.

## Workflow boundary

[Issue worktree setup workflow context](../SKILL.md) owns fallback choice and result continuation.
