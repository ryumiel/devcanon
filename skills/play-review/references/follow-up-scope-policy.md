# Follow-Up Scope Policy

This reference is the shared full-vs-narrow scope policy for public review
wrappers that invoke `play-review`.

Wrappers apply this policy before invoking `play-review`. Wrappers still supply
the final `active_diff_range`, `full_pr_diff_range`, prior context,
`last_reviewed_sha`, `is_followup_narrow`, and `language_hints`; do not compute
`active_diff_range` inside `play-review`.

## Baseline Selection

Initial reviews always use the full PR or branch diff and set
`is_followup_narrow = false`.

Follow-up reviews start with a candidate narrow range of
`<last_reviewed_sha>..HEAD`. Narrow review is allowed only when mechanical and
semantic checks clearly pass. Any uncertainty escalates to full review.

Full escalation preserves prior context. When a follow-up broadens back to the
full diff, the wrapper still passes `prior_threads` or validated
`prior_branch_findings` so `play-review` can verify unresolved items and carry
them forward.

`language_hints` are computed only after final active range selection, from the
selected active diff. A narrow follow-up uses hints from the narrow range; a
full escalation recomputes hints from the full range.

## Narrow Review Requirements

A wrapper may select the candidate narrow range only when all of these are true:

- The review is a follow-up with a usable `last_reviewed_sha`.
- Mechanical facts needed for the narrow decision are present, trusted, and
  matched to the current branch or PR head.
- The candidate range is `<last_reviewed_sha>..HEAD`.
- Mechanical escalation checks do not require full review.
- Semantic inspection of the candidate diff does not require full review.
- Scope classification is unambiguous.

Missing, malformed, stale, conflicting, or untrusted facts fail closed to full
review unless the wrapper already has a stricter invalid-input rule that stops
before review, such as local paired follow-up argument validation.

## Full Escalation Triggers

Escalate to full review when any of these surfaces appear in the follow-up
candidate diff or in trusted handoff facts:

- more than five changed files
- unusable or non-ancestor `last_reviewed_sha`
- new public API functions or types
- logic restructured beyond previously flagged or adjacent lines
- explicit governance paths:
  - `docs/adr/**`
  - `docs/arch/**`
  - `docs/product-requirements/**`
  - `docs/specs/**`
  - `docs/guidelines/**`
  - `MAP.md`
  - `AGENTS.md`
  - `CONTRIBUTING.md`
- `agents/**`
- reviewer-routing policy
- output schemas
- install/sync behavior
- path-validation guards
- external-invocation guards
- generated-output renderers
- generated-output contracts
- source-owned contracts
- safety boundaries
- broad file/module scope
- architecture surfaces
- shared workflow policy
- ambiguous classification

Upstream planning or execution handoff can justify full review, but it cannot
by itself justify narrow review. Missing, stale, malformed, conflicting, or
untrusted handoff data needed to justify narrow review fails closed to full
review.

## Final Handoff

If escalation fires, set `active_diff_range = full_pr_diff_range` and
`is_followup_narrow = false`. Preserve prior context in the `play-review`
handoff.

If every mechanical and semantic check clearly passes, set
`active_diff_range = <last_reviewed_sha>..HEAD` and
`is_followup_narrow = true`.

After that final selection, recompute `language_hints` from the final
`active_diff_range` and only then invoke `play-review`.
