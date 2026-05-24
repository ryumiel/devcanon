#!/usr/bin/env bash
set -euo pipefail

emit_line() {
  local key="$1"
  local value="$2"
  printf '%s=%s\n' "$key" "$value"
}

stop() {
  local reason_code="$1"
  local reason="$2"

  emit_line "MODE" "stop"
  emit_line "REASON_CODE" "$reason_code"
  emit_line "CURRENT_WORKTREE" "${CURRENT_WORKTREE_REAL:-}"
  emit_line "CURRENT_BRANCH" "${CURRENT_BRANCH:-}"
  emit_line "CURRENT_DETACHED" "${CURRENT_DETACHED:-false}"
  emit_line "PRIMARY_WORKTREE" "${PRIMARY_WORKTREE_REAL:-}"
  emit_line "HEAD_WORKTREE" "${HEAD_WORKTREE_REAL:-}"
  emit_line "BASE_WORKTREE" "${BASE_WORKTREE_REAL:-}"
  emit_line "REASON" "$reason"
  exit 0
}

validate_branch_env() {
  local name="$1"
  local value="${!name:-}"

  case "$value" in
    "" | -* | *$'\n'* | *$'\r'*)
      stop "missing-pr-metadata" "Missing or unsafe ${name}; re-run after collecting PR head and base branch metadata."
      ;;
  esac

  if ! git check-ref-format --branch "$value" >/dev/null 2>&1; then
    stop "missing-pr-metadata" "Invalid ${name}; re-run after collecting valid PR branch metadata."
  fi
}

canonical_path() {
  local target="$1"
  if [ -z "$target" ] || [ ! -d "$target" ]; then
    return 1
  fi
  (cd "$target" && pwd -P)
}

append_worktree_record() {
  [ -n "$RECORD_WORKTREE" ] || return 0

  local real_path=""
  if real_path="$(canonical_path "$RECORD_WORKTREE" 2>/dev/null)"; then
    WORKTREE_PATHS+=("$RECORD_WORKTREE")
    WORKTREE_REAL_PATHS+=("$real_path")
    WORKTREE_BRANCHES+=("$RECORD_BRANCH")
  fi

  RECORD_WORKTREE=""
  RECORD_BRANCH=""
}

collect_worktrees() {
  WORKTREE_PATHS=()
  WORKTREE_REAL_PATHS=()
  WORKTREE_BRANCHES=()
  RECORD_WORKTREE=""
  RECORD_BRANCH=""

  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "")
        append_worktree_record
        ;;
      worktree\ *)
        RECORD_WORKTREE="${line#worktree }"
        ;;
      branch\ refs/heads/*)
        RECORD_BRANCH="${line#branch refs/heads/}"
        ;;
    esac
  done < <(git worktree list --porcelain)

  append_worktree_record
}

find_worktree_by_branch() {
  local branch="$1"
  local index

  for index in "${!WORKTREE_BRANCHES[@]}"; do
    if [ "${WORKTREE_BRANCHES[$index]}" = "$branch" ]; then
      printf '%s\n' "${WORKTREE_REAL_PATHS[$index]}"
      return 0
    fi
  done

  return 1
}

known_current_worktree() {
  local index

  for index in "${!WORKTREE_REAL_PATHS[@]}"; do
    if [ "${WORKTREE_REAL_PATHS[$index]}" = "$CURRENT_WORKTREE_REAL" ]; then
      return 0
    fi
  done

  return 1
}

emit_result() {
  local mode="$1"
  local reason_code="$2"
  local reason="$3"

  emit_line "MODE" "$mode"
  emit_line "REASON_CODE" "$reason_code"
  emit_line "CURRENT_WORKTREE" "$CURRENT_WORKTREE_REAL"
  emit_line "CURRENT_BRANCH" "$CURRENT_BRANCH"
  emit_line "CURRENT_DETACHED" "$CURRENT_DETACHED"
  emit_line "PRIMARY_WORKTREE" "$PRIMARY_WORKTREE_REAL"
  emit_line "HEAD_WORKTREE" "$HEAD_WORKTREE_REAL"
  emit_line "BASE_WORKTREE" "$BASE_WORKTREE_REAL"
  emit_line "REASON" "$reason"
}

CURRENT_WORKTREE_REAL=""
CURRENT_BRANCH=""
CURRENT_DETACHED="false"
PRIMARY_WORKTREE_REAL=""
HEAD_WORKTREE_REAL=""
BASE_WORKTREE_REAL=""

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  stop "outside-worktree" "Current directory is outside a Git worktree; re-run from a repository worktree."
fi

validate_branch_env "PR_HEAD_BRANCH"
validate_branch_env "PR_BASE_BRANCH"

CURRENT_WORKTREE="$(git rev-parse --show-toplevel)"
CURRENT_WORKTREE_REAL="$(canonical_path "$CURRENT_WORKTREE")" || {
  stop "unclassifiable" "Unable to canonicalize the current worktree; re-run from a normal repository path."
}

if CURRENT_BRANCH="$(git symbolic-ref --quiet --short HEAD 2>/dev/null)"; then
  CURRENT_DETACHED="false"
else
  CURRENT_BRANCH=""
  CURRENT_DETACHED="true"
fi

collect_worktrees

if [ "${#WORKTREE_REAL_PATHS[@]}" -eq 0 ]; then
  stop "missing-primary" "Unable to determine the primary worktree; run git worktree list and retry from a valid checkout."
fi

PRIMARY_WORKTREE_REAL="${WORKTREE_REAL_PATHS[0]}"
HEAD_WORKTREE_REAL="$(find_worktree_by_branch "$PR_HEAD_BRANCH" || true)"
BASE_WORKTREE_REAL="$(find_worktree_by_branch "$PR_BASE_BRANCH" || true)"

if ! known_current_worktree; then
  stop "unclassifiable" "Current checkout is not present in git worktree metadata; run git worktree repair or retry from a known worktree."
fi

if [ "$CURRENT_DETACHED" = "true" ]; then
  stop "detached-current" "Current worktree is detached; re-run from a named branch worktree."
fi

if [ "$CURRENT_WORKTREE_REAL" = "$HEAD_WORKTREE_REAL" ]; then
  emit_result "remote-only" "current-head-worktree" "Current worktree holds the PR head branch; merge without delegated branch cleanup, then run explicit cleanup."
elif [ "$CURRENT_WORKTREE_REAL" = "$BASE_WORKTREE_REAL" ]; then
  if [ -n "$HEAD_WORKTREE_REAL" ] && [ "$HEAD_WORKTREE_REAL" != "$CURRENT_WORKTREE_REAL" ]; then
    emit_result "remote-only" "base-with-head-worktree" "Base worktree is current and another worktree holds the PR head; avoid GitHub CLI local cleanup."
  else
    emit_result "safe-direct" "base-no-head-worktree" "Current worktree holds the base branch and no local worktree holds the PR head branch."
  fi
elif [ "$PRIMARY_WORKTREE_REAL" = "$BASE_WORKTREE_REAL" ] && [ -z "$HEAD_WORKTREE_REAL" ]; then
  emit_result "cd-primary" "unrelated-cd-primary" "Current worktree is unrelated; change to the primary base worktree before merge."
else
  emit_result "remote-only" "unrelated-remote-only" "Current worktree is unrelated to the PR head/base collision state; use merge-only behavior and explicit cleanup."
fi
