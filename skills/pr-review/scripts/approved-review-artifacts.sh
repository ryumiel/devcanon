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

assert_single_json_object() {
  local label="$1"
  local file="$2"
  require_jq
  jq -e -s 'length == 1 and (.[0] | type == "object")' "$file" >/dev/null || {
    echo "$label must contain exactly one JSON object: $file" >&2
    exit 1
  }
}

play_review_helper() {
  if [ -n "${PLAY_REVIEW_HELPER:-}" ]; then
    printf '%s\n' "$PLAY_REVIEW_HELPER"
    return
  fi
  require_env PLAY_REVIEW_DIR
  printf '%s\n' "${PLAY_REVIEW_DIR%/}/scripts/review-artifacts.sh"
}

validate_findings_with_owner() {
  local file="$1"
  local review_head_sha="$2"
  local helper
  helper="$(play_review_helper)"
  [ -f "$helper" ] || {
    echo "play-review helper missing or not a regular file: $helper" >&2
    exit 1
  }
  [ -r "$helper" ] || {
    echo "play-review helper missing or unreadable: $helper" >&2
    exit 1
  }
  HEAD_SHA="$review_head_sha" FINDINGS_FILE="$file" bash "$helper" validate-findings || {
    echo "findings validation failed via play-review helper: $file" >&2
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
    and (.findings_sha256 | hex_sha256)
    and (.review_body_sha256 | hex_sha256)
    and (.review_payload_sha256 | hex_sha256)
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
  validate_findings_with_owner "$FINDINGS_FILE" "$HEAD_SHA"
  assert_single_json_object "review payload" "$REVIEW_PAYLOAD_FILE"
  assert_payload_shape "$REVIEW_PAYLOAD_FILE" "$HEAD_SHA"

  approved_review_file="$(expected_approved_path_for "$HEAD_SHA")"
  validate_approved_path_shape "$approved_review_file"
  prepare_write_target "approved review" "$approved_review_file"
  findings_sha256="$(sha256_file "$FINDINGS_FILE")"
  review_body_sha256="$(sha256_file "$REVIEW_BODY_FILE")"
  payload_sha256="$(sha256_file "$REVIEW_PAYLOAD_FILE")"
  tmp_file="$(mktemp ".ephemeral/.approved-review-${HEAD_SHA}.XXXXXX")"
  trap 'rm -f "${tmp_file:-}"' EXIT
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
  local findings_sha256
  local review_body_sha256
  local payload_sha256
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
  findings_sha256="$(jq -r '.findings_sha256' "$APPROVED_REVIEW_FILE")"
  review_body_sha256="$(jq -r '.review_body_sha256' "$APPROVED_REVIEW_FILE")"
  payload_sha256="$(jq -r '.review_payload_sha256' "$APPROVED_REVIEW_FILE")"

  validate_findings_path_shape "$findings_file" "$review_head_sha"
  validate_review_body_path_shape "$review_body_file"
  validate_payload_path_shape "$payload_file" "$review_head_sha"
  assert_readable_file "findings file" "$findings_file"
  assert_readable_file "review body file" "$review_body_file"
  assert_readable_file "review payload file" "$payload_file"
  validate_findings_with_owner "$findings_file" "$review_head_sha"
  assert_single_json_object "review payload" "$payload_file"
  assert_payload_shape "$payload_file" "$review_head_sha"
  validate_digest "findings" "$findings_file" "$findings_sha256"
  validate_digest "review body" "$review_body_file" "$review_body_sha256"
  validate_digest "payload" "$payload_file" "$payload_sha256"
  jq -e --slurpfile payload "$payload_file" '.payload == $payload[0]' "$APPROVED_REVIEW_FILE" >/dev/null || {
    echo "payload content mismatch: $payload_file" >&2
    exit 1
  }
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
