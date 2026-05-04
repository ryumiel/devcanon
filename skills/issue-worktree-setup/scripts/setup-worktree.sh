#!/usr/bin/env bash

set -euo pipefail

require_env() {
  local name="$1"

  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 1
  fi
}

emit_line() {
  local key="$1"
  local value="$2"

  printf '%s=%s\n' "$key" "$value"
}

require_env "BRANCH_NAME"
require_env "WORKTREE_LEAF"

DEFAULT_BRANCH=""
if symbolic_ref="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null)"; then
  DEFAULT_BRANCH="${symbolic_ref#origin/}"
fi
if [[ -z "$DEFAULT_BRANCH" ]]; then
  for fallback in main master; do
    if git show-ref --verify --quiet "refs/remotes/origin/${fallback}"; then
      DEFAULT_BRANCH="$fallback"
      break
    fi
  done
fi
DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"
BASE_REF="${BASE_REF:-origin/${DEFAULT_BRANCH}}"
CURRENT_WORKTREE="$(git rev-parse --show-toplevel)"
CURRENT_WORKTREE_REAL="$(cd "$CURRENT_WORKTREE" && pwd -P)"
CURRENT_STATUS="$(git status --short)"
MAIN_WORKTREE=""

case "$BRANCH_NAME" in
  "" | -* | *$'\n'* | *$'\r'*)
    echo "Unsafe BRANCH_NAME: ${BRANCH_NAME}" >&2
    exit 1
    ;;
esac

if ! git check-ref-format --branch "$BRANCH_NAME" >/dev/null 2>&1; then
  echo "Invalid BRANCH_NAME: ${BRANCH_NAME}" >&2
  exit 1
fi

case "$WORKTREE_LEAF" in
  "" | "." | /* | -* | *"/"* | *".."* | *$'\n'* | *$'\r'*)
    echo "Unsafe WORKTREE_LEAF: ${WORKTREE_LEAF}" >&2
    exit 1
    ;;
esac

case "$BASE_REF" in
  "" | -* | *$'\n'* | *$'\r'*)
    echo "Unsafe BASE_REF: ${BASE_REF}" >&2
    exit 1
    ;;
esac

while IFS= read -r -d '' line; do
  case "$line" in
    worktree\ *)
      MAIN_WORKTREE="${line#worktree }"
      break
      ;;
  esac
done < <(git worktree list --porcelain -z)

if [[ -z "$MAIN_WORKTREE" ]]; then
  echo "Unable to determine the primary worktree." >&2
  exit 1
fi

git fetch origin

RESOLVED_BASE="$(git rev-parse --verify --quiet "${BASE_REF}^{commit}")"
if [[ -z "$RESOLVED_BASE" ]]; then
  echo "Unable to resolve BASE_REF to a commit: ${BASE_REF}" >&2
  exit 1
fi

# Refuse early on exact-name collision so the operator gets a friendly
# message. The reuse path below also relies on `git checkout -b`'s atomic
# namespace check (which catches D/F conflicts like BRANCH_NAME=feat when
# feat/foo already exists) — that is the load-bearing safety check; this
# pre-check just provides a clearer error in the common case.
if git show-ref --verify --quiet "refs/heads/${BRANCH_NAME}"; then
  echo "Branch already exists: ${BRANCH_NAME}" >&2
  exit 1
fi

if [[ "$CURRENT_WORKTREE" != "$MAIN_WORKTREE" ]]; then
  if [[ -z "$CURRENT_STATUS" ]]; then
    # `git merge-base --is-ancestor` exits 0 (ancestor), 1 (not ancestor),
    # or >=2 (genuine error: bad ref, corrupt object, etc.). Capture the
    # status so the >=2 case surfaces instead of being silently routed
    # through the "ahead of BASE_REF" stop branch.
    set +e
    git merge-base --is-ancestor HEAD "$RESOLVED_BASE"
    is_ancestor_status=$?
    set -e
    case "$is_ancestor_status" in
      0)
        # Create the new branch directly at BASE_REF and switch. This is
        # atomic: any namespace collision (exact or D/F) fails before the
        # previously checked-out branch ref is touched.
        git checkout -b "$BRANCH_NAME" "$RESOLVED_BASE"
        emit_line "MODE" "reuse"
        emit_line "WORKTREE_PATH" "$CURRENT_WORKTREE"
        emit_line "MESSAGE" "Reused clean managed worktree."
        exit 0
        ;;
      1)
        # HEAD is ahead of or diverged from BASE_REF — fall through to stop.
        ;;
      *)
        echo "git merge-base --is-ancestor failed unexpectedly (exit ${is_ancestor_status})" >&2
        exit 1
        ;;
    esac
  fi

  emit_line "MODE" "stop"
  emit_line "WORKTREE_PATH" "$CURRENT_WORKTREE"
  if [[ -n "$CURRENT_STATUS" ]]; then
    emit_line \
      "MESSAGE" \
      "Managed worktree has uncommitted changes; return to the primary checkout."
  else
    # The is-ancestor check returned 1 — HEAD is either strictly ahead of
    # BASE_REF or has diverged from it. "Has commits not in BASE_REF"
    # covers both shapes; "ahead of" alone would misdiagnose divergence.
    emit_line \
      "MESSAGE" \
      "Managed worktree has commits not in BASE_REF; return to the primary checkout."
  fi
  exit 0
fi

WORKTREES_DIR="$CURRENT_WORKTREE/.worktrees"

if [[ -L "$WORKTREES_DIR" ]]; then
  echo ".worktrees must be a normal directory inside the primary checkout." >&2
  exit 1
fi

mkdir -p "$WORKTREES_DIR"

WORKTREES_DIR_REAL="$(cd "$WORKTREES_DIR" && pwd -P)"
EXPECTED_WORKTREES_DIR_REAL="$CURRENT_WORKTREE_REAL/.worktrees"
if [[ "$WORKTREES_DIR_REAL" != "$EXPECTED_WORKTREES_DIR_REAL" ]]; then
  echo ".worktrees resolved outside the primary checkout." >&2
  exit 1
fi

NEW_WORKTREE_PATH="$WORKTREES_DIR/$WORKTREE_LEAF"
if [[ -L "$NEW_WORKTREE_PATH" || -e "$NEW_WORKTREE_PATH" ]]; then
  echo "Target worktree path already exists: ${NEW_WORKTREE_PATH}" >&2
  exit 1
fi

git worktree add -b "$BRANCH_NAME" "$NEW_WORKTREE_PATH" "$RESOLVED_BASE"

emit_line "MODE" "new"
emit_line "WORKTREE_PATH" "$NEW_WORKTREE_PATH"
emit_line "MESSAGE" "Created new managed worktree."
