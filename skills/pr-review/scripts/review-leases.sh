#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-}"

fail() {
  echo "$1" >&2
  exit 1
}

require_env() {
  local name="$1"
  [ -n "${!name:-}" ] || fail "$name is required"
}

require_jq() {
  command -v jq >/dev/null 2>&1 ||
    fail "jq is required to validate pr-review leases"
}

sha256_text() {
  local value="$1"
  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "$value" | shasum -a 256 | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$value" | sha256sum | awk '{print $1}'
  else
    fail "shasum or sha256sum is required"
  fi
}

require_repo_root() {
  local git_toplevel physical_toplevel physical_pwd physical_primary
  require_env PRIMARY_REPOSITORY_ROOT
  case "$PRIMARY_REPOSITORY_ROOT" in
    /* | [A-Za-z]:/* | [A-Za-z]:\\*) ;;
    *) fail "PRIMARY_REPOSITORY_ROOT must be absolute" ;;
  esac
  [ -d "$PRIMARY_REPOSITORY_ROOT" ] ||
    fail "PRIMARY_REPOSITORY_ROOT missing or not a directory: $PRIMARY_REPOSITORY_ROOT"
  git_toplevel="$(git rev-parse --show-toplevel 2>/dev/null)" ||
    fail "failed to determine git repository root"
  physical_toplevel="$(cd "$git_toplevel" && pwd -P)" ||
    fail "failed to resolve git repository root"
  physical_pwd="$(pwd -P)"
  physical_primary="$(cd "$PRIMARY_REPOSITORY_ROOT" && pwd -P)" ||
    fail "failed to resolve PRIMARY_REPOSITORY_ROOT"
  [ "$physical_toplevel" = "$physical_pwd" ] ||
    fail "review-leases.sh must run from the primary repository root"
  [ "$physical_primary" = "$physical_pwd" ] ||
    fail "PRIMARY_REPOSITORY_ROOT must match the primary repository root"
}

validate_repository() {
  require_env REPOSITORY
  case "$REPOSITORY" in
    */*)
      case "$REPOSITORY" in
        *[[:space:]]* | /* | */ | */*/*) fail "REPOSITORY must be owner/name" ;;
      esac
      ;;
    *) fail "REPOSITORY must be owner/name" ;;
  esac
}

validate_pr_number_value() {
  local value="$1"
  case "$value" in
    '' | *[!0-9]*) fail "PR_NUMBER must be a positive integer" ;;
    0) fail "PR_NUMBER must be a positive integer" ;;
  esac
}

validate_pr_number() {
  require_env PR_NUMBER
  validate_pr_number_value "$PR_NUMBER"
}

validate_sha_value() {
  local label="$1"
  local value="$2"
  case "$value" in
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
    *) fail "$label must be a 40-character lowercase hex SHA" ;;
  esac
}

validate_ref_value() {
  local label="$1"
  local value="$2"
  [ -n "$value" ] || fail "$label is required"
  case "$value" in
    *$'\n'* | *$'\r'* | *$'\t'* | *' '*) fail "$label must be a non-empty single-line ref" ;;
  esac
}

validate_refs() {
  require_env BASE_REF
  require_env HEAD_REF
  validate_ref_value BASE_REF "$BASE_REF"
  validate_ref_value HEAD_REF "$HEAD_REF"
}

validate_timestamp_value() {
  local label="$1"
  local value="$2"
  local normalized=""

  case "$value" in
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z) ;;
    *) fail "$label must be a UTC RFC3339 timestamp ending in Z" ;;
  esac

  if normalized="$(date -u -d "$value" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null)"; then
    :
  elif normalized="$(date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$value" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null)"; then
    :
  else
    normalized="$(
      printf '%s\n' "$value" |
        jq -Rr 'fromdateiso8601 | strftime("%Y-%m-%dT%H:%M:%SZ")' 2>/dev/null
    )" || fail "$label is not a valid UTC timestamp"
  fi
  [ "$normalized" = "$value" ] || fail "$label is not a valid UTC timestamp"
}

is_windows_absolute_path() {
  case "$1" in
    [A-Za-z]:/* | [A-Za-z]:\\*) return 0 ;;
    *) return 1 ;;
  esac
}

is_windows_path_environment() {
  case "${OSTYPE:-}" in
    msys* | cygwin*) return 0 ;;
  esac
  case "${MSYSTEM:-}" in
    MINGW* | MSYS* | CYGWIN*) return 0 ;;
  esac
  case "$(uname -s 2>/dev/null)" in
    MINGW* | MSYS* | CYGWIN*) return 0 ;;
  esac
  return 1
}

normalize_absolute_path_text() {
  local path_value="$1"
  if is_windows_absolute_path "$path_value" || is_windows_path_environment; then
    path_value="${path_value//\\//}"
  fi
  case "$path_value" in
    [A-Za-z]:/*) ;;
    /[A-Za-z]/*)
      if is_windows_path_environment; then
        path_value="${path_value:1:1}:${path_value:2}"
      else
        printf '%s\n' "$path_value"
        return
      fi
      ;;
    *)
      printf '%s\n' "$path_value"
      return
      ;;
  esac
  path_value="$(printf '%s\n' "$path_value" | tr '[:upper:]' '[:lower:]')"
  printf '%s\n' "$path_value"
}

physical_worktree_path() {
  require_env WORKTREE_PATH
  case "$WORKTREE_PATH" in
    /* | [A-Za-z]:/* | [A-Za-z]:\\*) ;;
    *) fail "WORKTREE_PATH must be absolute" ;;
  esac
  [ -d "$WORKTREE_PATH" ] || fail "WORKTREE_PATH missing or not a directory: $WORKTREE_PATH"
  local physical_path primary_path
  physical_path="$(cd "$WORKTREE_PATH" && pwd -P)" ||
    fail "failed to resolve WORKTREE_PATH"
  primary_path="$(pwd -P)"
  [ "$physical_path" != "$primary_path" ] ||
    fail "WORKTREE_PATH must be a review worktree, not the primary repository root"
  printf '%s\n' "$physical_path"
}

worktree_digest_for() {
  local physical_path="$1"
  sha256_text "$(normalize_absolute_path_text "$physical_path")"
}

expected_lease_path_for() {
  local pr_number="$1"
  local digest="$2"
  printf '.ephemeral/pr-%s-%s-lease.json\n' "$pr_number" "$digest"
}

derive_lease_path() {
  local physical_path digest
  require_repo_root
  validate_repository
  validate_pr_number
  physical_path="$(physical_worktree_path)"
  digest="$(worktree_digest_for "$physical_path")"
  expected_lease_path_for "$PR_NUMBER" "$digest"
}

validate_direct_child_path() {
  local label="$1"
  local file="$2"
  local suffix="${3:-}"

  [ -n "$file" ] || fail "$label is required"
  case "$file" in
    *\\*) fail "$label path validation failed: $file" ;;
    *..*) fail "path traversal: $file" ;;
    .ephemeral/*/*) fail "nested $label path rejected: $file" ;;
    .ephemeral/*) ;;
    *) fail "$label path validation failed: $file" ;;
  esac
  if [ -n "$suffix" ]; then
    case "$file" in
      *"$suffix") ;;
      *) fail "$label path validation failed: $file" ;;
    esac
  fi
}

guard_ephemeral() {
  [ ! -L .ephemeral ] || fail ".ephemeral must be a directory, not a symlink"
}

prepare_write_target() {
  local label="$1"
  local file="$2"
  guard_ephemeral
  mkdir -p .ephemeral
  [ ! -L "$file" ] || fail "$label path must not be a symlink: $file"
  [ ! -d "$file" ] || fail "$label path is a directory: $file"
  [ ! -e "$file" ] || [ -f "$file" ] ||
    fail "$label path exists but is not a regular file: $file"
}

assert_readable_file() {
  local label="$1"
  local file="$2"
  guard_ephemeral
  [ ! -L "$file" ] || fail "$label must not be a symlink: $file"
  [ -f "$file" ] || fail "$label missing or not a regular file: $file"
  [ -r "$file" ] || fail "$label missing or unreadable: $file"
}

assert_worktree_readable_file() {
  local label="$1"
  local worktree="$2"
  local file="$3"
  [ ! -L "$worktree/.ephemeral" ] || fail "review worktree .ephemeral must be a directory, not a symlink"
  [ ! -L "$worktree/$file" ] || fail "$label must not be a symlink: $file"
  [ -f "$worktree/$file" ] || fail "$label missing or not a regular file: $file"
  [ -r "$worktree/$file" ] || fail "$label missing or unreadable: $file"
}

jq_value() {
  local file="$1"
  local filter="$2"
  jq -r "$filter" "$file"
}

base64_value() {
  printf '%s' "$1" | base64 | tr -d '\r\n'
}

bool_json_or_default() {
  local value="$1"
  local default="$2"
  case "$value" in
    true | false) printf '%s\n' "$value" ;;
    "") printf '%s\n' "$default" ;;
    *) fail "boolean value must be true or false" ;;
  esac
}

script_dir_logical() {
  cd "$(dirname "${BASH_SOURCE[0]}")" && pwd
}

script_dir_physical() {
  cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P
}

resolve_manifest_helper() {
  local candidate
  if [ -n "${REVIEW_MANIFEST_HELPER:-}" ]; then
    [ -f "$REVIEW_MANIFEST_HELPER" ] && [ -x "$REVIEW_MANIFEST_HELPER" ] ||
      fail "pr-review manifest helper missing or not executable"
    printf '%s\n' "$REVIEW_MANIFEST_HELPER"
    return
  fi
  candidate="$(script_dir_logical)/review-manifests.sh"
  if [ -f "$candidate" ]; then
    printf '%s\n' "$candidate"
    return
  fi
  candidate="$(script_dir_physical)/review-manifests.sh"
  if [ -f "$candidate" ]; then
    printf '%s\n' "$candidate"
    return
  fi
  fail "pr-review manifest helper missing or not executable"
}

resolve_approved_review_helper() {
  local candidate
  if [ -n "${APPROVED_REVIEW_HELPER:-}" ]; then
    [ -f "$APPROVED_REVIEW_HELPER" ] && [ -x "$APPROVED_REVIEW_HELPER" ] ||
      fail "approved-review helper missing or not executable"
    printf '%s\n' "$APPROVED_REVIEW_HELPER"
    return
  fi
  candidate="$(script_dir_logical)/approved-review-artifacts.sh"
  if [ -f "$candidate" ]; then
    printf '%s\n' "$candidate"
    return
  fi
  candidate="$(script_dir_physical)/approved-review-artifacts.sh"
  if [ -f "$candidate" ]; then
    printf '%s\n' "$candidate"
    return
  fi
  fail "approved-review helper missing or not executable"
}

artifact_head_sha() {
  local worktree="$1"
  local file="$2"
  local filter="$3"
  jq -er "$filter" "$worktree/$file" ||
    fail "failed to read review head from artifact: $file"
}

required_artifact_value() {
  local worktree="$1"
  local file="$2"
  local filter="$3"
  local label="$4"
  jq -er "$filter" "$worktree/$file" ||
    fail "missing artifact identity field: $label in $file"
}

normalize_artifact_working_directory() {
  local path_value="$1"
  case "$path_value" in
    /* | [A-Za-z]:/* | [A-Za-z]:\\*) ;;
    *) fail "execution working_directory must be absolute" ;;
  esac
  [ -d "$path_value" ] || fail "execution working_directory missing: $path_value"
  (cd "$path_value" && pwd -P) ||
    fail "failed to resolve execution working_directory"
}

validate_handoff_identity() {
  local worktree="$1"
  local file="$2"
  local repository pr_number base_ref head_ref working_directory review_head_sha
  local physical_working_directory
  repository="$(required_artifact_value "$worktree" "$file" '.repository' ".repository")"
  pr_number="$(required_artifact_value "$worktree" "$file" '.pr_number' ".pr_number")"
  base_ref="$(required_artifact_value "$worktree" "$file" '.base_ref' ".base_ref")"
  head_ref="$(required_artifact_value "$worktree" "$file" '.head_ref' ".head_ref")"
  working_directory="$(required_artifact_value "$worktree" "$file" '.execution.working_directory' ".execution.working_directory")"
  review_head_sha="$(required_artifact_value "$worktree" "$file" '.review_head_sha' ".review_head_sha")"
  physical_working_directory="$(normalize_artifact_working_directory "$working_directory")"
  [ "$repository" = "$REPOSITORY" ] || fail "handoff repository mismatch"
  [ "$pr_number" = "$PR_NUMBER" ] || fail "handoff PR number mismatch"
  [ "$base_ref" = "${LEASE_EXPECTED_BASE_REF:-$BASE_REF}" ] || fail "handoff base_ref mismatch"
  [ "$head_ref" = "${LEASE_EXPECTED_HEAD_REF:-$HEAD_REF}" ] || fail "handoff head_ref mismatch"
  [ "$physical_working_directory" = "$worktree" ] || fail "handoff worktree mismatch"
  validate_sha_value "handoff review_head_sha" "$review_head_sha"
}

validate_result_identity() {
  local worktree="$1"
  local file="$2"
  local repository pr_number review_head_sha handoff_file handoff_head_sha
  repository="$(required_artifact_value "$worktree" "$file" '.repository' ".repository")"
  pr_number="$(required_artifact_value "$worktree" "$file" '.pr_number' ".pr_number")"
  review_head_sha="$(required_artifact_value "$worktree" "$file" '.review_head_sha' ".review_head_sha")"
  handoff_file="$(jq -r 'if .handoff_file == null then "" else .handoff_file end' "$worktree/$file")"
  if [ -z "$handoff_file" ]; then
    handoff_file="$(printf '.ephemeral/pr-%s-%s-handoff.json\n' "$PR_NUMBER" "$review_head_sha")"
  fi
  [ "$repository" = "$REPOSITORY" ] || fail "result repository mismatch"
  [ "$pr_number" = "$PR_NUMBER" ] || fail "result PR number mismatch"
  validate_sha_value "result review_head_sha" "$review_head_sha"
  validate_handoff_artifact "$worktree" "$handoff_file"
  handoff_head_sha="$(artifact_head_sha "$worktree" "$handoff_file" '.review_head_sha')"
  [ "$review_head_sha" = "$handoff_head_sha" ] || fail "result review head mismatch"
}

validate_approved_review_identity() {
  local worktree="$1"
  local file="$2"
  local result_file="$3"
  local review_head_sha result_head_sha expected
  review_head_sha="$(required_artifact_value "$worktree" "$file" '.review_head_sha' ".review_head_sha")"
  result_head_sha="$(artifact_head_sha "$worktree" "$result_file" '.review_head_sha')"
  validate_sha_value "approved review_head_sha" "$review_head_sha"
  [ "$review_head_sha" = "$result_head_sha" ] || fail "approved review head mismatch"
  expected="$(expected_approved_path_for "$worktree" "$review_head_sha")"
  [ "$file" = "$expected" ] || fail "approved review path mismatch"
}

expected_approved_path_for() {
  local worktree="$1"
  local review_head_sha="$2"
  local branch branch_slug
  branch="$(git -C "$worktree" rev-parse --abbrev-ref HEAD 2>/dev/null)" ||
    fail "failed to determine review worktree branch"
  if [ "$branch" = "HEAD" ]; then
    branch_slug="detached"
  else
    branch_slug="$(slug_branch "$branch")"
  fi
  printf '.ephemeral/%s-%s-approved-review.json\n' "$branch_slug" "$review_head_sha"
}

slug_branch() {
  local branch_name="$1"
  local slug
  slug="$(printf '%s' "$branch_name" | tr '/' '-' | tr -cd '[:alnum:]._-')"
  case "$slug" in
    "" | "." | ".." | -* | .*) slug="unnamed" ;;
  esac
  printf '%s\n' "$slug"
}

validate_approved_review_result_binding() {
  local worktree="$1"
  local approved_file="$2"
  local result_file="$3"
  local approved_value result_value field

  for field in \
    findings_file \
    review_body_file \
    artifacts.scope_decision_file \
    digests.findings_sha256 \
    digests.review_body_sha256 \
    digests.scope_decision_sha256; do
    case "$field" in
      artifacts.scope_decision_file)
        approved_value="$(jq -r '.scope_decision_file // "null"' "$worktree/$approved_file")"
        result_value="$(jq -r '.artifacts.scope_decision_file // "null"' "$worktree/$result_file")"
        ;;
      digests.*)
        approved_value="$(jq -r ".${field#digests.} // \"null\"" "$worktree/$approved_file")"
        result_value="$(jq -r ".$field // \"null\"" "$worktree/$result_file")"
        ;;
      *)
        approved_value="$(jq -r ".$field // \"null\"" "$worktree/$approved_file")"
        result_value="$(jq -r ".$field // \"null\"" "$worktree/$result_file")"
        ;;
    esac
    [ "$approved_value" = "$result_value" ] ||
      fail "approved review result binding mismatch: $field"
  done
}

expected_validated_payload_path_for() {
  local review_head_sha="$1"
  printf '.ephemeral/pr-%s-%s-validated-review-payload.json\n' "$PR_NUMBER" "$review_head_sha"
}

validate_validated_payload_artifact() {
  local worktree="$1"
  local file="$2"
  local approved_file="$3"
  local review_head_sha expected
  validate_direct_child_path "validated payload" "$file" "-validated-review-payload.json"
  assert_worktree_readable_file "validated payload file" "$worktree" "$file"
  review_head_sha="$(artifact_head_sha "$worktree" "$approved_file" '.review_head_sha')"
  expected="$(expected_validated_payload_path_for "$review_head_sha")"
  [ "$file" = "$expected" ] || fail "validated payload path mismatch"
  jq -e --slurpfile payload "$worktree/$file" '.payload == $payload[0]' "$worktree/$approved_file" >/dev/null ||
    fail "validated payload approved-review mismatch"
}

validated_payload_input_value() {
  printf '%s\n' "${VALIDATED_REVIEW_PAYLOAD_FILE:-${VALIDATED_PAYLOAD_FILE:-}}"
}

validated_payload_value_for() {
  local worktree="$1"
  local approved_file="$2"
  local existing_value="$3"
  local explicit_value review_head_sha expected

  explicit_value="$(validated_payload_input_value)"
  if [ -n "$explicit_value" ]; then
    printf '%s\n' "$explicit_value"
    return
  fi
  if [ -n "$existing_value" ]; then
    printf '%s\n' "$existing_value"
    return
  fi
  [ -n "$approved_file" ] || return 0
  validate_direct_child_path "approved review" "$approved_file" "-approved-review.json"
  [ -f "$worktree/$approved_file" ] || return
  review_head_sha="$(artifact_head_sha "$worktree" "$approved_file" '.review_head_sha')"
  expected="$(expected_validated_payload_path_for "$review_head_sha")"
  if [ -f "$worktree/$expected" ]; then
    printf '%s\n' "$expected"
  fi
}

validate_handoff_artifact() {
  local worktree="$1"
  local file="$2"
  local head_sha manifest_helper
  validate_direct_child_path "handoff" "$file" "-handoff.json"
  assert_worktree_readable_file "handoff file" "$worktree" "$file"
  head_sha="$(artifact_head_sha "$worktree" "$file" '.review_head_sha')"
  manifest_helper="$(resolve_manifest_helper)"
  (
    cd "$worktree"
    PR_NUMBER="$PR_NUMBER" \
    HEAD_SHA="$head_sha" \
    HANDOFF_FILE="$file" \
      bash "$manifest_helper" validate-handoff
  )
  validate_handoff_identity "$worktree" "$file"
}

validate_result_artifact() {
  local worktree="$1"
  local file="$2"
  local head_sha manifest_helper
  validate_direct_child_path "result" "$file" "-result.json"
  assert_worktree_readable_file "result file" "$worktree" "$file"
  head_sha="$(artifact_head_sha "$worktree" "$file" '.review_head_sha')"
  manifest_helper="$(resolve_manifest_helper)"
  (
    cd "$worktree"
    PR_NUMBER="$PR_NUMBER" \
    HEAD_SHA="$head_sha" \
    RESULT_FILE="$file" \
    PLAY_REVIEW_HELPER="${PLAY_REVIEW_HELPER:-}" \
      bash "$manifest_helper" validate-result
  )
  validate_result_identity "$worktree" "$file"
}

result_handoff_file_for() {
  local worktree="$1"
  local file="$2"
  local review_head_sha handoff_file
  handoff_file="$(jq -r 'if .artifacts.handoff_file != null then .artifacts.handoff_file elif .handoff_file != null then .handoff_file else "" end' "$worktree/$file")"
  if [ -n "$handoff_file" ]; then
    printf '%s\n' "$handoff_file"
    return
  fi
  review_head_sha="$(artifact_head_sha "$worktree" "$file" '.review_head_sha')"
  printf '.ephemeral/pr-%s-%s-handoff.json\n' "$PR_NUMBER" "$review_head_sha"
}

result_presentation_status_for() {
  local worktree="$1"
  local file="$2"
  jq -r 'if .presentation.status == null then "" else .presentation.status end' "$worktree/$file"
}

validate_approved_review_artifact() {
  local worktree="$1"
  local file="$2"
  local fallback_base_ref="$3"
  local result_file="${4:-}"
  local base_ref scope_decision_file full_range
  local head_sha approved_helper
  validate_direct_child_path "approved review" "$file" "-approved-review.json"
  assert_worktree_readable_file "approved review file" "$worktree" "$file"
  scope_decision_file="$(jq -r 'if .scope_decision_file == null then "" else .scope_decision_file end' "$worktree/$file")"
  if [ -n "$scope_decision_file" ]; then
    validate_direct_child_path "scope decision" "$scope_decision_file" "-scope-decision.json"
    assert_worktree_readable_file "scope decision file" "$worktree" "$scope_decision_file"
    full_range="$(jq -er '.full_range' "$worktree/$scope_decision_file")" ||
      fail "failed to read scope base ref from approved review artifact: $file"
    case "$full_range" in
      *...HEAD) base_ref="${full_range%...HEAD}" ;;
      *) fail "scope decision full_range must end with ...HEAD: $scope_decision_file" ;;
    esac
  else
    base_ref="$fallback_base_ref"
  fi
  head_sha="$(artifact_head_sha "$worktree" "$file" '.review_head_sha')"
  approved_helper="$(resolve_approved_review_helper)"
  (
    cd "$worktree"
    BASE_REF="$base_ref" \
    HEAD_SHA="$head_sha" \
    APPROVED_REVIEW_FILE="$file" \
      bash "$approved_helper" validate-approved-review >/dev/null
  )
  if [ -n "$result_file" ]; then
    validate_approved_review_identity "$worktree" "$file" "$result_file"
    validate_approved_review_result_binding "$worktree" "$file" "$result_file"
  fi
}

validate_approval_freeze_approved_review_binding() {
  local worktree="$1"
  local file="$2"
  local result_file="$3"
  validate_direct_child_path "approved review" "$file" "-approved-review.json"
  assert_worktree_readable_file "approved review file" "$worktree" "$file"
  validate_approved_review_identity "$worktree" "$file" "$result_file"
  validate_approved_review_result_binding "$worktree" "$file" "$result_file"
}

validate_lease_path_identity() {
  local physical_path="$1"
  local digest expected
  require_env LEASE_FILE
  validate_direct_child_path "lease" "$LEASE_FILE" "-lease.json"
  digest="$(worktree_digest_for "$physical_path")"
  expected="$(expected_lease_path_for "$PR_NUMBER" "$digest")"
  [ "$LEASE_FILE" = "$expected" ] || fail "lease path mismatch: $LEASE_FILE"
}

validate_lease_schema() {
  local file="$1"
  require_jq
  jq -e '
    def one_of($values; $value): ($values | index($value)) != null;
    def positive_integer: type == "number" and . == floor and . >= 1;
    def repo: type == "string" and test("^[^/[:space:]]+/[^/[:space:]]+$");
    def timestamp: type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$");
    def optional_timestamp: . == null or timestamp;
    def ref_string: type == "string" and length > 0 and (test("[[:space:][:cntrl:]]") | not);
    def absolute_path: type == "string" and length > 1 and (startswith("/") or test("^[A-Za-z]:[\\\\/]"));
    def digest: type == "string" and test("^[0-9a-f]{64}$");
    def direct_ephemeral_path($suffix):
      type == "string"
      and test("^\\.ephemeral/[^/]+$")
      and endswith($suffix)
      and (contains("\\") | not)
      and (contains("..") | not);
    def optional_direct_ephemeral_path($suffix): . == null or direct_ephemeral_path($suffix);
    def single_line: type == "string" and length > 0 and (test("[\\r\\n]") | not);
    type == "object"
    and .schema == "pr-review/lease/v1"
    and (.repository | repo)
    and (.pr_number | positive_integer)
    and one_of(["created", "reviewed", "gated", "posted", "aborted", "failed"]; .state)
    and (.base_ref | ref_string)
    and (.head_ref | ref_string)
    and (.worktree_path | absolute_path)
    and (.worktree_digest | digest)
    and (.lease_file | type == "string" and test("^\\.ephemeral/pr-[0-9]+-[0-9a-f]{64}-lease\\.json$"))
    and (.lease_file == (".ephemeral/pr-" + (.pr_number | tostring) + "-" + .worktree_digest + "-lease.json"))
    and (.created_at | timestamp)
    and (.updated_at | timestamp)
    and (
      ((keys_unsorted | sort) == ([
        "schema", "repository", "pr_number", "state", "base_ref", "head_ref",
        "worktree_path", "worktree_digest", "lease_file", "created_at",
        "updated_at", "artifacts", "presentation", "terminal", "failure",
        "github"
      ] | sort))
      or
      ((keys_unsorted | sort) == ([
        "schema", "repository", "pr_number", "state", "base_ref", "head_ref",
        "worktree_path", "worktree_digest", "lease_file", "created_at",
        "updated_at", "artifacts", "presentation", "terminal", "failure",
        "github", "cleanup"
      ] | sort))
    )
    and (.artifacts | type == "object")
    and (
      ((.artifacts | keys_unsorted | sort) == (["handoff_file", "result_file", "approved_review_file"] | sort))
      or
      ((.artifacts | keys_unsorted | sort) == (["handoff_file", "result_file", "approved_review_file", "validated_payload_file"] | sort))
    )
    and (.artifacts.handoff_file | optional_direct_ephemeral_path("-handoff.json"))
    and (.artifacts.result_file | optional_direct_ephemeral_path("-result.json"))
    and (.artifacts.approved_review_file | optional_direct_ephemeral_path("-approved-review.json"))
    and (.artifacts.validated_payload_file | optional_direct_ephemeral_path("-validated-review-payload.json"))
    and (.presentation | type == "object")
    and ((.presentation | keys_unsorted | sort) == (["presented_at", "status"] | sort))
    and (.presentation.presented_at | optional_timestamp)
    and (.presentation.status == null or one_of(["preview-current", "edited"]; .presentation.status))
    and (.terminal | type == "object")
    and ((.terminal | keys_unsorted | sort) == (["finished_at", "reason"] | sort))
    and (.terminal.finished_at | optional_timestamp)
    and (.terminal.reason == null or (.terminal.reason | single_line))
    and (.failure | type == "object")
    and ((.failure | keys_unsorted | sort) == (["phase", "reason", "recoverability"] | sort))
    and (.failure.phase == null or one_of(["handoff-validation", "review", "result-validation", "preview-render", "approval-freeze", "stale-head", "github-post"]; .failure.phase))
    and (.failure.reason == null or (.failure.reason | single_line))
    and (.failure.recoverability == null or one_of(["recoverable", "unrecoverable", "unknown"]; .failure.recoverability))
    and (.github | type == "object")
    and ((.github | keys_unsorted | sort) == (["github_post_attempted", "github_post_result", "github_posted_at"] | sort))
    and (.github.github_post_attempted | type == "boolean")
    and one_of(["succeeded", "failed", "not-attempted"]; .github.github_post_result)
    and (.github.github_posted_at | optional_timestamp)
    and (
      .cleanup == null
      or (
        .cleanup | type == "object"
        and ((keys_unsorted | sort) == (["last_outcome", "last_checked_at"] | sort))
        and (.last_outcome == null or one_of(["removed", "retained", "skipped", "failed"]; .last_outcome))
        and (.last_checked_at | optional_timestamp)
      )
    )
    and (
      if .state == "created" then
        .artifacts.result_file == null
        and .artifacts.approved_review_file == null
        and .terminal.finished_at == null
        and .terminal.reason == null
        and .failure.phase == null
        and .failure.reason == null
        and .failure.recoverability == null
        and .github.github_post_attempted == false
        and .github.github_post_result == "not-attempted"
        and .github.github_posted_at == null
      elif .state == "reviewed" then
        .artifacts.result_file != null
        and .terminal.finished_at == null
        and .failure.phase == null
        and .github.github_post_attempted == false
        and .github.github_post_result == "not-attempted"
        and .github.github_posted_at == null
      elif .state == "gated" then
        .artifacts.result_file != null
        and (.presentation.presented_at | timestamp)
        and one_of(["preview-current", "edited"]; .presentation.status)
        and .terminal.finished_at == null
        and .failure.phase == null
        and .github.github_post_attempted == false
        and .github.github_post_result == "not-attempted"
        and .github.github_posted_at == null
      elif .state == "posted" then
        .artifacts.result_file != null
        and .artifacts.approved_review_file != null
        and (.terminal.finished_at | timestamp)
        and .failure.phase == null
        and .github.github_post_attempted == true
        and .github.github_post_result == "succeeded"
        and (.github.github_posted_at | timestamp)
      elif .state == "aborted" then
        (.terminal.finished_at | timestamp)
        and (.terminal.reason | single_line)
        and .failure.phase == null
        and .github.github_post_attempted == false
        and .github.github_post_result == "not-attempted"
        and .github.github_posted_at == null
      else
        (.terminal.finished_at | timestamp)
        and (.failure.phase != null)
        and (.failure.reason | single_line)
        and (.failure.recoverability != null)
        and (
          if .github.github_post_attempted == true then
            .github.github_post_result == "failed"
          else
            .github.github_post_result == "not-attempted"
          end
        )
        and .github.github_posted_at == null
      end
    )
  ' "$file" >/dev/null || fail "lease schema mismatch: $file"
}

validate_lease_timestamps() {
  local file="$1"
  local label value
  while IFS=$'\t' read -r label value; do
    label="${label%$'\r'}"
    value="${value%$'\r'}"
    [ "$value" != "null" ] || continue
    validate_timestamp_value "$label" "$value"
  done < <(
    jq -r '
      [
        ["created_at", .created_at],
        ["updated_at", .updated_at],
        ["presentation.presented_at", (.presentation.presented_at // "null")],
        ["terminal.finished_at", (.terminal.finished_at // "null")],
        ["github.github_posted_at", (.github.github_posted_at // "null")],
        ["cleanup.last_checked_at", (.cleanup.last_checked_at // "null")]
      ]
      | .[]
      | @tsv
    ' "$file"
  )
}

validate_lease_identity() {
  local file="$1"
  local physical_path="$2"
  local digest
  digest="$(worktree_digest_for "$physical_path")"
  [ "$(jq_value "$file" '.repository')" = "$REPOSITORY" ] ||
    fail "lease repository mismatch"
  [ "$(jq_value "$file" '.pr_number')" = "$PR_NUMBER" ] ||
    fail "lease PR number mismatch"
  [ "$(jq_value "$file" '.worktree_path')" = "$physical_path" ] ||
    fail "lease worktree path mismatch"
  [ "$(jq_value "$file" '.worktree_digest')" = "$digest" ] ||
    fail "lease worktree digest mismatch"
  [ "$(jq_value "$file" '.lease_file')" = "$LEASE_FILE" ] ||
    fail "lease file identity mismatch"
}

validate_referenced_artifacts() {
  local file="$1"
  local physical_path="$2"
  local state base_ref head_ref failure_phase handoff_file result_file approved_review_file validated_payload_file
  state="$(jq_value "$file" '.state')"
  base_ref="$(jq_value "$file" '.base_ref')"
  head_ref="$(jq_value "$file" '.head_ref')"
  failure_phase="$(jq_value "$file" 'if .failure.phase == null then "" else .failure.phase end')"
  handoff_file="$(jq_value "$file" 'if .artifacts.handoff_file == null then "" else .artifacts.handoff_file end')"
  result_file="$(jq_value "$file" 'if .artifacts.result_file == null then "" else .artifacts.result_file end')"
  approved_review_file="$(jq_value "$file" 'if .artifacts.approved_review_file == null then "" else .artifacts.approved_review_file end')"
  validated_payload_file="$(jq_value "$file" 'if .artifacts.validated_payload_file == null then "" else .artifacts.validated_payload_file end')"

  if [ -n "$handoff_file" ]; then
    validate_direct_child_path "handoff" "$handoff_file" "-handoff.json"
  fi
  if [ -n "$result_file" ]; then
    validate_direct_child_path "result" "$result_file" "-result.json"
  fi
  if [ -n "$approved_review_file" ]; then
    validate_direct_child_path "approved review" "$approved_review_file" "-approved-review.json"
  fi
  if [ -n "$validated_payload_file" ]; then
    validate_direct_child_path "validated payload" "$validated_payload_file" "-validated-review-payload.json"
  fi

  if [ -n "$handoff_file" ]; then
    LEASE_EXPECTED_BASE_REF="$base_ref" LEASE_EXPECTED_HEAD_REF="$head_ref" \
      validate_handoff_artifact "$physical_path" "$handoff_file"
  fi
  case "$state" in
    reviewed | gated | posted)
      LEASE_EXPECTED_BASE_REF="$base_ref" LEASE_EXPECTED_HEAD_REF="$head_ref" \
        validate_result_artifact "$physical_path" "$result_file"
      ;;
    aborted)
      if [ -n "$result_file" ]; then
        LEASE_EXPECTED_BASE_REF="$base_ref" LEASE_EXPECTED_HEAD_REF="$head_ref" \
          validate_result_artifact "$physical_path" "$result_file"
      fi
      ;;
    failed)
      if [ -n "$result_file" ]; then
        LEASE_EXPECTED_BASE_REF="$base_ref" LEASE_EXPECTED_HEAD_REF="$head_ref" \
          validate_result_artifact "$physical_path" "$result_file"
      fi
      ;;
  esac
  if [ "$state" = "posted" ] || { [ "$state" = "failed" ] && [ -n "$approved_review_file" ]; }; then
    if [ "$state" = "failed" ] && [ "$failure_phase" = "approval-freeze" ]; then
      LEASE_EXPECTED_BASE_REF="$base_ref" LEASE_EXPECTED_HEAD_REF="$head_ref" \
        validate_approval_freeze_approved_review_binding "$physical_path" "$approved_review_file" "$result_file"
    else
      LEASE_EXPECTED_BASE_REF="$base_ref" LEASE_EXPECTED_HEAD_REF="$head_ref" \
        validate_approved_review_artifact "$physical_path" "$approved_review_file" "$base_ref" "$result_file"
    fi
  fi
  if [ -n "$validated_payload_file" ]; then
    [ -n "$approved_review_file" ] || fail "validated payload requires approved-review artifact"
    validate_validated_payload_artifact "$physical_path" "$validated_payload_file" "$approved_review_file"
  fi
}

validate_lease_file() {
  local file="$1"
  local physical_path="$2"
  validate_direct_child_path "lease" "$file" "-lease.json"
  assert_readable_file "lease file" "$file"
  validate_lease_schema "$file"
  validate_lease_timestamps "$file"
  validate_lease_identity "$file" "$physical_path"
  validate_referenced_artifacts "$file" "$physical_path"
}

validate_terminal_lease_for_archive() {
  local file="$1"
  local physical_path="$2"
  validate_direct_child_path "lease" "$file" "-lease.json"
  assert_readable_file "lease file" "$file"
  validate_lease_schema "$file"
  validate_lease_timestamps "$file"
  validate_lease_identity "$file" "$physical_path"
}

transition_id() {
  local previous="$1"
  local target="$2"
  local phase="${3:-}"
  case "$previous:$target" in
    none:created) printf 'LC-01\n' ;;
    created:created) printf 'LC-02\n' ;;
    created:reviewed) printf 'LC-03\n' ;;
    reviewed:gated) printf 'LC-04\n' ;;
    gated:gated) printf 'LC-05\n' ;;
    reviewed:aborted) printf 'LC-06\n' ;;
    gated:aborted) printf 'LC-07\n' ;;
    gated:posted) printf 'LC-08\n' ;;
    created:failed) printf 'LC-09\n' ;;
    reviewed:failed) printf 'LC-10\n' ;;
    gated:failed)
      case "$phase" in
        approval-freeze) printf 'LC-12\n' ;;
        github-post) printf 'LC-13\n' ;;
        *) printf 'LC-11\n' ;;
      esac
      ;;
    failed:gated) printf 'LC-14\n' ;;
    failed:aborted) printf 'LC-15\n' ;;
    failed:failed) printf 'LC-16\n' ;;
    failed:posted) printf 'LC-17\n' ;;
    terminal:created) printf 'LC-18\n' ;;
    *) printf '\n' ;;
  esac
}

require_retry_to_post_source() {
  local file="$1"
  local phase attempted result
  phase="$(jq_value "$file" 'if .failure.phase == null then "" else .failure.phase end')"
  attempted="$(jq_value "$file" '.github.github_post_attempted // false')"
  result="$(jq_value "$file" '.github.github_post_result // "not-attempted"')"
  [ "$phase" = "github-post" ] ||
    fail "invalid lease transition: failed -> posted requires github-post failure"
  [ "$attempted" = "true" ] ||
    fail "invalid lease transition: failed -> posted requires attempted github post"
  [ "$result" = "failed" ] ||
    fail "invalid lease transition: failed -> posted requires failed github post result"
}

terminal_archive_path_for() {
  local terminal_state="$1"
  local stamp="$2"
  local digest="$3"
  local base candidate index
  stamp="$(printf '%s' "$stamp" | sed 's/[-:Z]//g')"
  base=".ephemeral/pr-${PR_NUMBER}-${digest}-${stamp}-${terminal_state}"
  candidate="${base}-archived-lease.json"
  index=2
  while [ -e "$candidate" ]; do
    candidate="${base}-${index}-archived-lease.json"
    index=$((index + 1))
  done
  printf '%s\n' "$candidate"
}

existing_field() {
  local file="$1"
  local filter="$2"
  local fallback="$3"
  if [ -n "$file" ]; then
    jq -r "$filter" "$file"
  else
    printf '%s\n' "$fallback"
  fi
}

existing_required_field() {
  local file="$1"
  local filter="$2"
  local label="$3"
  local value
  value="$(jq_value "$file" "$filter")"
  [ -n "$value" ] || fail "$label is required by existing lease"
  printf '%s\n' "$value"
}

require_reducer_input() {
  local label="$1"
  local value="$2"
  [ -n "$value" ] || fail "$label is required for $STATE"
}

reject_github_post_failure_outside_gate() {
  local row="$1"
  if [ "${FAILURE_PHASE:-}" = "github-post" ] && [ "$row" != "LC-13" ]; then
    fail "github-post failure requires gated lease"
  fi
}

write_lease_json() {
  local output_file="$1"
  {
    base64_value "pr-review/lease/v1"
    printf '\n'
    base64_value "$REPOSITORY"
    printf '\n'
    base64_value "$PR_NUMBER"
    printf '\n'
    base64_value "$STATE"
    printf '\n'
    base64_value "$base_ref_value"
    printf '\n'
    base64_value "$head_ref_value"
    printf '\n'
    base64_value "$physical_path"
    printf '\n'
    base64_value "$digest"
    printf '\n'
    base64_value "$LEASE_FILE"
    printf '\n'
    base64_value "$created_at_value"
    printf '\n'
    base64_value "$updated_at_value"
    printf '\n'
    base64_value "$handoff_value"
    printf '\n'
    base64_value "$result_value"
    printf '\n'
    base64_value "$approved_value"
    printf '\n'
    base64_value "$validated_payload_value"
    printf '\n'
    base64_value "$presented_at_value"
    printf '\n'
    base64_value "$presentation_status_value"
    printf '\n'
    base64_value "$finished_at_value"
    printf '\n'
    base64_value "$terminal_reason_value"
    printf '\n'
    base64_value "$failure_phase_value"
    printf '\n'
    base64_value "$failure_reason_value"
    printf '\n'
    base64_value "$failure_recoverability_value"
    printf '\n'
    base64_value "$github_attempted_value"
    printf '\n'
    base64_value "$github_result_value"
    printf '\n'
    base64_value "$github_posted_at_value"
    printf '\n'
  } | jq -Rn '
    def nullable($value): if $value == "" then null else $value end;
    [inputs | @base64d] as $values
    | {
      schema: $values[0],
      repository: $values[1],
      pr_number: ($values[2] | tonumber),
      state: $values[3],
      base_ref: $values[4],
      head_ref: $values[5],
      worktree_path: $values[6],
      worktree_digest: $values[7],
      lease_file: $values[8],
      created_at: $values[9],
      updated_at: $values[10],
      artifacts: {
        handoff_file: nullable($values[11]),
        result_file: nullable($values[12]),
        approved_review_file: nullable($values[13]),
        validated_payload_file: nullable($values[14])
      },
      presentation: {
        presented_at: nullable($values[15]),
        status: nullable($values[16])
      },
      terminal: {
        finished_at: nullable($values[17]),
        reason: nullable($values[18])
      },
      failure: {
        phase: nullable($values[19]),
        reason: nullable($values[20]),
        recoverability: nullable($values[21])
      },
      github: {
        github_post_attempted: ($values[22] == "true"),
        github_post_result: $values[23],
        github_posted_at: nullable($values[24])
      }
    }' >"$output_file"
}

write_lease() {
  local physical_path digest tmp_file existing_file previous_state
  local row_id archived_terminal_state stamp archive_path
  local base_ref_value head_ref_value
  local created_at_value updated_at_value handoff_value result_value approved_value validated_payload_value
  local presented_at_value presentation_status_value finished_at_value terminal_reason_value
  local failure_phase_value failure_reason_value failure_recoverability_value
  local github_attempted_value github_result_value github_posted_at_value
  local existing_handoff_value existing_result_value existing_approved_value existing_validated_payload_value
  local existing_presented_at existing_presentation_status
  local existing_finished_at existing_failure_phase existing_failure_reason
  local existing_failure_recoverability existing_github_attempted existing_github_result
  local result_handoff_value result_presentation_status

  require_repo_root
  require_jq
  validate_repository
  validate_pr_number
  validate_refs
  require_env STATE
  require_env UPDATED_AT
  physical_path="$(physical_worktree_path)"
  digest="$(worktree_digest_for "$physical_path")"
  validate_lease_path_identity "$physical_path"

  case "$STATE" in
    created | reviewed | gated | posted | aborted | failed) ;;
    *) fail "STATE must be created, reviewed, gated, posted, aborted, or failed" ;;
  esac

  existing_file=""
  previous_state="none"
  archived_terminal_state=""
  if [ -e "$LEASE_FILE" ]; then
    if [ "$STATE" = "created" ]; then
      validate_terminal_lease_for_archive "$LEASE_FILE" "$physical_path"
      previous_state="$(jq_value "$LEASE_FILE" '.state')"
      case "$previous_state" in
        posted | aborted)
          archived_terminal_state="$previous_state"
          if [ -n "${EXPECTED_STATE:-}" ] && [ "$EXPECTED_STATE" != "$previous_state" ]; then
            fail "EXPECTED_STATE mismatch: $previous_state"
          fi
          row_id="$(transition_id "terminal" "$STATE" "")"
          [ -n "$row_id" ] || fail "invalid lease transition: $previous_state -> created"
          stamp="$(jq_value "$LEASE_FILE" 'if .terminal.finished_at == null then .updated_at else .terminal.finished_at end')"
          archive_path="$(terminal_archive_path_for "$previous_state" "$stamp" "$digest")"
          previous_state="none"
          ;;
        *)
          validate_lease_file "$LEASE_FILE" "$physical_path"
          existing_file="$LEASE_FILE"
          ;;
      esac
    else
      validate_lease_file "$LEASE_FILE" "$physical_path"
      existing_file="$LEASE_FILE"
      previous_state="$(jq_value "$LEASE_FILE" '.state')"
    fi
    if [ -n "$existing_file" ]; then
      if [ -n "${EXPECTED_STATE:-}" ] && [ "$EXPECTED_STATE" != "$previous_state" ]; then
        fail "EXPECTED_STATE mismatch: $previous_state"
      fi
      row_id="$(transition_id "$previous_state" "$STATE" "${FAILURE_PHASE:-}")"
      [ -n "$row_id" ] || fail "invalid lease transition: $previous_state -> $STATE"
    fi
  else
    row_id="$(transition_id "none" "$STATE" "")"
    [ -n "$row_id" ] || fail "invalid lease transition: none -> $STATE"
  fi

  if [ -n "$existing_file" ]; then
    base_ref_value="$(jq_value "$existing_file" '.base_ref')"
    head_ref_value="$(jq_value "$existing_file" '.head_ref')"
    [ "$BASE_REF" = "$base_ref_value" ] || fail "base_ref is immutable"
    [ "$HEAD_REF" = "$head_ref_value" ] || fail "head_ref is immutable"
    created_at_value="$(jq_value "$existing_file" '.created_at')"
    if [ -n "${CREATED_AT:-}" ] && [ "$CREATED_AT" != "$created_at_value" ]; then
      fail "created_at is immutable"
    fi
  else
    require_env CREATED_AT
    base_ref_value="$BASE_REF"
    head_ref_value="$HEAD_REF"
    created_at_value="$CREATED_AT"
  fi
  updated_at_value="$UPDATED_AT"

  existing_handoff_value="$(existing_field "$existing_file" 'if .artifacts.handoff_file == null then "" else .artifacts.handoff_file end' "")"
  existing_result_value="$(existing_field "$existing_file" 'if .artifacts.result_file == null then "" else .artifacts.result_file end' "")"
  existing_approved_value="$(existing_field "$existing_file" 'if .artifacts.approved_review_file == null then "" else .artifacts.approved_review_file end' "")"
  existing_validated_payload_value="$(existing_field "$existing_file" 'if .artifacts.validated_payload_file == null then "" else .artifacts.validated_payload_file end' "")"
  existing_presented_at="$(existing_field "$existing_file" 'if .presentation.presented_at == null then "" else .presentation.presented_at end' "")"
  existing_presentation_status="$(existing_field "$existing_file" 'if .presentation.status == null then "" else .presentation.status end' "")"
  existing_finished_at="$(existing_field "$existing_file" 'if .terminal.finished_at == null then "" else .terminal.finished_at end' "")"
  existing_failure_phase="$(existing_field "$existing_file" 'if .failure.phase == null then "" else .failure.phase end' "")"
  existing_failure_reason="$(existing_field "$existing_file" 'if .failure.reason == null then "" else .failure.reason end' "")"
  existing_failure_recoverability="$(existing_field "$existing_file" 'if .failure.recoverability == null then "" else .failure.recoverability end' "")"
  existing_github_attempted="$(existing_field "$existing_file" '.github.github_post_attempted // false' "false")"
  existing_github_result="$(existing_field "$existing_file" '.github.github_post_result // "not-attempted"' "not-attempted")"

  handoff_value=""
  result_value=""
  approved_value=""
  validated_payload_value=""
  presented_at_value=""
  presentation_status_value=""
  finished_at_value=""
  terminal_reason_value=""
  failure_phase_value=""
  failure_reason_value=""
  failure_recoverability_value=""
  github_attempted_value="false"
  github_result_value="not-attempted"
  github_posted_at_value=""

  case "$row_id" in
    LC-01 | LC-18)
      ;;
    LC-02)
      [ -z "$existing_handoff_value" ] || fail "invalid lease transition: created -> created"
      [ -n "${HANDOFF_FILE:-}" ] || fail "invalid lease transition: created -> created"
      handoff_value="$HANDOFF_FILE"
      ;;
    LC-03)
      require_reducer_input RESULT_FILE "${RESULT_FILE:-}"
      handoff_value="${HANDOFF_FILE:-}"
      result_value="$RESULT_FILE"
      ;;
    LC-04 | LC-14)
      result_value="${RESULT_FILE:-$existing_result_value}"
      require_reducer_input RESULT_FILE "$result_value"
      require_reducer_input PRESENTED_AT "${PRESENTED_AT:-}"
      require_reducer_input PRESENTATION_STATUS "${PRESENTATION_STATUS:-}"
      handoff_value="$existing_handoff_value"
      presented_at_value="$PRESENTED_AT"
      presentation_status_value="$PRESENTATION_STATUS"
      ;;
    LC-05)
      if [ -z "${RESULT_FILE:-}" ] && [ -z "${PRESENTED_AT:-}" ] && [ -z "${PRESENTATION_STATUS:-}" ]; then
        fail "invalid lease transition: gated -> gated"
      fi
      result_value="${RESULT_FILE:-$existing_result_value}"
      require_reducer_input RESULT_FILE "$result_value"
      require_reducer_input PRESENTED_AT "${PRESENTED_AT:-}"
      require_reducer_input PRESENTATION_STATUS "${PRESENTATION_STATUS:-}"
      if [ "$result_value" = "$existing_result_value" ] &&
        [ "$PRESENTED_AT" = "$existing_presented_at" ] &&
        [ "$PRESENTATION_STATUS" = "$existing_presentation_status" ]; then
        fail "invalid lease transition: gated -> gated"
      fi
      handoff_value="$existing_handoff_value"
      presented_at_value="$PRESENTED_AT"
      presentation_status_value="$PRESENTATION_STATUS"
      ;;
    LC-06 | LC-07 | LC-15)
      if [ "$previous_state" = "failed" ] && [ -z "${FINISHED_AT:-}" ]; then
        fail "FINISHED_AT is required for fresh aborted after failed lease"
      fi
      require_reducer_input FINISHED_AT "${FINISHED_AT:-}"
      require_reducer_input TERMINAL_REASON "${TERMINAL_REASON:-}"
      handoff_value="$existing_handoff_value"
      result_value="$existing_result_value"
      if [ "$row_id" = "LC-07" ]; then
        presented_at_value="$existing_presented_at"
        presentation_status_value="$existing_presentation_status"
      fi
      finished_at_value="$FINISHED_AT"
      terminal_reason_value="$TERMINAL_REASON"
      ;;
    LC-08)
      existing_required_field "$existing_file" 'if .artifacts.result_file == null then "" else .artifacts.result_file end' "posted transition result" >/dev/null
      if [ -n "${RESULT_FILE:-}" ] && [ "$RESULT_FILE" != "$existing_result_value" ]; then
        fail "RESULT_FILE must match existing gated result"
      fi
      require_reducer_input APPROVED_REVIEW_FILE "${APPROVED_REVIEW_FILE:-}"
      require_reducer_input FINISHED_AT "${FINISHED_AT:-}"
      require_reducer_input GITHUB_POSTED_AT "${GITHUB_POSTED_AT:-}"
      handoff_value="$existing_handoff_value"
      result_value="$existing_result_value"
      approved_value="$APPROVED_REVIEW_FILE"
      validated_payload_value="$(validated_payload_value_for "$physical_path" "$approved_value" "")"
      presented_at_value="$existing_presented_at"
      presentation_status_value="$existing_presentation_status"
      finished_at_value="$FINISHED_AT"
      github_attempted_value="true"
      github_result_value="succeeded"
      github_posted_at_value="$GITHUB_POSTED_AT"
      ;;
    LC-09 | LC-10 | LC-11 | LC-12 | LC-13 | LC-16)
      if [ "$previous_state" = "failed" ] && [ -z "${FINISHED_AT:-}" ]; then
        fail "FINISHED_AT is required for fresh failed after failed lease"
      fi
      require_reducer_input FINISHED_AT "${FINISHED_AT:-}"
      require_reducer_input FAILURE_PHASE "${FAILURE_PHASE:-}"
      require_reducer_input FAILURE_REASON "${FAILURE_REASON:-}"
      require_reducer_input FAILURE_RECOVERABILITY "${FAILURE_RECOVERABILITY:-}"
      reject_github_post_failure_outside_gate "$row_id"
      handoff_value="$existing_handoff_value"
      case "$row_id" in
        LC-10 | LC-11 | LC-12 | LC-13)
          [ -n "$existing_result_value" ] || fail "failed transition requires existing result pointer"
          if [ -n "${RESULT_FILE:-}" ] && [ "$RESULT_FILE" != "$existing_result_value" ]; then
            fail "RESULT_FILE must match existing $previous_state result"
          fi
          result_value="$existing_result_value"
          ;;
        LC-16) result_value="${RESULT_FILE:-$existing_result_value}" ;;
      esac
      case "$row_id" in
        LC-11 | LC-12 | LC-13)
          presented_at_value="$existing_presented_at"
          presentation_status_value="$existing_presentation_status"
          ;;
      esac
      if [ "$row_id" = "LC-12" ]; then
        approved_value="${APPROVED_REVIEW_FILE:-$existing_approved_value}"
        validated_payload_value="$(validated_payload_value_for "$physical_path" "$approved_value" "$existing_validated_payload_value")"
      elif [ "$row_id" = "LC-13" ]; then
        approved_value="${APPROVED_REVIEW_FILE:-$existing_approved_value}"
        validated_payload_value="$(validated_payload_value_for "$physical_path" "$approved_value" "$existing_validated_payload_value")"
        github_attempted_value="$(bool_json_or_default "${GITHUB_POST_ATTEMPTED:-}" "false")"
        github_result_value="${GITHUB_POST_RESULT:-not-attempted}"
        [ "$github_attempted_value" = "true" ] || fail "GITHUB_POST_ATTEMPTED must be true for github-post failure"
        [ "$github_result_value" = "failed" ] || fail "GITHUB_POST_RESULT must be failed for github-post failure"
        [ -n "$approved_value" ] || fail "APPROVED_REVIEW_FILE is required for github-post failure"
      elif [ "$row_id" = "LC-16" ] && [ "$FAILURE_PHASE" = "approval-freeze" ]; then
        approved_value="${APPROVED_REVIEW_FILE:-$existing_approved_value}"
        validated_payload_value="$(validated_payload_value_for "$physical_path" "$approved_value" "$existing_validated_payload_value")"
      fi
      if [ "$row_id" = "LC-16" ] &&
        [ "$result_value" = "$existing_result_value" ] &&
        [ "$approved_value" = "$existing_approved_value" ] &&
        [ "$validated_payload_value" = "$existing_validated_payload_value" ] &&
        [ "$FINISHED_AT" = "$existing_finished_at" ] &&
        [ "$FAILURE_PHASE" = "$existing_failure_phase" ] &&
        [ "$FAILURE_REASON" = "$existing_failure_reason" ] &&
        [ "$FAILURE_RECOVERABILITY" = "$existing_failure_recoverability" ] &&
        [ "$github_attempted_value" = "$existing_github_attempted" ] &&
        [ "$github_result_value" = "$existing_github_result" ]; then
        fail "invalid lease transition: failed -> failed"
      fi
      finished_at_value="$FINISHED_AT"
      failure_phase_value="$FAILURE_PHASE"
      failure_reason_value="$FAILURE_REASON"
      failure_recoverability_value="$FAILURE_RECOVERABILITY"
      ;;
    LC-17)
      require_retry_to_post_source "$existing_file"
      if [ -z "${FINISHED_AT:-}" ]; then
        fail "FINISHED_AT is required for fresh posted after failed lease"
      fi
      require_reducer_input GITHUB_POSTED_AT "${GITHUB_POSTED_AT:-}"
      [ -n "$existing_result_value" ] || fail "posted retry requires existing result pointer"
      [ -n "$existing_approved_value" ] || fail "posted retry requires existing approved-review pointer"
      if [ -n "${RESULT_FILE:-}" ] && [ "$RESULT_FILE" != "$existing_result_value" ]; then
        fail "RESULT_FILE must match existing failed result"
      fi
      if [ -n "${APPROVED_REVIEW_FILE:-}" ] && [ "$APPROVED_REVIEW_FILE" != "$existing_approved_value" ]; then
        fail "APPROVED_REVIEW_FILE must match existing failed approved-review"
      fi
      handoff_value="$existing_handoff_value"
      result_value="$existing_result_value"
      approved_value="$existing_approved_value"
      validated_payload_value="$(validated_payload_value_for "$physical_path" "$approved_value" "$existing_validated_payload_value")"
      presented_at_value="$existing_presented_at"
      presentation_status_value="$existing_presentation_status"
      finished_at_value="$FINISHED_AT"
      github_attempted_value="true"
      github_result_value="succeeded"
      github_posted_at_value="$GITHUB_POSTED_AT"
      ;;
    *)
      if [ -n "$archived_terminal_state" ]; then
        fail "invalid lease transition: $archived_terminal_state -> created"
      fi
      fail "invalid lease transition: $previous_state -> $STATE"
      ;;
  esac

  if [ -n "$handoff_value" ]; then
    validate_direct_child_path "handoff" "$handoff_value" "-handoff.json"
  fi
  if [ -n "$result_value" ]; then
    validate_direct_child_path "result" "$result_value" "-result.json"
  fi
  if [ -n "$approved_value" ]; then
    validate_direct_child_path "approved review" "$approved_value" "-approved-review.json"
  fi
  if [ -n "$validated_payload_value" ]; then
    validate_direct_child_path "validated payload" "$validated_payload_value" "-validated-review-payload.json"
  fi

  if [ -n "$result_value" ]; then
    LEASE_EXPECTED_BASE_REF="$base_ref_value" LEASE_EXPECTED_HEAD_REF="$head_ref_value" \
      validate_result_artifact "$physical_path" "$result_value"
    result_handoff_value="$(result_handoff_file_for "$physical_path" "$result_value")"
    if [ -n "$handoff_value" ] && [ "$handoff_value" != "$result_handoff_value" ]; then
      fail "lease handoff/result binding mismatch"
    fi
    handoff_value="$result_handoff_value"
    if [ "$STATE" = "gated" ]; then
      result_presentation_status="$(result_presentation_status_for "$physical_path" "$result_value")"
      [ "$result_presentation_status" = "preview-current" ] ||
        fail "gated result must have preview-current presentation"
    fi
  fi

  prepare_write_target "lease" "$LEASE_FILE"
  tmp_file="$(mktemp ".ephemeral/.lease-${PR_NUMBER}-${digest}.XXXXXX")" ||
    fail "failed to create lease temp file"
  trap "rm -f -- '$tmp_file'" EXIT

  write_lease_json "$tmp_file"

  assert_readable_file "lease temp file" "$tmp_file"
  validate_lease_schema "$tmp_file"
  validate_lease_timestamps "$tmp_file"
  validate_lease_identity "$tmp_file" "$physical_path"
  validate_referenced_artifacts "$tmp_file" "$physical_path"
  if [ -n "$archived_terminal_state" ]; then
    if [ "${REVIEW_LEASE_ENABLE_TEST_HOOKS:-}" = "yes" ] &&
      [ "${REVIEW_LEASE_TEST_FAIL_ARCHIVE_PREPARATION:-}" = "yes" ]; then
      fail "test requested archive preparation failure"
    fi
    prepare_write_target "archived lease" "$archive_path"
    mv "$LEASE_FILE" "$archive_path"
    if [ "${REVIEW_LEASE_ENABLE_TEST_HOOKS:-}" = "yes" ] &&
      [ "${REVIEW_LEASE_TEST_FAIL_ACTIVE_WRITE_AFTER_ARCHIVE:-}" = "yes" ]; then
      fail "test requested active lease write failure after archive"
    fi
  fi
  mv -f "$tmp_file" "$LEASE_FILE"
  trap - EXIT
  printf '%s\n' "$LEASE_FILE"
}

validate_command() {
  local physical_path
  require_repo_root
  require_jq
  validate_repository
  validate_pr_number
  physical_path="$(physical_worktree_path)"
  validate_lease_path_identity "$physical_path"
  validate_lease_file "$LEASE_FILE" "$physical_path"
}

current_utc_timestamp() {
  date -u "+%Y-%m-%dT%H:%M:%SZ"
}

validate_yes_no() {
  local label="$1"
  local value="$2"
  case "$value" in
    yes | no) ;;
    *) fail "$label must be yes or no" ;;
  esac
}

cleanup_target_physical_path() {
  require_env WORKTREE_PATH
  case "$WORKTREE_PATH" in
    /* | [A-Za-z]:/* | [A-Za-z]:\\*) ;;
    *) fail "WORKTREE_PATH must be absolute" ;;
  esac
  if [ -d "$WORKTREE_PATH" ]; then
    (cd "$WORKTREE_PATH" && pwd -P) ||
      fail "failed to resolve WORKTREE_PATH"
  else
    printf '\n'
  fi
}

primary_repo_physical_path() {
  local git_toplevel
  git_toplevel="$(git rev-parse --show-toplevel 2>/dev/null)" ||
    fail "failed to determine git repository root"
  (cd "$git_toplevel" && pwd -P) ||
    fail "failed to resolve git repository root"
}

is_registered_worktree() {
  local target="$1"
  local line listed_path physical_listed_path
  while IFS= read -r line; do
    case "$line" in
      worktree\ *)
        listed_path="${line#worktree }"
        if [ -d "$listed_path" ]; then
          physical_listed_path="$(cd "$listed_path" && pwd -P)" ||
            physical_listed_path="$listed_path"
        else
          physical_listed_path="$listed_path"
        fi
        [ "$physical_listed_path" = "$target" ] && return 0
        ;;
    esac
  done < <(git worktree list --porcelain)
  return 1
}

prepare_ephemeral_temp_dir() {
  guard_ephemeral
  mkdir -p .ephemeral
}

worktree_dirty_status() {
  local worktree="$1"
  local status_output
  status_output="$(git -C "$worktree" status --porcelain --untracked-files=all -- . ':(exclude).ephemeral' ':(exclude).ephemeral/**' 2>/dev/null)" ||
    fail "failed to inspect worktree status"
  if [ -n "$status_output" ]; then
    printf 'yes\n'
  else
    printf 'no\n'
  fi
}

path_allowed_by_file() {
  local file="$1"
  local path_value="$2"
  grep -Fx -- "$path_value" "$file" >/dev/null 2>&1
}

append_managed_ephemeral_paths_from_json() {
  local worktree="$1"
  local rel_path="$2"
  local allowed_file="$3"
  local jq_filter=""
  [ -n "$rel_path" ] || return
  validate_direct_child_path "managed artifact" "$rel_path"
  [ -f "$worktree/$rel_path" ] || return
  printf '%s\n' "$rel_path" >>"$allowed_file"
  case "$rel_path" in
    *-handoff.json)
      jq_filter='[
        .artifacts.scope_decision_file?,
        .artifacts.prior_threads_file?
      ]'
      ;;
    *-result.json)
      jq_filter='[
        .findings_file?,
        .review_body_file?,
        .context_file?,
        .artifacts.handoff_file?,
        .artifacts.scope_decision_file?,
        .artifacts.prior_threads_file?,
        .artifacts.rendered_preview_file?
      ]'
      ;;
    *-approved-review.json)
      jq_filter='[
        .findings_file?,
        .review_body_file?,
        .review_payload_file?,
        .scope_decision_file?
      ]'
      ;;
    *-scope-decision.json)
      jq_filter='[
        .prior_context.path?
      ]'
      ;;
    *)
      return
      ;;
  esac
  jq -r "$jq_filter | .[] | select(type == \"string\" and test(\"^\\\\.ephemeral/[^/]+$\"))" \
    "$worktree/$rel_path" >>"$allowed_file" 2>/dev/null || true
}

collect_managed_ephemeral_paths() {
  local worktree="$1"
  local allowed_file="$2"
  local handoff_file result_file approved_review_file validated_payload_file referenced_file snapshot_file
  : >"$allowed_file"
  if [ "$cleanup_lease_exists" != "yes" ] || [ "$cleanup_identity_match" != "yes" ]; then
    return
  fi
  handoff_file="$(jq_value "$LEASE_FILE" 'if .artifacts.handoff_file == null then "" else .artifacts.handoff_file end')"
  result_file="$(jq_value "$LEASE_FILE" 'if .artifacts.result_file == null then "" else .artifacts.result_file end')"
  approved_review_file="$(jq_value "$LEASE_FILE" 'if .artifacts.approved_review_file == null then "" else .artifacts.approved_review_file end')"
  validated_payload_file="$(jq_value "$LEASE_FILE" 'if .artifacts.validated_payload_file == null then "" else .artifacts.validated_payload_file end')"
  append_managed_ephemeral_paths_from_json "$worktree" "$handoff_file" "$allowed_file"
  append_managed_ephemeral_paths_from_json "$worktree" "$result_file" "$allowed_file"
  append_managed_ephemeral_paths_from_json "$worktree" "$approved_review_file" "$allowed_file"
  append_managed_ephemeral_paths_from_json "$worktree" "$validated_payload_file" "$allowed_file"
  prepare_ephemeral_temp_dir
  snapshot_file="$(mktemp ".ephemeral/.lease-managed-snapshot-${PR_NUMBER}.XXXXXX")" ||
    fail "failed to create managed artifact snapshot"
  sort -u "$allowed_file" >"$snapshot_file"
  while IFS= read -r referenced_file; do
    [ -n "$referenced_file" ] || continue
    append_managed_ephemeral_paths_from_json "$worktree" "$referenced_file" "$allowed_file"
  done <"$snapshot_file"
  rm -f "$snapshot_file"
  sort -u "$allowed_file" -o "$allowed_file"
}

worktree_ephemeral_has_unmanaged_entries() {
  local worktree="$1"
  local allowed_file="$2"
  local entry rel_path
  [ -d "$worktree/.ephemeral" ] || return 1
  while IFS= read -r entry; do
    rel_path=".ephemeral/${entry##*/}"
    if [ ! -f "$entry" ] || [ -L "$entry" ]; then
      return 0
    fi
    path_allowed_by_file "$allowed_file" "$rel_path" || return 0
  done < <(find "$worktree/.ephemeral" -mindepth 1 -maxdepth 1 -print 2>/dev/null)
  return 1
}

