#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-}"
governed_path_pattern='^(docs/(adr|arch|product-requirements|specs|guidelines)/|MAP\.md$|AGENTS\.md$|CONTRIBUTING\.md$)'

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "$name is required" >&2
    exit 1
  fi
}

require_jq() {
  command -v jq >/dev/null 2>&1 || {
    echo "jq is required to validate branch-review/scope-decision/v1" >&2
    exit 1
  }
}

require_repo_root() {
  local git_toplevel
  local physical_toplevel
  local physical_pwd
  git_toplevel="$(git rev-parse --show-toplevel 2>/dev/null)" || {
    echo "failed to determine git repository root" >&2
    exit 1
  }
  physical_toplevel="$(cd "$git_toplevel" && pwd -P)" || {
    echo "failed to resolve git repository root" >&2
    exit 1
  }
  physical_pwd="$(pwd -P)"
  [ "$physical_toplevel" = "$physical_pwd" ] || {
    echo "scope-decision-artifacts.sh must run from the repository root" >&2
    exit 1
  }
}

validate_head_sha() {
  require_env HEAD_SHA
  case "$HEAD_SHA" in
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
    *)
      echo "HEAD_SHA must be a 40-character lowercase hex SHA" >&2
      exit 1
      ;;
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
  raw_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" || {
    echo "failed to determine current git branch" >&2
    exit 1
  }
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
    .ephemeral/*/*)
      echo "nested $label path rejected: $file" >&2
      exit 1
      ;;
    .ephemeral/*"$suffix") ;;
    *)
      echo "$label path validation failed: $file" >&2
      exit 1
      ;;
  esac
  [ "${file#*..}" = "$file" ] || {
    echo "path traversal: $file" >&2
    exit 1
  }
}

prepare_write_target() {
  local label="$1"
  local file="$2"
  [ -L .ephemeral ] && {
    echo ".ephemeral must be a directory, not a symlink" >&2
    exit 1
  }
  mkdir -p .ephemeral
  [ ! -L "$file" ] || {
    echo "$label path must not be a symlink: $file" >&2
    exit 1
  }
  [ ! -d "$file" ] || {
    echo "$label path is a directory: $file" >&2
    exit 1
  }
  [ ! -e "$file" ] || [ -f "$file" ] || {
    echo "$label path exists but is not a regular file: $file" >&2
    exit 1
  }
}

assert_readable_file() {
  local label="$1"
  local file="$2"
  [ -L .ephemeral ] && {
    echo ".ephemeral must be a directory, not a symlink" >&2
    exit 1
  }
  [ ! -L "$file" ] || {
    echo "$label must not be a symlink: $file" >&2
    exit 1
  }
  [ -f "$file" ] || {
    echo "$label missing or not a regular file: $file" >&2
    exit 1
  }
  [ -r "$file" ] || {
    echo "$label missing or unreadable: $file" >&2
    exit 1
  }
}

validate_ref_endpoint() {
  local label="$1"
  local value="$2"
  case "$value" in
    "" | "@" | *@{* | -* | *$'\n'* | *$'\r'*)
      echo "$label range endpoint is invalid: $value" >&2
      return 1
      ;;
    HEAD)
      return 0
      ;;
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f])
      return 0
      ;;
  esac
  git check-ref-format --branch "$value" >/dev/null 2>&1
}

validate_review_range_field() {
  local field="$1"
  local value="$2"
  local left
  local right

  case "$value" in
    "" | -* | *$'\n'* | *$'\r'*)
      echo "$field must be a safe git diff range" >&2
      return 1
      ;;
  esac

  case "$value" in
    *...*)
      left="${value%%...*}"
      right="${value#*...}"
      ;;
    *..*)
      left="${value%%..*}"
      right="${value#*..}"
      ;;
    *)
      echo "$field must contain a git diff range separator" >&2
      return 1
      ;;
  esac

  case "$left" in
    "" | *..*)
      echo "$field left endpoint is invalid: $left" >&2
      return 1
      ;;
  esac
  case "$right" in
    "" | *..*)
      echo "$field right endpoint is invalid: $right" >&2
      return 1
      ;;
  esac

  validate_ref_endpoint "$field" "$left" &&
    validate_ref_endpoint "$field" "$right"
}

validate_full_review_range_field() {
  local field="$1"
  local value="$2"
  local left
  local right

  case "$value" in
    *...*)
      left="${value%%...*}"
      right="${value#*...}"
      ;;
    *)
      echo "$field must use merge-base diff range syntax ending at HEAD" >&2
      return 1
      ;;
  esac

  [ "$right" = "HEAD" ] || {
    echo "$field must end at HEAD: $value" >&2
    return 1
  }

  [ "$left" != "HEAD" ] || {
    echo "$field left endpoint must be a base ref, not HEAD: $value" >&2
    return 1
  }

  validate_ref_endpoint "$field" "$left" &&
    validate_ref_endpoint "$field" "$right"
}

validate_scope_decision_ranges() {
  local field
  local value

  value="$(jq -ser '.[0].full_range' "$SCOPE_DECISION_FILE")" || return 1
  validate_full_review_range_field "full_range" "$value" || return 1

  for field in selected_range candidate_narrow_range; do
    value="$(jq -ser --arg field "$field" '.[0][$field]' "$SCOPE_DECISION_FILE")" || return 1
    validate_review_range_field "$field" "$value" || return 1
  done
}

assert_head_matches_artifact() {
  local current_head
  current_head="$(git rev-parse HEAD 2>/dev/null)" || return 1
  [ "$current_head" = "$HEAD_SHA" ] || {
    echo "scope decision head mismatch: artifact $HEAD_SHA, checkout $current_head" >&2
    return 1
  }
}

write_artifact_changed_files_z() {
  local out_file="$1"
  jq -j '.changed_files[] | ., "\u0000"' "$SCOPE_DECISION_FILE" >"$out_file"
}

write_git_changed_files_z() {
  local range="$1"
  local out_file="$2"
  git diff --name-only -z "$range" >"$out_file"
}

count_nul_entries() {
  local file="$1"
  tr -cd '\000' <"$file" | wc -c | tr -d ' '
}

validate_changed_files_match_range() {
  local range="$1"
  local actual_file
  local expected_file
  actual_file="$(mktemp)" || return 1
  expected_file="$(mktemp)" || {
    rm -f "$actual_file"
    return 1
  }
  write_artifact_changed_files_z "$actual_file" || {
    rm -f "$actual_file" "$expected_file"
    return 1
  }
  write_git_changed_files_z "$range" "$expected_file" || {
    rm -f "$actual_file" "$expected_file"
    return 1
  }
  cmp -s "$actual_file" "$expected_file" || {
    rm -f "$actual_file" "$expected_file"
    return 1
  }
  rm -f "$actual_file" "$expected_file"
}

language_hints_for_range() {
  local range="$1"
  git diff --name-only "$range" |
    sed -n 's/.*\.\([[:alnum:]_+-][[:alnum:]_+-]*\)$/\1/p' |
    tr '[:upper:]' '[:lower:]' |
    sort -u
}

validate_language_hints_match_range() {
  local range="$1"
  local actual_file
  local expected_file
  actual_file="$(mktemp)" || return 1
  expected_file="$(mktemp)" || {
    rm -f "$actual_file"
    return 1
  }
  jq -r '.language_hints[]' "$SCOPE_DECISION_FILE" >"$actual_file" || {
    rm -f "$actual_file" "$expected_file"
    return 1
  }
  language_hints_for_range "$range" >"$expected_file" || {
    rm -f "$actual_file" "$expected_file"
    return 1
  }
  cmp -s "$actual_file" "$expected_file" || {
    rm -f "$actual_file" "$expected_file"
    return 1
  }
  rm -f "$actual_file" "$expected_file"
}

range_changed_file_count() {
  local range="$1"
  local file
  file="$(mktemp)" || return 1
  write_git_changed_files_z "$range" "$file" || {
    rm -f "$file"
    return 1
  }
  count_nul_entries "$file"
  rm -f "$file"
}

range_has_governed_path() {
  local range="$1"
  git diff --name-only "$range" | grep -E -- "$governed_path_pattern" >/dev/null
}

validate_derived_scope_facts() {
  assert_head_matches_artifact || return 1

  local mode
  local selected_range
  local full_range
  local candidate_narrow_range
  local is_followup_narrow
  local last_reviewed_sha
  local artifact_followup_usable
  local derived_followup_usable=false
  local mechanical_count_range
  local derived_changed_file_count
  local artifact_changed_file_count
  local artifact_mechanical_escalate
  local artifact_mechanical_reason
  local derived_file_count_escalates=false
  local derived_governance_escalates=false
  local derived_configured_path_escalates=false
  local derived_mechanical_escalates=false
  local escalation_reasons_file

  mode="$(jq -r '.mode' "$SCOPE_DECISION_FILE")" || return 1
  selected_range="$(jq -er '.selected_range' "$SCOPE_DECISION_FILE")" || return 1
  full_range="$(jq -er '.full_range' "$SCOPE_DECISION_FILE")" || return 1
  candidate_narrow_range="$(jq -er '.candidate_narrow_range' "$SCOPE_DECISION_FILE")" || return 1
  is_followup_narrow="$(jq -r '.is_followup_narrow' "$SCOPE_DECISION_FILE")" || return 1
  last_reviewed_sha="$(jq -r '.last_reviewed_sha // empty' "$SCOPE_DECISION_FILE")" || return 1

  git diff --name-only "$selected_range" >/dev/null || return 1
  git diff --name-only "$full_range" >/dev/null || return 1
  git diff --name-only "$candidate_narrow_range" >/dev/null || return 1
  validate_changed_files_match_range "$selected_range" || return 1
  validate_language_hints_match_range "$selected_range" || return 1

  mechanical_count_range="$selected_range"
  if [ "$mode" = "follow-up" ]; then
    case "$last_reviewed_sha" in
      [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f])
        if git cat-file -e "$last_reviewed_sha^{commit}" 2>/dev/null &&
          git merge-base --is-ancestor "$last_reviewed_sha" HEAD 2>/dev/null; then
          derived_followup_usable=true
          mechanical_count_range="$candidate_narrow_range"
        fi
        ;;
    esac
  fi

  artifact_followup_usable="$(jq -r '.mechanical_facts.followup_sha_usable' "$SCOPE_DECISION_FILE")" || return 1
  [ "$artifact_followup_usable" = "$derived_followup_usable" ] || return 1

  derived_changed_file_count="$(range_changed_file_count "$mechanical_count_range")" || return 1
  artifact_changed_file_count="$(jq -r '.mechanical_facts.changed_file_count' "$SCOPE_DECISION_FILE")" || return 1
  [ "$artifact_changed_file_count" = "$derived_changed_file_count" ] || return 1

  if [ "$mode" = "follow-up" ]; then
    if [ "$derived_followup_usable" = "false" ]; then
      derived_mechanical_escalates=true
    else
      if [ "$derived_changed_file_count" -gt 5 ]; then
        derived_file_count_escalates=true
        derived_mechanical_escalates=true
      fi
      if range_has_governed_path "$candidate_narrow_range"; then
        derived_governance_escalates=true
        derived_mechanical_escalates=true
      fi
      if [ -n "${BRANCH_REVIEW_FULL_REVIEW_PATH_PATTERN:-}" ] &&
        git diff --name-only "$candidate_narrow_range" |
          grep -E -- "$BRANCH_REVIEW_FULL_REVIEW_PATH_PATTERN" >/dev/null; then
        derived_configured_path_escalates=true
        derived_mechanical_escalates=true
      fi
    fi
  else
    derived_mechanical_escalates=true
  fi

  artifact_mechanical_escalate="$(jq -r '.mechanical_facts.mechanical_escalate_full' "$SCOPE_DECISION_FILE")" || return 1
  [ "$artifact_mechanical_escalate" = "$derived_mechanical_escalates" ] || return 1

  artifact_mechanical_reason="$(jq -r '.mechanical_facts.mechanical_escalation_reason' "$SCOPE_DECISION_FILE")" || return 1
  escalation_reasons_file="$(mktemp)" || return 1
  jq -r '.escalation_reasons[]' "$SCOPE_DECISION_FILE" >"$escalation_reasons_file" || {
    rm -f "$escalation_reasons_file"
    return 1
  }
  if [ "$derived_file_count_escalates" = "true" ]; then
    grep -Fx 'file-count' "$escalation_reasons_file" >/dev/null || {
      rm -f "$escalation_reasons_file"
      return 1
    }
    case "$artifact_mechanical_reason" in *file-count*) ;; *) rm -f "$escalation_reasons_file"; return 1 ;; esac
  fi
  if [ "$derived_governance_escalates" = "true" ]; then
    grep -Fx 'governance-path' "$escalation_reasons_file" >/dev/null || {
      rm -f "$escalation_reasons_file"
      return 1
    }
    case "$artifact_mechanical_reason" in *governance-path*) ;; *) rm -f "$escalation_reasons_file"; return 1 ;; esac
  fi
  if [ "$derived_configured_path_escalates" = "true" ]; then
    grep -Fx 'configured-path' "$escalation_reasons_file" >/dev/null || {
      rm -f "$escalation_reasons_file"
      return 1
    }
    case "$artifact_mechanical_reason" in *configured-path*) ;; *) rm -f "$escalation_reasons_file"; return 1 ;; esac
  fi
  if [ "$mode" = "follow-up" ] && [ "$derived_followup_usable" = "false" ]; then
    case "$artifact_mechanical_reason" in *last-reviewed-unusable*) ;; *) rm -f "$escalation_reasons_file"; return 1 ;; esac
  fi
  if [ "$mode" != "follow-up" ]; then
    grep -Fx 'not-followup' "$escalation_reasons_file" >/dev/null || {
      rm -f "$escalation_reasons_file"
      return 1
    }
    case "$artifact_mechanical_reason" in *not-followup*) ;; *) rm -f "$escalation_reasons_file"; return 1 ;; esac
  fi
  if [ "$derived_mechanical_escalates" = "false" ] && [ -n "$artifact_mechanical_reason" ]; then
    rm -f "$escalation_reasons_file"
    return 1
  fi
  rm -f "$escalation_reasons_file"

  if [ "$is_followup_narrow" = "true" ]; then
    [ "$derived_followup_usable" = "true" ] || return 1
    [ "$derived_file_count_escalates" = "false" ] || return 1
    [ "$derived_governance_escalates" = "false" ] || return 1
  fi
}

prepare_scope_decision_write() {
  validate_head_sha
  local file
  file="$(expected_scope_decision_path)"
  validate_direct_child_path "scope decision" "$file" "-scope-decision.json"
  prepare_write_target "scope decision" "$file"
  printf '%s\n' "$file"
}

validate_scope_decision() {
  validate_head_sha
  require_env SCOPE_DECISION_FILE
  local expected
  expected="$(expected_scope_decision_path)"
  validate_direct_child_path "scope decision" "$SCOPE_DECISION_FILE" "-scope-decision.json"
  [ "$SCOPE_DECISION_FILE" = "$expected" ] || {
    echo "scope decision path mismatch: $SCOPE_DECISION_FILE" >&2
    exit 1
  }
  assert_readable_file "scope decision" "$SCOPE_DECISION_FILE"
  require_jq
  jq -e -s --arg head_sha "$HEAD_SHA" --arg prior_branch_findings "${PRIOR_BRANCH_FINDINGS:-}" --argjson max_narrow_changed_files 5 '
    def exactly($keys): (keys_unsorted | sort) == ($keys | sort);
    def one_of($values; $value): ($values | index($value)) != null;
    def sha: type == "string" and test("^[0-9a-f]{40}$");
    def review_range:
      type == "string"
      and length > 0;
    def repo_relative_path:
	      type == "string"
	      and length > 0
	      and (startswith("/") | not)
	      and (explode | all(. >= 32))
	      and (split("/") | all(. != "" and . != "." and . != ".."));
    def direct_ephemeral_path:
      type == "string"
      and test("^\\.ephemeral/[^/]+$")
      and (contains("..") | not);
    def language_hint:
      type == "string" and test("^[a-z0-9_+-]+$");
    def valid_prior_context:
      type == "object"
      and exactly(["kind", "path"])
      and one_of(["none", "branch-findings"]; .kind)
      and (if .kind == "none" then .path == null else (.path | direct_ephemeral_path) end);
    def valid_mechanical_facts:
      type == "object"
      and exactly([
        "changed_file_count",
        "followup_sha_usable",
        "mechanical_escalate_full",
        "mechanical_escalation_reason"
      ])
      and (.changed_file_count | type == "number" and . == floor and . >= 0)
      and (.followup_sha_usable | type == "boolean")
      and (.mechanical_escalate_full | type == "boolean")
      and (.mechanical_escalation_reason | type == "string");
    def valid_semantic_decision:
      type == "object"
      and exactly(["checked", "ambiguous", "notes"])
      and (.checked | type == "boolean")
      and (.ambiguous | type == "boolean")
      and (.notes | type == "string");
    def valid_scope_invariants:
      (if .mode == "initial" then
        .is_followup_narrow == false
        and .last_reviewed_sha == null
        and .selected_range == .full_range
        and .candidate_narrow_range == .full_range
        and .prior_context.kind == "none"
      else
        (.last_reviewed_sha | sha)
        and .prior_context.kind == "branch-findings"
        and ($prior_branch_findings | direct_ephemeral_path)
        and .prior_context.path == $prior_branch_findings
        and (if .mechanical_facts.followup_sha_usable then
          .candidate_narrow_range == (.last_reviewed_sha + "..HEAD")
        else
          .candidate_narrow_range == .full_range
          and .mechanical_facts.mechanical_escalate_full == true
        end)
      end)
      and .semantic_decision.checked == true
      and .semantic_decision.ambiguous == false
      and (if .is_followup_narrow then
        .mode == "follow-up"
        and .selected_range == .candidate_narrow_range
        and .selected_range != .full_range
        and .mechanical_facts.followup_sha_usable == true
        and .mechanical_facts.mechanical_escalate_full == false
        and .mechanical_facts.changed_file_count <= $max_narrow_changed_files
        and (.escalation_reasons | length == 0)
      else
        .selected_range == .full_range
        and (if .mode == "follow-up" then (.escalation_reasons | length > 0) else true end)
      end)
      and (if .mechanical_facts.mechanical_escalate_full then
        .is_followup_narrow == false
        and .selected_range == .full_range
        and (.escalation_reasons | length > 0)
      else true end);
    length == 1
    and (.[0] |
    type == "object"
    and exactly([
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
    ])
    and .schema == "branch-review/scope-decision/v1"
    and .surface == "branch-review"
    and one_of(["initial", "follow-up"]; .mode)
    and (.selected_range | review_range)
    and (.full_range | review_range)
    and (.candidate_narrow_range | review_range)
    and (.is_followup_narrow | type == "boolean")
    and (.selection_reason | type == "string" and length > 0)
    and (.escalation_reasons | type == "array" and all(.[]; type == "string" and length > 0))
    and .head_sha == $head_sha
    and (.changed_files | type == "array" and all(.[]; repo_relative_path))
    and (.language_hints | type == "array" and all(.[]; language_hint))
    and (.prior_context | valid_prior_context)
    and (.mechanical_facts | valid_mechanical_facts)
    and (.semantic_decision | valid_semantic_decision)
    and valid_scope_invariants)
  ' "$SCOPE_DECISION_FILE" >/dev/null || {
    echo "scope decision schema mismatch: $SCOPE_DECISION_FILE" >&2
    exit 1
  }
  validate_scope_decision_ranges || {
    echo "scope decision schema mismatch: $SCOPE_DECISION_FILE" >&2
    exit 1
  }
  validate_derived_scope_facts || {
    echo "scope decision schema mismatch: $SCOPE_DECISION_FILE" >&2
    exit 1
  }
}

require_repo_root
case "$command_name" in
  prepare-scope-decision-write)
    prepare_scope_decision_write
    ;;
  validate-scope-decision)
    validate_scope_decision
    ;;
  *)
    echo "usage: scope-decision-artifacts.sh prepare-scope-decision-write|validate-scope-decision" >&2
    exit 1
    ;;
esac
