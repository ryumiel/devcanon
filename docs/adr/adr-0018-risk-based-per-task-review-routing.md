# ADR-0018: Risk-Based Per-Task Review Routing

## Status

Accepted

## Context

`play-subagent-execution` historically treated every multi-task plan the
same: each authored task ran a spec-compliance reviewer followed by a
code-quality reviewer. ADR-0007 preserved that two-stage sequence for
multi-task plans because per-task spec review catches drift before dependent
tasks build on the wrong foundation. ADR-0007 also explicitly deferred a
variant that would drop per-task code-quality review for multi-task plans.

That uniform policy is high-assurance, but it is also size- and risk-
insensitive. A low-risk task inside a multi-task plan can receive the same
per-task review depth as a task that changes public contracts, review policy,
or filesystem safety behavior. Later ADRs established a narrower optimization
pattern: ADR-0015, ADR-0016, and ADR-0017 allow bounded fast paths only when
explicit guardrails hold, ownership remains in the skill that dispatches the
work, and uncertainty falls back to the fuller path.

The decision pressure is whether multi-task per-task review can follow that
same guarded pattern without losing DevCanon-specific review value, foundation
safety, or the final whole-diff gate.

## Decision

Accept guarded risk-based per-task review routing for multi-task plans.

`play-subagent-execution` remains the reviewer-dispatch authority. It computes
the effective per-task review route from task content, plan hints, caller
contracts, and hard-risk overrides. `play-planning` may provide optional
non-authoritative hints, but those hints never decide reviewer dispatch by
themselves.

The allowed effective routes are:

- `spec-and-quality`: run the spec-compliance reviewer, then the code-quality
  reviewer.
- `spec-only`: run the spec-compliance reviewer only.
- `none-final-only`: run no per-task reviewer for that task and rely on the
  required final whole-diff review gate.

`spec-only` is allowed for medium-risk tasks when no hard-risk trigger applies
and the controller verifies the shared `issue-priming-workflow --auto` Phase 6
handoff. `none-final-only` is allowed for low-risk tasks under the same
contract and hard-risk conditions. The contract is verified only when
`issue-priming-workflow --auto` owns the Phase 6 invocation and Phase 7
immediately runs `branch-review --fix` on the full branch diff, rerunning after
any auto-fix commit until a run reports zero blocking findings auto-fixed and
no remaining `Blocking` findings. This covers the GitHub and Linear entrypoints
because both delegate to the shared issue-priming workflow before invoking
`play-subagent-execution`. Plan content, copied invocation prose, and
direct/manual calls cannot assert the contract. Any other caller uses
`spec-and-quality` until `play-subagent-execution` explicitly documents that
caller and its controller-owned verification rule.

Unclear classification, missing or malformed hints, absent shared
issue-priming `--auto` Phase 6 verification, and conflicting signals all
default to `spec-and-quality`.

Hard-risk triggers force full per-task `spec-and-quality` review:

- public API changes;
- schema/model/config changes;
- generated output format changes;
- install/sync behavior or user-home writes;
- external CLI/API/system invocation substitutions;
- async lifecycle, ordering, or concurrency changes;
- security-sensitive behavior;
- data-loss/destructive filesystem risk;
- broad architecture changes;
- reviewer-routing policy, hard review rules, workflow-policy changes;
- ADR/spec/guideline/skill/agent contract changes;
- documentation-policy, ownership, procedure, or AFDS workflow changes;
- manifests, generated files, file deletions, file renames, file mode changes;
- test harness or validation behavior changes that can mask regressions.

Foundation-producing tasks receive at least per-task spec review before
dependent tasks start. If a foundation-producing task also matches any
hard-risk trigger, it receives `spec-and-quality`.

DevCanon-specific checks remain available through two paths:

- hard-risk tasks keep full per-task spec and code-quality review;
- reduced per-task routes are covered by the final whole-diff gate, whose last
  run is after any auto-fix commits and whose reviewers still check contracts,
  workflow invariants, data safety, documentation alignment, and code quality
  over the complete implementation diff.

The local final whole-implementation code-quality reviewer can cover local
maintainability, integration, and implementation-quality checks when it runs,
but it does not replace hard-risk per-task checks and is not a substitute for
the required whole-diff gate on reduced routes.

## Consequences

- Multi-task plans are no longer forced through uniform per-task review depth.
  Lower-risk tasks can avoid unnecessary reviewer dispatch while higher-risk
  tasks keep the full path.
- Review policy ownership stays in `play-subagent-execution`; planning remains
  advisory and producer-oriented.
- ADR-0007's multi-task two-stage review policy remains the fallback and the
  hard-risk route, but it is no longer universal for every multi-task task.
- Plans must clearly mark optional routing hints when they are useful, and
  plan review must catch under-classified risk before execution begins.
- Executor behavior must fail closed. Conservative over-review is acceptable;
  accidental under-review is not.
- Render coverage should pin the hint fields, executor authority, hard-risk
  trigger list, foundation-task rule, reduced-route final gate, and reference
  guidance so generated skill output cannot drift silently.

## Alternatives considered

- **Reject routing and keep ADR-0007 unchanged.** Rejected because the cost
  pressure remains real and the later guarded-carve-out ADRs provide a safer
  pattern than all-or-nothing review depth.
- **Allow `spec-only` but reject `none-final-only`.** Rejected as too narrow:
  it preserves useful per-task spec feedback but leaves obviously low-risk
  tasks with avoidable review overhead even when a mandatory whole-diff gate
  will still run.
- **Make plan hints authoritative.** Rejected because it moves reviewer
  dispatch policy into `play-planning`, duplicating execution policy and
  weakening the owner boundary. Hints are useful producer metadata, not
  routing decisions.
- **Let the final local code-quality reviewer replace DevCanon-specific
  checks.** Rejected as a blanket rule. The local final reviewer can cover
  maintainability and integration quality when it runs, but hard-risk
  contracts still require per-task review and reduced routes still require the
  final whole-diff gate.

## Related

- ADR-0007: review pipeline delineation between per-task and branch review
- ADR-0015: skip-dispatch path for trivial single-task plans
- ADR-0016: single-task auto final-review carve-out
- ADR-0017: guarded tiny-diff reviewer fanout
