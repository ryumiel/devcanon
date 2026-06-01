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
  validate_direct_child_path "review body" "$1"
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

scope_decision_file_for() {
  local review_head_sha="$1"
  if [ -n "${SCOPE_DECISION_FILE:-}" ]; then
    printf '%s\n' "$SCOPE_DECISION_FILE"
  else
    expected_scope_decision_path_for "$review_head_sha"
  fi
}

support_scope_args() {
  local review_head_sha="$1"
  local scope_decision_file="$2"
  local prior_kind="none"
  local prior_path="null"
  local expected_prior_threads

  expected_prior_threads=".ephemeral/$(branch_slug)-${review_head_sha}-prior-threads.json"
  if [ -n "${PRIOR_THREADS_FILE:-}" ]; then
    [ "$PRIOR_THREADS_FILE" = "$expected_prior_threads" ] || {
      echo "prior threads path mismatch: $PRIOR_THREADS_FILE" >&2
      exit 1
    }
    prior_kind="github-prior-threads"
    prior_path="$PRIOR_THREADS_FILE"
  elif [ -f "$expected_prior_threads" ]; then
    prior_kind="github-prior-threads"
    prior_path="$expected_prior_threads"
  fi

  printf '%s\0' \
    --surface pr-review \
    --head-sha "$review_head_sha" \
    --scope-decision-file "$scope_decision_file" \
    --expected-schema pr-review/scope-decision/v1 \
    --expected-prior-context-kind "$prior_kind" \
    --expected-prior-context-path "$prior_path" \
    --governed-path-pattern "$governed_path_pattern" \
    --max-narrow-changed-files "$max_narrow_changed_files"
}

