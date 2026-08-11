# Setup worktree usage

## Role

Invokes the native issue-worktree setup adapter.

## Invocation

Run `node "$ISSUE_WORKTREE_SETUP_DIR/scripts/setup-worktree.mjs"` with no arguments.

## Inputs

`BRANCH_NAME` and `WORKTREE_LEAF` are required environment values. `BASE_REF` is optional and defaults to `origin/<remote default branch>`. `DEVCANON_RUNTIME_DIR` is an optional runtime diagnostic override. It reads no stdin.

## Working directory

Run from a native host shell in a Git worktree; POSIX/WSL execution against Windows Git metadata is refused.

## Outputs

It emits `MODE=...`, `WORKTREE_PATH=...`, and `MESSAGE=...` on stdout. A valid no-action outcome such as unsupported submodule use returns exit zero with `MODE=stop`; diagnostics use stderr only for command failure.

## Refusal and failures

Missing runtime, invalid setup inputs, or failed worktree setup exits nonzero.

## Side effects

Successful setup may create or update Git worktree state through the runtime adapter.

## Workflow boundary

[Issue worktree setup workflow context](../SKILL.md) owns fallback choice and result continuation.
