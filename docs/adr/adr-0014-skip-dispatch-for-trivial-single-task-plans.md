# ADR-0014: Skip-Dispatch Path for Trivial Single-Task Plans

## Status

Accepted

## Context

For single-task plans whose Task 1 is a verbatim file write — content fully
specified in the plan body (e.g., adding an ADR file like PR #163) — the
existing dispatched-implementer flow costs ~500 tokens of round-trip
overhead per task (subagent spawn + DONE report) for what is effectively
one `Write` tool call. Even the leaner `mechanical-implementer-prompt.md`
template (~35-line prompt body, vs. ~115 lines for the default) cannot
eliminate that round-trip cost; the dispatched subagent has no judgment to
add when the controller already holds the verbatim content.

ADR-0007 already established that single-task plans skip the per-task
two-stage review. The dispatched implementer was kept because the existing
pipeline required a self-review surface and a stable DONE-report contract.
Issue #175 (companion to #168, which landed the mechanical-implementer
prompt variant) proposes eliminating that final dispatch when the task is
itself mechanical and fully specified in the plan body.

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
   Hint; signals that content is verbatim).
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
dispatched-implementer flow. The choice between
`mechanical-implementer-prompt.md` and `implementer-prompt.md` is unchanged
— it remains driven by `**Mode:** mechanical` in the task header.

The skill's existing final whole-implementation code-quality reviewer
(scope explicitly out of ADR-0007) still runs on every plan, including the
skip-dispatch path. In `--auto` flows, downstream `branch-review` provides
whole-diff coverage as it does today.

This is positioned as an internal optimization within Phase 6 of
`issue-priming-workflow`, not a phase removal — Phase 6 still runs, Phase
7 still runs. The same framing ADR-0007 used for its review skips applies
here.

## Consequences

- For qualifying single-task plans, the implementer dispatch is eliminated.
  Token cost drops by the ~500 tokens of round-trip overhead measured in
  #175. Concentrated benefit on docs-heavy plans (skills, ADRs,
  guidelines).
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
  plan-review subagent and by the final whole-implementation reviewer.
- Issue #170 (snapshot contract for implementer DONE reports) does not
  apply on the skip-dispatch path: with no dispatched implementer, there
  is no DONE-report boundary. The plan body is itself the snapshot. When
  #170 lands, its scope is expected to exclude this path explicitly; if
  it does not, this Consequences bullet is the canonical statement of the
  exclusion.
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

- Issue: #175
- Companion issue (mechanical-implementer prompt variant): #168 (landed via PR #177)
- Forward-looking interaction (DONE-report snapshot contract): #170 (not
  yet landed)
- Parent ADR (review-pipeline delineation): ADR-0007
