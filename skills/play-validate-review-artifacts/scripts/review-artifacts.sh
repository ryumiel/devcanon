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
ALLOW_AMBIGUOUS_FULL="false"
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
      | select(test("\\.[A-Za-z0-9_+-]+$"))
      | sub("^.*\\."; "")
      | ascii_downcase
    ]
    | sort
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

assert_single_json_object() {
  local label="$1"
  local file="$2"
  jq -s -e 'length == 1 and (.[0] | type == "object")' "$file" >/dev/null ||
    fail "$label JSON validation failed"
}

validate_scope_shape() {
  assert_single_json_object "scope decision" "$SCOPE_DECISION"
  jq -e --arg expected_schema "$EXPECTED_SCHEMA" '
    def one_of($values; $value): ($values | index($value)) != null;
    def sha: type == "string" and test("^[0-9a-f]{40}$");
    def repo_path:
      type == "string"
      and length > 0
      and (startswith("/") | not)
      and (split("/") | all(. != "" and . != "." and . != ".."));
    def direct_ephemeral_path:
      type == "string"
      and test("^\\.ephemeral/[^/]+$")
      and (contains("..") | not);
    type == "object"
    and (keys_unsorted | sort) == ([
      "schema",
      "surface",
      "mode",
      "selected_range",
      "full_range",
      "candidate_narrow_range",
      "is_followup_narrow",
      "selection_reason",
      "escalation_reasons",
      "last_reviewed_sha",
      "head_sha",
      "changed_files",
      "language_hints",
      "prior_context",
      "mechanical_facts",
      "semantic_decision"
    ] | sort)
    and .schema == $expected_schema
    and one_of(["pr-review", "branch-review"]; .surface)
    and one_of(["initial", "follow-up"]; .mode)
    and (.head_sha | sha)
    and (.full_range | type == "string" and length > 0)
    and (.selected_range | type == "string" and length > 0)
    and (.candidate_narrow_range | type == "string" and length > 0)
    and (.last_reviewed_sha == null or (.last_reviewed_sha | sha))
    and (.is_followup_narrow | type == "boolean")
    and (.selection_reason | type == "string" and length > 0)
    and (.changed_files | type == "array" and all(.[]; repo_path))
    and (.language_hints | type == "array" and all(.[]; type == "string"))
    and (.escalation_reasons | type == "array" and all(.[]; type == "string" and length > 0))
    and (.prior_context | type == "object")
    and one_of(["github-prior-threads", "branch-findings", "none"]; .prior_context.kind)
    and (.prior_context.path == null or (.prior_context.path | type == "string"))
    and (if .prior_context.kind == "none" then true else (.prior_context.path | direct_ephemeral_path) end)
    and (.mechanical_facts | type == "object")
    and ((.mechanical_facts | keys_unsorted | sort) == ([
      "changed_file_count",
      "followup_sha_usable",
      "mechanical_escalate_full",
      "mechanical_escalation_reason"
    ] | sort))
    and (.mechanical_facts.changed_file_count | type == "number" and . == floor and . >= 0)
    and (.mechanical_facts.followup_sha_usable | type == "boolean")
    and (.mechanical_facts.mechanical_escalate_full | type == "boolean")
    and (.mechanical_facts.mechanical_escalation_reason | type == "string")
    and (.semantic_decision | type == "object")
    and ((.semantic_decision | keys_unsorted | sort) == (["checked", "ambiguous", "notes"] | sort))
    and (.semantic_decision.checked | type == "boolean")
    and (.semantic_decision.ambiguous | type == "boolean")
    and (.semantic_decision.notes | type == "string")
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
  jq -e --arg reason "$reason" '.escalation_reasons | index($reason) != null' "$SCOPE_DECISION" >/dev/null
}

reason_count() {
  jq -r '.escalation_reasons | length' "$SCOPE_DECISION"
}

