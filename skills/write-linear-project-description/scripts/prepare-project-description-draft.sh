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
    echo "prepare-project-description-draft.sh must run from the repository root" >&2
    exit 1
  }
}

validate_project_key() {
  local value="$1"

  case "$value" in
    "" | "." | ".." | /* | -* | */* | *".."* | *$'\n'* | *$'\r'*)
      echo "unsafe PROJECT_KEY: $value" >&2
      exit 1
      ;;
  esac

  case "$value" in
    *[!A-Za-z0-9._-]*)
      echo "unsafe PROJECT_KEY: $value" >&2
      exit 1
      ;;
  esac
}

validate_target_fields() {
  case "$TARGET_FIELDS" in
    description | content | both) ;;
    *)
      echo "invalid TARGET_FIELDS: $TARGET_FIELDS" >&2
      exit 1
      ;;
  esac
}

validate_replace_existing() {
  case "$REPLACE_EXISTING" in
    true | false) ;;
    *)
      echo "invalid REPLACE_EXISTING: $REPLACE_EXISTING" >&2
      exit 1
      ;;
  esac
}

validate_draft_path() {
  local file="$1"

  case "$file" in
    .ephemeral/*/*)
      echo "nested draft path rejected: $file" >&2
      exit 1
      ;;
    .ephemeral/*-project-description-draft.md | .ephemeral/*-project-content-brief-draft.md) ;;
    *)
      echo "draft path validation failed: $file" >&2
      exit 1
      ;;
  esac

  [ "${file#*..}" = "$file" ] || {
    echo "path traversal: $file" >&2
    exit 1
  }
}

prepare_ephemeral_dir() {
  [ -L .ephemeral ] && {
    echo ".ephemeral must be a directory, not a symlink" >&2
    exit 1
  }
  mkdir -p .ephemeral
  [ -L .ephemeral ] && {
    echo ".ephemeral must be a directory, not a symlink" >&2
    exit 1
  }
  return 0
}

prepare_draft_target() {
  local file="$1"

  validate_draft_path "$file"
  [ ! -L "$file" ] || {
    echo "draft must not be a symlink: $file" >&2
    exit 1
  }
  [ ! -d "$file" ] || {
    echo "draft path is a directory: $file" >&2
    exit 1
  }
  if [ -e "$file" ] && [ ! -f "$file" ]; then
    echo "draft path exists but is not a regular file: $file" >&2
    exit 1
  fi
  if [ -f "$file" ] && [ "$REPLACE_EXISTING" != "true" ]; then
    echo "draft path already exists: $file" >&2
    exit 1
  fi
}

emit_path() {
  local file="$1"
  printf '%s\n' "$file"
}

require_env PROJECT_KEY
require_env TARGET_FIELDS
require_env REPLACE_EXISTING
require_repo_root
validate_project_key "$PROJECT_KEY"
validate_target_fields
validate_replace_existing
prepare_ephemeral_dir

description_path=".ephemeral/${PROJECT_KEY}-project-description-draft.md"
content_path=".ephemeral/${PROJECT_KEY}-project-content-brief-draft.md"

case "$TARGET_FIELDS" in
  description)
    prepare_draft_target "$description_path"
    emit_path "$description_path"
    ;;
  content)
    prepare_draft_target "$content_path"
    emit_path "$content_path"
    ;;
  both)
    prepare_draft_target "$description_path"
    prepare_draft_target "$content_path"
    emit_path "$description_path"
    emit_path "$content_path"
    ;;
esac
