#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-}"
if [ $# -gt 0 ]; then
  shift
fi

SURFACE=""
HEAD_SHA=""
SCOPE_DECISION=""
EXPECTED_SCHEMA=""
PRIOR_CONTEXT_KIND=""
PRIOR_CONTEXT_PATH=""
GOVERNED_PATH_PATTERN=""
CONFIGURED_PATH_PATTERN=""
MAX_NARROW_CHANGED_FILES=""
ALLOW_AMBIGUOUS_FULL="false"
PRIOR_THREADS=""
DIFF_RANGE=""
ANCHORS=""
FINDINGS_FILE=""
REVIEW_BODY_FILE=""
REVIEW_EVENT=""
APPROVED_PAYLOAD=""

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
      --scope-decision)
        [ -n "${2:-}" ] || fail "--scope-decision requires a value"
        SCOPE_DECISION="$2"
        shift 2
        ;;
      --expected-schema)
        [ -n "${2:-}" ] || fail "--expected-schema requires a value"
        EXPECTED_SCHEMA="$2"
        shift 2
        ;;
      --prior-context-kind)
        [ -n "${2:-}" ] || fail "--prior-context-kind requires a value"
        PRIOR_CONTEXT_KIND="$2"
        shift 2
        ;;
      --prior-context-path)
        [ -n "${2:-}" ] || fail "--prior-context-path requires a value"
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
      --allow-ambiguous-full)
        [ -n "${2:-}" ] || fail "--allow-ambiguous-full requires a value"
        ALLOW_AMBIGUOUS_FULL="$2"
        shift 2
        ;;
      --prior-threads)
        [ -n "${2:-}" ] || fail "--prior-threads requires a value"
        PRIOR_THREADS="$2"
        shift 2
        ;;
      --diff-range)
        [ -n "${2:-}" ] || fail "--diff-range requires a value"
        DIFF_RANGE="$2"
        shift 2
        ;;
      --anchors)
        [ -n "${2:-}" ] || fail "--anchors requires a value"
        ANCHORS="$2"
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
      --approved-payload)
        [ -n "${2:-}" ] || fail "--approved-payload requires a value"
        APPROVED_PAYLOAD="$2"
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
    and (.full_diff_range | type == "string" and length > 0)
    and (.active_diff_range | type == "string" and length > 0)
    and (.last_reviewed_sha == null or (.last_reviewed_sha | sha))
    and (.is_followup_narrow | type == "boolean")
    and (.changed_files | type == "array" and all(.[]; repo_path))
    and (.changed_file_count | type == "number" and . == floor and . >= 0)
    and (.language_hints | type == "array" and all(.[]; type == "string"))
    and (.escalation | type == "object")
    and (.escalation.escalate_full | type == "boolean")
    and (.escalation.reasons | type == "array" and all(.[]; type == "string"))
    and one_of(["clear", "ambiguous"]; .escalation.semantic_scope)
    and (.prior_context | type == "object")
    and (.prior_context.kind | type == "string")
    and (.prior_context.path == null or (.prior_context.path | type == "string"))
  ' "$SCOPE_DECISION" >/dev/null || fail "scope decision schema mismatch"
}

require_scope_flags() {
  require_flag "--scope-decision" "$SCOPE_DECISION"
  require_flag "--surface" "$SURFACE"
  require_flag "--expected-schema" "$EXPECTED_SCHEMA"
  require_flag "--prior-context-kind" "$PRIOR_CONTEXT_KIND"
  require_flag "--governed-path-pattern" "$GOVERNED_PATH_PATTERN"
  require_flag "--max-narrow-changed-files" "$MAX_NARROW_CHANGED_FILES"
  case "$SURFACE" in
    pr-review | branch-review) ;;
    *) fail "--surface must be pr-review or branch-review" ;;
  esac
  case "$PRIOR_CONTEXT_KIND" in
    none | prior-threads | prior-branch-findings) ;;
    *) fail "--prior-context-kind is invalid" ;;
  esac
  case "$MAX_NARROW_CHANGED_FILES" in
    '' | *[!0-9]*) fail "--max-narrow-changed-files must be an integer" ;;
  esac
}

