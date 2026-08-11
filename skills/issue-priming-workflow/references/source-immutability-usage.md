# Source immutability usage

## Role

Runs the packaged source-immutability adapter for issue-priming leaves.

## Invocation

Run `bash "$ISSUE_PRIMING_WORKFLOW_DIR/scripts/source-immutability.sh" <capture|verify|cleanup> ...`.

## Inputs

The selected lifecycle operation requires its documented baseline and output inputs; runtime resolution may use `DEVCANON_RUNTIME_DIR`. It reads no stdin.

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
