# ADR-0024: Shared Passive Runtime Support Bundle

## Status

Accepted

## Context

`devcanon-runtime` must operate as a version-aligned sibling bundle without a
source checkout, package manager, ambient `node_modules`, or a global
`devcanon` executable. A tracked JavaScript-and-dependency-closure payload
would make artifact provenance, package contents, integrity, and reproduction
ambiguous.

The runtime therefore needs a prebuilt ESM artifact while keeping authored
adapters, the runtime catalog, generated build artifacts, rendered payloads,
and installed copies separate. Source development and package execution must
select distinct verifiable artifacts without inferring their origin from the
filesystem. The catalog remains part of the composed payload without
transferring catalog authority to the artifact pipeline.

## Decision

### Ownership partition

Adopt a shared passive-runtime architecture with explicit provider provenance,
closed generated roots, renderer-owned composition, a fixed trusted bootstrap,
and reproducible build identity.

The [Passive Runtime Artifact and Lifecycle Contract](../specs/passive-runtime.md)
is the sole owner of observable custody, provider acceptance, composition and
repair transitions, bootstrap selection invariants, canonicalization, and
attribution behavior. This ADR owns the architectural choices, rationale,
consequences, and rejected alternatives.

[ADR-0035](adr-0035-installed-runtime-configuration-discovery.md) remains the
decision owner for runtime-catalog schema, semantic contents, projection
inputs, and configuration-selection behavior. The passive-runtime spec owns
physical path and stage custody plus overwrite policy for every
`config/runtime-config.json` instance. This ADR owns neither partition's exact
behavior.

The runtime is passive infrastructure, not a source skill or human workflow
entry point. Its composed payload contains neither `SKILL.md` nor a Codex
invocation sidecar. Runtime judgment remains outside the runtime: owning skills
retain workflow policy, escalation, approvals, review, planning, posting, and
issue-routing judgment.

### Explicit generated providers

The CLI distribution has two non-overlapping generated roots:

```text
dist/devcanon-runtime/source-build/
dist/devcanon-runtime/package/
```

Source-development entrypoints inject `source-build`; the npm entrypoint
injects `package`. The common CLI receives that identity explicitly and never
infers it from `.git`, the current directory, configured path shape, or the
presence of another artifact. This makes provenance a caller-owned fact rather
than a filesystem guess.

The two providers use different verification regimes because a package cannot
reconstruct source and lockfile inputs that the package intentionally omits.
Source builds therefore prove canonical source-input identity, while packages
prove package origin, version, target, and payload digests. Both fail closed
before composition or transport.

### Composed runtime and repair

The renderer-owned compositor combines source adapters, the ADR-0035 catalog
result, and one accepted provider into the passive runtime consumed by render
and installation. Generated provider roots, source-sibling copies, rendered
previews, and installed copies remain derived; none becomes source authority by
being copied beneath `skills/`, `generated/`, or a target home.

The generated subtree beneath an initialized library is replaceable as one
unit. `render` is the explicit ordinary repair path, and non-dry `sync` reuses
the same compositor. Read-only commands report stale derived state without
repairing it. This choice provides a normal provider-upgrade and
provider-switch transition without weakening authored-path protection or
adding another CLI command.

The rendered composition is the sole symlink target. The install manifest
continues to identify the authored source root and rendered composition while
the accepted build manifest supplies generated-artifact provenance. Existing
copy, symlink, diff, collision, overwrite, and uninstall semantics remain
unchanged; uninstall remains source-independent.

### Runtime packaging and trusted bootstrap

The public adapter surface remains thin. POSIX shell is a compatibility layer;
the prebuilt Node entrypoint is the portable runtime surface. The fixed sibling
bootstrap, rather than an override or ambient lookup, is the trust anchor for
platform path grammar, traversal rejection, physical containment, and child
dispatch.

An explicit runtime-directory override remains useful for tests, diagnostics,
and packaging validation. It may select a valid runtime outside the
bootstrap's own copied directory only after the fixed bootstrap is loaded and
has structurally validated that selected runtime. The override never locates or
replaces the bootstrap. Entrypoint containment is measured against the selected
runtime, which preserves valid out-of-tree fixtures without weakening the
bootstrap trust boundary.

