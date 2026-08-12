# Write risk signals usage

## Role

Writes a validated terminal branch-review risk-signals artifact.

## Invocation

Run `bash "$PLAY_SUBAGENT_EXECUTION_DIR/scripts/write-risk-signals.sh"` with no positional arguments.

## Inputs

`RISK_SIGNALS_REVIEWED_BASE_REF`, `RISK_SIGNALS_REVIEWED_BASE_SHA`, `RISK_SIGNALS_REVIEWED_HEAD_SHA`, `RISK_SIGNALS_REVIEWED_RANGE`, `RISK_SIGNALS_CHANGED_FILES_JSON`, `RISK_SIGNALS_VALUES_JSON`, `RISK_SIGNALS_CANONICAL_DOCS_MAY_BE_AFFECTED`, and `RISK_SIGNALS_END_USER_DIAGNOSTICS_MAY_BE_AFFECTED` are required. `RISK_SIGNALS_EVIDENCE_SOURCE_PATH`, `RISK_SIGNALS_EVIDENCE_SOURCE_SUMMARY`, `RISK_SIGNALS_NOTES`, and `RISK_SIGNALS_CONTRACT_EXAMPLE_DISCIPLINE_CONTEXT_JSON` are optional. `PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT` is an optional validator override. It reads no stdin.

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
