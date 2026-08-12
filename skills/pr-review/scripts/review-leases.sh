#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--help" ]; then
  [ "$#" -eq 1 ] || { echo "--help does not accept additional arguments" >&2; exit 1; }
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  usage_document="$script_dir/../references/review-leases-usage.md"
  [ -f "$usage_document" ] && [ -r "$usage_document" ] || { echo "usage document missing or unreadable: $usage_document" >&2; exit 1; }
  cat "$usage_document"
  exit 0
fi

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
