#!/usr/bin/env bash
set -euo pipefail

WORKTREE_CLEANUP="skipped"
WORKTREE_CLEANUP_REASON="not-attempted"
BASE_UPDATE="skipped"
BASE_UPDATE_REASON="not-attempted"
LOCAL_BRANCH_CLEANUP="skipped"
LOCAL_BRANCH_CLEANUP_REASON="not-attempted"
REMOTE_BRANCH_CLEANUP="skipped"
REMOTE_BRANCH_CLEANUP_REASON="not-attempted"
MANUAL_ACTIONS=()

emit_line() {
  local key="$1"
  local value="$2"
  printf '%s=%s\n' "$key" "$value"
}

emit_report() {
  local manual_action="none"
  if [ "${#MANUAL_ACTIONS[@]}" -gt 0 ]; then
    manual_action="$(IFS='; '; printf '%s' "${MANUAL_ACTIONS[*]}")"
  fi

  emit_line "WORKTREE_CLEANUP" "$WORKTREE_CLEANUP"
  emit_line "WORKTREE_CLEANUP_REASON" "$WORKTREE_CLEANUP_REASON"
  emit_line "BASE_UPDATE" "$BASE_UPDATE"
  emit_line "BASE_UPDATE_REASON" "$BASE_UPDATE_REASON"
  emit_line "LOCAL_BRANCH_CLEANUP" "$LOCAL_BRANCH_CLEANUP"
  emit_line "LOCAL_BRANCH_CLEANUP_REASON" "$LOCAL_BRANCH_CLEANUP_REASON"
  emit_line "REMOTE_BRANCH_CLEANUP" "$REMOTE_BRANCH_CLEANUP"
  emit_line "REMOTE_BRANCH_CLEANUP_REASON" "$REMOTE_BRANCH_CLEANUP_REASON"
  emit_line "MANUAL_ACTION" "$manual_action"
}

die() {
  echo "ERROR=$*" >&2
  exit 2
}

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    die "Missing required environment variable: ${name}"
  fi
}

validate_branch_value() {
  local name="$1"
  local value="${!name:-}"

  case "$value" in
    "" | -* | *$'\n'* | *$'\r'*)
      die "Unsafe ${name}: ${value}"
      ;;
  esac

  git check-ref-format --branch "$value" >/dev/null 2>&1 || {
    die "Invalid ${name}: ${value}"
  }
}

validate_sha() {
  case "$PR_HEAD_SHA" in
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f])
      ;;
    *)
      die "PR_HEAD_SHA must be a 40-character lowercase hex SHA"
      ;;
  esac
}

canonical_path() {
  local target="$1"
  if [ -z "$target" ] || [ ! -d "$target" ]; then
    return 1
  fi
  (cd "$target" && pwd -P)
}

