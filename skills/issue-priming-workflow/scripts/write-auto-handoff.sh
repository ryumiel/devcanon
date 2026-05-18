#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "$name is required" >&2
    exit 1
  fi
}

require_env PLAN_PATH

command -v jq >/dev/null 2>&1 || {
  echo "jq is required to write issue-priming/auto-handoff/v1" >&2
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
  echo "write-auto-handoff.sh must run from the repository root" >&2
  exit 1
}

case "$PLAN_PATH" in
  .ephemeral/*/*)
    echo "nested plan path rejected: $PLAN_PATH" >&2
    exit 1
    ;;
  .ephemeral/*-plan.md) ;;
  *)
    echo "plan path validation failed: $PLAN_PATH" >&2
    exit 1
    ;;
esac
[ "${PLAN_PATH#*..}" = "$PLAN_PATH" ] || {
  echo "path traversal: $PLAN_PATH" >&2
  exit 1
}
[ -L .ephemeral ] && {
  echo ".ephemeral must be a directory, not a symlink" >&2
  exit 1
}
[ ! -L "$PLAN_PATH" ] || {
  echo "plan must not be a symlink: $PLAN_PATH" >&2
  exit 1
}
[ -f "$PLAN_PATH" ] || {
  echo "plan missing or not a regular file: $PLAN_PATH" >&2
  exit 1
}
[ -r "$PLAN_PATH" ] || {
  echo "plan missing or unreadable: $PLAN_PATH" >&2
  exit 1
}

ISSUE_PRIMING_AUTO_HEAD="$(git rev-parse HEAD)"
case "$ISSUE_PRIMING_AUTO_HEAD" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *)
    echo "git rev-parse HEAD did not return a 40-character lowercase hex SHA" >&2
    exit 1
    ;;
esac

AUTO_HANDOFF_FILE=".ephemeral/issue-priming-auto-handoff-${ISSUE_PRIMING_AUTO_HEAD}.json"
[ -L .ephemeral ] && {
  echo ".ephemeral must be a directory, not a symlink" >&2
  exit 1
}
mkdir -p .ephemeral
[ ! -L "$AUTO_HANDOFF_FILE" ] || {
  echo "auto handoff must not be a symlink: $AUTO_HANDOFF_FILE" >&2
  exit 1
}
[ ! -d "$AUTO_HANDOFF_FILE" ] || {
  echo "auto handoff path is a directory: $AUTO_HANDOFF_FILE" >&2
  exit 1
}
[ ! -e "$AUTO_HANDOFF_FILE" ] || [ -f "$AUTO_HANDOFF_FILE" ] || {
  echo "auto handoff path exists but is not a regular file: $AUTO_HANDOFF_FILE" >&2
  exit 1
}

AUTO_HANDOFF_TMP="$(mktemp ".ephemeral/issue-priming-auto-handoff.XXXXXX")"
trap 'rm -f "$AUTO_HANDOFF_TMP"' EXIT
jq -n --arg plan "$PLAN_PATH" --arg head "$ISSUE_PRIMING_AUTO_HEAD" '{
  schema: "issue-priming/auto-handoff/v1",
  phase: "issue-priming-workflow:6",
  mode: "auto",
  plan_path: $plan,
  head_sha: $head,
  phase7_branch_review_fix_required: true,
  phase7_rerun_after_commits: true
}' > "$AUTO_HANDOFF_TMP"
mv "$AUTO_HANDOFF_TMP" "$AUTO_HANDOFF_FILE"
trap - EXIT
printf '%s\n' "$AUTO_HANDOFF_FILE"
