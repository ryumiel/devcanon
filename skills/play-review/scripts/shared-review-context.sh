#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-}"

TOTAL_BUDGET=64000
CORE_BUDGET=20000
GUIDELINE_BUDGET=24000
PRIOR_BUDGET=16000
GUIDELINE_ITEM_LIMIT=12
PRIOR_ITEM_LIMIT=20
GUIDELINE_EXCERPT_LIMIT=4000
PRIOR_EXCERPT_LIMIT=2000

fail() {
  echo "$1" >&2
  exit 1
}

require_env() {
  local name="$1"
  [ -n "${!name:-}" ] || fail "$name is required"
}

byte_count_file() {
  wc -c <"$1" | tr -d '[:space:]'
}

byte_count_text() {
  LC_ALL=C printf '%s' "$1" | wc -c | tr -d '[:space:]'
}

append_text() {
  local file="$1"
  local text="$2"
  printf '%s' "$text" >>"$file"
}

append_line() {
  local file="$1"
  local text="$2"
  printf '%s\n' "$text" >>"$file"
}

escape_untrusted_markdown_text() {
  local text="$1"
  jq -Rn --arg value "$text" '$value | @json | .[1:-1]'
}

escape_untrusted_prior_text() {
  escape_untrusted_markdown_text "$1"
}

escape_untrusted_guideline_text() {
  escape_untrusted_markdown_text "$1"
}

escape_untrusted_manifest_text() {
  escape_untrusted_markdown_text "$1"
}

require_jq() {
  command -v jq >/dev/null 2>&1 || fail "jq is required to build play-review shared context"
}

require_repo_root() {
  local git_toplevel
  local physical_toplevel
  local physical_pwd
  git_toplevel="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "failed to determine git repository root"
  physical_toplevel="$(cd "$git_toplevel" && pwd -P)" || fail "failed to resolve git repository root"
  physical_pwd="$(pwd -P)"
  [ "$physical_toplevel" = "$physical_pwd" ] || fail "shared-review-context.sh must run from the repository root"
  REPO_ROOT="$physical_toplevel"
}

validate_head_sha() {
  require_env HEAD_SHA
  case "$HEAD_SHA" in
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
    *) fail "HEAD_SHA must be a 40-character lowercase hex SHA" ;;
  esac
}

