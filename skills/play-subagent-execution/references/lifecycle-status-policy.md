# Lifecycle And Status Policy - `play-subagent-execution`

The [source-immutability usage](source-immutability-usage.md) owns D14-D16
guard commands, I/O, and refusal mechanics. This reference owns lifecycle
ordering, status disposition, freshness, and escalation.

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
review and discover the local guard contract once for the enclosing D14-D16
flow:

```bash
bash "$PLAY_SUBAGENT_EXECUTION_DIR/scripts/source-immutability.sh" --help
```

For D14, D15, and D16, use the source-immutability lifecycle before consuming
a response: capture → spawn → verify → validate/retain → cleanup → apply. A
capture failure prevents spawn and records no invented cleanup evidence because
there is no retained baseline. After capture succeeds, every terminal path
attempts cleanup against that exact retained baseline before final disposition,
including paths caused by spawn, response, verification, validation, retention,
or apply failure. Any such failure leaves the task incomplete and `BLOCKED`;
detected mutation or cleanup failure is guard-integrity terminal and source
remains visible and unrepaired. D16 is a fresh whole-range reviewer after all
tasks, except the exact verified ADR-0016 single-task auto carve-out. A D16
result with no Blocking findings, including one with only Nit findings, may
continue after safe cleanup. Blocking D16 findings keep final review
incomplete, route to D12 for a fix, and require a fresh D16 after the fix
commit.

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
