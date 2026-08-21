# Lifecycle And Status Policy - `play-subagent-execution`

The [source-immutability usage](source-immutability-usage.md) owns D14-D16
guard commands, I/O, and refusal mechanics. This reference owns lifecycle
ordering, status disposition, freshness, escalation, and the D14/D15
review-fix-loop disposition. It consumes the existing [finding proportionality
runtime reference](../../play-review-response/references/finding-proportionality.md)
before any D12 route. Writing Skills remains the sole classification authority;
this lifecycle policy remains the sole execution disposition, count, stop, and
resumption owner.

## Subagent Lifecycle

Use `subagent-lifecycle` for shared cleanup and target capability state. Keep
D12 implementers available through same-session D14/D15 fix loops when that
follow-up is supported. Capture task reports, snapshot state, changed files,
base/head and reviewed heads, routing, reviewer results, fixups, and blockers.
It owns the generic controller lifecycle ledger, target lifecycle capability
classification, cleanup gate before spawns, target-honest cleanup outcomes, and
slot-limit recovery; this skill owns only execution-specific lifecycle details.

For a same-tuple D12 fixup, keep the stable D12 session identity and send only
the incremental findings/task context. On the verified-auto route, include the
freshly revalidated controller-provided auto-route attestation as structured
context; it is not task prose. Direct/manual routes do not invent an attestation.

```text
Codex.followup_task({
  target: D12_STABLE_SESSION_ID,
  message: D12_INCREMENTAL_FINDINGS_AND_TASK_CONTEXT_PLUS_VERIFIED_AUTO_ROUTE_ATTESTATION_WHEN_APPLICABLE,
})
```

Do not include `agent_type`, `model`, `reasoning_effort`, `fork_turns`, or an
equivalent override, the full implementer prompt, or full task context. This D12 continuation is available only for the original
stable task identity and unchanged D12 tuple. D13-to-D12 reclassification and a
D16 final whole-implementation fix instead use the shared fresh-child lifecycle
path. If no compatible reusable D12 session exists, use that path as well.

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

D14 and D15 use independent fresh one-shot sessions and prompts against the
same task head; they never receive a follow-up or reuse a prior reviewer
session. For `spec-and-quality`, one complete same-head required reviewer wave
is one round regardless of reviewer or finding count. Join same-head results
only after the independent guard lifecycles settle. D15 stays provisional until
the active-task D14 gate is satisfied: a literal D14 pass or finalized
all-non-mutating D14 dispositions satisfies that gate without rewriting raw
responses. When D14 authorizes a fix, same-head provisional D15 candidates may
join that single fix only when independently proportionate; they neither
complete the task nor add a second round. `spec-only` D14 is one wave.

Quality is final only after the same-head D14 gate and current-head validation;
otherwise it is advisory, stale, or superseded. A fresh D14 pass plus every
reviewer required by the effective route passing on that same head permits task
completion. Every fix commit invalidates both verdicts. Revalidate the route
after each fixup: it may stay or escalate, never downgrade. After a
head-changing fix, rerun every reviewer required by the revalidated route as
fresh one-shot reviewers against the new same task head; no earlier verdict
survives.

## D14/D15 Proportional Disposition and Bounded Fix Loops

After guarded capture → spawn → verify → validate/retain → cleanup → apply and
before any D12 route, process every guard-verified semantically consumable
candidate that could otherwise reach D12 through the portable four-way policy.
Retain a private, transient, same-controller, unnamed, unpersisted bounded
impact preview. It has no helper, schema, artifact, notice, or independent
consumer. For each candidate, retain all of these facts:

- authoritative contract anchor;
- reachable production path and meaningful bad outcome;
- proposed files or modules;
- new state or lifecycle ownership;
- behavior changed or disabled;
- proof and test growth; and
- why the existing correctness owner is insufficient, or that it remains
  sufficient.

