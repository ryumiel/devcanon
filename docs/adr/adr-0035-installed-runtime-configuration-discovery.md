# ADR-0035: Installed Runtime Configuration Discovery by Projection

## Status

Accepted

## Context

DevCanon has two configuration needs that must not be conflated. Library
commands need a selected source configuration to locate source directories,
target homes, manifest state, and the capability-profile catalog. Operators
also need a read-only way to inspect configuration from an arbitrary current
directory. Installed runtime-backed skills need the profile values that were
selected for their target, but cannot safely rediscover an arbitrary source
checkout or depend on ambient configuration at execution time.

The passive runtime was previously understood as a scripts-only transport
bundle. That form cannot carry an independently validated, render-projected
target-local catalog copy and makes installed runtime discovery ambiguous.

## Decision

Public `devcanon config path` and `devcanon config get` select source
configuration in the normal explicit-path, environment, then current-directory
order. Only when no source configuration is selected do they read the packaged
runtime catalog. A selected missing or invalid source configuration fails; it
does not fall through to the catalog or another source.

The source configuration and the runtime catalog have separate authority. The
source schema owns library configuration and the capability profiles used for
rendering. The runtime catalog is an exact, validated transport object that
contains only its schema identifier and capability profiles. During rendering,
each enabled target selected for that render receives the same complete paired
Claude-and-Codex catalog projected from the selected source profiles alongside
its runtime scripts. Generated previews and installed payloads are derived
transport outputs, not user configuration or independent model-selection
authority.

The passive `devcanon-runtime` bundle is current-format-only: its fixed
validated payload contains `config/` and `scripts/`, and excludes `SKILL.md`
and a Codex invocation sidecar. Scripts-only payloads are incomplete. DevCanon
does not upgrade, reconcile, or promise uninstall compatibility for a
pre-change scripts-only payload.

This ADR partially supersedes [ADR-0024](adr-0024-shared-support-skill-runtime.md)
only for passive-runtime payload contents and current-format catalog custody.
ADR-0024's other deterministic-runtime, resolution, and packaging decisions
remain accepted.

Route skills use execution-target-bound full-model bindings. The source
capability names the profile during rendering; an explicit Codex spawn uses the
Codex-bound placeholder in both artifact targets, and a controller later
consumes that literal binding and fails closed if it is missing or invalid. It does
not rediscover source configuration or use the sibling passive runtime catalog
as a model fallback.

## Consequences

- Operators can inspect the packaged catalog from an unrelated directory while
  library-operating commands continue to require source configuration.
- A source configuration can project different valid model strings to both
  targets without making installed skills depend on the source checkout.
- The runtime payload, render hash, source validation, and installed copy
  identity include the catalog as well as scripts.
- Catalog corruption, an invalid selected source configuration, and a missing
  rendered route binding fail closed rather than selecting an ambient value.
- Existing scripts-only runtime payloads require manual replacement with a
  current-format bundle; they are outside compatibility and cleanup guarantees.

## Alternatives considered

- **Make every command fall back to the packaged catalog.** Rejected because a
  catalog cannot supply the library and installation settings required by
  library-operating commands.
- **Have installed skills rediscover a source configuration at execution
  time.** Rejected because current-directory, environment, and checkout state
  are ambient and may not match the target that rendered the skill.
- **Keep the runtime scripts-only and hard-code profile values in consumers.**
  Rejected because it duplicates target configuration and hides the transport
  boundary from validation and identity checks.
- **Accept or migrate scripts-only runtime payloads.** Rejected because that
  would make the current payload boundary and its custody guarantees ambiguous.

## See also

- [Configuration](../specs/configuration.md#runtime-configuration-discovery)
- [CLI commands](../specs/cli-commands.md#config-path-and-config-get)
- [Architecture overview](../arch/overview.md#configuration-discovery-and-runtime-catalog-boundary)
- [Shared Passive Runtime Support Bundle](adr-0024-shared-support-skill-runtime.md)
