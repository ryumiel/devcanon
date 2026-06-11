#!/usr/bin/env bash
set -euo pipefail

runtime_error() {
  printf '%s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage:
  devcanon-runtime.sh contract
  devcanon-runtime.sh resolve-entrypoint --from <adapter-path> [--entrypoint <relative-path>]
EOF
}

contract() {
  printf '{"command_group":"devcanon-runtime","major_version":1}\n'
}

is_executable_file() {
  local runtime_dir=$1
  local candidate_entrypoint=$2

  [ -f "$candidate_entrypoint" ] && [ -x "$candidate_entrypoint" ] && [ ! -L "$candidate_entrypoint" ] || return 1

  local physical_runtime_dir
  physical_runtime_dir="$(cd "$runtime_dir" && pwd -P)" || return 1
  local physical_entrypoint_dir
  physical_entrypoint_dir="$(cd "$(dirname "$candidate_entrypoint")" && pwd -P)" || return 1
  local physical_entrypoint="$physical_entrypoint_dir/$(basename "$candidate_entrypoint")"

  case "$physical_entrypoint" in
    "$physical_runtime_dir"/*) return 0 ;;
    *) return 1 ;;
  esac
}

runtime_entrypoint() {
  local runtime_dir=$1
  local entrypoint=$2
  printf '%s\n' "$runtime_dir/$entrypoint"
}

resolve_from_root() {
  local skills_root=$1
  local entrypoint=$2
  local candidate_runtime="$skills_root/devcanon-runtime"
  local candidate_entrypoint
  candidate_entrypoint="$(runtime_entrypoint "$candidate_runtime" "$entrypoint")"

  if is_executable_file "$candidate_runtime" "$candidate_entrypoint"; then
    printf '%s\n' "$candidate_entrypoint"
    return 0
  fi

  return 1
}

resolve_entrypoint() {
  local from_path=
  local entrypoint="scripts/devcanon-runtime.sh"

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --from)
        [ "$#" -ge 2 ] || runtime_error "--from requires a path"
        from_path=$2
        shift 2
        ;;
      --entrypoint)
        [ "$#" -ge 2 ] || runtime_error "--entrypoint requires a relative path"
        entrypoint=$2
        case "$entrypoint" in
          /* | *../* | ../* | *"/.." | *"/../"* )
            runtime_error "--entrypoint must be a relative path inside devcanon-runtime"
            ;;
        esac
        shift 2
        ;;
      *)
        runtime_error "unknown devcanon-runtime resolve-entrypoint argument: $1"
        ;;
    esac
  done

  [ -n "$from_path" ] || runtime_error "--from requires a path"

  if [ -n "${DEVCANON_RUNTIME_DIR:-}" ]; then
    local override_entrypoint
    override_entrypoint="$(runtime_entrypoint "$DEVCANON_RUNTIME_DIR" "$entrypoint")"
    if is_executable_file "$DEVCANON_RUNTIME_DIR" "$override_entrypoint"; then
      printf '%s\n' "$override_entrypoint"
      return 0
    fi
    runtime_error "devcanon-runtime entrypoint missing: $override_entrypoint. DEVCANON_RUNTIME_DIR must point to a packaged devcanon-runtime skill directory containing executable runtime files."
  fi

  local adapter_dir
  adapter_dir="$(cd "$(dirname "$from_path")" && pwd)"
  local logical_skills_root
  logical_skills_root="$(cd "$adapter_dir/../.." && pwd)"
  if resolve_from_root "$logical_skills_root" "$entrypoint"; then
    return 0
  fi

  local physical_adapter_dir
  physical_adapter_dir="$(cd "$(dirname "$from_path")" && pwd -P)"
  local physical_skills_root
  physical_skills_root="$(cd "$physical_adapter_dir/../.." && pwd -P)"
  if [ "$physical_skills_root" != "$logical_skills_root" ]; then
    if resolve_from_root "$physical_skills_root" "$entrypoint"; then
      return 0
    fi
  fi

  runtime_error "devcanon-runtime entrypoint missing: $logical_skills_root/devcanon-runtime/$entrypoint. Ensure generated previews or installed skill homes include the sibling devcanon-runtime support skill, rerun devcanon render/sync, or set DEVCANON_RUNTIME_DIR for tests."
}

main() {
  local command=${1:-}
  case "$command" in
    contract)
      shift
      [ "$#" -eq 0 ] || runtime_error "contract does not accept arguments"
      contract
      ;;
    resolve-entrypoint)
      shift
      resolve_entrypoint "$@"
      ;;
    -h | --help | help)
      usage
      ;;
    *)
      usage >&2
      runtime_error "unknown devcanon-runtime command: ${command:-<missing>}"
      ;;
  esac
}

main "$@"
