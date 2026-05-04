---
name: issue-worktree-setup
description: Provisions an isolated worktree for issue work as the single source of truth for worktree-setup policy across consumer skills. Use when a workflow needs an issue worktree from either the primary checkout or a managed worktree.
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
- creating a fresh `.worktrees/...` checkout from the repository's default branch (resolved via `origin/HEAD`, falling back to `origin/main`)
- returning the concrete worktree path for downstream phases

## Inputs

Invoke the helper through environment variables:

- `BRANCH_NAME` (required)
- `WORKTREE_LEAF` (required)
- `BASE_REF` (optional, defaults to the repository's default branch resolved via `origin/HEAD`, falling back to `origin/main`)

Run:

```bash
ISSUE_WORKTREE_SETUP_DIR="<issue-worktree-setup-skill-dir>"
HELPER_SCRIPT="$ISSUE_WORKTREE_SETUP_DIR/scripts/setup-worktree.sh"

WORKTREE_SETUP_OUTPUT=$(
  BRANCH_NAME="<branch-name>" \
  WORKTREE_LEAF="<worktree-leaf>" \
  bash "$HELPER_SCRIPT"
)
```

Resolve `ISSUE_WORKTREE_SETUP_DIR` to the installed `issue-worktree-setup`
skill bundle, not to the repository being primed.

Callers should only pass single-line values. `BRANCH_NAME` must be a valid Git
branch name, `WORKTREE_LEAF` must be a single path leaf, and `BASE_REF` must
resolve to a commit after `git fetch origin`.

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
worktree whose state has no work to preserve:

- clean (`git status --short` is empty)
- `HEAD` is an ancestor of `BASE_REF` (no commits unique to the current branch)

The current branch name is irrelevant — a Claude Code- or Codex-spawned scratch
worktree on `claude/<slug>` at `origin/main` is reused identically to a
worktree that happens to be on the default branch. The helper fetches `origin`,
creates the requested feature branch directly at `BASE_REF` via
`git checkout -b BRANCH_NAME BASE_REF`, and returns the current worktree path.
The previously checked-out branch ref (if any) is left at its original commit;
only the checkout moves.

If `BRANCH_NAME` already exists as a local branch, or if it would collide with
an existing ref namespace (e.g. `feat` when `feat/foo` already exists), the
helper refuses without mutating any ref — the atomic `git checkout -b` check
catches both cases.

### `MODE=new`

Returned when the current session is running from the primary checkout.

The helper fetches `origin`, ensures `.worktrees/` exists, creates a fresh
linked worktree from `BASE_REF`, and returns the new worktree path.

### `MODE=stop`

Returned when the current session is already inside a managed worktree that is
either dirty or holds commits not in `BASE_REF` — i.e., reuse would risk losing
in-progress work.

The helper performs no setup. The caller must surface `MESSAGE` and stop. Do
not create another worktree from inside that session.

## Path Safety

The helper preserves spaces in paths by parsing
`git worktree list --porcelain -z`, quoting path variables, and returning the
full absolute `WORKTREE_PATH`.

`WORKTREE_LEAF` must stay a single leaf name. Do not pass `/`, `..`, absolute
paths, names beginning with `-`, or multiline values.

The helper also requires `.worktrees/` to resolve to a normal directory inside
the primary checkout. It rejects symlinks or any resolved path outside that
checkout.

The target leaf path must not already exist. The helper rejects pre-existing
files, directories, or symlinks at `.worktrees/<leaf>`.

## Failure Model

Policy refusals are reported as `MODE=stop`.

Execution failures such as missing required inputs, failed `git fetch`, failed
branch creation, or failed `git worktree add` exit non-zero and write a concise
error to stderr.
