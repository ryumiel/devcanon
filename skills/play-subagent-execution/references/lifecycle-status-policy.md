# Lifecycle And Status Policy - `play-subagent-execution`

The [source-immutability usage](source-immutability-usage.md) owns guard
commands, I/O, and refusal mechanics for read-only proof tasks and D14-D16.
This reference owns lifecycle ordering, status disposition, freshness, and
escalation.

## Subagent Lifecycle

Use `subagent-lifecycle` for shared cleanup and target capability state. Keep
D12 implementers available through same-session D14/D15 fix loops when that
follow-up is supported. Capture task reports, snapshot state, changed files,
base/head and reviewed heads, routing, reviewer results, fixups, and blockers.
It owns the generic controller lifecycle ledger, target lifecycle capability
classification, cleanup gate before spawns, target-honest cleanup outcomes, and
slot-limit recovery; this skill owns only execution-specific lifecycle details.

## Mutable Task-Worker Status

For D12/D13 `DONE` or `DONE_WITH_CONCERNS`, capture report, snapshot state,
changed files, base/head, and test evidence before review. `skipped` uses normal
git/disk reads; `malformed` surfaces the incident and uses the same fallback.
For `NEEDS_CONTEXT` and `BLOCKED`, record the available evidence and run the
cleanup gate before the next session.

`DONE` follows the effective route: `spec-and-quality` requires fresh D14 and
D15, `spec-only` requires D14, and `none-final-only` completes after self-review
and commit. A single-task plan completes after its applicable route. Concerns
about correctness or scope remain incomplete until addressed. A D13
`DONE_WITH_CONCERNS` report with judgment-bearing correctness or scope concerns
routes the captured report to D12; purely observational concerns may continue
through the selected route.

## Read-Only Proof Task Status

Execute each `read-only proof` task serially after its dependencies and before
final whole-implementation review. For Subagent-Driven execution, dispatch the
existing source-immutable `assessor`, balanced/medium, with the captured task
text, resolved task-relevant projection entries, named proof boundary, and
permitted inspection/check scope, with zero handoffs. For Inline Execution, the controller performs
the same bounded inspection and checks directly. Neither route may edit durable
source, create a commit, or mutate an external system.

Use the guard lifecycle capture → run → verify → validate/retain → cleanup →
apply. Capture HEAD and the source-immutability baseline before the task. Accept
only `VERIFIED`, `BLOCKED`, `NEEDS_CONTEXT`, or `FAILED` with a concise evidence
summary and the checks performed. Before consuming the result, verify HEAD is
unchanged and the source guard passes; cleanup the exact baseline on every
terminal path. Mutation, a new commit, malformed status, guard failure, or
cleanup failure is terminal `BLOCKED` and remains visible rather than repaired.
`VERIFIED` is ordinary controller-local task-completion evidence, not a receipt,
ledger entry, persistent discharge state, or new artifact. Retain its summary in
the existing whole-implementation context for D16.

The response-only result contains exactly the status, named proof boundary,
checks performed, and concise evidence or blocker. The controller supplies and
validates HEAD separately; the child does not create a receipt or handoff.

`BLOCKED` or `NEEDS_CONTEXT` caused by a bounded inspection input may be
recovered within the task's existing authority. A false no-code disposition,
wrong implementation set, wrong tier or topology, missing proof owner, or other
reviewed-plan defect returns to planning under the authority-based recovery rule
below. `FAILED` means the named proof boundary did not pass; route an
implementation defect to D12 and a reviewed-plan defect to planning.

## Reviewer Freshness and Fixups

D14 and D15 use independent sessions and prompts against the same task head.
Quality is final only after same-head spec pass and current-head validation;
otherwise it is advisory, stale, or superseded. Every fix commit invalidates
both verdicts. Revalidate the route after each fixup: it may stay or escalate,
never downgrade.

A fresh D14 pass plus every reviewer required by the effective route passing on
that same head permits task completion. Any D14 finding, or any D15 finding
after a same-head D14 pass, routes to D12 for a fix. After a head-changing fix,
rerun every reviewer required by the revalidated route against the new same
task head; no earlier verdict survives.

Resolve the installed `play-subagent-execution` bundle before the first guarded
review or proof task and discover the local guard contract once for the
enclosing source-immutable flow:

```bash
bash "$PLAY_SUBAGENT_EXECUTION_DIR/scripts/source-immutability.sh" --help
```

For every read-only proof task, D14, D15, and D16, use the source-immutability
lifecycle before consuming a response: capture → spawn → verify →
validate/retain → cleanup → apply. A
capture failure prevents spawn and records no invented cleanup evidence because
there is no retained baseline. After capture succeeds, every terminal path
attempts cleanup against that exact retained baseline before final disposition,
including paths caused by spawn, response, verification, validation, retention,
or apply failure. Any such failure leaves the task incomplete and `BLOCKED`;
detected mutation or cleanup failure is guard-integrity terminal and source
remains visible and unrepaired. D16 is a fresh whole-range reviewer after all
mutating and read-only tasks, except the exact verified ADR-0016
executable-route-complete carve-out. A D16
result with no Blocking findings, including one with only Nit findings, may
continue after safe cleanup. Blocking D16 findings keep final review
incomplete. Route them by authority as defined below, then require a fresh D16
after the affected implementation or reviewed plan is current again.

## D16 Eligibility And Authority-Based Recovery

The ADR-0016 carve-out applies only to a verified auto handoff with mandatory
Phase 7, exactly one completed `source-mutating` task, no read-only proof task,
and no proof obligation outside the committed implementation diff. A single
read-only task, any plan with a read-only proof task, multiple tasks, or any
other non-diff proof obligation retains ordinary D16. D16 receives the existing
whole-plan and whole-implementation context, including controller-curated
read-only proof result summaries; do not add projection-specific reporting or
expand Phase 7 risk-signal contracts.

Classify each Blocking D16 finding by the authority that can correct it:

- An implementation defect within an existing task's authorized scope routes to
  D12. A fix commit invalidates affected review results and requires fresh
  applicable task review, reruns every affected read-only proof task, and then
  requires fresh D16.
- A false no-code disposition, wrong implementation task set, incorrect tier,
  topology, participation identity or partition, missing/incorrect proof owner,
  or other reviewed-plan defect returns to planning. The corrected plan receives
  a new digest, fresh D5/D6 review, fresh execution admission, reruns every
  affected task or proof route, and then receives fresh D16. Existing unaffected
  commits may remain only when the freshly reviewed plan authorizes the current
  state; no stale task or proof result survives a changed governing tuple.

When ownership is unclear, return `NEEDS_CONTEXT` to the planning boundary; do
not let D12 rewrite reviewed plan authority and do not let planning prescribe an
implementation fix inside already authorized task scope.

## D13 and D12 Recovery

A D13 boundary failure (`NEEDS_CONTEXT` or `BLOCKED` from judgment, policy,
authorization, clarification, or widened scope) reclassifies to D12; never
redispatch or model-escalate D13. Other D13 blockers also route to D12 with
available evidence.

On the exact verified `issue-priming-workflow --auto` route, a task-local
recoverable D12 `NEEDS_CONTEXT` or `BLOCKED` result is non-gate continuation:
provide the bounded missing context or recoverable unblock and redispatch the
same D12 route. Outside that route, automatic recovery is limited to a
within-scope context repair; other blockers remain incomplete under the owning
caller. Do not invent effort/model overrides. Record blockers as stable family
plus detail and escalate repeated family behavior instead of retrying unchanged.
