# ADR-0024: Shared Passive Runtime Support Bundle

## Status

Accepted

[ADR-0035](adr-0035-installed-runtime-configuration-discovery.md) remains the
sole owner of runtime-catalog schema, contents, custody, target-local
projection, and configuration-selection behavior. This revision of ADR-0024
supersedes ADR-0035's older generic passive-runtime payload-content claim;
ADR-0035's authority is now the catalog-only partition. ADR-0024 is the
decision owner for every non-catalog part of passive-runtime artifact custody,
provenance, composition, integrity, provider and package lifecycle, transport,
isolation, and compatibility.

## Context

`devcanon-runtime` must operate as a version-aligned sibling bundle without a
source checkout, package manager, ambient `node_modules`, or a global
`devcanon` executable. The passive sibling model and its public adapters are
already accepted, but a tracked JavaScript-and-dependency-closure payload would
make artifact provenance, package contents, integrity, and reproduction
ambiguous.

The runtime needs a prebuilt ESM artifact while keeping the authored runtime
inputs, generated build artifacts, rendered payload, and installed copies
separate. The architecture must allow source-development and package execution
to select distinct, verifiable artifacts without inferring their origin from
the filesystem. It must also preserve the catalog boundary: the runtime carries
a target-local catalog, but it does not own catalog content or projection.

## Decision

### Authority and scope

This ADR is the sole architectural owner of the passive-runtime artifact
contract. It defines custody, explicit provider provenance, exact composition,
manifest integrity, verification regimes, package and attribution lifecycle,
isolation proof, reproducibility, and compatibility.

The runtime is passive infrastructure, not a source skill or human workflow
entry point. Its composed payload contains neither `SKILL.md` nor a Codex
invocation sidecar.

ADR-0035 is the sole owner of runtime-catalog schema, contents, custody,
target-local projection, and configuration-selection behavior. The catalog
remains part of the composed runtime payload. ADR-0035 takes precedence only
within that catalog partition; ADR-0024 owns composition and transport of the
whole payload and every non-catalog artifact concern.

This decision does not choose a bundler, its configuration, or private runtime
decomposition. The dependent behavior specifications define the observable
contract. Bundler, build, runtime, renderer, and installer source implementation
and executable proof remain deferred to a separate implementation change.

### Artifact custody and explicit providers

`skills/devcanon-runtime/` is the authoritative authored root. Its authored
leaves are:

```text
config/runtime-config.json
scripts/devcanon-runtime.sh
scripts/resolve-bash.mjs
```

The CLI distribution owns exactly two non-overlapping generated roots:

```text
dist/devcanon-runtime/source-build/
dist/devcanon-runtime/package/
```

Each generated root contains exactly these leaves:

```text
devcanon-runtime.mjs
runtime-manifest.json
THIRD_PARTY_LICENSES
```

Source development, including `pnpm dev` and the shim created by `setup:cli`,
injects the `source-build` provider. The npm `bin` entrypoint injects the
`package` provider. The common compiled CLI requires exactly one explicit
internal provider and passes its selected generated root to validation and to
the render, `init`, and installation consumers. It must not infer provider
identity from `.git`, the current directory, configured path shape, the
presence of another artifact root, or any other filesystem heuristic.

`setup:cli` builds and verifies the selected `source-build` artifact before it
registers the shim. A missing, inferred, invalid, mismatched, stale, or corrupt
provider artifact fails closed before the caller's continuation: source-build
failures direct the operator to `pnpm run build:runtime`; package failures
identify an incomplete or corrupt package and direct the operator to reinstall.

### Composed runtime and managed identity

After accepting the selected provider, render and `init` compose the authored
root with its generated artifacts into exactly this payload:

```text
config/runtime-config.json
scripts/devcanon-runtime.sh
scripts/resolve-bash.mjs
scripts/runtime/devcanon-runtime.mjs
scripts/runtime/runtime-manifest.json
scripts/runtime/THIRD_PARTY_LICENSES
```

The three leaves under `config/` and directly under `scripts/` are authored
authority. `scripts/runtime/` is one derived composed subtree whose three
leaves come from the explicitly selected provider; those leaves never become
authored source merely because `init`, build, or another composition step
materializes them beneath `skills/devcanon-runtime/`.

