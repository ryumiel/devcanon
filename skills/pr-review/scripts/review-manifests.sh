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
  fail "devcanon-runtime entrypoint missing for pr-review manifests"
}

case "$command_name" in
  prepare-handoff-write | write-handoff | validate-handoff | prepare-result-write | write-result | validate-result)
    runtime="$(resolve_runtime)"
    PR_REVIEW_MANIFEST_HELPER_SCRIPT="${BASH_SOURCE[0]}" \
      exec "$runtime" runtime pr-review-manifests "$command_name"
    ;;
  *)
    fail "usage: review-manifests.sh prepare-handoff-write|write-handoff|validate-handoff|prepare-result-write|write-result|validate-result"
    ;;
esac
