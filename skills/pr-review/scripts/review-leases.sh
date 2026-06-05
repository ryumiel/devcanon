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
  local git_toplevel physical_toplevel physical_pwd
  git_toplevel="$(git rev-parse --show-toplevel 2>/dev/null)" ||
    fail "failed to determine git repository root"
  physical_toplevel="$(cd "$git_toplevel" && pwd -P)" ||
    fail "failed to resolve git repository root"
  physical_pwd="$(pwd -P)"
  [ "$physical_toplevel" = "$physical_pwd" ] ||
    fail "review-leases.sh must run from the primary repository root"
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

  normalized="$(
    printf '%s\n' "$value" |
      jq -Rr 'fromdateiso8601 | strftime("%Y-%m-%dT%H:%M:%SZ")' 2>/dev/null
  )" || fail "$label is not a valid UTC timestamp"
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
  (cd "$WORKTREE_PATH" && pwd -P) ||
    fail "failed to resolve WORKTREE_PATH"
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
}

validate_approved_review_artifact() {
  local worktree="$1"
  local file="$2"
  local fallback_base_ref="$3"
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
    and ((.artifacts | keys_unsorted | sort) == (["handoff_file", "result_file", "approved_review_file"] | sort))
    and (.artifacts.handoff_file | optional_direct_ephemeral_path("-handoff.json"))
    and (.artifacts.result_file | optional_direct_ephemeral_path("-result.json"))
    and (.artifacts.approved_review_file | optional_direct_ephemeral_path("-approved-review.json"))
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
    and (.failure.phase == null or one_of(["handoff-validation", "review", "result-validation", "preview-render", "approval-freeze", "github-post"]; .failure.phase))
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
        .artifacts.result_file != null
        and (.terminal.finished_at | timestamp)
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
  local state base_ref handoff_file result_file approved_review_file
  state="$(jq_value "$file" '.state')"
  base_ref="$(jq_value "$file" '.base_ref')"
  handoff_file="$(jq_value "$file" 'if .artifacts.handoff_file == null then "" else .artifacts.handoff_file end')"
  result_file="$(jq_value "$file" 'if .artifacts.result_file == null then "" else .artifacts.result_file end')"
  approved_review_file="$(jq_value "$file" 'if .artifacts.approved_review_file == null then "" else .artifacts.approved_review_file end')"

  if [ -n "$handoff_file" ]; then
    validate_direct_child_path "handoff" "$handoff_file" "-handoff.json"
  fi
  if [ -n "$result_file" ]; then
    validate_direct_child_path "result" "$result_file" "-result.json"
  fi
  if [ -n "$approved_review_file" ]; then
    validate_direct_child_path "approved review" "$approved_review_file" "-approved-review.json"
  fi

  if [ -n "$handoff_file" ]; then
    validate_handoff_artifact "$physical_path" "$handoff_file"
  fi
  case "$state" in
    reviewed | gated | posted | aborted)
      validate_result_artifact "$physical_path" "$result_file"
      ;;
    failed)
      if [ -n "$result_file" ]; then
        validate_result_artifact "$physical_path" "$result_file"
      fi
      ;;
  esac
  if [ "$state" = "posted" ] || { [ "$state" = "failed" ] && [ -n "$approved_review_file" ]; }; then
    validate_approved_review_artifact "$physical_path" "$approved_review_file" "$base_ref"
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

transition_allowed() {
  local previous="$1"
  local target="$2"
  case "$previous:$target" in
    created:created | gated:gated) return 0 ;;
    created:reviewed | reviewed:gated | reviewed:aborted | gated:posted | gated:aborted | gated:failed) return 0 ;;
    reviewed:failed | created:failed | failed:gated | failed:aborted) return 0 ;;
    *) return 1 ;;
  esac
}

