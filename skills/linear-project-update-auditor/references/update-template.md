# Project Update Template

Use this template for the postable Linear update body.

Do not include Linear issue IDs in this body. Keep issue IDs, PR links, counts, and raw evidence in a separate appendix file.

```md
## Status

{One-sentence summary of current project state and recommended health.}

## Progress since last update

- {Major feature or foundation completed/materially advanced}
- {Important decision or risk reduction}
- {Major PR/workstream moved forward}

## Current state

- {Major active feature/workstream and its current status}
- {Major active feature/workstream and its current status}
- {Clarify what is or is not the primary blocker}

## Risks / blockers

- {Risk or blocker}
- {Use “None identified” only if verified}

## Next steps

- {Specific next action}
- {Specific next action}
- {Specific next action}
```

## Appendix Guidance

Write evidence separately, usually under `.ephemeral/`.

Include:

- Current latest health and update timestamp.
- Project target date and milestones when relevant.
- Issue counts only if useful for audit traceability.
- Risky issue IDs and their current state.
- Linked PRs, CI state, and merge/review status.
- Notes when a risk was downgraded after direct inspection.
- Exact proposed write action against the latest update ID; do not propose creating a new update unless explicitly requested.
