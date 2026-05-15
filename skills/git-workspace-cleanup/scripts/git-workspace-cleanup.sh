#!/usr/bin/env bash
set -euo pipefail

MODE="dry-run"
FORCE_BRANCHES=0
FORCE_DIRTY_WORKTREES=0
TARGET_REPO=""

usage() {
  cat >&2 <<'EOF'
usage: git-workspace-cleanup.sh [--repo <path>] [--dry-run|--execute] [--force-branches] [--force-dirty-worktrees]
EOF
}

die() {
  echo "ERROR=$*" >&2
  exit 2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      MODE="dry-run"
      ;;
    --execute)
      MODE="execute"
      ;;
    --force-branches)
      FORCE_BRANCHES=1
      ;;
    --force-dirty-worktrees)
      FORCE_DIRTY_WORKTREES=1
      ;;
    --repo)
      [ "$#" -ge 2 ] || die "--repo requires a path"
      TARGET_REPO=$2
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      die "unknown argument: $1"
      ;;
  esac
  shift
done

git_c() {
  git -C "$REPO_ROOT" "$@"
}

worktree_status() {
  git -C "$1" status --porcelain=v1 --untracked-files=normal
}

resolve_default_branch() {
  local symbolic_ref

  if symbolic_ref=$(git_c symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null); then
    printf '%s\n' "${symbolic_ref#origin/}"
    return 0
  fi

  if git_c show-ref --verify --quiet refs/remotes/origin/main; then
    printf '%s\n' "main"
    return 0
  fi

  if git_c show-ref --verify --quiet refs/remotes/origin/master; then
    printf '%s\n' "master"
    return 0
  fi

  return 1
}

append_worktree_record() {
  [ -n "$CURRENT_WORKTREE_PATH" ] || return 0
  if [ "$CURRENT_WORKTREE_PRUNABLE" = "true" ]; then
    PRUNABLE_WORKTREE_PATHS+=("$CURRENT_WORKTREE_PATH")
  else
    WORKTREE_PATHS+=("$CURRENT_WORKTREE_PATH")
    WORKTREE_BRANCHES+=("$CURRENT_WORKTREE_BRANCH")
    WORKTREE_LOCKED_FLAGS+=("$CURRENT_WORKTREE_LOCKED")
    WORKTREE_LOCKED_REASONS+=("$CURRENT_WORKTREE_LOCKED_REASON")
  fi
  CURRENT_WORKTREE_PATH=""
  CURRENT_WORKTREE_BRANCH=""
  CURRENT_WORKTREE_PRUNABLE="false"
  CURRENT_WORKTREE_LOCKED="false"
  CURRENT_WORKTREE_LOCKED_REASON=""
}

