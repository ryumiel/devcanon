# Write risk signals usage

## Role

Writes a validated terminal branch-review risk-signals artifact.

## Invocation

Run `bash "$PLAY_SUBAGENT_EXECUTION_DIR/scripts/write-risk-signals.sh" <output-file>` with the documented environment.

## Inputs

The output path and required risk-signal environment are required; support-validator override inputs are optional. It reads no stdin.

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
