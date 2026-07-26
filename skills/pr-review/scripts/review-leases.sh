#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-}"

fail() {
  echo "$1" >&2
  exit 1
}

runtime_override_inspection_path() {
  local output_variable=$1
  local override_path=$2
  local scan_path=$override_path
  local windows_path_semantics=false

  if builtin pwd -W >/dev/null 2>&1; then
    windows_path_semantics=true
    scan_path=${scan_path//\\//}
  fi

  case "/$scan_path/" in
    */../*)
      fail "DEVCANON_RUNTIME_DIR must not contain a parent-directory component"
      ;;
  esac

  local candidate_inspection_path=$scan_path
  while true; do
    case "$candidate_inspection_path" in
      / | [A-Za-z]:/ | //\?/[A-Za-z]:/)
        break
        ;;
      */.)
        candidate_inspection_path=${candidate_inspection_path%/.}
        ;;
      */)
        candidate_inspection_path=${candidate_inspection_path%/}
        ;;
      *)
        break
        ;;
    esac
  done

  if [ "$windows_path_semantics" = false ]; then
    candidate_inspection_path=$override_path
    while true; do
      case "$candidate_inspection_path" in
        /)
          break
          ;;
        */.)
          candidate_inspection_path=${candidate_inspection_path%/.}
          ;;
        */)
          candidate_inspection_path=${candidate_inspection_path%/}
          ;;
        *)
          break
          ;;
      esac
    done
  fi

  printf -v "$output_variable" '%s' "$candidate_inspection_path"
}

resolve_runtime() {
  local resolver
  if [ -n "${DEVCANON_RUNTIME_DIR:-}" ]; then
    local inspection_path
    runtime_override_inspection_path inspection_path "$DEVCANON_RUNTIME_DIR"
    if [ ! -d "$DEVCANON_RUNTIME_DIR" ] || [ -L "$inspection_path" ]; then
      fail "DEVCANON_RUNTIME_DIR must name a non-symlink packaged runtime directory"
    fi
    resolver="$DEVCANON_RUNTIME_DIR/scripts/devcanon-runtime.sh"
    if [ ! -x "$resolver" ]; then
      fail "devcanon-runtime resolver missing from DEVCANON_RUNTIME_DIR"
    fi
    "$resolver" resolve-entrypoint \
      --from "${BASH_SOURCE[0]}" \
      --entrypoint "scripts/devcanon-runtime.sh"
    return
  fi

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
  derive-path | write | record-audit-failure | validate | read-status | inspect-worktree | cleanup-worktree)
    runtime="$(resolve_runtime)"
    PR_REVIEW_LEASE_HELPER_SCRIPT="${BASH_SOURCE[0]}" \
      exec "$runtime" runtime pr-review-leases "$command_name"
    ;;
  *)
    fail "usage: review-leases.sh derive-path|write|record-audit-failure|validate|read-status|inspect-worktree|cleanup-worktree"
    ;;
esac
