#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-}"
governed_path_pattern='^(docs/(adr|arch|product-requirements|specs|guidelines)/|MAP\.md$|AGENTS\.md$|CONTRIBUTING\.md$)'
configured_path_pattern="${BRANCH_REVIEW_FULL_REVIEW_PATH_PATTERN:-}"
max_narrow_changed_files="5"

fail() {
  echo "$1" >&2
  exit 1
}

require_env() {
  local name="$1"
  [ -n "${!name:-}" ] || fail "$name is required"
}

require_bool_env() {
  local name="$1"
  require_env "$name"
  case "${!name}" in
    true | false) ;;
    *) fail "$name must be true or false" ;;
  esac
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
    fail "scope-decision-artifacts.sh must run from the repository root"
}

validate_head_sha() {
  require_env HEAD_SHA
  case "$HEAD_SHA" in
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
    *) fail "HEAD_SHA must be a 40-character lowercase hex SHA" ;;
  esac
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

expected_scope_decision_path() {
  printf '.ephemeral/%s-%s-scope-decision.json\n' "$(branch_slug)" "$HEAD_SHA"
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

append_reason() {
  local reasons="$1"
  local reason="$2"

  if [ -z "$reason" ]; then
    printf '%s\n' "$reasons"
  elif [ -z "$reasons" ]; then
    printf '%s\n' "$reason"
  else
    printf '%s,%s\n' "$reasons" "$reason"
  fi
}

reason_list_json() {
  local reasons="$1"

  if [ -z "$reasons" ]; then
    printf '[]\n'
  else
    printf '%s\n' "$reasons" |
      jq -R -c 'split(",") | map(select(length > 0)) | unique'
  fi
}

json_array_from_env() {
  local name="$1"
  require_env "$name"
  printf '%s\n' "${!name}" | jq -c '
    if type == "array" then .
    else error("expected array")
    end
  ' || fail "$name must be a JSON array"
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

prepare_scope_decision_write() {
  local file
  require_repo_root
  validate_head_sha
  file="$(expected_scope_decision_path)"
  validate_direct_child_path "scope decision" "$file" "-scope-decision.json"
  prepare_write_target "scope decision" "$file"
  printf '%s\n' "$file"
}

validate_scope_decision() {
  local file expected validator prior_kind prior_path
  require_repo_root
  validate_head_sha
  require_env SCOPE_DECISION_FILE
  expected="$(expected_scope_decision_path)"
  file="$SCOPE_DECISION_FILE"
  validate_direct_child_path "scope decision" "$file" "-scope-decision.json"
  [ "$file" = "$expected" ] || fail "scope decision path mismatch: $file"
  prior_kind="none"
  prior_path="null"
  if [ -n "${PRIOR_BRANCH_FINDINGS:-}" ]; then
    prior_kind="branch-findings"
    prior_path="$PRIOR_BRANCH_FINDINGS"
  fi
  validator="$(resolve_validator)"
  if [ -n "$configured_path_pattern" ]; then
    bash "$validator" validate-scope-decision \
      --surface branch-review \
      --head-sha "$HEAD_SHA" \
      --scope-decision-file "$file" \
      --expected-schema branch-review/scope-decision/v1 \
      --expected-prior-context-kind "$prior_kind" \
      --expected-prior-context-path "$prior_path" \
      --governed-path-pattern "$governed_path_pattern" \
      --max-narrow-changed-files "$max_narrow_changed_files" \
      --configured-path-pattern "$configured_path_pattern"
  else
    bash "$validator" validate-scope-decision \
      --surface branch-review \
      --head-sha "$HEAD_SHA" \
      --scope-decision-file "$file" \
      --expected-schema branch-review/scope-decision/v1 \
      --expected-prior-context-kind "$prior_kind" \
      --expected-prior-context-path "$prior_path" \
      --governed-path-pattern "$governed_path_pattern" \
      --max-narrow-changed-files "$max_narrow_changed_files"
  fi
}

finalize_scope_decision() {
  local file expected tmp_file
  local mode last_reviewed_json prior_kind prior_path_json
  local reasons escalation_reasons_json selection_reason
  local semantic_notes semantic_ambiguous
  local changed_files_json language_hints_json

  require_repo_root
  validate_head_sha
  require_env SCOPE_DECISION_FILE
  require_env FULL_DIFF_RANGE
  require_env CANDIDATE_ACTIVE_DIFF_RANGE
  require_env ACTIVE_DIFF_RANGE
  require_bool_env IS_FOLLOWUP_NARROW
  require_env CHANGED_FILE_COUNT
  require_bool_env FOLLOWUP_SHA_USABLE
  require_bool_env MECHANICAL_ESCALATE_FULL
  require_env FINAL_CHANGED_FILES_JSON
  require_env FINAL_LANGUAGE_HINTS_JSON

  expected="$(expected_scope_decision_path)"
  file="$SCOPE_DECISION_FILE"
  validate_direct_child_path "scope decision" "$file" "-scope-decision.json"
  [ "$file" = "$expected" ] || fail "scope decision path mismatch: $file"
  prepare_write_target "scope decision" "$file"

  if [ -n "${LAST_REVIEWED_SHA:-}" ]; then
    mode="follow-up"
    last_reviewed_json="$(printf '%s\n' "$LAST_REVIEWED_SHA" | jq -R '.')"
    prior_kind="branch-findings"
    require_env PRIOR_BRANCH_FINDINGS
    prior_path_json="$(printf '%s\n' "$PRIOR_BRANCH_FINDINGS" | jq -R '.')"
  else
    mode="initial"
    last_reviewed_json="null"
    prior_kind="none"
    prior_path_json="null"
  fi

  reasons=""
  if [ "$IS_FOLLOWUP_NARROW" = "true" ]; then
    selection_reason="follow-up-narrow"
  else
    [ "$ACTIVE_DIFF_RANGE" = "$FULL_DIFF_RANGE" ] ||
      fail "full escalation selected range must equal FULL_DIFF_RANGE"
    reasons="$(append_reason "$reasons" "${MECHANICAL_ESCALATION_REASON:-}")"
    reasons="$(append_reason "$reasons" "${SEMANTIC_ESCALATION_REASON:-}")"
    [ -n "$reasons" ] || fail "full scope decision requires escalation reason"
    selection_reason="$reasons"
  fi
  escalation_reasons_json="$(reason_list_json "$reasons")"

  semantic_notes="${SEMANTIC_DECISION_NOTES:-}"
  semantic_ambiguous="${SEMANTIC_DECISION_AMBIGUOUS:-false}"
  case "$semantic_ambiguous" in
    true | false) ;;
    *) fail "SEMANTIC_DECISION_AMBIGUOUS must be true or false" ;;
  esac
  case ",${SEMANTIC_ESCALATION_REASON:-}," in
    *,ambiguous-classification,*) semantic_ambiguous=true ;;
  esac
  if [ "$IS_FOLLOWUP_NARROW" = "false" ] &&
    [ "$MECHANICAL_ESCALATE_FULL" = "false" ] &&
    [ -z "${SEMANTIC_ESCALATION_REASON:-}" ] &&
    [ -z "$semantic_notes" ]; then
    fail "semantic escalation reason or notes are required for semantic full escalation"
  fi

  changed_files_json="$(json_array_from_env FINAL_CHANGED_FILES_JSON)"
  language_hints_json="$(json_array_from_env FINAL_LANGUAGE_HINTS_JSON)"

  tmp_file="$(mktemp ".ephemeral/branch-review-scope-decision.XXXXXX")"
  jq -n \
    --arg schema "branch-review/scope-decision/v1" \
    --arg surface "branch-review" \
    --arg mode "$mode" \
    --arg selected_range "$ACTIVE_DIFF_RANGE" \
    --arg full_range "$FULL_DIFF_RANGE" \
    --arg candidate_range "$CANDIDATE_ACTIVE_DIFF_RANGE" \
    --arg selection_reason "$selection_reason" \
    --arg head_sha "$HEAD_SHA" \
    --arg prior_kind "$prior_kind" \
    --arg mechanical_reason "${MECHANICAL_ESCALATION_REASON:-}" \
    --arg notes "$semantic_notes" \
    --argjson is_narrow "$IS_FOLLOWUP_NARROW" \
    --argjson escalation_reasons "$escalation_reasons_json" \
    --argjson last_reviewed "$last_reviewed_json" \
    --argjson changed_files "$changed_files_json" \
    --argjson language_hints "$language_hints_json" \
    --argjson prior_path "$prior_path_json" \
    --argjson changed_file_count "$CHANGED_FILE_COUNT" \
    --argjson followup_sha_usable "$FOLLOWUP_SHA_USABLE" \
    --argjson mechanical_escalate "$MECHANICAL_ESCALATE_FULL" \
    --argjson semantic_ambiguous "$semantic_ambiguous" \
    '{
      schema: $schema,
      surface: $surface,
      mode: $mode,
      selected_range: $selected_range,
      full_range: $full_range,
      candidate_narrow_range: $candidate_range,
      is_followup_narrow: $is_narrow,
      selection_reason: $selection_reason,
      escalation_reasons: $escalation_reasons,
      last_reviewed_sha: $last_reviewed,
      head_sha: $head_sha,
      changed_files: $changed_files,
      language_hints: $language_hints,
      prior_context: {
        kind: $prior_kind,
        path: $prior_path
      },
      mechanical_facts: {
        changed_file_count: $changed_file_count,
        followup_sha_usable: $followup_sha_usable,
        mechanical_escalate_full: $mechanical_escalate,
        mechanical_escalation_reason: $mechanical_reason
      },
      semantic_decision: {
        checked: true,
        ambiguous: $semantic_ambiguous,
        notes: $notes
      }
    }' >"$tmp_file"
  mv "$tmp_file" "$file"

  validate_scope_decision
}

case "$command_name" in
  prepare-scope-decision-write)
    prepare_scope_decision_write
    ;;
  validate-scope-decision)
    validate_scope_decision
    ;;
  finalize-scope-decision)
    finalize_scope_decision
    ;;
  *)
    fail "usage: scope-decision-artifacts.sh prepare-scope-decision-write|validate-scope-decision|finalize-scope-decision"
    ;;
esac