range_exists() {
  git diff --quiet "$1" >/dev/null 2>&1 || [ "$?" -eq 1 ]
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
  assert_readable_file "--scope-decision" "$SCOPE_DECISION"
  validate_scope_shape

  local artifact_surface artifact_head full_range active_range last_reviewed
  local is_narrow escalate_full semantic_scope changed_count
  local expected_files actual_files expected_hints actual_hints
  local expected_count actual_count expected_active_range

  artifact_surface="$(jq_value "$SCOPE_DECISION" '.surface')"
  [ "$artifact_surface" = "$SURFACE" ] ||
    fail "scope decision surface mismatch"
  artifact_head="$(jq_value "$SCOPE_DECISION" '.head_sha')"
  [ "$artifact_head" = "$HEAD_SHA" ] ||
    fail "scope decision head_sha mismatch"

  full_range="$(jq_value "$SCOPE_DECISION" '.full_diff_range')"
  active_range="$(jq_value "$SCOPE_DECISION" '.active_diff_range')"
  last_reviewed="$(jq_value "$SCOPE_DECISION" '.last_reviewed_sha // ""')"
  is_narrow="$(jq_value "$SCOPE_DECISION" '.is_followup_narrow')"
  escalate_full="$(jq_value "$SCOPE_DECISION" '.escalation.escalate_full')"
  semantic_scope="$(jq_value "$SCOPE_DECISION" '.escalation.semantic_scope')"
  changed_count="$(jq_value "$SCOPE_DECISION" '.changed_file_count')"

  if [ -n "$last_reviewed" ]; then
    git cat-file -e "$last_reviewed^{commit}" 2>/dev/null &&
      git merge-base --is-ancestor "$last_reviewed" HEAD 2>/dev/null ||
      fail "last_reviewed_sha is not a usable ancestor"
  fi

  range_exists "$full_range" || fail "full_diff_range does not resolve"
  range_exists "$active_range" || fail "active_diff_range does not resolve"

  if [ "$is_narrow" = "true" ]; then
    [ -n "$last_reviewed" ] || fail "narrow scope requires last_reviewed_sha"
    expected_active_range="$last_reviewed..HEAD"
    [ "$active_range" = "$expected_active_range" ] ||
      fail "narrow active_diff_range must be last_reviewed_sha..HEAD"
    [ "$escalate_full" = "false" ] ||
      fail "narrow scope cannot claim full escalation"
  else
    [ "$active_range" = "$full_range" ] ||
      fail "full escalation active_diff_range must equal full_diff_range"
  fi

  if [ "$semantic_scope" = "ambiguous" ] && [ "$escalate_full" != "true" ]; then
    fail "ambiguous semantic scope requires full escalation"
  fi
  if [ "$semantic_scope" = "ambiguous" ] && [ "$ALLOW_AMBIGUOUS_FULL" != "true" ]; then
    fail "ambiguous semantic scope requires explicit allowance"
  fi

  expected_files="$(changed_files_json "$active_range")"
  actual_files="$(jq_json "$SCOPE_DECISION" '.changed_files | sort')"
  json_equal "$expected_files" "$actual_files" ||
    fail "changed files mismatch"
  expected_count="$(printf '%s\n' "$expected_files" | jq 'length')"
  actual_count="$changed_count"
  [ "$expected_count" = "$actual_count" ] ||
    fail "changed file count mismatch"
  expected_hints="$(printf '%s\n' "$expected_files" | language_hints_json_for_files)"
  actual_hints="$(jq_json "$SCOPE_DECISION" '.language_hints | sort | unique')"
  json_equal "$expected_hints" "$actual_hints" ||
    fail "language hints mismatch"

  if [ -n "$last_reviewed" ] && [ "$is_narrow" != "true" ]; then
    local candidate_count
    local candidate_files
    candidate_files="$(changed_files_json "$last_reviewed..HEAD")"
    candidate_count="$(printf '%s\n' "$candidate_files" | jq 'length')"
    if [ "$candidate_count" -gt "$MAX_NARROW_CHANGED_FILES" ]; then
      jq -e '.escalation.reasons | index("file-count") != null' "$SCOPE_DECISION" >/dev/null ||
        fail "file-count escalation reason missing"
    fi
    if printf '%s\n' "$candidate_files" | jq -r '.[]' | grep -E -- "$GOVERNED_PATH_PATTERN" >/dev/null; then
      jq -e '.escalation.reasons | index("governance-path") != null' "$SCOPE_DECISION" >/dev/null ||
        fail "governance-path escalation reason missing"
    fi
    if [ -n "$CONFIGURED_PATH_PATTERN" ] &&
      printf '%s\n' "$candidate_files" | jq -r '.[]' | grep -E -- "$CONFIGURED_PATH_PATTERN" >/dev/null; then
      jq -e '.escalation.reasons | index("configured-path") != null' "$SCOPE_DECISION" >/dev/null ||
        fail "configured-path escalation reason missing"
    fi
  fi

  local artifact_prior_kind artifact_prior_path
  artifact_prior_kind="$(jq_value "$SCOPE_DECISION" '.prior_context.kind')"
  artifact_prior_path="$(jq_value "$SCOPE_DECISION" '.prior_context.path // ""')"
  [ "$artifact_prior_kind" = "$PRIOR_CONTEXT_KIND" ] ||
    fail "prior context kind mismatch"
  [ -z "$PRIOR_CONTEXT_PATH" ] || [ "$artifact_prior_path" = "$PRIOR_CONTEXT_PATH" ] ||
    fail "prior context path mismatch"
}