The `scripts/runtime/` placement preserves module-relative runtime catalog
lookup and a stable sibling layout. Ordinary installed execution relies on the
payload accepted before transport rather than adding per-invocation hashing.

### Closed canonical build identity

Every provider root carries a closed manifest over the producing DevCanon
version, provider origin, supported Node target, canonical inputs, bundle, and
license artifact. Input identity includes the production runtime source,
normalized bundler identity and options, relevant dependency declarations, the
resolved production dependency closure, and the pinned bundler resolution. It
excludes timestamps, machine paths, unrelated lockfile records, and unrelated
development dependencies.

Resolved package instances use unique, machine-independent lockfile identities
including peer-resolution context. Dependency edges retain their complete
alias, kind, key, and target identity. License attribution uses the same unique
package-instance identity, rather than name and version, so duplicate versions
and traversal order cannot make output nondeterministic. The passive-runtime
spec owns the exact fields, framing, ordering, and failure behavior.

### Package lifecycle and isolation

`prepack` is the sole package-production gate. It builds and verifies package
artifacts before `npm pack` collects them. One gate keeps package contents and
provider provenance inseparable; the passive-runtime spec owns the exact
tarball inventory and acceptance behavior.

Acceptance uses package-local execution and an isolated copied runtime so a
source checkout, global CLI, package-manager access, ambient `node_modules`, or
uncontrolled runtime environment cannot satisfy the proof accidentally. POSIX
also proves its shell adapter delegates exactly to Node. Native Windows uses
Node directly and is implemented and proven by the dedicated Windows
follow-up; deferring that machine evidence does not change the accepted
cross-platform architecture.

For identical canonical inputs and the same provider origin, independent
builds must emit byte-identical bundle, manifest, and license artifacts.

## Consequences

- Rendered previews, installed helpers, source-sibling copies, `init`, CLI
  entrypoints, tarballs, and installers consume one artifact architecture.
- Provider failures remain actionable without making package installs depend
  on source-only inputs.
- Atomic recomposition repairs derived provider drift while preserving authored
  content.
- Unique package-instance identity closes dependency and attribution ordering,
  including repeated name/version instances.
- A fixed bootstrap can safely validate an explicitly selected external runtime
  without allowing that runtime to become bootstrap authority.
- The behavior spec can evolve acceptance-ready details without turning this
  decision record into a second normative contract.

## Alternatives considered

- **Keep a tracked JavaScript-and-`node_modules` payload.** Rejected because it
  conflates authored and generated custody, obscures package provenance, and
  prevents a compact reproducibility contract.
- **Infer source or package provenance from filesystem state.** Rejected
  because ambient state is neither reliable nor a durable authority boundary.
- **Require package verification to reconstruct source-only inputs.** Rejected
  because packaged artifacts omit those inputs and such verification would make
  a false integrity claim.
- **Produce package artifacts from several lifecycle hooks.** Rejected because
  one `prepack` gate is needed to prove tarball contents.
- **Reject every runtime override outside the bootstrap directory.** Rejected
  because a fixed trusted bootstrap can validate a disjoint selected runtime
  without delegating bootstrap authority.
- **Add a separate refresh command.** Rejected because render already owns
  composition and can provide the explicit repair transition; non-dry sync can
  reuse it.
- **Order license entries only by package name and version.** Rejected because
  distinct peer-resolved instances can share both values.
- **Duplicate runtime-catalog semantics here.** Rejected because ADR-0035 and
  Configuration already own schema, contents, projection inputs, and selection;
  duplicated ownership would drift.

## See also

- [Passive Runtime Artifact and Lifecycle Contract](../specs/passive-runtime.md)
- [Installed Runtime Configuration Discovery](adr-0035-installed-runtime-configuration-discovery.md)
- [CLI commands](../specs/cli-commands.md)
- [Install and sync](../specs/install-and-sync.md)
- [Platform and security](../specs/platform.md)
