#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-}"
if [ $# -gt 0 ]; then
  shift
fi

SURFACE=""
HEAD_SHA=""
BASE_REF=""
SCOPE_DECISION=""
EXPECTED_SCHEMA=""
PRIOR_CONTEXT_KIND=""
PRIOR_CONTEXT_PATH=""
PROVIDER=""
GOVERNED_PATH_PATTERN=""
CONFIGURED_PATH_PATTERN=""
MAX_NARROW_CHANGED_FILES=""
ALLOW_AMBIGUOUS_FULL="true"
PRIOR_THREADS=""
FINDINGS_FILE=""
REVIEW_BODY_FILE=""
REVIEW_EVENT=""
REVIEW_PAYLOAD_FILE=""

fail() {
  echo "$1" >&2
  exit 1
}

require_jq() {
  command -v jq >/dev/null 2>&1 ||
    fail "jq is required to validate review artifacts"
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
    fail "review-artifacts.sh must run from the repository root"
}

validate_sha_value() {
  local label="$1"
  local value="$2"
  case "$value" in
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
    *) fail "$label must be a 40-character lowercase hex SHA" ;;
  esac
}

validate_direct_child_path() {
  local label="$1"
  local file="$2"

  [ -n "$file" ] || fail "$label is required"
  case "$file" in
    *..*) fail "path traversal: $file" ;;
    .ephemeral/*/*) fail "nested $label path rejected: $file" ;;
    .ephemeral/*) ;;
    *) fail "$label path validation failed: $file" ;;
  esac
  [ -L .ephemeral ] && fail ".ephemeral must be a directory, not a symlink"
  [ ! -L "$file" ] || fail "$label must not be a symlink: $file"
}

validate_suffix() {
  local label="$1"
  local file="$2"
  local suffix="$3"

  case "$file" in
    *"$suffix") ;;
    *) fail "$label path validation failed: $file" ;;
  esac
}

assert_readable_file() {
  local label="$1"
  local file="$2"

  validate_direct_child_path "$label" "$file"
  [ -f "$file" ] || fail "$label missing or not a regular file: $file"
  [ -r "$file" ] || fail "$label missing or unreadable: $file"
}

parse_common_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --surface)
        [ -n "${2:-}" ] || fail "--surface requires a value"
        SURFACE="$2"
        shift 2
        ;;
      --head-sha)
        [ -n "${2:-}" ] || fail "--head-sha requires a value"
        HEAD_SHA="$2"
        shift 2
        ;;
      --base-ref)
        [ -n "${2:-}" ] || fail "--base-ref requires a value"
        BASE_REF="$2"
        shift 2
        ;;
      --scope-decision-file)
        [ -n "${2:-}" ] || fail "--scope-decision-file requires a value"
        SCOPE_DECISION="$2"
        shift 2
        ;;
      --expected-schema)
        [ -n "${2:-}" ] || fail "--expected-schema requires a value"
        EXPECTED_SCHEMA="$2"
        shift 2
        ;;
      --expected-prior-context-kind)
        [ -n "${2:-}" ] || fail "--expected-prior-context-kind requires a value"
        PRIOR_CONTEXT_KIND="$2"
        shift 2
        ;;
      --expected-prior-context-path)
        [ -n "${2:-}" ] || fail "--expected-prior-context-path requires a value"
        PRIOR_CONTEXT_PATH="$2"
        shift 2
        ;;
      --governed-path-pattern)
        [ -n "${2:-}" ] || fail "--governed-path-pattern requires a value"
        GOVERNED_PATH_PATTERN="$2"
        shift 2
        ;;
      --configured-path-pattern)
        [ -n "${2:-}" ] || fail "--configured-path-pattern requires a value"
        CONFIGURED_PATH_PATTERN="$2"
        shift 2
        ;;
      --max-narrow-changed-files)
        [ -n "${2:-}" ] || fail "--max-narrow-changed-files requires a value"
        MAX_NARROW_CHANGED_FILES="$2"
        shift 2
        ;;
      --allow-ambiguous-full-escalation)
        [ -n "${2:-}" ] || fail "--allow-ambiguous-full-escalation requires a value"
        ALLOW_AMBIGUOUS_FULL="$2"
        shift 2
        ;;
      --prior-threads-file)
        [ -n "${2:-}" ] || fail "--prior-threads-file requires a value"
        PRIOR_THREADS="$2"
        shift 2
        ;;
      --provider)
        [ -n "${2:-}" ] || fail "--provider requires a value"
        PROVIDER="$2"
        shift 2
        ;;
      --findings-file)
        [ -n "${2:-}" ] || fail "--findings-file requires a value"
        FINDINGS_FILE="$2"
        shift 2
        ;;
      --review-body-file)
        [ -n "${2:-}" ] || fail "--review-body-file requires a value"
        REVIEW_BODY_FILE="$2"
        shift 2
        ;;
      --review-event)
        [ -n "${2:-}" ] || fail "--review-event requires a value"
        REVIEW_EVENT="$2"
        shift 2
        ;;
      --review-payload-file)
        [ -n "${2:-}" ] || fail "--review-payload-file requires a value"
        REVIEW_PAYLOAD_FILE="$2"
        shift 2
        ;;
      *)
        fail "unknown review-artifacts argument: $1"
        ;;
    esac
  done
}

require_flag() {
  local label="$1"
  local value="$2"
  [ -n "$value" ] || fail "$label is required"
}

validate_current_head() {
  local current_head

  require_flag "--head-sha" "$HEAD_SHA"
  validate_sha_value "--head-sha" "$HEAD_SHA"
  current_head="$(git rev-parse HEAD 2>/dev/null)" ||
    fail "failed to resolve HEAD"
  [ "$current_head" = "$HEAD_SHA" ] ||
    fail "HEAD_SHA does not match current HEAD"
}

changed_files_json() {
  local range="$1"
  git diff --name-only "$range" | LC_ALL=C sort | jq -R -s 'split("\n")[:-1]'
}

language_hints_json_for_files() {
  jq -c '
    [
      .[]
      | select(test("\\.[^./]+$"))
      | sub("^.*\\."; "")
    ]
    | unique
  '
}

language_hints_json() {
  local range="$1"
  changed_files_json "$range" | language_hints_json_for_files
}

json_equal() {
  local expected="$1"
  local actual="$2"
  jq -n -e --argjson expected "$expected" --argjson actual "$actual" \
    '$expected == $actual' >/dev/null
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

validate_scope_shape() {
  jq -e --arg expected_schema "$EXPECTED_SCHEMA" '
    def one_of($values; $value): ($values | index($value)) != null;
    def sha: type == "string" and test("^[0-9a-f]{40}$");
    def repo_path:
      type == "string"
      and length > 0
      and (startswith("/") | not)
      and (split("/") | all(. != "" and . != "." and . != ".."));
    type == "object"
    and .schema == $expected_schema
    and one_of(["pr-review", "branch-review"]; .surface)
    and (.head_sha | sha)
    and (.base_ref | type == "string" and length > 0)
    and (.full_range | type == "string" and length > 0)
    and (.selected_range | type == "string" and length > 0)
    and (.candidate_narrow_range == null or (.candidate_narrow_range | type == "string" and length > 0))
    and (.last_reviewed_sha == null or (.last_reviewed_sha | sha))
    and (.is_followup_narrow | type == "boolean")
    and (.changed_files | type == "array" and all(.[]; repo_path))
    and (.changed_file_count | type == "number" and . == floor and . >= 0)
    and (.language_hints | type == "array" and all(.[]; type == "string"))
    and (.escalation | type == "object")
    and (.escalation.escalate_full | type == "boolean")
    and (.escalation.reasons | type == "array" and all(.[]; type == "string" and length > 0))
    and one_of(["clear", "ambiguous"]; .escalation.semantic_scope)
    and (.prior_context | type == "object")
    and one_of(["github-prior-threads", "branch-findings", "none"]; .prior_context.kind)
    and (.prior_context.path == null or (.prior_context.path | type == "string"))
  ' "$SCOPE_DECISION" >/dev/null || fail "scope decision schema mismatch"
}

require_scope_flags() {
  require_flag "--scope-decision-file" "$SCOPE_DECISION"
  require_flag "--surface" "$SURFACE"
  require_flag "--expected-schema" "$EXPECTED_SCHEMA"
  require_flag "--base-ref" "$BASE_REF"
  require_flag "--expected-prior-context-kind" "$PRIOR_CONTEXT_KIND"
  require_flag "--expected-prior-context-path" "$PRIOR_CONTEXT_PATH"
  require_flag "--governed-path-pattern" "$GOVERNED_PATH_PATTERN"
  require_flag "--max-narrow-changed-files" "$MAX_NARROW_CHANGED_FILES"
  case "$SURFACE" in
    pr-review | branch-review) ;;
    *) fail "--surface must be pr-review or branch-review" ;;
  esac
  case "$EXPECTED_SCHEMA" in
    pr-review/scope-decision/v1 | branch-review/scope-decision/v1) ;;
    *) fail "--expected-schema is invalid" ;;
  esac
  [ "$EXPECTED_SCHEMA" = "${SURFACE}/scope-decision/v1" ] ||
    fail "--expected-schema does not match --surface"
  case "$PRIOR_CONTEXT_KIND" in
    github-prior-threads | branch-findings | none) ;;
    *) fail "--expected-prior-context-kind is invalid" ;;
  esac
  case "$PRIOR_CONTEXT_KIND:$SURFACE" in
    github-prior-threads:pr-review | branch-findings:branch-review | none:*) ;;
    github-prior-threads:*) fail "github-prior-threads prior context is pr-review only" ;;
    branch-findings:*) fail "branch-findings prior context is branch-review only" ;;
  esac
  if [ "$PRIOR_CONTEXT_KIND" = "none" ] && [ "$PRIOR_CONTEXT_PATH" != "null" ]; then
    fail "none prior context requires null path"
  fi
  if [ "$PRIOR_CONTEXT_PATH" != "null" ]; then
    case "$PRIOR_CONTEXT_PATH" in
      '' | /* | *..* | */./* | ./* | */../* | *//*) fail "--expected-prior-context-path must be repo-relative or null" ;;
    esac
  fi
  case "$MAX_NARROW_CHANGED_FILES" in
    '' | *[!0-9]*) fail "--max-narrow-changed-files must be an integer" ;;
  esac
  case "$ALLOW_AMBIGUOUS_FULL" in
    true | false) ;;
    *) fail "--allow-ambiguous-full-escalation must be true or false" ;;
  esac
}

range_exists() {
  git diff --quiet "$1" >/dev/null 2>&1 || [ "$?" -eq 1 ]
}

reason_present() {
  local reason="$1"
  jq -e --arg reason "$reason" '.escalation.reasons | index($reason) != null' "$SCOPE_DECISION" >/dev/null
}

reason_count() {
  jq -r '.escalation.reasons | length' "$SCOPE_DECISION"
}

reject_unknown_escalation_reasons() {
  jq -e '
    .escalation.reasons | all(.[]; . as $reason | [
      "not-followup",
      "file-count",
      "governed-path",
      "configured-path",
      "ambiguous-semantic-scope",
      "semantic-scope",
      "unusable-follow-up-sha"
    ] | index($reason) != null)
  ' "$SCOPE_DECISION" >/dev/null || fail "unknown escalation reason"
}

validate_pattern() {
  local label="$1"
  local pattern="$2"

  [ -z "$pattern" ] && return
  set +e
  grep -E -- "$pattern" /dev/null >/dev/null 2>&1
  local status=$?
  set -e
  [ "$status" -le 1 ] || fail "$label must be a valid extended regular expression"
}

validate_scope_decision() {
  require_jq
  require_repo_root
  require_scope_flags
  validate_current_head
  validate_pattern "--governed-path-pattern" "$GOVERNED_PATH_PATTERN"
  validate_pattern "--configured-path-pattern" "$CONFIGURED_PATH_PATTERN"
  assert_readable_file "--scope-decision-file" "$SCOPE_DECISION"
  validate_suffix "--scope-decision-file" "$SCOPE_DECISION" "-scope-decision.json"
  validate_scope_shape

  local artifact_surface artifact_head artifact_base full_range selected_range candidate_range last_reviewed
  local is_narrow escalate_full semantic_scope changed_count expected_full_range
  local expected_files actual_files expected_hints actual_hints
  local expected_count actual_count expected_selected_range
  local followup_usable=false

  artifact_surface="$(jq_value "$SCOPE_DECISION" '.surface')"
  [ "$artifact_surface" = "$SURFACE" ] ||
    fail "scope decision surface mismatch"
  artifact_head="$(jq_value "$SCOPE_DECISION" '.head_sha')"
  [ "$artifact_head" = "$HEAD_SHA" ] ||
    fail "scope decision head mismatch"
  artifact_base="$(jq_value "$SCOPE_DECISION" '.base_ref')"
  [ "$artifact_base" = "$BASE_REF" ] ||
    fail "scope decision base_ref mismatch"
  git cat-file -e "$BASE_REF^{commit}" 2>/dev/null ||
    fail "base ref does not resolve"

  full_range="$(jq_value "$SCOPE_DECISION" '.full_range')"
  selected_range="$(jq_value "$SCOPE_DECISION" '.selected_range')"
  candidate_range="$(jq_value "$SCOPE_DECISION" '.candidate_narrow_range // ""')"
  last_reviewed="$(jq_value "$SCOPE_DECISION" '.last_reviewed_sha // ""')"
  is_narrow="$(jq_value "$SCOPE_DECISION" '.is_followup_narrow')"
  escalate_full="$(jq_value "$SCOPE_DECISION" '.escalation.escalate_full')"
  semantic_scope="$(jq_value "$SCOPE_DECISION" '.escalation.semantic_scope')"
  changed_count="$(jq_value "$SCOPE_DECISION" '.changed_file_count')"
  expected_full_range="$BASE_REF...HEAD"

  reject_unknown_escalation_reasons
  [ "$full_range" = "$expected_full_range" ] ||
    fail "full range does not match caller base ref"

  range_exists "$full_range" || fail "review range does not resolve"

  if [ -n "$last_reviewed" ] &&
    git cat-file -e "$last_reviewed^{commit}" 2>/dev/null &&
    git merge-base --is-ancestor "$last_reviewed" HEAD 2>/dev/null; then
    followup_usable=true
  fi

  if [ "$is_narrow" = "true" ]; then
    [ -n "$last_reviewed" ] || fail "narrow scope requires last_reviewed_sha"
    [ "$followup_usable" = "true" ] || fail "narrow scope requires usable follow-up sha"
    expected_selected_range="$last_reviewed..HEAD"
    [ "$selected_range" = "$expected_selected_range" ] ||
      fail "narrow scope must use last-reviewed-sha..HEAD"
    [ "$candidate_range" = "$expected_selected_range" ] ||
      fail "narrow scope must use last-reviewed-sha..HEAD"
    [ "$escalate_full" = "false" ] ||
      fail "narrow scope cannot claim full escalation"
  else
    [ "$selected_range" = "$full_range" ] ||
      fail "full escalation selected_range must equal full_range"
    if [ -z "$last_reviewed" ]; then
      [ "$escalate_full" = "true" ] ||
        fail "full baseline requires explicit escalation"
      reason_present "not-followup" ||
        fail "not-followup escalation reason missing"
      [ "$(reason_count)" -eq 1 ] ||
        fail "not-followup escalation reason missing"
    else
      [ "$escalate_full" = "true" ] ||
        fail "full follow-up requires explicit escalation"
      [ "$(reason_count)" -gt 0 ] ||
        fail "full follow-up requires escalation reason"
    fi
  fi

  range_exists "$selected_range" || fail "review range does not resolve"

  if [ "$semantic_scope" = "ambiguous" ] && [ "$escalate_full" != "true" ]; then
    fail "ambiguous semantic scope requires full review"
  fi
  if [ "$semantic_scope" = "ambiguous" ] && [ "$ALLOW_AMBIGUOUS_FULL" != "true" ]; then
    fail "ambiguous semantic scope requires full review"
  fi
  if [ "$semantic_scope" = "ambiguous" ] && [ "$escalate_full" = "true" ]; then
    reason_present "ambiguous-semantic-scope" ||
      fail "ambiguous-semantic-scope escalation reason missing"
  fi

  expected_files="$(changed_files_json "$selected_range")"
  actual_files="$(jq_json "$SCOPE_DECISION" '.changed_files | sort')"
  json_equal "$expected_files" "$actual_files" ||
    fail "changed files do not match selected range"
  expected_count="$(printf '%s\n' "$expected_files" | jq 'length')"
  actual_count="$changed_count"
  [ "$expected_count" = "$actual_count" ] ||
    fail "changed file count does not match selected range"
  expected_hints="$(printf '%s\n' "$expected_files" | language_hints_json_for_files)"
  actual_hints="$(jq_json "$SCOPE_DECISION" '.language_hints | sort | unique')"
  json_equal "$expected_hints" "$actual_hints" ||
    fail "language hints do not match selected range"

  if [ -n "$last_reviewed" ]; then
    local has_real_followup_trigger=false
    if [ "$followup_usable" != "true" ]; then
      [ "$is_narrow" != "true" ] || fail "narrow scope requires usable follow-up sha"
      reason_present "unusable-follow-up-sha" ||
        fail "unusable-follow-up-sha escalation reason missing"
      reason_present "file-count" && fail "file-count escalation reason missing"
      reason_present "governed-path" && fail "governed-path escalation reason missing"
      reason_present "configured-path" && fail "configured-path escalation reason missing"
      has_real_followup_trigger=true
    fi
    local candidate_count
    local candidate_files
    local expected_candidate_range="$last_reviewed..HEAD"
    if [ -n "$candidate_range" ] && [ "$candidate_range" != "$expected_candidate_range" ]; then
      fail "narrow scope must use last-reviewed-sha..HEAD"
    fi
    if [ "$followup_usable" = "true" ]; then
      candidate_files="$(changed_files_json "$expected_candidate_range")"
      candidate_count="$(printf '%s\n' "$candidate_files" | jq 'length')"
      if [ "$candidate_count" -gt "$MAX_NARROW_CHANGED_FILES" ]; then
        [ "$is_narrow" != "true" ] || fail "file count requires full review"
        reason_present "file-count" ||
          fail "file-count escalation reason missing"
        has_real_followup_trigger=true
      elif reason_present "file-count"; then
        fail "file-count escalation reason missing"
      fi
      if printf '%s\n' "$candidate_files" | jq -r '.[]' | grep -E -- "$GOVERNED_PATH_PATTERN" >/dev/null; then
        [ "$is_narrow" != "true" ] || fail "governed path requires full review"
        reason_present "governed-path" ||
          fail "governed-path escalation reason missing"
        has_real_followup_trigger=true
      elif reason_present "governed-path"; then
        fail "governed-path escalation reason missing"
      fi
      if [ -n "$CONFIGURED_PATH_PATTERN" ] &&
        printf '%s\n' "$candidate_files" | jq -r '.[]' | grep -E -- "$CONFIGURED_PATH_PATTERN" >/dev/null; then
        [ "$is_narrow" != "true" ] || fail "configured path requires full review"
        reason_present "configured-path" ||
          fail "configured-path escalation reason missing"
        has_real_followup_trigger=true
      elif reason_present "configured-path"; then
        fail "configured-path escalation reason missing"
      fi
      if reason_present "unusable-follow-up-sha"; then
        fail "unusable-follow-up-sha escalation reason missing"
      fi
    fi
    if [ "$semantic_scope" = "ambiguous" ]; then
      has_real_followup_trigger=true
    elif reason_present "semantic-scope"; then
      has_real_followup_trigger=true
    elif reason_present "ambiguous-semantic-scope"; then
      fail "ambiguous-semantic-scope escalation reason missing"
    fi
    if reason_present "not-followup"; then
      fail "not-followup escalation reason missing"
    fi
    if [ "$is_narrow" != "true" ] && [ "$has_real_followup_trigger" != "true" ]; then
      fail "full follow-up requires justified escalation"
    fi
  fi

  local artifact_prior_kind artifact_prior_path
  artifact_prior_kind="$(jq_value "$SCOPE_DECISION" '.prior_context.kind')"
  artifact_prior_path="$(jq_value "$SCOPE_DECISION" 'if .prior_context.path == null then "null" else .prior_context.path end')"
  case "$artifact_prior_kind:$SURFACE" in
    github-prior-threads:pr-review | branch-findings:branch-review | none:*) ;;
    github-prior-threads:*) fail "github-prior-threads prior context is pr-review only" ;;
    branch-findings:*) fail "branch-findings prior context is branch-review only" ;;
  esac
  if [ "$artifact_prior_kind" = "none" ] && [ "$artifact_prior_path" != "null" ]; then
    fail "none prior context requires null path"
  fi
  [ "$artifact_prior_kind" = "$PRIOR_CONTEXT_KIND" ] ||
    fail "prior context kind mismatch"
  [ "$artifact_prior_path" = "$PRIOR_CONTEXT_PATH" ] ||
    fail "prior context path mismatch"
}

validate_prior_threads() {
  require_jq
  require_repo_root
  require_flag "--surface" "$SURFACE"
  require_flag "--prior-threads-file" "$PRIOR_THREADS"
  require_flag "--expected-schema" "$EXPECTED_SCHEMA"
  require_flag "--provider" "$PROVIDER"
  [ "$SURFACE" = "pr-review" ] || fail "validate-prior-threads requires --surface pr-review"
  [ "$EXPECTED_SCHEMA" = "pr-review/prior-threads/v1" ] ||
    fail "--expected-schema must be pr-review/prior-threads/v1"
  [ "$PROVIDER" = "github" ] || fail "--provider must be github"
  validate_current_head
  assert_readable_file "--prior-threads-file" "$PRIOR_THREADS"
  validate_suffix "--prior-threads-file" "$PRIOR_THREADS" "-prior-threads.json"

  jq -e --arg head "$HEAD_SHA" --arg expected_schema "$EXPECTED_SCHEMA" '
    def repo_path:
      type == "string"
      and length > 0
      and (startswith("/") | not)
      and (split("/") | all(. != "" and . != "." and . != ".."));
    type == "object"
    and .schema == $expected_schema
    and .head_sha == $head
    and (.threads | type == "array")
    and (.threads | all(.[];
      (.id | type == "string" and length > 0)
      and (.path | repo_path)
      and (.line | type == "number" and . == floor and . >= 1)
      and (.start_line == null or (.start_line | type == "number" and . == floor and . >= 1))
      and (.side == "RIGHT")
    ))
  ' "$PRIOR_THREADS" >/dev/null || fail "prior-thread shape validation failed"

  jq -e '
    def valid_timestamp:
      type == "string"
      and (capture("^(?<year>[0-9]{4})-(?<month>[0-9]{2})-(?<day>[0-9]{2})T(?<hour>[0-9]{2}):(?<minute>[0-9]{2}):(?<second>[0-9]{2})Z$")? // null) as $parts
      | $parts != null
        and ($parts.year | tonumber) as $year
        | ($parts.month | tonumber) as $month
        | ($parts.day | tonumber) as $day
        | ($parts.hour | tonumber) as $hour
        | ($parts.minute | tonumber) as $minute
        | ($parts.second | tonumber) as $second
        | def leap($year): (($year % 400 == 0) or (($year % 4 == 0) and ($year % 100 != 0)));
        def days_in_month($year; $month):
          if $month == 2 then (if leap($year) then 29 else 28 end)
          elif [4, 6, 9, 11] | index($month) then 30
          else 31
          end;
        $month >= 1 and $month <= 12
        and $day >= 1 and $day <= days_in_month($year; $month)
        and $hour >= 0 and $hour <= 23
        and $minute >= 0 and $minute <= 59
        and $second >= 0 and $second <= 59;
    .threads | all(.[]; (.created_at | valid_timestamp) and (.updated_at | valid_timestamp))
  ' "$PRIOR_THREADS" >/dev/null || fail "prior-thread timestamp validation failed"

  jq -e '.threads | all(.[]; .model_context_eligible | type == "boolean")' "$PRIOR_THREADS" >/dev/null ||
    fail "prior-thread model-context eligibility validation failed"

  jq -e '
    def valid_timestamp:
      type == "string"
      and (capture("^(?<year>[0-9]{4})-(?<month>[0-9]{2})-(?<day>[0-9]{2})T(?<hour>[0-9]{2}):(?<minute>[0-9]{2}):(?<second>[0-9]{2})Z$")? // null) as $parts
      | $parts != null
        and ($parts.year | tonumber) as $year
        | ($parts.month | tonumber) as $month
        | ($parts.day | tonumber) as $day
        | ($parts.hour | tonumber) as $hour
        | ($parts.minute | tonumber) as $minute
        | ($parts.second | tonumber) as $second
        | def leap($year): (($year % 400 == 0) or (($year % 4 == 0) and ($year % 100 != 0)));
        def days_in_month($year; $month):
          if $month == 2 then (if leap($year) then 29 else 28 end)
          elif [4, 6, 9, 11] | index($month) then 30
          else 31
          end;
        $month >= 1 and $month <= 12
        and $day >= 1 and $day <= days_in_month($year; $month)
        and $hour >= 0 and $hour <= 23
        and $minute >= 0 and $minute <= 59
        and $second >= 0 and $second <= 59;
    .threads | all(.[]; .dropped == null or
      ((.dropped | type == "object")
      and (.dropped.reason | type == "string" and length > 0)
      and (.dropped.at | valid_timestamp)))
  ' "$PRIOR_THREADS" >/dev/null || fail "dropped-thread shape validation failed"

  jq -e '.threads | all(.[]; .start_line == null or .start_line <= .line)' "$PRIOR_THREADS" >/dev/null ||
    fail "prior-thread line range is inverted"
}

line_in_diff() {
  local range="$1"
  local file="$2"
  local line="$3"

  git diff --unified=0 "$range" -- "$file" |
    awk -v target="$line" '
      /^\+\+\+ / { next }
      /^@@ / {
        if (match($0, /\+[0-9]+(,[0-9]+)?/)) {
          spec = substr($0, RSTART + 1, RLENGTH - 1)
          split(spec, parts, ",")
          start = parts[1] + 0
          count = (parts[2] == "" ? 1 : parts[2] + 0)
          if (count == 0) {
            next
          }
          end = start + count - 1
          if (target >= start && target <= end) {
            found = 1
          }
        }
      }
      END { exit(found ? 0 : 1) }
    '
}

validate_diff_anchors() {
  require_jq
  validate_scope_decision
  require_flag "--findings-file" "$FINDINGS_FILE"
  [ "$SURFACE" = "pr-review" ] || fail "validate-diff-anchors requires --surface pr-review"
  assert_readable_file "--findings-file" "$FINDINGS_FILE"
  validate_suffix "--findings-file" "$FINDINGS_FILE" "-findings.json"
  assert_findings_envelope "$FINDINGS_FILE"
  local selected_range
  selected_range="$(jq_value "$SCOPE_DECISION" '.selected_range')"

  while IFS=$'\t' read -r file line start_line; do
    [ -n "$file" ] || continue
    line_in_diff "$selected_range" "$file" "$line" ||
      fail "inline anchor is outside selected review diff"
    if [ -n "$start_line" ] && [ "$start_line" != "null" ]; then
      [ "$start_line" -le "$line" ] || fail "diff anchor line range is inverted"
      line_in_diff "$selected_range" "$file" "$start_line" ||
        fail "inline anchor is outside selected review diff"
    fi
  done < <(
    jq -r '
      (.findings + .carry_forward)[]
      | select(.anchor == "natural" or .anchor == "missing-file")
      | [.path, .line, (.start_line // "null")]
      | @tsv
    ' "$FINDINGS_FILE"
  )
}

assert_findings_envelope() {
  local file="$1"

  jq -e '
    def one_of($values; $value): ($values | index($value)) != null;
    def positive_integer: type == "number" and . == floor and . >= 1;
    def repo_path:
      type == "string"
      and length > 0
      and (startswith("/") | not)
      and (split("/") | all(. != "" and . != "." and . != ".."));
    def finding:
      type == "object"
      and (.path | repo_path)
      and (.line | positive_integer)
      and has("start_line")
      and (.start_line == null or (.start_line | positive_integer))
      and one_of(["Blocking", "Nit"]; .severity)
      and one_of(["Logic", "Safety", "Architecture", "Tests", "Maintainability", "Documentation", "Contracts"]; .category)
      and has("critic")
      and (
        if .severity == "Nit" then .critic == null
        else .critic == null or one_of(["VALID", "INVALID", "DOWNGRADE"]; .critic)
        end
      )
      and one_of(["natural", "missing-file", "out-of-diff"]; .anchor)
      and (.why | type == "string" and length > 0)
      and (.recommendation | type == "string" and length > 0)
      and (.body | type == "string" and length > 0)
      and (.start_line == null or .start_line <= .line);
    type == "object"
    and .schema == "play-review/findings/v1"
    and (.findings | type == "array")
    and (.carry_forward | type == "array")
    and ((.findings + .carry_forward) | all(.[]; finding))
  ' "$file" >/dev/null || fail "findings envelope validation failed"
}

compare_approved_payload() {
  require_jq
  validate_scope_decision
  [ "$SURFACE" = "pr-review" ] || fail "compare-approved-payload requires --surface pr-review"
  require_flag "--findings-file" "$FINDINGS_FILE"
  require_flag "--review-body-file" "$REVIEW_BODY_FILE"
  require_flag "--review-payload-file" "$REVIEW_PAYLOAD_FILE"
  require_flag "--review-event" "$REVIEW_EVENT"
  case "$REVIEW_EVENT" in
    APPROVE | REQUEST_CHANGES | COMMENT) ;;
    *) fail "--review-event must be APPROVE, REQUEST_CHANGES, or COMMENT" ;;
  esac
  assert_readable_file "--findings-file" "$FINDINGS_FILE"
  assert_readable_file "--review-body-file" "$REVIEW_BODY_FILE"
  assert_readable_file "--review-payload-file" "$REVIEW_PAYLOAD_FILE"
  validate_suffix "--findings-file" "$FINDINGS_FILE" "-findings.json"
  validate_suffix "--review-payload-file" "$REVIEW_PAYLOAD_FILE" "-review-payload.json"
  assert_findings_envelope "$FINDINGS_FILE"
  jq -s -e 'length == 1 and (.[0] | type == "object")' "$REVIEW_PAYLOAD_FILE" >/dev/null ||
    fail "review payload JSON validation failed"

  local review_body out_of_diff expected_file
  review_body="$(cat "$REVIEW_BODY_FILE")"
  out_of_diff="$(jq -r '
    (.findings + .carry_forward)
    | map(select(.anchor == "out-of-diff") | .body)
    | if length == 0 then empty
      else "## Out-of-diff Findings\n\n" + join("\n\n")
      end
  ' "$FINDINGS_FILE")"
  if [ -n "$review_body" ] && [ -n "$out_of_diff" ]; then
    review_body="$(printf '%s\n\n%s\n' "$review_body" "$out_of_diff")"
  elif [ -n "$out_of_diff" ]; then
    review_body="$(printf '%s\n' "$out_of_diff")"
  fi
  expected_file="$(mktemp ".ephemeral/.expected-approved-payload.XXXXXX")"
  jq -n \
    --arg commit_id "$HEAD_SHA" \
    --arg event "$REVIEW_EVENT" \
    --arg body "$review_body" \
    --slurpfile findings "$FINDINGS_FILE" '
      {
        commit_id: $commit_id,
        event: $event,
        body: $body,
        comments: [
          ($findings[0].findings + $findings[0].carry_forward)[]
          | select(.anchor == "natural" or .anchor == "missing-file")
          | . as $finding
          | {
              path: .path,
              line: .line,
              side: "RIGHT",
              body: (if .anchor == "missing-file" then
                "Missing-file finding (no natural anchor — see body):\n\n" + .body
              else
                .body
              end)
            }
          | if $finding.start_line == null then . else . + {start_line: $finding.start_line, start_side: "RIGHT"} end
        ]
      }
    ' >"$expected_file"

  if ! jq -n -e --slurpfile expected "$expected_file" --slurpfile actual "$REVIEW_PAYLOAD_FILE" \
    '$expected[0] == $actual[0]' >/dev/null; then
    rm -f "$expected_file"
    fail "approved review payload does not match generated payload"
  fi
  cat "$expected_file"
  rm -f "$expected_file"
}

parse_common_args "$@"

case "$command_name" in
  validate-scope-decision)
    validate_scope_decision
    ;;
  validate-prior-threads)
    validate_prior_threads
    ;;
  validate-diff-anchors)
    validate_diff_anchors
    ;;
  compare-approved-payload)
    compare_approved_payload
    ;;
  *)
    fail "usage: review-artifacts.sh validate-scope-decision|validate-prior-threads|validate-diff-anchors|compare-approved-payload"
    ;;
esac
