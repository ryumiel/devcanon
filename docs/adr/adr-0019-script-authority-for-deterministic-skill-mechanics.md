# ADR-0019: Script Authority for Deterministic Skill Mechanics

## Status

Accepted

## Context

Several workflow skills include repeated inline shell blocks for deterministic
file and artifact mechanics: `.ephemeral` guards, path-shape checks, symlink
rejection, schema assertions, derived artifact paths, temporary-file writes, and
atomic replacement. Inline shell made those contracts visible when the
path-based phase handoff pattern was introduced, but repeated prompt-embedded
blocks are now difficult to keep consistent across skills and tests.

The repository already supports skill-owned `scripts/` directories. Those
scripts are rendered, synced, hashed, and installed with the owning skill. The
snapshot manifest helper shows the preferred authority model for complex
deterministic behavior: executable mechanics live in a tested script, while the
skill body carries the invocation contract and policy.

## Decision

Complex, reusable, deterministic shell behavior belongs in a dedicated script
under the owning skill's `scripts/` directory.

Skill prose remains authoritative for workflow policy, judgment, routing, review
classification, and operator escalation. Script files are authoritative for
deterministic executable mechanics such as:

- path validation
- symlink and file-kind guards
- schema checks
- derived artifact paths
- temporary-file writes
- atomic replacement
- parseable stdout contracts

`SKILL.md` files that invoke such scripts should describe the script path,
required inputs, stdout or output-file contract, and failure behavior. They
should not inline long reusable shell blocks when the same behavior can be
tested directly as an executable helper.

Direct script tests own the low-level behavior. Render tests should assert that
rendered skills reference the canonical scripts and preserve the operator-facing
contracts, not that every internal guard line appears in every prompt.

Scripts stay under owning skills until there is a separate accepted decision for
a shared runtime utility layer. Ownership boundaries matter: a helper for
`play-review/findings/v1` belongs to `play-review`; a helper for an
`issue-priming-workflow` artifact belongs to `issue-priming-workflow`.

## Consequences

- Prompt context shrinks because repeated shell blocks are replaced with compact
  invocation contracts.
- Drift risk drops because deterministic behavior has one executable
  implementation per ownership boundary.
- Failure behavior becomes directly testable with isolated fixtures.
- Skill bundles remain self-contained under the existing render and sync model.
- Shared utility extraction remains possible later, but requires a separate
  packaging and path-resolution decision.

## Alternatives considered

- Keep inline shell as the authoritative contract. Rejected because repeated
  prompt-embedded bash has already become a drift and context-cost problem.
- Create a shared repository-level shell utility now. Rejected because DevCanon
  currently packages and installs skill-owned `scripts/` directories, not a
  cross-skill runtime library.
- Extract only write-heavy blocks. Rejected because validation guards are the
  main duplicated safety surface and would continue to drift.
