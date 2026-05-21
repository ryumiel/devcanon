#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "$name is required" >&2
    exit 1
  fi
}

require_env BASE_SHA
require_env SNAPSHOT_FILE

verify_commit() {
  local label="$1"
  local value="$2"
  local resolved
  resolved="$(git rev-parse --verify --quiet --end-of-options "${value}^{commit}" 2>/dev/null)" || {
    echo "$label invalid: $value" >&2
    exit 1
  }
  printf '%s\n' "$resolved"
}

sha256_stream() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    echo "shasum or sha256sum is required to validate implementer/snapshot/v1" >&2
    exit 1
  fi
}

sha256_file() {
  local path="$1"
  sha256_stream < "$path"
}

base64_decode_stream() {
  command -v base64 >/dev/null 2>&1 || {
    echo "base64 is required to validate implementer/snapshot/v1" >&2
    exit 1
  }

  if base64 --decode </dev/null >/dev/null 2>&1; then
    base64 --decode
  elif base64 -d </dev/null >/dev/null 2>&1; then
    base64 -d
  elif base64 -D </dev/null >/dev/null 2>&1; then
    base64 -D
  else
    echo "base64 decode support is required to validate implementer/snapshot/v1" >&2
    exit 1
  fi
}

command -v jq >/dev/null 2>&1 || {
  echo "jq is required to validate implementer/snapshot/v1" >&2
  exit 1
}

GIT_TOPLEVEL="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "failed to determine git repository root" >&2
  exit 1
}
PHYSICAL_TOPLEVEL="$(cd "$GIT_TOPLEVEL" && pwd -P)" || {
  echo "failed to resolve git repository root" >&2
  exit 1
}
PHYSICAL_PWD="$(pwd -P)"
[ "$PHYSICAL_TOPLEVEL" = "$PHYSICAL_PWD" ] || {
  echo "validate-snapshot-manifest.sh must run from the repository root" >&2
  exit 1
}

BASE_COMMIT_SHA="$(verify_commit "base SHA" "$BASE_SHA")"
CONTROLLER_HEAD_SHA="${CONTROLLER_HEAD_SHA:-$(git rev-parse HEAD)}"
case "$CONTROLLER_HEAD_SHA" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *)
    echo "controller head SHA invalid: $CONTROLLER_HEAD_SHA" >&2
    exit 1
    ;;
esac
CONTROLLER_HEAD_SHA="$(verify_commit "controller head SHA" "$CONTROLLER_HEAD_SHA")"

