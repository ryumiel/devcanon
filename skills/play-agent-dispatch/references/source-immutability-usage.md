# Source immutability usage

## Role

Runs the dispatch source-immutability lifecycle adapter.

## Invocation

Run `capture [--handoff .ephemeral/<file>]`, `verify --baseline .ephemeral/.devcanon-source-immutability-<hex>.json [--handoff .ephemeral/<file>]`, or `cleanup --baseline .ephemeral/.devcanon-source-immutability-<hex>.json [--handoff .ephemeral/<file>]` through `bash "$PLAY_AGENT_DISPATCH_DIR/scripts/source-immutability.sh"`.

## Inputs

`capture` accepts only the optional absent ignored direct-child handoff. `verify` and `cleanup` require the baseline printed by `capture` and accept the same handoff. `DEVCANON_RUNTIME_DIR` is optional. No command reads stdin.

## Working directory

The current worktree root is required.

## Outputs

It emits operation results on stdout and diagnostics on stderr.

## Refusal and failures

Invalid lifecycle inputs, runtime resolution failure, or source drift exits nonzero.

## Side effects

`capture` writes its retained baseline and `cleanup` removes only retained guard files; `verify` is read-only.

## Workflow boundary

[Play agent dispatch workflow context](../SKILL.md) owns disposition and continuation.
