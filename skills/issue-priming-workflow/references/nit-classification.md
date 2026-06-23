# Nit classification taxonomy — `issue-priming-workflow` Phase 7

Phase 7's classification rule is a remaining-feedback handoff rule. It uses
the final `branch-review --fix` findings envelope to distinguish feedback that
branch-review owns as fixable from judgment-required feedback that should be
posted after PR creation. The rule itself stays in `SKILL.md`; this file
expands the taxonomy with concrete examples.

- **Fixable by branch-review** — 1–3 line source change (excluding generated
  test snapshot churn), no design judgment, single obvious correct fix.
  Branch-review owns resolving these when `--fix` can do so. Examples:
  - Typos and misspellings.
  - Truncated, incomplete, or broken sentences with one clear reconstruction (e.g., a sentence ending mid-clause).
  - Broken cross-references where the intended target is unambiguous (wrong file paths, stale section numbers after a renumber, dead links to renamed identifiers).
  - Missing words or punctuation where context fully constrains the fix.
  - Variable-naming or placeholder gaps (e.g., a literal `<TODO>` left in a code example) with one obvious replacement.
- **Judgment-required** — anything else. Examples: "this could be clearer,"
  "consider extracting a helper," subjective wording, structural suggestions,
  or any nit where a competent reviewer could defend more than one fix. Only
  this class becomes `nits_file` input when it remains after the final
  branch-review run.
