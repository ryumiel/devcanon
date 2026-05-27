#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-}"

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "$name is required" >&2
    exit 1
  fi
}

require_jq() {
  command -v jq >/dev/null 2>&1 || {
    echo "jq is required to validate pr-review normalized artifacts" >&2
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
    echo "prior-thread-artifacts.sh must run from the repository root" >&2
    exit 1
  }
}

validate_sha() {
  local label="$1"
  local value="$2"
  case "$value" in
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
    *)
      echo "$label must be a 40-character lowercase hex SHA" >&2
      exit 1
      ;;
  esac
}

validate_head_sha() {
  require_env HEAD_SHA
  validate_sha HEAD_SHA "$HEAD_SHA"
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

expected_prior_threads_path() {
  printf '.ephemeral/%s-%s-prior-threads.json\n' "$(branch_slug)" "$HEAD_SHA"
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

prepare_prior_threads_write() {
  validate_head_sha
  local file
  file="$(expected_prior_threads_path)"
  validate_direct_child_path "prior threads" "$file" "-prior-threads.json"
  prepare_write_target "prior threads" "$file"
  printf '%s\n' "$file"
}

prepare_scope_decision_write() {
  validate_head_sha
  local file
  file="$(expected_scope_decision_path)"
  validate_direct_child_path "scope decision" "$file" "-scope-decision.json"
  prepare_write_target "scope decision" "$file"
  printf '%s\n' "$file"
}

validate_prior_threads() {
  validate_head_sha
  require_env PRIOR_THREADS_FILE
  local expected
  expected="$(expected_prior_threads_path)"
  validate_direct_child_path "prior threads" "$PRIOR_THREADS_FILE" "-prior-threads.json"
  [ "$PRIOR_THREADS_FILE" = "$expected" ] || {
    echo "prior threads path mismatch: $PRIOR_THREADS_FILE" >&2
    exit 1
  }
  assert_readable_file "prior threads" "$PRIOR_THREADS_FILE"
  require_jq
  jq -e -s --arg head_sha "$HEAD_SHA" '
    def exactly($keys): (keys_unsorted | sort) == ($keys | sort);
    def one_of($values; $value): ($values | index($value)) != null;
    def has_keys($required): . as $object | all($required[]; . as $key | $object | has($key));
    def only_keys($allowed): all(keys_unsorted[]; . as $key | ($allowed | index($key)) != null);
    def iso8601_timestamp:
      type == "string"
      and test("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\\.[0-9]+)?Z$")
      and (try ((sub("\\.[0-9]+Z$"; "Z")) as $normalized | ($normalized | fromdateiso8601 | todateiso8601) == $normalized) catch false);
    def positive_integer: type == "number" and . == floor and . >= 1;
    def repo_relative_path:
      type == "string"
      and length > 0
      and (startswith("/") | not)
      and (split("/") | all(. != "" and . != "." and . != ".."));
    def nullable_positive_integer: . == null or positive_integer;
    def valid_classification:
      one_of([
        "actionable",
        "resolved",
        "outdated",
        "bot-boilerplate",
        "review-request",
        "reaction-only",
        "conversation",
        "unknown"
      ]; .);
    def valid_model_context:
      one_of(["include", "summarize", "drop"]; .);
    def valid_comment:
      type == "object"
      and has_keys([
        "author",
        "created_at",
        "updated_at",
        "body",
        "is_bot"
      ])
      and only_keys([
        "author",
        "author_association",
        "created_at",
        "updated_at",
        "body",
        "is_bot",
        "minimized_reason"
      ])
      and (.author | type == "string" and length > 0)
      and ((has("author_association") | not) or .author_association == null or (.author_association | type == "string" and length > 0))
      and (.created_at | iso8601_timestamp)
      and (.updated_at | iso8601_timestamp)
      and (.body | type == "string")
      and (.is_bot | type == "boolean")
      and ((has("minimized_reason") | not) or .minimized_reason == null or (.minimized_reason | type == "string"));
    def valid_thread:
      type == "object"
      and exactly([
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
      ])
      and (.thread_id | type == "string" and length > 0)
      and (.is_resolved | type == "boolean")
      and (.is_outdated | type == "boolean")
      and (.path | repo_relative_path)
      and (.line | nullable_positive_integer)
      and (.original_line | nullable_positive_integer)
      and (.start_line | nullable_positive_integer)
      and (.original_start_line | nullable_positive_integer)
      and (.classification | valid_classification)
      and (.model_context | valid_model_context)
      and (if .model_context == "include" then .classification == "actionable" and (.is_resolved | not) and (.is_outdated | not) else true end)
      and (if .classification == "actionable" and (.is_resolved | not) and (.is_outdated | not) then .model_context == "include" else true end)
      and (.staleness_reason | type == "string")
      and (.comments | type == "array")
      and (if .model_context == "include" then (.comments | length > 0) else true end)
      and (.comments | all(.[]; valid_comment))
      and (.summary | type == "string");
    def valid_dropped:
      type == "object"
      and exactly(["thread_id", "classification", "reason"])
      and (.thread_id | type == "string" and length > 0)
      and (.classification | valid_classification)
      and .classification != "actionable"
      and (.reason | type == "string" and length > 0);
    length == 1
    and (.[0] |
    type == "object"
    and exactly(["schema", "provider", "pr_number", "head_sha", "threads", "dropped"])
    and .schema == "pr-review/prior-threads/v1"
    and .provider == "github"
    and (.pr_number | positive_integer)
    and .head_sha == $head_sha
    and (.threads | type == "array")
    and (.threads | all(.[]; valid_thread))
    and (.dropped | type == "array")
    and (.dropped | all(.[]; valid_dropped)))
  ' "$PRIOR_THREADS_FILE" >/dev/null || {
    echo "prior threads schema mismatch: $PRIOR_THREADS_FILE" >&2
    exit 1
  }
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
  local expected_prior_threads
  expected_prior_threads="$(expected_prior_threads_path)"
  jq -e -s --arg head_sha "$HEAD_SHA" --arg expected_prior_threads "$expected_prior_threads" '
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
      and one_of(["none", "github-prior-threads"]; .kind)
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
      .mechanical_facts.changed_file_count == (.changed_files | length)
      and
      (if .mode == "initial" then
        .is_followup_narrow == false
        and .last_reviewed_sha == null
        and .selected_range == .full_range
        and .candidate_narrow_range == .full_range
        and .prior_context.kind == "none"
        and .prior_context.path == null
      else
        (.last_reviewed_sha | sha)
        and .prior_context.kind == "github-prior-threads"
        and .prior_context.path == $expected_prior_threads
        and .candidate_narrow_range == (.last_reviewed_sha + "..HEAD")
      end)
      and .semantic_decision.checked == true
      and .semantic_decision.ambiguous == false
      and (if .is_followup_narrow then
        .mode == "follow-up"
        and .selected_range == .candidate_narrow_range
        and .selected_range != .full_range
        and .mechanical_facts.followup_sha_usable == true
        and .mechanical_facts.mechanical_escalate_full == false
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
    and .schema == "pr-review/scope-decision/v1"
    and .surface == "pr-review"
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
}

require_repo_root
case "$command_name" in
  prepare-prior-threads-write)
    prepare_prior_threads_write
    ;;
  validate-prior-threads)
    validate_prior_threads
    ;;
  prepare-scope-decision-write)
    prepare_scope_decision_write
    ;;
  validate-scope-decision)
    validate_scope_decision
    ;;
  *)
    echo "usage: prior-thread-artifacts.sh prepare-prior-threads-write|validate-prior-threads|prepare-scope-decision-write|validate-scope-decision" >&2
    exit 1
    ;;
esac
