#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-}"

fail() {
  echo "$1" >&2
  exit 1
}

resolve_runtime() {
  local runtime_dir resolver physical_runtime_dir physical_resolver
  if [ -n "${DEVCANON_RUNTIME_DIR:-}" ]; then
    runtime_dir="$DEVCANON_RUNTIME_DIR"
  else
    runtime_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)/devcanon-runtime"
  fi

  [ -d "$runtime_dir" ] && [ ! -L "$runtime_dir" ] ||
    fail "devcanon-runtime directory missing or unsafe for pr-review leases"
  physical_runtime_dir="$(cd "$runtime_dir" && pwd -P)"
  resolver="$physical_runtime_dir/scripts/devcanon-runtime.sh"
  [ -f "$resolver" ] && [ -x "$resolver" ] && [ ! -L "$resolver" ] ||
    fail "devcanon-runtime entrypoint missing or unsafe for pr-review leases"
  physical_resolver="$(cd "$(dirname "$resolver")" && pwd -P)/$(basename "$resolver")"
  case "$physical_resolver" in
    "$physical_runtime_dir"/*) ;;
    *) fail "devcanon-runtime entrypoint escapes packaged runtime directory" ;;
  esac
  if [ "$physical_resolver" != "$resolver" ]; then
    fail "devcanon-runtime entrypoint identity mismatch"
  fi
  printf '%s\n' "$resolver"
}

case "$command_name" in
  derive-path | discover | write | record-audit-failure | validate | read-status | inspect-worktree | cleanup-worktree)
    runtime="$(resolve_runtime)"
    PR_REVIEW_LEASE_HELPER_SCRIPT="${BASH_SOURCE[0]}" \
      exec "$runtime" runtime pr-review-leases "$command_name"
    ;;
  *)
    fail "usage: review-leases.sh derive-path|discover|write|record-audit-failure|validate|read-status|inspect-worktree|cleanup-worktree"
    ;;
esac