validate_direct_ephemeral_path() {
  local label="$1"
  local file="$2"
  local suffix="$3"
  [ "${file#*..}" = "$file" ] || fail "path traversal: $file"
  case "$file" in
    /*) fail "$label path must be repo-relative: $file" ;;
    .ephemeral/*/*) fail "nested $label path rejected: $file" ;;
    .ephemeral/*"$suffix") ;;
    *) fail "$label path validation failed: $file" ;;
  esac
}

validate_findings_path() {
  validate_direct_ephemeral_path "findings" "$FINDINGS_FILE" "-findings.json"
  case "$FINDINGS_FILE" in
    *-"$HEAD_SHA"-findings.json) ;;
    *) fail "findings path must include HEAD_SHA: $FINDINGS_FILE" ;;
  esac
}

derive_paths() {
  EXPECTED_INPUT_FILE="${FINDINGS_FILE%-findings.json}-review-context-input.json"
  REVIEW_CONTEXT_OUTPUT_FILE="${FINDINGS_FILE%-findings.json}-review-context.md"
  validate_direct_ephemeral_path "review context input" "$EXPECTED_INPUT_FILE" "-review-context-input.json"
  validate_direct_ephemeral_path "review context output" "$REVIEW_CONTEXT_OUTPUT_FILE" "-review-context.md"
  validate_direct_ephemeral_path "review context input" "$REVIEW_CONTEXT_INPUT_FILE" "-review-context-input.json"
  [ "$REVIEW_CONTEXT_INPUT_FILE" = "$EXPECTED_INPUT_FILE" ] || fail "review context input path mismatch: $REVIEW_CONTEXT_INPUT_FILE"
}

guard_read_input_and_output() {
  [ -L .ephemeral ] && fail ".ephemeral must be a directory, not a symlink"
  [ ! -L "$REVIEW_CONTEXT_INPUT_FILE" ] || fail "review context input must not be a symlink: $REVIEW_CONTEXT_INPUT_FILE"
  [ -f "$REVIEW_CONTEXT_INPUT_FILE" ] || fail "review context input missing or not a regular file: $REVIEW_CONTEXT_INPUT_FILE"
  [ -r "$REVIEW_CONTEXT_INPUT_FILE" ] || fail "review context input missing or unreadable: $REVIEW_CONTEXT_INPUT_FILE"
  [ ! -L "$REVIEW_CONTEXT_OUTPUT_FILE" ] || fail "review context output must not be a symlink: $REVIEW_CONTEXT_OUTPUT_FILE"
  [ ! -d "$REVIEW_CONTEXT_OUTPUT_FILE" ] || fail "review context output path is a directory: $REVIEW_CONTEXT_OUTPUT_FILE"
  [ ! -e "$REVIEW_CONTEXT_OUTPUT_FILE" ] || [ -f "$REVIEW_CONTEXT_OUTPUT_FILE" ] || fail "review context output exists but is not a regular file: $REVIEW_CONTEXT_OUTPUT_FILE"
}

validate_json_syntax() {
  jq empty "$REVIEW_CONTEXT_INPUT_FILE" >/dev/null 2>&1 || fail "manifest JSON is malformed: $REVIEW_CONTEXT_INPUT_FILE"
}

validate_manifest_schema() {
  jq -e '
    def repo_relative_path:
      type == "string"
      and length > 0
      and (startswith("/") | not)
      and (split("/") | all(. != "" and . != "." and . != ".."));
    def nonempty_string: type == "string" and length > 0;
    def nonnegative_integer: type == "number" and . == floor and . >= 0;
    def required_string_array: type == "array" and all(.[]; nonempty_string);
    def mechanical_path_signal:
      repo_relative_path;
    def review_mode: . == "present" or . == "fix" or . == "github-post";
    def routing_risk:
      type == "object"
      and (.mechanical_path_signals | type == "array" and all(.[]; mechanical_path_signal))
      and (.semantic_classification_notes | required_string_array);
    def changed_file:
      type == "object"
      and (.status | nonempty_string)
      and (.path | repo_relative_path);
    def guideline:
      type == "object"
      and (.path | repo_relative_path)
      and (.bytes | nonnegative_integer)
      and (.summary | nonempty_string)
      and ((.priority == null) or (.priority | nonempty_string))
      and ((.exact_excerpts == null) or (.exact_excerpts | type == "array" and all(.[]; nonempty_string)));
    def prior:
      type == "object"
      and (.source | type == "object")
      and (.source.kind | nonempty_string)
      and (.source.reference | nonempty_string)
      and (.bytes | nonnegative_integer)
      and (.summary | nonempty_string)
      and (.untrusted == true)
      and ((.exact_excerpt == null) or (.exact_excerpt | nonempty_string));
    .schema == "play-review/shared-context-input/v1"
    and (.header | type == "object")
    and (.header.working_directory | nonempty_string)
    and (.header.base_ref | nonempty_string)
    and (.header.head_sha | nonempty_string)
    and (.header.active_diff_range | nonempty_string)
    and (.header.full_pr_diff_range | nonempty_string)
    and (.header.mode | review_mode)
    and (.header.language_hints | required_string_array)
    and (.changed_files | type == "object")
    and (.changed_files.command | nonempty_string)
    and (.changed_files.total_count | nonnegative_integer)
    and (.changed_files.truncated | type == "boolean")
    and (.changed_files.records | type == "array" and all(.[]; changed_file))
    and (.doc_impact_summary | type == "object")
    and (.doc_impact_summary.arch_files | type == "array" and all(.[]; repo_relative_path))
    and (.doc_impact_summary.new_adrs | type == "array" and all(.[]; repo_relative_path))
    and (.doc_impact_summary.modified_adrs | type == "array" and all(.[]; repo_relative_path))
    and (.doc_impact_summary.architecture_routing_risks | routing_risk)
    and (.doc_impact_summary.spec_routing_risks | routing_risk)
    and ((.doc_impact_summary.notes == null) or (.doc_impact_summary.notes | nonempty_string))
    and (.adr_references | type == "array" and all(.[]; type == "object" and (.path | repo_relative_path) and (.reason | nonempty_string)))
    and (.discovered_guidelines | type == "object")
    and (.discovered_guidelines.records | type == "array" and all(.[]; guideline))
    and (.output_format | type == "object")
    and (.output_format.markdown | nonempty_string)
    and ((.prior_review_context == null) or (.prior_review_context | type == "object" and (.records | type == "array" and all(.[]; prior))))
  ' "$REVIEW_CONTEXT_INPUT_FILE" >/dev/null || {
    if jq -e '.header.mode as $mode | ($mode != "present" and $mode != "fix" and $mode != "github-post")' "$REVIEW_CONTEXT_INPUT_FILE" >/dev/null; then
      fail "manifest mode must be present, fix, or github-post"
    fi
    if jq -e '.discovered_guidelines.records[]? | select((.summary | type != "string") or (.summary | length == 0))' "$REVIEW_CONTEXT_INPUT_FILE" >/dev/null; then
      fail "guideline summary is required"
    fi
    if jq -e '.prior_review_context.records[]? | select(.untrusted != true)' "$REVIEW_CONTEXT_INPUT_FILE" >/dev/null; then
      fail "prior review untrusted flag must be true"
    fi
    if jq -e '.prior_review_context.records[]? | select((.summary | type != "string") or (.summary | length == 0))' "$REVIEW_CONTEXT_INPUT_FILE" >/dev/null; then
      fail "prior review summary is required"
    fi
    fail "manifest schema mismatch: $REVIEW_CONTEXT_INPUT_FILE"
  }
}

validate_manifest_bindings() {
  local manifest_head
  local manifest_root
  manifest_head="$(jq -r '.header.head_sha' "$REVIEW_CONTEXT_INPUT_FILE")"
  manifest_root="$(jq -r '.header.working_directory' "$REVIEW_CONTEXT_INPUT_FILE")"
  [ "$manifest_head" = "$HEAD_SHA" ] || fail "manifest head_sha mismatch: $manifest_head"
  [ "$manifest_root" = "$REPO_ROOT" ] || fail "manifest working_directory mismatch: $manifest_root"
}

append_array_values() {
  local target="$1"
  local title="$2"
  local query="$3"
  append_line "$target" "- **$title:**"
  if [ "$(jq "$query | length" "$REVIEW_CONTEXT_INPUT_FILE")" -eq 0 ]; then
    append_line "$target" "  - (none)"
  else
    while IFS= read -r value; do
      append_line "$target" "  - $value"
    done < <(jq -r "$query[] | @json | .[1:-1]" "$REVIEW_CONTEXT_INPUT_FILE")
  fi
}

append_routing_risk_values() {
  local target="$1"
  local title="$2"
  local query="$3"
  append_line "$target" "- **$title:**"
  append_line "$target" "  - Mechanical path signals:"
  if [ "$(jq "$query.mechanical_path_signals | length" "$REVIEW_CONTEXT_INPUT_FILE")" -eq 0 ]; then
    append_line "$target" "    - (none)"
  else
    while IFS= read -r value; do
      append_line "$target" "    - $value"
    done < <(jq -r "$query.mechanical_path_signals[] | @json | .[1:-1]" "$REVIEW_CONTEXT_INPUT_FILE")
  fi
  append_line "$target" "  - Semantic classification notes:"
  if [ "$(jq "$query.semantic_classification_notes | length" "$REVIEW_CONTEXT_INPUT_FILE")" -eq 0 ]; then
    append_line "$target" "    - (none)"
  else
    while IFS= read -r value; do
      append_line "$target" "    - $value"
    done < <(jq -r "$query.semantic_classification_notes[] | @json | .[1:-1]" "$REVIEW_CONTEXT_INPUT_FILE")
  fi
}

build_core_section() {
  local target="$1"
  local record
  local status_value
  local path_value
  local reason_value
  append_line "$target" "# Shared Review Context"
  append_line "$target" ""
  append_line "$target" "Review head: $HEAD_SHA"
  append_line "$target" "Findings file: $FINDINGS_FILE"
  append_line "$target" "Input manifest: $REVIEW_CONTEXT_INPUT_FILE"
  append_line "$target" "Working directory: $REPO_ROOT"
  append_line "$target" ""
  append_line "$target" "## Core Review Surface"
  jq -r '
    "- **Base ref:** " + .header.base_ref,
    "- **Active diff range:** " + .header.active_diff_range,
    "- **Full PR diff range:** " + .header.full_pr_diff_range,
    "- **Mode:** " + .header.mode,
    "- **Language hints:** " + (.header.language_hints | join(", ")),
    "- **Changed-files command:** " + .changed_files.command,
    "- **Changed-files total:** " + (.changed_files.total_count | tostring),
    "- **Changed-files truncated:** " + (.changed_files.truncated | tostring)
  ' "$REVIEW_CONTEXT_INPUT_FILE" >>"$target"
  append_line "$target" ""
  append_line "$target" "### Changed Files"
  if [ "$(jq '.changed_files.records | length' "$REVIEW_CONTEXT_INPUT_FILE")" -eq 0 ]; then
    append_line "$target" "(none)"
  else
    while IFS= read -r record; do
      status_value="$(jq -r '.status' <<<"$record")"
      path_value="$(jq -r '.path' <<<"$record")"
      append_line "$target" "- $(escape_untrusted_manifest_text "$status_value") $(escape_untrusted_manifest_text "$path_value")"
    done < <(jq -c '.changed_files.records[]' "$REVIEW_CONTEXT_INPUT_FILE")
  fi
  append_line "$target" ""
  append_line "$target" "### Documentation Impact"
  append_array_values "$target" "Architecture files" ".doc_impact_summary.arch_files"
  append_array_values "$target" "New ADRs" ".doc_impact_summary.new_adrs"
  append_array_values "$target" "Modified ADRs" ".doc_impact_summary.modified_adrs"
  append_routing_risk_values "$target" "Architecture routing risks" ".doc_impact_summary.architecture_routing_risks"
  append_routing_risk_values "$target" "Spec routing risks" ".doc_impact_summary.spec_routing_risks"
  if [ "$(jq -r '.doc_impact_summary.notes // empty' "$REVIEW_CONTEXT_INPUT_FILE")" != "" ]; then
    append_line "$target" "- **Notes:** $(escape_untrusted_markdown_text "$(jq -r '.doc_impact_summary.notes' "$REVIEW_CONTEXT_INPUT_FILE")")"
  fi
  append_line "$target" ""
  append_line "$target" "### ADR References"
  if [ "$(jq '.adr_references | length' "$REVIEW_CONTEXT_INPUT_FILE")" -eq 0 ]; then
    append_line "$target" "(none)"
  else
    while IFS= read -r record; do
      path_value="$(jq -r '.path' <<<"$record")"
      reason_value="$(jq -r '.reason' <<<"$record")"
      append_line "$target" "- $(escape_untrusted_manifest_text "$path_value") - $(escape_untrusted_manifest_text "$reason_value")"
    done < <(jq -c '.adr_references[]' "$REVIEW_CONTEXT_INPUT_FILE")
  fi
  append_line "$target" ""
  append_line "$target" "## Output Format"
  jq -r '.output_format.markdown' "$REVIEW_CONTEXT_INPUT_FILE" >>"$target"
  append_line "$target" ""
  [ "$(byte_count_file "$target")" -le "$CORE_BUDGET" ] || fail "core section byte budget exceeded"
}

append_if_fits() {
  local target="$1"
  local section_budget="$2"
  local text="$3"
  local before
  local after
  before="$(byte_count_file "$target")"
  append_text "$target" "$text"
  after="$(byte_count_file "$target")"
  if [ "$after" -gt "$section_budget" ]; then
    truncate -s "$before" "$target"
    return 1
  fi
  return 0
}

build_guideline_section() {
  local target="$1"
  local count
  local index
  local record
  local path_value
  local bytes_value
  local summary
  local summary_display
  local priority
  local priority_display
  local path_display
  local excerpt_count
  local excerpt
  local excerpt_display
  local excerpt_bytes
  count="$(jq '.discovered_guidelines.records | length' "$REVIEW_CONTEXT_INPUT_FILE")"
  append_line "$target" "## Discovered Guidelines"
  if [ "$count" -eq 0 ]; then
    append_line "$target" "(none)"
    append_line "$target" ""
    return
  fi
  index=0
  while [ "$index" -lt "$count" ]; do
    record="$(jq -c ".discovered_guidelines.records[$index]" "$REVIEW_CONTEXT_INPUT_FILE")"
    path_value="$(jq -r '.path' <<<"$record")"
    path_display="$(escape_untrusted_guideline_text "$path_value")"
    bytes_value="$(jq -r '.bytes' <<<"$record")"
    summary="$(jq -r '.summary' <<<"$record")"
    summary_display="$(escape_untrusted_guideline_text "$summary")"
    priority="$(jq -r '.priority // "unspecified"' <<<"$record")"
    priority_display="$(escape_untrusted_guideline_text "$priority")"
    if [ "$index" -ge "$GUIDELINE_ITEM_LIMIT" ]; then
      append_line "$target" "### Guideline overflow record $((index + 1))"
      append_line "$target" "- **Path:** $path_display"
      append_line "$target" "- **Byte count:** $bytes_value"
      append_line "$target" "- **Summary:** $summary_display"
      append_line "$target" "- **Overflow:** record beyond $GUIDELINE_ITEM_LIMIT guideline item limit"
      append_line "$target" "- Targeted reread: open $path_display before relying on this guideline."
      append_line "$target" ""
    else
      append_line "$target" "### Guideline record $((index + 1))"
      append_line "$target" "- **Path:** $path_display"
      append_line "$target" "- **Byte count:** $bytes_value"
      append_line "$target" "- **Priority:** $priority_display"
      append_line "$target" "- **Summary:** $summary_display"
      append_line "$target" "- Targeted reread: open $path_display if this summary affects a finding."
      excerpt_count="$(jq '.exact_excerpts // [] | length' <<<"$record")"
      if [ "$excerpt_count" -eq 0 ]; then
        append_line "$target" "- **Exact excerpt:** (none)"
      else
        excerpt="$(jq -r '(.exact_excerpts // [])[0]' <<<"$record")"
        excerpt_bytes="$(byte_count_text "$excerpt")"
        excerpt_display="$(escape_untrusted_guideline_text "$excerpt")"
        if [ "$excerpt_bytes" -le "$GUIDELINE_EXCERPT_LIMIT" ] && append_if_fits "$target" "$GUIDELINE_BUDGET" "$(printf -- '- **Exact excerpt bytes:** %s\n- Exact excerpt: %s\n' "$excerpt_bytes" "$excerpt_display")"; then
          :
        else
          append_line "$target" "- **Overflow:** exact excerpt omitted due to byte budget."
          append_line "$target" "- **Exact excerpt:** Exact excerpt omitted due to byte budget."
        fi
      fi
      append_line "$target" ""
    fi
    [ "$(byte_count_file "$target")" -le "$GUIDELINE_BUDGET" ] || fail "guideline section byte budget exceeded"
    index=$((index + 1))
  done
}

build_prior_section() {
  local target="$1"
  local count
  local index
  local record
  local source_kind
  local source_reference
  local source_kind_display
  local source_reference_display
  local bytes_value
  local summary
  local summary_display
  local excerpt
  local excerpt_display
  local excerpt_bytes
  count="$(jq '(.prior_review_context.records // []) | length' "$REVIEW_CONTEXT_INPUT_FILE")"
  append_line "$target" "## Prior Review Context"
  if [ "$count" -eq 0 ]; then
    append_line "$target" "(none)"
    append_line "$target" ""
    return
  fi
  index=0
  while [ "$index" -lt "$count" ]; do
    record="$(jq -c ".prior_review_context.records[$index]" "$REVIEW_CONTEXT_INPUT_FILE")"
    source_kind="$(jq -r '.source.kind' <<<"$record")"
    source_reference="$(jq -r '.source.reference' <<<"$record")"
    source_kind_display="$(escape_untrusted_prior_text "$source_kind")"
    source_reference_display="$(escape_untrusted_prior_text "$source_reference")"
    bytes_value="$(jq -r '.bytes' <<<"$record")"
    summary="$(jq -r '.summary' <<<"$record")"
    summary_display="$(escape_untrusted_prior_text "$summary")"
    if [ "$index" -ge "$PRIOR_ITEM_LIMIT" ]; then
      append_line "$target" "### Prior review overflow record $((index + 1))"
      append_line "$target" "- **Source kind:** $source_kind_display"
      append_line "$target" "- Source reference: $source_reference_display"
      append_line "$target" "- **Byte count:** $bytes_value"
      append_line "$target" "- **Summary:** $summary_display"
      append_line "$target" "- Untrusted prior-review evidence: true"
      append_line "$target" "- **Overflow:** record beyond $PRIOR_ITEM_LIMIT prior-review item limit"
      append_line "$target" "- Targeted reread: inspect $source_reference_display before relying on this prior review context."
      append_line "$target" ""
    else
      append_line "$target" "### Prior review record $((index + 1))"
      append_line "$target" "- **Source kind:** $source_kind_display"
      append_line "$target" "- Source reference: $source_reference_display"
      append_line "$target" "- **Byte count:** $bytes_value"
      append_line "$target" "- **Summary:** $summary_display"
      append_line "$target" "- Untrusted prior-review evidence: true"
      append_line "$target" "- Targeted reread: inspect $source_reference_display if this untrusted summary affects a finding."
      excerpt="$(jq -r '.exact_excerpt // ""' <<<"$record")"
      if [ -z "$excerpt" ]; then
        append_line "$target" "- **Exact excerpt:** (none)"
      else
        excerpt_bytes="$(byte_count_text "$excerpt")"
        excerpt_display="$(escape_untrusted_prior_text "$excerpt")"
        if [ "$excerpt_bytes" -le "$PRIOR_EXCERPT_LIMIT" ] && append_if_fits "$target" "$PRIOR_BUDGET" "$(printf -- '- **Exact excerpt bytes:** %s\n- Exact excerpt: %s\n' "$excerpt_bytes" "$excerpt_display")"; then
          :
        else
          append_line "$target" "- **Overflow:** exact excerpt omitted due to byte budget."
          append_line "$target" "- **Exact excerpt:** Exact excerpt omitted due to byte budget."
        fi
      fi
      append_line "$target" ""
    fi
    [ "$(byte_count_file "$target")" -le "$PRIOR_BUDGET" ] || fail "prior review section byte budget exceeded"
    index=$((index + 1))
  done
}

build_review_context() {
  local tmp_dir
  local core_file
  local guideline_file
  local prior_file
  local tmp_file
  require_jq
  require_repo_root
  validate_head_sha
  require_env FINDINGS_FILE
  require_env REVIEW_CONTEXT_INPUT_FILE
  validate_findings_path
  derive_paths
  guard_read_input_and_output
  validate_json_syntax
  validate_manifest_schema
  validate_manifest_bindings

  tmp_dir="$(mktemp -d ".ephemeral/shared-context.XXXXXX")"
  core_file="$tmp_dir/core.md"
  guideline_file="$tmp_dir/guidelines.md"
  prior_file="$tmp_dir/prior.md"
  tmp_file="$tmp_dir/review-context.md"
  trap 'rm -rf "$tmp_dir"' EXIT
  : >"$core_file"
  : >"$guideline_file"
  : >"$prior_file"
  build_core_section "$core_file"
  build_guideline_section "$guideline_file"
  build_prior_section "$prior_file"
  cat "$core_file" "$guideline_file" "$prior_file" >"$tmp_file"
  [ -s "$tmp_file" ] || fail "review context output is empty"
  [ "$(byte_count_file "$tmp_file")" -le "$TOTAL_BUDGET" ] || fail "review context byte budget exceeded"
  mv "$tmp_file" "$REVIEW_CONTEXT_OUTPUT_FILE"
  trap - EXIT
  rm -rf "$tmp_dir"
  [ -s "$REVIEW_CONTEXT_OUTPUT_FILE" ] || fail "review context output is empty"
  [ "$(byte_count_file "$REVIEW_CONTEXT_OUTPUT_FILE")" -le "$TOTAL_BUDGET" ] || fail "review context byte budget exceeded"
  printf '%s\n' "$REVIEW_CONTEXT_OUTPUT_FILE"
}

case "$command_name" in
  build-review-context)
    build_review_context
    ;;
  *)
    fail "usage: shared-review-context.sh build-review-context"
    ;;
esac
