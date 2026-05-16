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

sha256_file() {
  local path="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 < "$path" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum < "$path" | awk '{print $1}'
  else
    echo "shasum or sha256sum is required to write implementer/snapshot/v1" >&2
    exit 1
  fi
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
  case "$BRANCH_SLUG" in
    ''|.|..|-*|.*) BRANCH_SLUG=unnamed ;;
  esac
fi

SNAPSHOT_FILE=".ephemeral/${BRANCH_SLUG}-${HEAD_SHA}-snapshot.json"

[ -L .ephemeral ] && { echo ".ephemeral must be a directory, not a symlink" >&2; exit 1; }
mkdir -p .ephemeral
[ -L "$SNAPSHOT_FILE" ] && rm "$SNAPSHOT_FILE"

STATUS_FILE=$(mktemp)
NUMSTAT_FILE=$(mktemp)
FILES_JSON=$(mktemp)
ENTRY_JSON=$(mktemp)
NEXT_JSON=$(mktemp)
CONTENT_FILE=$(mktemp)
trap 'rm -f "$STATUS_FILE" "$NUMSTAT_FILE" "$FILES_JSON" "$ENTRY_JSON" "$NEXT_JSON" "$CONTENT_FILE"' EXIT

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

reject_symlink_changed_path() {
  local path="$1"
  local rest="$path"
  local component current=""

  case "$path" in
    ''|/*|.|..|./*|*/.|*/..|*'/./'*|*'/../'*|*'//'*)
      echo "unsupported repo-relative path for implementer/snapshot/v1: $path" >&2
      exit 1
      ;;
  esac

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

  if [ "$status" = deleted ]; then
    jq -n \
      --arg path "$path" \
      --arg status "$status" \
      '{path:$path,status:$status,lines:0,bytes:0,sha256:""}' \
      > "$ENTRY_JSON"
  else
    reject_symlink_changed_path "$path"

    lines=$(awk 'END{print NR}' < "$path")
    bytes=$(wc -c < "$path" | tr -d ' ')
    sha256=$(sha256_file "$path")

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
    else
      cat < "$path" > "$CONTENT_FILE"
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
  > "$SNAPSHOT_FILE"

[ -s "$SNAPSHOT_FILE" ] || { echo "snapshot write failed: $SNAPSHOT_FILE" >&2; exit 1; }
printf 'Snapshot written to %s.\n' "$SNAPSHOT_FILE"
