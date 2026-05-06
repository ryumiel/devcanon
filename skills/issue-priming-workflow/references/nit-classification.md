# Nit classification taxonomy — `issue-priming-workflow` Phase 7

Phase 7's classification rule routes Nit-severity findings into mechanical
(auto-fix in worktree) or judgment-required (route to PR comments) buckets.
The rule itself stays in `SKILL.md`; this file expands the taxonomy with
concrete examples.

- **Mechanical** — 1–3 line source change (excluding generated test snapshot churn), no design judgment, single obvious correct fix. Examples:
  - Typos and misspellings.
  - Truncated, incomplete, or broken sentences with one clear reconstruction (e.g., a sentence ending mid-clause).
  - Broken cross-references where the intended target is unambiguous (wrong file paths, stale section numbers after a renumber, dead links to renamed identifiers).
  - Missing words or punctuation where context fully constrains the fix.
  - Variable-naming or placeholder gaps (e.g., a literal `<TODO>` left in a code example) with one obvious replacement.
- **Judgment-required** — anything else. Examples: "this could be clearer," "consider extracting a helper," subjective wording, structural suggestions, or any nit where a competent reviewer could defend more than one fix.
