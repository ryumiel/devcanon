# ADR Template

Use this template for durable architecture and design decisions that need a
stable record of the problem, decision, consequences, and rejected
alternatives.

## Naming

- Use `adr-NNNN-short-title.md` style filenames.
- Keep titles short and decision-oriented.
- Prefer updating or superseding an existing ADR over creating duplicate
  decision records.

## Durability Rules

- ADR body prose must pass the rename-fragility litmus test: it should still be
  understandable if issue titles, branch names, PR numbers, task labels,
  tracker IDs, or other live-work metadata change later.
- Do not put tracker IDs, issue links, branch names, PR numbers, task labels, or
  task history in durable ADR body prose.
- Accepted ADRs must not use `## Amendment` sections. When the decision changes,
  supersede the ADR or update an owning durable doc instead.
- Before deleting stale ADR prose, move any durable claims that should survive
  to the owning spec, architecture doc, guideline, or successor ADR.

## Template

```md
# ADR-<NNNN>: <Title>

## Status

Proposed | Accepted | Superseded

## Context

<Problem, constraints, and decision pressure>

## Decision

<What was decided>

## Consequences

<Tradeoffs, follow-on effects, migrations, or risks>

## Alternatives considered

- <Option A>
- <Option B>
```

## Usage Notes

- Keep ADRs focused on durable decisions, not task history, and apply the
  durability rules above before accepting or revising an ADR.
- Link to owned architecture, spec, or contract docs instead of repeating them.
- When a decision changes, mark the old ADR as superseded and point to the new
  one.
