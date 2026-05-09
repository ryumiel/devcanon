# ADR-0008: AFDS v2 Enforcement in the Brainstorm/Planning/Review Pipeline

## Status

Accepted. Followed up by [ADR-0009](adr-0009-review-pipeline-consolidation.md), which closes the deferred wrapper-refactor cycle and the Sub-check B asymmetry called out in Consequences.

## Context

The repository defines AFDS v2 in `docs/guidelines/documentation-standard.md`,
mandating that durable architectural decisions land in `docs/adr/`, system
shape changes land in `docs/arch/`, and navigation moves land in `MAP.md`.
The complementary checklist is in `docs/guidelines/documentation-checklists.md`.

The pipeline that automates issue → design → plan → implementation → review
did not systematically enforce this:

- `play-brainstorm` did not scan existing ADRs/`docs/arch/` and did not flag
  whether proposed approaches required new architectural documentation.
- `play-planning` did not require corresponding documentation tasks when a
  design implied an architectural decision.
- `branch-review` and `pr-review` did not load `documentation-standard.md`
  into context and did not enforce ADR coverage as a review finding.
- `pr-review` was structurally asymmetric with `branch-review`: it had no
  Architecture or Documentation dynamic agent, so PRs that bypassed
  `branch-review --fix` escaped architectural review entirely.

## Decision

Wire AFDS v2 enforcement into the four pipeline skills via prompt edits and
trigger-set expansion:

1. `play-brainstorm` scans `docs/adr/` and `docs/arch/overview.md`, and the
   chosen design carries a "Documentation impact" subsection naming any
   affected files.
2. `play-planning` requires that every "Documentation impact" item from the
   design map to at least one task in the plan; the Plan Review subagent
   enforces this.
3. `branch-review` and `pr-review` Phase 2 load `documentation-standard.md`
   and `documentation-checklists.md`. Phase 1 emits a structured doc-impact
   summary (architectural-knowledge files touched, new/modified ADRs).
4. The Architecture dynamic agent's trigger expands to include
   `docs/adr/**`, `docs/arch/**`, `MAP.md`, `AGENTS.md`, and `agents/**`.
5. The Architecture agent gains an ADR-coverage sub-check that surfaces a
   `Blocking | Documentation` finding when a durable decision ships without
   a matching ADR.
6. `pr-review` mirrors branch-review's Architecture and Documentation
   dynamic agents (resolving the long-standing asymmetry) with a pr-review
   specific anchoring rule for missing-file findings.

## Consequences

- AFDS v2 ADR coverage becomes an enforced review gate in both branch-review
  and pr-review.
- Pr-review's `{{model:deep}}` Architecture agent fires on a wider set of
  PRs (any diff touching architectural-knowledge files). Acceptable at
  current PR volume.
- Pr-review and branch-review now duplicate review logic for Architecture
  and Documentation agents. ADR-0009 later replaces that duplication with
  a shared review core.
- The "Documentation impact" subsection in design docs becomes a structured
  hand-off contract between `play-brainstorm` and `play-planning`.
- Sub-check B (cross-document identifier drift) asymmetry remains in
  pr-review; ADR-0009 later resolves that asymmetry.

## Alternatives considered

- **Elevate Architecture to a Core agent in pr-review** — runs `{{model:deep}}`
  on every PR including typo fixes; cost outweighs benefit given that the
  trigger expansion already covers the architectural-knowledge-files case.
- **Standalone `play-architecture` skill** between brainstorm and planning —
  inserts a mandatory gate that is overkill for designs with no ADR
  implications; same outcome achievable via prompt edits.
- **`agents/architect.yaml` YAML agent** — violates
  `docs/guidelines/agent-authoring-guide.md` §1 ("Default to Skills"); no
  execution constraint requiring a YAML agent.
- **Wrapper refactor of pr-review now** — deduplicates by making pr-review a
  GitHub-fetch + GitHub-post wrapper around shared review core. Cleaner
  long-term architecture but doubles this proposal's risk and scope.
  Rejected for this decision; ADR-0009 later takes that path after the
  AFDS v2 enforcement model exists.
- **Deterministic-finding gate** that emits a `Nit | Documentation` finding
  straight from a Phase 1 mechanical check — would either duplicate the LLM
  Architecture finding (false positives) or replace it (loses judgment).
  Reduced to: Phase 1 emits structured doc-impact data into the Architecture
  agent's briefing as anchor context, with no separate finding source.
- **Pre-commit/CI mechanical gate** that fails on architectural diffs
  without ADRs — AFDS §5.4-aligned and worth doing, but a different surface
  (hooks, CI config).
