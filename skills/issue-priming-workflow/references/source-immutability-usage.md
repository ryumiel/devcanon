# Source immutability usage

## Role

Runs the packaged source-immutability adapter for issue-priming leaves.

## Invocation

Run `capture [--handoff .ephemeral/<file>]`, `verify --baseline .ephemeral/.devcanon-source-immutability-<hex>.json [--handoff .ephemeral/<file>]`, or `cleanup --baseline .ephemeral/.devcanon-source-immutability-<hex>.json [--handoff .ephemeral/<file>]` through `bash "$ISSUE_PRIMING_WORKFLOW_DIR/scripts/source-immutability.sh"`.

## Inputs

`capture` needs no argument and optionally reserves one absent ignored direct-child handoff. `verify` and `cleanup` require the path printed by `capture` and accept the same optional handoff. `DEVCANON_RUNTIME_DIR` is an optional runtime override. No command reads stdin.

## Working directory

The issue worktree root is required.

## Outputs

It emits operation results on stdout and diagnostics on stderr.

## Refusal and failures

Missing lifecycle inputs, unavailable runtime, or an invalid source state exits nonzero.

## Side effects

`capture` writes its retained baseline and `cleanup` removes only retained guard files; `verify` is read-only.

## Workflow boundary

[Issue priming workflow context](../SKILL.md) owns lifecycle disposition and continuation.
