#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "$1" >&2
  exit 1
}

require_env() {
  local name="$1"
  [ -n "${!name:-}" ] || fail "$name is required"
}

require_bool_env() {
  local name="$1"
  require_env "$name"
  case "${!name}" in
    true | false) ;;
    *) fail "$name must be true or false" ;;
  esac
}

require_sha_env() {
  local name="$1"
  require_env "$name"
  case "${!name}" in
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
    *) fail "$name must be a 40-character lowercase hex SHA" ;;
  esac
}

require_full_branch_range_env() {
  local name="$1"
  require_env "$name"
  case "${!name}" in
    *...HEAD)
      [ "${!name}" != "...HEAD" ] ||
        fail "$name must be a full branch range ending in ...HEAD"
      ;;
    *) fail "$name must be a full branch range ending in ...HEAD" ;;
  esac
}

require_repo_root() {
  local git_toplevel
  local physical_toplevel
  local physical_pwd

  git_toplevel="$(git rev-parse --show-toplevel 2>/dev/null)" ||
    fail "failed to determine git repository root"
  physical_toplevel="$(cd "$git_toplevel" && pwd -P)" ||
    fail "failed to resolve git repository root"
  physical_pwd="$(pwd -P)"
  [ "$physical_toplevel" = "$physical_pwd" ] ||
    fail "write-risk-signals.sh must run from the repository root"
}

slug_branch() {
  local branch_name="$1"
  local slug
  slug="$(printf '%s' "$branch_name" | LC_ALL=C tr -c 'A-Za-z0-9._-' '-')"
  case "$slug" in
    "" | "." | ".." | *..* | -* | .*) slug="unnamed" ;;
  esac
  printf '%s\n' "$slug"
}

branch_slug() {
  local raw_branch
  raw_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" ||
    fail "failed to determine current git branch"
  if [ "$raw_branch" = "HEAD" ]; then
    printf 'detached\n'
  else
    slug_branch "$raw_branch"
  fi
}

validator_from_dir() {
  local script_path="$1"
  local script_dir
  script_dir="$(cd "$(dirname "$script_path")" && pwd)" || return 1
  printf '%s\n' "$(cd "$script_dir/../.." && pwd)/play-validate-review-artifacts/scripts/review-artifacts.sh"
}

resolve_validator() {
  local logical_candidate=""
  local physical_source=""
  local physical_candidate=""

  if [ -n "${PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT:-}" ]; then
    [ -f "$PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT" ] &&
      [ -x "$PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT" ] ||
      fail "play-validate-review-artifacts validator missing"
    printf '%s\n' "$PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT"
    return
  fi

  logical_candidate="$(validator_from_dir "${BASH_SOURCE[0]}")" || true
  if [ -n "$logical_candidate" ] && [ -f "$logical_candidate" ] && [ -x "$logical_candidate" ]; then
    printf '%s\n' "$logical_candidate"
    return
  fi

  physical_source="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/$(basename "${BASH_SOURCE[0]}")"
  physical_candidate="$(validator_from_dir "$physical_source")" || true
  if [ -n "$physical_candidate" ] && [ -f "$physical_candidate" ] && [ -x "$physical_candidate" ]; then
    printf '%s\n' "$physical_candidate"
    return
  fi

  fail "play-validate-review-artifacts validator missing"
}

prepare_write_target() {
  local file="$1"

  [ -L .ephemeral ] && fail ".ephemeral must be a directory, not a symlink"
  mkdir -p .ephemeral
  [ ! -L "$file" ] || fail "risk-signals target must be a regular file: $file"
  [ ! -d "$file" ] || fail "risk-signals target must be a regular file: $file"
  [ ! -e "$file" ] || [ -f "$file" ] ||
    fail "risk-signals target must be a regular file: $file"
}

write_payload() {
  local output_file="$1"

  node - "$output_file" <<'NODE'
const fs = require("node:fs");

const outputFile = process.argv[2];
const signalKeys = [
  "user_facing_behavior",
  "documentation_examples",
  "diagnostics",
  "contract",
  "generated_output",
  "governance_path",
];
const signalValues = new Set(["none", "present", "unknown"]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function env(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    fail(`${name} is required`);
  }
  return value;
}

function parseJsonEnv(name) {
  try {
    return JSON.parse(env(name));
  } catch {
    fail(`${name} must be valid JSON`);
  }
}

function parseOptionalJsonEnv(name) {
  const value = process.env[name];
  if (value === undefined) {
    return undefined;
  }
  if (value.length === 0) {
    fail(`${name} must be valid JSON`);
  }
  try {
    return JSON.parse(value);
  } catch {
    fail(`${name} must be valid JSON`);
  }
}

function hasExactKeys(value, keys) {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  );
}

function isBoundedText(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4000 &&
    !value.includes("\0")
  );
}

function validateContractExampleDisciplineContext(value) {
  if (
    value === null ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    !hasExactKeys(value, [
      "present",
      "source",
      "obligations",
      "consumer_rule",
      "proof_obligations",
    ]) ||
    value.present !== true ||
    value.source !== "extracted-plan-task-execution-context" ||
    !isBoundedText(value.obligations) ||
    !isBoundedText(value.consumer_rule) ||
    value.proof_obligations === null ||
    Array.isArray(value.proof_obligations) ||
    typeof value.proof_obligations !== "object" ||
    !hasExactKeys(value.proof_obligations, [
      "valid_examples_pass",
      "invalid_families_fail",
    ]) ||
    value.proof_obligations.valid_examples_pass !== true ||
    value.proof_obligations.invalid_families_fail !== true
  ) {
    fail(
      "RISK_SIGNALS_CONTRACT_EXAMPLE_DISCIPLINE_CONTEXT_JSON must match the contract example discipline context schema",
    );
  }
  return value;
}