worktree_tracked_ephemeral_has_unmanaged_entries() {
  local worktree="$1"
  local allowed_file="$2"
  local rel_path
  while IFS= read -r -d '' rel_path; do
    path_allowed_by_file "$allowed_file" "$rel_path" || return 0
  done < <(git -C "$worktree" ls-files -z -- .ephemeral 2>/dev/null)
  return 1
}

worktree_untracked_ephemeral_status() {
  local worktree="$1"
  local allowed_file status_output line rel_path
  if [ ! -e "$worktree/.ephemeral" ] && [ ! -L "$worktree/.ephemeral" ] &&
    ! git -C "$worktree" ls-files --error-unmatch -- .ephemeral >/dev/null 2>&1; then
    printf 'no\n'
    return
  fi
  prepare_ephemeral_temp_dir
  allowed_file="$(mktemp ".ephemeral/.lease-managed-${PR_NUMBER}.XXXXXX")" ||
    fail "failed to create managed artifact temp file"
  trap 'rm -f "$allowed_file"' RETURN
  collect_managed_ephemeral_paths "$worktree" "$allowed_file"
  if worktree_ephemeral_has_unmanaged_entries "$worktree" "$allowed_file" ||
    worktree_tracked_ephemeral_has_unmanaged_entries "$worktree" "$allowed_file"; then
    printf 'yes\n'
    return
  fi
  status_output="$(git -C "$worktree" status --porcelain --untracked-files=all --ignored=matching -- .ephemeral 2>/dev/null)" ||
    fail "failed to inspect worktree .ephemeral status"
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    case "$line" in
      '?? .ephemeral/' | '!! .ephemeral/')
        if worktree_ephemeral_has_unmanaged_entries "$worktree" "$allowed_file"; then
          printf 'yes\n'
          return
        fi
        ;;
      '?? .ephemeral/'* | '!! .ephemeral/'*)
        rel_path="${line#?? }"
        rel_path="${rel_path#!! }"
        path_allowed_by_file "$allowed_file" "$rel_path" || {
          printf 'yes\n'
          return
        }
        ;;
      *)
        printf 'yes\n'
        return
        ;;
    esac
  done <<EOF
