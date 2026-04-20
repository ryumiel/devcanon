# ADR Template

Use this template for durable architecture and design decisions that need a
stable record of the problem, decision, consequences, and rejected
alternatives.

## Naming

- Use `adr-NNNN-short-title.md` style filenames.
- Keep titles short and decision-oriented.
- Prefer updating or superseding an existing ADR over creating duplicate
  decision records.

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

- Keep ADRs focused on durable decisions, not task history.
- Link to owned architecture, spec, or contract docs instead of repeating them.
- When a decision changes, mark the old ADR as superseded and point to the new
  one.
