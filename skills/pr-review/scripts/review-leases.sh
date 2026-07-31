#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-}"

fail() {
  echo "$1" >&2
  exit 1
}

runtime_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
logical_runtime="$runtime_script_dir/../../devcanon-runtime/scripts/devcanon-runtime.sh"
physical_runtime="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/../../devcanon-runtime/scripts/devcanon-runtime.sh"

if [ -x "$logical_runtime" ]; then
  trusted_runtime=$logical_runtime
elif [ -x "$physical_runtime" ]; then
  trusted_runtime=$physical_runtime
else
  fail "devcanon-runtime entrypoint missing for pr-review leases"
fi

case "$command_name" in
  derive-path | discover | session-create | write | record-audit-failure | validate | read-status | inspect-worktree | cleanup-worktree)
    if [ -n "${DEVCANON_RUNTIME_DIR:-}" ]; then
      PR_REVIEW_LEASE_HELPER_SCRIPT="${BASH_SOURCE[0]}" \
        exec "$trusted_runtime" bootstrap --runtime-dir "$DEVCANON_RUNTIME_DIR" -- pr-review-leases "$command_name" "${@:2}"
    fi
    PR_REVIEW_LEASE_HELPER_SCRIPT="${BASH_SOURCE[0]}" \
      exec "$trusted_runtime" runtime pr-review-leases "$command_name" "${@:2}"
    ;;
  *)
    fail "usage: review-leases.sh derive-path|discover|session-create|write|record-audit-failure|validate|read-status|inspect-worktree|cleanup-worktree"
    ;;
esac
