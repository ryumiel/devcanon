#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-}"

fail() {
  echo "$1" >&2
  exit 1
}

resolve_runtime() {
  local script_path="${BASH_SOURCE[0]}"
  local skills_root
  skills_root="$(cd "$(dirname "$script_path")/../.." && pwd)"
  local runtime_resolver="$skills_root/devcanon-runtime/scripts/devcanon-runtime.sh"
  if [ -n "${DEVCANON_RUNTIME_DIR:-}" ]; then
    [ -d "$DEVCANON_RUNTIME_DIR" ] && [ ! -L "$DEVCANON_RUNTIME_DIR" ] ||
      fail "DEVCANON_RUNTIME_DIR must name a packaged runtime directory"
    runtime_resolver="$DEVCANON_RUNTIME_DIR/scripts/devcanon-runtime.sh"
  fi
  [ -x "$runtime_resolver" ] ||
    fail "devcanon-runtime resolver missing for pr-review leases"
  "$runtime_resolver" resolve-entrypoint \
    --from "$script_path" \
    --entrypoint "scripts/devcanon-runtime.sh"
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
