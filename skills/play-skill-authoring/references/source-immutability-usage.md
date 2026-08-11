# Source immutability usage

## Role

Runs the skill-authoring source-immutability lifecycle adapter.

## Invocation

Run `capture [--handoff .ephemeral/<file>]`, `verify --baseline .ephemeral/.devcanon-source-immutability-<hex>.json [--handoff .ephemeral/<file>]`, or `cleanup --baseline .ephemeral/.devcanon-source-immutability-<hex>.json [--handoff .ephemeral/<file>]` through `bash "$PLAY_SKILL_AUTHORING_DIR/scripts/source-immutability.sh"`.

## Inputs

`capture` takes no positional input and optionally takes `--handoff .ephemeral/<file>` for an absent, ignored, direct child of `.ephemeral/`; without it, the baseline records that no handoff is expected. `verify` and `cleanup` require the baseline path printed by `capture`. When that baseline records a handoff, both require the identical `--handoff` path; otherwise neither takes one. The baseline and handoff paths must differ. `DEVCANON_RUNTIME_DIR` is optional. No operation reads stdin.

## Working directory

The current skill-authoring worktree root is required.

## Outputs

`capture` writes the retained `.ephemeral/.devcanon-source-immutability-<hex>.json` baseline path to stdout. A successful `verify` writes `unchanged`; a successful `cleanup` writes `cleaned`. Diagnostics use stderr.

## Refusal and failures

Unknown commands or flags, invalid or noncanonical paths, a handoff that differs from the baseline declaration, source drift during `verify`, a declared handoff that is missing, non-regular, nonempty, or unreadable, unavailable runtime support, an invalid worktree, and unsafe cleanup targets exit nonzero.

## Side effects

`capture` writes its retained baseline and `cleanup` removes only retained guard files; `verify` is read-only.

## Workflow boundary

[Play skill authoring workflow context](../SKILL.md) owns test-cycle decisions and continuation.
