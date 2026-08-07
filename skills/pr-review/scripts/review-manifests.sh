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
  replace-findings)
    runtime="$(resolve_runtime)"
    PR_REVIEW_MANIFEST_HELPER_SCRIPT="${BASH_SOURCE[0]}" \
      exec "$runtime" runtime pr-review-manifests "$@"
    ;;
  prepare-handoff-write | write-handoff | validate-handoff | prepare-result-write | write-result | validate-result | read-result-for-preview | write-review-body | recover-review-body-publication | render-phase5-audit-summary)
    runtime="$(resolve_runtime)"
    PR_REVIEW_MANIFEST_HELPER_SCRIPT="${BASH_SOURCE[0]}" \
      exec "$runtime" runtime pr-review-manifests "$@"
    ;;
  *)
    fail "usage: review-manifests.sh prepare-handoff-write|write-handoff|validate-handoff|prepare-result-write|write-result|validate-result|read-result-for-preview|write-review-body|recover-review-body-publication|replace-findings|render-phase5-audit-summary
replace-findings: run from the target worktree root with PR_NUMBER, HEAD_SHA, REPOSITORY, RESULT_FILE, and PLAY_REVIEW_HELPER; pass exactly one complete findings envelope on stdin and no extra arguments; stdout is the canonical rebound result path; concurrent ownership or any other refusal exits nonzero before continuation"
    ;;
esac