For a fresh library, `init` first verifies the selected provider, writes the
three authored leaves without overwriting an existing authored path, and
atomically materializes the complete derived `scripts/runtime/` subtree. If
the runtime root already exists, `init` preserves matching authored leaves and
fails actionably for missing, changed, or unexpected authored content. A
verified derived subtree may be atomically replaced as a unit from the
selected provider; no individual generated leaf is reconciled in place.

Later validation and render classify the same paths by custody. They validate
the three authored leaves as authored input, recognize only the closed
three-leaf `scripts/runtime/` subtree as derived input, and verify every
derived byte against the explicitly selected provider. A missing, partial,
unexpected, stale, or mismatched derived subtree is invalid and is replaced
only by an authorized atomic recomposition; it is neither treated as authored
content nor rejected merely because generated leaves exist below the authored
root. This makes the package-provider flow `init` then `validate` satisfiable
without weakening existing-path protection for authored content.

`pnpm run build:runtime` also materializes byte-identical, ignored source-build
copies of the three generated leaves under
`skills/devcanon-runtime/scripts/runtime/`. Those sibling copies are derived
from `dist/devcanon-runtime/source-build/`, are never committed, and exist only
so source sibling adapters can run. They are not an authored root, a provider
selection mechanism, or an independent transport payload.

The rendered composed tree is the sole symlink target. The install manifest
continues to record `skills/devcanon-runtime/` as `sourcePath`; its generated
path identifies the rendered composition; its content hash covers the full
composed tree; and generated-artifact provenance comes from the accepted build
manifest. Existing copy, symlink, diff, collision, overwrite, and uninstall
semantics remain unchanged. In particular, uninstall remains source-independent.

Validation and provider acceptance precede package acceptance, source-driven
render, `init` copy, and installed transport. Consumers accept only verified
artifacts. Ordinary installed helper execution relies on that accepted payload;
it does not add per-invocation hashing.

### Runtime Packaging and Resolution

#### Entrypoints and compatibility

The public adapter surface remains thin and unchanged:

- `devcanon-runtime.sh runtime ...` launches
  `node scripts/runtime/devcanon-runtime.mjs runtime ...`.
- `devcanon-runtime.sh bootstrap ...` launches
  `node scripts/runtime/devcanon-runtime.mjs bootstrap ...`.
- `scripts/resolve-bash.mjs` remains the direct cross-platform resolver and
  launches the same bundle with `runtime resolve-bash`.

Existing public Node-first helper adapters that invoke the runtime directly
target `devcanon-runtime.mjs runtime ...` internally. They preserve their
public arguments, help, stdout and stderr, error, and resolution contracts.
This decision neither enumerates nor changes those consumer adapters.

The `scripts/runtime/` location preserves the module-relative
`../../config/runtime-config.json` catalog lookup. `contract`,
`resolve-entrypoint`, trusted-bootstrap behavior, typed command schemas, error
ownership, passive sibling resolution, and the no-global-CLI requirement remain
unchanged. Runtime judgment stays outside the runtime: skill prose owns
workflow policy, escalation, operator approval, review judgment, planning
judgment, GitHub posting approval, and issue-routing policy.

The runtime's Markdown parsing grammar and behavior, and the public runtime
command semantics, remain unchanged by this artifact contract.

Adapters retain the explicit `DEVCANON_RUNTIME_DIR` override for tests,
diagnostics, and packaging validation. Without that override, they derive the
logical sibling runtime from their script location and may try its physical
resolved sibling for symlink installation. A missing compatible sibling fails
before validation or state mutation. Direct Node-first and resolver adapters
that do not use trusted bootstrap retain this existing override-resolution
behavior. For trusted-bootstrap consumers only, the override remains test,
diagnostic, or packaging input until the fixed sibling bootstrap has
structurally validated it; it must never locate or load that bootstrap.

For trusted bootstrap, the thin adapter owns only closed command selection,
fixed sibling bootstrap location, and exact argument forwarding. The bootstrap
owns platform path grammar, raw traversal rejection, final-component `lstat`,
physical `realpath` containment, and child dispatch. It rejects an exact raw
`..` component before normalization and rejects a final symlink, junction, or
reparse point before dereference. It proves the real entrypoint is within the
real runtime directory by relative-path semantics rather than string prefix,
then dispatches the independently validated platform target without ambient
shell lookup.

