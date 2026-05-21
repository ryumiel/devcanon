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

CONTROLLER_HEAD_SHA="${CONTROLLER_HEAD_SHA:-$(git rev-parse HEAD)}"
case "$CONTROLLER_HEAD_SHA" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *)
    echo "controller head SHA invalid: $CONTROLLER_HEAD_SHA" >&2
    exit 1
    ;;
esac

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

WORK_DIR="$(mktemp -d ".ephemeral/.snapshot-validate-${CONTROLLER_HEAD_SHA}.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT
EXPECTED_SET="$WORK_DIR/expected.tsv"
ACTUAL_SET="$WORK_DIR/actual.tsv"
EXPECTED_SORTED="$WORK_DIR/expected.sorted.tsv"
ACTUAL_SORTED="$WORK_DIR/actual.sorted.tsv"

git diff -z --name-status --no-renames "$BASE_SHA..$CONTROLLER_HEAD_SHA" > "$WORK_DIR/diff.z"
while IFS= read -r -d '' git_status && IFS= read -r -d '' path; do
  case "$git_status" in
    A) status="added" ;;
    M) status="modified" ;;
    D) status="deleted" ;;
    *)
      echo "unsupported controller diff status $git_status for $path" >&2
      exit 1
      ;;
  esac
  encoded_path="$(jq -Rn --arg path "$path" '$path | @base64')"
  printf '%s\t%s\n' "$encoded_path" "$status" >> "$EXPECTED_SET"
done < "$WORK_DIR/diff.z"
touch "$EXPECTED_SET"

while IFS= read -r encoded; do
  path_value="$(jq -rn --arg encoded "$encoded" '$encoded | @base64d | fromjson | .path // empty')"
  status_value="$(jq -rn --arg encoded "$encoded" '$encoded | @base64d | fromjson | .status // empty')"
  jq -en --arg encoded "$encoded" '$encoded | @base64d | fromjson | (.path | type == "string") and (.status | type == "string")' >/dev/null || {
    echo "snapshot file entries must include string path and status" >&2
    exit 1
  }
  case "$path_value" in
    ''|/*|.|..|../*|./*|*/.|*/..|*'/./'*|*'/../'*|*'//'*)
      echo "snapshot entry path validation failed: $path_value" >&2
      exit 1
      ;;
  esac
  case "$status_value" in
    added|modified|deleted) ;;
    *)
      echo "snapshot entry status unsupported: $status_value" >&2
      exit 1
      ;;
  esac
  encoded_path="$(jq -Rn --arg path "$path_value" '$path | @base64')"
  printf '%s\t%s\n' "$encoded_path" "$status_value" >> "$ACTUAL_SET"
done < <(jq -r '.files[] | @json | @base64' "$SNAPSHOT_FILE")
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

printf 'SNAPSHOT_STATUS=valid\n'
printf 'SNAPSHOT_FILE=%s\n' "$SNAPSHOT_FILE"
printf 'SNAPSHOT_HEAD_SHA=%s\n' "$SNAPSHOT_HEAD_SHA"
printf 'SNAPSHOT_CHANGED_FILE_COUNT=%s\n' "$ACTUAL_COUNT"
