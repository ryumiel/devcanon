# Write risk signals usage

## Role

Writes a validated terminal branch-review risk-signals artifact.

## Invocation

Run `bash "$PLAY_SUBAGENT_EXECUTION_DIR/scripts/write-risk-signals.sh"` with no positional arguments.

## Inputs

`RISK_SIGNALS_REVIEWED_BASE_REF`, `RISK_SIGNALS_REVIEWED_BASE_SHA`, `RISK_SIGNALS_REVIEWED_HEAD_SHA`, `RISK_SIGNALS_REVIEWED_RANGE`, `RISK_SIGNALS_CHANGED_FILES_JSON`, `RISK_SIGNALS_VALUES_JSON`, `RISK_SIGNALS_CANONICAL_DOCS_MAY_BE_AFFECTED`, and `RISK_SIGNALS_END_USER_DIAGNOSTICS_MAY_BE_AFFECTED` are required. `RISK_SIGNALS_EVIDENCE_SOURCE_PATH`, `RISK_SIGNALS_EVIDENCE_SOURCE_SUMMARY`, `RISK_SIGNALS_NOTES`, and `RISK_SIGNALS_CONTRACT_EXAMPLE_DISCIPLINE_CONTEXT_JSON` are optional. `PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT` is an optional validator override. It reads no stdin.

`RISK_SIGNALS_REVIEWED_RANGE` and `RISK_SIGNALS_CHANGED_FILES_JSON` describe the
same full branch range that the next branch-review invocation validates, such
as `$BASE...HEAD`; `RISK_SIGNALS_REVIEWED_BASE_REF` matches that range's base
side. For detached issue-base reviews, use the full base SHA as both
`RISK_SIGNALS_REVIEWED_BASE_REF` and the left side of
`RISK_SIGNALS_REVIEWED_RANGE`.

`RISK_SIGNALS_VALUES_JSON` contains exactly these six signal categories:
`user_facing_behavior`, `documentation_examples`, `diagnostics`, `contract`,
`generated_output`, and `governance_path`. Each value is `none`, `present`, or
`unknown`; encode ambiguous or unclear classifications as `unknown`, not by
omitting them.

When `RISK_SIGNALS_CONTRACT_EXAMPLE_DISCIPLINE_CONTEXT_JSON` is provided, its
JSON is exactly:

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

The `proof_obligations` values are exactly `true` and reflect only obligations
explicitly present in extracted context. Copy `obligations` only from present
Contract Example Discipline, an equivalent clearly labeled section or
obligation, task-local example, or proof-obligation lines; copy `consumer_rule`
from the shared rule content inlined under `Contract Example Discipline Consumer
Rule`; do not include the whole plan. The value is unrepresentable when data is
empty, too large, contains NUL, or lacks an explicit proof-obligation signal.
The [workflow boundary](#workflow-boundary) owns when to include this optional
context and the continuation required for an unrepresentable value.

## Working directory

The target repository root is required.

## Outputs

It derives `.ephemeral/<branch-slug>-<reviewed-head>-risk-signals.json` and prints `Risk signals written to <path>.` on stdout; diagnostics go to stderr.

## Refusal and failures

Missing facts, invalid risk signal values, unsafe paths, or unavailable support validation exit nonzero.

## Side effects

Successful execution creates `.ephemeral`, writes the derived risk-signals JSON atomically after validation, and removes its temporary file.

## Workflow boundary

[Play subagent execution workflow context](../SKILL.md) owns risk interpretation and routing.