Runtime command groups continue to expose a machine-readable contract
descriptor with the group name and an integer major version. Mutating consumers
reject an unknown major before changing files or state. Managed content hashes
prove transport identity, not command compatibility.

Runtime-backed helpers may require the supported Node.js engine only when they
explicitly opt into `devcanon-runtime`. That requirement neither applies to all
skills nor requires an installed `devcanon` CLI.

### Closed build manifest and canonical inputs

Every generated root contains a closed `runtime-manifest.json` object with
exactly these fields and no others:

```json
{
  "schema": "devcanon-runtime-build/v1",
  "devcanon_version": "2.0.0",
  "artifact_origin": "source-build",
  "input_sha256": "<64 lowercase hexadecimal characters>",
  "bundle_sha256": "<64 lowercase hexadecimal characters>",
  "licenses_sha256": "<64 lowercase hexadecimal characters>",
  "node_target": "node24"
}
```

`schema` is exactly `devcanon-runtime-build/v1`. `artifact_origin` is exactly
`source-build` or `package`; `devcanon_version` equals the producing CLI/package
version; `node_target` is exactly `node24`; and every digest is lowercase
64-hex SHA-256 over exact bytes. Unknown, missing, empty, or mismatched fields,
invalid origin, version or target, and stale or corrupt digest values are
rejected before composition or transport.

`input_sha256` covers the producing DevCanon package version, production runtime
source, bundle configuration and options, relevant root dependency declarations,
the resolved production runtime dependency subgraph, and the pinned bundler
resolution. It excludes timestamps, machine paths, unrelated lockfile records,
and unrelated development dependencies.

Each input record uses a repo-relative POSIX UTF-8 path and exact content
bytes. Reserved virtual records are under `.devcanon-runtime/`. Records sort by
unsigned UTF-8 path bytes. Canonical input bytes concatenate records framed as:

1. unsigned 64-bit big-endian path-byte length;
2. path bytes;
3. unsigned 64-bit big-endian content-byte length; and
4. content bytes.

The virtual `.devcanon-runtime/production-dependencies.json` record is compact
UTF-8 JSON followed by one LF. It contains one object per resolved production
package instance. Each object has keys in this exact order: `id`, `name`,
`version`, `integrity`, and `dependencies`. `id` is the complete canonical
resolved-instance key from the pinned lockfile, including peer-resolution
context, normalized as a machine-path-independent UTF-8 string. IDs are unique
within the closure.

`dependencies` is an array of closed edge objects with keys in this exact
order: `key`, `name`, `alias`, `kind`, and `target_id`. `key` is the exact
lockfile dependency-map key; `name` is the exact resolved package name;
`alias` is the exact normalized lockfile alias selector or `null` when the edge
is not aliased; `kind` is exactly `dependency` or `optional` according to the
lockfile edge; and `target_id` is the exact canonical `id` of the resolved
target package instance. Every `target_id` must name a package record in the
same closure. Within one package record, the tuple (`kind`, `key`, `name`,
`alias`) is unique, and duplicate complete edge records are invalid.

Edges sort by the unsigned UTF-8 bytes of their compact JSON encoding using the
closed key order above, which is a total order over the complete edge tuple.
Package records sort by `id` using unsigned UTF-8 bytes; duplicate IDs are
invalid. Record and edge ordering therefore remain total even when several
instances share a package name and version, and an aliased or optional edge
cannot collapse into a different lockfile edge.

The virtual `.devcanon-runtime/bundler.json` record uses the same closed,
canonical JSON rules for bundler identity, version, `node24`, and normalized
options. The selected implementation records its identity and normalized
options through this input; this decision does not select that implementation.

### Verification regimes and failures

Provider verification begins at the injected generated root. The root must be a
readable physical directory, not a symlink or reparse point. Every path segment
beneath it must remain physically contained by that root without symlink or
reparse traversal; each of the three expected leaves must be a readable regular
non-link file; and any missing or unexpected entry fails closed. These checks
complete before manifest parsing, hashing, composition, or transport.

The explicit provider selects one verification regime:

- **Source-build:** recompute `input_sha256`, then verify the bundle and
  license digests. Missing, stale, or corrupt artifacts fail closed with
  `pnpm run build:runtime` guidance.
