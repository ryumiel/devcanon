#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--help" ]; then
  [ "$#" -eq 1 ] || { echo "--help does not accept additional arguments" >&2; exit 1; }
  help_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  usage_document="$help_script_dir/../references/shared-review-context-usage.md"
  [ -f "$usage_document" ] && [ -r "$usage_document" ] || { echo "usage document missing or unreadable: $usage_document" >&2; exit 1; }
  cat "$usage_document"
  exit 0
fi

runtime_error() {
  printf '%s\n' "$*" >&2
  exit 1
}

command_name="${1:-}"
case "$command_name" in
  write-review-context-input) ;;
  build-review-context) ;;
  *)
    runtime_error "usage: shared-review-context.sh write-review-context-input|build-review-context"
    ;;
esac

script_path="${BASH_SOURCE[0]}"
script_dir="$(cd "$(dirname "$script_path")" && pwd -P)"
skills_root="$(cd "$script_dir/../.." && pwd)"
runtime_resolver="$skills_root/devcanon-runtime/scripts/devcanon-runtime.sh"
if [ -n "${DEVCANON_RUNTIME_DIR:-}" ]; then
  runtime_resolver="$DEVCANON_RUNTIME_DIR/scripts/devcanon-runtime.sh"
fi
[ -x "$runtime_resolver" ] || runtime_error "devcanon-runtime resolver missing for play-review shared context"

runtime_entrypoint="$("$runtime_resolver" resolve-entrypoint --from "$script_path" --entrypoint "scripts/devcanon-runtime.sh")"
exec "$runtime_entrypoint" runtime play-review-shared-context "$@"
