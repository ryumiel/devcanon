#!/usr/bin/env bash
set -euo pipefail

runtime_error() {
  printf '%s\n' "$*" >&2
  exit 1
}

command_name="${1:-}"
case "$command_name" in
  build-review-context) ;;
  *) runtime_error "usage: shared-review-context.sh build-review-context" ;;
esac

script_path="${BASH_SOURCE[0]}"
script_dir="$(cd "$(dirname "$script_path")" && pwd -P)"
skills_root="$(cd "$script_dir/../.." && pwd)"
runtime_resolver="$skills_root/devcanon-runtime/scripts/devcanon-runtime.sh"
[ -x "$runtime_resolver" ] || runtime_error "devcanon-runtime resolver missing: $runtime_resolver"

runtime_entrypoint="$("$runtime_resolver" resolve-entrypoint --from "$script_path" --entrypoint "scripts/devcanon-runtime.sh")"
exec "$runtime_entrypoint" runtime play-review-shared-context "$@"
