---
name: devcanon-runtime
description: Support-only runtime bundle for DevCanon skill helper entrypoints. Use only through explicit helper adapters that need packaged deterministic runtime support.
claude:
  user-invocable: false
  disable-model-invocation: true
codex_sidecar:
  policy:
    allow_implicit_invocation: false
---

# DevCanon Runtime

Support-only runtime bundle for deterministic DevCanon skill helper mechanics.

This skill is not a human workflow entry point. Do not invoke it as a normal
agent skill, and do not use it to decide review judgment, planning judgment,
issue routing, GitHub posting approval, or operator workflow policy.

Runtime-backed adapters resolve this skill as a sibling support skill and then
invoke explicit files under `scripts/`. Missing runtime files are packaging,
render, sync, or install errors; adapters must fail before validation or state
mutation when the runtime cannot be resolved.

Typed helper commands run through the packaged compiled JavaScript entrypoint
at `scripts/runtime/cli.js`. Thin shell adapters may invoke it with:

```sh
devcanon-runtime.sh runtime <typed-command> [args...]
```

The TypeScript source for shared helper modules lives under `src/runtime/`.
That source owns deterministic path guards, direct Git execution helpers,
atomic artifact writes, typed schema validation, and stable stdout/stderr
command fragments. The packaged JavaScript entrypoint preserves those stable
command contracts for installed skill bundles without requiring a separate
`devcanon` binary on `PATH`.
