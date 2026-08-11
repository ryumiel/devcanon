# Write risk signals usage

## Role

Writes a validated terminal branch-review risk-signals artifact.

## Invocation

Run `bash "$PLAY_SUBAGENT_EXECUTION_DIR/scripts/write-risk-signals.sh" .ephemeral/<branch>-<head>-risk-signals.json`.

## Inputs

The direct-child output path, `HEAD_SHA`, `RISK_SIGNALS_REVIEWED_BASE_REF`, `RISK_SIGNALS_CHANGED_FILES_JSON`, and `RISK_SIGNALS_VALUES_JSON` are required. `PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT` is optional. It reads no stdin.

## Working directory

The target repository root is required.

## Outputs

It writes the artifact and emits its path or notice on stdout; diagnostics go to stderr.

## Refusal and failures

Missing facts, invalid risk signal values, unsafe paths, or unavailable support validation exit nonzero.

## Side effects

Successful execution writes only the validated risk-signals artifact.

## Workflow boundary

[Play subagent execution workflow context](../SKILL.md) owns risk interpretation and routing.
