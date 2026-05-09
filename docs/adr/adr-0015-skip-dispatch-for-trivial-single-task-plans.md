# ADR-0015: Skip-Dispatch Path for Trivial Single-Task Plans

## Status

Accepted

## Note

ADR-0016 later refines the `issue-priming-workflow --auto` single-task
subset of the path described here. The skip-dispatch decision in this ADR
remains authoritative, but statements below that the final
whole-implementation reviewer runs on every plan should now be read together
with ADR-0016.

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

Add an internal optimization to `play-subagent-execution`: after plan
extraction, evaluate four guardrails on the plan; if all hold, the
controller executes the file change inline (Write/Edit + verify + commit),
skipping the implementer subagent dispatch entirely.

The four conditions (all must hold; #1, #2, and #4 are evaluated at
execution time by the controller, #3 is an upstream precondition rather
than a runtime check):

1. **Runtime guardrail.** The plan is single-task.
2. **Runtime guardrail.** Task 1's header carries `**Mode:** mechanical`
   (existing author-hint per `play-subagent-execution` § Mechanical Task
   Hint; covers both positive shapes from that taxonomy — verbatim file
   create and unambiguous identifier replacement).
3. **Upstream precondition.** No clarifying questions could plausibly
   arise — implicit from `play-planning`'s plan-review subagent PASS
   upstream. The controller does not re-verify this at execution time;
   for direct invocations of `play-subagent-execution` against a
   hand-written plan with no upstream PASS, this precondition is treated
   as satisfied and the remaining three runtime guardrails carry the
   load.
4. **Runtime guardrail.** Task body contains no TDD step-pair markers
   (`Step 1: Write the failing test` / `Step 3: Write minimal implementation`).

If any guardrail fails, the controller falls back to the existing
dispatched-implementer flow. Template choice is driven by
`**Mode:** mechanical` in the task header, with one carve-out: when
guardrail #4 fails (TDD step-pair present), `implementer-prompt.md` is
used regardless of any `**Mode:** mechanical` hint, since TDD work
needs the full prompt's judgment scaffolding. The carve-out bites only
on mismarked plans (a task carrying both `**Mode:** mechanical` and a
TDD step-pair); the Mechanical Task Taxonomy already excludes TDD
step-pairs from the mechanical positive shapes, so a correctly authored
plan never reaches this branch.

The skill's existing final whole-implementation code-quality reviewer
(scope explicitly out of ADR-0007 at the time) still runs on the
skip-dispatch path unless the caller-scoped ADR-0016 carve-out applies
(`issue-priming-workflow --auto`, single-task plan, downstream
`branch-review --fix` explicitly guaranteed). On that narrower path,
`branch-review --fix` supplies the whole-diff gate.

This is positioned as an internal optimization within Phase 6 of
`issue-priming-workflow`, not a phase removal — Phase 6 still runs, Phase
7 still runs. The same framing ADR-0007 used for its review skips applies
here.

## Consequences

- For qualifying single-task plans, the implementer dispatch is eliminated.
  Token cost drops by the round-trip overhead of spawning and receiving a
  DONE report from an implementer. The benefit concentrates on docs-heavy
  plans (skills, ADRs, guidelines).
- No new coupling is added. Guardrail #3 leans on the existing upstream
  `play-planning` plan-review PASS, but no new schema field is introduced.
  Guardrails #1, #2, and #4 read structural signals already present in
  the plan format.
- The "Make per-task implementer subagent read the plan file" Red Flag in
  `play-subagent-execution` is amended: skip-dispatch is the
  explicitly-gated exception where the controller (not a subagent) does
  the work, so the dispatch boundary the Red Flag protects does not exist
  on this path.
- Mismarked plans (`**Mode:** mechanical` set on a task that actually
  needs judgment) bypass dispatch. Mitigation: same as the existing
  `**Mode:** mechanical` hint policy — under-marking is harmless,
  over-marking is plan-author responsibility, caught by `play-planning`'s
  plan-review subagent and by either the final whole-implementation
  reviewer or downstream `branch-review --fix` on the ADR-0016 path.
- The implementer DONE-report snapshot contract (ADR-0014) does not
  apply on the skip-dispatch path: with no dispatched implementer, there
  is no DONE-report boundary. The plan body is itself the snapshot.
  ADR-0014's `play-subagent-execution` § Implementer Snapshot Consumption
  → Skip-dispatch exclusion subsection states this exclusion explicitly.
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
  duplicating the guardrail check for direct invocations of
  `play-subagent-execution` outside `--auto`.
- **Heuristic auto-detection of mechanical content** (no `**Mode:**` hint
  required). Rejected on the same grounds as the existing
  `**Mode:** mechanical` policy: hint-only is the conservative choice;
  heuristics bias toward over-trimming; under-marking is harmless.

## Related

- Sibling ADR (DONE-report snapshot contract, scope-excludes this path): ADR-0014
- Parent ADR (review-pipeline delineation): ADR-0007
- Follow-up refinement: ADR-0016
