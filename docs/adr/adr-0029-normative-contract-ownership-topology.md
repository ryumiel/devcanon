# ADR-0029: Partition Normative Contract Ownership Across Design and Planning

## Status

Accepted

## Context

A changed behavior can appear in source policy, design prose, planning
references, generated representations, summaries, diagrams, and tests. Without
an explicit ownership topology, repeated descriptions can be mistaken for
independent authorities. Contradictions then encourage further synchronized
restatements and exact-representation checks instead of convergence on the
artifact that owns the behavior.

The ownership method must remain portable to projects with different source
layouts. It must also preserve the boundary between deciding project-specific
authority during design and making approved decisions executable during
planning, without introducing a registry or a new runtime contract system.

## Decision

Partition normative contract ownership by responsibility and phase:

- The `play-brainstorm` source skill owns the universal design-time topology
  method.
- Each approved design artifact owns its project-specific topology decisions.
- The canonical planning criteria own exhaustive plan-time mapping and
  readiness; the main planning workflow is a concise executable consumer of
  those criteria.
- Architecture decision records own durable rationale for this partition, not
  the operational method or project-specific topology.

Each changed behavior has one normative owner. Supporting ownership is allowed
only for explicitly non-overlapping responsibilities with conflict precedence.
Other affected surfaces consume the owner as references, derived
representations, non-normative summaries, or verification. Repetition does not
grant authority, and verification proves owner invariants, reference validity,
or derived parity without becoming a policy owner.

This partition follows the ownership boundary rather than requiring a
particular repository layout. Generated skill packages remain derived
consumers. Ownership conflicts return to the phase that owns the missing or
broken decision instead of being resolved through another synchronized copy.

## Consequences

- Designs carry one explicit project-specific authority topology into
  planning.
- Plans can reject duplicated or incomplete ownership before implementation
  while preserving design authority.
- Supporting owners remain possible for genuinely partitioned responsibilities
  but cannot become overlapping sources of truth.
- Verification remains proportional to the owned contract and generated
  representations can be checked for parity without becoming edit targets.
- The method remains self-contained in portable skills; projects do not need a
  DevCanon-specific guideline, registry, schema, or runtime validator.
- Reviewers must distinguish a missing design decision from a broken plan
  mapping and return each to its owning phase.

## Alternatives considered

- Put the detailed method in a DevCanon repository guideline. Rejected because
  installed skills must remain portable to consumer repositories, and copying
  the procedure back into those skills would recreate competing authority.
- Add a dedicated ownership skill or contract registry. Rejected because it
  would create another authority surface, lifecycle, and integration burden
  without evidence that the existing design-to-planning boundary is
  insufficient.
- Allow every affected artifact to restate the behavior normatively and rely on
  synchronization tests. Rejected because tests can verify drift but cannot
  establish which conflicting copy owns the decision.