reject_unknown_escalation_reasons() {
  jq -e '
    .escalation_reasons | all(.[]; . as $reason | [
      "not-followup",
      "file-count",
      "governance-path",
      "configured-path",
      "last-reviewed-unusable",
      "public-api",
      "logic-restructure",
      "reviewer-routing-policy",
      "output-schema",
      "install-sync",
      "path-validation-guard",
      "external-invocation-guard",
      "generated-output-renderer",
      "generated-output-contract",
      "source-owned-contract",
      "safety-boundary",
      "broad-scope",
      "architecture-surface",
      "shared-workflow-policy",
      "ambiguous-classification"
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

  local artifact_surface artifact_head mode full_range selected_range candidate_range last_reviewed
  local is_narrow mechanical_escalate semantic_checked semantic_ambiguous changed_count expected_full_range
  local artifact_followup_usable artifact_mechanical_reason
  local expected_files actual_files expected_hints actual_hints
  local expected_count actual_count expected_selected_range count_range_label
  local followup_usable=false

  artifact_surface="$(jq_value "$SCOPE_DECISION" '.surface')"
  [ "$artifact_surface" = "$SURFACE" ] ||
    fail "scope decision surface mismatch"
  artifact_head="$(jq_value "$SCOPE_DECISION" '.head_sha')"
  [ "$artifact_head" = "$HEAD_SHA" ] ||
    fail "scope decision head mismatch"
  git cat-file -e "$BASE_REF^{commit}" 2>/dev/null ||
    fail "base ref does not resolve"

  mode="$(jq_value "$SCOPE_DECISION" '.mode')"
  full_range="$(jq_value "$SCOPE_DECISION" '.full_range')"
  selected_range="$(jq_value "$SCOPE_DECISION" '.selected_range')"
  candidate_range="$(jq_value "$SCOPE_DECISION" '.candidate_narrow_range // ""')"
  last_reviewed="$(jq_value "$SCOPE_DECISION" '.last_reviewed_sha // ""')"
  is_narrow="$(jq_value "$SCOPE_DECISION" '.is_followup_narrow')"
  mechanical_escalate="$(jq_value "$SCOPE_DECISION" '.mechanical_facts.mechanical_escalate_full')"
  artifact_followup_usable="$(jq_value "$SCOPE_DECISION" '.mechanical_facts.followup_sha_usable')"
  artifact_mechanical_reason="$(jq_value "$SCOPE_DECISION" '.mechanical_facts.mechanical_escalation_reason')"
  semantic_checked="$(jq_value "$SCOPE_DECISION" '.semantic_decision.checked')"
  semantic_ambiguous="$(jq_value "$SCOPE_DECISION" '.semantic_decision.ambiguous')"
  changed_count="$(jq_value "$SCOPE_DECISION" '.mechanical_facts.changed_file_count')"
  expected_full_range="$BASE_REF...HEAD"

  reject_unknown_escalation_reasons
  [ "$semantic_checked" = "true" ] || fail "semantic decision must be checked"
  [ "$full_range" = "$expected_full_range" ] ||
    fail "full range does not match caller base ref"

  range_exists "$full_range" || fail "review range does not resolve"

  if [ -n "$last_reviewed" ] &&
    git cat-file -e "$last_reviewed^{commit}" 2>/dev/null &&
    git merge-base --is-ancestor "$last_reviewed" HEAD 2>/dev/null; then
    followup_usable=true
  fi
  [ "$artifact_followup_usable" = "$followup_usable" ] ||
    fail "follow-up usability does not match git"

  if [ "$is_narrow" = "true" ]; then
    [ "$mode" = "follow-up" ] || fail "narrow scope requires follow-up mode"
    [ -n "$last_reviewed" ] || fail "narrow scope requires last_reviewed_sha"
    [ "$followup_usable" = "true" ] || fail "narrow scope requires usable follow-up sha"
    expected_selected_range="$last_reviewed..HEAD"
    [ "$selected_range" = "$expected_selected_range" ] ||
      fail "narrow scope must use last-reviewed-sha..HEAD"
    [ "$candidate_range" = "$expected_selected_range" ] ||
      fail "narrow scope must use last-reviewed-sha..HEAD"
    [ "$mechanical_escalate" = "false" ] ||
      fail "narrow scope cannot claim full escalation"
  else
    [ "$selected_range" = "$full_range" ] ||
      fail "full escalation selected_range must equal full_range"
    if [ -z "$last_reviewed" ]; then
      [ "$mode" = "initial" ] || fail "full baseline requires initial mode"
      reason_present "not-followup" ||
        fail "not-followup escalation reason missing"
      [ "$(reason_count)" -eq 1 ] ||
        fail "not-followup escalation reason missing"
    else
      [ "$mode" = "follow-up" ] || fail "full follow-up requires follow-up mode"
      [ "$(reason_count)" -gt 0 ] ||
        fail "full follow-up requires escalation reason"
    fi
  fi

  range_exists "$selected_range" || fail "review range does not resolve"

  if [ "$semantic_ambiguous" = "true" ] && [ "$is_narrow" = "true" ]; then
    fail "ambiguous semantic scope requires full review"
  fi
  if [ "$semantic_ambiguous" = "true" ]; then
    [ "$ALLOW_AMBIGUOUS_FULL" = "true" ] ||
      fail "ambiguous semantic scope requires explicit allowance"
    reason_present "ambiguous-classification" ||
      fail "ambiguous-classification escalation reason missing"
  fi

  expected_files="$(changed_files_json "$selected_range")"
  actual_files="$(jq_json "$SCOPE_DECISION" '.changed_files | sort')"
  json_equal "$expected_files" "$actual_files" ||
    fail "changed files do not match selected range"
  expected_count="$(printf '%s\n' "$expected_files" | jq 'length')"
  count_range_label="selected range"
  if [ -n "$last_reviewed" ] && [ "$followup_usable" = "true" ]; then
    expected_count="$(changed_files_json "$last_reviewed..HEAD" | jq 'length')"
    count_range_label="candidate range"
  fi
  actual_count="$changed_count"
  [ "$expected_count" = "$actual_count" ] ||
    fail "changed file count does not match $count_range_label"
  expected_hints="$(printf '%s\n' "$expected_files" | language_hints_json_for_files)"
  actual_hints="$(jq_json "$SCOPE_DECISION" '.language_hints | sort | unique')"
  json_equal "$expected_hints" "$actual_hints" ||
    fail "language hints do not match selected range"

  if [ -n "$last_reviewed" ]; then
    local has_real_followup_trigger=false
    local derived_mechanical_escalate=false
    local derived_mechanical_reason=""
    if [ "$followup_usable" != "true" ]; then
      [ "$is_narrow" != "true" ] || fail "narrow scope requires usable follow-up sha"
      [ "$candidate_range" = "$full_range" ] ||
        fail "unusable follow-up scope must use full range"
      reason_present "last-reviewed-unusable" ||
        fail "last-reviewed-unusable escalation reason missing"
      reason_present "file-count" && fail "file-count escalation reason missing"
      reason_present "governance-path" && fail "governance-path escalation reason missing"
      reason_present "configured-path" && fail "configured-path escalation reason missing"
      has_real_followup_trigger=true
      derived_mechanical_escalate=true
      derived_mechanical_reason="last-reviewed-unusable"
    fi
    local candidate_count
    local candidate_files
    local expected_candidate_range="$last_reviewed..HEAD"
    if [ "$followup_usable" = "true" ]; then
      if [ -n "$candidate_range" ] && [ "$candidate_range" != "$expected_candidate_range" ]; then
        fail "narrow scope must use last-reviewed-sha..HEAD"
      fi
      candidate_files="$(changed_files_json "$expected_candidate_range")"
      candidate_count="$(printf '%s\n' "$candidate_files" | jq 'length')"
      if [ "$candidate_count" -gt "$MAX_NARROW_CHANGED_FILES" ]; then
        [ "$is_narrow" != "true" ] || fail "file count requires full review"
        reason_present "file-count" ||
          fail "file-count escalation reason missing"
        has_real_followup_trigger=true
        derived_mechanical_escalate=true
        derived_mechanical_reason="file-count"
      elif reason_present "file-count"; then
        fail "file-count escalation reason missing"
      fi
      if printf '%s\n' "$candidate_files" | jq -r '.[]' | grep -E -- "$GOVERNED_PATH_PATTERN" >/dev/null; then
        [ "$is_narrow" != "true" ] || fail "governed path requires full review"
        reason_present "governance-path" ||
          fail "governance-path escalation reason missing"
        has_real_followup_trigger=true
        derived_mechanical_escalate=true
        if [ -z "$derived_mechanical_reason" ]; then
          derived_mechanical_reason="governance-path"
        fi
      elif reason_present "governance-path"; then
        fail "governance-path escalation reason missing"
      fi
      if [ -n "$CONFIGURED_PATH_PATTERN" ] &&
        printf '%s\n' "$candidate_files" | jq -r '.[]' | grep -E -- "$CONFIGURED_PATH_PATTERN" >/dev/null; then
        [ "$is_narrow" != "true" ] || fail "configured path requires full review"
        reason_present "configured-path" ||
          fail "configured-path escalation reason missing"
        has_real_followup_trigger=true
        derived_mechanical_escalate=true
        if [ -z "$derived_mechanical_reason" ]; then
          derived_mechanical_reason="configured-path"
        fi
      elif reason_present "configured-path"; then
        fail "configured-path escalation reason missing"
      fi
      if reason_present "last-reviewed-unusable"; then
        fail "last-reviewed-unusable escalation reason missing"
      fi
    fi
    [ "$mechanical_escalate" = "$derived_mechanical_escalate" ] ||
      fail "mechanical escalation does not match git"
    if [ "$derived_mechanical_escalate" = "true" ]; then
      [ "$artifact_mechanical_reason" = "$derived_mechanical_reason" ] ||
        fail "mechanical escalation reason does not match git"
    elif [ -n "$artifact_mechanical_reason" ]; then
      fail "mechanical escalation reason does not match git"
    fi
    if [ "$semantic_ambiguous" = "true" ]; then
      has_real_followup_trigger=true
    elif reason_present "public-api" ||
      reason_present "logic-restructure" ||
      reason_present "reviewer-routing-policy" ||
      reason_present "output-schema" ||
      reason_present "install-sync" ||
      reason_present "path-validation-guard" ||
      reason_present "external-invocation-guard" ||
      reason_present "generated-output-renderer" ||
      reason_present "generated-output-contract" ||
      reason_present "source-owned-contract" ||
      reason_present "safety-boundary" ||
      reason_present "broad-scope" ||
      reason_present "architecture-surface" ||
      reason_present "shared-workflow-policy"; then
      has_real_followup_trigger=true
    elif reason_present "ambiguous-classification"; then
      fail "ambiguous-classification escalation reason missing"
    fi
    if reason_present "not-followup"; then
      fail "not-followup escalation reason missing"
    fi
    if [ "$is_narrow" != "true" ] && [ "$has_real_followup_trigger" != "true" ]; then
      fail "full follow-up requires justified escalation"
    fi
  elif [ "$mechanical_escalate" != "true" ] || [ "$artifact_mechanical_reason" != "not-followup" ]; then
    fail "mechanical escalation does not match git"
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

  jq -s -e --arg head "$HEAD_SHA" --arg expected_schema "$EXPECTED_SCHEMA" --arg provider "$PROVIDER" '
    def one_of($values; $value): ($values | index($value)) != null;
    def positive_integer: type == "number" and . == floor and . >= 1;
    def nullable_positive_integer: . == null or positive_integer;
    def repo_path:
      type == "string"
      and length > 0
      and (startswith("/") | not)
      and (split("/") | all(. != "" and . != "." and . != ".."));
    def github_node_id: type == "string" and test("^[A-Za-z0-9_+=/-]+$");
    def classification: one_of([
      "actionable",
      "resolved",
      "outdated",
      "bot-boilerplate",
      "review-request",
      "reaction-only",
      "conversation",
      "unknown"
    ]; .);
    def model_context: one_of(["include", "summarize", "drop"]; .);
    def comment_shape:
      type == "object"
      and ((keys_unsorted - [
        "author",
        "author_association",
        "created_at",
        "updated_at",
        "body",
        "is_bot",
        "minimized_reason"
      ]) | length == 0)
      and (.author | type == "string" and length > 0)
      and ((has("author_association") | not) or .author_association == null or (.author_association | type == "string" and length > 0))
      and (.created_at | type == "string")
      and (.updated_at | type == "string")
      and (.body | type == "string")
      and (.is_bot | type == "boolean")
      and ((has("minimized_reason") | not) or .minimized_reason == null or (.minimized_reason | type == "string"));
    def thread_shape:
      type == "object"
      and ((keys_unsorted | sort) == ([
        "thread_id",
        "is_resolved",
        "is_outdated",
        "path",
        "line",
        "original_line",
        "start_line",
        "original_start_line",
        "classification",
        "model_context",
        "staleness_reason",
        "comments",
        "summary"
      ] | sort))
      and (.thread_id | github_node_id)
      and (.is_resolved | type == "boolean")
      and (.is_outdated | type == "boolean")
      and (.path | repo_path)
      and (.line | nullable_positive_integer)
      and (.original_line | nullable_positive_integer)
      and (.start_line | nullable_positive_integer)
      and (.original_start_line | nullable_positive_integer)
      and (.classification | classification)
      and (.model_context | model_context)
      and (.staleness_reason | type == "string")
      and (.comments | type == "array")
      and (.comments | all(.[]; comment_shape))
      and (.summary | type == "string");
    length == 1
    and (.[0] |
      type == "object"
      and ((keys_unsorted | sort) == (["schema", "provider", "pr_number", "head_sha", "threads", "dropped"] | sort))
      and .schema == $expected_schema
      and .provider == $provider
      and (.pr_number | positive_integer)
      and .head_sha == $head
      and (.threads | type == "array")
      and (.threads | all(.[]; thread_shape))
      and (.dropped | type == "array"))
  ' "$PRIOR_THREADS" >/dev/null || fail "prior-thread shape validation failed"

  jq -e '
    def valid_timestamp:
      type == "string"
      and (capture("^(?<year>[0-9]{4})-(?<month>[0-9]{2})-(?<day>[0-9]{2})T(?<hour>[0-9]{2}):(?<minute>[0-9]{2}):(?<second>[0-9]{2})(?:\\.[0-9]+)?Z$")? // null) as $parts
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
    .threads | all(.[]; .comments | all(.[]; (.created_at | valid_timestamp) and (.updated_at | valid_timestamp)))
  ' "$PRIOR_THREADS" >/dev/null || fail "prior-thread timestamp validation failed"

  jq -e '
    .threads | all(.[];
      (if .model_context == "include" then
        .classification == "actionable" and (.is_resolved | not) and (.is_outdated | not) and (.comments | length > 0)
      elif .model_context == "summarize" then
        (.summary | test("\\S")) and (.comments | length == 0)
      else
        (.comments | length == 0)
      end)
      and (if .classification == "actionable" and (.is_resolved | not) and (.is_outdated | not) then .model_context == "include" else true end)
    )
  ' "$PRIOR_THREADS" >/dev/null || fail "prior-thread model-context eligibility validation failed"

  jq -e '
    def github_node_id: type == "string" and test("^[A-Za-z0-9_+=/-]+$");
    def classification: . as $value | ["resolved", "outdated", "bot-boilerplate", "review-request", "reaction-only", "conversation", "unknown"] | index($value) != null;
    .dropped | all(.[]; type == "object"
      and ((keys_unsorted | sort) == (["thread_id", "classification", "reason"] | sort))
      and (.thread_id | github_node_id)
      and (.classification | classification)
      and (.reason | type == "string" and length > 0))
  ' "$PRIOR_THREADS" >/dev/null ||
    fail "dropped-thread shape validation failed"

  jq -e '
    .threads | all(.[];
      (.start_line == null or .line == null or .start_line <= .line)
      and (.original_start_line == null or .original_line == null or .original_start_line <= .original_line)
    )
  ' "$PRIOR_THREADS" >/dev/null || fail "prior-thread line range is inverted"
}

diff_hunk_for_line() {
  local range="$1"
  local file="$2"
  local line="$3"

  git diff --unified=0 "$range" -- "$file" |
    awk -v target="$line" '
      BEGIN { hunk = 0; found = 0 }
      /^\+\+\+ / { next }
      /^@@ / {
        hunk += 1
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
            found = hunk
          }
        }
      }
      END {
        if (found) {
          print found
          exit 0
        }
        exit 1
      }
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
    local line_hunk start_hunk
    line_hunk="$(diff_hunk_for_line "$selected_range" "$file" "$line")" ||
      fail "inline anchor is outside selected review diff"
    if [ -n "$start_line" ] && [ "$start_line" != "null" ]; then
      [ "$start_line" -le "$line" ] || fail "diff anchor line range is inverted"
      start_hunk="$(diff_hunk_for_line "$selected_range" "$file" "$start_line")" ||
        fail "inline anchor is outside selected review diff"
      [ "$start_hunk" = "$line_hunk" ] ||
        fail "inline anchor range crosses selected review diff hunks"
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

  assert_single_json_object "findings envelope" "$file"
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
              body: .body
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