validate_prior_threads() {
  require_jq
  require_repo_root
  require_flag "--prior-threads" "$PRIOR_THREADS"
  validate_current_head
  assert_readable_file "--prior-threads" "$PRIOR_THREADS"

  jq -e --arg head "$HEAD_SHA" '
    def repo_path:
      type == "string"
      and length > 0
      and (startswith("/") | not)
      and (split("/") | all(. != "" and . != "." and . != ".."));
    type == "object"
    and .schema == "pr-review/prior-threads/v1"
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
    .threads | all(.[]; (.created_at | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"))
      and (.updated_at | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")))
  ' "$PRIOR_THREADS" >/dev/null || fail "prior-thread timestamp validation failed"

  jq -e '.threads | all(.[]; .model_context_eligible | type == "boolean")' "$PRIOR_THREADS" >/dev/null ||
    fail "prior-thread model-context eligibility validation failed"

  jq -e '
    .threads | all(.[]; .dropped == null or
      ((.dropped | type == "object")
      and (.dropped.reason | type == "string" and length > 0)
      and (.dropped.at | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"))))
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
  require_repo_root
  require_flag "--diff-range" "$DIFF_RANGE"
  require_flag "--anchors" "$ANCHORS"
  validate_current_head
  range_exists "$DIFF_RANGE" || fail "diff range does not resolve"
  assert_readable_file "--anchors" "$ANCHORS"

  jq -e '
    def repo_path:
      type == "string"
      and length > 0
      and (startswith("/") | not)
      and (split("/") | all(. != "" and . != "." and . != ".."));
    type == "object"
    and .schema == "pr-review/diff-anchors/v1"
    and (.anchors | type == "array")
    and (.anchors | all(.[];
      (.path | repo_path)
      and (.line | type == "number" and . == floor and . >= 1)
      and (.start_line == null or (.start_line | type == "number" and . == floor and . >= 1))
      and (.side == "RIGHT")
      and (.body | type == "string")))
  ' "$ANCHORS" >/dev/null || fail "diff anchor shape validation failed"

  while IFS=$'\t' read -r file line start_line; do
    [ -n "$file" ] || continue
    line_in_diff "$DIFF_RANGE" "$file" "$line" ||
      fail "diff anchor outside selected diff"
    if [ -n "$start_line" ] && [ "$start_line" != "null" ]; then
      [ "$start_line" -le "$line" ] || fail "diff anchor line range is inverted"
      line_in_diff "$DIFF_RANGE" "$file" "$start_line" ||
        fail "diff anchor outside selected diff"
    fi
  done < <(jq -r '.anchors[] | [.path, .line, (.start_line // "null")] | @tsv' "$ANCHORS")
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
      and (.start_line == null or (.start_line | positive_integer))
      and one_of(["Blocking", "Nit"]; .severity)
      and (.category | type == "string")
      and (.anchor | type == "string")
      and (.body | type == "string");
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
  require_flag "--findings-file" "$FINDINGS_FILE"
  require_flag "--review-body-file" "$REVIEW_BODY_FILE"
  require_flag "--review-event" "$REVIEW_EVENT"
  require_flag "--approved-payload" "$APPROVED_PAYLOAD"
  case "$REVIEW_EVENT" in
    APPROVE | REQUEST_CHANGES | COMMENT) ;;
    *) fail "--review-event must be APPROVE, REQUEST_CHANGES, or COMMENT" ;;
  esac
  assert_readable_file "--findings-file" "$FINDINGS_FILE"
  assert_readable_file "--review-body-file" "$REVIEW_BODY_FILE"
  assert_readable_file "--approved-payload" "$APPROVED_PAYLOAD"
  assert_findings_envelope "$FINDINGS_FILE"
  jq -e 'type == "object"' "$APPROVED_PAYLOAD" >/dev/null ||
    fail "approved payload JSON validation failed"

  local body_json expected_file
  body_json="$(jq -Rs . "$REVIEW_BODY_FILE")"
  expected_file="$(mktemp ".ephemeral/.expected-approved-payload.XXXXXX")"
  jq -n \
    --arg commit_id "$HEAD_SHA" \
    --arg event "$REVIEW_EVENT" \
    --argjson body "$body_json" \
    --slurpfile findings "$FINDINGS_FILE" '
      {
        commit_id: $commit_id,
        event: $event,
        body: $body,
        comments: [
          $findings[0].findings[]
          | select(.anchor == "natural")
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

  if ! jq -n -e --slurpfile expected "$expected_file" --slurpfile actual "$APPROVED_PAYLOAD" \
    '$expected[0] == $actual[0]' >/dev/null; then
    rm -f "$expected_file"
    fail "approved payload mismatch"
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
