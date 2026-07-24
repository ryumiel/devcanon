# ADR-0010: Structured Review-Finding Schema for `play-review` Output

## Status

Superseded by ADR-0012

## Note

This ADR is superseded by [ADR-0012](adr-0012-side-channel-file-delivery-for-play-review-findings.md).
The schema name and field shape it defines (`play-review/findings/v1`) are
historical: ADR-0012 first moved the transport to a side-channel file and later
introduced the incompatible `play-review/findings/v2` envelope with mandatory
review-completeness evidence. The Decision § paragraphs about positional rules
("the JSON block is the last fenced block in the report" and the
empty-block-still-emitted rule) and the wrapper re-emission paragraphs
are no longer authoritative — see ADR-0012 § Decision for the current
contract. The detailed current findings-envelope contract is maintained in
`skills/play-review/references/findings-envelope-contract.md`, with
`skills/play-review/SKILL.md` retaining workflow and notice-line ownership.
The Alternatives § entry that originally rejected
`.ephemeral/findings.json` is preserved here as historical record;
ADR-0012 § Context engages with it directly.

## Context

ADR-0009 consolidated the multi-agent review procedure into the shared
`play-review` skill, with `branch-review` and `pr-review` becoming thin
wrappers around it. ADR-0009's Consequences section explicitly carved
out one piece of follow-up work:

> `pr-review`'s output remains free-form prose; consumer cleanup (a
> structured-finding schema for `branch-review --fix` to drop the
> prose-to-JSON translation step in `issue-priming-workflow` Phase 7)
> is explicitly out of scope here.

That cleanup is the subject of this ADR. (ADR-0009's quote names
"Phase 7" because that is where `branch-review --fix` runs; the actual
translation prose lived in the Phase 7 → Phase 8 handoff, sitting in
`issue-priming-workflow`'s Phase 8 "Create PR" section where the
`{path, line, body}` array was assembled before `play-branch-finish`
was invoked. The two phase numbers refer to the same handoff seen from
the producer and consumer sides; this ADR uses "Phases 7-8 handoff"
when the distinction matters.)

The implicit prose-only output contract was brittle for downstream
consumers. Two skills carried the translation burden:

- `skills/issue-priming-workflow/SKILL.md` Phases 7-8 handoff had to
  translate `branch-review --fix`'s free-form prose into a
  `{path, line, body}` array before invoking `play-branch-finish`.
- `skills/play-branch-finish/SKILL.md` explicitly disclaimed any prose
  parsing and pushed that responsibility back onto callers.

LLM re-parsing of LLM prose is an unstable serialization boundary,
duplicated across consumer skills, and leaves the review-skill output
schema implicit and untested.

## Decision

Append a stable, versioned **structured-finding JSON block** to
`play-review`'s output. Schema name: `play-review/findings/v1`.
Historically this ADR documented the schema in the main `play-review` output
section; the current detailed contract lives in
`skills/play-review/references/findings-envelope-contract.md`, and all
consumers cite it by reference rather than re-defining the shape.

Positional rules:

- The JSON block is the **last fenced block** in the report.
- Fence language tag is exactly `json`.
- Exactly one such fence per report.
- Empty findings still emit the block with `findings: []` — consumers
  never see an absent block.

Wrappers re-emit the block on their surfaces:

- `branch-review` Phase 3 appends the block on both `--fix` and
  no-`--fix` paths. On `--fix`, the block's `findings` array carries
  the remaining-set (unfixed blockers, skipped `INVALID`/`DOWNGRADE`
  blockers, all nits).
- `pr-review` Phase 6 builds the `gh api .../reviews` `comments`
  array directly from the block, partitioning by the structured
  `anchor` field. Phase 5 (user gate) markdown is unchanged.

Consumers cite the schema and consume `findings[]` directly:

- `play-branch-finish`'s `nits` input shape is a strict subset of the
  schema; callers pass items through as-is.
- `issue-priming-workflow` Phase 7 classifies nits using the
  structured `severity`, `category`, and `why` fields.

The schema's `body` field is pre-rendered as
`**<severity> | <category>** — <why>\n\n**Recommendation:** <recommendation>`,
suitable for direct use as `gh api .../reviews` `comments[].body`. The
producer (`play-review`) owns the rendering format, preventing drift
between consumer renderings.

## Consequences

- Single source of truth for review findings — schema definition lives
  in one place (`skills/play-review/references/findings-envelope-contract.md`);
  `play-review/SKILL.md` retains the workflow and notice-line hook, and all
  consumers cite the detailed contract by reference.
- Future schema changes go through versioned-schema discipline: bump
  the major version (`v1` → `v2`) on incompatible changes.
- The user-visible markdown surfaces of `pr-review` Phase 5 and
  `branch-review` Phase 3 (no-`--fix` path) are unchanged. The JSON
  block ships alongside the prose for the next program in the pipeline.
- The prose-to-JSON translation step is removed from
  `issue-priming-workflow`'s Phases 7-8 handoff.
- `play-branch-finish`'s "caller is responsible for translating"
  caveat is replaced with a schema-reference pointer.
- `play-review`'s output grows by ~10 lines per finding (the JSON
  block at the end). Acceptable for the consumer-side simplification.
- `play-review`'s no-I/O boundary (ADR-0009) is preserved — the JSON
  block is part of the same in-conversation output, not a side file.

## Alternatives considered

- **Structured markdown headers only** (issue's stated proposal —
  document the existing `### Finding N` + bullet-list shape as the
  authoritative contract). Rejected: the field set is already
  complete, but consumer-side extraction is still LLM-mediated. The
  gap was serialization, not field completeness; a fenced JSON block
  is parseable by `jq` without LLM mediation.
- **Side-channel `.ephemeral/findings.json` file.** Rejected:
  violates `play-review`'s no-I/O boundary established by ADR-0009.
  File I/O is the wrapper's responsibility, not `play-review`'s.
- **`body` field as why-clause only** (consumers render the full
  comment string themselves). Rejected: leaves a small render step
  in every consumer and risks rendering drift across consumers. The
  pre-rendered shape lets `issue-priming-workflow` Phase 8 pass nits
  through to `play-branch-finish` with zero rendering. ("Phase 8" here
  is the consumer side of the Phases 7-8 handoff — where
  `play-branch-finish` is invoked.)

## Related

- ADR-0009: review-pipeline consolidation (deferred this cleanup as
  out-of-scope follow-up)