- **Package:** require `artifact_origin: "package"`, then verify the
  DevCanon version, Node target, bundle digest, and license digest. A missing,
  mismatched, or corrupt artifact fails closed as an incomplete package with
  reinstall guidance. Package verification does not claim to reconstruct the
  unavailable source or lockfile inputs.

Provider identity and artifact integrity validate before package acceptance,
source-driven render, `init` copy, or transport. Invalid manifests, omitted
payload leaves, unverified or stale transport inputs, and a provider/artifact
origin mismatch are failures, not fallback conditions. Installed `sync` only
verifies and transports prebuilt artifacts; it never builds them or resolves
ambient dependencies.

### Package lifecycle, attribution, and isolation proof

`prepack` is the sole package-production gate. It builds the normal CLI
distribution, creates package-origin runtime artifacts, verifies them, and only
then allows `npm pack` to collect files. No other package lifecycle hook may
produce package artifacts. The npm tarball includes the authored
`skills/devcanon-runtime/` leaves needed for composition and, among generated
roots, only `dist/devcanon-runtime/package/`. It excludes
`dist/devcanon-runtime/source-build/` and the ignored source-build sibling
copies under `skills/devcanon-runtime/scripts/runtime/`.

`THIRD_PARTY_LICENSES` has one LF-normalized deterministic entry for every
package in the bundler-reported production closure. Entries sort by package
name and version, retain complete required license and notice text, and are not
deduplicated across package identities. Missing attribution is a production and
proof failure. The licenses artifact is included in the npm tarball and the
managed composed runtime payload.

A clean-checkout source-build and packed-tarball proof may use a package manager
only to install the packed tarball and declared CLI dependencies into a
temporary prefix. The execution phase removes package-manager and global-CLI
access, uses the package-local CLI to initialize, validate, render, and sync a
temporary library, then copies the resulting composed passive runtime to a
second isolated directory. In that copied-runtime phase, every platform uses
the current Node executable to invoke the bundled `.mjs` runtime and trusted
bootstrap directly from a working directory outside the checkout, with
`NODE_PATH`, `NODE_OPTIONS`, `DEVCANON_RUNTIME_DIR`, uncontrolled
package-manager state, package-manager access, global CLI access, and ambient
`node_modules` unavailable. POSIX additionally proves byte-for-byte stdout and
stderr equivalence plus exact exit-status equality between the `.sh` adapter
and the same `.mjs` surface. Native Windows invokes neither Bash nor a `.sh`
file. After copied-runtime setup, it exercises both resolver subcases: verified
resolution through a controlled real Git-for-Windows installation, and
actionable refusal with the override unset plus controlled decoy and unusable
candidates. The proof asserts the documented contract descriptor and major,
exact exit and stdout/stderr behavior, no invalid candidate selection, and
failure of ambient dependency resolution. Manually assembling a test payload
is not valid proof.

For identical canonical inputs and the same `artifact_origin`, independent
builds must emit byte-identical bundle, manifest, and licenses artifacts.
Failure to reproduce byte-identical artifacts fails production and proof.

## Consequences

- Rendered previews, installed helpers, source sibling copies, `init`, the
  common CLI, the npm `bin`, setup shims, tarballs, and installers have a
  single artifact architecture to consume, while their implementation remains
  deferred.
- The two provider regimes make source-development failures actionable without
  making package installs depend on source-only inputs.
- The composed full-tree identity preserves existing managed copy and symlink
  behavior while preventing generated leaves from becoming authored authority.
- The six dependent behavior specifications define observable behavior. Source
  implementation and executable proof remain deferred to a separate
  implementation change without changing this ADR's ownership boundary or
  catalog partition.

## Alternatives considered

- Keep a tracked JavaScript-and-`node_modules` payload. Rejected because it
  conflates authored and generated custody, obscures package provenance, and
  prevents a compact reproducibility contract.
- Infer source or package provenance from the checkout or artifact path.
  Rejected because ambient filesystem state is neither reliable nor a durable
  authority boundary.
- Allow package verification to recompute source-only inputs. Rejected because
  packaged artifacts intentionally exclude those inputs and the resulting
  check would make a false integrity claim.
- Produce package artifacts from several lifecycle hooks. Rejected because a
  single prepack gate is necessary to prove the tarball's runtime contents.
- Duplicate runtime-catalog custody here. Rejected because ADR-0035 already
  owns target-local catalog projection and a duplicate normative partition
  would drift.