$status_output
EOF
  printf 'no\n'
}

worktree_has_ephemeral_residue() {
  local worktree="$1"
  [ -e "$worktree/.ephemeral" ] || [ -L "$worktree/.ephemeral" ]
}

cleanup_expected_token() {
  local digest="$1"
  printf 'remove-pr-review-worktree-%s-%s\n' "$PR_NUMBER" "$digest"
}

single_line_message() {
  printf '%s' "$1" |
    tr '\r\n\t' '   ' |
    sed 's/[[:space:]][[:space:]]*/ /g; s/^ //; s/ $//'
}

load_cleanup_lease_facts() {
  local physical_path="$1"
  local digest expected_path validation_error
  cleanup_lease_exists="no"
  cleanup_lease_state="missing"
  cleanup_recoverability=""
  cleanup_identity_match="no"
  cleanup_lease_invalid="no"
  cleanup_invalid_message=""

  if ! validation_error="$(validate_direct_child_path "lease" "$LEASE_FILE" "-lease.json" 2>&1)"; then
    cleanup_lease_invalid="yes"
    cleanup_invalid_message="$(single_line_message "$validation_error")"
    return 1
  fi
  if [ ! -e "$LEASE_FILE" ]; then
    return
  fi

  if ! validation_error="$(assert_readable_file "lease file" "$LEASE_FILE" 2>&1)"; then
    cleanup_lease_invalid="yes"
    cleanup_invalid_message="$(single_line_message "$validation_error")"
    return 1
  fi
  if ! validation_error="$(validate_lease_schema "$LEASE_FILE" 2>&1)"; then
    cleanup_lease_invalid="yes"
    cleanup_invalid_message="$(single_line_message "$validation_error")"
    return 1
  fi
  if ! validation_error="$(validate_lease_timestamps "$LEASE_FILE" 2>&1)"; then
    cleanup_lease_invalid="yes"
    cleanup_invalid_message="$(single_line_message "$validation_error")"
    return 1
  fi
  cleanup_lease_exists="yes"
  cleanup_lease_state="$(jq_value "$LEASE_FILE" '.state')"
  cleanup_recoverability="$(jq_value "$LEASE_FILE" 'if .failure.recoverability == null then "" else .failure.recoverability end')"

  if [ -n "$physical_path" ]; then
    digest="$(worktree_digest_for "$physical_path")"
    expected_path="$(expected_lease_path_for "$PR_NUMBER" "$digest")"
    if [ "$(jq_value "$LEASE_FILE" '.repository')" = "$REPOSITORY" ] &&
      [ "$(jq_value "$LEASE_FILE" '.pr_number')" = "$PR_NUMBER" ] &&
      [ "$(jq_value "$LEASE_FILE" '.worktree_path')" = "$physical_path" ] &&
      [ "$(jq_value "$LEASE_FILE" '.worktree_digest')" = "$digest" ] &&
      [ "$(jq_value "$LEASE_FILE" '.lease_file')" = "$LEASE_FILE" ] &&
      [ "$LEASE_FILE" = "$expected_path" ]; then
      cleanup_identity_match="yes"
      if ! validation_error="$(validate_referenced_artifacts "$LEASE_FILE" "$physical_path" 2>&1)"; then
        cleanup_lease_invalid="yes"
        cleanup_invalid_message="$(single_line_message "$validation_error")"
        return 1
      fi
    fi
  fi
}

