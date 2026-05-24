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
    echo "write-research-brief.sh must run from the repository root" >&2
    exit 1
  }
}

slug_identifier() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | tr '/' '-' \
    | tr -cd '[:alnum:]._-'
}

validate_research_brief_path() {
  local file="$1"

  case "$file" in
    .ephemeral/*/*)
      echo "nested research brief path rejected: $file" >&2
      exit 1
      ;;
    .ephemeral/*-research.md) ;;
    *)
      echo "research brief path validation failed: $file" >&2
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
    echo "research brief must not be a symlink: $file" >&2
    exit 1
  }
  [ ! -d "$file" ] || {
    echo "research brief path is a directory: $file" >&2
    exit 1
  }
  [ ! -e "$file" ] || [ -f "$file" ] || {
    echo "research brief path exists but is not a regular file: $file" >&2
    exit 1
  }
}

require_env ISSUE_IDENTIFIER
require_env ISSUE_PRIMING_TODAY
require_repo_root

identifier_slug="$(slug_identifier "$ISSUE_IDENTIFIER")"
research_brief_path=".ephemeral/${ISSUE_PRIMING_TODAY}-${identifier_slug}-research.md"

case "$ISSUE_PRIMING_TODAY" in
  [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;;
  *)
    echo "research brief path validation failed: $research_brief_path" >&2
    exit 1
    ;;
esac

validate_research_brief_path "$research_brief_path"
prepare_write_target "$research_brief_path"
printf '%s\n' "$research_brief_path"
