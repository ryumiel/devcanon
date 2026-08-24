# ADR-0024: Shared Passive Runtime Support Bundle

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

DevCanon accepts one fixed passive runtime support bundle,
`devcanon-runtime`, for deterministic helper mechanics whose complexity or
reuse exceeds an owning skill's local `scripts/` boundary. It is not a source
skill or human workflow entry point, and it must not own review judgment,
planning judgment, GitHub posting approval, issue routing, or user-facing
workflow policy. Its fixed payload contains only `scripts/`; it must contain
neither `SKILL.md` nor a Codex invocation sidecar.

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

`devcanon-runtime` is resolved as a sibling passive runtime bundle from source
skills, generated previews, and installed skill homes. These layouts preserve
the existing sibling adapter layout, so a consumer under:

```text
<skills-root>/<consumer-skill>/scripts/<adapter>
```

resolves the default runtime under:

```text
<skills-root>/devcanon-runtime/
```

Rendered previews copy the passive `scripts/` payload; installed bundles use
the same sibling skills-home layout through the existing copy or symlink modes.
The v1 manifest records the bundle with `type: "skill"` only as that existing
skills-home transport identity. It does not make the bundle a source skill or
add `SKILL.md` or an invocation sidecar. Passive-runtime copy identity validates
the fixed payload and its content hash only; it has no legacy fallback or
migration behavior.

Adapters that use the established override-resolution path retain its explicit
`DEVCANON_RUNTIME_DIR` behavior for tests, diagnostics, and packaging
validation. Without an override, they derive the logical sibling path from the
adapter script location, then may try the physical resolved sibling path for
symlink install modes. If no compatible runtime exists, the adapter fails before
performing validation or state mutation.

For adapters using the trusted bootstrap, the adapter must
first locate the fixed sibling `devcanon-runtime` bootstrap without consulting
`DEVCANON_RUNTIME_DIR`. `skills/pr-review/scripts/review-leases.sh` is the
current consumer; it requires the fixed sibling passive runtime bundle to be
present in isolated fixtures before it can use an override. The thin shell
adapter owns only its closed command selection, sibling bootstrap location, and
exact argument forwarding. The packaged Node bootstrap owns platform-specific
path grammar, raw traversal rejection, final-component `lstat`, physical
`realpath` containment, and child dispatch. In particular, it rejects an exact
raw `..` component before path normalization and rejects a final symlink,
junction, or reparse point before dereference. It then proves the real runtime
entrypoint is within the real runtime directory using relative-path semantics,
not a string prefix.

The override is therefore inert test, diagnostic, and packaging input until
the fixed bootstrap has structurally validated it. It must never be used to
find or load the bootstrap that validates it. Fixtures that exercise this
override must package the fixed passive runtime bundle as a sibling, just as source,
rendered, copied, managed, and symlink-installed layouts do. The dispatcher
keeps the original override value in the child environment and launches the
validated child itself; it does not return an override path through shell
command substitution. The shell and typed executable entrypoints are
independently validated; the bootstrap dispatches the platform-appropriate
validated target without ambient shell lookup.

This decision records the trusted-bootstrap contract for adapters that use it.
The `review-leases.sh` packaging and diagnostic prerequisite does not activate
discovery, Phase 2, or any review workflow.

The passive runtime bundle participates in render hashing, generated previews,
sync planning, manifest inspection, collision checks, and managed installation
through the existing skill transport lifecycle. Consumers must not depend on a
separately installed `devcanon` binary on `PATH` for runtime behavior, because
installed skills must keep their managed helper version aligned with the
rendered bundle that invoked them.

Runtime commands declare a compatibility contract. Consumers that depend on a
runtime command must either validate the command's reported contract version or
call a stable entry point whose version compatibility is enforced by the
runtime. At minimum, each command group exposes a machine-readable contract
descriptor containing the command group name and an integer major version, and
mutating consumers reject unknown major versions before changing files or
state. Content hashes remain install-plan evidence that managed runtime files
match the rendered source; they are not a substitute for command-level
compatibility checks.

## Source Validation and Command Ordering

Sync begins with pure manifest inspection. An invalid dry sync retains the
manifest-error result and does not validate the runtime. Every other sync
validates the fixed passive runtime support bundle before non-dry manifest
recovery, normalization or binding, rendering, or installed-output mutation.
`diff` likewise inspects the manifest before its read-only source-driven render
validates the bundle. `uninstall` remains source-independent and does not
validate the bundle.

## Node.js Runtime Requirement

Runtime-backed helpers may require Node.js, matching DevCanon's supported Node
engine. This requirement applies only to helpers that explicitly opt into
`devcanon-runtime`. It does not make Node.js a prerequisite for all skill
execution, and it does not require the installed `devcanon` CLI.

This decision supersedes ADR-0019's earlier restriction that the shared review
artifact validator remain shell/JQ self-contained and not require Node.js
solely to validate review artifacts. A review-artifact validator or other
helper may become Node-backed only when it is launched through the packaged
passive runtime bundle and preserves its documented skill-facing command
surface.
ADR-0019 otherwise remains authoritative for local deterministic script
ownership.

## Consequences

- Shared deterministic behavior can move from duplicated shell state machines
  into typed, directly tested runtime code.
- Windows validation can focus on runtime-backed platform behavior instead of
  repeating every POSIX shell-path test in Windows CI.
- Render and sync transport the runtime as the fixed passive bundle before
  runtime-backed consumer helpers can use it.
- Installed runtime-backed skill bundles are no longer purely shell-only; they
  must fail explicitly when Node.js or a compatible packaged runtime is
  unavailable.
- Passive behavior remains explicit: the runtime is reusable infrastructure,
  not a new agent-facing workflow or source skill.

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