validate_same_state_update() {
  local file="$1"
  local state="$2"
  local old_handoff old_result old_presented_at old_presentation_status

  case "$state" in
    created)
      old_handoff="$(jq_value "$file" 'if .artifacts.handoff_file == null then "" else .artifacts.handoff_file end')"
      [ -z "$old_handoff" ] || fail "invalid lease transition: created -> created"
      [ -n "${HANDOFF_FILE:-}" ] || fail "invalid lease transition: created -> created"
      ;;
    gated)
      old_result="$(jq_value "$file" 'if .artifacts.result_file == null then "" else .artifacts.result_file end')"
      old_presented_at="$(jq_value "$file" 'if .presentation.presented_at == null then "" else .presentation.presented_at end')"
      old_presentation_status="$(jq_value "$file" 'if .presentation.status == null then "" else .presentation.status end')"
      if [ -z "${RESULT_FILE:-}" ] && [ -z "${PRESENTED_AT:-}" ] && [ -z "${PRESENTATION_STATUS:-}" ]; then
        fail "invalid lease transition: gated -> gated"
      fi
      if [ "${RESULT_FILE:-$old_result}" = "$old_result" ] &&
        [ "${PRESENTED_AT:-$old_presented_at}" = "$old_presented_at" ] &&
        [ "${PRESENTATION_STATUS:-$old_presentation_status}" = "$old_presentation_status" ]; then
        fail "invalid lease transition: gated -> gated"
      fi
      ;;
    *)
      fail "invalid lease transition: $state -> $state"
      ;;
  esac
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

