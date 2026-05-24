#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-}"

usage() {
  echo "usage: phase-artifacts.sh validate-read <kind> <repo-relative-path>" >&2
  exit 1
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
    echo "phase-artifacts.sh must run from the repository root" >&2
    exit 1
  }
}

artifact_label() {
  case "$1" in
    issue-body) printf '%s\n' "issue body" ;;
    comment-evidence) printf '%s\n' "comment evidence" ;;
    research) printf '%s\n' "research" ;;
    design) printf '%s\n' "design" ;;
    plan) printf '%s\n' "plan" ;;
    *)
      echo "unknown phase artifact kind: $1" >&2
      exit 1
      ;;
  esac
}

artifact_suffix() {
  case "$1" in
    issue-body) printf '%s\n' "-issue-body.md" ;;
    comment-evidence) printf '%s\n' "-comment-evidence.md" ;;
    research) printf '%s\n' "-research.md" ;;
    design) printf '%s\n' "-design.md" ;;
    plan) printf '%s\n' "-plan.md" ;;
    *)
      echo "unknown phase artifact kind: $1" >&2
      exit 1
      ;;
  esac
}

validate_direct_child_path() {
  local label="$1"
  local suffix="$2"
  local file="$3"

  case "$file" in
    .ephemeral/*/*)
      echo "nested $label path rejected: $file" >&2
      exit 1
      ;;
    .ephemeral/*"$suffix") ;;
    *)
      echo "$label path validation failed: $file" >&2
      exit 1
      ;;
  esac

  [ "${file#*..}" = "$file" ] || {
    echo "path traversal: $file" >&2
    exit 1
  }
}

assert_readable_regular_file() {
  local label="$1"
  local file="$2"

  [ -L .ephemeral ] && {
    echo ".ephemeral must be a directory, not a symlink" >&2
    exit 1
  }
  [ ! -L "$file" ] || {
    echo "$label must not be a symlink: $file" >&2
    exit 1
  }
  [ -f "$file" ] || {
    echo "$label missing or not a regular file: $file" >&2
    exit 1
  }
  [ -r "$file" ] || {
    echo "$label missing or unreadable: $file" >&2
    exit 1
  }
}

case "$command_name" in
  validate-read)
    [ "$#" -eq 3 ] || usage
    require_repo_root
    kind="$2"
    artifact_path="$3"
    label="$(artifact_label "$kind")"
    suffix="$(artifact_suffix "$kind")"
    validate_direct_child_path "$label" "$suffix" "$artifact_path"
    assert_readable_regular_file "$label" "$artifact_path"
    ;;
  *)
    usage
    ;;
esac
