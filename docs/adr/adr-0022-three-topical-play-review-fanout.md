# ADR-0022: Three-Topical `play-review` Fanout

## Status

Accepted

## Context

ADR-0009 made `play-review` the shared review orchestration owner for
`branch-review` and `pr-review`. Later fanout decisions refined that shared
review path in smaller steps:

- ADR-0011 classified the then-current `Correctness`, `Data-safety`,
  language-idiomatic, and test-coverage reviewer roles and recommended a
  follow-up promotion of `data-safety-reviewer`.
- ADR-0017 added guarded tiny-diff mode around separate core reviewers plus
  dynamic reviewer fanout.
- ADR-0018 described reduced per-task review routes as relying on a final
  whole-diff gate that always ran separate correctness and data-safety
  reviewers, with tiny-diff mode able to suppress dynamic documentation,
  language, test, and architecture reviewers.

Those records remain the accepted history of the decisions they made at the
time. The current review orchestration pressure is different: the old
core-plus-dynamic shape created more reviewer roles than the workflow needs for
routine diffs, while still requiring durable coverage for correctness,
data-safety, language idiom, tests, architecture, specifications,
documentation, examples, and external invocation changes.

## Decision

`play-review` uses a capped topical reviewer model before critic
verification:

- `Code-quality` always runs for every non-empty active review. It is a
  skill-local `play-review` reviewer prompt, not the source
  `agents/code-quality-reviewer.yaml` role. It owns baseline correctness,
  data-safety, language-specific quality, test-quality checks, error handling,
  API contracts, documented-behavior verification, substitution audit coverage,
  and external-invocation audits.
- `Architecture` runs when the active diff or full-PR routing summary shows
  architecture, governance, configuration, module-boundary, durable-decision,
  generated/source ownership, or ambiguous architecture risk.
- `Spec` runs when the active diff or full-PR routing summary shows
  specification, API, user-facing behavior, contract, example, operator
  guidance, referenced-document, identifier-drift, stale-guidance, missing-
  guidance, or ambiguous spec/documentation risk.

The maximum topical reviewer count is three. The critic remains a separate
post-review verification phase and does not count against that cap.

Tiny-diff mode continues the guarded optimization pattern from ADR-0017, but
its suppression scope changes: it may suppress only the risk-triggered
`Architecture` and `Spec` reviewers. It must not suppress `Code-quality` or the
critic. Small-but-risky diffs and ambiguous classifications fail closed to the
relevant risk-triggered reviewer.

This ADR supersedes only the stale fanout claims in earlier accepted ADRs:

- ADR-0011's current-policy model of separate `Correctness`, `Data-safety`,
  language-idiomatic, and test-coverage Phase 3 reviewer roles is superseded by
  the three-topical model above.
- ADR-0011's pending `data-safety-reviewer` promotion decision is retired.
  Data-safety remains mandatory coverage, but it is owned by the always-on
  skill-local `Code-quality` reviewer rather than by a newly promoted source
  agent.
- ADR-0017's claims about separate always-on `Correctness` and `Data-safety`
  reviewers and dynamic-agent fanout are superseded by the three-topical model.
  Its guarded, fail-closed tiny-diff optimization rationale remains preserved.
- ADR-0018's final-gate claim that the branch review always runs separate core
  correctness and data-safety reviewers, and may suppress dynamic
  documentation, language, test, and architecture reviewers, is superseded by
  this ADR's final whole-diff `play-review` fanout model.

## Consequences

- Routine reviews have a smaller topical fanout while retaining mandatory
  baseline coverage through `Code-quality` and critic verification.
- Data-safety remains required for every non-empty review, but no separate
  `data-safety-reviewer` source-agent promotion is pending from ADR-0011.
- Architecture and spec/documentation expertise remains available for risky
  diffs, follow-up narrow reviews with full-PR risk context, and ambiguous
  classifications.
- ADR-0011, ADR-0017, and ADR-0018 remain historical records. Current
  `play-review` fanout policy is read through this successor ADR and the
  source `play-review` skill contract.
- Wrapper public surfaces and findings transport do not change as part of this
  decision.

## Alternatives considered

- **Keep separate core reviewers plus dynamic fanout.** Rejected because it
  preserves broad routine fanout after the old role split is no longer needed
  for coverage.
- **Promote `data-safety-reviewer` and keep the other old roles inline.**
  Rejected because the always-on `Code-quality` reviewer can own mandatory
  data-safety checks without adding a new source agent whose only durable call
  site is the same workflow-local review fanout.
- **Make tiny-diff mode suppress all topical review.** Rejected because
  baseline code-quality and critic coverage must remain mandatory even for
  tiny low-risk diffs.
- **Move risk routing into `branch-review` or `pr-review`.** Rejected because
  ADR-0009 keeps shared review orchestration policy in `play-review`.

## Related

- ADR-0009: review pipeline consolidation into shared `play-review`
- ADR-0011: reviewer fanout audit, superseded here only for current
  `play-review` fanout and the pending `data-safety-reviewer` promotion
- ADR-0017: guarded tiny-diff reviewer fanout, superseded here only for current
  reviewer roles and dynamic-fanout suppression scope
- ADR-0018: risk-based per-task review routing, superseded here only for the
  final whole-diff `play-review` fanout claim