write_lease() {
  local physical_path digest tmp_file existing_file previous_state
  local base_ref_value head_ref_value
  local created_at_value updated_at_value handoff_value result_value approved_value
  local presented_at_value presentation_status_value finished_at_value terminal_reason_value
  local failure_phase_value failure_reason_value failure_recoverability_value
  local github_attempted_value github_result_value github_posted_at_value

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
  previous_state=""
  if [ -e "$LEASE_FILE" ]; then
    validate_lease_file "$LEASE_FILE" "$physical_path"
    existing_file="$LEASE_FILE"
    previous_state="$(jq_value "$LEASE_FILE" '.state')"
    if [ -n "${EXPECTED_STATE:-}" ] && [ "$EXPECTED_STATE" != "$previous_state" ]; then
      fail "EXPECTED_STATE mismatch: $previous_state"
    fi
    transition_allowed "$previous_state" "$STATE" ||
      fail "invalid lease transition: $previous_state -> $STATE"
    if [ "$previous_state" = "$STATE" ]; then
      validate_same_state_update "$LEASE_FILE" "$STATE"
    fi
  else
    [ "$STATE" = "created" ] || fail "invalid lease transition: none -> $STATE"
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

  handoff_value="${HANDOFF_FILE:-$(existing_field "$existing_file" 'if .artifacts.handoff_file == null then "" else .artifacts.handoff_file end' "")}"
  result_value="${RESULT_FILE:-$(existing_field "$existing_file" 'if .artifacts.result_file == null then "" else .artifacts.result_file end' "")}"
  approved_value="${APPROVED_REVIEW_FILE:-$(existing_field "$existing_file" 'if .artifacts.approved_review_file == null then "" else .artifacts.approved_review_file end' "")}"
  presented_at_value="${PRESENTED_AT:-$(existing_field "$existing_file" 'if .presentation.presented_at == null then "" else .presentation.presented_at end' "")}"
  presentation_status_value="${PRESENTATION_STATUS:-$(existing_field "$existing_file" 'if .presentation.status == null then "" else .presentation.status end' "")}"
  finished_at_value="${FINISHED_AT:-$(existing_field "$existing_file" 'if .terminal.finished_at == null then "" else .terminal.finished_at end' "")}"
  terminal_reason_value="${TERMINAL_REASON:-$(existing_field "$existing_file" 'if .terminal.reason == null then "" else .terminal.reason end' "")}"
  failure_phase_value="${FAILURE_PHASE:-$(existing_field "$existing_file" 'if .failure.phase == null then "" else .failure.phase end' "")}"
  failure_reason_value="${FAILURE_REASON:-$(existing_field "$existing_file" 'if .failure.reason == null then "" else .failure.reason end' "")}"
  failure_recoverability_value="${FAILURE_RECOVERABILITY:-$(existing_field "$existing_file" 'if .failure.recoverability == null then "" else .failure.recoverability end' "")}"
  github_attempted_value="$(bool_json_or_default "${GITHUB_POST_ATTEMPTED:-}" "$(existing_field "$existing_file" '.github.github_post_attempted // false' "false")")"
  github_result_value="${GITHUB_POST_RESULT:-$(existing_field "$existing_file" '.github.github_post_result // "not-attempted"' "not-attempted")}"
  github_posted_at_value="${GITHUB_POSTED_AT:-$(existing_field "$existing_file" 'if .github.github_posted_at == null then "" else .github.github_posted_at end' "")}"

  if [ "$STATE" = "created" ]; then
    result_value=""
    approved_value=""
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
  elif [ "$STATE" = "reviewed" ]; then
    [ -n "$result_value" ] || fail "RESULT_FILE is required for reviewed"
    approved_value=""
    finished_at_value=""
    failure_phase_value=""
    failure_reason_value=""
    failure_recoverability_value=""
    github_attempted_value="false"
    github_result_value="not-attempted"
    github_posted_at_value=""
  elif [ "$STATE" = "gated" ]; then
    [ -n "$result_value" ] || fail "RESULT_FILE is required for gated"
    [ -n "$presented_at_value" ] || fail "PRESENTED_AT is required for gated"
    [ -n "$presentation_status_value" ] || fail "PRESENTATION_STATUS is required for gated"
    approved_value=""
    finished_at_value=""
    failure_phase_value=""
    failure_reason_value=""
    failure_recoverability_value=""
    github_attempted_value="false"
    github_result_value="not-attempted"
    github_posted_at_value=""
  elif [ "$STATE" = "posted" ]; then
    [ -n "$result_value" ] || fail "RESULT_FILE is required for posted"
    [ -n "$approved_value" ] || fail "APPROVED_REVIEW_FILE is required for posted"
    [ -n "$finished_at_value" ] || fail "FINISHED_AT is required for posted"
    github_attempted_value="true"
    github_result_value="succeeded"
    [ -n "$github_posted_at_value" ] || fail "GITHUB_POSTED_AT is required for posted"
    failure_phase_value=""
    failure_reason_value=""
    failure_recoverability_value=""
  elif [ "$STATE" = "aborted" ]; then
    [ -n "$result_value" ] || fail "RESULT_FILE is required for aborted"
    [ -n "$finished_at_value" ] || fail "FINISHED_AT is required for aborted"
    [ -n "$terminal_reason_value" ] || fail "TERMINAL_REASON is required for aborted"
    approved_value=""
    failure_phase_value=""
    failure_reason_value=""
    failure_recoverability_value=""
    github_attempted_value="false"
    github_result_value="not-attempted"
    github_posted_at_value=""
  else
    [ -n "$finished_at_value" ] || fail "FINISHED_AT is required for failed"
    [ -n "$failure_phase_value" ] || fail "FAILURE_PHASE is required for failed"
    [ -n "$failure_reason_value" ] || fail "FAILURE_REASON is required for failed"
    [ -n "$failure_recoverability_value" ] || fail "FAILURE_RECOVERABILITY is required for failed"
    if [ "$github_attempted_value" = "true" ] && [ "$github_result_value" != "failed" ]; then
      fail "GITHUB_POST_RESULT must be failed for failed"
    fi
    github_posted_at_value=""
  fi

  if [ -n "$handoff_value" ]; then
    validate_direct_child_path "handoff" "$handoff_value" "-handoff.json"
  fi
  if [ -n "$result_value" ]; then
    validate_direct_child_path "result" "$result_value" "-result.json"
  fi
  if [ -n "$approved_value" ]; then
    validate_direct_child_path "approved review" "$approved_value" "-approved-review.json"
  fi

  prepare_write_target "lease" "$LEASE_FILE"
  tmp_file="$(mktemp ".ephemeral/.lease-${PR_NUMBER}-${digest}.XXXXXX")" ||
    fail "failed to create lease temp file"
  trap 'rm -f "$tmp_file"' EXIT

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
        approved_review_file: nullable($values[13])
      },
      presentation: {
        presented_at: nullable($values[14]),
        status: nullable($values[15])
      },
      terminal: {
        finished_at: nullable($values[16]),
        reason: nullable($values[17])
      },
      failure: {
        phase: nullable($values[18]),
        reason: nullable($values[19]),
        recoverability: nullable($values[20])
      },
      github: {
        github_post_attempted: ($values[21] == "true"),
        github_post_result: $values[22],
        github_posted_at: nullable($values[23])
      }
    }' >"$tmp_file"

  assert_readable_file "lease temp file" "$tmp_file"
  validate_lease_schema "$tmp_file"
  validate_lease_timestamps "$tmp_file"
  validate_lease_identity "$tmp_file" "$physical_path"
  validate_referenced_artifacts "$tmp_file" "$physical_path"
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

worktree_untracked_ephemeral_status() {
  local worktree="$1"
  local status_output line
  if [ ! -e "$worktree/.ephemeral" ] && [ ! -L "$worktree/.ephemeral" ] &&
    ! git -C "$worktree" ls-files --error-unmatch -- .ephemeral >/dev/null 2>&1; then
    printf 'no\n'
    return
  fi
  status_output="$(git -C "$worktree" status --porcelain --untracked-files=all --ignored=matching -- .ephemeral 2>/dev/null)" ||
    fail "failed to inspect worktree .ephemeral status"
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    case "$line" in
      '?? .ephemeral/' | '!! .ephemeral/')
        if [ -n "$(find "$worktree/.ephemeral" -mindepth 1 -print -quit 2>/dev/null)" ]; then
          printf 'yes\n'
          return
        fi
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