collect_worktrees() {
  WORKTREE_PATHS=()
  WORKTREE_BRANCHES=()
  WORKTREE_LOCKED_FLAGS=()
  WORKTREE_LOCKED_REASONS=()
  PRUNABLE_WORKTREE_PATHS=()
  CURRENT_WORKTREE_PATH=""
  CURRENT_WORKTREE_BRANCH=""
  CURRENT_WORKTREE_PRUNABLE="false"
  CURRENT_WORKTREE_LOCKED="false"
  CURRENT_WORKTREE_LOCKED_REASON=""

  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "")
        append_worktree_record
        ;;
      worktree\ *)
        CURRENT_WORKTREE_PATH=${line#worktree }
        ;;
      branch\ refs/heads/*)
        CURRENT_WORKTREE_BRANCH=${line#branch refs/heads/}
        ;;
      prunable\ *)
        CURRENT_WORKTREE_PRUNABLE="true"
        ;;
      locked*)
        CURRENT_WORKTREE_LOCKED="true"
        CURRENT_WORKTREE_LOCKED_REASON=${line#locked}
        CURRENT_WORKTREE_LOCKED_REASON=${CURRENT_WORKTREE_LOCKED_REASON# }
        ;;
    esac
  done < <(git_c worktree list --porcelain)

  append_worktree_record
  [ "${#WORKTREE_PATHS[@]}" -gt 0 ] || die "no worktrees found"
}

count_lines() {
  local value=$1
  [ -n "$value" ] || {
    printf '%s\n' "0"
    return 0
  }
  printf '%s\n' "$value" | wc -l | tr -d ' '
}

collect_locked_worktrees() {
  LOCKED_WORKTREE_LINES=()
  LOCKED_WORKTREE_COUNT=0

  local index path reason line
  for index in "${!WORKTREE_PATHS[@]}"; do
    [ "$index" -eq 0 ] && continue
    [ "${WORKTREE_LOCKED_FLAGS[$index]}" = "true" ] || continue

    path=${WORKTREE_PATHS[$index]}
    reason=${WORKTREE_LOCKED_REASONS[$index]}
    line="LOCKED_WORKTREE=$path"
    if [ -n "$reason" ]; then
      line="$line|REASON=$reason"
    fi
    LOCKED_WORKTREE_COUNT=$((LOCKED_WORKTREE_COUNT + 1))
    LOCKED_WORKTREE_LINES+=("$line")
  done
}

collect_dirty_worktrees() {
  DIRTY_WORKTREE_LINES=()
  DIRTY_WORKTREE_COUNT=0
  DIRTY_PRIMARY_COUNT=0
  DIRTY_LINKED_COUNT=0

  local index path status files primary
  for index in "${!WORKTREE_PATHS[@]}"; do
    path=${WORKTREE_PATHS[$index]}
    status=$(worktree_status "$path")
    [ -n "$status" ] || continue

    files=$(count_lines "$status")
    primary="false"
    if [ "$index" -eq 0 ]; then
      primary="true"
      DIRTY_PRIMARY_COUNT=$((DIRTY_PRIMARY_COUNT + 1))
    else
      DIRTY_LINKED_COUNT=$((DIRTY_LINKED_COUNT + 1))
    fi

    DIRTY_WORKTREE_COUNT=$((DIRTY_WORKTREE_COUNT + 1))
    DIRTY_WORKTREE_LINES+=("DIRTY_WORKTREE=$path|FILES=$files|PRIMARY=$primary")
  done
}

branch_is_squash_merged() {
  local branch_ref=$1
  local merge_base tree dummy_commit cherry_status

  merge_base=$(git_c merge-base "refs/remotes/origin/$DEFAULT_BRANCH" "$branch_ref" 2>/dev/null || true)
  [ -n "$merge_base" ] || return 1

  tree=$(git_c rev-parse "$branch_ref^{tree}" 2>/dev/null || true)
  [ -n "$tree" ] || return 1

  dummy_commit=$(git_c commit-tree "$tree" -p "$merge_base" -m _ 2>/dev/null || true)
  [ -n "$dummy_commit" ] || return 1

  cherry_status=$(git_c cherry "refs/remotes/origin/$DEFAULT_BRANCH" "$dummy_commit" 2>/dev/null | cut -c 1 || true)
  [ "$cherry_status" = "-" ]
}

collect_branches() {
  BRANCH_DELETE_LINES=()
  MERGED_BRANCH_LINES=()
  UNIQUE_BRANCH_LINES=()
  BRANCHES_TO_DELETE=()
  LOCAL_BRANCH_DELETE_COUNT=0
  LOCAL_BRANCH_UNIQUE_COUNT=0
  DEFAULT_BRANCH_AHEAD_COMMITS=0

  local branch_ref branch unique_count remote_default_ref
  remote_default_ref="refs/remotes/origin/$DEFAULT_BRANCH"
  while IFS= read -r branch_ref || [ -n "$branch_ref" ]; do
    [ -n "$branch_ref" ] || continue
    branch=${branch_ref#refs/heads/}

    if [ "$branch_ref" = "refs/heads/$DEFAULT_BRANCH" ]; then
      if git_c show-ref --verify --quiet "$remote_default_ref"; then
        DEFAULT_BRANCH_AHEAD_COMMITS=$(git_c rev-list --count "$remote_default_ref..$branch_ref" 2>/dev/null || printf '%s\n' "0")
      fi
      continue
    fi

    LOCAL_BRANCH_DELETE_COUNT=$((LOCAL_BRANCH_DELETE_COUNT + 1))
    BRANCHES_TO_DELETE+=("$branch")
    BRANCH_DELETE_LINES+=("DELETE_BRANCH=$branch")

    if git_c merge-base --is-ancestor "$branch_ref" "$remote_default_ref" 2>/dev/null; then
      MERGED_BRANCH_LINES+=("MERGED_BRANCH=$branch|REASON=ancestor")
    elif branch_is_squash_merged "$branch_ref"; then
      MERGED_BRANCH_LINES+=("MERGED_BRANCH=$branch|REASON=squash")
    else
      unique_count=$(git_c rev-list --count "$remote_default_ref..$branch_ref" 2>/dev/null || printf '%s\n' "1")
      LOCAL_BRANCH_UNIQUE_COUNT=$((LOCAL_BRANCH_UNIQUE_COUNT + 1))
      UNIQUE_BRANCH_LINES+=("UNIQUE_BRANCH=$branch|COMMITS=$unique_count")
    fi
  done < <(git_c for-each-ref --format='%(refname)' refs/heads)
}

compute_status() {
  STATUS="ok"

  if [ "$DIRTY_PRIMARY_COUNT" -gt 0 ]; then
    STATUS="blocked"
  fi

  if [ "$DEFAULT_BRANCH_AHEAD_COMMITS" -gt 0 ]; then
    STATUS="blocked"
  fi

  if [ "$DIRTY_LINKED_COUNT" -gt 0 ]; then
    if [ "$MODE" = "dry-run" ] || [ "$FORCE_DIRTY_WORKTREES" -ne 1 ]; then
      STATUS="blocked"
    fi
  fi

  if [ "$LOCKED_WORKTREE_COUNT" -gt 0 ]; then
    STATUS="blocked"
  fi

  if [ "$LOCAL_BRANCH_UNIQUE_COUNT" -gt 0 ]; then
    if [ "$MODE" = "dry-run" ] || [ "$FORCE_BRANCHES" -ne 1 ]; then
      STATUS="blocked"
    fi
  fi
}

print_report() {
  echo "MODE=$MODE"
  echo "STATUS=$STATUS"
  echo "DEFAULT_BRANCH=$DEFAULT_BRANCH"
  echo "PRIMARY_WORKTREE=$PRIMARY_WORKTREE"
  echo "REMOVABLE_WORKTREES=$(( ${#WORKTREE_PATHS[@]} - 1 ))"
  echo "PRUNABLE_WORKTREES=${#PRUNABLE_WORKTREE_PATHS[@]}"
  echo "LOCKED_WORKTREES=$LOCKED_WORKTREE_COUNT"
  echo "DIRTY_WORKTREES=$DIRTY_WORKTREE_COUNT"
  echo "LOCAL_BRANCHES_TO_DELETE=$LOCAL_BRANCH_DELETE_COUNT"
  echo "LOCAL_BRANCHES_WITH_UNIQUE_COMMITS=$LOCAL_BRANCH_UNIQUE_COUNT"
  echo "DEFAULT_BRANCH_AHEAD_COMMITS=$DEFAULT_BRANCH_AHEAD_COMMITS"

  local index
  for index in "${!WORKTREE_PATHS[@]}"; do
    [ "$index" -eq 0 ] && continue
    echo "REMOVABLE_WORKTREE=${WORKTREE_PATHS[$index]}"
  done
  for index in "${!PRUNABLE_WORKTREE_PATHS[@]}"; do
    echo "PRUNABLE_WORKTREE=${PRUNABLE_WORKTREE_PATHS[$index]}"
  done

  if [ "${#DIRTY_WORKTREE_LINES[@]}" -gt 0 ]; then
    printf '%s\n' "${DIRTY_WORKTREE_LINES[@]}"
  fi
  if [ "${#LOCKED_WORKTREE_LINES[@]}" -gt 0 ]; then
    printf '%s\n' "${LOCKED_WORKTREE_LINES[@]}"
  fi
  if [ "${#BRANCH_DELETE_LINES[@]}" -gt 0 ]; then
    printf '%s\n' "${BRANCH_DELETE_LINES[@]}"
  fi
  if [ "${#MERGED_BRANCH_LINES[@]}" -gt 0 ]; then
    printf '%s\n' "${MERGED_BRANCH_LINES[@]}"
  fi
  if [ "${#UNIQUE_BRANCH_LINES[@]}" -gt 0 ]; then
    printf '%s\n' "${UNIQUE_BRANCH_LINES[@]}"
  fi
}

checkout_and_fast_forward_default() {
  if git_c show-ref --verify --quiet "refs/heads/$DEFAULT_BRANCH"; then
    git -C "$PRIMARY_WORKTREE" checkout "$DEFAULT_BRANCH" >/dev/null
  else
    git -C "$PRIMARY_WORKTREE" checkout -b "$DEFAULT_BRANCH" "origin/$DEFAULT_BRANCH" >/dev/null
  fi

  git -C "$PRIMARY_WORKTREE" merge --ff-only "origin/$DEFAULT_BRANCH" >/dev/null
}

remove_linked_worktrees() {
  local index path dirty

  for index in "${!WORKTREE_PATHS[@]}"; do
    [ "$index" -eq 0 ] && continue
    path=${WORKTREE_PATHS[$index]}
    dirty=$(worktree_status "$path")
    if [ -n "$dirty" ]; then
      if [ "$FORCE_DIRTY_WORKTREES" -ne 1 ]; then
        echo "ERROR=linked worktree became dirty before removal: $path" >&2
        return 1
      fi
      git -C "$PRIMARY_WORKTREE" worktree remove --force "$path"
    else
      git -C "$PRIMARY_WORKTREE" worktree remove "$path"
    fi
  done
}

delete_local_branches() {
  local branch

  for branch in "${BRANCHES_TO_DELETE[@]}"; do
    git -C "$PRIMARY_WORKTREE" branch -D "$branch" >/dev/null
  done
}

[ -n "$TARGET_REPO" ] || TARGET_REPO=$PWD

[ "$(git -C "$TARGET_REPO" rev-parse --is-inside-work-tree 2>/dev/null || printf '%s\n' false)" = "true" ] || die "not inside a git worktree: $TARGET_REPO"
[ "$(git -C "$TARGET_REPO" rev-parse --is-bare-repository 2>/dev/null || printf '%s\n' true)" = "false" ] || die "bare repositories are unsupported"

REPO_ROOT=$(git -C "$TARGET_REPO" rev-parse --show-toplevel)

if [ "$MODE" = "dry-run" ]; then
  git_c fetch origin --prune
fi

DEFAULT_BRANCH=$(resolve_default_branch) || die "could not resolve origin default branch"
git_c show-ref --verify --quiet "refs/remotes/origin/$DEFAULT_BRANCH" || die "origin/$DEFAULT_BRANCH does not exist"

collect_worktrees
PRIMARY_WORKTREE=${WORKTREE_PATHS[0]}
collect_locked_worktrees
collect_dirty_worktrees
collect_branches
compute_status
print_report

if [ "$MODE" = "dry-run" ]; then
  exit 0
fi

if [ "$STATUS" != "ok" ]; then
  exit 1
fi

remove_linked_worktrees
git -C "$PRIMARY_WORKTREE" worktree prune
checkout_and_fast_forward_default
delete_local_branches
git -C "$PRIMARY_WORKTREE" worktree prune
