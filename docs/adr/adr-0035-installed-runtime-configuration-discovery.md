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
This ADR decides only the catalog partition; passive-runtime artifact
composition and transport are governed separately by ADR-0024.

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

Within the composed passive runtime, this ADR owns only
`config/runtime-config.json`: its closed schema and contents, source-to-target
projection, catalog custody, and selection by the public configuration
inspection commands. It does not define the rest of the payload or how the
whole payload is composed, verified, packaged, transported, isolated, or kept
compatible.

[ADR-0024](adr-0024-shared-support-skill-runtime.md) supersedes this ADR's older
generic claim over passive-runtime payload contents. ADR-0024 owns exact
whole-payload composition and every non-catalog artifact concern; this ADR
takes precedence only for the catalog partition described above.

This ADR also partially supersedes
[ADR-0005](adr-0005-per-target-skill-rendering.md)'s namespace scope-lock by
adding the execution-target-bound `model-codex` namespace. Route skills use
that namespace for full-model bindings: the source capability names the profile
during rendering; an explicit Codex spawn uses the Codex-bound placeholder in
both artifact targets, and a controller later consumes that literal binding and
fails closed if it is missing or invalid. It does not rediscover source
configuration or use the sibling passive runtime catalog as a model fallback.

## Consequences

- Operators can inspect the packaged catalog from an unrelated directory while
  library-operating commands continue to require source configuration.
- A source configuration can project different valid model strings to both
  targets without making installed skills depend on the source checkout.
- Whole-payload composition and transport include the catalog partition under
  ADR-0024's contract without transferring catalog authority to that ADR.
- Catalog corruption, an invalid selected source configuration, and a missing
  rendered route binding fail closed rather than selecting an ambient value.
- A catalog-less runtime cannot satisfy this configuration-discovery contract;
  replacement and compatibility behavior remain owned by ADR-0024.

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
- **Let this ADR define scripts-only migration or whole-payload
  compatibility.** Rejected because those are non-catalog artifact concerns
  owned by ADR-0024.

## See also

- [Configuration](../specs/configuration.md#runtime-configuration-discovery)
- [CLI commands](../specs/cli-commands.md#config-path-and-config-get)
- [Architecture overview](../arch/overview.md#configuration-discovery-and-runtime-catalog-boundary)
- [Shared Passive Runtime Support Bundle](adr-0024-shared-support-skill-runtime.md)