record_cleanup_metadata() {
  local file="$1"
  local outcome="$2"
  local checked_at tmp_file

  [ -f "$file" ] || return
  checked_at="$(current_utc_timestamp)"
  tmp_file="$(mktemp ".ephemeral/.lease-cleanup-${PR_NUMBER}.XXXXXX")" ||
    fail "failed to create cleanup temp file"
  trap 'rm -f "$tmp_file"' EXIT
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
  local physical_path primary_path digest expected_path registered dirty requires_confirmation
  local refusal_reason can_remove metadata_outcome untracked_ephemeral

  require_repo_root
  require_jq
  validate_repository
  validate_pr_number
  require_env LEASE_FILE
  physical_path="$(cleanup_target_physical_path)"
  primary_path="$(primary_repo_physical_path)"

  if ! load_cleanup_lease_facts "$physical_path"; then
    refusal_reason="invalid-lease"
    cleanup_lease_state="invalid"
    cleanup_identity_match="no"
  else
    refusal_reason=""
  fi

  registered="no"
  dirty="no"
  untracked_ephemeral="no"
  if [ -z "$physical_path" ]; then
    refusal_reason="missing-worktree"
  elif [ "$physical_path" = "$primary_path" ]; then
    refusal_reason="primary-worktree"
  elif [ -n "$refusal_reason" ]; then
    :
  elif is_registered_worktree "$physical_path"; then
    registered="yes"
    dirty="$(worktree_dirty_status "$physical_path")"
    untracked_ephemeral="$(worktree_untracked_ephemeral_status "$physical_path")"
  else
    refusal_reason="non-worktree"
  fi

  if [ -z "$refusal_reason" ]; then
    digest="$(worktree_digest_for "$physical_path")"
    expected_path="$(expected_lease_path_for "$PR_NUMBER" "$digest")"
    if [ "$cleanup_lease_exists" = "no" ] && [ "$LEASE_FILE" != "$expected_path" ]; then
      refusal_reason="identity-mismatch"
    elif [ "$dirty" = "yes" ]; then
      refusal_reason="dirty"
    elif [ "$untracked_ephemeral" = "yes" ]; then
      refusal_reason="untracked-artifacts"
    elif [ "$cleanup_lease_exists" = "yes" ] && [ "$cleanup_identity_match" != "yes" ]; then
      refusal_reason="identity-mismatch"
    elif [ -n "${EXPECTED_STATE:-}" ] && [ "$cleanup_lease_state" != "$EXPECTED_STATE" ]; then
      refusal_reason="expected-state-mismatch"
    fi
  fi

  requires_confirmation="$(cleanup_requires_confirmation "$cleanup_lease_state" "$cleanup_recoverability")"
  can_remove="no"
  if [ -z "$refusal_reason" ]; then
    if [ "$requires_confirmation" = "yes" ]; then
      refusal_reason="confirmation-required"
    else
      can_remove="yes"
    fi
  fi

  metadata_outcome=""
  case "$refusal_reason" in
    dirty | identity-mismatch | confirmation-required | expected-state-mismatch | primary-worktree | untracked-artifacts) metadata_outcome="retained" ;;
    invalid-lease) metadata_outcome="failed" ;;
    non-worktree | missing-worktree) metadata_outcome="skipped" ;;
  esac
  if [ "$cleanup_lease_exists" = "yes" ] && [ "$cleanup_identity_match" = "yes" ]; then
    record_cleanup_metadata "$LEASE_FILE" "$metadata_outcome"
  fi

  printf 'OUTCOME=inspect\n'
  printf 'CAN_REMOVE=%s\n' "$can_remove"
  printf 'REFUSAL_REASON=%s\n' "$refusal_reason"
  printf 'DIRTY=%s\n' "$dirty"
  printf 'LEASE_STATE=%s\n' "$cleanup_lease_state"
  printf 'IDENTITY_MATCH=%s\n' "$cleanup_identity_match"
  printf 'REQUIRES_CONFIRMATION=%s\n' "$requires_confirmation"
}

