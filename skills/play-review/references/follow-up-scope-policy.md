# Follow-Up Scope Policy

This reference is the shared full-vs-narrow scope policy for public review
wrappers that invoke `play-review`.

Wrappers apply this policy before invoking `play-review`. Wrappers still supply
the final `active_diff_range`, `full_pr_diff_range`, prior context,
`last_reviewed_sha`, `is_followup_narrow`, and `language_hints`; do not compute
`active_diff_range` inside `play-review`.

Deterministic review-artifact validation belongs to the support skill
`play-validate-review-artifacts`. PR and branch wrappers use their local
adapter scripts to pass explicit surface, head SHA, prior-context, governed
path, configured path, range, changed-file, and language-hint inputs to
`skills/play-validate-review-artifacts/scripts/review-artifacts.sh`. This
reference states the human workflow contract around final scope selection; it
does not duplicate the support validator's shell/JQ policy.

## Baseline Selection

Initial reviews always use the full PR or branch diff and set
`is_followup_narrow = false`.

Follow-up reviews start with a candidate narrow range of
`<last_reviewed_sha>..HEAD`. Narrow review is allowed only when the support
validator accepts the mechanical facts and wrapper semantic checks clearly
pass. Any uncertainty escalates to full review.

Full escalation preserves prior context. When a follow-up broadens back to the
full diff, the wrapper still passes `prior_threads` or validated
`prior_branch_findings` so `play-review` can verify unresolved items and carry
them forward.

`language_hints` are computed only after final active range selection, from the
selected active diff. A narrow follow-up uses hints from the narrow range; a
full escalation recomputes hints from the full range.

## Narrow Review Requirements

A wrapper may select the candidate narrow range only when all of these are true:

- The review is a follow-up with a support-validator-accepted
  `last_reviewed_sha` and candidate range.
- Mechanical facts needed for the narrow decision are present, trusted,
  matched to the current branch or PR head, and accepted by the wrapper's
  support-validator adapter.
- Semantic inspection of the candidate diff does not require full review.
- Scope classification is unambiguous.

Missing, malformed, stale, conflicting, or untrusted facts fail closed to full
review unless the wrapper already has a stricter invalid-input rule that stops
before review, such as local paired follow-up argument validation.

## Full Escalation Triggers

Escalate to full review when the support validator rejects or escalates the
scope-decision artifact, or when wrapper-level semantic inspection identifies
work that needs whole-diff review. Examples of semantic escalation include new
public API surface, logic restructured beyond previously reviewed lines,
architecture or source-contract impact, safety boundaries, generated-output
behavior, broad module scope, shared workflow policy, or ambiguous
classification.

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
