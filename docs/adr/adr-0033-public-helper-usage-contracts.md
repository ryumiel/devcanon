# ADR-0033: Public Helper Usage Contracts

## Status

Accepted

## Context

Skill-owned scripts are packaged with their owning skill, but executable file
presence alone does not establish a user-facing helper contract. Required
cross-owner workflow actions need a durable identity registry and a local,
version-matched mechanics document without moving workflow judgment into a
script or creating a global CLI discovery surface.

ADR-0019 assigns deterministic mechanics to skill-owned scripts, ADR-0024
permits support-only runtime delegation, ADR-0028 assigns proportional contract
tests to source owners, and ADR-0029 requires one normative owner per concern.
Those decisions do not classify individual script entrypoints as public or
allocate their invocation documentation.

## Decision

`contracts/public-helpers.md` is the sole authority for public per-skill helper
membership, identity, role, owning skill, executable location, and local usage
contract location. It contains exactly five semantic fields per row. A listed
helper has the stable ID `<skill-name>/<script-stem>`; an executable absent from
the catalog remains internal regardless of its location or executable bit.

Each cataloged helper has one adjacent
`skills/<owning-skill>/references/<script-stem>-usage.md` document. That
document solely owns reusable invocation mechanics: invocation, required and
optional arguments, environment/stdin/cwd, outputs, and refusal behavior. It
links back to the owning `SKILL.md`, which solely owns when to run the helper,
result interpretation, escalation, and continuation. The catalog is
identity/navigation only and does not copy commands, mechanics, output tables,
or rollout status.

A later implementation may expose local `--help` by projecting the exact fixed
adjacent usage document from the cataloged script. That local discovery boundary
does not introduce a global `devcanon helpers list` or `devcanon helpers
describe` command, global PATH lookup, new runtime visibility, or caller-chosen
documentation paths. This ADR establishes the source-side ownership contract;
it does not itself add `--help`, migrate action points, or change runtime
visibility.

`CONTRIBUTING.md`, PR and review guidelines, the PR template, `WORKFLOW.md`,
and the `AGENTS.md` command table remain unchanged: this decision adds no
contributor procedure or DevCanon CLI command.

Validation fails closed for a row with empty fields, duplicate IDs or executable
paths, a mismatched owner, a missing source script, or a missing local usage
document. Focused tests verify this stable structure rather than snapshotting
complete prose. Generated and installed outputs, issue comments, and audit
records remain evidence or derived consumers, never competing authorities.

Generic validation and hardening remain proportional to an identified trust
boundary and owning contract. The rule is owned by
[Implementation Proportionality](../guidelines/implementation-proportionality.md);
this ADR does not create per-helper path-containment or file-classification
requirements for fixed local documents.

## Consequences

- Consumers can discover the approved public helper surface without inspecting
  every `scripts/` directory.
- Public invocation mechanics are version-matched and adjacent to each owning
  skill, while skill workflows retain judgment.
- Internal support scripts, optional scripts, and support-only adapters remain
  explicitly excluded from public membership.
- Future helper-interface work must update the catalog and its one usage owner,
  then add focused structural or runtime proof at the owning boundary.

## Alternatives considered

- Treat every executable under `skills/*/scripts/` as public. Rejected because
  file presence does not identify a required workflow action and would expose
  internal adapters.
- Put all usage text in the central catalog. Rejected because it creates a
  second mechanics owner and loses bundle-local version matching.
- Embed help prose in scripts. Rejected because executable implementation would
  become a duplicate documentation owner.
- Add global helper discovery CLI commands. Rejected because they add unrelated
  CLI, PATH, installation, and version-resolution contracts.