cleanup_requires_confirmation() {
  local state="$1"
  local recoverability="$2"
  case "$state" in
    invalid) printf 'no\n' ;;
    posted | aborted) printf 'no\n' ;;
    failed)
      if [ "$recoverability" = "unrecoverable" ]; then
        printf 'no\n'
      else
        printf 'yes\n'
      fi
      ;;
    *) printf 'yes\n' ;;
  esac
}

cleanup_refusal_message() {
  local reason="$1"
  local state="$2"
  case "$reason" in
    dirty) printf 'dirty worktree retained\n' ;;
    invalid-lease) printf 'invalid lease mechanics: %s\n' "$cleanup_invalid_message" ;;
    untracked-artifacts) printf 'untracked .ephemeral artifacts retained\n' ;;
    identity-mismatch) printf 'lease identity mismatch retained\n' ;;
    confirmation-required) printf 'confirmation required for %s lease\n' "$state" ;;
    confirmation-token-mismatch) printf 'confirmation token mismatch for %s lease\n' "$state" ;;
    expected-state-mismatch) printf 'expected state mismatch retained\n' ;;
    primary-worktree) printf 'primary worktree retained\n' ;;
    non-worktree) printf 'non-worktree path skipped\n' ;;
    missing-worktree) printf 'missing worktree skipped\n' ;;
    *) printf '%s\n' "$reason" ;;
  esac
}

