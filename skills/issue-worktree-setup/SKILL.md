---
name: issue-worktree-setup
description: Use when a workflow needs to set up an issue worktree safely from either the primary checkout or a managed worktree.
---

# Issue Worktree Setup

Set up an issue worktree without duplicating worktree policy across multiple
skills.

This helper is the single source of truth for:

- detecting whether the current session is in the primary checkout or a managed
  worktree
- deciding whether branching in place is safe
- refusing nested worktree creation from dirty or already-branched managed
  worktrees
- creating a fresh `.worktrees/...` checkout from `origin/main`
- returning the concrete worktree path for downstream phases

## Inputs

Invoke the helper through environment variables:

- `BRANCH_NAME` (required)
- `WORKTREE_LEAF` (required)
- `BASE_REF` (optional, defaults to `origin/main`)

Run:

```bash
HELPER_SCRIPT="scripts/setup-worktree.sh"

WORKTREE_SETUP_OUTPUT=$(
  BRANCH_NAME="<branch-name>" \
  WORKTREE_LEAF="<worktree-leaf>" \
  BASE_REF="origin/main" \
  bash "$HELPER_SCRIPT"
)
```

Resolve `scripts/setup-worktree.sh` from the `issue-worktree-setup` skill
bundle, not from the repository being primed.

## Output Contract

The script writes `KEY=VALUE` lines to stdout:

- `MODE=reuse|new|stop`
- `WORKTREE_PATH=<absolute path>`
- `MESSAGE=<operator-facing text>`

Parse the result without whitespace-splitting:

```bash
while IFS= read -r line; do
  key=${line%%=*}
  value=${line#*=}
  case "$key" in
    MODE) MODE=$value ;;
    WORKTREE_PATH) WORKTREE_PATH=$value ;;
    MESSAGE) MESSAGE=$value ;;
  esac
done <<EOF
$WORKTREE_SETUP_OUTPUT
EOF
```

## Modes

### `MODE=reuse`

Returned when the current session is already inside a managed non-primary
worktree that is:

- on branch `main`
- clean (`git status --short` is empty)

The helper fetches `origin`, fast-forwards `main` to `BASE_REF`, creates the
requested feature branch in place, and returns the current worktree path.

### `MODE=new`

Returned when the current session is running from the primary checkout.

The helper fetches `origin`, ensures `.worktrees/` exists, creates a fresh
linked worktree from `BASE_REF`, and returns the new worktree path.

### `MODE=stop`

Returned when the current session is already inside a managed worktree that is
dirty or already on a feature branch.

The helper performs no setup. The caller must surface `MESSAGE` and stop. Do
not create another worktree from inside that session.

## Path Safety

The helper preserves spaces in paths by parsing
`git worktree list --porcelain -z`, quoting path variables, and returning the
full absolute `WORKTREE_PATH`.

`WORKTREE_LEAF` must stay a single leaf name. Do not pass `/`, `..`, absolute
paths, or names beginning with `-`.

## Failure Model

Policy refusals are reported as `MODE=stop`.

Execution failures such as missing required inputs, failed `git fetch`, failed
branch creation, or failed `git worktree add` exit non-zero and write a concise
error to stderr.
