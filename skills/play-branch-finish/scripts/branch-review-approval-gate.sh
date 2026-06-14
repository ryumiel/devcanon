#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "$1" >&2
  exit 1
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
    fail "branch-review-approval-gate.sh must run from the repository root"
}

current_head_sha() {
  local head_sha

  head_sha="$(git rev-parse HEAD 2>/dev/null)" ||
    fail "failed to determine current HEAD SHA"
  case "$head_sha" in
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f])
      printf '%s\n' "$head_sha"
      ;;
    *) fail "current HEAD SHA must be a 40-character lowercase hex SHA" ;;
  esac
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

validate_approval_summary_path() {
  local file="$1"

  case "$file" in
    .ephemeral/*/*) fail "nested approval summary path rejected: $file" ;;
    .ephemeral/*-approval-summary.json) ;;
    *) fail "approval summary path validation failed: $file" ;;
  esac
  [ "${file#*..}" = "$file" ] || fail "path traversal: $file"
  [ ! -L .ephemeral ] || fail ".ephemeral must be a directory, not a symlink"
  [ -r "$file" ] || fail "approval summary missing or unreadable: $file"
  [ -f "$file" ] || fail "approval summary missing or not a regular file: $file"
  [ ! -L "$file" ] || fail "approval summary must not be a symlink: $file"
}

parse_gate_result() {
  VALIDATOR_OUTPUT="$1" node <<'NODE'
const input = process.env.VALIDATOR_OUTPUT ?? "";
let parsed;
try {
  parsed = JSON.parse(input);
} catch {
  console.error("validator output malformed");
  process.exit(1);
}

if (
  parsed === null ||
  typeof parsed !== "object" ||
  Array.isArray(parsed) ||
  typeof parsed.gate_result !== "string"
) {
  console.error("validator output malformed");
  process.exit(1);
}

process.stdout.write(parsed.gate_result);
NODE
}

branch_review_required="${BRANCH_REVIEW_REQUIRED:-}"
case "$branch_review_required" in
  "" | false)
    printf 'GATE_REQUIRED=false\n'
    exit 0
    ;;
  true) ;;
  *) fail "BRANCH_REVIEW_REQUIRED must be true or false" ;;
esac

require_repo_root
[ -n "${APPROVAL_SUMMARY_FILE:-}" ] || fail "APPROVAL_SUMMARY_FILE is required"
validate_approval_summary_path "$APPROVAL_SUMMARY_FILE"

head_sha="$(current_head_sha)"
validator="$(resolve_validator)"
validator_stdout="$(
  bash "$validator" validate-approval-summary \
    --surface branch-review \
    --head-sha "$head_sha" \
    --approval-summary-file "$APPROVAL_SUMMARY_FILE" \
    --emit-gate-result
)"
gate_result="$(parse_gate_result "$validator_stdout")"

[ "$gate_result" = "passing" ] ||
  fail "branch-review approval gate blocking: validator reported gate_result=$gate_result"

printf 'GATE_REQUIRED=true\n'
printf 'GATE_RESULT=passing\n'
printf 'APPROVED_HEAD_SHA=%s\n' "$head_sha"
