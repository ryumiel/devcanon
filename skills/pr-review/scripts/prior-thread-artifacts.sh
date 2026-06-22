#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-}"
governed_path_pattern='^(docs/(adr|arch|product-requirements|specs|guidelines)/|MAP\.md$|AGENTS\.md$|CONTRIBUTING\.md$)'
max_narrow_changed_files="5"

fail() {
  echo "$1" >&2
  exit 1
}

require_env() {
  local name="$1"
  [ -n "${!name:-}" ] || fail "$name is required"
}

require_repo_root() {
  local git_toplevel
  local physical_toplevel
  local physical_pwd

  git_toplevel="$(git rev-parse --show-toplevel 2>/dev/null)" ||
    fail "failed to determine git repository root"
  physical_toplevel="$(cd "$git_toplevel" && pwd -P)" ||
    fail "failed to resolve git repository root"
  physical_pwd="$(pwd -P)"
  [ "$physical_toplevel" = "$physical_pwd" ] ||
    fail "prior-thread-artifacts.sh must run from the repository root"
}

validate_sha() {
  local label="$1"
  local value="$2"
  case "$value" in
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
    *) fail "$label must be a 40-character lowercase hex SHA" ;;
  esac
}

validate_head_sha() {
  require_env HEAD_SHA
  validate_sha HEAD_SHA "$HEAD_SHA"
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

branch_slug() {
  local raw_branch
  raw_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" ||
    fail "failed to determine current git branch"
  if [ "$raw_branch" = "HEAD" ]; then
    printf 'detached\n'
  else
    slug_branch "$raw_branch"
  fi
}

expected_prior_threads_path() {
  printf '.ephemeral/%s-%s-prior-threads.json\n' "$(branch_slug)" "$HEAD_SHA"
}

expected_scope_decision_path() {
  printf '.ephemeral/%s-%s-scope-decision.json\n' "$(branch_slug)" "$HEAD_SHA"
}

expected_provider_scope_evidence_path() {
  printf '.ephemeral/%s-%s-provider-scope-evidence.json\n' "$(branch_slug)" "$HEAD_SHA"
}

validate_direct_child_path() {
  local label="$1"
  local file="$2"
  local suffix="$3"
  case "$file" in
    .ephemeral/*/*) fail "nested $label path rejected: $file" ;;
    .ephemeral/*"$suffix") ;;
    *) fail "$label path validation failed: $file" ;;
  esac
  [ "${file#*..}" = "$file" ] || fail "path traversal: $file"
}

prepare_write_target() {
  local label="$1"
  local file="$2"

  [ -L .ephemeral ] && fail ".ephemeral must be a directory, not a symlink"
  mkdir -p .ephemeral
  [ ! -L "$file" ] || fail "$label path must not be a symlink: $file"
  [ ! -d "$file" ] || fail "$label path is a directory: $file"
  [ ! -e "$file" ] || [ -f "$file" ] ||
    fail "$label path exists but is not a regular file: $file"
}

validator_from_dir() {
  local script_path="$1"
  local script_dir
  script_dir="$(cd "$(dirname "$script_path")" && pwd)" || return 1
  printf '%s\n' "$(cd "$script_dir/../.." && pwd)/play-validate-review-artifacts/scripts/review-artifacts.sh"
}

resolve_validator() {
  local logical_candidate=""
  local physical_source=""
  local physical_candidate=""

  if [ -n "${PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT:-}" ]; then
    [ -f "$PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT" ] &&
      [ -x "$PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT" ] ||
      fail "play-validate-review-artifacts validator missing"
    printf '%s\n' "$PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT"
    return
  fi

  logical_candidate="$(validator_from_dir "${BASH_SOURCE[0]}")" || true
  if [ -n "$logical_candidate" ] && [ -f "$logical_candidate" ] && [ -x "$logical_candidate" ]; then
    printf '%s\n' "$logical_candidate"
    return
  fi

  physical_source="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/$(basename "${BASH_SOURCE[0]}")"
  physical_candidate="$(validator_from_dir "$physical_source")" || true
  if [ -n "$physical_candidate" ] && [ -f "$physical_candidate" ] && [ -x "$physical_candidate" ]; then
    printf '%s\n' "$physical_candidate"
    return
  fi

  fail "play-validate-review-artifacts validator missing"
}

prepare_prior_threads_write() {
  local file
  require_repo_root
  validate_head_sha
  file="$(expected_prior_threads_path)"
  validate_direct_child_path "prior threads" "$file" "-prior-threads.json"
  prepare_write_target "prior threads" "$file"
  printf '%s\n' "$file"
}

prepare_scope_decision_write() {
  local file
  require_repo_root
  validate_head_sha
  file="$(expected_scope_decision_path)"
  validate_direct_child_path "scope decision" "$file" "-scope-decision.json"
  prepare_write_target "scope decision" "$file"
  printf '%s\n' "$file"
}

validate_prior_threads() {
  local file expected validator
  require_repo_root
  validate_head_sha
  require_env PRIOR_THREADS_FILE
  expected="$(expected_prior_threads_path)"
  file="$PRIOR_THREADS_FILE"
  validate_direct_child_path "prior threads" "$file" "-prior-threads.json"
  [ "$file" = "$expected" ] || fail "prior threads path mismatch: $file"
  validator="$(resolve_validator)"
  bash "$validator" validate-prior-threads \
    --surface pr-review \
    --head-sha "$HEAD_SHA" \
    --prior-threads-file "$file" \
    --expected-schema pr-review/prior-threads/v1 \
    --provider github
}

validate_scope_decision() {
  local file expected validator prior_kind prior_path expected_prior provider_evidence
  require_repo_root
  validate_head_sha
  require_env SCOPE_DECISION_FILE
  require_env BASE_REF
  expected="$(expected_scope_decision_path)"
  file="$SCOPE_DECISION_FILE"
  validate_direct_child_path "scope decision" "$file" "-scope-decision.json"
  [ "$file" = "$expected" ] || fail "scope decision path mismatch: $file"
  require_env PROVIDER_SCOPE_EVIDENCE_FILE
  provider_evidence="$PROVIDER_SCOPE_EVIDENCE_FILE"
  validate_direct_child_path "provider scope evidence" "$provider_evidence" "-provider-scope-evidence.json"
  [ "$provider_evidence" = "$(expected_provider_scope_evidence_path)" ] ||
    fail "provider scope evidence path mismatch: $provider_evidence"
  expected_prior="$(expected_prior_threads_path)"
  prior_kind="none"
  prior_path="null"
  if [ -n "${PRIOR_THREADS_FILE:-}" ]; then
    [ "$PRIOR_THREADS_FILE" = "$expected_prior" ] ||
      fail "prior threads path mismatch: $PRIOR_THREADS_FILE"
    prior_kind="github-prior-threads"
    prior_path="$PRIOR_THREADS_FILE"
  elif [ -f "$expected_prior" ]; then
    prior_kind="github-prior-threads"
    prior_path="$expected_prior"
  fi
  validator="$(resolve_validator)"
  bash "$validator" validate-scope-decision \
    --surface pr-review \
    --head-sha "$HEAD_SHA" \
    --base-ref "$BASE_REF" \
    --scope-decision-file "$file" \
    --provider-scope-evidence-file "$provider_evidence" \
    --expected-schema pr-review/scope-decision/v1 \
    --expected-prior-context-kind "$prior_kind" \
    --expected-prior-context-path "$prior_path" \
    --governed-path-pattern "$governed_path_pattern" \
    --max-narrow-changed-files "$max_narrow_changed_files"
}

case "$command_name" in
  prepare-prior-threads-write)
    prepare_prior_threads_write
    ;;
  validate-prior-threads)
    validate_prior_threads
    ;;
  prepare-scope-decision-write)
    prepare_scope_decision_write
    ;;
  validate-scope-decision)
    validate_scope_decision
    ;;
  *)
    fail "usage: prior-thread-artifacts.sh prepare-prior-threads-write|validate-prior-threads|prepare-scope-decision-write|validate-scope-decision"
    ;;
esac