compare_payload_with_support() {
  local review_head_sha="$1"
  local scope_decision_file="$2"
  local findings_file="$3"
  local review_body_file="$4"
  local payload_file="$5"
  local review_event="$6"
  local validator
  local args=()

  validator="$(resolve_validator)"
  while IFS= read -r -d '' arg; do
    args+=("$arg")
  done < <(support_scope_args "$review_head_sha" "$scope_decision_file")

  bash "$validator" compare-approved-payload \
    "${args[@]}" \
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
    .schema == "play-review/findings/v1"
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
    and (.review_head_sha | head_sha)
    and (.findings_file | type == "string")
    and (.review_body_file | type == "string")
    and (.review_payload_file | type == "string")
    and ((has("scope_decision_file") | not) or (.scope_decision_file | type == "string"))
    and (.findings_sha256 | hex_sha256)
    and (.review_body_sha256 | hex_sha256)
    and (.review_payload_sha256 | hex_sha256)
    and ((has("scope_decision_sha256") | not) or (.scope_decision_sha256 | hex_sha256))
    and (has("scope_decision_file") == has("scope_decision_sha256"))
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

freeze_approved_review() {
  local approved_review_file
  local tmp_file
  local findings_sha256
  local review_body_sha256
  local payload_sha256
  local scope_decision_file
  local scope_decision_sha256
  local review_event
  local has_scope_decision=false
  require_repo_root
  validate_head_sha
  require_env FINDINGS_FILE
  require_env REVIEW_BODY_FILE
  require_env REVIEW_PAYLOAD_FILE
  validate_findings_path_shape "$FINDINGS_FILE" "$HEAD_SHA"
  validate_review_body_path_shape "$REVIEW_BODY_FILE"
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
  if [ -n "${SCOPE_DECISION_FILE:-}" ] || [ -e "$scope_decision_file" ]; then
    assert_readable_file "scope decision file" "$scope_decision_file"
    compare_payload_with_support "$HEAD_SHA" "$scope_decision_file" "$FINDINGS_FILE" "$REVIEW_BODY_FILE" "$REVIEW_PAYLOAD_FILE" "$REVIEW_EVENT" >/dev/null
    has_scope_decision=true
  fi

  approved_review_file="$(expected_approved_path_for "$HEAD_SHA")"
  validate_approved_path_shape "$approved_review_file"
  prepare_write_target "approved review" "$approved_review_file"
  findings_sha256="$(sha256_file "$FINDINGS_FILE")"
  review_body_sha256="$(sha256_file "$REVIEW_BODY_FILE")"
  payload_sha256="$(sha256_file "$REVIEW_PAYLOAD_FILE")"
  if [ "$has_scope_decision" = true ]; then
    scope_decision_sha256="$(sha256_file "$scope_decision_file")"
  fi
  tmp_file="$(mktemp ".ephemeral/.approved-review-${HEAD_SHA}.XXXXXX")"
  trap 'rm -f "${tmp_file:-}"' EXIT
  if [ "$has_scope_decision" = true ]; then
    jq -n \
      --arg schema "pr-review/approved-review/v1" \
      --arg review_head_sha "$HEAD_SHA" \
      --arg findings_file "$FINDINGS_FILE" \
      --arg review_body_file "$REVIEW_BODY_FILE" \
      --arg review_payload_file "$REVIEW_PAYLOAD_FILE" \
      --arg scope_decision_file "$scope_decision_file" \
      --arg findings_sha256 "$findings_sha256" \
      --arg review_body_sha256 "$review_body_sha256" \
      --arg review_payload_sha256 "$payload_sha256" \
      --arg scope_decision_sha256 "$scope_decision_sha256" \
      --slurpfile payload "$REVIEW_PAYLOAD_FILE" \
      '{
        schema: $schema,
        review_head_sha: $review_head_sha,
        findings_file: $findings_file,
        review_body_file: $review_body_file,
        review_payload_file: $review_payload_file,
        scope_decision_file: $scope_decision_file,
        findings_sha256: $findings_sha256,
        review_body_sha256: $review_body_sha256,
        review_payload_sha256: $review_payload_sha256,
        scope_decision_sha256: $scope_decision_sha256,
        payload: $payload[0]
      }' > "$tmp_file"
  else
    jq -n \
      --arg schema "pr-review/approved-review/v1" \
      --arg review_head_sha "$HEAD_SHA" \
      --arg findings_file "$FINDINGS_FILE" \
      --arg review_body_file "$REVIEW_BODY_FILE" \
      --arg review_payload_file "$REVIEW_PAYLOAD_FILE" \
      --arg findings_sha256 "$findings_sha256" \
      --arg review_body_sha256 "$review_body_sha256" \
      --arg review_payload_sha256 "$payload_sha256" \
      --slurpfile payload "$REVIEW_PAYLOAD_FILE" \
      '{
        schema: $schema,
        review_head_sha: $review_head_sha,
        findings_file: $findings_file,
        review_body_file: $review_body_file,
        review_payload_file: $review_payload_file,
        findings_sha256: $findings_sha256,
        review_body_sha256: $review_body_sha256,
        review_payload_sha256: $review_payload_sha256,
        payload: $payload[0]
      }' > "$tmp_file"
  fi
  mv -f "$tmp_file" "$approved_review_file"
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
  local review_event
  require_repo_root
  validate_head_sha
  require_env APPROVED_REVIEW_FILE
  validate_approved_path_shape "$APPROVED_REVIEW_FILE"
  assert_readable_file "approved review file" "$APPROVED_REVIEW_FILE"
  assert_approved_schema "$APPROVED_REVIEW_FILE"

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
  review_event="$(jq -r '.payload.event' "$APPROVED_REVIEW_FILE")"

  validate_findings_path_shape "$findings_file" "$review_head_sha"
  validate_review_body_path_shape "$review_body_file"
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
  if jq -e 'has("scope_decision_file")' "$APPROVED_REVIEW_FILE" >/dev/null; then
    validate_scope_decision_path_shape "$scope_decision_file" "$review_head_sha"
    assert_readable_file "scope decision file" "$scope_decision_file"
    validate_digest "scope decision" "$scope_decision_file" "$scope_decision_sha256"
  fi
  jq -e --slurpfile payload "$payload_file" '.payload == $payload[0]' "$APPROVED_REVIEW_FILE" >/dev/null || {
    echo "payload content mismatch: $payload_file" >&2
    exit 1
  }
  if jq -e 'has("scope_decision_file")' "$APPROVED_REVIEW_FILE" >/dev/null; then
    compare_payload_with_support "$review_head_sha" "$scope_decision_file" "$findings_file" "$review_body_file" "$payload_file" "$review_event" >/dev/null
  fi
  jq '.payload' "$APPROVED_REVIEW_FILE"
}

case "$command_name" in
  prepare-review-payload-write)
    prepare_review_payload_write
    ;;
  freeze-approved-review)
    freeze_approved_review
    ;;
  validate-approved-review)
    validate_approved_review
    ;;
  *)
    echo "usage: approved-review-artifacts.sh prepare-review-payload-write|freeze-approved-review|validate-approved-review" >&2
    exit 1
    ;;
esac
