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

require_jq() {
  command -v jq >/dev/null 2>&1 ||
    fail "jq is required to validate pr-review manifests"
}

sha256_file() {
  local path="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$path" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$path" | awk '{print $1}'
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
    fail "review-manifests.sh must run from the repository root"
}

validate_sha_value() {
  local label="$1"
  local value="$2"
  case "$value" in
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
    *) fail "$label must be a 40-character lowercase hex SHA" ;;
  esac
}

validate_head_sha() {
  require_env HEAD_SHA
  validate_sha_value HEAD_SHA "$HEAD_SHA"
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

normalize_execution_working_directory_for_manifest() {
  local working_directory="$1"
  local normalized=""

  case "$working_directory" in
    /*)
      printf '%s\n' "$working_directory"
      return
      ;;
  esac

  if is_windows_absolute_path "$working_directory"; then
    if command -v cygpath >/dev/null 2>&1; then
      normalized="$(cygpath -u "$working_directory")" ||
        fail "failed to normalize execution working_directory"
      if [ -d "$normalized" ]; then
        normalized="$(cd "$normalized" && pwd -P)" ||
          fail "failed to normalize execution working_directory"
      fi
    fi
    case "$normalized" in
      /*) ;;
      *)
        normalized="$(cd "$working_directory" && pwd -P)" ||
          fail "failed to normalize execution working_directory"
        ;;
    esac
    printf '%s\n' "$normalized"
    return
  fi

  fail "execution working_directory must be absolute"
}

expected_handoff_path_for() {
  printf '.ephemeral/pr-%s-%s-handoff.json\n' "$1" "$2"
}

expected_result_path_for() {
  printf '.ephemeral/pr-%s-%s-result.json\n' "$1" "$2"
}

tmp_path_for() {
  local final="$1"
  printf '.ephemeral/.%s.tmp\n' "${final#.ephemeral/}"
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
  if [ -L .ephemeral ]; then
    fail ".ephemeral must be a directory, not a symlink"
  fi
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

jq_value() {
  local file="$1"
  local filter="$2"
  jq -r "$filter" "$file"
}

jq_json() {
  local file="$1"
  local filter="$2"
  jq -c "$filter" "$file"
}

json_equal() {
  jq -n -e --argjson left "$1" --argjson right "$2" '$left == $right' >/dev/null
}

script_dir_logical() {
  cd "$(dirname "${BASH_SOURCE[0]}")" && pwd
}

script_dir_physical() {
  cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P
}

resolve_pr_review_dir() {
  local dir candidate
  if [ -n "${PR_REVIEW_DIR:-}" ]; then
    dir="$PR_REVIEW_DIR"
  else
    dir="$(cd "$(script_dir_logical)/.." && pwd)" || fail "pr-review helper directory missing"
  fi
  candidate="$dir/scripts/prior-thread-artifacts.sh"
  if [ -f "$candidate" ] && [ -x "$candidate" ]; then
    printf '%s\n' "$dir"
    return
  fi
  if [ -z "${PR_REVIEW_DIR:-}" ]; then
    dir="$(cd "$(script_dir_physical)/.." && pwd -P)" || fail "pr-review helper directory missing"
    candidate="$dir/scripts/prior-thread-artifacts.sh"
    if [ -f "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s\n' "$dir"
      return
    fi
  fi
  fail "pr-review prior-thread artifact helper missing or not executable"
}

resolve_scope_helper() {
  local dir
  dir="$(resolve_pr_review_dir)"
  printf '%s/scripts/prior-thread-artifacts.sh\n' "$dir"
}

resolve_play_review_helper() {
  local candidate root physical_root
  if [ -n "${PLAY_REVIEW_HELPER:-}" ]; then
    [ -f "$PLAY_REVIEW_HELPER" ] && [ -x "$PLAY_REVIEW_HELPER" ] ||
      fail "play-review findings helper missing or not executable"
    printf '%s\n' "$PLAY_REVIEW_HELPER"
    return
  fi

  root="$(cd "$(script_dir_logical)/../.." && pwd)" ||
    fail "play-review findings helper missing or not executable"
  candidate="$root/play-review/scripts/review-artifacts.sh"
  if [ -f "$candidate" ] && [ -x "$candidate" ]; then
    printf '%s\n' "$candidate"
    return
  fi

  physical_root="$(cd "$(script_dir_physical)/../.." && pwd -P)" ||
    fail "play-review findings helper missing or not executable"
  candidate="$physical_root/play-review/scripts/review-artifacts.sh"
  if [ -f "$candidate" ] && [ -x "$candidate" ]; then
    printf '%s\n' "$candidate"
    return
  fi

  fail "play-review findings helper missing or not executable"
}

scope_prior_context() {
  local scope_decision_file="$1"
  jq -er '
    if (.prior_context | type) != "object" then
      empty
    elif (.prior_context.kind | type) != "string" then
      empty
    elif .prior_context.kind == "none" then
      if .prior_context.path == null then
        [.prior_context.kind, "null"] | @tsv
      else
        empty
      end
    elif .prior_context.kind == "github-prior-threads" then
      if (.prior_context.path | type) == "string" and .prior_context.path != "" then
        [.prior_context.kind, .prior_context.path] | @tsv
      else
        empty
      end
    else
      empty
    end
  ' "$scope_decision_file" || fail "scope decision prior_context is missing or malformed"
}

validate_scope_authority() {
  local scope_decision_file="$1"
  local expected_base_ref="$2"
  local manifest_prior_path="$3"
  local scope_helper prior_context prior_kind prior_path

  validate_direct_child_path "scope decision" "$scope_decision_file" "-scope-decision.json"
  assert_readable_file "scope decision file" "$scope_decision_file"

  prior_context="$(scope_prior_context "$scope_decision_file")"
  IFS=$'\t' read -r prior_kind prior_path <<EOF
$prior_context
EOF

  if [ "$manifest_prior_path" = "null" ]; then
    [ "$prior_kind" = "none" ] ||
      fail "prior threads path mismatch: manifest null but scope decision requires $prior_path"
  else
    validate_direct_child_path "prior threads" "$manifest_prior_path" "-prior-threads.json"
    [ "$prior_kind" = "github-prior-threads" ] ||
      fail "prior threads path mismatch: manifest $manifest_prior_path but scope decision has none"
    [ "$manifest_prior_path" = "$prior_path" ] ||
      fail "prior threads path mismatch: $manifest_prior_path"
  fi

  scope_helper="$(resolve_scope_helper)"
  if [ "$manifest_prior_path" = "null" ]; then
    HEAD_SHA="$HEAD_SHA" \
    BASE_REF="$expected_base_ref" \
    SCOPE_DECISION_FILE="$scope_decision_file" \
      bash "$scope_helper" validate-scope-decision
  else
    HEAD_SHA="$HEAD_SHA" \
    BASE_REF="$expected_base_ref" \
    SCOPE_DECISION_FILE="$scope_decision_file" \
    PRIOR_THREADS_FILE="$manifest_prior_path" \
      bash "$scope_helper" validate-scope-decision
    HEAD_SHA="$HEAD_SHA" \
    PRIOR_THREADS_FILE="$manifest_prior_path" \
      bash "$scope_helper" validate-prior-threads
  fi
}

guarded_scope_base_ref() {
  local scope_decision_file="$1"
  validate_direct_child_path "scope decision" "$scope_decision_file" "-scope-decision.json"
  assert_readable_file "scope decision file" "$scope_decision_file"
  jq_value "$scope_decision_file" '.full_range | sub("\\.\\.\\.HEAD$"; "")'
}

validate_execution_root() {
  local working_directory="$1"
  local review_head_sha="$2"
  local manifest_root execution_directory execution_root execution_head
  local normalized_working_directory normalized_manifest_root

  case "$working_directory" in
    /*) ;;
    [A-Za-z]:/* | [A-Za-z]:\\*) ;;
    *) fail "execution working_directory must be absolute" ;;
  esac
  [ -d "$working_directory" ] || fail "execution working_directory missing: $working_directory"
  manifest_root="$(git rev-parse --show-toplevel 2>/dev/null)" ||
    fail "failed to determine git repository root"
  manifest_root="$(cd "$manifest_root" && pwd -P)" ||
    fail "failed to resolve git repository root"
  execution_directory="$(cd "$working_directory" && pwd -P)" ||
    fail "failed to resolve execution working_directory"
  normalized_working_directory="$(normalize_absolute_path_text "$working_directory")"
  normalized_manifest_root="$(normalize_absolute_path_text "$manifest_root")"
  [ "$normalized_working_directory" = "$normalized_manifest_root" ] ||
    fail "execution working_directory must equal repository root"
  [ "$(normalize_absolute_path_text "$execution_directory")" = "$normalized_manifest_root" ] ||
    fail "execution working_directory must equal repository root"
  execution_root="$(git -C "$working_directory" rev-parse --show-toplevel 2>/dev/null)" ||
    fail "execution working_directory is not a git repository"
  execution_root="$(cd "$execution_root" && pwd -P)" ||
    fail "failed to resolve execution git root"
  [ "$execution_root" = "$manifest_root" ] ||
    fail "execution working_directory git root mismatch"
  execution_head="$(git -C "$working_directory" rev-parse HEAD 2>/dev/null)" ||
    fail "failed to determine execution HEAD"
  [ "$execution_head" = "$review_head_sha" ] ||
    fail "execution worktree HEAD mismatch"
}

validate_handoff_schema() {
  local file="$1"
  require_jq
  jq -e '
    def one_of($values; $value): ($values | index($value)) != null;
    def sha: type == "string" and test("^[0-9a-f]{40}$");
    def repo: type == "string" and test("^[^/[:space:]]+/[^/[:space:]]+$");
    def nonempty_string: type == "string" and length > 0;
    def ref_string: nonempty_string and (test("[[:space:][:cntrl:]]") | not);
    def head_ref_string: nonempty_string and (test("[[:cntrl:]]") | not);
    def absolute_path:
      type == "string"
      and length > 1
      and (startswith("/") or test("^[A-Za-z]:[\\\\/]"));
    def direct_ephemeral_path($suffix):
      type == "string"
      and test("^\\.ephemeral/[^/]+$")
      and endswith($suffix)
      and (contains("\\") | not)
      and (contains("..") | not);
    def no_forbidden:
      [.. | objects | keys_unsorted[]?]
      | all(. as $key | [
        "approval", "approved_review", "approved_review_file", "approval_state",
        "lease", "lease_state", "lease_file", "review_payload_file",
        "payload", "payload_sha256", "review_payload_sha256", "REVIEW_EVENT",
        "review_event"
      ] | index($key) == null);
    type == "object"
    and ((keys_unsorted | sort) == ([
      "schema", "pr_number", "repository", "execution", "base_ref",
      "head_ref", "review_scope_base_ref", "active_diff_range",
      "full_pr_diff_range", "review_head_sha", "mode", "language_hints",
      "follow_up", "artifacts"
    ] | sort))
    and no_forbidden
    and .schema == "pr-review/handoff/v1"
    and (.pr_number | type == "number" and . == floor and . >= 1)
    and (.repository | repo)
    and (.execution | type == "object")
    and ((.execution | keys_unsorted | sort) == (["kind", "working_directory"] | sort))
    and .execution.kind == "review-worktree"
    and (.execution.working_directory | absolute_path)
    and (.base_ref | ref_string)
    and (.head_ref | head_ref_string)
    and (.review_scope_base_ref | ref_string)
    and (.active_diff_range | nonempty_string)
    and (.full_pr_diff_range | nonempty_string)
    and (.review_head_sha | sha)
    and .mode == "github-post"
    and (.language_hints | type == "array" and all(.[]; type == "string" and test("^[a-z0-9][a-z0-9_+-]*$")))
    and (.follow_up | type == "object")
    and ((.follow_up | keys_unsorted | sort) == (["state", "last_reviewed_sha", "is_followup_narrow"] | sort))
    and one_of(["initial", "follow-up-full", "follow-up-narrow"]; .follow_up.state)
    and (
      if .follow_up.state == "initial" then
        .follow_up.last_reviewed_sha == null and .follow_up.is_followup_narrow == false
      elif .follow_up.state == "follow-up-narrow" then
        (.follow_up.last_reviewed_sha | sha) and .follow_up.is_followup_narrow == true
      else
        (.follow_up.last_reviewed_sha | sha) and .follow_up.is_followup_narrow == false
      end
    )
    and (.artifacts | type == "object")
    and ((.artifacts | keys_unsorted | sort) == (["scope_decision_file", "prior_threads_file"] | sort))
    and (.artifacts.scope_decision_file | direct_ephemeral_path("-scope-decision.json"))
    and (.artifacts.prior_threads_file == null or (.artifacts.prior_threads_file | direct_ephemeral_path("-prior-threads.json")))
  ' "$file" >/dev/null || fail "handoff schema mismatch: $file"
}

validate_result_schema() {
  local file="$1"
  require_jq
  jq -e '
    def one_of($values; $value): ($values | index($value)) != null;
    def sha: type == "string" and test("^[0-9a-f]{40}$");
    def hex_sha256: type == "string" and test("^[0-9a-f]{64}$");
    def repo: type == "string" and test("^[^/[:space:]]+/[^/[:space:]]+$");
    def direct_ephemeral_path($suffix):
      type == "string"
      and test("^\\.ephemeral/[^/]+$")
      and endswith($suffix)
      and (contains("\\") | not)
      and (contains("..") | not);
    def no_forbidden:
      [.. | objects | keys_unsorted[]?]
      | all(. as $key | [
        "approval", "approved_review", "approved_review_file", "approval_state",
        "lease", "lease_state", "lease_file", "review_payload_file",
        "payload", "payload_sha256", "review_payload_sha256", "REVIEW_EVENT",
        "review_event", "event"
      ] | index($key) == null);
    type == "object"
    and ((keys_unsorted | sort) == ([
      "schema", "pr_number", "repository", "review_head_sha", "findings_file",
      "review_body_file", "context_file", "artifacts", "digests",
      "scope_decision", "presentation", "validation"
    ] | sort))
    and no_forbidden
    and .schema == "pr-review/result/v1"
    and (.pr_number | type == "number" and . == floor and . >= 1)
    and (.repository | repo)
    and (.review_head_sha | sha)
    and (.findings_file | direct_ephemeral_path("-findings.json"))
    and (.review_body_file == null or (.review_body_file | direct_ephemeral_path("-review-body.md")))
    and (.context_file == null or (.context_file | direct_ephemeral_path("-context.md")))
    and (.artifacts | type == "object")
    and ((.artifacts | keys_unsorted | sort) == (["handoff_file", "scope_decision_file", "prior_threads_file", "rendered_preview_file"] | sort))
    and (.artifacts.handoff_file | direct_ephemeral_path("-handoff.json"))
    and (.artifacts.scope_decision_file | direct_ephemeral_path("-scope-decision.json"))
    and (.artifacts.prior_threads_file == null or (.artifacts.prior_threads_file | direct_ephemeral_path("-prior-threads.json")))
    and (.artifacts.rendered_preview_file == null or (.artifacts.rendered_preview_file | direct_ephemeral_path("-review-preview.md")))
    and (.digests | type == "object")
    and ((.digests | keys_unsorted | sort) == ([
      "handoff_sha256", "findings_sha256", "review_body_sha256",
      "context_sha256", "scope_decision_sha256", "prior_threads_sha256",
      "rendered_preview_sha256"
    ] | sort))
    and (.digests.handoff_sha256 | hex_sha256)
    and (.digests.findings_sha256 | hex_sha256)
    and (.digests.scope_decision_sha256 | hex_sha256)
    and (if .review_body_file == null then .digests.review_body_sha256 == null else (.digests.review_body_sha256 | hex_sha256) end)
    and (if .context_file == null then .digests.context_sha256 == null else (.digests.context_sha256 | hex_sha256) end)
    and (if .artifacts.prior_threads_file == null then .digests.prior_threads_sha256 == null else (.digests.prior_threads_sha256 | hex_sha256) end)
    and (if .artifacts.rendered_preview_file == null then .digests.rendered_preview_sha256 == null else (.digests.rendered_preview_sha256 | hex_sha256) end)
    and (.scope_decision | type == "object")
    and ((.scope_decision | keys_unsorted | sort) == (["summary", "selected_range", "full_range", "is_followup_narrow"] | sort))
    and (.scope_decision.summary | type == "string" and length > 0)
    and (.scope_decision.selected_range | type == "string" and length > 0)
    and (.scope_decision.full_range | type == "string" and length > 0)
    and (.scope_decision.is_followup_narrow | type == "boolean")
    and (.presentation | type == "object")
    and ((.presentation | keys_unsorted | sort) == (["status", "notes"] | sort))
    and one_of(["not-presented", "presented", "edited", "preview-current"]; .presentation.status)
    and (.presentation.notes == null or (.presentation.notes | type == "string"))
    and (.validation | type == "object")
    and ((.validation | keys_unsorted | sort) == (["status", "findings_validated", "scope_decision_validated"] | sort))
    and .validation.status == "valid"
    and .validation.findings_validated == true
    and .validation.scope_decision_validated == true
  ' "$file" >/dev/null || fail "result schema mismatch: $file"
}

validate_handoff_file() {
  local file="$1"
  local identity_file="${2:-$1}"
  local pr_number review_head_sha expected scope_decision_file prior_threads_file
  local review_scope_base_ref active_range full_range language_hints scope_language_hints
  local follow_state follow_last follow_narrow scope_last scope_narrow scope_mode
  local working_directory scope_head

  require_repo_root
  validate_pr_number
  validate_head_sha
  validate_direct_child_path "handoff" "$file"
  assert_readable_file "handoff file" "$file"
  validate_handoff_schema "$file"

  pr_number="$(jq_value "$file" '.pr_number')"
  [ "$pr_number" = "$PR_NUMBER" ] ||
    fail "handoff PR number mismatch: manifest $pr_number, current $PR_NUMBER"
  review_head_sha="$(jq_value "$file" '.review_head_sha')"
  [ "$review_head_sha" = "$HEAD_SHA" ] ||
    fail "review head mismatch: manifest $review_head_sha, current $HEAD_SHA"
  expected="$(expected_handoff_path_for "$pr_number" "$review_head_sha")"
  [ "$identity_file" = "$expected" ] || fail "handoff path mismatch: $identity_file"

  working_directory="$(jq_value "$file" '.execution.working_directory')"
  validate_execution_root "$working_directory" "$review_head_sha"

  scope_decision_file="$(jq_value "$file" '.artifacts.scope_decision_file')"
  prior_threads_file="$(jq_value "$file" 'if .artifacts.prior_threads_file == null then "null" else .artifacts.prior_threads_file end')"
  review_scope_base_ref="$(jq_value "$file" '.review_scope_base_ref')"
  validate_scope_authority "$scope_decision_file" "$review_scope_base_ref" "$prior_threads_file"

  scope_head="$(jq_value "$scope_decision_file" '.head_sha')"
  [ "$scope_head" = "$review_head_sha" ] || fail "scope decision head mismatch"
  active_range="$(jq_value "$file" '.active_diff_range')"
  full_range="$(jq_value "$file" '.full_pr_diff_range')"
  [ "$active_range" = "$(jq_value "$scope_decision_file" '.selected_range')" ] ||
    fail "handoff active diff range mismatch"
  [ "$full_range" = "$(jq_value "$scope_decision_file" '.full_range')" ] ||
    fail "handoff full diff range mismatch"
  language_hints="$(jq_json "$file" '.language_hints')"
  scope_language_hints="$(jq_json "$scope_decision_file" '.language_hints')"
  json_equal "$language_hints" "$scope_language_hints" ||
    fail "handoff language hints mismatch"

  follow_state="$(jq_value "$file" '.follow_up.state')"
  follow_last="$(jq_value "$file" 'if .follow_up.last_reviewed_sha == null then "" else .follow_up.last_reviewed_sha end')"
  follow_narrow="$(jq_value "$file" '.follow_up.is_followup_narrow')"
  scope_mode="$(jq_value "$scope_decision_file" '.mode')"
  scope_last="$(jq_value "$scope_decision_file" 'if .last_reviewed_sha == null then "" else .last_reviewed_sha end')"
  scope_narrow="$(jq_value "$scope_decision_file" '.is_followup_narrow')"
  case "$scope_mode:$scope_narrow" in
    initial:false) [ "$follow_state" = "initial" ] || fail "handoff follow-up state mismatch" ;;
    follow-up:true) [ "$follow_state" = "follow-up-narrow" ] || fail "handoff follow-up state mismatch" ;;
    follow-up:false) [ "$follow_state" = "follow-up-full" ] || fail "handoff follow-up state mismatch" ;;
    *) fail "scope decision follow-up state mismatch" ;;
  esac
  [ "$follow_last" = "$scope_last" ] || fail "handoff last reviewed SHA mismatch"
  [ "$follow_narrow" = "$scope_narrow" ] || fail "handoff follow-up narrow mismatch"
}

validate_findings_authority() {
  local findings_file="$1"
  local play_helper
  validate_direct_child_path "findings" "$findings_file" "-findings.json"
  assert_readable_file "findings file" "$findings_file"
  play_helper="$(resolve_play_review_helper)"
  HEAD_SHA="$HEAD_SHA" \
  FINDINGS_FILE="$findings_file" \
    bash "$play_helper" validate-findings
}

validate_optional_readable_artifact() {
  local label="$1"
  local file="$2"
  [ "$file" = "null" ] && return
  assert_readable_file "$label" "$file"
}

validate_optional_direct_child_readable_artifact() {
  local label="$1"
  local file="$2"
  local suffix="$3"
  [ "$file" = "null" ] && return
  validate_direct_child_path "$label" "$file" "$suffix"
  assert_readable_file "$label file" "$file"
}

validate_digest() {
  local label="$1"
  local file="$2"
  local expected="$3"
  local actual
  actual="$(sha256_file "$file")"
  [ "$actual" = "$expected" ] || fail "$label digest mismatch: $file"
}

validate_optional_digest() {
  local label="$1"
  local file="$2"
  local expected="$3"
  if [ "$file" = "null" ]; then
    [ "$expected" = "null" ] || fail "$label digest mismatch: $file"
    return
  fi
  [ "$expected" != "null" ] || fail "$label digest mismatch: $file"
  validate_digest "$label" "$file" "$expected"
}

validate_result_file() {
  local file="$1"
  local identity_file="${2:-$1}"
  local pr_number repository review_head_sha expected handoff_file findings_file scope_decision_file prior_threads_file
  local review_body_file context_file rendered_preview_file selected_range full_range scope_narrow scope_summary
  local handoff_repository handoff_scope_decision_file handoff_prior_threads_file
  local handoff_digest findings_digest review_body_digest context_digest scope_digest prior_digest preview_digest

  require_repo_root
  validate_pr_number
  validate_head_sha
  validate_direct_child_path "result" "$file"
  assert_readable_file "result file" "$file"
  validate_result_schema "$file"

  pr_number="$(jq_value "$file" '.pr_number')"
  [ "$pr_number" = "$PR_NUMBER" ] ||
    fail "result PR number mismatch: manifest $pr_number, current $PR_NUMBER"
  repository="$(jq_value "$file" '.repository')"
  review_head_sha="$(jq_value "$file" '.review_head_sha')"
  [ "$review_head_sha" = "$HEAD_SHA" ] ||
    fail "review head mismatch: manifest $review_head_sha, current $HEAD_SHA"
  expected="$(expected_result_path_for "$pr_number" "$review_head_sha")"
  [ "$identity_file" = "$expected" ] || fail "result path mismatch: $identity_file"

  handoff_file="$(jq_value "$file" '.artifacts.handoff_file')"
  [ "$handoff_file" = "$(expected_handoff_path_for "$pr_number" "$review_head_sha")" ] ||
    fail "result handoff path mismatch"
  validate_handoff_file "$handoff_file"
  handoff_repository="$(jq_value "$handoff_file" '.repository')"
  [ "$repository" = "$handoff_repository" ] || fail "result repository mismatch"

  findings_file="$(jq_value "$file" '.findings_file')"
  validate_findings_authority "$findings_file"

  review_body_file="$(jq_value "$file" 'if .review_body_file == null then "null" else .review_body_file end')"
  context_file="$(jq_value "$file" 'if .context_file == null then "null" else .context_file end')"
  rendered_preview_file="$(jq_value "$file" 'if .artifacts.rendered_preview_file == null then "null" else .artifacts.rendered_preview_file end')"
  validate_optional_readable_artifact "review body file" "$review_body_file"
  validate_optional_readable_artifact "context file" "$context_file"
  validate_optional_readable_artifact "rendered preview file" "$rendered_preview_file"

  scope_decision_file="$(jq_value "$file" '.artifacts.scope_decision_file')"
  prior_threads_file="$(jq_value "$file" 'if .artifacts.prior_threads_file == null then "null" else .artifacts.prior_threads_file end')"
  handoff_scope_decision_file="$(jq_value "$handoff_file" '.artifacts.scope_decision_file')"
  handoff_prior_threads_file="$(jq_value "$handoff_file" 'if .artifacts.prior_threads_file == null then "null" else .artifacts.prior_threads_file end')"
  [ "$scope_decision_file" = "$handoff_scope_decision_file" ] ||
    fail "result handoff scope decision mismatch"
  [ "$prior_threads_file" = "$handoff_prior_threads_file" ] ||
    fail "result handoff prior threads mismatch"
  validate_scope_authority "$scope_decision_file" "$(guarded_scope_base_ref "$scope_decision_file")" "$prior_threads_file"

  selected_range="$(jq_value "$scope_decision_file" '.selected_range')"
  full_range="$(jq_value "$scope_decision_file" '.full_range')"
  scope_narrow="$(jq_value "$scope_decision_file" '.is_followup_narrow')"
  scope_summary="$(jq_value "$scope_decision_file" '.selection_reason')"
  [ "$(jq_value "$file" '.scope_decision.selected_range')" = "$selected_range" ] ||
    fail "result scope selected range mismatch"
  [ "$(jq_value "$file" '.scope_decision.full_range')" = "$full_range" ] ||
    fail "result scope full range mismatch"
  [ "$(jq_value "$file" '.scope_decision.is_followup_narrow')" = "$scope_narrow" ] ||
    fail "result scope follow-up narrow mismatch"
  [ "$(jq_value "$file" '.scope_decision.summary')" = "$scope_summary" ] ||
    fail "result scope summary mismatch"

  handoff_digest="$(jq_value "$file" '.digests.handoff_sha256')"
  findings_digest="$(jq_value "$file" '.digests.findings_sha256')"
  review_body_digest="$(jq_value "$file" 'if .digests.review_body_sha256 == null then "null" else .digests.review_body_sha256 end')"
  context_digest="$(jq_value "$file" 'if .digests.context_sha256 == null then "null" else .digests.context_sha256 end')"
  scope_digest="$(jq_value "$file" '.digests.scope_decision_sha256')"
  prior_digest="$(jq_value "$file" 'if .digests.prior_threads_sha256 == null then "null" else .digests.prior_threads_sha256 end')"
  preview_digest="$(jq_value "$file" 'if .digests.rendered_preview_sha256 == null then "null" else .digests.rendered_preview_sha256 end')"
  validate_digest "handoff" "$handoff_file" "$handoff_digest"
  validate_digest "findings" "$findings_file" "$findings_digest"
  validate_optional_digest "review body" "$review_body_file" "$review_body_digest"
  validate_optional_digest "context" "$context_file" "$context_digest"
  validate_digest "scope decision" "$scope_decision_file" "$scope_digest"
  validate_optional_digest "prior threads" "$prior_threads_file" "$prior_digest"
  validate_optional_digest "rendered preview" "$rendered_preview_file" "$preview_digest"
}

prepare_handoff_write() {
  local file tmp_file
  require_repo_root
  validate_pr_number
  validate_head_sha
  file="$(expected_handoff_path_for "$PR_NUMBER" "$HEAD_SHA")"
  tmp_file="$(tmp_path_for "$file")"
  validate_direct_child_path "handoff" "$file" "-handoff.json"
  validate_direct_child_path "handoff temp" "$tmp_file" ".tmp"
  prepare_write_target "handoff" "$file"
  prepare_write_target "handoff temp" "$tmp_file"
  printf '%s\n' "$file"
}

prepare_result_write() {
  local file tmp_file
  require_repo_root
  validate_pr_number
  validate_head_sha
  file="$(expected_result_path_for "$PR_NUMBER" "$HEAD_SHA")"
  tmp_file="$(tmp_path_for "$file")"
  validate_direct_child_path "result" "$file" "-result.json"
  validate_direct_child_path "result temp" "$tmp_file" ".tmp"
  prepare_write_target "result" "$file"
  prepare_write_target "result temp" "$tmp_file"
  printf '%s\n' "$file"
}

require_handoff_write_env() {
  require_env REPOSITORY
  require_env EXECUTION_WORKING_DIRECTORY
  require_env BASE_REF
  require_env HEAD_REF
  require_env REVIEW_SCOPE_BASE_REF
  require_env ACTIVE_DIFF_RANGE
  require_env FULL_PR_DIFF_RANGE
  require_env MODE
  require_env LANGUAGE_HINTS_JSON
  require_env FOLLOW_UP_STATE
  require_env IS_FOLLOWUP_NARROW
  require_env SCOPE_DECISION_FILE
}

write_handoff() {
  local file tmp_file prior_json last_reviewed_json execution_working_directory
  require_repo_root
  validate_pr_number
  validate_head_sha
  require_handoff_write_env
  require_jq

  file="$(prepare_handoff_write)"
  tmp_file="$(tmp_path_for "$file")"
  trap 'rm -f "$tmp_file"' EXIT

  prior_json="null"
  if [ -n "${PRIOR_THREADS_FILE:-}" ]; then
    prior_json="$(jq -Rn --arg value "$PRIOR_THREADS_FILE" '$value')"
  fi
  last_reviewed_json="null"
  if [ -n "${LAST_REVIEWED_SHA:-}" ]; then
    validate_sha_value LAST_REVIEWED_SHA "$LAST_REVIEWED_SHA"
    last_reviewed_json="$(jq -Rn --arg value "$LAST_REVIEWED_SHA" '$value')"
  fi
  execution_working_directory="$(normalize_execution_working_directory_for_manifest "$EXECUTION_WORKING_DIRECTORY")"

  validate_scope_authority "$SCOPE_DECISION_FILE" "$REVIEW_SCOPE_BASE_REF" "$(jq -rn --argjson value "$prior_json" '$value // "null"')"

  jq -n \
    --arg schema "pr-review/handoff/v1" \
    --argjson pr_number "$PR_NUMBER" \
    --arg repository "$REPOSITORY" \
    --arg working_directory "$execution_working_directory" \
    --arg base_ref "$BASE_REF" \
    --arg head_ref "$HEAD_REF" \
    --arg review_scope_base_ref "$REVIEW_SCOPE_BASE_REF" \
    --arg active_diff_range "$ACTIVE_DIFF_RANGE" \
    --arg full_pr_diff_range "$FULL_PR_DIFF_RANGE" \
    --arg review_head_sha "$HEAD_SHA" \
    --arg mode "$MODE" \
    --argjson language_hints "$LANGUAGE_HINTS_JSON" \
    --arg state "$FOLLOW_UP_STATE" \
    --argjson last_reviewed_sha "$last_reviewed_json" \
    --argjson is_followup_narrow "$IS_FOLLOWUP_NARROW" \
    --arg scope_decision_file "$SCOPE_DECISION_FILE" \
    --argjson prior_threads_file "$prior_json" \
    '{
      schema: $schema,
      pr_number: $pr_number,
      repository: $repository,
      execution: {
        kind: "review-worktree",
        working_directory: $working_directory
      },
      base_ref: $base_ref,
      head_ref: $head_ref,
      review_scope_base_ref: $review_scope_base_ref,
      active_diff_range: $active_diff_range,
      full_pr_diff_range: $full_pr_diff_range,
      review_head_sha: $review_head_sha,
      mode: $mode,
      language_hints: $language_hints,
      follow_up: {
        state: $state,
        last_reviewed_sha: $last_reviewed_sha,
        is_followup_narrow: $is_followup_narrow
      },
      artifacts: {
        scope_decision_file: $scope_decision_file,
        prior_threads_file: $prior_threads_file
      }
    }' >"$tmp_file"
  validate_handoff_file "$tmp_file" "$file"
  mv -f "$tmp_file" "$file"
  trap - EXIT
  printf '%s\n' "$file"
}

require_result_write_env() {
  require_env REPOSITORY
  require_env FINDINGS_FILE
  require_env SCOPE_DECISION_FILE
  require_env PRESENTATION_STATUS
}

write_result() {
  local file tmp_file handoff_file prior_json review_body_json context_json preview_json notes_json
  local summary selected_range full_range is_followup_narrow
  local handoff_sha findings_sha review_body_sha context_sha scope_sha prior_sha preview_sha
  require_repo_root
  validate_pr_number
  validate_head_sha
  require_result_write_env
  require_jq

  file="$(prepare_result_write)"
  tmp_file="$(tmp_path_for "$file")"
  trap 'rm -f "$tmp_file"' EXIT

  prior_json="null"
  if [ -n "${PRIOR_THREADS_FILE:-}" ]; then
    prior_json="$(jq -Rn --arg value "$PRIOR_THREADS_FILE" '$value')"
  fi
  review_body_json="null"
  if [ -n "${REVIEW_BODY_FILE:-}" ]; then
    review_body_json="$(jq -Rn --arg value "$REVIEW_BODY_FILE" '$value')"
  fi
  context_json="null"
  if [ -n "${CONTEXT_FILE:-}" ]; then
    context_json="$(jq -Rn --arg value "$CONTEXT_FILE" '$value')"
  fi
  preview_json="null"
  if [ -n "${RENDERED_PREVIEW_FILE:-}" ]; then
    preview_json="$(jq -Rn --arg value "$RENDERED_PREVIEW_FILE" '$value')"
  fi
  notes_json="null"
  if [ -n "${PRESENTATION_NOTES:-}" ]; then
    notes_json="$(jq -Rn --arg value "$PRESENTATION_NOTES" '$value')"
  fi

  validate_findings_authority "$FINDINGS_FILE"
  validate_scope_authority "$SCOPE_DECISION_FILE" "$(guarded_scope_base_ref "$SCOPE_DECISION_FILE")" "$(jq -rn --argjson value "$prior_json" '$value // "null"')"
  handoff_file="$(expected_handoff_path_for "$PR_NUMBER" "$HEAD_SHA")"
  validate_handoff_file "$handoff_file"
  validate_optional_direct_child_readable_artifact "review body" "$(jq -rn --argjson value "$review_body_json" '$value // "null"')" "-review-body.md"
  validate_optional_direct_child_readable_artifact "context" "$(jq -rn --argjson value "$context_json" '$value // "null"')" "-context.md"
  validate_optional_direct_child_readable_artifact "rendered preview" "$(jq -rn --argjson value "$preview_json" '$value // "null"')" "-review-preview.md"

  summary="$(jq_value "$SCOPE_DECISION_FILE" '.selection_reason')"
  selected_range="$(jq_value "$SCOPE_DECISION_FILE" '.selected_range')"
  full_range="$(jq_value "$SCOPE_DECISION_FILE" '.full_range')"
  is_followup_narrow="$(jq_value "$SCOPE_DECISION_FILE" '.is_followup_narrow')"
  handoff_sha="$(sha256_file "$handoff_file")"
  findings_sha="$(sha256_file "$FINDINGS_FILE")"
  scope_sha="$(sha256_file "$SCOPE_DECISION_FILE")"
  review_body_sha="null"
  if [ -n "${REVIEW_BODY_FILE:-}" ]; then
    review_body_sha="$(sha256_file "$REVIEW_BODY_FILE")"
  fi
  context_sha="null"
  if [ -n "${CONTEXT_FILE:-}" ]; then
    context_sha="$(sha256_file "$CONTEXT_FILE")"
  fi
  prior_sha="null"
  if [ -n "${PRIOR_THREADS_FILE:-}" ]; then
    prior_sha="$(sha256_file "$PRIOR_THREADS_FILE")"
  fi
  preview_sha="null"
  if [ -n "${RENDERED_PREVIEW_FILE:-}" ]; then
    preview_sha="$(sha256_file "$RENDERED_PREVIEW_FILE")"
  fi

  jq -n \
    --arg schema "pr-review/result/v1" \
    --argjson pr_number "$PR_NUMBER" \
    --arg repository "$REPOSITORY" \
    --arg review_head_sha "$HEAD_SHA" \
    --arg findings_file "$FINDINGS_FILE" \
    --argjson review_body_file "$review_body_json" \
    --argjson context_file "$context_json" \
    --arg handoff_file "$handoff_file" \
    --arg scope_decision_file "$SCOPE_DECISION_FILE" \
    --argjson prior_threads_file "$prior_json" \
    --argjson rendered_preview_file "$preview_json" \
    --arg handoff_sha256 "$handoff_sha" \
    --arg findings_sha256 "$findings_sha" \
    --argjson review_body_sha256 "$(jq -Rn --arg value "$review_body_sha" 'if $value == "null" then null else $value end')" \
    --argjson context_sha256 "$(jq -Rn --arg value "$context_sha" 'if $value == "null" then null else $value end')" \
    --arg scope_decision_sha256 "$scope_sha" \
    --argjson prior_threads_sha256 "$(jq -Rn --arg value "$prior_sha" 'if $value == "null" then null else $value end')" \
    --argjson rendered_preview_sha256 "$(jq -Rn --arg value "$preview_sha" 'if $value == "null" then null else $value end')" \
    --arg summary "$summary" \
    --arg selected_range "$selected_range" \
    --arg full_range "$full_range" \
    --argjson is_followup_narrow "$is_followup_narrow" \
    --arg presentation_status "$PRESENTATION_STATUS" \
    --argjson presentation_notes "$notes_json" \
    '{
      schema: $schema,
      pr_number: $pr_number,
      repository: $repository,
      review_head_sha: $review_head_sha,
      findings_file: $findings_file,
      review_body_file: $review_body_file,
      context_file: $context_file,
      artifacts: {
        handoff_file: $handoff_file,
        scope_decision_file: $scope_decision_file,
        prior_threads_file: $prior_threads_file,
        rendered_preview_file: $rendered_preview_file
      },
      digests: {
        handoff_sha256: $handoff_sha256,
        findings_sha256: $findings_sha256,
        review_body_sha256: $review_body_sha256,
        context_sha256: $context_sha256,
        scope_decision_sha256: $scope_decision_sha256,
        prior_threads_sha256: $prior_threads_sha256,
        rendered_preview_sha256: $rendered_preview_sha256
      },
      scope_decision: {
        summary: $summary,
        selected_range: $selected_range,
        full_range: $full_range,
        is_followup_narrow: $is_followup_narrow
      },
      presentation: {
        status: $presentation_status,
        notes: $presentation_notes
      },
      validation: {
        status: "valid",
        findings_validated: true,
        scope_decision_validated: true
      }
    }' >"$tmp_file"
  validate_result_file "$tmp_file" "$file"
  mv -f "$tmp_file" "$file"
  trap - EXIT
  printf '%s\n' "$file"
}

validate_handoff() {
  require_env HANDOFF_FILE
  validate_handoff_file "$HANDOFF_FILE"
}

validate_result() {
  require_env RESULT_FILE
  validate_result_file "$RESULT_FILE"
}

case "$command_name" in
  prepare-handoff-write)
    prepare_handoff_write
    ;;
  write-handoff)
    write_handoff
    ;;
  validate-handoff)
    validate_handoff
    ;;
  prepare-result-write)
    prepare_result_write
    ;;
  write-result)
    write_result
    ;;
  validate-result)
    validate_result
    ;;
  *)
    fail "usage: review-manifests.sh prepare-handoff-write|write-handoff|validate-handoff|prepare-result-write|write-result|validate-result"
    ;;
esac
