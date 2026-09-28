# Nit classification taxonomy — `issue-priming-workflow` Phase 7

Phase 7 uses the final findings/v3 envelope to hand off all remaining
nonblocking feedback. Every Nit and every `DOWNGRADE` goes to the existing
`nits_file` for Phase 8, after INVALID entries are excluded and true blockers
stop auto mode. The descriptions below help operators understand the feedback;
neither class authorizes branch-review or issue-priming source edits.

- **Apparently mechanical, still report-only** — a small correction with one
  obvious answer, such as a typo, misspelling, unambiguous broken cross-reference,
  truncated sentence, missing word/punctuation, or constrained placeholder
  replacement. Lack of judgment does not supply the separate verification
  required for automatic mutation; nits are not verifier inputs merely to
  obtain fix eligibility. Include these remaining nits in `nits_file`.
- **Judgment-required, report-only** — subjective wording, extraction or
  structural suggestions, or any nit with multiple defensible fixes. Include
  these remaining nits in the same `nits_file`.

Feedback withheld by verification eligibility or proportionality remains in
this handoff. Manual operators decide how to address it under their existing
authority; classification creates no implementation authority or new fix loop.
