#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "$name is required" >&2
    exit 1
  fi
}

require_repo_root() {
  local git_toplevel
  local physical_toplevel
  local physical_pwd
  git_toplevel="$(git rev-parse --show-toplevel 2>/dev/null)" || {
    echo "failed to determine git repository root" >&2
    exit 1
  }
  physical_toplevel="$(cd "$git_toplevel" && pwd -P)" || {
    echo "failed to resolve git repository root" >&2
    exit 1
  }
  physical_pwd="$(pwd -P)"
  [ "$physical_toplevel" = "$physical_pwd" ] || {
    echo "write-assumptions-comment.sh must run from the repository root" >&2
    exit 1
  }
}

slug_identifier() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | tr '/' '-' \
    | tr -cd '[:alnum:]._-'
}

validate_assumptions_comment_path() {
  local file="$1"

  case "$file" in
    .ephemeral/*/*)
      echo "assumptions_comment_file must be a direct child of .ephemeral: $file" >&2
      exit 1
      ;;
    .ephemeral/*-assumptions-comment.md) ;;
    *)
      echo "assumptions_comment_file path validation failed: $file" >&2
      exit 1
      ;;
  esac

  [ "${file#*..}" = "$file" ] || {
    echo "path traversal: $file" >&2
    exit 1
  }
}

prepare_write_target() {
  local file="$1"

  [ -L .ephemeral ] && {
    echo ".ephemeral must be a directory, not a symlink" >&2
    exit 1
  }
  mkdir -p .ephemeral
  [ ! -L "$file" ] || {
    echo "assumptions comment must not be a symlink: $file" >&2
    exit 1
  }
  [ ! -d "$file" ] || {
    echo "assumptions comment path is a directory: $file" >&2
    exit 1
  }
  [ ! -e "$file" ] || [ -f "$file" ] || {
    echo "assumptions comment path exists but is not a regular file: $file" >&2
    exit 1
  }
}

require_env ISSUE_IDENTIFIER
require_repo_root

if [ -n "${ASSUMPTIONS_COMMENT_FILE:-}" ]; then
  assumptions_comment_file="$ASSUMPTIONS_COMMENT_FILE"
else
  identifier_slug="$(slug_identifier "$ISSUE_IDENTIFIER")"
  assumptions_comment_file=".ephemeral/${identifier_slug}-assumptions-comment.md"
fi

validate_assumptions_comment_path "$assumptions_comment_file"
prepare_write_target "$assumptions_comment_file"
printf '%s\n' "$assumptions_comment_file"