cleanup_worktree() {
  local physical_path primary_path digest expected_path dirty requires_confirmation
  local refusal_reason message expected_token untracked_ephemeral

  require_repo_root
  require_jq
  validate_repository
  validate_pr_number
  require_env LEASE_FILE
  require_env ALLOW_POLICY_OVERRIDE
  validate_yes_no ALLOW_POLICY_OVERRIDE "$ALLOW_POLICY_OVERRIDE"
  physical_path="$(cleanup_target_physical_path)"
  primary_path="$(primary_repo_physical_path)"

  if ! load_cleanup_lease_facts "$physical_path"; then
    refusal_reason="invalid-lease"
    cleanup_lease_state="invalid"
    cleanup_identity_match="no"
  else
    refusal_reason=""
  fi

  dirty="no"
  untracked_ephemeral="no"
  if [ -z "$physical_path" ]; then
    refusal_reason="missing-worktree"
  elif [ "$physical_path" = "$primary_path" ]; then
    refusal_reason="primary-worktree"
  elif [ -n "$refusal_reason" ]; then
    :
  elif is_registered_worktree "$physical_path"; then
    dirty="$(worktree_dirty_status "$physical_path")"
    untracked_ephemeral="$(worktree_untracked_ephemeral_status "$physical_path")"
  else
    refusal_reason="non-worktree"
  fi

  if [ -z "$refusal_reason" ]; then
    digest="$(worktree_digest_for "$physical_path")"
    expected_path="$(expected_lease_path_for "$PR_NUMBER" "$digest")"
    if [ "$cleanup_lease_exists" = "no" ] && [ "$LEASE_FILE" != "$expected_path" ]; then
      refusal_reason="identity-mismatch"
    elif [ "$dirty" = "yes" ]; then
      refusal_reason="dirty"
    elif [ "$untracked_ephemeral" = "yes" ]; then
      refusal_reason="untracked-artifacts"
    elif [ "$cleanup_lease_exists" = "yes" ] && [ "$cleanup_identity_match" != "yes" ]; then
      refusal_reason="identity-mismatch"
    elif [ -n "${EXPECTED_STATE:-}" ] && [ "$cleanup_lease_state" != "$EXPECTED_STATE" ]; then
      refusal_reason="expected-state-mismatch"
    fi
  fi

  requires_confirmation="$(cleanup_requires_confirmation "$cleanup_lease_state" "$cleanup_recoverability")"
  if [ -z "$refusal_reason" ] && [ "$requires_confirmation" = "yes" ]; then
    if [ "$ALLOW_POLICY_OVERRIDE" != "yes" ]; then
      refusal_reason="confirmation-required"
    else
      expected_token="$(cleanup_expected_token "$(worktree_digest_for "$physical_path")")"
      if [ "${CONFIRM_REMOVE_TOKEN:-}" != "$expected_token" ]; then
        refusal_reason="confirmation-token-mismatch"
      fi
    fi
  fi
  case "$refusal_reason" in
    "")
      if git worktree remove "$physical_path"; then
        if [ "$cleanup_lease_exists" = "yes" ] && [ "$cleanup_identity_match" = "yes" ]; then
          record_cleanup_metadata "$LEASE_FILE" "removed"
        fi
        printf 'OUTCOME=removed\n'
        printf 'MESSAGE=worktree removed\n'
        return 0
      fi
      if [ "$cleanup_lease_exists" = "yes" ] && [ "$cleanup_identity_match" = "yes" ]; then
        record_cleanup_metadata "$LEASE_FILE" "failed"
      fi
      printf 'OUTCOME=failed\n'
      printf 'MESSAGE=git worktree remove failed\n'
      return 1
      ;;
    invalid-lease)
      message="$(cleanup_refusal_message "$refusal_reason" "$cleanup_lease_state")"
      printf 'OUTCOME=failed\n'
      printf 'MESSAGE=%s\n' "$message"
      return 0
      ;;
    non-worktree | missing-worktree)
      if [ "$cleanup_lease_exists" = "yes" ] && [ "$cleanup_identity_match" = "yes" ]; then
        record_cleanup_metadata "$LEASE_FILE" "skipped"
      fi
      message="$(cleanup_refusal_message "$refusal_reason" "$cleanup_lease_state")"
      printf 'OUTCOME=skipped\n'
      printf 'MESSAGE=%s\n' "$message"
      return 0
      ;;
    *)
      if [ "$cleanup_lease_exists" = "yes" ] && [ "$cleanup_identity_match" = "yes" ]; then
        record_cleanup_metadata "$LEASE_FILE" "retained"
      fi
      message="$(cleanup_refusal_message "$refusal_reason" "$cleanup_lease_state")"
      printf 'OUTCOME=retained\n'
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
