# Setup worktree usage

## Role

Invokes the native issue-worktree setup adapter.

## Invocation

Run `node "$ISSUE_WORKTREE_SETUP_DIR/scripts/setup-worktree.mjs"` with no arguments.

## Inputs

`BRANCH_NAME` and `WORKTREE_LEAF` are required environment values. `BRANCH_NAME` must be a Git-valid, single-line branch name that does not begin with `-`. `WORKTREE_LEAF` must be one safe leaf name: it cannot be absolute, contain `/` or `\\`, contain `..`, begin with `-`, or contain a line break. `BASE_REF` is optional. When absent, the current runtime uses the local `origin/HEAD`, then an existing local `origin/main`, then an existing local `origin/master`, and finally assumes `origin/main`; provide `BASE_REF` when those local refs do not establish the intended base. When supplied, it must be nonempty, single-line, not begin with `-`, and resolve to a commit. `DEVCANON_RUNTIME_DIR` is an optional runtime diagnostic override. It reads no stdin.

## Working directory

Run from a native host shell in a Git worktree; POSIX/WSL execution against Windows Git metadata is refused.

## Outputs

It emits `MODE=...`, `WORKTREE_PATH=...`, and `MESSAGE=...` on stdout. A valid no-action outcome such as unsupported submodule use returns exit zero with `MODE=stop`; diagnostics use stderr only for command failure.

## Refusal and failures

Missing runtime, invalid setup inputs, or failed worktree setup exits nonzero.

## Side effects

After the initial worktree and submodule checks, the adapter fetches `origin` before resolving `BASE_REF`; this can update remote-tracking state even when a later reuse, stop, or failure route is selected. Successful setup may additionally create, reuse, or update Git worktree state through the runtime adapter.

## Workflow boundary

[Issue worktree setup workflow context](../SKILL.md) owns fallback choice and result continuation.