const changedFiles = parseJsonEnv("RISK_SIGNALS_CHANGED_FILES_JSON");
if (
  !Array.isArray(changedFiles) ||
  !changedFiles.every((value) => typeof value === "string")
) {
  fail("RISK_SIGNALS_CHANGED_FILES_JSON must be a JSON array of strings");
}

const signals = parseJsonEnv("RISK_SIGNALS_VALUES_JSON");
if (
  signals === null ||
  Array.isArray(signals) ||
  typeof signals !== "object" ||
  Object.keys(signals).length !== signalKeys.length ||
  !signalKeys.every((key) => Object.hasOwn(signals, key)) ||
  !signalKeys.every((key) => signalValues.has(signals[key]))
) {
  fail(
    "RISK_SIGNALS_VALUES_JSON must contain exactly the six required signal keys with none, present, or unknown values",
  );
}

function boolEnv(name) {
  const value = env(name);
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  fail(`${name} must be true or false`);
}

const evidenceSource = {
  kind: "executor-terminal-handoff",
};
if ((process.env.RISK_SIGNALS_EVIDENCE_SOURCE_PATH ?? "").length > 0) {
  evidenceSource.path = process.env.RISK_SIGNALS_EVIDENCE_SOURCE_PATH;
}
evidenceSource.summary =
  (process.env.RISK_SIGNALS_EVIDENCE_SOURCE_SUMMARY ?? "").length > 0
    ? process.env.RISK_SIGNALS_EVIDENCE_SOURCE_SUMMARY
    : "Derived from executor terminal handoff state.";

const artifact = {
  schema: "branch-review/risk-signals/v1",
  producer: "play-subagent-execution",
  evidence_source: evidenceSource,
  reviewed_base_ref: env("RISK_SIGNALS_REVIEWED_BASE_REF"),
  reviewed_base_sha: env("RISK_SIGNALS_REVIEWED_BASE_SHA"),
  reviewed_head_sha: env("RISK_SIGNALS_REVIEWED_HEAD_SHA"),
  reviewed_range: env("RISK_SIGNALS_REVIEWED_RANGE"),
  changed_files: changedFiles,
  signals,
  canonical_docs_may_be_affected: boolEnv(
    "RISK_SIGNALS_CANONICAL_DOCS_MAY_BE_AFFECTED",
  ),
  end_user_diagnostics_may_be_affected: boolEnv(
    "RISK_SIGNALS_END_USER_DIAGNOSTICS_MAY_BE_AFFECTED",
  ),
};

if ((process.env.RISK_SIGNALS_NOTES ?? "").length > 0) {
  artifact.notes = process.env.RISK_SIGNALS_NOTES;
}

const contractExampleDisciplineContext = parseOptionalJsonEnv(
  "RISK_SIGNALS_CONTRACT_EXAMPLE_DISCIPLINE_CONTEXT_JSON",
);
if (contractExampleDisciplineContext !== undefined) {
  artifact.contract_example_discipline =
    validateContractExampleDisciplineContext(
      contractExampleDisciplineContext,
    );
}

fs.writeFileSync(outputFile, `${JSON.stringify(artifact, null, 2)}\n`);
NODE
}

cleanup_temp() {
  [ -z "${temp_file:-}" ] || rm -f "$temp_file"
}

main() {
  local slug target validator

  require_repo_root
  require_env RISK_SIGNALS_REVIEWED_BASE_REF
  require_sha_env RISK_SIGNALS_REVIEWED_BASE_SHA
  require_sha_env RISK_SIGNALS_REVIEWED_HEAD_SHA
  require_full_branch_range_env RISK_SIGNALS_REVIEWED_RANGE
  require_env RISK_SIGNALS_CHANGED_FILES_JSON
  require_env RISK_SIGNALS_VALUES_JSON
  require_bool_env RISK_SIGNALS_CANONICAL_DOCS_MAY_BE_AFFECTED
  require_bool_env RISK_SIGNALS_END_USER_DIAGNOSTICS_MAY_BE_AFFECTED

  slug="$(branch_slug)"
  target=".ephemeral/${slug}-${RISK_SIGNALS_REVIEWED_HEAD_SHA}-risk-signals.json"
  prepare_write_target "$target"

  temp_file=".ephemeral/.${slug}-${RISK_SIGNALS_REVIEWED_HEAD_SHA}-risk-signals.$$-${RANDOM:-0}-risk-signals.json"
  trap cleanup_temp EXIT
  (set -C; : >"$temp_file") ||
    fail "failed to create temporary risk-signals file"
  write_payload "$temp_file"

  validator="$(resolve_validator)"
  bash "$validator" validate-risk-signals \
    --surface branch-review \
    --head-sha "$RISK_SIGNALS_REVIEWED_HEAD_SHA" \
    --risk-signals-file "$temp_file" \
    --expected-schema branch-review/risk-signals/v1 \
    --expected-reviewed-range "$RISK_SIGNALS_REVIEWED_RANGE"

  prepare_write_target "$target"
  mv -f "$temp_file" "$target"
  temp_file=""
  trap - EXIT
  printf 'Risk signals written to %s.\n' "$target"
}

main "$@"
