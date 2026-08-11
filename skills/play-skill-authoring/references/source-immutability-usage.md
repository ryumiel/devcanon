# Source immutability usage

## Role

Runs the skill-authoring source-immutability lifecycle adapter.

## Invocation

Run `capture [--handoff .ephemeral/<file>]`, `verify --baseline .ephemeral/.devcanon-source-immutability-<hex>.json [--handoff .ephemeral/<file>]`, or `cleanup --baseline .ephemeral/.devcanon-source-immutability-<hex>.json [--handoff .ephemeral/<file>]` through `bash "$PLAY_SKILL_AUTHORING_DIR/scripts/source-immutability.sh"`.

## Inputs

`capture` takes no positional input and optionally takes `--handoff .ephemeral/<file>` for an absent, ignored, untracked direct child; without it, the baseline records no handoff. `verify` requires the baseline path printed by `capture`; when its baseline declares a handoff, it also requires that identical `--handoff` path, which must now be a nonempty, readable, nonsymlinked regular file. `cleanup` requires a baseline path and accepts the matching handoff when a retained regular baseline exists; it also accepts already-missing baseline or handoff leaves for idempotent cleanup. Baseline and handoff paths must differ. `DEVCANON_RUNTIME_DIR` is optional. No operation reads stdin.

## Working directory

`capture` and `verify` require the skill-authoring worktree's real Git root and `.ephemeral`; `cleanup` uses its physical current directory as the cleanup root and accepts no Git-worktree requirement.

## Outputs

`capture` prints the retained `.ephemeral/.devcanon-source-immutability-<hex>.json` path. Successful `verify` prints `unchanged`; successful `cleanup` prints `cleaned`. Diagnostics use stderr.

## Refusal and failures

Unknown commands or flags, invalid paths, a handoff that differs from a retained baseline declaration, source drift, or a missing, empty, unreadable, nonregular, or symlinked declared handoff make `verify` exit nonzero. `cleanup` rejects unsafe paths and non-file, non-symlink cleanup leaves; it accepts missing leaves and unlinks either regular-file or symlink baseline and handoff leaves.

## Side effects

`capture` writes retained guard state. `verify` is read-only. `cleanup` removes both retained guard state and the declared handoff when applicable, including safe symlink leaves.

## Workflow boundary

[Play skill authoring workflow context](../SKILL.md) owns test-cycle decisions and continuation.
