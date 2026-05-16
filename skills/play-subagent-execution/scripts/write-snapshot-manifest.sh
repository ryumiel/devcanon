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
require_env SNAPSHOT_TASK_ID

sha256_stream() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    echo "shasum or sha256sum is required to write implementer/snapshot/v1" >&2
    exit 1
  fi
}

sha256_file() {
  local path="$1"
  sha256_stream < "$path"
}

base64_file() {
  local path="$1"
  base64_stream < "$path"
}

base64_stream() {
  if command -v base64 >/dev/null 2>&1; then
    base64 | tr -d '\r\n'
  else
    echo "base64 is required to write implementer/snapshot/v1" >&2
    exit 1
  fi
}

make_temp_file() {
  local name="$1"
  mktemp "$SNAPSHOT_WORK_DIR/$name.XXXXXX"
}

content_round_trips_through_jq() {
  local path="$1"
  local raw_json original_base64 roundtrip_base64 result=1

  raw_json=$(make_temp_file raw-json)

  if jq -n --rawfile content "$path" '$content' > "$raw_json"; then
    original_base64=$(base64_file "$path")
    if roundtrip_base64=$(jq -rj '@base64' "$raw_json") &&
      [ "$original_base64" = "$roundtrip_base64" ]; then
      result=0
    fi
  fi

  return "$result"
}

path_round_trips_through_jq() {
  local path="$1"
  local raw_json original_base64 roundtrip_base64 result=1

  raw_json=$(make_temp_file path-json)

  if jq -n --arg path "$path" '$path' > "$raw_json"; then
    original_base64=$(printf '%s' "$path" | base64_stream)
    if roundtrip_base64=$(jq -rj '@base64' "$raw_json") &&
      [ "$original_base64" = "$roundtrip_base64" ]; then
      result=0
    fi
  fi

  return "$result"
}

command -v jq >/dev/null 2>&1 || {
  echo "jq is required to write implementer/snapshot/v1" >&2
  exit 1
}

git rev-parse --verify "${BASE_SHA}^{commit}" >/dev/null
HEAD_SHA=$(git rev-parse HEAD)

RAW_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$RAW_BRANCH" = HEAD ]; then
  BRANCH_SLUG=detached
else
  BRANCH_SLUG=$(printf '%s' "$RAW_BRANCH" | tr '/' '-' | tr -cd '[:alnum:]._-')
  while [ "${BRANCH_SLUG#*..}" != "$BRANCH_SLUG" ]; do
    BRANCH_SLUG=${BRANCH_SLUG//../.}
  done
  case "$BRANCH_SLUG" in
    ''|.|..|-*|.*) BRANCH_SLUG=unnamed ;;
  esac
fi

SNAPSHOT_FILE=".ephemeral/${BRANCH_SLUG}-${HEAD_SHA}-snapshot.json"
SNAPSHOT_TMP=""
SNAPSHOT_WORK_DIR=""

[ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink" >&2; exit 1; }
mkdir -p .ephemeral
[ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink" >&2; exit 1; }
SNAPSHOT_WORK_DIR=$(mktemp -d ".ephemeral/.${BRANCH_SLUG}-${HEAD_SHA}-snapshot-work.XXXXXX")
SNAPSHOT_TMP=$(mktemp "$SNAPSHOT_WORK_DIR/snapshot.XXXXXX")

STATUS_FILE=$(make_temp_file status)
NUMSTAT_FILE=$(make_temp_file numstat)
FILES_JSON=$(make_temp_file files)
ENTRY_JSON=$(make_temp_file entry)
NEXT_JSON=$(make_temp_file next)
CONTENT_FILE=$(make_temp_file content)
trap '[ -z "${SNAPSHOT_TMP:-}" ] || rm -f "$SNAPSHOT_TMP"; [ -z "${SNAPSHOT_WORK_DIR:-}" ] || rm -rf "$SNAPSHOT_WORK_DIR"' EXIT

git diff -z --name-status --no-renames "${BASE_SHA}..HEAD" > "$STATUS_FILE"
[ -s "$STATUS_FILE" ] || { echo "snapshot has no changed files" >&2; exit 1; }

git diff -z --numstat --no-renames "${BASE_SHA}..HEAD" > "$NUMSTAT_FILE"

is_binary_path() {
  local needle="$1"
  local record tab added rest deleted candidate
  tab=$(printf '\t')
  while IFS= read -r -d '' record; do
    added=${record%%"$tab"*}
    rest=${record#*"$tab"}
    deleted=${rest%%"$tab"*}
    candidate=${rest#*"$tab"}
    if [ "$added" = "-" ] && [ "$deleted" = "-" ] && [ "$candidate" = "$needle" ]; then
      return 0
    fi
  done < "$NUMSTAT_FILE"
  return 1
}

reject_unsupported_changed_path() {
  local path="$1"

  case "$path" in
    ''|/*|.|..|./*|*/.|*/..|*'/./'*|*'/../'*|*'//'*)
      echo "unsupported repo-relative path for implementer/snapshot/v1: $path" >&2
      exit 1
      ;;
  esac

  if ! path_round_trips_through_jq "$path"; then
    echo "unsupported non-UTF-8 repo-relative path for implementer/snapshot/v1" >&2
    exit 1
  fi
}

reject_worktree_symlink_changed_path() {
  local path="$1"
  local rest="$path"
  local component current=""

  while [ -n "$rest" ]; do
    component=${rest%%/*}
    if [ "$component" = "$rest" ]; then
      rest=""
    else
      rest=${rest#*/}
    fi

    if [ -z "$current" ]; then
      current="$component"
    else
      current="$current/$component"
    fi

    if [ -L "$current" ]; then
      echo "symlink changed path is unsupported for implementer/snapshot/v1: $path" >&2
      exit 1
    fi
  done
}

reject_head_non_regular_path() {
  local path="$1"
  local mode

  mode=$(git ls-tree HEAD -- ":(literal)$path" | awk 'NR == 1 {print $1}')
  case "$mode" in
    100644|100755)
      ;;
    120000)
      echo "symlink changed path is unsupported for implementer/snapshot/v1: $path" >&2
      exit 1
      ;;
    *)
      echo "non-regular changed path is unsupported for implementer/snapshot/v1: $path" >&2
      exit 1
      ;;
  esac
}