case "$SNAPSHOT_FILE" in
  .ephemeral/*/snapshot-*.json)
    echo "snapshot path must be flat: $SNAPSHOT_FILE" >&2
    exit 1
    ;;
esac
if [[ ! "$SNAPSHOT_FILE" =~ ^\.ephemeral/snapshot-[0-9a-f]{40}\.json$ ]]; then
  echo "snapshot path validation failed: $SNAPSHOT_FILE" >&2
  exit 1
fi
[ "${SNAPSHOT_FILE#*..}" = "$SNAPSHOT_FILE" ] || {
  echo "path traversal: $SNAPSHOT_FILE" >&2
  exit 1
}
[ -L .ephemeral ] && {
  echo "snapshot directory must not be a symlink: .ephemeral" >&2
  exit 1
}
[ ! -L "$SNAPSHOT_FILE" ] || {
  echo "snapshot must not be a symlink: $SNAPSHOT_FILE" >&2
  exit 1
}
[ -f "$SNAPSHOT_FILE" ] || {
  echo "snapshot missing or not a regular file: $SNAPSHOT_FILE" >&2
  exit 1
}
[ -r "$SNAPSHOT_FILE" ] || {
  echo "snapshot missing or unreadable: $SNAPSHOT_FILE" >&2
  exit 1
}

jq -e . "$SNAPSHOT_FILE" >/dev/null 2>&1 || {
  echo "snapshot JSON invalid: $SNAPSHOT_FILE" >&2
  exit 1
}
jq -e '.schema == "implementer/snapshot/v1"' "$SNAPSHOT_FILE" >/dev/null || {
  echo "snapshot schema mismatch" >&2
  exit 1
}
SNAPSHOT_HEAD_SHA="$(jq -r '.head_sha // ""' "$SNAPSHOT_FILE")"
case "$SNAPSHOT_HEAD_SHA" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *)
    echo "snapshot head_sha invalid: $SNAPSHOT_HEAD_SHA" >&2
    exit 1
    ;;
esac
[ "$SNAPSHOT_HEAD_SHA" = "$CONTROLLER_HEAD_SHA" ] || {
  echo "snapshot head_sha mismatch: $SNAPSHOT_HEAD_SHA vs $CONTROLLER_HEAD_SHA" >&2
  exit 1
}
EXPECTED_SNAPSHOT_FILE=".ephemeral/snapshot-${CONTROLLER_HEAD_SHA}.json"
[ "$SNAPSHOT_FILE" = "$EXPECTED_SNAPSHOT_FILE" ] || {
  echo "snapshot path head mismatch: $SNAPSHOT_FILE vs $EXPECTED_SNAPSHOT_FILE" >&2
  exit 1
}

jq -e '.files | type == "array"' "$SNAPSHOT_FILE" >/dev/null || {
  echo "snapshot files must be an array" >&2
  exit 1
}
jq -e '
  def safe_path:
    type == "string" and
    . != "" and
    (startswith("/") | not) and
    . != "." and
    . != ".." and
    (startswith("../") | not) and
    (startswith("./") | not) and
    (endswith("/.") | not) and
    (endswith("/..") | not) and
    (contains("/./") | not) and
    (contains("/../") | not) and
    (contains("//") | not);
  all(.files[]; .path | safe_path)
' "$SNAPSHOT_FILE" >/dev/null || {
  echo "snapshot entry path validation failed" >&2
  exit 1
}
jq -e '
  def hex64:
    type == "string" and test("^[0-9a-f]{64}$");
  def nonnegative_integer:
    type == "number" and floor == . and . >= 0;
  def valid_deleted:
    .status == "deleted" and
    .lines == 0 and
    .bytes == 0 and
    .sha256 == "" and
    (has("content") | not) and
    (has("skipped") | not);
  def valid_present:
    (.status == "added" or .status == "modified") and
    (.lines | nonnegative_integer) and
    (.bytes | nonnegative_integer) and
    (.sha256 | hex64) and
    (
      (has("content") and (.content | type == "string") and (has("skipped") | not)) or
      ((has("content") | not) and (.skipped == "binary" or .skipped == "size>64KB"))
    );
  (.task_id | type == "string") and
  (.files | type == "array") and
  (.files | length > 0) and
  all(.files[];
    (.path | type == "string") and
    (.status | type == "string") and
    (.status == "added" or .status == "modified" or .status == "deleted") and
    (valid_deleted or valid_present)
  )
' "$SNAPSHOT_FILE" >/dev/null || {
  echo "snapshot schema mismatch" >&2
  exit 1
}

WORK_DIR="$(mktemp -d ".ephemeral/.snapshot-validate-${CONTROLLER_HEAD_SHA}.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT
EXPECTED_SET="$WORK_DIR/expected.tsv"
ACTUAL_SET="$WORK_DIR/actual.tsv"
EXPECTED_SORTED="$WORK_DIR/expected.sorted.tsv"
ACTUAL_SORTED="$WORK_DIR/actual.sorted.tsv"

git diff -z --name-status --no-renames "$BASE_COMMIT_SHA..$CONTROLLER_HEAD_SHA" > "$WORK_DIR/diff.z"
while IFS= read -r -d '' git_status && IFS= read -r -d '' path; do
  encoded_path="$(jq -rRn --arg path "$path" '$path | @base64')"
  case "$git_status" in
    A) status="added" ;;
    M) status="modified" ;;
    D) status="deleted" ;;
    *)
      echo "unsupported controller diff status $git_status: path_b64=$encoded_path" >&2
      exit 1
      ;;
  esac
  printf '%s\t%s\n' "$encoded_path" "$status" >> "$EXPECTED_SET"
done < "$WORK_DIR/diff.z"
touch "$EXPECTED_SET"

jq -r '.files[] | [(.path | @base64), .status] | @tsv' "$SNAPSHOT_FILE" | tr -d '\r' > "$ACTUAL_SET"
touch "$ACTUAL_SET"

ACTUAL_COUNT="$(wc -l < "$ACTUAL_SET" | tr -d ' ')"
ACTUAL_UNIQUE_COUNT="$(sort "$ACTUAL_SET" | uniq | wc -l | tr -d ' ')"
[ "$ACTUAL_COUNT" = "$ACTUAL_UNIQUE_COUNT" ] || {
  echo "snapshot contains duplicate entry" >&2
  exit 1
}

sort "$EXPECTED_SET" > "$EXPECTED_SORTED"
sort "$ACTUAL_SET" > "$ACTUAL_SORTED"
cmp -s "$EXPECTED_SORTED" "$ACTUAL_SORTED" || {
  echo "snapshot changed-file set mismatch" >&2
  exit 1
}

while IFS=$'\t' read -r encoded_path status_value; do
  [ -n "$encoded_path" ] || continue
  if [ "$status_value" = "deleted" ]; then
    continue
  fi

  IFS= read -r -d '' path_value < <(
    jq -rjn --arg encoded "$encoded_path" '$encoded | @base64d'
    printf '\0'
  )
  mode="$(git ls-tree "$CONTROLLER_HEAD_SHA" -- ":(literal)$path_value" | awk 'NR == 1 { print $1 }')"
  case "$mode" in
    100644|100755) ;;
    *)
      echo "snapshot entry path is not a regular controller head blob: path_b64=$encoded_path" >&2
      exit 1
      ;;
  esac

  entry_json="$WORK_DIR/entry.json"
  head_content="$WORK_DIR/head-content"
  snapshot_content="$WORK_DIR/snapshot-content"
  jq --arg path "$path_value" '.files[] | select(.path == $path)' "$SNAPSHOT_FILE" > "$entry_json"

  git cat-file blob "$CONTROLLER_HEAD_SHA:$path_value" > "$head_content"
  expected_lines="$(awk 'END{print NR}' < "$head_content")"
  expected_bytes="$(wc -c < "$head_content" | tr -d ' ')"
  expected_sha256="$(sha256_file "$head_content")"

  [ "$(jq -r '.lines' "$entry_json")" = "$expected_lines" ] || {
    echo "snapshot entry lines mismatch: path_b64=$encoded_path" >&2
    exit 1
  }
  [ "$(jq -r '.bytes' "$entry_json")" = "$expected_bytes" ] || {
    echo "snapshot entry bytes mismatch: path_b64=$encoded_path" >&2
    exit 1
  }
  [ "$(jq -r '.sha256' "$entry_json")" = "$expected_sha256" ] || {
    echo "snapshot entry sha256 mismatch: path_b64=$encoded_path" >&2
    exit 1
  }

  if jq -e 'has("content")' "$entry_json" >/dev/null; then
    jq -r '.content | @base64' "$entry_json" | tr -d '\r\n' | base64_decode_stream > "$snapshot_content"
    [ "$(sha256_file "$snapshot_content")" = "$expected_sha256" ] || {
      echo "snapshot entry content mismatch: path_b64=$encoded_path" >&2
      exit 1
    }
  fi
done < "$ACTUAL_SET"

printf 'SNAPSHOT_STATUS=valid\n'
printf 'SNAPSHOT_FILE=%s\n' "$SNAPSHOT_FILE"
printf 'SNAPSHOT_HEAD_SHA=%s\n' "$SNAPSHOT_HEAD_SHA"
printf 'SNAPSHOT_CHANGED_FILE_COUNT=%s\n' "$ACTUAL_COUNT"
