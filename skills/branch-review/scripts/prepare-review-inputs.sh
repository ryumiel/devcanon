#!/usr/bin/env bash
set -euo pipefail

BASE_ARG=""
FIX_MODE=false
LAST_REVIEWED_SHA=""
PRIOR_FINDINGS_FILE=""
RISK_SIGNALS_FILE=""
RISK_SIGNALS_STATUS="absent"
SCOPE_DECISION_FILE=""
APPROVAL_SUMMARY_FILE=""
CHANGED_FILES_FILE=""
GOVERNED_PATH_PATTERN='^(docs/(adr|arch|product-requirements|specs|guidelines)/|MAP\.md$|AGENTS\.md$|CONTRIBUTING\.md$)'
MAX_NARROW_CHANGED_FILES=5

emit_line() {
  local key="$1"
  local value="$2"

  printf '%s=%s\n' "$key" "$value"
}

require_repo_root() {
  local git_toplevel
  local physical_toplevel
  local physical_pwd

  git_toplevel="$(git rev-parse --show-toplevel 2>/dev/null)" || {
    echo "failed to determine git repository root" >&2
    exit 1
  }
  physical_toplevel="$(cd "$git_toplevel" && pwd -P)" || {
    echo "failed to resolve git repository root" >&2
    exit 1
  }
  physical_pwd="$(pwd -P)"
  [ "$physical_toplevel" = "$physical_pwd" ] || {
    echo "prepare-review-inputs.sh must run from the repository root" >&2
    exit 1
  }
}

resolve_base() {
  if [[ -n "$BASE_ARG" ]]; then
    printf '%s\n' "$BASE_ARG"
  elif symbolic_ref=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null); then
    printf '%s\n' "${symbolic_ref#origin/}"
  elif git show-ref --verify --quiet refs/remotes/origin/main; then
    printf 'main\n'
  elif git show-ref --verify --quiet refs/remotes/origin/master; then
    printf 'master\n'
  else
    printf 'main\n'
  fi
}

extract_prior_findings_head_sha() {
  printf '%s\n' "$PRIOR_FINDINGS_FILE" |
    sed -n 's/^\.ephemeral\/.*-\([0-9a-f]\{40\}\)-findings\.json$/\1/p'
}

validate_prior_findings() {
  if [[ -z "${PLAY_REVIEW_DIR:-}" ]]; then
    echo "PLAY_REVIEW_DIR is required when --prior-findings is supplied" >&2
    exit 1
  fi

  PLAY_REVIEW_HELPER="$PLAY_REVIEW_DIR/scripts/review-artifacts.sh"
  [ -r "$PLAY_REVIEW_HELPER" ] || {
    echo "play-review helper missing or unreadable: $PLAY_REVIEW_HELPER" >&2
    exit 1
  }

  PRIOR_FINDINGS_HEAD_SHA="$(extract_prior_findings_head_sha)"
  [ -n "$PRIOR_FINDINGS_HEAD_SHA" ] || {
    echo "prior findings path must include a 40-character review head" >&2
    exit 1
  }
  [ "$PRIOR_FINDINGS_HEAD_SHA" = "$LAST_REVIEWED_SHA" ] || {
    echo "--prior-findings review head must match --last-reviewed" >&2
    exit 1
  }
  HEAD_SHA="$PRIOR_FINDINGS_HEAD_SHA" FINDINGS_FILE="$PRIOR_FINDINGS_FILE" \
    bash "$PLAY_REVIEW_HELPER" validate-findings || exit 1
}

