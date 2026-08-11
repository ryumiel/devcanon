# Lifecycle And Status Policy - `play-subagent-execution`

The [source-immutability usage](source-immutability-usage.md) owns D14-D16
guard commands, I/O, and refusal mechanics. This reference owns lifecycle
ordering, status disposition, freshness, and escalation.

## Subagent Lifecycle

Use `subagent-lifecycle` for shared cleanup and target capability state. Keep
D12 implementers available through same-session D14/D15 fix loops when that
follow-up is supported. Capture task reports, snapshot state, changed files,
base/head and reviewed heads, routing, reviewer results, fixups, and blockers.

## Mutable Task-Worker Status

For D12/D13 `DONE` or `DONE_WITH_CONCERNS`, capture report, snapshot state,
changed files, base/head, and test evidence before review. `skipped` uses normal
git/disk reads; `malformed` surfaces the incident and uses the same fallback.
For `NEEDS_CONTEXT` and `BLOCKED`, record the available evidence and run the
cleanup gate before the next session.

`DONE` follows the effective route: `spec-and-quality` requires fresh D14 and
D15, `spec-only` requires D14, and `none-final-only` completes after self-review
and commit. A single-task plan completes after its applicable route. Concerns
about correctness or scope remain incomplete until addressed; observational
concerns may continue.

## Reviewer Freshness and Fixups

D14/D15 results are separate evidence against the same task head. Quality is
final only after same-head spec pass and current-head validation; otherwise it
is advisory, stale, or superseded. Every fix commit invalidates both verdicts.
Revalidate the route after each fixup: it may stay or escalate, never downgrade.

For D14, D15, and D16, use the source-immutability lifecycle before consuming
a response. A capture, response, verification, or cleanup failure leaves the
task incomplete and `BLOCKED`; detected mutation or cleanup failure is
guard-integrity terminal and source remains visible and unrepaired. D16 is a
fresh whole-range reviewer after all tasks, except the exact verified ADR-0016
single-task auto carve-out. D16 findings route to D12 and require fresh D16.

## D13 and D12 Recovery

A D13 boundary failure (`NEEDS_CONTEXT` or `BLOCKED` from judgment, policy,
authorization, clarification, or widened scope) reclassifies to D12; never
redispatch or model-escalate D13. Other D13 blockers also route to D12 with
available evidence. D12 may receive bounded recoverable context only within
the existing task scope; unresolved gaps remain incomplete under the owning
caller. Do not invent effort/model overrides. Record blockers as stable family
plus detail and escalate repeated family behavior instead of retrying unchanged.
