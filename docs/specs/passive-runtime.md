# Passive Runtime Artifact and Lifecycle Contract

---

## Purpose and ownership

This specification is the sole behavior owner for the passive runtime's
artifact custody, provider acceptance, composition lifecycle, trusted-bootstrap
selection boundary, canonical build inputs, attribution ordering, and
recomposition behavior. The provider-backed behavior in this specification is
required target behavior whose implementation is deferred.

[ADR-0024](../adr/adr-0024-shared-support-skill-runtime.md) records the
architectural decisions and rationale. It does not duplicate this observable
contract. [ADR-0035](../adr/adr-0035-installed-runtime-configuration-discovery.md)
and [Configuration](configuration.md#runtime-configuration-discovery) own the
runtime-catalog schema, semantic contents, projection inputs, and selection
behavior. This specification owns the physical path, stage custody, and
overwrite policy of every catalog instance. Command, installation, and
platform specifications own only behavior added by their public surface and
refer to the requirements below.

This specification does not choose a bundler, change the public runtime command
surface, change managed-install identity, or make generated or installed
artifacts authoritative source.

## Terms

- **Authored adapters:** the source-controlled shell compatibility adapter and
  Node-first Bash resolver beneath `skills/devcanon-runtime/scripts/`.
- **Version-matched adapter pair:** the two PR-ART-01 files shipped together by
  the executing DevCanon distribution, each present as a readable regular
  non-link file. The pair targets only the closed
  `scripts/runtime/devcanon-runtime.mjs` runtime entrypoint layout.
- **Recognized pristine legacy pair:** both legacy PR-ART-01 files, with exact
  bytes and pairing and each present as a readable regular non-link file, named
  by the executing distribution's closed one-time migration allowlist. A
  mixed, incomplete, changed, symlinked, or otherwise non-regular pair is not
  pristine.
- **Provider root:** one closed generated root supplied explicitly as either
  `source-build` or `package`.
- **Source-derived runtime subtree:** the closed
  `skills/devcanon-runtime/scripts/runtime/` copy used by source sibling
  adapters. It is replaceable derived state, not authored authority.
- **Rendered composition:** the target-local payload assembled from the
  authored adapters, a catalog projection produced under ADR-0035, and one
  accepted provider root.
- **Trusted bootstrap:** the bootstrap implementation loaded only from its
  fixed sibling location.
- **Selected runtime:** the structurally validated runtime directory containing
  the entrypoint that trusted bootstrap may dispatch. It may be the logical or
  physical sibling runtime, or a valid explicit override.

## Artifact custody

| ID         | Artifact or stage                                                   | Authority and producer                                                                                                                              | Permitted mutation and consumption                                                                                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR-ART-01  | `scripts/devcanon-runtime.sh`, `scripts/resolve-bash.mjs`           | Source-controlled authored adapters under `skills/devcanon-runtime/`                                                                                | Authoring changes modify them; composition copies them without changing their authority. The bounded PR-ADAPT-02 transition is the only ordinary command-owned replacement, and it replaces a recognized pristine legacy pair only as a pair.                                   |
| PR-ART-02A | source/package `skills/devcanon-runtime/config/runtime-config.json` | Protected packaged and public-command fallback catalog whose schema, semantic contents, and selection behavior come from ADR-0035 and Configuration | Source authoring or package production creates it. `init` may create it only at a fresh path; render and sync validate but never overwrite, repair, reclassify, or use its bytes as target-projection input.                                                                    |
| PR-ART-02B | rendered or installed `config/runtime-config.json`                  | Derived target projection produced from the selected source configuration's resolved `capabilityProfiles`, never from PR-ART-02A bytes              | Render may atomically replace the generated projection as part of full regeneration. Install may transport or replace it only inside an install-authorized whole composed payload, never as a catalog-only repair; installed copies and symlinks never become projection input. |
| PR-ART-03  | `dist/devcanon-runtime/source-build/`                               | Generated by the source-build production step                                                                                                       | Source-development entrypoints may select it explicitly; no consumer may infer that selection from its path or presence.                                                                                                                                                        |
| PR-ART-04  | `dist/devcanon-runtime/package/`                                    | Generated and verified by `prepack`                                                                                                                 | The npm entrypoint may select it explicitly; package consumers never reconstruct unavailable source-only inputs.                                                                                                                                                                |
| PR-ART-05  | `skills/devcanon-runtime/scripts/runtime/`                          | Byte-identical derived copy of the accepted provider's three leaves                                                                                 | Only an authorized compositor may atomically materialize an absent destination or reconcile an existing destination through a staged, validated whole-subtree transition. Live leaves are never mutated individually or promoted to authored authority.                         |
| PR-ART-06  | rendered `devcanon-runtime` tree                                    | Generated composition of PR-ART-01, PR-ART-02B, and the accepted provider from PR-ART-03 or PR-ART-04                                               | Render creates it; it is the sole runtime symlink target and the source of copy installation and full-tree identity.                                                                                                                                                            |
| PR-ART-07  | installed copy or symlink                                           | Managed derivative of PR-ART-06                                                                                                                     | Install, diff, and uninstall follow the manifest and install specifications; installed state never selects a provider or becomes source.                                                                                                                                        |

Each provider root contains exactly these regular, non-link leaves and no
others:

```text
devcanon-runtime.mjs
runtime-manifest.json
THIRD_PARTY_LICENSES
```

The rendered composition contains exactly:

```text
config/runtime-config.json
scripts/devcanon-runtime.sh
scripts/resolve-bash.mjs
scripts/runtime/devcanon-runtime.mjs
scripts/runtime/runtime-manifest.json
scripts/runtime/THIRD_PARTY_LICENSES
```

It contains neither `SKILL.md` nor a Codex invocation sidecar.

## Provider acceptance

### PR-PROV-01: Explicit selection

The common CLI receives exactly one internal provider. Source development,
including `pnpm dev` and the `setup:cli` shim, supplies `source-build`; the npm
entrypoint supplies `package`. Provider identity is never inferred from `.git`,
the current directory, configuration paths, root presence, or another
filesystem heuristic.

### PR-PROV-02: Closed physical root

The selected root must be a readable physical directory and not a symlink or
reparse point. Every descendant segment must remain physically contained by
that root without symlink or reparse traversal. Each expected leaf must be a
readable regular non-link file. Missing and unexpected entries fail before
manifest parsing, hashing, composition, or transport.

### PR-PROV-03: Verification regimes

- `source-build` recomputes canonical input identity and verifies bundle and
  license digests. Failure directs the operator to `pnpm run build:runtime`.
- `package` requires package origin, matching DevCanon version and Node target,
  and valid bundle and license digests. Failure identifies an incomplete or
  corrupt package and directs the operator to reinstall it.

Provider acceptance precedes any authorized runtime recomposition, rendering,
initialization, package acceptance, or installation mutation.

## Adapter compatibility and bounded migration

### PR-ADAPT-01: Compatibility gate

For an existing library, the compositor first accepts the provider, then
classifies the two PR-ART-01 files together under this requirement, and only
then accepts the remaining authored inputs and protected PR-ART-02A catalog.
All of those gates precede source or source-derived runtime mutation. An exact
version-matched pair is compatible only with the current closed provider layout
containing
`scripts/runtime/devcanon-runtime.mjs`. An exact recognized pristine legacy
pair is eligible for PR-ADAPT-02 but is not compatible with the current
provider by itself. Classification never infers compatibility from one adapter,
filenames alone, a partially matching pair, or the existing runtime subtree.
An adapter symlink, reparse point, or other non-regular file is unrecognized
even when its dereferenced bytes match an allowlisted file.
Fresh `init` instead creates the version-matched pair under PR-LIFE-04 and has
no existing pair to classify or migrate.

A missing adapter, mixed pair, modified legacy adapter, or unrecognized pair
fails before adapter, catalog, or PR-ART-05 mutation. The diagnostic identifies
the pair state and instructs the operator to back up both adapters, diff both
against the executing distribution's version-matched pair, explicitly adopt
both files from that same distribution, and rerun the command. It does not
direct the operator to remove or reinstall the whole
`skills/devcanon-runtime/` bundle.

### PR-ADAPT-02: One-time pairwise migration

Only `render` and non-dry `sync` may migrate a recognized pristine legacy pair.
The compositor stages the version-matched adapter pair together with the
three-leaf PR-ART-05 copy of the accepted provider and validates their coherent
composition, including the closed `devcanon-runtime.mjs` entrypoint contract,
before publishing any staged source content. It then publishes the two adapters
as one version-matched pair and reconciles PR-ART-05 through PR-LIFE-11 under
the bounded recovery behavior in PR-ADAPT-03.

This transition preserves `config/runtime-config.json` and every unrelated
library path. It does not remove or reinstall the whole
`skills/devcanon-runtime/` bundle, add a legacy JavaScript shim, negotiate among
runtime versions, or establish a general migration framework. PR-ART-05 remains
reconcilable through the staged whole-subtree boundary. Once the current pair
is present, ordinary PR-ART-01 authored authority and PR-LIFE-11 subtree repair
apply.

### PR-ADAPT-03: Pair-and-subtree recovery boundary

For a handled migration failure, the compositor retains or restores the prior
complete legacy pair and exact pre-migration runtime state, or leaves the
complete validated version-matched pair and canonical PR-ART-05. It never
reports success with a mixed adapter pair or a staged composition that fails
the current entrypoint contract. Residual state after abrupt process or host
termination receives the same next-mutation validation and fail-closed
recovery guidance as PR-LIFE-11; this contract adds no continuous-visibility or
crash-consistency guarantee.

## Lifecycle and repair transitions

The renderer-owned compositor is the only ordinary owner of composition and
repair. It accepts already-verified provider bytes and catalog input and can
project a composition read-only, atomically materialize the complete
source-derived runtime subtree at an absent destination, or reconcile an
existing subtree through PR-LIFE-11.

| ID         | Operation                | Required behavior                                                                                                                                                                                                                                                         |
| ---------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR-LIFE-01 | `pnpm run build:runtime` | Produces and verifies PR-ART-03 and may refresh the checkout-local source-build sibling copy. It does not repair an arbitrary initialized library.                                                                                                                        |
| PR-LIFE-02 | `setup:cli`              | Builds and verifies PR-ART-03 before registering the source-development shim.                                                                                                                                                                                             |
| PR-LIFE-03 | `prepack`                | Is the sole package-production gate; it produces and verifies PR-ART-04 before packing.                                                                                                                                                                                   |
| PR-LIFE-04 | fresh `init`             | Verifies its provider, creates authored paths and PR-ART-02A without overwriting existing paths, and atomically materializes PR-ART-05. `init` is not a repair command for an existing configured library.                                                                |
| PR-LIFE-05 | `validate`               | Is read-only. It accepts provider state, applies PR-ADAPT-01, then verifies remaining authored input, PR-ART-02A, and PR-ART-05. A recognized pristine legacy pair fails with `devcanon render` migration guidance; invalid derived state retains render-repair guidance. |
| PR-LIFE-06 | `render`                 | Is the explicit runtime-subtree repair and bounded adapter-migration operation. After completing the ordered PR-ADAPT-01 gates, it performs eligible PR-ADAPT-02 migration or reconciles invalid PR-ART-05, then writes PR-ART-06 including PR-ART-02B.                   |
| PR-LIFE-07 | `sync --dry-run`         | Uses a read-only composition projection and previews any eligible PR-ADAPT-02 migration and required subtree reconciliation. It performs no source, generated, installed, or manifest mutation.                                                                           |
| PR-LIFE-08 | non-dry `sync`           | Reuses the same compositor after its earlier manifest preflight. It may perform eligible PR-ADAPT-02 migration or reconcile PR-ART-05 before rendering and transporting PR-ART-06; it never builds a provider or resolves ambient dependencies.                           |
| PR-LIFE-09 | `diff`                   | Uses a read-only composition projection and never repairs or migrates source state. A recognized pristine legacy pair fails with render-migration guidance; invalid derived state retains render-repair guidance before difference reporting.                             |
| PR-LIFE-10 | `uninstall`              | Remains manifest-driven, source-independent, and provider-independent.                                                                                                                                                                                                    |

### PR-LIFE-11: Whole-subtree reconciliation boundary

This requirement owns ordinary PR-ART-05 subtree mechanics, not adapter-pair
eligibility or publication. Ordinary repair first accepts the selected
provider, classifies a current compatible pair under PR-ADAPT-01, and then
validates the remaining authored inputs and protected PR-ART-02A catalog. It
stages the complete three-leaf runtime subtree and validates the staged result.
At an absent destination, it may atomically materialize PR-ART-05. At an
existing destination, it reconciles the staged result as a whole subtree and
never mutates live leaves individually. For handled failures, repair retains or
restores the prior complete tree, or fails closed with a complete recoverable
state. It reports success only after canonical PR-ART-05 validates as the new
complete tree.

When PR-ADAPT-02 wraps this boundary, PR-ADAPT-01 owns legacy-pair eligibility
and PR-ADAPT-02/03 own pair staging, publication, and combined recovery.
PR-LIFE-11 supplies only the staged PR-ART-05 materialization or reconciliation
mechanics inside that migration.

This contract does not guarantee a single-syscall directory exchange,
continuous visibility to concurrent readers, or crash consistency across
abrupt process or host termination. The next mutation validates canonical and
residual state, then repairs it or refuses mutation with recovery guidance.
Except for replacement of the exact recognized pristine legacy pair under
PR-ADAPT-02, missing, changed, or unexpected authored content or protected
catalog input is never repaired automatically. A provider failure occurs before
source-derived mutation.

Changing provider origin or upgrading the provider can make an initialized
library's derived subtree stale without making its authored content invalid.
Running `devcanon render`, or a non-dry `devcanon sync`, reconciles that stale
subtree from the newly accepted provider. Switching in either direction
between `package` and `source-build` follows the same transition.

## Package and transport boundary

### PR-PKG-01: Single production gate

`prepack` is the sole package-production gate. It builds the normal CLI
distribution, creates the package-origin runtime artifacts, verifies them, and
only then permits `npm pack` to collect files. No other package lifecycle hook
produces package artifacts.

### PR-PKG-02: Tarball inventory

The npm tarball includes the source runtime inputs needed for composition and,
among generated provider roots, only
`dist/devcanon-runtime/package/`. It excludes
`dist/devcanon-runtime/source-build/` and the ignored source-derived copies at
`skills/devcanon-runtime/scripts/runtime/`. The package provider's licenses
artifact is included in both the tarball and every managed composed payload.

### PR-PKG-03: Prebuilt transport

Installed `sync` accepts and transports a prebuilt provider. It never builds
one or resolves ambient dependencies. Isolation acceptance uses a package-local
CLI and a copied rendered composition; manually assembled payloads and
checkout-local helpers cannot prove that boundary. Platform-specific execution
requirements remain owned by [Platform and Security](platform.md).

## Runtime resolution

### PR-RES-01: Logical sibling

Without an explicit runtime override, an adapter first derives the logical
`devcanon-runtime` sibling from its own script location. It accepts only a
compatible sibling that passes the applicable structural and command-contract
validation.

### PR-RES-02: Physical sibling fallback

When a symlinked adapter's logical sibling is missing or incompatible, the
adapter may resolve its own physical path and try the corresponding physical
sibling. This is the only implicit fallback. It does not change provider
identity or make the physical installation an authored source.

### PR-RES-03: Fail before mutation

If an allowed explicit override, logical sibling, and applicable physical
sibling fallback do not produce a compatible runtime, resolution fails before
validation-dependent work or state mutation. The diagnostic identifies the
missing or incompatible sibling boundary rather than claiming downstream
success.

### PR-RES-04: No ambient discovery

Resolution never searches the working directory, ancestor directories,
`PATH`, a global `devcanon` executable, ambient `node_modules`, or package
manager state. `DEVCANON_RUNTIME_DIR` is an explicit test, diagnostic, or
packaging input, not ambient discovery. Runtime-backed helpers therefore remain
usable from an isolated copied payload without a source checkout or global CLI.

## Trusted bootstrap and selected runtime

### PR-BOOT-01: Fixed bootstrap trust anchor

The thin adapter selects only a closed command, loads trusted bootstrap from
its fixed sibling location, and forwards arguments exactly. An explicit
`DEVCANON_RUNTIME_DIR` never locates, loads, or replaces trusted bootstrap.

### PR-BOOT-02: Valid external runtime selection

After trusted bootstrap is loaded, a valid `DEVCANON_RUNTIME_DIR` may select a
runtime outside the bootstrap's copied runtime for tests, diagnostics, or
packaging validation. Being outside the bootstrap directory is not itself an
error.

### PR-BOOT-03: Entrypoint containment

Bootstrap validates the selected runtime and requested platform entrypoint. It
rejects an exact raw `..` component before normalization, rejects a final
symlink, junction, or reparse point before dereference, and proves with
relative-path semantics that the physical entrypoint is contained by the
physical selected runtime. It rejects an invalid override, an attempt to use
the override as bootstrap authority, or a target escaping the selected runtime
before child execution.

## Canonical build and attribution

### Runtime manifest

Each provider root contains a closed `runtime-manifest.json` object with
exactly these fields:

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

`artifact_origin` is exactly `source-build` or `package`;
`devcanon_version` equals the producing CLI version; `node_target` is `node24`;
and every digest is exact lowercase SHA-256. Unknown, missing, empty, or
mismatched fields fail provider acceptance.

### Canonicalization rules

`input_sha256` covers the producing DevCanon version, production runtime source,
bundle configuration and normalized options, relevant root dependency
declarations, the resolved production dependency closure, and the pinned
bundler resolution. It also covers every first-party artifact-producing code or
configuration input capable of affecting emitted artifacts or the selection of
another covered input. It excludes timestamps, machine paths, unrelated
lockfile records, and unrelated development dependencies. Reserved virtual
records live under `.devcanon-runtime/`.

| ID          | Record or artifact             | Identity and total ordering                                                                                                                                                                                     |
| ----------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR-CANON-01 | canonical input records        | Repo-relative POSIX UTF-8 paths sort by unsigned UTF-8 path bytes. Each record frames unsigned 64-bit big-endian path length, path bytes, content length, and exact content bytes.                              |
| PR-CANON-02 | resolved package instances     | Each record has closed ordered keys `id`, `name`, `version`, `integrity`, and `dependencies`. The machine-independent lockfile instance `id`, including peer-resolution context, is unique and is the sort key. |
| PR-CANON-03 | dependency edges               | Each edge has closed ordered keys `key`, `name`, `alias`, `kind`, and `target_id`. Compact JSON bytes provide the total sort order; duplicate complete edges are invalid.                                       |
| PR-CANON-04 | `THIRD_PARTY_LICENSES` entries | Every resolved production package instance contributes exactly one LF-normalized entry associated with its PR-CANON-02 `id`. Entries sort by unsigned UTF-8 bytes of that unique `id`, not name and version.    |
| PR-CANON-05 | emitted provider artifacts     | Identical canonical inputs and the same `artifact_origin` produce byte-identical bundle, manifest, and licenses artifacts.                                                                                      |

`THIRD_PARTY_LICENSES` retains complete required license and notice text.
Missing, duplicate, or unknown package-instance IDs and missing attribution are
production and proof failures. Instances with the same name and version but
different canonical IDs remain distinct, and dependency traversal order cannot
change the emitted licenses bytes.

The virtual `.devcanon-runtime/production-dependencies.json` record is compact
UTF-8 JSON followed by one LF. Every `target_id` names a package record in the
same closure. Within a package record, (`kind`, `key`, `name`, `alias`) is
unique. The `.devcanon-runtime/bundler.json` record uses the same closed,
canonical JSON discipline for bundler identity, version, `node24`, and
normalized options.

## Acceptance scenarios

### PR-SC-01: External selected runtime

Given trusted bootstrap in runtime A and a structurally valid explicit runtime
B in a disjoint directory, bootstrap remains loaded from A and successfully
dispatches a validated entrypoint contained by B with exact arguments and exit
status. A target escaping B fails before execution.

### PR-SC-02: Same-name and same-version instances

Given two production package instances with the same name and version but
different peer-resolution context, the license artifact contains two entries
ordered by their distinct canonical IDs. Reversing dependency traversal does
not change the artifact bytes.

### PR-SC-03: Existing-library repair

Given valid authored input and a missing, stale, or provider-mismatched
PR-ART-05, `validate` fails read-only with render guidance. For a missing
destination, `render` atomically materializes the complete subtree; for an
existing stale or provider-mismatched destination, it reconciles the complete
subtree through PR-LIFE-11. Non-dry `sync` reuses that behavior, and
`sync --dry-run` previews it without mutation.

### PR-SC-04: Pristine legacy adapter migration

Given one recognized pristine legacy adapter pair and an accepted current
provider, `sync --dry-run` previews replacement of both adapters and PR-ART-05
without mutation. `render` or non-dry `sync` stages and validates the coherent
current composition, publishes the version-matched pair, reconciles PR-ART-05,
and preserves the catalog and unrelated content. A repeated invocation sees
the current pair and performs no migration.

### PR-SC-05: Unrecognized adapter state

Given a missing adapter, mixed pair, modified legacy adapter, or unrecognized
pair in an existing library, every composing command fails before source or
runtime mutation with the PR-ADAPT-01 backup, diff, and pair-adoption guidance.
Read-only commands do not repair that state.

## Verification expectations

Provider and compositor implementation must have focused executable tests for
closed-root validation, provider ordering, absent-destination atomic
materialization, staged whole-subtree reconciliation and handled-failure
recovery, read-only commands, disjoint selected-runtime containment,
duplicate-instance license ordering, and same-origin reproducibility.
Platform-neutral tests may exercise path grammar and a disjoint A/B runtime
fixture on any supported host.

Focused adapter tests must cover a current version-matched pair, one recognized
pristine legacy pair, mixed, missing, modified, symlinked, and unrecognized
pairs; closed `devcanon-runtime.mjs` entrypoint validation; pair-and-subtree
handled-failure recovery; dry-run preview; read-only non-mutation; idempotent
repeat execution; and preservation of `config/runtime-config.json` and
unrelated library content.

Native Windows implementation and machine-executed proof are deferred to the
Windows follow-up rather than required from the documentation change that
establishes this contract. That follow-up must use native Node and must not use
Bash or a `.sh` file. The durable cross-platform requirements above do not
depend on the state of that follow-up.

## Agent context

- Preserve one normative owner: change shared runtime behavior here first and
  make surface specifications consume stable requirement IDs.
- Preserve PR-ART-02A/02B physical custody and overwrite policy here while
  leaving catalog schema, semantics, projection inputs, and selection behavior
  with ADR-0035 and Configuration.
- Do not add a new repair command unless a separate decision changes the
  renderer-owned compositor contract.
- Keep adapter migration limited to the exact pairwise PR-ADAPT-02 transition;
  do not add N-version negotiation, legacy runtime shims, or whole-directory
  replacement.
- Do not turn native Windows proof status into a normative dependency.
