#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-}"

fail() {
  echo "$1" >&2
  exit 1
}

resolve_runtime() {
  local resolver
  resolver="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../devcanon-runtime/scripts" && pwd)/devcanon-runtime.sh"
  if [ -x "$resolver" ]; then
    printf '%s\n' "$resolver"
    return
  fi
  if command -v devcanon-runtime.sh >/dev/null 2>&1; then
    command -v devcanon-runtime.sh
    return
  fi
  fail "devcanon-runtime entrypoint missing for pr-review leases"
}

case "$command_name" in
  derive-path | write | validate | read-status | inspect-worktree | cleanup-worktree)
    runtime="$(resolve_runtime)"
    exec "$runtime" runtime pr-review-leases "$command_name"
    ;;
  *)
    fail "usage: review-leases.sh derive-path|write|validate|read-status|inspect-worktree|cleanup-worktree"
    ;;
esac
