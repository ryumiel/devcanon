#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-}"

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "$name is required" >&2
    exit 1
  fi
}

require_jq() {
  command -v jq >/dev/null 2>&1 || {
    echo "jq is required to validate play-review/findings/v1" >&2
    exit 1
  }
}

require_repo_root() {
  local git_toplevel
  local physical_pwd
  git_toplevel="$(git rev-parse --show-toplevel 2>/dev/null)" || {
    echo "failed to determine git repository root" >&2
    exit 1
  }
  physical_pwd="$(pwd -P)"
  [ "$git_toplevel" = "$physical_pwd" ] || {
    echo "review-artifacts.sh must run from the repository root" >&2
    exit 1
  }
}

validate_head_sha() {
  require_env HEAD_SHA
  case "$HEAD_SHA" in
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
    *)
      echo "HEAD_SHA must be a 40-character lowercase hex SHA" >&2
      exit 1
      ;;
  esac
}

validate_findings_path_shape() {
  local findings_file="$1"
  local expected_findings_file
  case "$findings_file" in
    .ephemeral/*/*)
      echo "nested findings path rejected: $findings_file" >&2
      exit 1
      ;;
    .ephemeral/*-findings.json) ;;
    *)
      echo "findings path validation failed: $findings_file" >&2
      exit 1
      ;;
  esac
  [ "${findings_file#*..}" = "$findings_file" ] || {
    echo "path traversal: $findings_file" >&2
    exit 1
  }
  expected_findings_file="$(expected_findings_path)"
  [ "$findings_file" = "$expected_findings_file" ] || {
    echo "findings path mismatch: $findings_file" >&2
    exit 1
  }
}

validate_nits_path_shape() {
  local nits_file="$1"
  case "$nits_file" in
    .ephemeral/*/*)
      echo "nested nits_file path rejected: $nits_file" >&2
      exit 1
      ;;
    .ephemeral/*-findings.json | .ephemeral/*-nits-pending.json) ;;
    *)
      echo "nits_file path validation failed: $nits_file" >&2
      exit 1
      ;;
  esac
  [ "${nits_file#*..}" = "$nits_file" ] || {
    echo "path traversal: $nits_file" >&2
    exit 1
  }
}

assert_readable_envelope() {
  local label="$1"
  local file="$2"
  require_jq
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
  jq -e '.schema == "play-review/findings/v1"' "$file" >/dev/null || {
    echo "envelope schema mismatch: $file" >&2
    exit 1
  }
}

prepare_write_target() {
  local label="$1"
  local file="$2"
  [ -L .ephemeral ] && {
    echo ".ephemeral must be a directory, not a symlink" >&2
    exit 1
  }
  mkdir -p .ephemeral
  [ -L "$file" ] && rm "$file"
  [ ! -d "$file" ] || {
    echo "$label path is a directory: $file" >&2
    exit 1
  }
  [ ! -e "$file" ] || [ -f "$file" ] || {
    echo "$label path exists but is not a regular file: $file" >&2
    exit 1
  }
}

slug_branch() {
  local branch_name="$1"
  local slug
  slug=$(printf '%s' "$branch_name" | tr '/' '-' | tr -cd '[:alnum:]._-')
  case "$slug" in
    "" | "." | ".." | -* | .*) slug="unnamed" ;;
  esac
  printf '%s\n' "$slug"
}

expected_findings_path() {
  local raw_branch
  local branch_slug
  raw_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" || {
    echo "failed to determine current git branch" >&2
    exit 1
  }
  if [ "$raw_branch" = "HEAD" ]; then
    branch_slug="detached"
  else
    branch_slug="$(slug_branch "$raw_branch")"
  fi
  printf '.ephemeral/%s-%s-findings.json\n' "$branch_slug" "$HEAD_SHA"
}

case "$command_name" in
  validate-findings)
    require_repo_root
    validate_head_sha
    require_env FINDINGS_FILE
    validate_findings_path_shape "$FINDINGS_FILE"
    assert_readable_envelope "findings file" "$FINDINGS_FILE"
    ;;
  validate-nits-file)
    require_repo_root
    require_env NITS_FILE
    validate_nits_path_shape "$NITS_FILE"
    assert_readable_envelope "nits_file" "$NITS_FILE"
    ;;
  derive-nits-pending)
    require_repo_root
    validate_head_sha
    require_env FINDINGS_FILE
    validate_findings_path_shape "$FINDINGS_FILE"
    assert_readable_envelope "findings file" "$FINDINGS_FILE"
    NITS_PENDING_FILE="${FINDINGS_FILE%-findings.json}-nits-pending.json"
    validate_nits_path_shape "$NITS_PENDING_FILE"
    prepare_write_target "nits pending" "$NITS_PENDING_FILE"
    printf '%s\n' "$NITS_PENDING_FILE"
    ;;
  prepare-findings-write)
    require_repo_root
    validate_head_sha
    if [ -z "${FINDINGS_FILE:-}" ]; then
      FINDINGS_FILE="$(expected_findings_path)"
    fi
    validate_findings_path_shape "$FINDINGS_FILE"
    prepare_write_target "findings" "$FINDINGS_FILE"
    printf '%s\n' "$FINDINGS_FILE"
    ;;
  *)
    echo "usage: review-artifacts.sh validate-findings|validate-nits-file|derive-nits-pending|prepare-findings-write" >&2
    exit 1
    ;;
esac
