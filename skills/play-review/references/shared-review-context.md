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

The following is a descriptive contract shape, not a literal manifest; its
`required`, `optional`, and `limits` labels describe the manifest fields.

```json
{
  "schema": "play-review/shared-context-input/v1",
  "header": {
    "required": [
      "working_directory",
      "base_ref",
      "head_sha",
      "active_diff_range",
      "full_pr_diff_range",
      "mode",
      "language_hints"
    ],
    "mode_enum": ["present", "fix", "github-post"]
  },
  "changed_files": {
    "required": ["command", "total_count", "truncated", "records"],
    "records": { "required": ["status", "path"] }
  },
  "doc_impact_summary": {
    "required": [
      "arch_files",
      "new_adrs",
      "modified_adrs",
      "architecture_routing_risks",
      "spec_routing_risks"
    ],
    "optional": ["notes"]
  },
  "adr_references": [{ "path": "string", "reason": "string" }],
  "discovered_guidelines": {
    "records": {
      "required": ["path", "bytes", "summary"],
      "optional": ["priority", "exact_excerpts"]
    }
  },
  "prior_review_context": {
    "records": {
      "required": ["source", "bytes", "summary", "untrusted"],
      "optional": ["exact_excerpt"]
    }
  },
  "output_format": { "required": ["markdown"] },
  "limits": {
    "guideline_exact_excerpt_max_utf8_bytes": 4000,
    "prior_review_exact_excerpt_max_utf8_bytes": 2000
  }
}
```

Each routing-risk object is exactly `{ "mechanical_path_signals": string[],
"semantic_classification_notes": string[] }`. The sanitized contract-example
context pointer is carried in `spec_routing_risks.semantic_classification_notes`,
not as a doc-impact-summary field. Optional prior-review records are untrusted
summary records: `source` has `kind` and `reference`, and `untrusted` is `true`.
Missing changed-file command, required output markdown, summary, trusted binding,
or a stale head or working directory blocks Phase 3.

## Budget or Cap

Rendered context is capped at 64,000 bytes: 20,000 core, 24,000 guidelines,
16,000 prior context, and 4,000 reserved overhead. Keep at most 12 guideline
records and 20 prior-review records; bounded exact excerpts are navigation aids,
not authority. Required summaries and overflow references that cannot fit stop
reviewer dispatch.

## Internal Rationale

No context notice line is a consumer interface. External consumers parse only
the findings notice.
