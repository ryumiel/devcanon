# ADR-0028: Adopt Owner-Driven Proportional Contract Testing

## Status

Accepted

## Context

Contract coverage can drift when source-contract and render tests each copy
skill, agent, route, target, or prose inventories. Broad exact-text assertions
also turn editorial changes into failures without proving executable behavior.
The resulting suites are large, fragile, and able to agree with each other
while disagreeing with the normative source.

The repository still needs strong regression evidence for source policy,
generated artifact structure, and the boundaries consumed by workflows. That
evidence must remain close to the behavior it protects without creating a
second contract authority in test code.

## Decision

DevCanon adopts owner-driven proportional contract testing. Each contract has
one normative owner and one primary test layer. A test-only adapter may parse
and validate an owned structured surface once; source-contract and render
tests consume the same owner-derived result while retaining assertions for
their distinct observable boundaries.

Regression coverage is proportional to a concrete failure. Tests preserve
runtime and structural behavior with focused assertions and bounded drift
mutations, while exact-text checks are reserved for executable syntax and
required wire tokens. The operational rules and layer boundaries are owned by
the [Testing Requirements](../specs/testing.md#test-ownership-and-proportionality).

## Consequences

- Contract inventories and route topology remain aligned with their normative
  source instead of being copied into multiple suites.
- Source-contract tests focus on policy and authority, while render tests
  focus on parseable, packaged, target-specific output.
- Editorial changes stop failing tests unless they alter executable syntax or
  a required wire token.
- Test-only owner adapters become load-bearing parsing seams and require
  focused integrity and drift coverage.
- New regression tests must justify their owner, layer, and concrete gap, which
  may require removing obsolete phrase inventories during maintenance.

## Alternatives considered

- Keep duplicated registries in each suite. Rejected because independently
  maintained copies can drift and become competing contract authorities.
- Use broad snapshots or exact-prose assertions. Rejected because they couple
  tests to incidental wording and obscure the observable failure being
  prevented.
- Build a generalized topology registry, marker grammar, runtime discovery
  system, or mutation framework. Rejected because infrastructure of that scope
  would create another ownership surface and exceed the needs of focused
  contract verification.