printf '[]\n' > "$FILES_JSON"

while IFS= read -r -d '' git_status && IFS= read -r -d '' path; do
  case "$git_status" in
    A) status=added ;;
    M) status=modified ;;
    D) status=deleted ;;
    *)
      echo "unsupported git diff status $git_status for $path; implementer/snapshot/v1 only supports added, modified, deleted" >&2
      exit 1
      ;;
  esac

  reject_unsupported_changed_path "$path"

  if [ "$status" = deleted ]; then
    jq -n \
      --arg path "$path" \
      --arg status "$status" \
      '{path:$path,status:$status,lines:0,bytes:0,sha256:""}' \
      > "$ENTRY_JSON"
  else
    reject_worktree_symlink_changed_path "$path"
    reject_head_non_regular_path "$path"

    git cat-file blob "HEAD:$path" > "$CONTENT_FILE"
    lines=$(awk 'END{print NR}' < "$CONTENT_FILE")
    bytes=$(wc -c < "$CONTENT_FILE" | tr -d ' ')
    sha256=$(sha256_file "$CONTENT_FILE")

    if is_binary_path "$path"; then
      jq -n \
        --arg path "$path" \
        --arg status "$status" \
        --argjson lines "$lines" \
        --argjson bytes "$bytes" \
        --arg sha256 "$sha256" \
        '{path:$path,status:$status,lines:$lines,bytes:$bytes,sha256:$sha256,skipped:"binary"}' \
        > "$ENTRY_JSON"
    elif [ "$bytes" -gt 64000 ]; then
      jq -n \
        --arg path "$path" \
        --arg status "$status" \
        --argjson lines "$lines" \
        --argjson bytes "$bytes" \
        --arg sha256 "$sha256" \
        '{path:$path,status:$status,lines:$lines,bytes:$bytes,sha256:$sha256,skipped:"size>64KB"}' \
        > "$ENTRY_JSON"
    elif ! content_round_trips_through_jq "$CONTENT_FILE"; then
      jq -n \
        --arg path "$path" \
        --arg status "$status" \
        --argjson lines "$lines" \
        --argjson bytes "$bytes" \
        --arg sha256 "$sha256" \
        '{path:$path,status:$status,lines:$lines,bytes:$bytes,sha256:$sha256,skipped:"binary"}' \
        > "$ENTRY_JSON"
    else
      jq -n \
        --arg path "$path" \
        --arg status "$status" \
        --argjson lines "$lines" \
        --argjson bytes "$bytes" \
        --arg sha256 "$sha256" \
        --rawfile content "$CONTENT_FILE" \
        '{path:$path,status:$status,lines:$lines,bytes:$bytes,sha256:$sha256,content:$content}' \
        > "$ENTRY_JSON"
    fi
  fi

  jq -n \
    --slurpfile files "$FILES_JSON" \
    --slurpfile entry "$ENTRY_JSON" \
    '$files[0] + [$entry[0]]' \
    > "$NEXT_JSON"
  mv "$NEXT_JSON" "$FILES_JSON"
done < "$STATUS_FILE"

jq -n \
  --arg schema "implementer/snapshot/v1" \
  --arg task_id "$SNAPSHOT_TASK_ID" \
  --arg head_sha "$HEAD_SHA" \
  --slurpfile files "$FILES_JSON" \
  '{schema:$schema,task_id:$task_id,head_sha:$head_sha,files:$files[0]}' \
  > "$SNAPSHOT_TMP"

[ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink" >&2; exit 1; }
[ -s "$SNAPSHOT_TMP" ] || { echo "snapshot write failed: $SNAPSHOT_FILE" >&2; exit 1; }
[ -d "$SNAPSHOT_FILE" ] && { echo "snapshot path is a directory: $SNAPSHOT_FILE" >&2; exit 1; }
mv -f "$SNAPSHOT_TMP" "$SNAPSHOT_FILE"
SNAPSHOT_TMP=""
[ -f "$SNAPSHOT_FILE" ] || { echo "snapshot write failed: $SNAPSHOT_FILE is not a regular file" >&2; exit 1; }
[ -s "$SNAPSHOT_FILE" ] || { echo "snapshot write failed: $SNAPSHOT_FILE" >&2; exit 1; }
printf 'Snapshot written to %s.\n' "$SNAPSHOT_FILE"
