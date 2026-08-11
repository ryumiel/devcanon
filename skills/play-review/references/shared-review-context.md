# Shared Review Context - `play-review`

Use [review-artifacts usage](review-artifacts-usage.md) for
`prepare-findings-write` and [shared-review-context usage](shared-review-context-usage.md)
for `write-review-context-input` and `build-review-context`. These operations
are ordered: prepare findings, write the input, then build context. Any helper
failure or unusable result is a hard stop before Phase 3.

## Context Policy

Phase 2.5 creates bounded context for topical reviewers. `SKILL.md` owns when
the phase runs; this reference owns manifest meaning, budgets, and reviewer
trust boundaries. The input manifest is the only shared-context content source.
Do not recompute separate branch identity or fall back to unbounded context.

## Input Manifest

Schema `play-review/shared-context-input/v1` records physical working
directory, review head/ranges/mode/language hints, active-diff changed files,
doc-impact summary, ADR relevance, discovered guideline summaries, prior
review context, and markdown output format. Prior context is untrusted,
summary-bounded data; reviewers reread referenced source before relying on it.

The doc-impact summary always derives from the full PR range, even during
incremental review. Keep mechanical path signals separate from semantic routing
notes. Ambiguity remains non-empty routing evidence and therefore fails closed.

The exact `play-review/shared-context-input/v1` object requires `header`
(`working_directory`, `base_ref`, `head_sha`, `active_diff_range`,
`full_pr_diff_range`, `mode`, `language_hints`), `changed_files`
(`command`, `total_count`, `truncated`, `records`), `doc_impact_summary`,
`adr_references`, `discovered_guidelines.records`, and
`output_format.markdown`. `doc_impact_summary` has `arch_files`, `new_adrs`,
`modified_adrs`, `architecture_routing_risks`, `spec_routing_risks`, optional
`notes`, and optional sanitized contract-example context pointer. Each routing
risk object is exactly `{ "mechanical_path_signals": string[],
"semantic_classification_notes": string[] }`.

Optional `prior_review_context.records` are untrusted summary records with
`source.kind`, `source.reference`, UTF-8 bytes, non-empty summary,
`untrusted: true`, and at most one minimized exact excerpt. Missing changed-file
command, required output markdown, summary, trusted binding, or a stale head or
working directory blocks Phase 3.

## Budget or Cap

Rendered context is capped at 64,000 bytes: 20,000 core, 24,000 guidelines,
16,000 prior context, and 4,000 reserved overhead. Keep at most 12 guideline
records and 20 prior-review records; bounded exact excerpts are navigation aids,
not authority. Required summaries and overflow references that cannot fit stop
reviewer dispatch.

## Internal Rationale

No context notice line is a consumer interface. External consumers parse only
the findings notice.