A proof-only gap may explicitly state `no demonstrated production path;
proof-only gap`, but it still requires an authoritative proof obligation and an
existing proof owner. Missing preview evidence, proof owner, classification, or
authority is not a new classification: Unclear classification or authority is a
gate failure returning existing `BLOCKED` before D12 with a concise sanitized
summary of the missing authority, classification, or proof-owner fact plus
permitted repository anchors or minimum evidence pointers. The detailed impact
preview stays controller-local.

Classify every candidate independently and separate dispositions before
grouping so mixed sets cannot carry unauthorized work. Apply exactly these four
classifications and dispositions from the portable policy:

- An in-scope product blocker may receive only the smallest authorized
  production correction.
- A proof or test defect may receive a repair only at its existing proof owner,
  with no production-behavior expansion.
- An adjacent independently releasable defect receives a concise
  separate-work non-mutating caller handoff.
- An invalid or speculative finding receives a concise rejection and no
  mutation.

Only after this separation, preview, classification, current contract/head/route
validation, and limit decision may authorized incremental context reach D12
through the existing compatible-session or fresh-child route. Reviewer evidence,
severity, validity, technical fixability, grouping, or approval prose alone is
not mutation authority.

Count a failed round only when a complete guard-verified semantically valid wave
requires an authorized production or proof correction. Initial implementation
and unavailable, malformed, verification-rejected, mutation-detected,
cleanup-failed, or non-mutating-only waves do not consume this budget and keep
their existing terminal handling. The existing current-episode fixup count `0`,
`1`, or `2` makes the newly observed failed wave round `1`, `2`, or `3`.
Record the failed wave before deciding. Rounds 1 and 2 may each permit one
bounded fix. Round 3 returns existing `BLOCKED` with blocker family
`review-loop-limit` before D12. A materially unchanged unresolved finding
family may stop earlier with that same blocker and resumption path; changed SHA
alone is not new evidence.

After a `review-loop-limit` block, explicit resumption approval must be
finding-bound, current-head/current-route/current-contract/current-evidence,
single-use. It authorizes exactly one identified D12 attempt without clearing
history or resetting count. Before the approved attempt is dispatched, a
changed head, route, contract, or material evidence invalidates it and requires
a replacement current approval unless the revised-contract route applies. Once
dispatched, the episode's finding-bound approval escape hatch is consumed;
preserve that fact in the existing controller-local ledger. A failed fresh wave
after the extra attempt blocks before any further D12, and only revised-contract
resumption may authorize another attempt.

Revised-contract resumption instead requires material authoritative scope or
acceptance change, refreshed extracted context, structural contract validation,
head and route revalidation, and reclassification. When the revised contract
authorizes correction, reset only existing current-episode fixup count to `0`,
retain prior ledger and family history, dispatch through the existing D12
compatibility logic, and begin the new three-round budget with post-fix fresh
review. Cosmetic wording or still-unauthorized evidence cannot reset or
dispatch. Prior family history supports early stop only when authority, outcome,
and impact remain materially unchanged.

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
commit. D16 is one-shot and never receives a follow-up or reuses a prior final
reviewer session.

## D13 and D12 Recovery

A D13 boundary failure (`NEEDS_CONTEXT` or `BLOCKED` from judgment, policy,
authorization, clarification, or widened scope) reclassifies to D12; never
redispatch or model-escalate D13. Other D13 blockers also route to D12 with
available evidence. This reclassification changes the tuple and therefore uses
the fresh-child lifecycle path above, not a D13 follow-up with an altered role,
model, or effort.

On the exact verified `issue-priming-workflow --auto` route, a task-local
recoverable D12 `NEEDS_CONTEXT` or `BLOCKED` result is non-gate continuation:
provide the bounded missing context or recoverable unblock and redispatch the
same D12 route. Outside that route, automatic recovery is limited to a
within-scope context repair; other blockers remain incomplete under the owning
caller. Do not invent effort/model overrides. Record blockers as stable family
plus detail and escalate repeated family behavior instead of retrying unchanged.
When that redispatch is a same-tuple D12 continuation, use the incremental-only
follow-up above; any tuple change instead follows the fresh-child lifecycle
path.