classify_cleanup() {
  local physical_path primary_path digest expected_path registered

  cleanup_physical_path="$(cleanup_target_physical_path)"
  primary_path="$(primary_repo_physical_path)"

  cleanup_refusal_reason=""
  cleanup_can_remove="no"
  cleanup_dirty="no"
  cleanup_untracked_ephemeral="no"
  cleanup_metadata_outcome=""
  cleanup_force_remove_allowed="no"

  if ! load_cleanup_lease_facts "$cleanup_physical_path"; then
    cleanup_refusal_reason="invalid-lease"
    cleanup_lease_state="invalid"
    cleanup_identity_match="no"
  fi

  registered="no"
  if [ -z "$cleanup_physical_path" ]; then
    cleanup_refusal_reason="missing-worktree"
  elif [ "$cleanup_physical_path" = "$primary_path" ]; then
    cleanup_refusal_reason="primary-worktree"
  elif [ -n "$cleanup_refusal_reason" ]; then
    :
  elif is_registered_worktree "$cleanup_physical_path"; then
    registered="yes"
    cleanup_dirty="$(worktree_dirty_status "$cleanup_physical_path")"
    cleanup_untracked_ephemeral="$(worktree_untracked_ephemeral_status "$cleanup_physical_path")"
  else
    cleanup_refusal_reason="non-worktree"
  fi

  if [ -z "$cleanup_refusal_reason" ]; then
    digest="$(worktree_digest_for "$cleanup_physical_path")"
    expected_path="$(expected_lease_path_for "$PR_NUMBER" "$digest")"
    if [ "$cleanup_lease_exists" = "no" ] && [ "$LEASE_FILE" != "$expected_path" ]; then
      cleanup_refusal_reason="identity-mismatch"
    elif [ "$cleanup_dirty" = "yes" ]; then
      cleanup_refusal_reason="dirty"
    elif [ "$cleanup_untracked_ephemeral" = "yes" ]; then
      cleanup_refusal_reason="untracked-artifacts"
    elif [ "$cleanup_lease_exists" = "yes" ] && [ "$cleanup_identity_match" != "yes" ]; then
      cleanup_refusal_reason="identity-mismatch"
    elif [ -n "${EXPECTED_STATE:-}" ] && [ "$cleanup_lease_state" != "$EXPECTED_STATE" ]; then
      cleanup_refusal_reason="expected-state-mismatch"
    fi
  fi

  cleanup_requires_confirmation_value="$(cleanup_requires_confirmation "$cleanup_lease_state" "$cleanup_recoverability")"
  if [ -z "$cleanup_refusal_reason" ]; then
    if [ "$cleanup_requires_confirmation_value" = "yes" ]; then
      if [ "${ALLOW_POLICY_OVERRIDE:-no}" != "yes" ]; then
        cleanup_refusal_reason="confirmation-required"
      else
        expected_token="$(cleanup_expected_token "$(worktree_digest_for "$cleanup_physical_path")")"
        if [ "${CONFIRM_REMOVE_TOKEN:-}" != "$expected_token" ]; then
          cleanup_refusal_reason="confirmation-token-mismatch"
        fi
      fi
    fi
  fi

  case "$cleanup_refusal_reason" in
    "")
      cleanup_can_remove="yes"
      cleanup_metadata_outcome=""
      if worktree_has_ephemeral_residue "$cleanup_physical_path"; then
        cleanup_force_remove_allowed="yes"
      fi
      ;;
    dirty | identity-mismatch | confirmation-required | confirmation-token-mismatch | expected-state-mismatch | primary-worktree | untracked-artifacts)
      cleanup_metadata_outcome="retained"
      ;;
    invalid-lease)
      cleanup_metadata_outcome="failed"
      ;;
    non-worktree | missing-worktree)
      cleanup_metadata_outcome="skipped"
      ;;
  esac
}

