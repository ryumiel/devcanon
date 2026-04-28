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

BASE_REF="${BASE_REF:-origin/main}"
CURRENT_WORKTREE="$(git rev-parse --show-toplevel)"
CURRENT_BRANCH="$(git branch --show-current)"
CURRENT_STATUS="$(git status --short)"
MAIN_WORKTREE=""

case "$WORKTREE_LEAF" in
  "" | "." | /* | -* | *"/"* | *".."*)
    echo "Unsafe WORKTREE_LEAF: ${WORKTREE_LEAF}" >&2
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

if [[ "$CURRENT_WORKTREE" != "$MAIN_WORKTREE" ]]; then
  if [[ "$CURRENT_BRANCH" == "main" && -z "$CURRENT_STATUS" ]]; then
    git fetch origin
    git merge "$BASE_REF" --ff-only
    git checkout -b "$BRANCH_NAME"
    emit_line "MODE" "reuse"
    emit_line "WORKTREE_PATH" "$CURRENT_WORKTREE"
    emit_line "MESSAGE" "Reused clean managed worktree."
    exit 0
  fi

  emit_line "MODE" "stop"
  emit_line "WORKTREE_PATH" "$CURRENT_WORKTREE"
  emit_line \
    "MESSAGE" \
    "Return to the primary checkout before creating a fresh worktree."
  exit 0
fi

git fetch origin
mkdir -p "$CURRENT_WORKTREE/.worktrees"

NEW_WORKTREE_PATH="$CURRENT_WORKTREE/.worktrees/$WORKTREE_LEAF"

git worktree add -b "$BRANCH_NAME" "$NEW_WORKTREE_PATH" "$BASE_REF"

emit_line "MODE" "new"
emit_line "WORKTREE_PATH" "$NEW_WORKTREE_PATH"
emit_line "MESSAGE" "Created new managed worktree."
