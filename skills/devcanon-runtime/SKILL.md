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

The runtime may require Node.js for future typed helper commands. This initial
bundle only establishes the packaged support skill and resolution contract used
by follow-up runtime implementation work.
