# ADR-0041: Purpose-Based Review Retirement and Completed-Review Replacement

## Status

Accepted policy design; executable activation remains gated by owner proof.

## Context

Completed review work can remain gated without ever being posted. A correction
cycle needs independent review of new bytes, while cancellation and publication
must remain truthful human and remote outcomes. Treating all old reviews as
abandoned or posted introduces another human decision or fabricates an effect.

Local diagnostic evidence has a separate problem: preservation custody does not
prove deletion authority, but keeping an entire completed workspace or copying
it wholesale is unnecessary when exact task ownership and exhausted consumers
are provable. Unknown custody and explicit recovery/history obligations still
need protection. Ordinary success already has supported cleanup; policy should
consolidate obligations without multiplying states, archives or gates.

## Decision

Place retirement and completed-review replacement policy in the existing
[review lifecycle owner](../../skills/pr-review/references/review-lease-lifecycle-contract.md#target-retention-and-supersession-contract).
Keep exact custody with artifact producers, action authority with invoking
workflows, current-head judgment with independent review, and pending/replay
coordination with the existing router. Consumers reference one owner per rule.

Retirement follows an identified purpose, current exact ownership proof and
applicable scoped authority. Select one bounded archive-and-replace event for
completed unposted old-head review instead of a new persisted terminal state.
Preserve the exact old lease for replacement recovery and only the comparison or
recovery material still needed; the successor starts with cleared authority and
requires fresh independent review. Compatible standing authority survives a
changed head; evidence and action bindings refresh.

Accepting this policy does not activate unsupported mechanics. Existing
transition and refusal rules remain until implementation proves the target's
custody, collision, interruption and replay guarantees. Mandatory preparation
failure-history retention remains because a sufficient finite release guarantee
has not been established. Historical records and live outcomes remain truthful.

## Consequences

- Eligible routine diagnostic retirement and changed-head review do not need
  repeated generic cleanup approval or a cancellation decision.
- Narrow exact lease snapshots remain necessary where replacement/recovery
  consumes them; blanket workspace copies do not become mandatory.
- Unknown ownership, active consumers, unresolved effects and explicit history
  obligations still hold the affected resource.
- Implementers must prove direct replacement is recoverable within existing
  owners. A missing proof preserves current restrictions rather than adding
  another exception or hidden operational state.
- Legacy evidence qualifies only through surviving original proof and current
  validation; no bulk migration or retroactive ownership is implied.

## Alternatives considered

- Reinterpret abandonment or posting: rejected because cancellation and remote
  publication are different outcomes with their own authority.
- Add a persisted superseded terminal state: not selected because it expands
  reducer, discovery and archive matrices. Revisit through the owning decision
  only if direct replacement cannot satisfy the same recovery guarantees.
- Keep requesting per-case exceptions: rejected as the normal path because
  already-covered routine correction and cleanup should not multiply decisions.
- Copy all completed evidence or add a retention service: rejected because it
  creates storage and duplicated-state obligations without identifying a consumer.
- Remove preparation history now: rejected because current custody guarantees
  have no demonstrated finite retirement boundary.