classify_risk_signals_path() {
  local file="$1"

  case "$file" in
    /*) return 1 ;;
    .ephemeral/*/*) return 1 ;;
    .ephemeral/*-risk-signals.json) ;;
    *) return 1 ;;
  esac
  [ "${file#*..}" = "$file" ] || return 1
}

branch_scope_helper() {
  if [[ -n "${BRANCH_REVIEW_SCOPE_HELPER:-}" ]]; then
    printf '%s\n' "$BRANCH_REVIEW_SCOPE_HELPER"
  else
    printf '%s\n' "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/scope-decision-artifacts.sh"
  fi
}

prepare_scope_decision_file() {
  local helper
  local review_head_sha

  helper="$(branch_scope_helper)"
  [[ -f "$helper" && -r "$helper" ]] || {
    echo "branch-review scope helper missing or unreadable: $helper" >&2
    exit 1
  }
  review_head_sha="$(git rev-parse HEAD 2>/dev/null)" || {
    echo "failed to resolve HEAD" >&2
    exit 1
  }
  SCOPE_DECISION_FILE="$(
    HEAD_SHA="$review_head_sha" bash "$helper" prepare-scope-decision-write
  )"
  APPROVAL_SUMMARY_FILE="$(
    HEAD_SHA="$review_head_sha" bash "$helper" prepare-approval-summary-write
  )"
}

validate_scope_decision() {
  local helper

  helper="$(branch_scope_helper)"
  HEAD_SHA="$HEAD_SHA" \
  SCOPE_DECISION_FILE="$SCOPE_DECISION_FILE" \
  PRIOR_BRANCH_FINDINGS="$PRIOR_FINDINGS_FILE" \
    bash "$helper" validate-scope-decision
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --fix)
        FIX_MODE=true
        shift
        ;;
      --last-reviewed)
        [ -n "${2:-}" ] || {
          echo "--last-reviewed requires a SHA" >&2
          exit 1
        }
        LAST_REVIEWED_SHA="$2"
        shift 2
        ;;
      --prior-findings)
        [ -n "${2:-}" ] || {
          echo "--prior-findings requires a path" >&2
          exit 1
        }
        PRIOR_FINDINGS_FILE="$2"
        shift 2
        ;;
      --risk-signals)
        [ -n "${2:-}" ] || {
          echo "--risk-signals requires a path" >&2
          exit 1
        }
        RISK_SIGNALS_FILE="$2"
        if classify_risk_signals_path "$RISK_SIGNALS_FILE"; then
          RISK_SIGNALS_STATUS="supplied"
        else
          RISK_SIGNALS_STATUS="invalid-path"
        fi
        shift 2
        ;;
      --*)
        echo "unknown branch-review argument: $1" >&2
        exit 1
        ;;
      *)
        [ -z "$BASE_ARG" ] || {
          echo "multiple base arguments supplied" >&2
          exit 1
        }
        BASE_ARG="$1"
        shift
        ;;
    esac
  done
}

write_changed_files_file() {
  local range="$1"

  if [[ -L ".ephemeral" ]]; then
    echo ".ephemeral must not be a symlink" >&2
    exit 1
  fi
  if [[ -e ".ephemeral" && ! -d ".ephemeral" ]]; then
    echo ".ephemeral exists but is not a directory" >&2
    exit 1
  fi
  mkdir -p ".ephemeral"

  CHANGED_FILES_FILE="$(mktemp ".ephemeral/branch-review-changed-files.XXXXXX")"
  git diff --name-only "$range" >"$CHANGED_FILES_FILE"
}

require_jq() {
  command -v jq >/dev/null 2>&1 || {
    echo "jq is required to prepare branch review inputs" >&2
    exit 1
  }
}

changed_files_json() {
  local range="$1"

  git diff -z --name-only "$range" |
    jq -R -s -c 'split("\u0000")[:-1] | sort'
}

language_hints_json_for_files() {
  jq -c '
    [
      .[]
      | select(test("\\.[A-Za-z0-9_+-]+$"))
      | capture("\\.(?<ext>[A-Za-z0-9_+-]+)$").ext
      | ascii_downcase
    ]
    | sort
    | unique
  '
}

changed_file_count() {
  local range="$1"

  changed_files_json "$range" | jq 'length'
}

sha_is_usable_followup() {
  local sha="$1"

  git cat-file -e "$sha^{commit}" 2>/dev/null &&
    git merge-base --is-ancestor "$sha" HEAD 2>/dev/null
}

regex_is_valid() {
  local pattern="$1"

  [ -n "$pattern" ] || return 1
  set +e
  grep -E -- "$pattern" /dev/null >/dev/null 2>&1
  local status=$?
  set -e
  [ "$status" -le 1 ]
}

any_changed_path_matches() {
  local range="$1"
  local pattern="$2"

  [ -n "$pattern" ] || return 1
  git diff --name-only "$range" | grep -E -- "$pattern" >/dev/null 2>&1
}

append_escalation_reason() {
  local reason="$1"

  if [ -z "$MECHANICAL_ESCALATION_REASON" ]; then
    MECHANICAL_ESCALATION_REASON="$reason"
  else
    MECHANICAL_ESCALATION_REASON="$MECHANICAL_ESCALATION_REASON,$reason"
  fi
}

# Compatibility note: write_scope_decision_artifact is no longer called here.
# Final artifacts are written by the scope adapter after wrapper semantic
# classification.
compute_scope_values() {
  local configured_pattern="${BRANCH_REVIEW_FULL_REVIEW_PATH_PATTERN:-}"

  HEAD_SHA="$(git rev-parse HEAD 2>/dev/null)" || {
    echo "failed to resolve HEAD" >&2
    exit 1
  }
  BASE="$(resolve_base)"
  FULL_DIFF_RANGE="$BASE...HEAD"
  CANDIDATE_ACTIVE_DIFF_RANGE="$FULL_DIFF_RANGE"
  MECHANICAL_ACTIVE_DIFF_RANGE="$FULL_DIFF_RANGE"
  MECHANICAL_IS_FOLLOWUP_NARROW=false
  MECHANICAL_ESCALATE_FULL=true
  MECHANICAL_ESCALATION_REASON=""
  FOLLOWUP_SHA_USABLE=false

  if [ -n "$configured_pattern" ] && ! regex_is_valid "$configured_pattern"; then
    echo "--configured-path-pattern must be a valid extended regular expression" >&2
    exit 1
  fi

  if [[ -z "$LAST_REVIEWED_SHA" ]]; then
    append_escalation_reason "not-followup"
    CHANGED_FILE_COUNT="$(changed_file_count "$FULL_DIFF_RANGE")"
  elif sha_is_usable_followup "$LAST_REVIEWED_SHA"; then
    FOLLOWUP_SHA_USABLE=true
    CANDIDATE_ACTIVE_DIFF_RANGE="$LAST_REVIEWED_SHA..HEAD"
    CHANGED_FILE_COUNT="$(changed_file_count "$CANDIDATE_ACTIVE_DIFF_RANGE")"

    if [ "$CHANGED_FILE_COUNT" -gt "$MAX_NARROW_CHANGED_FILES" ]; then
      append_escalation_reason "file-count"
    fi
    if any_changed_path_matches "$CANDIDATE_ACTIVE_DIFF_RANGE" "$GOVERNED_PATH_PATTERN"; then
      append_escalation_reason "governance-path"
    fi
    if regex_is_valid "$configured_pattern" &&
      any_changed_path_matches "$CANDIDATE_ACTIVE_DIFF_RANGE" "$configured_pattern"; then
      append_escalation_reason "configured-path"
    fi

    if [ -z "$MECHANICAL_ESCALATION_REASON" ]; then
      MECHANICAL_ACTIVE_DIFF_RANGE="$CANDIDATE_ACTIVE_DIFF_RANGE"
      MECHANICAL_IS_FOLLOWUP_NARROW=true
      MECHANICAL_ESCALATE_FULL=false
    fi
  else
    append_escalation_reason "last-reviewed-unusable"
    CHANGED_FILE_COUNT="$(changed_file_count "$FULL_DIFF_RANGE")"
  fi

  LANGUAGE_HINTS="$(changed_files_json "$MECHANICAL_ACTIVE_DIFF_RANGE" |
    language_hints_json_for_files |
    jq -r 'join(",")')"

  write_changed_files_file "$CANDIDATE_ACTIVE_DIFF_RANGE"
}

require_repo_root
require_jq
parse_args "$@"
prepare_scope_decision_file

if [[ -n "$LAST_REVIEWED_SHA" || -n "$PRIOR_FINDINGS_FILE" ]]; then
  if [[ -z "$LAST_REVIEWED_SHA" || -z "$PRIOR_FINDINGS_FILE" ]]; then
    echo "--last-reviewed and --prior-findings must be supplied together" >&2
    exit 1
  fi
  if [[ ! "$LAST_REVIEWED_SHA" =~ ^[0-9a-f]{40}$ ]]; then
    echo "--last-reviewed requires a 40-character lowercase hex SHA" >&2
    exit 1
  fi
  validate_prior_findings
fi
compute_scope_values

emit_line "BASE" "$BASE"
emit_line "FIX_MODE" "$FIX_MODE"
emit_line "RISK_SIGNALS_FILE" "$RISK_SIGNALS_FILE"
emit_line "RISK_SIGNALS_STATUS" "$RISK_SIGNALS_STATUS"
emit_line "FULL_DIFF_RANGE" "$FULL_DIFF_RANGE"
emit_line "CANDIDATE_ACTIVE_DIFF_RANGE" "$CANDIDATE_ACTIVE_DIFF_RANGE"
emit_line "MECHANICAL_ACTIVE_DIFF_RANGE" "$MECHANICAL_ACTIVE_DIFF_RANGE"
emit_line "MECHANICAL_IS_FOLLOWUP_NARROW" "$MECHANICAL_IS_FOLLOWUP_NARROW"
emit_line "MECHANICAL_ESCALATE_FULL" "$MECHANICAL_ESCALATE_FULL"
emit_line "MECHANICAL_ESCALATION_REASON" "$MECHANICAL_ESCALATION_REASON"
emit_line "FOLLOWUP_SHA_USABLE" "$FOLLOWUP_SHA_USABLE"
emit_line "CHANGED_FILE_COUNT" "$CHANGED_FILE_COUNT"
emit_line "CHANGED_FILES_FILE" "$CHANGED_FILES_FILE"
emit_line "LANGUAGE_HINTS" "$LANGUAGE_HINTS"
emit_line "LAST_REVIEWED_SHA" "$LAST_REVIEWED_SHA"
emit_line "PRIOR_BRANCH_FINDINGS" "$PRIOR_FINDINGS_FILE"
emit_line "SCOPE_DECISION_FILE" "$SCOPE_DECISION_FILE"
emit_line "APPROVAL_SUMMARY_FILE" "$APPROVAL_SUMMARY_FILE"
