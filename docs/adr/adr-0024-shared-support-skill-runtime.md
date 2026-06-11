# ADR-0024: Shared Support Skill Runtime

## Status

Accepted

## Context

DevCanon skills increasingly need deterministic helpers for behavior that is
larger than prompt prose and more structured than a small shell adapter. Review
artifact validation, manifest normalization, lease state transitions, issue
worktree setup, and worktree cleanup all involve schemas, path normalization,
Git state, atomic file updates, and cross-platform behavior.

ADR-0019 established that deterministic mechanics should move out of
`SKILL.md` prose and into executable helper scripts owned by the relevant
skill. It also deliberately deferred a general shared runtime layer because the
render and sync model only packaged skill-owned files. That local-script model
is still right for narrow helpers, but it does not scale well when multiple
skills need the same typed validation, state transition, or platform adapter.
Large Bash, JQ, and PowerShell state machines are also expensive to keep
portable and slow to validate on Windows.

## Decision

DevCanon accepts a support-only shared skill runtime for deterministic helper
mechanics whose complexity or reuse exceeds an owning skill's local
`scripts/` boundary. The runtime is packaged as a managed support skill named
`devcanon-runtime`. It is not a human workflow entry point, must not be
implicitly invocable as a normal skill, and must not own review judgment,
planning judgment, GitHub posting approval, issue routing, or user-facing
workflow policy. Its source metadata must use target-supported controls to mark
it support-only, including non-user-invocable Claude metadata and Codex sidecar
policy that disallows implicit invocation.

Skill prose remains authoritative for workflow policy, escalation rules,
operator approval, and the command surface presented to the agent. Runtime code
is authoritative only for deterministic executable mechanics such as:

- schema validation and normalization;
- path-shape, symlink, and file-kind guards;
- Git-derived facts and range checks;
- state-machine transitions;
- temporary-file writes and atomic replacement;
- parseable stdout and stderr contracts;
- platform-specific adapter behavior hidden behind a stable command surface.

Use an owning skill's local `scripts/` directory when the helper is specific to
one skill, has a small command surface, does not encode shared schemas or state
machines, and can stay portable without substantial duplicated shell logic. Use
`devcanon-runtime` when the helper is shared by multiple skills, needs typed
schema handling, owns nontrivial state transitions, needs consistent
cross-platform behavior, or would otherwise duplicate complex Bash, JQ,
PowerShell, or path-resolution logic.

Runtime-backed skills keep thin shell or PowerShell shims only for launch,
argument forwarding, environment discovery, and compatibility with existing
skill-facing command names. Those shims must not reimplement the runtime's
state machines or validation policy.

## Runtime Packaging and Resolution

`devcanon-runtime` is resolved as a sibling support skill from source skills,
generated previews, and installed skill homes. These layouts all place skill
directories beside each other, so a consumer under:

```text
<skills-root>/<consumer-skill>/scripts/<adapter>
```

resolves the default runtime under:

```text
<skills-root>/devcanon-runtime/
```

Runtime-backed adapters must support an explicit `DEVCANON_RUNTIME_DIR`
override for tests, diagnostics, and packaging validation. Without an override,
they first derive the logical sibling path from the adapter script location,
then may try the physical resolved sibling path for symlink install modes. If
no compatible runtime exists, the adapter fails before performing validation or
state mutation.

The runtime is distributed with rendered and installed skill bundles. Runtime
files participate in render hashing, generated previews, sync planning, and
managed install manifests like other mirrored skill support files. Consumers
must not depend on a separately installed `devcanon` binary on `PATH` for
runtime behavior, because installed skills must keep their managed helper
version aligned with the rendered bundle that invoked them.

Runtime commands declare a compatibility contract. Consumers that depend on a
runtime command must either validate the command's reported contract version or
call a stable entry point whose version compatibility is enforced by the
runtime. At minimum, each command group exposes a machine-readable contract
descriptor containing the command group name and an integer major version, and
mutating consumers reject unknown major versions before changing files or
state. Content hashes remain install-plan evidence that managed runtime files
match the rendered source; they are not a substitute for command-level
compatibility checks.

## Node.js Runtime Requirement

Runtime-backed helpers may require Node.js, matching DevCanon's supported Node
engine. This requirement applies only to helpers that explicitly opt into
`devcanon-runtime`. It does not make Node.js a prerequisite for all skill
execution, and it does not require the installed `devcanon` CLI.

This decision supersedes ADR-0019's earlier restriction that the shared review
artifact validator remain shell/JQ self-contained and not require Node.js
solely to validate review artifacts. A review-artifact validator or other
helper may become Node-backed only when it is launched through the packaged
support runtime and preserves its documented skill-facing command surface.
ADR-0019 otherwise remains authoritative for local deterministic script
ownership.

## Consequences

- Shared deterministic behavior can move from duplicated shell state machines
  into typed, directly tested runtime code.
- Windows validation can focus on runtime-backed platform behavior instead of
  repeating every POSIX shell-path test in Windows CI.
- Render and sync must package the runtime as a managed support skill before
  runtime-backed consumer helpers can be adopted.
- Installed runtime-backed skill bundles are no longer purely shell-only; they
  must fail explicitly when Node.js or a compatible packaged runtime is
  unavailable.
- Existing helpers do not migrate automatically. Each consumer skill must keep
  its current command surface and be ported behind that surface deliberately.
- Support-only behavior remains explicit: the runtime is reusable
  infrastructure, not a new agent-facing workflow.

## Alternatives considered

- Keep all helpers under owning skill `scripts/` directories. Rejected because
  duplicated shell and PowerShell state machines increase drift risk and make
  cross-platform validation slow and fragile.
- Depend on the installed `devcanon` binary for helper behavior. Rejected
  because managed skill bundles need version-aligned helper files and should
  not rely on whichever CLI happens to be on `PATH`.
- Copy compiled helper code into every consumer skill. Rejected because it
  keeps packaging simple at the cost of duplicated support code and unclear
  update boundaries.
- Use Python as the shared runtime. Rejected because DevCanon already requires
  Node.js, while Python availability and dependency management would add a
  second runtime contract for installed helpers.
