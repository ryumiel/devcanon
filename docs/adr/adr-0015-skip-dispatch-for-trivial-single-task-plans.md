# ADR-0015: Skip-Dispatch Path for Trivial Single-Task Plans

## Status

Accepted

## Note

ADR-0016 later refines the `issue-priming-workflow --auto` single-task
subset of the path described here. ADR-0023 later updates the upstream
planning precondition to the two-gate `play-planning` return. The
skip-dispatch decision in this ADR remains authoritative, but statements below
that the final whole-implementation reviewer runs on every plan should now be
read together with ADR-0016, and upstream planning-precondition statements
should be read together with ADR-0023.

Issue #611's user-approved admission refinement supersedes the legacy
unreviewed-plan compatibility statements in this ADR.

## Context

For single-task plans whose Task 1 is a verbatim file write — content fully
specified in the plan body (e.g., adding a fully written ADR file) — the
existing dispatched-implementer flow costs round-trip overhead per task
(subagent spawn + DONE report) for what is effectively one `Write` tool
call. Even the leaner `mechanical-implementer-prompt.md` template cannot
eliminate that round-trip cost; the dispatched subagent has no judgment to
add when the controller already holds the verbatim content.

ADR-0007 already established that single-task plans skip the per-task
two-stage review. The dispatched implementer was kept because the existing
pipeline required a self-review surface and a stable DONE-report contract.
The mechanical skip-dispatch decision eliminates that final dispatch when the
task is itself mechanical and fully specified in the plan body.

## Decision

Add an internal optimization to `play-subagent-execution`: after guarded
plan-byte intake and before task extraction, require execution admission before
evaluating five guardrails. An admitted plan contains exactly one canonical
`## Execution Projection` and
identifiable same-digest D5 Plan Review and D6 Implementer Executability Review
PASS provenance for the exact plan bytes. Admission failure returns
`BLOCKED/NEEDS_CONTEXT` before any D12, D13, inline, or skip-dispatch route. If
all five guardrails hold after admission, the controller executes the file
change inline (Write/Edit + verify + commit), skipping the implementer subagent
dispatch entirely.

The five conditions all apply after admission and are evaluated at execution
time by the controller:

1. **Runtime guardrail.** The plan is single-task.
2. **Runtime guardrail.** Task 1's header carries `**Mode:** mechanical`
   (existing author-hint per
   `play-subagent-execution/references/skip-dispatch-policy.md` § Mechanical
   Task Taxonomy; covers both positive shapes from that taxonomy — verbatim
   file create and unambiguous identifier replacement).
3. **Runtime guardrail.** The admitted reviewed task needs no implementation
   clarification: its exact mechanical operation, named authority, and bounded
   verification leave no implementation choice. Paired-review provenance is
   admission evidence, not this guardrail's fallback condition.
4. **Runtime guardrail.** The task passes `play-subagent-execution`'s
   structural task-contract gate. The controller does not re-infer
   `play-planning` trigger applicability at execution time and does not
   reclassify the declared tier. Every task must carry the literal
   `**Contract tier:** FULL`, `LIGHTWEIGHT`, or `NO-TRIGGER` field, and the
   controller validates only the declared tier's required structure. `FULL`
   requires a structurally complete checklist naming trigger criteria,
   owner/authority, affected consumers/generated outputs, must-preserve,
   required behavior, spec/procedure work, risk surfaces, and proof obligations
   with no blank fields or unexplained `N/A` fields. `LIGHTWEIGHT` requires its
   closed compact fields, including named authority, every actual known
   participant and direct producer-consumer relationship, and an explicit
   reason every FULL trigger is absent. `NO-TRIGGER` requires a task-specific
   reason. If source inspection cannot confirm the tier-appropriate owner,
   authority, source-of-truth, participant, direct relationship,
   consumer, generated-output, or evidence surface, the task contract is
   invalid.
5. **Runtime guardrail.** Task body contains no TDD expectations or legacy
   TDD step-pair markers (`Step 1: Write the failing test` / `Step 3: Write
minimal implementation`).

Admission failure and guardrail #4 failure stop before implementation and
report `BLOCKED/NEEDS_CONTEXT`; neither selects D12, D13, or inline execution.
After admission, ordinary guardrail #1, #2, #3, or #5 failures fall back to the
existing D12 dispatched-implementer flow. Template choice is driven by
`**Mode:** mechanical` in the task header, with one carve-out: when
guardrail #5 fails (TDD expectation or legacy TDD step-pair present),
`implementer-prompt.md` is used regardless of any `**Mode:** mechanical`
hint, since TDD work needs the full prompt's judgment scaffolding. The
carve-out bites only on mismarked plans (a task carrying both
`**Mode:** mechanical` and a TDD expectation or legacy TDD step-pair); the
Mechanical Task Taxonomy already excludes TDD work from the mechanical
positive shapes, so a correctly authored plan never reaches this branch.

