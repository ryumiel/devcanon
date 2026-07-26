#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-}"
if [ "$#" -gt 0 ]; then
  shift
fi

fail() {
  echo "$1" >&2
  exit 1
}

resolve_runtime() {
  local script_source="${BASH_SOURCE[0]}"
  local script_name
  script_name="$(basename "$script_source")"
  if [ -n "${DEVCANON_RUNTIME_DIR:-}" ]; then
    [ -d "$DEVCANON_RUNTIME_DIR" ] && [ ! -L "$DEVCANON_RUNTIME_DIR" ] ||
      fail "DEVCANON_RUNTIME_DIR must name a packaged runtime directory"
    local override_resolver="$DEVCANON_RUNTIME_DIR/scripts/devcanon-runtime.sh"
    [ -x "$override_resolver" ] ||
      fail "devcanon-runtime resolver missing for pr-review leases"
    "$override_resolver" resolve-entrypoint \
      --from "$script_source" \
      --entrypoint "scripts/devcanon-runtime.sh"
    return
  fi

  local logical_script_dir
  logical_script_dir="$(cd "$(dirname "$script_source")" && pwd -L)"
  local physical_script_dir
  physical_script_dir="$(cd "$(dirname "$script_source")" && pwd -P)"
  local from_path
  for from_path in \
    "$logical_script_dir/$script_name" \
    "$physical_script_dir/$script_name"; do
    local skills_root
    skills_root="$(cd "$(dirname "$from_path")/../.." && pwd -L)"
    local runtime_resolver="$skills_root/devcanon-runtime/scripts/devcanon-runtime.sh"
    if [ -x "$runtime_resolver" ]; then
      local runtime
      if runtime="$(
        "$runtime_resolver" resolve-entrypoint \
          --from "$from_path" \
          --entrypoint "scripts/devcanon-runtime.sh"
      )"; then
        printf '%s\n' "$runtime"
        return
      fi
    fi
  done

  fail "devcanon-runtime resolver missing for pr-review leases"
}

case "$command_name" in
  derive-path | discover | validate-discovery | write | record-audit-failure | validate | read-status | inspect-worktree | cleanup-worktree)
    runtime="$(resolve_runtime)"
    PR_REVIEW_LEASE_HELPER_SCRIPT="${BASH_SOURCE[0]}" \
      exec "$runtime" runtime pr-review-leases "$command_name" "$@"
    ;;
  *)
    fail "usage: review-leases.sh derive-path|discover|validate-discovery|write|record-audit-failure|validate|read-status|inspect-worktree|cleanup-worktree"
    ;;
esac
