# Write snapshot manifest usage

## Role

Writes an implementer snapshot manifest for committed changes.

## Invocation

Run `BASE_SHA=<commit> SNAPSHOT_TASK_ID=<task> bash "$PLAY_SUBAGENT_EXECUTION_DIR/scripts/write-snapshot-manifest.sh"`.

## Inputs

`BASE_SHA` and `SNAPSHOT_TASK_ID` are required. It reads no stdin and selects its output path itself.

## Working directory

The repository root is required.

## Outputs

It writes one snapshot under `.ephemeral/` and prints its repo-relative notice on stdout; diagnostics go to stderr.

## Refusal and failures

Missing environment, unsafe paths, unsupported diff state, or unrepresentable content exits nonzero without a success notice.

## Side effects

Successful execution writes one manifest and private scratch files under `.ephemeral`.

## Workflow boundary

[Play subagent execution workflow context](../SKILL.md) owns whether a requested snapshot is required.
