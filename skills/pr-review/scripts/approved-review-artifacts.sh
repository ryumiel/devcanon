#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-}"
governed_path_pattern='^(docs/(adr|arch|product-requirements|specs|guidelines)/|MAP\.md$|AGENTS\.md$|CONTRIBUTING\.md$)'
max_narrow_changed_files="5"

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "$name is required" >&2
    exit 1
  fi
}

require_jq() {
  command -v jq >/dev/null 2>&1 || {
    echo "jq is required to validate pr-review/approved-review/v1" >&2
    exit 1
  }
}

sha256_file() {
  local path="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$path" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$path" | awk '{print $1}'
  else
    echo "shasum or sha256sum is required" >&2
    exit 1
  fi
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
    echo "approved-review-artifacts.sh must run from the repository root" >&2
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

validate_pr_number() {
  require_env PR_NUMBER
  case "$PR_NUMBER" in
    0 | *[!0-9]*)
      echo "PR_NUMBER must be a positive integer" >&2
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

expected_findings_path_for() {
  local review_head_sha="$1"
  printf '.ephemeral/%s-%s-findings.json\n' "$(branch_slug)" "$review_head_sha"
}

expected_payload_path_for() {
  local review_head_sha="$1"
  printf '.ephemeral/%s-%s-review-payload.json\n' "$(branch_slug)" "$review_head_sha"
}

expected_approved_path_for() {
  local review_head_sha="$1"
  printf '.ephemeral/%s-%s-approved-review.json\n' "$(branch_slug)" "$review_head_sha"
}

expected_validated_payload_path_for() {
  local review_head_sha="$1"
  printf '.ephemeral/pr-%s-%s-validated-review-payload.json\n' "$PR_NUMBER" "$review_head_sha"
}

expected_post_intent_path_for() {
  local review_head_sha="$1"
  printf '.ephemeral/pr-%s-%s-thread-action-post-intent.json\n' "$PR_NUMBER" "$review_head_sha"
}

expected_execution_receipt_path_for() {
  local review_head_sha="$1"
  printf '.ephemeral/pr-%s-%s-thread-action-execution.json\n' "$PR_NUMBER" "$review_head_sha"
}

expected_thread_actions_path_for() {
  local review_head_sha="$1"
  printf '.ephemeral/%s-%s-thread-actions.json\n' "$(branch_slug)" "$review_head_sha"
}

expected_scope_decision_path_for() {
  local review_head_sha="$1"
  printf '.ephemeral/%s-%s-scope-decision.json\n' "$(branch_slug)" "$review_head_sha"
}

validate_direct_child_path() {
  local label="$1"
  local file="$2"
  local suffix="${3:-}"
  case "$file" in
    .ephemeral/*/*)
      echo "nested $label path rejected: $file" >&2
      exit 1
      ;;
    .ephemeral/*) ;;
    *)
      echo "$label path validation failed: $file" >&2
      exit 1
      ;;
  esac
  [ "${file#*..}" = "$file" ] || {
    echo "path traversal: $file" >&2
    exit 1
  }
  if [ -n "$suffix" ]; then
    case "$file" in
      *"$suffix") ;;
      *)
        echo "$label path validation failed: $file" >&2
        exit 1
        ;;
    esac
  fi
}

validate_findings_path_shape() {
  local findings_file="$1"
  local review_head_sha="$2"
  local expected
  validate_direct_child_path "findings" "$findings_file" "-findings.json"
  expected="$(expected_findings_path_for "$review_head_sha")"
  [ "$findings_file" = "$expected" ] || {
    echo "findings path mismatch: $findings_file" >&2
    exit 1
  }
}

validate_review_body_path_shape() {
  local review_body_file="$1"
  local review_head_sha="$2"
  local expected=".ephemeral/pr-${PR_NUMBER}-${review_head_sha}-review-body.md"
  validate_direct_child_path "review body" "$review_body_file"
  [ "$review_body_file" = "$expected" ] || {
    echo "review body path mismatch: $review_body_file" >&2
    exit 1
  }
}

validate_payload_path_shape() {
  local payload_file="$1"
  local review_head_sha="$2"
  local expected
  validate_direct_child_path "review payload" "$payload_file" "-review-payload.json"
  expected="$(expected_payload_path_for "$review_head_sha")"
  [ "$payload_file" = "$expected" ] || {
    echo "review payload path mismatch: $payload_file" >&2
    exit 1
  }
}

validate_approved_path_shape() {
  validate_direct_child_path "approved review" "$1" "-approved-review.json"
}

validate_approved_path_identity() {
  local approved_review_file="$1"
  local review_head_sha="$2"
  local expected
  expected="$(expected_approved_path_for "$review_head_sha")"
  [ "$approved_review_file" = "$expected" ] || {
    echo "approved review path mismatch: $approved_review_file" >&2
    exit 1
  }
}

validate_validated_payload_path_shape() {
  local validated_payload_file="$1"
  local review_head_sha="$2"
  local expected
  validate_direct_child_path "validated review payload" "$validated_payload_file" "-validated-review-payload.json"
  expected="$(expected_validated_payload_path_for "$review_head_sha")"
  [ "$validated_payload_file" = "$expected" ] || {
    echo "validated review payload path mismatch: $validated_payload_file" >&2
    exit 1
  }
}

validate_post_intent_path_shape() {
  local post_intent_file="$1"
  local review_head_sha="$2"
  local expected
  validate_direct_child_path "post intent" "$post_intent_file" "-thread-action-post-intent.json"
  expected="$(expected_post_intent_path_for "$review_head_sha")"
  [ "$post_intent_file" = "$expected" ] || {
    echo "post intent path mismatch: $post_intent_file" >&2
    exit 1
  }
}

validate_execution_receipt_path_shape() {
  local receipt_file="$1"
  local review_head_sha="$2"
  local expected
  validate_direct_child_path "execution receipt" "$receipt_file" "-thread-action-execution.json"
  expected="$(expected_execution_receipt_path_for "$review_head_sha")"
  [ "$receipt_file" = "$expected" ] || {
    echo "execution receipt path mismatch: $receipt_file" >&2
    exit 1
  }
}

validate_scope_decision_path_shape() {
  local scope_decision_file="$1"
  local review_head_sha="$2"
  local expected
  validate_direct_child_path "scope decision" "$scope_decision_file" "-scope-decision.json"
  expected="$(expected_scope_decision_path_for "$review_head_sha")"
  [ "$scope_decision_file" = "$expected" ] || {
    echo "scope decision path mismatch: $scope_decision_file" >&2
    exit 1
  }
}

validate_thread_actions_path_shape() {
  local thread_actions_file="$1"
  local review_head_sha="$2"
  local expected
  validate_direct_child_path "thread actions" "$thread_actions_file" "-thread-actions.json"
  expected="$(expected_thread_actions_path_for "$review_head_sha")"
  [ "$thread_actions_file" = "$expected" ] || {
    echo "thread actions path mismatch: $thread_actions_file" >&2
    exit 1
  }
}

validate_prior_threads_path_shape() {
  local prior_threads_file="$1"
  local review_head_sha="$2"
  local expected
  validate_direct_child_path "prior threads" "$prior_threads_file" "-prior-threads.json"
  expected=".ephemeral/$(branch_slug)-${review_head_sha}-prior-threads.json"
  [ "$prior_threads_file" = "$expected" ] || {
    echo "prior threads path mismatch: $prior_threads_file" >&2
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

validate_review_event() {
  case "$REVIEW_EVENT" in
    APPROVE | REQUEST_CHANGES | COMMENT) ;;
    *)
      echo "REVIEW_EVENT must be APPROVE, REQUEST_CHANGES, or COMMENT" >&2
      exit 1
      ;;
  esac
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
      [ -x "$PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT" ] || {
      echo "play-validate-review-artifacts validator missing" >&2
      exit 1
    }
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

  echo "play-validate-review-artifacts validator missing" >&2
  exit 1
}

resolve_prior_thread_artifacts_helper() {
  local helper
  if [ -n "${PRIOR_THREAD_ARTIFACTS_HELPER:-}" ]; then
    helper="$PRIOR_THREAD_ARTIFACTS_HELPER"
  else
    helper="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/prior-thread-artifacts.sh"
  fi
  [ -f "$helper" ] && [ -x "$helper" ] || {
    echo "pr-review prior-thread-artifacts helper missing" >&2
    exit 1
  }
  printf '%s\n' "$helper"
}

validate_thread_actions_binding() {
  local thread_actions_file="$1"
  local prior_threads_file="$2"
  local review_head_sha="$3"
  local helper

  require_env REPOSITORY
  validate_pr_number
  validate_thread_actions_path_shape "$thread_actions_file" "$review_head_sha"
  validate_prior_threads_path_shape "$prior_threads_file" "$review_head_sha"
  assert_readable_file "thread actions file" "$thread_actions_file"
  assert_readable_file "prior threads file" "$prior_threads_file"
  helper="$(resolve_prior_thread_artifacts_helper)"
  HEAD_SHA="$review_head_sha" \
  THREAD_ACTIONS_FILE="$thread_actions_file" \
  PRIOR_THREADS_FILE="$prior_threads_file" \
  REPOSITORY="$REPOSITORY" \
  PR_NUMBER="$PR_NUMBER" \
    bash "$helper" validate-thread-actions
}

scope_decision_file_for() {
  local review_head_sha="$1"
  local expected
  expected="$(expected_scope_decision_path_for "$review_head_sha")"
  if [ -n "${SCOPE_DECISION_FILE:-}" ]; then
    [ "$SCOPE_DECISION_FILE" = "$expected" ] || {
      echo "scope decision path mismatch: $SCOPE_DECISION_FILE" >&2
      exit 1
    }
  fi
  printf '%s\n' "$expected"
}

build_support_scope_args() {
  local review_head_sha="$1"
  local scope_decision_file="$2"
  local prior_context
  local prior_kind
  local prior_path
  local provider_scope_evidence_file

  prior_context="$(jq -er '
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
    elif (.prior_context.kind == "github-prior-threads" or .prior_context.kind == "branch-findings") then
      if (.prior_context.path | type) == "string" and .prior_context.path != "" then
        [.prior_context.kind, .prior_context.path] | @tsv
      else
        empty
      end
    else
      empty
    end
  ' "$scope_decision_file")" || {
    echo "scope decision prior_context is missing or malformed" >&2
    exit 1
  }
  IFS=$'\t' read -r prior_kind prior_path <<EOF
$prior_context
EOF

  provider_scope_evidence_file="$(jq -er '
    if (.artifacts | type) != "object" then
      empty
    elif (.artifacts.provider_scope_evidence_file | type) != "string" then
      empty
    elif .artifacts.provider_scope_evidence_file == "" then
      empty
    else
      .artifacts.provider_scope_evidence_file
    end
  ' "$scope_decision_file")" || {
    echo "scope decision artifacts are missing or malformed" >&2
    exit 1
  }

  if [ -n "${PRIOR_THREADS_FILE:-}" ]; then
    [ "$prior_kind" = "github-prior-threads" ] &&
      [ "$PRIOR_THREADS_FILE" = "$prior_path" ] || {
      echo "prior threads context mismatch: $PRIOR_THREADS_FILE" >&2
      exit 1
    }
  fi

  validator_scope_args=(
    --surface pr-review
    --head-sha "$review_head_sha"
    --base-ref "$BASE_REF"
    --scope-decision-file "$scope_decision_file"
    --provider-scope-evidence-file "$provider_scope_evidence_file"
    --expected-schema pr-review/scope-decision/v1
    --expected-prior-context-kind "$prior_kind"
    --expected-prior-context-path "$prior_path"
    --governed-path-pattern "$governed_path_pattern"
    --max-narrow-changed-files "$max_narrow_changed_files"
  )
}

compare_payload_with_support() {
  local review_head_sha="$1"
  local scope_decision_file="$2"
  local findings_file="$3"
  local review_body_file="$4"
  local payload_file="$5"
  local review_event="$6"
  local validator

  require_env BASE_REF
  validator="$(resolve_validator)"
  validator_scope_args=()
  build_support_scope_args "$review_head_sha" "$scope_decision_file"

  bash "$validator" compare-approved-payload \
    "${validator_scope_args[@]}" \
    --findings-file "$findings_file" \
    --review-body-file "$review_body_file" \
    --review-payload-file "$payload_file" \
    --review-event "$review_event"
}

assert_findings_envelope() {
  local file="$1"
  require_jq
  jq -e '
    def one_of($values; $value): ($values | index($value)) != null;
    def positive_integer:
      type == "number" and . == floor and . >= 1;
    def repo_relative_path:
      type == "string"
      and length > 0
      and (startswith("/") | not)
      and (split("/") | all(. != "" and . != "." and . != ".."));
    def valid_critic:
      if .severity == "Nit" then
        .critic == null
      else
        .critic == null or one_of(["VALID", "INVALID", "DOWNGRADE"]; .critic)
      end;
    def valid_finding:
      type == "object"
      and has("path")
      and has("line")
      and has("start_line")
      and has("severity")
      and has("category")
      and has("critic")
      and has("anchor")
      and has("why")
      and has("recommendation")
      and has("body")
      and (.path | repo_relative_path)
      and (.line | positive_integer)
      and (.start_line == null or (.start_line | positive_integer))
      and one_of(["Blocking", "Nit"]; .severity)
      and one_of(["Logic", "Safety", "Architecture", "Tests", "Maintainability", "Documentation", "Contracts"]; .category)
      and valid_critic
      and one_of(["natural", "missing-file", "out-of-diff"]; .anchor)
      and (.why | type == "string")
      and (.recommendation | type == "string")
      and (.body | type == "string");
    .schema == "play-review/findings/v2"
    and (.findings | type == "array")
    and (.carry_forward | type == "array")
    and ((.findings + .carry_forward) | all(.[]; valid_finding))
  ' "$file" >/dev/null || {
    echo "findings schema mismatch or envelope shape mismatch: $file" >&2
    exit 1
  }
}

assert_single_json_object() {
  local label="$1"
  local file="$2"
  require_jq
  jq -e -s 'length == 1 and (.[0] | type == "object")' "$file" >/dev/null || {
    echo "$label must contain exactly one JSON object: $file" >&2
    exit 1
  }
}

assert_payload_shape() {
  local file="$1"
  local review_head_sha="$2"
  require_jq
  jq -e --arg review_head_sha "$review_head_sha" '
    def one_of($values; $value): ($values | index($value)) != null;
    def positive_integer:
      type == "number" and . == floor and . >= 1;
    def repo_relative_path:
      type == "string"
      and length > 0
      and (startswith("/") | not)
      and (split("/") | all(. != "" and . != "." and . != ".."));
    def valid_comment:
      type == "object"
      and ((keys - ["path", "line", "start_line", "start_side", "side", "body"]) | length == 0)
      and (.path | repo_relative_path)
      and (.line | positive_integer)
      and ((has("start_line") | not) or (.start_line | positive_integer))
      and (if has("start_line") then .start_side == "RIGHT" else has("start_side") | not end)
      and one_of(["LEFT", "RIGHT"]; .side)
      and (.body | type == "string");
    type == "object"
    and ((keys - ["commit_id", "event", "body", "comments"]) | length == 0)
    and .commit_id == $review_head_sha
    and one_of(["APPROVE", "REQUEST_CHANGES", "COMMENT"]; .event)
    and (.body | type == "string")
    and (.comments | type == "array")
    and (.comments | all(.[]; valid_comment))
  ' "$file" >/dev/null || {
    echo "payload shape mismatch: $file" >&2
    exit 1
  }
}

assert_approved_schema() {
  local file="$1"
  require_jq
  jq -e '
    def hex_sha256: type == "string" and test("^[0-9a-f]{64}$");
    def head_sha: type == "string" and test("^[0-9a-f]{40}$");
    type == "object"
    and .schema == "pr-review/approved-review/v1"
    and (.repository | type == "string")
    and (.pr_number | type == "number" and . == floor and . >= 1)
    and (.review_head_sha | head_sha)
    and (.findings_file | type == "string")
    and (.review_body_file | type == "string")
    and (.review_payload_file | type == "string")
    and (.scope_decision_file | type == "string")
    and (.thread_actions_file | type == "string")
    and (.findings_sha256 | hex_sha256)
    and (.review_body_sha256 | hex_sha256)
    and (.review_payload_sha256 | hex_sha256)
    and (.scope_decision_sha256 | hex_sha256)
    and (.thread_actions_sha256 | hex_sha256)
    and (.thread_actions | type == "array")
    and (.payload | type == "object")
  ' "$file" >/dev/null || {
    echo "approved review schema mismatch: $file" >&2
    exit 1
  }
}

prepare_review_payload_write() {
  require_repo_root
  validate_head_sha
  if [ -z "${REVIEW_PAYLOAD_FILE:-}" ]; then
    REVIEW_PAYLOAD_FILE="$(expected_payload_path_for "$HEAD_SHA")"
  fi
  validate_payload_path_shape "$REVIEW_PAYLOAD_FILE" "$HEAD_SHA"
  prepare_write_target "review payload" "$REVIEW_PAYLOAD_FILE"
  printf '%s\n' "$REVIEW_PAYLOAD_FILE"
}

materialize_validated_review_payload() {
  local validated_payload_file
  local tmp_file
  require_repo_root
  validate_head_sha
  validate_pr_number
  validated_payload_file="$(expected_validated_payload_path_for "$HEAD_SHA")"
  validate_validated_payload_path_shape "$validated_payload_file" "$HEAD_SHA"
  [ ! -L .ephemeral ] || {
    echo ".ephemeral must be a directory, not a symlink" >&2
    exit 1
  }
  mkdir -p .ephemeral
  [ ! -L "$validated_payload_file" ] || {
    echo "validated review payload path must not be a symlink: $validated_payload_file" >&2
    exit 1
  }
  [ ! -e "$validated_payload_file" ] || {
    echo "validated review payload path already exists: $validated_payload_file" >&2
    exit 1
  }
  tmp_file="$(mktemp ".ephemeral/.validated-review-payload-${HEAD_SHA}.XXXXXX")"
  trap 'rm -f "${tmp_file:-}"' EXIT
  validate_approved_review > "$tmp_file"
  mv "$tmp_file" "$validated_payload_file"
  tmp_file=""
  printf '%s\n' "$validated_payload_file"
}

validate_provider_actor_id() {
  require_env PROVIDER_ACTOR_ID
  case "$PROVIDER_ACTOR_ID" in
    0 | *[!0-9]*)
      echo "PROVIDER_ACTOR_ID must be a positive safe integer" >&2
      exit 1
      ;;
  esac
  jq -en --arg value "$PROVIDER_ACTOR_ID" \
    '$value | tonumber | . >= 1 and . <= 9007199254740991' >/dev/null || {
    echo "PROVIDER_ACTOR_ID must be a positive safe integer" >&2
    exit 1
  }
}

validate_post_intent_created_at() {
  require_env POST_INTENT_CREATED_AT
  [[ "$POST_INTENT_CREATED_AT" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || {
    echo "POST_INTENT_CREATED_AT must be a canonical UTC timestamp" >&2
    exit 1
  }
}

validate_utc_second() {
  local name="$1"
  local value="$2"
  [[ "$value" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || {
    echo "$name must be a canonical UTC timestamp" >&2
    exit 1
  }
}

validate_positive_safe_integer() {
  local name="$1"
  local value="$2"
  case "$value" in
    0 | *[!0-9]*)
      echo "$name must be a positive safe integer" >&2
      exit 1
      ;;
  esac
  jq -en --arg value "$value" \
    '$value | tonumber | . >= 1 and . <= 9007199254740991' >/dev/null || {
    echo "$name must be a positive safe integer" >&2
    exit 1
  }
}

validate_execution_receipt_inputs() {
  require_env POST_OUTCOME
  require_env PROVIDER_REVIEW_ID
  require_env PROVIDER_REVIEW_SUBMITTED_AT
  require_env EXECUTION_RECEIPT_UPDATED_AT
  case "$POST_OUTCOME" in
    post-response | provider-reconciliation) ;;
    *)
      echo "POST_OUTCOME must be post-response or provider-reconciliation" >&2
      exit 1
      ;;
  esac
  validate_positive_safe_integer PROVIDER_REVIEW_ID "$PROVIDER_REVIEW_ID"
  validate_utc_second PROVIDER_REVIEW_SUBMITTED_AT "$PROVIDER_REVIEW_SUBMITTED_AT"
  validate_utc_second EXECUTION_RECEIPT_UPDATED_AT "$EXECUTION_RECEIPT_UPDATED_AT"
}

validate_advance_execution_receipt_inputs() {
  require_env EXECUTION_RECEIPT_FILE
  require_env THREAD_ID
  require_env DISPOSITION
  require_env EXECUTION_RECEIPT_UPDATED_AT
  case "$DISPOSITION" in
    succeeded | already-resolved | failed) ;;
    *)
      echo "DISPOSITION must be succeeded, already-resolved, or failed" >&2
      exit 1
      ;;
  esac
  [ -n "${THREAD_ID//[[:space:]]/}" ] || {
    echo "THREAD_ID must be nonblank" >&2
    exit 1
  }
  validate_utc_second EXECUTION_RECEIPT_UPDATED_AT "$EXECUTION_RECEIPT_UPDATED_AT"
  if [ "$DISPOSITION" = "failed" ]; then
    require_env ACTION_FAILURE_REASON
    [ -n "${ACTION_FAILURE_REASON//[[:space:]]/}" ] || {
      echo "ACTION_FAILURE_REASON must be nonblank when DISPOSITION is failed" >&2
      exit 1
    }
  elif [ -n "${ACTION_FAILURE_REASON:-}" ]; then
    echo "ACTION_FAILURE_REASON must be absent or empty unless DISPOSITION is failed" >&2
    exit 1
  fi
}

validate_post_intent_chain() (
  local validated_payload_file
  local approved_review_sha256
  local validated_payload_sha256
  local thread_actions_sha256
  local unmarked_payload_file
  local fingerprint_tuple
  local fingerprint

  require_repo_root
  require_jq
  validate_head_sha
  validate_pr_number
  require_env REPOSITORY
  require_env APPROVED_REVIEW_FILE
  require_env POST_INTENT_FILE
  require_env BASE_REF
  validate_approved_path_shape "$APPROVED_REVIEW_FILE"
  validate_post_intent_path_shape "$POST_INTENT_FILE" "$HEAD_SHA"
  assert_readable_file "post intent file" "$POST_INTENT_FILE"
  unmarked_payload_file="$(mktemp ".ephemeral/.receipt-unmarked-payload-${HEAD_SHA}.XXXXXX")"
  trap 'rm -f "${unmarked_payload_file:-}"' EXIT
  validate_approved_review > "$unmarked_payload_file"
  assert_single_json_object "approved review payload" "$unmarked_payload_file"
  assert_payload_shape "$unmarked_payload_file" "$HEAD_SHA"

  jq -e \
    --arg repository "$REPOSITORY" \
    --argjson pr_number "$PR_NUMBER" \
    --arg review_head_sha "$HEAD_SHA" \
    --arg approved_review_file "$APPROVED_REVIEW_FILE" \
    '
      def hex_sha256: type == "string" and test("^[0-9a-f]{64}$");
      def utc_second: type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$");
      (keys | sort) == ["approved_review_file", "approved_review_sha256", "created_at", "final_body", "pr_number", "provider_actor_id", "repository", "request_fingerprint_sha256", "review_event", "review_head_sha", "schema", "thread_actions_sha256", "validated_review_payload_file", "validated_review_payload_sha256"]
      and .schema == "pr-review/thread-action-post-intent/v1"
      and .repository == $repository
      and .pr_number == $pr_number
      and .review_head_sha == $review_head_sha
      and .approved_review_file == $approved_review_file
      and (.approved_review_sha256 | hex_sha256)
      and (.validated_review_payload_file | type == "string")
      and (.validated_review_payload_sha256 | hex_sha256)
      and (.request_fingerprint_sha256 | hex_sha256)
      and (.thread_actions_sha256 | hex_sha256)
      and (.provider_actor_id | type == "number" and . == floor and . >= 1 and . <= 9007199254740991)
      and (.review_event == "APPROVE" or .review_event == "REQUEST_CHANGES" or .review_event == "COMMENT")
      and (.final_body | type == "string")
      and (.created_at | utc_second)
    ' "$POST_INTENT_FILE" >/dev/null || {
    echo "post intent schema mismatch: $POST_INTENT_FILE" >&2
    exit 1
  }
  approved_review_sha256="$(sha256_file "$APPROVED_REVIEW_FILE")"
  [ "$approved_review_sha256" = "$(jq -r '.approved_review_sha256' "$POST_INTENT_FILE")" ] || {
    echo "post intent approved-review digest mismatch: $POST_INTENT_FILE" >&2
    exit 1
  }
  validated_payload_file="$(jq -r '.validated_review_payload_file' "$POST_INTENT_FILE")"
  validate_validated_payload_path_shape "$validated_payload_file" "$HEAD_SHA"
  assert_readable_file "validated review payload" "$validated_payload_file"
  assert_single_json_object "validated review payload" "$validated_payload_file"
  assert_payload_shape "$validated_payload_file" "$HEAD_SHA"
  validated_payload_sha256="$(sha256_file "$validated_payload_file")"
  [ "$validated_payload_sha256" = "$(jq -r '.validated_review_payload_sha256' "$POST_INTENT_FILE")" ] || {
    echo "post intent payload digest mismatch: $POST_INTENT_FILE" >&2
    exit 1
  }
  thread_actions_sha256="$(jq -r '.thread_actions_sha256' "$APPROVED_REVIEW_FILE")"
  [ "$thread_actions_sha256" = "$(jq -r '.thread_actions_sha256' "$POST_INTENT_FILE")" ] || {
    echo "post intent thread actions digest mismatch: $POST_INTENT_FILE" >&2
    exit 1
  }
  jq -e --slurpfile unmarked "$unmarked_payload_file" \
    --arg fingerprint "$(jq -r '.request_fingerprint_sha256' "$POST_INTENT_FILE")" \
    '
      .review_event == $unmarked[0].event
      and .final_body == (if $unmarked[0].body == "" then "<!-- devcanon-pr-review-request:v1 sha256=" + $fingerprint + " -->" else $unmarked[0].body + "\n\n<!-- devcanon-pr-review-request:v1 sha256=" + $fingerprint + " -->" end)
    ' "$POST_INTENT_FILE" >/dev/null || {
    echo "post intent final body mismatch: $POST_INTENT_FILE" >&2
    exit 1
  }
  jq -e --slurpfile intent "$POST_INTENT_FILE" '
    .commit_id == $intent[0].review_head_sha
    and .event == $intent[0].review_event
    and .body == $intent[0].final_body
  ' "$validated_payload_file" >/dev/null || {
    echo "post intent validated payload binding mismatch: $POST_INTENT_FILE" >&2
    exit 1
  }
  fingerprint_tuple="$(jq -c \
    --slurpfile intent "$POST_INTENT_FILE" \
    --arg thread_actions_sha256 "$thread_actions_sha256" \
    '[
      "pr-review/provider-request-fingerprint/v1",
      $intent[0].repository,
      $intent[0].pr_number,
      $intent[0].review_head_sha,
      $intent[0].provider_actor_id,
      .event,
      .body,
      $thread_actions_sha256,
      (.comments | map([.path, .line, (.start_line // null), (.start_side // null), .side, .body]))
    ]' "$unmarked_payload_file")"
  fingerprint="$(printf '%s' "$fingerprint_tuple" | sha256_file /dev/stdin)"
  [ "$fingerprint" = "$(jq -r '.request_fingerprint_sha256' "$POST_INTENT_FILE")" ] || {
    echo "post intent request fingerprint mismatch: $POST_INTENT_FILE" >&2
    exit 1
  }
  rm -f "$unmarked_payload_file"
)

validate_execution_receipt_file() (
  local receipt_file="$1"
  local require_initial="$2"
  local allow_temporary="${3:-false}"
  local approved_actions_file

  if [ "$allow_temporary" = true ]; then
    validate_direct_child_path "execution receipt candidate" "$receipt_file"
  else
    validate_execution_receipt_path_shape "$receipt_file" "$HEAD_SHA"
  fi
  assert_readable_file "execution receipt file" "$receipt_file"
  jq -e \
    --arg repository "$REPOSITORY" \
    --argjson pr_number "$PR_NUMBER" \
    --arg review_head_sha "$HEAD_SHA" \
    --arg approved_review_file "$APPROVED_REVIEW_FILE" \
    --arg post_intent_file "$POST_INTENT_FILE" \
    '
      def hex_sha256: type == "string" and test("^[0-9a-f]{64}$");
      def utc_second: type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$");
      def resolve_disposition: . == "pending" or . == "succeeded" or . == "already-resolved" or . == "failed";
      def valid_action:
        type == "object"
        and (keys | sort) == ["action", "disposition", "failure_reason", "thread_id"]
        and (.thread_id | (type == "string" and (gsub("[[:space:]]"; "") | length > 0)))
        and ((.action == "resolve" and (.disposition | resolve_disposition) and (if .disposition == "failed" then (.failure_reason | type == "string" and length > 0) else .failure_reason == null end)) or (.action == "leave" and .disposition == "not-requested" and .failure_reason == null));
      (keys | sort) == ["actions", "approved_review_file", "approved_review_sha256", "post_intent_file", "post_intent_sha256", "post_outcome", "pr_number", "provider_review_id", "provider_review_submitted_at", "repository", "request_fingerprint_sha256", "review_head_sha", "schema", "updated_at"]
      and .schema == "pr-review/thread-action-execution/v1"
      and .repository == $repository
      and .pr_number == $pr_number
      and .review_head_sha == $review_head_sha
      and .approved_review_file == $approved_review_file
      and (.approved_review_sha256 | hex_sha256)
      and .post_intent_file == $post_intent_file
      and (.post_intent_sha256 | hex_sha256)
      and (.request_fingerprint_sha256 | hex_sha256)
      and (.post_outcome == "post-response" or .post_outcome == "provider-reconciliation")
      and (.provider_review_id | type == "number" and . == floor and . >= 1 and . <= 9007199254740991)
      and (.provider_review_submitted_at | utc_second)
      and (.updated_at | utc_second)
      and (.actions | type == "array" and all(.[]; valid_action))
    ' "$receipt_file" >/dev/null || {
    echo "execution receipt schema mismatch: $receipt_file" >&2
    exit 1
  }
  [ "$(sha256_file "$APPROVED_REVIEW_FILE")" = "$(jq -r '.approved_review_sha256' "$receipt_file")" ] || {
    echo "execution receipt approved-review digest mismatch: $receipt_file" >&2
    exit 1
  }
  [ "$(sha256_file "$POST_INTENT_FILE")" = "$(jq -r '.post_intent_sha256' "$receipt_file")" ] || {
    echo "execution receipt post-intent digest mismatch: $receipt_file" >&2
    exit 1
  }
  [ "$(jq -r '.request_fingerprint_sha256' "$POST_INTENT_FILE")" = "$(jq -r '.request_fingerprint_sha256' "$receipt_file")" ] || {
    echo "execution receipt fingerprint mismatch: $receipt_file" >&2
    exit 1
  }
  approved_actions_file="$(mktemp ".ephemeral/.receipt-approved-actions-${HEAD_SHA}.XXXXXX")"
  trap 'rm -f "${approved_actions_file:-}"' EXIT
  jq '.thread_actions' "$APPROVED_REVIEW_FILE" > "$approved_actions_file"
  jq -e --slurpfile approved "$approved_actions_file" --argjson require_initial "$require_initial" '
    .actions as $actions
    | ($actions | length) == ($approved[0] | length)
    and all(range(0; ($actions | length)); . as $i |
      $actions[$i].thread_id == $approved[0][$i].thread_id
      and $actions[$i].action == $approved[0][$i].action
      and (if $require_initial then
        if $actions[$i].action == "resolve" then $actions[$i].disposition == "pending" and $actions[$i].failure_reason == null
        else $actions[$i].disposition == "not-requested" and $actions[$i].failure_reason == null end
      else true end)
    )
  ' "$receipt_file" >/dev/null || {
    echo "execution receipt sealed actions mismatch: $receipt_file" >&2
    exit 1
  }
  rm -f "$approved_actions_file"
)

receipt_all_terminal() {
  jq -e '[.actions[] | (.action == "leave" and .disposition == "not-requested") or (.action == "resolve" and (.disposition == "succeeded" or .disposition == "already-resolved"))] | all' "$1" >/dev/null
}

emit_execution_receipt_result() {
  local receipt_file="$1"
  local write_status="$2"
  local all_terminal=false
  if receipt_all_terminal "$receipt_file"; then
    all_terminal=true
  fi
  jq -cn --arg execution_receipt_file "$receipt_file" --arg write_status "$write_status" --argjson all_terminal "$all_terminal" \
    '{execution_receipt_file: $execution_receipt_file, write_status: $write_status, all_terminal: $all_terminal}'
}

materialize_execution_receipt() {
  local receipt_file
  local receipt_tmp
  local approved_review_sha256
  local post_intent_sha256

  validate_execution_receipt_inputs
  validate_post_intent_chain
  receipt_file="$(expected_execution_receipt_path_for "$HEAD_SHA")"
  validate_execution_receipt_path_shape "$receipt_file" "$HEAD_SHA"
  prepare_write_target "execution receipt" "$receipt_file"
  approved_review_sha256="$(sha256_file "$APPROVED_REVIEW_FILE")"
  post_intent_sha256="$(sha256_file "$POST_INTENT_FILE")"
  receipt_tmp="$(mktemp ".ephemeral/.execution-receipt-${HEAD_SHA}.XXXXXX")"
  trap 'rm -f "${receipt_tmp:-}"' EXIT
  jq -n \
    --arg schema "pr-review/thread-action-execution/v1" \
    --arg repository "$REPOSITORY" \
    --argjson pr_number "$PR_NUMBER" \
    --arg review_head_sha "$HEAD_SHA" \
    --arg approved_review_file "$APPROVED_REVIEW_FILE" \
    --arg approved_review_sha256 "$approved_review_sha256" \
    --arg post_intent_file "$POST_INTENT_FILE" \
    --arg post_intent_sha256 "$post_intent_sha256" \
    --arg request_fingerprint_sha256 "$(jq -r '.request_fingerprint_sha256' "$POST_INTENT_FILE")" \
    --arg post_outcome "$POST_OUTCOME" \
    --argjson provider_review_id "$PROVIDER_REVIEW_ID" \
    --arg provider_review_submitted_at "$PROVIDER_REVIEW_SUBMITTED_AT" \
    --arg updated_at "$EXECUTION_RECEIPT_UPDATED_AT" \
    --slurpfile approved "$APPROVED_REVIEW_FILE" \
    '{schema: $schema, repository: $repository, pr_number: $pr_number, review_head_sha: $review_head_sha, approved_review_file: $approved_review_file, approved_review_sha256: $approved_review_sha256, post_intent_file: $post_intent_file, post_intent_sha256: $post_intent_sha256, request_fingerprint_sha256: $request_fingerprint_sha256, post_outcome: $post_outcome, provider_review_id: $provider_review_id, provider_review_submitted_at: $provider_review_submitted_at, updated_at: $updated_at, actions: ($approved[0].thread_actions | map(if .action == "resolve" then {thread_id, action, disposition: "pending", failure_reason: null} else {thread_id, action, disposition: "not-requested", failure_reason: null} end))}' > "$receipt_tmp"
  if [ -e "$receipt_file" ]; then
    validate_execution_receipt_file "$receipt_file" true
    jq -e \
      --arg post_outcome "$POST_OUTCOME" \
      --argjson provider_review_id "$PROVIDER_REVIEW_ID" \
      --arg provider_review_submitted_at "$PROVIDER_REVIEW_SUBMITTED_AT" \
      '.post_outcome == $post_outcome and .provider_review_id == $provider_review_id and .provider_review_submitted_at == $provider_review_submitted_at' \
      "$receipt_file" >/dev/null || {
      echo "execution receipt identity mismatch: $receipt_file" >&2
      exit 1
    }
    emit_execution_receipt_result "$receipt_file" already-current
    return
  fi
  ln "$receipt_tmp" "$receipt_file" 2>/dev/null || {
    validate_execution_receipt_file "$receipt_file" true
    jq -e --arg post_outcome "$POST_OUTCOME" --argjson provider_review_id "$PROVIDER_REVIEW_ID" --arg provider_review_submitted_at "$PROVIDER_REVIEW_SUBMITTED_AT" '.post_outcome == $post_outcome and .provider_review_id == $provider_review_id and .provider_review_submitted_at == $provider_review_submitted_at' "$receipt_file" >/dev/null || exit 1
    emit_execution_receipt_result "$receipt_file" already-current
    return
  }
  validate_execution_receipt_file "$receipt_file" true
  cmp -s "$receipt_tmp" "$receipt_file" || {
    echo "execution receipt reread mismatch: $receipt_file" >&2
    exit 1
  }
  emit_execution_receipt_result "$receipt_file" committed
}

advance_execution_receipt() {
  local prior_tmp
  local intended_tmp
  local publish_tmp
  local action
  local current_disposition
  local current_failure_reason

  validate_advance_execution_receipt_inputs
  validate_post_intent_chain
  validate_execution_receipt_path_shape "$EXECUTION_RECEIPT_FILE" "$HEAD_SHA"
  validate_execution_receipt_file "$EXECUTION_RECEIPT_FILE" false
  prior_tmp="$(mktemp ".ephemeral/.execution-receipt-prior-${HEAD_SHA}.XXXXXX")"
  intended_tmp="$(mktemp ".ephemeral/.execution-receipt-intended-${HEAD_SHA}.XXXXXX")"
  publish_tmp="$(mktemp ".ephemeral/.execution-receipt-publish-${HEAD_SHA}.XXXXXX")"
  trap 'rm -f "${prior_tmp:-}" "${intended_tmp:-}" "${publish_tmp:-}"' EXIT
  cp "$EXECUTION_RECEIPT_FILE" "$prior_tmp"
  action="$(jq -r --arg thread_id "$THREAD_ID" '.actions[] | select(.thread_id == $thread_id) | .action' "$prior_tmp")"
  [ "$action" = "resolve" ] || {
    echo "THREAD_ID is not a sealed resolve action: $THREAD_ID" >&2
    exit 1
  }
  current_disposition="$(jq -r --arg thread_id "$THREAD_ID" '.actions[] | select(.thread_id == $thread_id) | .disposition' "$prior_tmp")"
  current_failure_reason="$(jq -r --arg thread_id "$THREAD_ID" '.actions[] | select(.thread_id == $thread_id) | .failure_reason // ""' "$prior_tmp")"
  case "$current_disposition" in
    succeeded | already-resolved)
      [ "$current_disposition" = "$DISPOSITION" ] || {
        echo "execution receipt terminal disposition conflict: $THREAD_ID" >&2
        exit 1
      }
      [ -z "$current_failure_reason" ] || {
        echo "execution receipt terminal failure reason conflict: $THREAD_ID" >&2
        exit 1
      }
      emit_execution_receipt_result "$EXECUTION_RECEIPT_FILE" already-current
      return
      ;;
    pending | failed) ;;
    *)
      echo "execution receipt disposition is not advanceable: $THREAD_ID" >&2
      exit 1
      ;;
  esac
  jq \
    --arg thread_id "$THREAD_ID" \
    --arg disposition "$DISPOSITION" \
    --arg failure_reason "${ACTION_FAILURE_REASON:-}" \
    --arg updated_at "$EXECUTION_RECEIPT_UPDATED_AT" \
    '.updated_at = $updated_at | .actions |= map(if .thread_id == $thread_id then .disposition = $disposition | .failure_reason = (if $disposition == "failed" then $failure_reason else null end) else . end)' \
    "$prior_tmp" > "$intended_tmp"
  # Validate the intended replacement against the same closed chain before publication.
  validate_execution_receipt_file "$intended_tmp" false true
  cp "$intended_tmp" "$publish_tmp"
  [ ! -L "$EXECUTION_RECEIPT_FILE" ] && [ -f "$EXECUTION_RECEIPT_FILE" ] || {
    echo "execution receipt path changed before replacement: $EXECUTION_RECEIPT_FILE" >&2
    exit 1
  }
  mv -f "$publish_tmp" "$EXECUTION_RECEIPT_FILE" 2>/dev/null || true
  [ ! -L "$EXECUTION_RECEIPT_FILE" ] && [ -f "$EXECUTION_RECEIPT_FILE" ] || {
    echo "execution receipt path changed during replacement: $EXECUTION_RECEIPT_FILE" >&2
    exit 1
  }
  if cmp -s "$intended_tmp" "$EXECUTION_RECEIPT_FILE"; then
    validate_execution_receipt_file "$EXECUTION_RECEIPT_FILE" false
    emit_execution_receipt_result "$EXECUTION_RECEIPT_FILE" committed
  elif cmp -s "$prior_tmp" "$EXECUTION_RECEIPT_FILE"; then
    validate_execution_receipt_file "$EXECUTION_RECEIPT_FILE" false
    emit_execution_receipt_result "$EXECUTION_RECEIPT_FILE" prior-retained
  else
    echo "execution receipt reread diverged after replacement: $EXECUTION_RECEIPT_FILE" >&2
    exit 1
  fi
}

publish_exact_json() {
  local label="$1"
  local target="$2"
  local source="$3"

  [ ! -L .ephemeral ] || {
    echo ".ephemeral must be a directory, not a symlink" >&2
    exit 1
  }
  mkdir -p .ephemeral
  [ ! -L "$target" ] || {
    echo "$label path must not be a symlink: $target" >&2
    exit 1
  }
  if [ -e "$target" ]; then
    [ -f "$target" ] || {
      echo "$label path exists but is not a regular file: $target" >&2
      exit 1
    }
    cmp -s "$source" "$target" || {
      echo "$label path collision: $target" >&2
      exit 1
    }
    return
  fi
  ln "$source" "$target" 2>/dev/null || {
    [ -f "$target" ] && cmp -s "$source" "$target" && return
    echo "$label path collision: $target" >&2
    exit 1
  }
}

materialize_post_intent() {
  local unmarked_payload_file
  local final_payload_file
  local intent_file
  local fingerprint_tuple
  local fingerprint
  local marker
  local thread_actions_sha256
  local approved_review_sha256
  local validated_payload_sha256
  local final_body
  local payload_tmp
  local intent_tmp
  local expected_intent_tmp

  require_repo_root
  require_jq
  validate_head_sha
  validate_pr_number
  require_env REPOSITORY
  require_env APPROVED_REVIEW_FILE
  validate_provider_actor_id
  validate_post_intent_created_at
  validate_approved_path_shape "$APPROVED_REVIEW_FILE"

  unmarked_payload_file="$(mktemp ".ephemeral/.unmarked-approved-payload-${HEAD_SHA}.XXXXXX")"
  payload_tmp="$(mktemp ".ephemeral/.validated-post-payload-${HEAD_SHA}.XXXXXX")"
  intent_tmp="$(mktemp ".ephemeral/.post-intent-${HEAD_SHA}.XXXXXX")"
  expected_intent_tmp="$(mktemp ".ephemeral/.post-intent-expected-${HEAD_SHA}.XXXXXX")"
  trap 'rm -f "${unmarked_payload_file:-}" "${payload_tmp:-}" "${intent_tmp:-}" "${expected_intent_tmp:-}"' EXIT

  validate_approved_review > "$unmarked_payload_file"
  assert_single_json_object "approved review payload" "$unmarked_payload_file"
  assert_payload_shape "$unmarked_payload_file" "$HEAD_SHA"
  jq -e '
    (.body | contains("<!-- devcanon-pr-review-request:v1 sha256=") | not)
  ' "$unmarked_payload_file" >/dev/null || {
    echo "unmarked approved review payload contains reserved request marker" >&2
    exit 1
  }

  thread_actions_sha256="$(jq -er '.thread_actions_sha256' "$APPROVED_REVIEW_FILE")"
  fingerprint_tuple="$(jq -c \
    --arg schema "pr-review/provider-request-fingerprint/v1" \
    --arg repository "$REPOSITORY" \
    --argjson pr_number "$PR_NUMBER" \
    --arg review_head_sha "$HEAD_SHA" \
    --argjson provider_actor_id "$PROVIDER_ACTOR_ID" \
    --arg thread_actions_sha256 "$thread_actions_sha256" \
    '[
      $schema,
      $repository,
      $pr_number,
      $review_head_sha,
      $provider_actor_id,
      .event,
      .body,
      $thread_actions_sha256,
      (.comments | map([.path, .line, (.start_line // null), (.start_side // null), .side, .body]))
    ]' "$unmarked_payload_file")"
  fingerprint="$(printf '%s' "$fingerprint_tuple" | sha256_file /dev/stdin)"
  marker="<!-- devcanon-pr-review-request:v1 sha256=${fingerprint} -->"
  jq --arg marker "$marker" '.body = (if .body == "" then $marker else .body + "\n\n" + $marker end)' \
    "$unmarked_payload_file" > "$payload_tmp"
  assert_single_json_object "validated review payload" "$payload_tmp"
  assert_payload_shape "$payload_tmp" "$HEAD_SHA"
  final_body="$(jq -er '.body' "$payload_tmp")"

  final_payload_file="$(expected_validated_payload_path_for "$HEAD_SHA")"
  intent_file="$(expected_post_intent_path_for "$HEAD_SHA")"
  validate_validated_payload_path_shape "$final_payload_file" "$HEAD_SHA"
  validate_post_intent_path_shape "$intent_file" "$HEAD_SHA"
  publish_exact_json "validated review payload" "$final_payload_file" "$payload_tmp"
  assert_readable_file "validated review payload" "$final_payload_file"
  assert_single_json_object "validated review payload" "$final_payload_file"
  assert_payload_shape "$final_payload_file" "$HEAD_SHA"
  cmp -s "$payload_tmp" "$final_payload_file" || {
    echo "validated review payload revalidation mismatch: $final_payload_file" >&2
    exit 1
  }

  approved_review_sha256="$(sha256_file "$APPROVED_REVIEW_FILE")"
  validated_payload_sha256="$(sha256_file "$final_payload_file")"
  jq -n \
    --arg schema "pr-review/thread-action-post-intent/v1" \
    --arg repository "$REPOSITORY" \
    --argjson pr_number "$PR_NUMBER" \
    --arg review_head_sha "$HEAD_SHA" \
    --arg approved_review_file "$APPROVED_REVIEW_FILE" \
    --arg approved_review_sha256 "$approved_review_sha256" \
    --arg validated_review_payload_file "$final_payload_file" \
    --arg validated_review_payload_sha256 "$validated_payload_sha256" \
    --arg review_event "$(jq -er '.event' "$final_payload_file")" \
    --argjson provider_actor_id "$PROVIDER_ACTOR_ID" \
    --arg request_fingerprint_sha256 "$fingerprint" \
    --arg final_body "$final_body" \
    --arg thread_actions_sha256 "$thread_actions_sha256" \
    --arg created_at "$POST_INTENT_CREATED_AT" \
    '{
      schema: $schema,
      repository: $repository,
      pr_number: $pr_number,
      review_head_sha: $review_head_sha,
      approved_review_file: $approved_review_file,
      approved_review_sha256: $approved_review_sha256,
      validated_review_payload_file: $validated_review_payload_file,
      validated_review_payload_sha256: $validated_review_payload_sha256,
      review_event: $review_event,
      provider_actor_id: $provider_actor_id,
      request_fingerprint_sha256: $request_fingerprint_sha256,
      final_body: $final_body,
      thread_actions_sha256: $thread_actions_sha256,
      created_at: $created_at
    }' > "$intent_tmp"
  cp "$intent_tmp" "$expected_intent_tmp"
  publish_exact_json "post intent" "$intent_file" "$intent_tmp"
  assert_readable_file "post intent" "$intent_file"
  assert_single_json_object "post intent" "$intent_file"
  cmp -s "$expected_intent_tmp" "$intent_file" || {
    echo "post intent revalidation mismatch: $intent_file" >&2
    exit 1
  }

  jq -cn \
    --arg validated_review_payload_file "$final_payload_file" \
    --arg post_intent_file "$intent_file" \
    '{validated_review_payload_file: $validated_review_payload_file, post_intent_file: $post_intent_file}'
}

freeze_approved_review() {
  local approved_review_file
  local tmp_file
  local findings_sha256
  local review_body_sha256
  local payload_sha256
  local scope_decision_file
  local scope_decision_sha256
  local thread_actions_file
  local thread_actions_sha256
  local prior_threads_file
  local review_event
  require_repo_root
  validate_head_sha
  validate_pr_number
  require_env FINDINGS_FILE
  require_env REVIEW_BODY_FILE
  require_env REVIEW_PAYLOAD_FILE
  require_env REPOSITORY
  require_env THREAD_ACTIONS_FILE
  validate_findings_path_shape "$FINDINGS_FILE" "$HEAD_SHA"
  validate_review_body_path_shape "$REVIEW_BODY_FILE" "$HEAD_SHA"
  validate_payload_path_shape "$REVIEW_PAYLOAD_FILE" "$HEAD_SHA"
  assert_readable_file "findings file" "$FINDINGS_FILE"
  assert_readable_file "review body file" "$REVIEW_BODY_FILE"
  assert_readable_file "review payload file" "$REVIEW_PAYLOAD_FILE"
  assert_findings_envelope "$FINDINGS_FILE"
  assert_single_json_object "review payload" "$REVIEW_PAYLOAD_FILE"
  assert_payload_shape "$REVIEW_PAYLOAD_FILE" "$HEAD_SHA"
  review_event="$(jq -r '.event' "$REVIEW_PAYLOAD_FILE")"
  REVIEW_EVENT="$review_event"
  validate_review_event
  scope_decision_file="$(scope_decision_file_for "$HEAD_SHA")"
  validate_scope_decision_path_shape "$scope_decision_file" "$HEAD_SHA"
  assert_readable_file "scope decision file" "$scope_decision_file"
  compare_payload_with_support "$HEAD_SHA" "$scope_decision_file" "$FINDINGS_FILE" "$REVIEW_BODY_FILE" "$REVIEW_PAYLOAD_FILE" "$REVIEW_EVENT" >/dev/null
  thread_actions_file="$THREAD_ACTIONS_FILE"
  validate_thread_actions_path_shape "$thread_actions_file" "$HEAD_SHA"
  assert_readable_file "thread actions file" "$thread_actions_file"
  prior_threads_file="$(jq -er '.prior_threads_file | strings | select(length > 0)' "$thread_actions_file")" || {
    echo "thread actions prior threads path missing or malformed: $thread_actions_file" >&2
    exit 1
  }
  validate_thread_actions_binding "$thread_actions_file" "$prior_threads_file" "$HEAD_SHA"

  approved_review_file="$(expected_approved_path_for "$HEAD_SHA")"
  validate_approved_path_shape "$approved_review_file"
  prepare_write_target "approved review" "$approved_review_file"
  [ ! -e "$approved_review_file" ] || {
    echo "approved review path already exists: $approved_review_file" >&2
    exit 1
  }
  findings_sha256="$(sha256_file "$FINDINGS_FILE")"
  review_body_sha256="$(sha256_file "$REVIEW_BODY_FILE")"
  payload_sha256="$(sha256_file "$REVIEW_PAYLOAD_FILE")"
  scope_decision_sha256="$(sha256_file "$scope_decision_file")"
  thread_actions_sha256="$(sha256_file "$thread_actions_file")"
  tmp_file="$(mktemp ".ephemeral/.approved-review-${HEAD_SHA}.XXXXXX")"
  trap 'rm -f "${tmp_file:-}"' EXIT
  jq -n \
    --arg schema "pr-review/approved-review/v1" \
    --arg repository "$REPOSITORY" \
    --argjson pr_number "$PR_NUMBER" \
    --arg review_head_sha "$HEAD_SHA" \
    --arg findings_file "$FINDINGS_FILE" \
    --arg review_body_file "$REVIEW_BODY_FILE" \
    --arg review_payload_file "$REVIEW_PAYLOAD_FILE" \
    --arg scope_decision_file "$scope_decision_file" \
    --arg findings_sha256 "$findings_sha256" \
    --arg review_body_sha256 "$review_body_sha256" \
    --arg review_payload_sha256 "$payload_sha256" \
    --arg scope_decision_sha256 "$scope_decision_sha256" \
    --arg thread_actions_file "$thread_actions_file" \
    --arg thread_actions_sha256 "$thread_actions_sha256" \
    --slurpfile payload "$REVIEW_PAYLOAD_FILE" \
    --slurpfile thread_actions "$thread_actions_file" \
    '{
      schema: $schema,
      repository: $repository,
      pr_number: $pr_number,
      review_head_sha: $review_head_sha,
      findings_file: $findings_file,
      review_body_file: $review_body_file,
      review_payload_file: $review_payload_file,
      scope_decision_file: $scope_decision_file,
      findings_sha256: $findings_sha256,
      review_body_sha256: $review_body_sha256,
      review_payload_sha256: $review_payload_sha256,
      scope_decision_sha256: $scope_decision_sha256,
      thread_actions_file: $thread_actions_file,
      thread_actions_sha256: $thread_actions_sha256,
      thread_actions: $thread_actions[0].actions,
      payload: $payload[0]
    }' > "$tmp_file"
  ln "$tmp_file" "$approved_review_file" 2>/dev/null || {
    echo "approved review path already exists: $approved_review_file" >&2
    exit 1
  }
  rm -f "$tmp_file"
  tmp_file=""
  printf '%s\n' "$approved_review_file"
}

validate_digest() {
  local label="$1"
  local file="$2"
  local expected="$3"
  local actual
  actual="$(sha256_file "$file")"
  [ "$actual" = "$expected" ] || {
    echo "$label digest mismatch: $file" >&2
    exit 1
  }
}

validate_approved_review() {
  local review_head_sha
  local findings_file
  local review_body_file
  local payload_file
  local scope_decision_file
  local findings_sha256
  local review_body_sha256
  local payload_sha256
  local scope_decision_sha256
  local repository
  local pr_number
  local thread_actions_file
  local thread_actions_sha256
  local prior_threads_file
  local review_event
  require_repo_root
  validate_head_sha
  validate_pr_number
  require_env REPOSITORY
  require_env APPROVED_REVIEW_FILE
  validate_approved_path_shape "$APPROVED_REVIEW_FILE"
  assert_readable_file "approved review file" "$APPROVED_REVIEW_FILE"
  assert_approved_schema "$APPROVED_REVIEW_FILE"

  repository="$(jq -r '.repository' "$APPROVED_REVIEW_FILE")"
  pr_number="$(jq -r '.pr_number' "$APPROVED_REVIEW_FILE")"
  [ "$repository" = "$REPOSITORY" ] || {
    echo "approved review repository mismatch: $repository" >&2
    exit 1
  }
  [ "$pr_number" = "$PR_NUMBER" ] || {
    echo "approved review PR number mismatch: $pr_number" >&2
    exit 1
  }

  review_head_sha="$(jq -r '.review_head_sha' "$APPROVED_REVIEW_FILE")"
  [ "$HEAD_SHA" = "$review_head_sha" ] || {
    echo "review head mismatch: approved $review_head_sha, current $HEAD_SHA" >&2
    exit 1
  }
  validate_approved_path_identity "$APPROVED_REVIEW_FILE" "$review_head_sha"

  findings_file="$(jq -r '.findings_file' "$APPROVED_REVIEW_FILE")"
  review_body_file="$(jq -r '.review_body_file' "$APPROVED_REVIEW_FILE")"
  payload_file="$(jq -r '.review_payload_file' "$APPROVED_REVIEW_FILE")"
  scope_decision_file="$(jq -r '.scope_decision_file // ""' "$APPROVED_REVIEW_FILE")"
  findings_sha256="$(jq -r '.findings_sha256' "$APPROVED_REVIEW_FILE")"
  review_body_sha256="$(jq -r '.review_body_sha256' "$APPROVED_REVIEW_FILE")"
  payload_sha256="$(jq -r '.review_payload_sha256' "$APPROVED_REVIEW_FILE")"
  scope_decision_sha256="$(jq -r '.scope_decision_sha256 // ""' "$APPROVED_REVIEW_FILE")"
  thread_actions_file="$(jq -r '.thread_actions_file' "$APPROVED_REVIEW_FILE")"
  thread_actions_sha256="$(jq -r '.thread_actions_sha256' "$APPROVED_REVIEW_FILE")"
  review_event="$(jq -r '.payload.event' "$APPROVED_REVIEW_FILE")"

  validate_findings_path_shape "$findings_file" "$review_head_sha"
  validate_review_body_path_shape "$review_body_file" "$review_head_sha"
  validate_payload_path_shape "$payload_file" "$review_head_sha"
  assert_readable_file "findings file" "$findings_file"
  assert_readable_file "review body file" "$review_body_file"
  assert_readable_file "review payload file" "$payload_file"
  assert_findings_envelope "$findings_file"
  assert_single_json_object "review payload" "$payload_file"
  assert_payload_shape "$payload_file" "$review_head_sha"
  validate_digest "findings" "$findings_file" "$findings_sha256"
  validate_digest "review body" "$review_body_file" "$review_body_sha256"
  validate_digest "payload" "$payload_file" "$payload_sha256"
  validate_scope_decision_path_shape "$scope_decision_file" "$review_head_sha"
  assert_readable_file "scope decision file" "$scope_decision_file"
  validate_digest "scope decision" "$scope_decision_file" "$scope_decision_sha256"
  validate_thread_actions_path_shape "$thread_actions_file" "$review_head_sha"
  assert_readable_file "thread actions file" "$thread_actions_file"
  prior_threads_file="$(jq -er '.prior_threads_file | strings | select(length > 0)' "$thread_actions_file")" || {
    echo "thread actions prior threads path missing or malformed: $thread_actions_file" >&2
    exit 1
  }
  validate_thread_actions_binding "$thread_actions_file" "$prior_threads_file" "$review_head_sha"
  validate_digest "thread actions" "$thread_actions_file" "$thread_actions_sha256"
  jq -e --slurpfile thread_actions "$thread_actions_file" '.thread_actions == $thread_actions[0].actions' "$APPROVED_REVIEW_FILE" >/dev/null || {
    echo "thread actions content mismatch: $thread_actions_file" >&2
    exit 1
  }
  jq -e --slurpfile payload "$payload_file" '.payload == $payload[0]' "$APPROVED_REVIEW_FILE" >/dev/null || {
    echo "payload content mismatch: $payload_file" >&2
    exit 1
  }
  compare_payload_with_support "$review_head_sha" "$scope_decision_file" "$findings_file" "$review_body_file" "$payload_file" "$review_event" >/dev/null
  jq '.payload' "$APPROVED_REVIEW_FILE"
}

inspect_approved_review_ownership() {
  local validated_review_body_file
  local validated_review_payload_file
  validate_approved_review >/dev/null
  validated_review_body_file="$(jq -r '.review_body_file' "$APPROVED_REVIEW_FILE")"
  validated_review_payload_file="$(jq -r '.review_payload_file' "$APPROVED_REVIEW_FILE")"
  jq -cn \
    --arg review_body_file "$validated_review_body_file" \
    --arg review_payload_file "$validated_review_payload_file" \
    '{review_body_file: $review_body_file, review_payload_file: $review_payload_file}'
}

case "$command_name" in
  prepare-review-payload-write)
    prepare_review_payload_write
    ;;
  materialize-validated-review-payload)
    materialize_validated_review_payload
    ;;
  materialize-post-intent)
    materialize_post_intent
    ;;
  materialize-execution-receipt)
    materialize_execution_receipt
    ;;
  advance-execution-receipt)
    advance_execution_receipt
    ;;
  freeze-approved-review)
    freeze_approved_review
    ;;
  validate-approved-review)
    validate_approved_review
    ;;
  inspect-approved-review-ownership)
    inspect_approved_review_ownership
    ;;
  *)
    echo "usage: approved-review-artifacts.sh prepare-review-payload-write|materialize-validated-review-payload|materialize-post-intent|materialize-execution-receipt|advance-execution-receipt|freeze-approved-review|validate-approved-review|inspect-approved-review-ownership" >&2
    exit 1
    ;;
esac
