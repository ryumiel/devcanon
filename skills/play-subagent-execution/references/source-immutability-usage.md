# Source immutability usage

## Role

Runs the subagent-execution source-immutability lifecycle adapter.

## Invocation

Run `bash "$PLAY_SUBAGENT_EXECUTION_DIR/scripts/source-immutability.sh" <capture|verify|cleanup> ...`.

## Inputs

The selected operation requires its lifecycle inputs; `DEVCANON_RUNTIME_DIR` is an optional runtime override. It reads no stdin.

## Working directory

The current implementation worktree root is required.

## Outputs

It emits operation results on stdout and diagnostics on stderr.

## Refusal and failures

Invalid lifecycle inputs, runtime resolution failure, or source drift exits nonzero.

## Side effects

`capture` writes its retained baseline and `cleanup` removes only retained guard files; `verify` is read-only.

## Workflow boundary

[Play subagent execution workflow context](../SKILL.md) owns disposition and continuation.
