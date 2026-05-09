# ADR-0017: Guarded Tiny-Diff Reviewer Fanout

## Status

Accepted

## Context

`skills/play-review/SKILL.md` dispatches two core reviewers
(Correctness and Data-safety) plus a set of dynamic reviewers keyed off
the active diff's paths and language hints. That keeps branch review
thorough, but the dispatch model was size-insensitive: a tiny low-risk
docs or prompt diff could still trigger Architecture, Documentation,
Docs, or language-specific reviewers solely because a path matched a
trigger class.

The optimization goal is intentionally narrow. Small diffs are not
inherently safe. A one-line change can still alter a path-validation
guard, an external invocation, or a review hard rule. Any efficiency
carve-out therefore has to classify by both size and change type, and it
must preserve the core review path.

Three existing decisions constrain the shape of the solution:

- ADR-0009 makes `play-review` the single source of truth for review
  orchestration. Wrapper-owned fanout logic would reintroduce policy
  duplication in `branch-review` and `pr-review`.
- ADR-0011 keeps most reviewer roles as workflow-local prompt
  templates. The change here is about when those roles fire, not about
  introducing new promoted agents.
- ADR-0015 and ADR-0016 establish the repository's guarded-carve-out
  pattern: optimize only behind explicit all-conditions-must-hold
  rules, and fail closed to the fuller path on uncertainty.

## Decision

Add a guarded tiny-diff mode to `play-review`.

The mode applies only to the dynamic-agent fanout. It does **not**
remove or weaken the core review path.

### Mandatory phases that remain unchanged

- Correctness still always runs.
- Data-safety still always runs.
- Critic verification rules remain intact.
- Follow-up narrow-mode overrides still escalate Architecture or
  Documentation review when their existing conditions are met.

### Activation model

Tiny-diff mode activates only when all of the following hold for the
active diff:

1. The diff stays under explicit file-count and line-count caps.
2. Every touched file belongs to a documented low-risk allowlist.
3. No explicit high-risk disqualifier is present.
4. Classification is unambiguous.
5. Follow-up narrow mode is excluded entirely; those diffs keep the
   existing override-aware full dynamic fanout.

If any check fails or is unclear, `play-review` uses the normal full
dynamic fanout.

### High-risk disqualifier rule

Small-but-risky diffs stay on the broader review path. The documented
disqualifiers include:

- deletes, renames, mode changes, or binary diffs
- ADR, architecture, map, contributor-policy, source, test, manifest,
  schema, config, or spec-document changes
- edits to shell-command examples, external-invocation examples,
  path-validation guards, or core review hard rules
- edits to reviewer-routing policy itself, including tiny-diff
  thresholds, allowlists, disqualifiers, dynamic-agent triggers, or
  follow-up override behavior
- edits to reviewer-briefing template files or any follow-up narrow diff

### Ownership rule

The tiny-diff classification policy lives only in `play-review`. Public
wrappers keep their existing contracts and do not compute or pass a
separate tiny-diff hint.

## Consequences

- Tiny low-risk prose diffs can avoid unnecessary dynamic fanout without
  weakening the branch-level review gate.
- The optimization is conservative by design. Some genuinely safe tiny
  diffs will still receive the broader reviewer set; this is acceptable.
- Future maintainers have a durable policy record that explains why
  size-only routing is unsafe and why the fallback path is intentionally
  broader review.
- Regression coverage should assert the rendered `play-review` contract,
  including both a safe tiny-diff example and a small-but-risky
  counterexample.

## Alternatives considered

- **Wrapper-owned classification.** Rejected because it duplicates
  review-routing policy across `branch-review` and `pr-review`,
  violating ADR-0009's consolidation.
- **Line-count-only threshold.** Rejected because it would misclassify
  small but semantically risky diffs.
- **No contract change, only guidance.** Rejected because the issue is
  about dispatch behavior; advisory prose without an orchestration rule
  would not solve it.

## Related

- ADR-0009: review pipeline consolidation into shared `play-review`
- ADR-0011: reviewer fanout audit
- ADR-0015: skip-dispatch for trivial single-task plans
- ADR-0016: single-task auto final-review carve-out
