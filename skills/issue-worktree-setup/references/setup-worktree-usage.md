# Setup worktree usage

## Role

Invokes the native issue-worktree setup adapter.

## Invocation

Run `node "$ISSUE_WORKTREE_SETUP_DIR/scripts/setup-worktree.mjs"` with no arguments.

## Inputs

`BRANCH_NAME` and `WORKTREE_LEAF` are required environment values. `BRANCH_NAME` must be a Git-valid, single-line branch name that does not begin with `-`. `WORKTREE_LEAF` must be one safe leaf name: it cannot be absolute, contain `/` or `\\`, contain `..`, begin with `-`, or contain a line break. `BASE_REF` is optional. When absent, after the existing worktree and submodule safety checks, the runtime queries `origin` with `git ls-remote --symref --exit-code origin HEAD`. It requires exactly one advertised symbolic `HEAD` target under `refs/heads/` with a nonempty branch name, then uses the corresponding `origin/<branch>` remote-tracking ref as the base. When supplied, `BASE_REF` must be nonempty, single-line, not begin with `-`, and resolve to a commit; this explicit path does not query the remote default branch. `DEVCANON_RUNTIME_DIR` is an optional runtime diagnostic override. It reads no stdin.

## Working directory

Run from a native host shell in a Git worktree; POSIX/WSL execution against Windows Git metadata is refused.

## Outputs

It emits `MODE=...`, `WORKTREE_PATH=...`, and `MESSAGE=...` on stdout. A valid no-action outcome such as unsupported submodule use returns exit zero with `MODE=stop`; diagnostics use stderr only for command failure.

## Refusal and failures

Missing runtime, invalid setup inputs, or failed worktree setup exits nonzero. If an omitted `BASE_REF` cannot produce one usable advertised symbolic branch target, the runtime refuses before fetching with `Unable to determine origin's default branch:` followed by a specific cause. It does not assume `main` or `master`, use cached remote-tracking refs, or create the requested branch or worktree.

## Side effects

After a valid remote-default discovery for omitted `BASE_REF`, or immediately for a supplied `BASE_REF`, the adapter fetches `origin` before resolving the selected base; this can update remote-tracking state even when a later reuse, stop, or failure route is selected. The discovery query itself is read-only and does not update local remote-head state. Successful setup may additionally create, reuse, or update Git worktree state through the runtime adapter.

## Workflow boundary

[Issue worktree setup workflow context](../SKILL.md) owns result continuation.
