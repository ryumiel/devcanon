# Terminal risk signals

Condition-scoped operating procedure for the terminal risk-signals action in
the [play-subagent-execution workflow](../SKILL.md). That workflow owns
terminal-signal policy: when the action runs, that the signals are
non-authoritative branch-review input, the `--help` discovery step, the exact
success notice and its emission conditions, and the rule that the emitted path
reaches the next branch review and is regenerated after any later `HEAD`
change. The [write-risk-signals usage](write-risk-signals-usage.md) owns the
helper's invocation, optional inputs, working directory, output path, refusals,
and side effects. This file supplies the input semantics the controller sets
before invoking the helper and the branch-review invocation form for the
emitted path.

## Required inputs

Set these required inputs before invoking the helper:
`RISK_SIGNALS_REVIEWED_BASE_REF`, `RISK_SIGNALS_REVIEWED_BASE_SHA`,
`RISK_SIGNALS_REVIEWED_HEAD_SHA`, `RISK_SIGNALS_REVIEWED_RANGE`,
`RISK_SIGNALS_CHANGED_FILES_JSON`, `RISK_SIGNALS_VALUES_JSON`,
`RISK_SIGNALS_CANONICAL_DOCS_MAY_BE_AFFECTED`, and
`RISK_SIGNALS_END_USER_DIAGNOSTICS_MAY_BE_AFFECTED`.
`RISK_SIGNALS_REVIEWED_RANGE` and `RISK_SIGNALS_CHANGED_FILES_JSON` must
describe the same full branch range that the next branch-review invocation will
validate, such as `$BASE...HEAD`; `RISK_SIGNALS_REVIEWED_BASE_REF` must match
that range's base side. For detached issue-base reviews, use the full base SHA
as both `RISK_SIGNALS_REVIEWED_BASE_REF` and the left side of
`RISK_SIGNALS_REVIEWED_RANGE`.

## Signal categories

The values JSON must contain exactly these six signal categories:
`user_facing_behavior`, `documentation_examples`, `diagnostics`, `contract`,
`generated_output`, and `governance_path`. Each value is `none`, `present`, or
`unknown`; ambiguous/unclear classifications must be encoded as `unknown`, not
omitted.

## Contract Example Discipline context

Optionally set
`RISK_SIGNALS_CONTRACT_EXAMPLE_DISCIPLINE_CONTEXT_JSON` only when the extracted
context contains present Contract Example Discipline obligations or an
equivalent clearly labeled section/obligation and the next branch review must
preserve that source-owned contract context after an `issue-priming-workflow
--auto` single-task run skips the workflow's final whole-implementation
reviewer. When set, the helper writes the validated object as the risk-signals
artifact's `contract_example_discipline` field. The JSON must contain exactly:

```json
{
  "present": true,
  "source": "extracted-plan-task-execution-context",
  "obligations": "<non-empty string, max 4000 chars, no NUL>",
  "consumer_rule": "<non-empty string, max 4000 chars, no NUL>",
  "proof_obligations": {
    "valid_examples_pass": true,
    "invalid_families_fail": true
  }
}
```

`proof_obligations` values must be exactly `true` and reflect only obligations
explicitly present in the extracted context. Copy `obligations` only from
present Contract Example Discipline, an equivalent clearly labeled
section/obligation, task-local example, or proof-obligation lines, and copy
`consumer_rule` from the shared rule content inlined under `Contract Example
Discipline Consumer Rule`; do not include the whole plan. If present
obligations cannot be represented in that bounded object because the data is
empty, too large, contains NUL, or lacks an explicit proof-obligation signal,
report BLOCKED and do not invoke the helper or emit the success notice.

## Branch-review invocation form

Default-base artifacts use the normal no-positional-base form:
`branch-review --risk-signals <path>` or, in an auto-fix loop,
`branch-review --fix --risk-signals <path>`. Detached issue-base artifacts
whose reviewed range is `<full-base-sha>...HEAD` must pass that same full base
SHA as branch-review's positional base:
`branch-review --risk-signals <path> <full-base-sha>` or, in an auto-fix loop,
`branch-review --fix --risk-signals <path> <full-base-sha>`.