The skill's existing final whole-implementation code-quality reviewer
(scope explicitly out of ADR-0007 at the time) still runs on the
skip-dispatch path unless the caller-scoped ADR-0016 carve-out applies
(`issue-priming-workflow --auto`, single-task plan, downstream
`branch-review --fix` explicitly guaranteed, and no retained undischarged
no-code proof tuple). Otherwise D16 runs with the whole context before Phase 7;
on that narrower path, `branch-review --fix` supplies the whole-diff gate.

This is positioned as an internal optimization within Phase 6 of
`issue-priming-workflow`, not a phase removal — Phase 6 still runs, Phase
7 still runs. The same framing ADR-0007 used for its review skips applies
here.

## Consequences

- For qualifying single-task plans, the implementer dispatch is eliminated.
  Token cost drops by the round-trip overhead of spawning and receiving a
  DONE report from an implementer. The benefit concentrates on docs-heavy
  plans (skills, ADRs, guidelines).
- No new skip-dispatch coupling is added. Admission consumes the canonical
  projection and upstream same-digest D5/D6 PASS provenance, while guardrail
  #4 consumes the upstream literal Contract tier field and tier-appropriate
  task contract emitted by `play-planning`. No skip-dispatch-specific
  eligibility field is added, while the upstream literal Contract tier field is
  required. Guardrails #1, #2, #4, and #5 read structural signals already
  present in the plan format; guardrail #3 evaluates admitted-task ambiguity.
- The "Make per-task implementer subagent read the plan file" Red Flag in
  `play-subagent-execution` is amended: skip-dispatch is the
  explicitly-gated exception where the controller (not a subagent) does
  the work, so the dispatch boundary the Red Flag protects does not exist
  on this path.
- Mismarked plans (`**Mode:** mechanical` set on a task that actually
  needs judgment) bypass dispatch. Mitigation: same as the existing
  `**Mode:** mechanical` hint policy — under-marking is harmless,
  over-marking is plan-author responsibility, caught by `play-planning`'s
  Plan Review and Implementer Executability Review and by either the final
  whole-implementation reviewer or downstream `branch-review --fix` on the
  ADR-0016 path.
- The implementer DONE-report snapshot contract (ADR-0014) does not
  apply on the skip-dispatch path: with no dispatched implementer, there
  is no DONE-report boundary and no implementer snapshot artifact. The
  plan remains upstream implementation context, not DONE-report evidence.
  ADR-0014 and
  `play-subagent-execution/references/snapshot-consumption.md` §
  Skip-Dispatch Exclusion state this exclusion explicitly; the inline path
  details live in
  `play-subagent-execution/references/skip-dispatch-policy.md`.
- ADR-0018 refines multi-task per-task review routing only. This ADR remains
  scoped to trivial single-task skip-dispatch and does not inherit ADR-0018's
  multi-task route selection.
- Future changes to either ADR-0007 or this ADR must update both per the
  ADR governance rule.

## Alternatives considered

- **Plan-time certification by `play-planning`'s plan-review subagent.**
  Add a structured `skip_dispatch_eligible: true/false` field to the plan
  schema; `play-subagent-execution` reads it and trusts the upstream
  decision. Rejected: tightly couples `play-planning` to a
  `play-subagent-execution` optimization detail, breaks the current clean
  producer/consumer boundary, and any future change to guardrail
  definition would require updating both skills.
- **Workflow-level dispatch in `issue-priming-workflow` Phase 6.** Have
  Phase 6 inspect the plan and either invoke `play-subagent-execution` or
  do the inline write itself. Rejected: violates the issue's stated
  preference ("let `play-subagent-execution` decide"), leaks
  execution-tier logic into the orchestration workflow, and would require
  duplicating admission and guardrail enforcement outside
  `play-subagent-execution`.
- **Heuristic auto-detection of mechanical content** (no `**Mode:**` hint
  required). Rejected on the same grounds as the existing
  `**Mode:** mechanical` policy: hint-only is the conservative choice;
  heuristics bias toward over-trimming; under-marking is harmless.

## Related

- Sibling ADR (DONE-report snapshot contract, scope-excludes this path): ADR-0014
- Parent ADR (review-pipeline delineation): ADR-0007
- Follow-up refinement: ADR-0016