normalize_remote_url() {
  local remote_url="$1"

  case "$remote_url" in
    git@github.com:*)
      remote_url="https://github.com/${remote_url#git@github.com:}"
      ;;
    ssh://git@github.com/*)
      remote_url="https://github.com/${remote_url#ssh://git@github.com/}"
      ;;
    file://*)
      remote_url="${remote_url#file://}"
      ;;
  esac

  case "$remote_url" in
    /*)
      if [ -e "$remote_url" ]; then
        canonical_path "$remote_url"
        return 0
      fi
      ;;
  esac

  remote_url="${remote_url%/}"
  remote_url="${remote_url%.git}"
  printf '%s\n' "$remote_url"
}

worktree_status() {
  git -C "$1" status --porcelain=v1 --untracked-files=normal
}

worktree_locked_reason() {
  local target="$1"
  local current_path=""
  local current_locked="false"
  local current_reason=""
  local target_real="$2"
  local current_real=""
  local line

  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "")
        if [ -n "$current_path" ] && current_real="$(canonical_path "$current_path" 2>/dev/null)" && [ "$current_real" = "$target_real" ] && [ "$current_locked" = "true" ]; then
          printf '%s\n' "$current_reason"
          return 0
        fi
        current_path=""
        current_locked="false"
        current_reason=""
        ;;
      worktree\ *)
        current_path="${line#worktree }"
        ;;
      locked*)
        current_locked="true"
        current_reason="${line#locked}"
        current_reason="${current_reason# }"
        ;;
    esac
  done < <(git -C "$PRIMARY_WORKTREE_REAL" worktree list --porcelain)

  if [ -n "$current_path" ] && current_real="$(canonical_path "$current_path" 2>/dev/null)" && [ "$current_real" = "$target_real" ] && [ "$current_locked" = "true" ]; then
    printf '%s\n' "$current_reason"
    return 0
  fi

  return 1
}

branch_checked_out() {
  local branch="$1"
  git -C "$PRIMARY_WORKTREE_REAL" worktree list --porcelain | grep -Fqx "branch refs/heads/${branch}"
}

manual() {
  MANUAL_ACTIONS+=("$1")
}

require_env "PR_STATE"
require_env "PR_HEAD_BRANCH"
require_env "PR_BASE_BRANCH"
require_env "PR_HEAD_SHA"
require_env "PR_HEAD_REPO"
require_env "PR_BASE_REPO"
require_env "PR_BASE_DEFAULT_BRANCH"
require_env "PR_BASE_REMOTE_URL"
require_env "PRIMARY_WORKTREE"

validate_branch_value "PR_HEAD_BRANCH"
validate_branch_value "PR_BASE_BRANCH"
validate_branch_value "PR_BASE_DEFAULT_BRANCH"
validate_sha

PRIMARY_WORKTREE_REAL="$(canonical_path "$PRIMARY_WORKTREE")" || {
  die "PRIMARY_WORKTREE does not resolve to a directory: ${PRIMARY_WORKTREE}"
}
HEAD_WORKTREE_REAL=""
CURRENT_WORKTREE_REAL=""
if [ -n "${HEAD_WORKTREE:-}" ]; then
  HEAD_WORKTREE_REAL="$(canonical_path "$HEAD_WORKTREE" 2>/dev/null || true)"
fi
if [ -n "${CURRENT_WORKTREE:-}" ]; then
  CURRENT_WORKTREE_REAL="$(canonical_path "$CURRENT_WORKTREE" 2>/dev/null || true)"
fi

HEAD_BRANCH_PROTECTED="false"

if [ "$PR_STATE" != "MERGED" ]; then
  WORKTREE_CLEANUP_REASON="pr-not-merged"
  BASE_UPDATE_REASON="pr-not-merged"
  LOCAL_BRANCH_CLEANUP_REASON="pr-not-merged"
  REMOTE_BRANCH_CLEANUP_REASON="pr-not-merged"
  manual "verify PR state before cleanup"
  emit_report
  exit 0
fi

if [ -z "$HEAD_WORKTREE_REAL" ]; then
  WORKTREE_CLEANUP_REASON="no-head-worktree"
elif [ "$HEAD_WORKTREE_REAL" = "$PRIMARY_WORKTREE_REAL" ]; then
  WORKTREE_CLEANUP="retained"
  if [ -n "$(worktree_status "$PRIMARY_WORKTREE_REAL")" ]; then
    WORKTREE_CLEANUP_REASON="dirty-or-untracked-primary-head-worktree"
    BASE_UPDATE="skipped"
    BASE_UPDATE_REASON="dirty-or-untracked-primary-head-worktree"
    HEAD_BRANCH_PROTECTED="true"
    manual "inspect dirty primary worktree manually: $PRIMARY_WORKTREE_REAL"
  else
    WORKTREE_CLEANUP_REASON="head-worktree-is-primary"
  fi
  manual "review primary worktree before manual cleanup"
else
  if locked_reason="$(worktree_locked_reason "$HEAD_WORKTREE" "$HEAD_WORKTREE_REAL")"; then
    WORKTREE_CLEANUP="retained"
    WORKTREE_CLEANUP_REASON="locked-worktree${locked_reason:+:$locked_reason}"
    manual "unlock or remove worktree manually: $HEAD_WORKTREE_REAL"
  elif [ -n "$(worktree_status "$HEAD_WORKTREE_REAL")" ]; then
    WORKTREE_CLEANUP="retained"
    WORKTREE_CLEANUP_REASON="dirty-or-untracked-worktree"
    HEAD_BRANCH_PROTECTED="true"
    manual "inspect dirty worktree manually: $HEAD_WORKTREE_REAL"
  elif cd "$PRIMARY_WORKTREE_REAL" && git worktree remove "$HEAD_WORKTREE_REAL"; then
    WORKTREE_CLEANUP="removed"
    WORKTREE_CLEANUP_REASON="$HEAD_WORKTREE_REAL"
  else
    WORKTREE_CLEANUP="failed"
    WORKTREE_CLEANUP_REASON="git-worktree-remove-failed"
    manual "remove worktree manually: $HEAD_WORKTREE_REAL"
  fi
fi

if [ "$BASE_UPDATE" = "skipped" ] && [ "$BASE_UPDATE_REASON" = "not-attempted" ]; then
  if git -C "$PRIMARY_WORKTREE_REAL" checkout "$PR_BASE_BRANCH" >/dev/null 2>&1 && git -C "$PRIMARY_WORKTREE_REAL" pull --ff-only >/dev/null 2>&1; then
    BASE_UPDATE="updated"
    BASE_UPDATE_REASON="$PR_BASE_BRANCH"
  else
    BASE_UPDATE="failed"
    BASE_UPDATE_REASON="checkout-or-pull-failed"
    manual "update base branch manually: $PR_BASE_BRANCH"
  fi
fi

if [ "$PR_HEAD_BRANCH" = "$PR_BASE_BRANCH" ] || [ "$PR_HEAD_BRANCH" = "$PR_BASE_DEFAULT_BRANCH" ]; then
  LOCAL_BRANCH_CLEANUP="retained"
  LOCAL_BRANCH_CLEANUP_REASON="head-is-base-or-default"
  manual "do not delete protected branch: $PR_HEAD_BRANCH"
elif ! git -C "$PRIMARY_WORKTREE_REAL" show-ref --verify --quiet "refs/heads/${PR_HEAD_BRANCH}"; then
  LOCAL_BRANCH_CLEANUP="skipped"
  LOCAL_BRANCH_CLEANUP_REASON="local-branch-missing"
else
  LOCAL_TIP="$(git -C "$PRIMARY_WORKTREE_REAL" rev-parse "refs/heads/${PR_HEAD_BRANCH}")"
  if [ "$LOCAL_TIP" != "$PR_HEAD_SHA" ]; then
    LOCAL_BRANCH_CLEANUP="retained"
    LOCAL_BRANCH_CLEANUP_REASON="local-tip-mismatch"
    manual "inspect local branch before deletion: $PR_HEAD_BRANCH"
  elif [ "$HEAD_BRANCH_PROTECTED" = "true" ]; then
    LOCAL_BRANCH_CLEANUP="retained"
    LOCAL_BRANCH_CLEANUP_REASON="dirty-or-untracked-head-worktree"
    manual "preserve local branch until dirty worktree is resolved: $PR_HEAD_BRANCH"
  elif branch_checked_out "$PR_HEAD_BRANCH"; then
    LOCAL_BRANCH_CLEANUP="retained"
    LOCAL_BRANCH_CLEANUP_REASON="branch-still-checked-out"
    manual "remove or switch worktree holding branch: $PR_HEAD_BRANCH"
  elif git -C "$PRIMARY_WORKTREE_REAL" branch -D "$PR_HEAD_BRANCH" >/dev/null 2>&1; then
    LOCAL_BRANCH_CLEANUP="deleted"
    LOCAL_BRANCH_CLEANUP_REASON="$PR_HEAD_BRANCH"
  else
    LOCAL_BRANCH_CLEANUP="failed"
    LOCAL_BRANCH_CLEANUP_REASON="git-branch-delete-failed"
    manual "delete local branch manually after inspection: $PR_HEAD_BRANCH"
  fi
fi

if [ "$PR_HEAD_REPO" != "$PR_BASE_REPO" ]; then
  REMOTE_BRANCH_CLEANUP="retained"
  REMOTE_BRANCH_CLEANUP_REASON="fork-head-repo"
elif [ "$PR_HEAD_BRANCH" = "$PR_BASE_BRANCH" ] || [ "$PR_HEAD_BRANCH" = "$PR_BASE_DEFAULT_BRANCH" ]; then
  REMOTE_BRANCH_CLEANUP="retained"
  REMOTE_BRANCH_CLEANUP_REASON="head-is-base-or-default"
else
  origin_url="$(git -C "$PRIMARY_WORKTREE_REAL" remote get-url origin 2>/dev/null || true)"
  origin_url_normalized="$(normalize_remote_url "$origin_url")"
  base_remote_url_normalized="$(normalize_remote_url "$PR_BASE_REMOTE_URL")"
  if [ -z "$origin_url_normalized" ] || [ "$origin_url_normalized" != "$base_remote_url_normalized" ]; then
    REMOTE_BRANCH_CLEANUP="retained"
    REMOTE_BRANCH_CLEANUP_REASON="origin-not-base-remote"
    manual "delete remote branch manually from verified base repository: $PR_HEAD_BRANCH"
    emit_report
    exit 0
  fi

  remote_ref="refs/heads/${PR_HEAD_BRANCH}"
  remote_listing="$(git -C "$PRIMARY_WORKTREE_REAL" ls-remote --heads origin 2>/dev/null || true)"
  remote_sha="$(printf '%s\n' "$remote_listing" | awk -v ref="$remote_ref" '$2 == ref { print $1; exit }')"
  if [ -z "$remote_sha" ]; then
    REMOTE_BRANCH_CLEANUP="skipped"
    REMOTE_BRANCH_CLEANUP_REASON="remote-branch-missing"
  elif [ "$remote_sha" != "$PR_HEAD_SHA" ]; then
    REMOTE_BRANCH_CLEANUP="retained"
    REMOTE_BRANCH_CLEANUP_REASON="remote-tip-mismatch"
    manual "inspect remote branch before deletion: $PR_HEAD_BRANCH"
  elif git -C "$PRIMARY_WORKTREE_REAL" push origin ":refs/heads/${PR_HEAD_BRANCH}" >/dev/null 2>&1; then
    REMOTE_BRANCH_CLEANUP="deleted"
    REMOTE_BRANCH_CLEANUP_REASON="$PR_HEAD_BRANCH"
  else
    REMOTE_BRANCH_CLEANUP="failed"
    REMOTE_BRANCH_CLEANUP_REASON="git-push-delete-failed"
    manual "delete remote branch manually after inspection: $PR_HEAD_BRANCH"
  fi
fi

emit_report