print_cleanup_classifier_fields() {
  printf 'CAN_REMOVE=%s\n' "$cleanup_can_remove"
  printf 'REFUSAL_REASON=%s\n' "$cleanup_refusal_reason"
  printf 'DIRTY=%s\n' "$cleanup_dirty"
  printf 'LEASE_STATE=%s\n' "$cleanup_lease_state"
  printf 'IDENTITY_MATCH=%s\n' "$cleanup_identity_match"
  printf 'REQUIRES_CONFIRMATION=%s\n' "$cleanup_requires_confirmation_value"
  printf 'METADATA_OUTCOME=%s\n' "$cleanup_metadata_outcome"
  printf 'FORCE_REMOVE_ALLOWED=%s\n' "$cleanup_force_remove_allowed"
}

record_cleanup_metadata() {
  local file="$1"
  local outcome="$2"
  local checked_at tmp_file

  [ -f "$file" ] || return
  checked_at="$(current_utc_timestamp)"
  tmp_file="$(mktemp ".ephemeral/.lease-cleanup-${PR_NUMBER}.XXXXXX")" ||
    fail "failed to create cleanup temp file"
  trap "rm -f -- '$tmp_file'" EXIT
  jq \
    --arg outcome "$outcome" \
    --arg checked_at "$checked_at" \
    '.cleanup = {
      last_outcome: (if $outcome == "" then (.cleanup.last_outcome // null) else $outcome end),
      last_checked_at: $checked_at
    }' "$file" >"$tmp_file"
  validate_lease_schema "$tmp_file"
  validate_lease_timestamps "$tmp_file"
  mv -f "$tmp_file" "$file"
  trap - EXIT
}

cleanup_inspection() {
  require_repo_root
  require_jq
  validate_repository
  validate_pr_number
  require_env LEASE_FILE
  ALLOW_POLICY_OVERRIDE="${ALLOW_POLICY_OVERRIDE:-no}"
  validate_yes_no ALLOW_POLICY_OVERRIDE "$ALLOW_POLICY_OVERRIDE"
  classify_cleanup
  if [ "$cleanup_lease_exists" = "yes" ] && [ "$cleanup_identity_match" = "yes" ]; then
    record_cleanup_metadata "$LEASE_FILE" ""
  fi
  printf 'OUTCOME=inspect\n'
  print_cleanup_classifier_fields
}

cleanup_worktree() {
  local message remove_status

  require_repo_root
  require_jq
  validate_repository
  validate_pr_number
  require_env LEASE_FILE
  require_env ALLOW_POLICY_OVERRIDE
  validate_yes_no ALLOW_POLICY_OVERRIDE "$ALLOW_POLICY_OVERRIDE"
  classify_cleanup
  case "$cleanup_refusal_reason" in
    "")
      remove_status=0
      if [ "$cleanup_force_remove_allowed" = "yes" ]; then
        git worktree remove -f "$cleanup_physical_path" || remove_status=$?
      else
        git worktree remove "$cleanup_physical_path" || remove_status=$?
      fi
      if [ "$remove_status" -eq 0 ]; then
        if [ "$cleanup_lease_exists" = "yes" ] && [ "$cleanup_identity_match" = "yes" ]; then
          record_cleanup_metadata "$LEASE_FILE" "removed"
        fi
        cleanup_metadata_outcome="removed"
        printf 'OUTCOME=removed\n'
        print_cleanup_classifier_fields
        printf 'MESSAGE=worktree removed\n'
        return 0
      fi
      if [ "$cleanup_lease_exists" = "yes" ] && [ "$cleanup_identity_match" = "yes" ]; then
        record_cleanup_metadata "$LEASE_FILE" "failed"
      fi
      cleanup_metadata_outcome="failed"
      printf 'OUTCOME=failed\n'
      print_cleanup_classifier_fields
      printf 'MESSAGE=git worktree remove failed\n'
      return 1
      ;;
    invalid-lease)
      message="$(cleanup_refusal_message "$cleanup_refusal_reason" "$cleanup_lease_state")"
      printf 'OUTCOME=failed\n'
      print_cleanup_classifier_fields
      printf 'MESSAGE=%s\n' "$message"
      return 0
      ;;
    non-worktree | missing-worktree)
      if [ "$cleanup_lease_exists" = "yes" ] && [ "$cleanup_identity_match" = "yes" ]; then
        record_cleanup_metadata "$LEASE_FILE" "skipped"
      fi
      message="$(cleanup_refusal_message "$cleanup_refusal_reason" "$cleanup_lease_state")"
      printf 'OUTCOME=skipped\n'
      print_cleanup_classifier_fields
      printf 'MESSAGE=%s\n' "$message"
      return 0
      ;;
    *)
      if [ "$cleanup_lease_exists" = "yes" ] && [ "$cleanup_identity_match" = "yes" ]; then
        record_cleanup_metadata "$LEASE_FILE" "retained"
      fi
      message="$(cleanup_refusal_message "$cleanup_refusal_reason" "$cleanup_lease_state")"
      printf 'OUTCOME=retained\n'
      print_cleanup_classifier_fields
      printf 'MESSAGE=%s\n' "$message"
      return 0
      ;;
  esac
}

case "$command_name" in
  derive-path)
    derive_lease_path
    ;;
  write)
    write_lease
    ;;
  validate)
    validate_command
    ;;
  inspect-worktree)
    cleanup_inspection
    ;;
  cleanup-worktree)
    cleanup_worktree
    ;;
  *)
    fail "usage: review-leases.sh derive-path|write|validate|inspect-worktree|cleanup-worktree"
    ;;
esac
