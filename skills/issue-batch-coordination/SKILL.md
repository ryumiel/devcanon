---
name: issue-batch-coordination
description: Coordinates issue batches across existing owners, dependencies, readiness checks, and controller recovery. Use when the user asks to manage a batch, keep several issues moving, or resume batch coordination; users need not name a skill. Do not use for a single issue's implementation or a bounded explicit routing request.
codex:
  license: MIT
  metadata:
    short-description: Coordinate issue batches through existing owners
codex_sidecar:
  interface:
    display_name: Issue Batch Coordination
    short_description: Coordinate batch scope, dependencies, and readiness
---

# Issue Batch Coordination

Keep the user's accepted batch moving through its existing owners. This skill
owns coordination policy; explicitly invoke
[`issue-batch-routing`](../issue-batch-routing/SKILL.md) for routing decisions
and dispatch. The router alone owns complete route keys, gate precedence,
approval evidence, progress receipts, and terminal or archival eligibility.
Invocation is not authorization. Preserve user decisions and the owning
workflow's gates; do not implement, approve, merge, or change issue status by
substituting this skill for an owner.

## Entry and working context

Select this skill from ordinary batch-management intent. A bounded explicit
router request can run the router directly. The router must not invoke this
skill back. To call the router, use the host's skill invocation surface when
available; otherwise explicitly read and apply the linked router in the same
controller. Do not require the user to type its name. Respect a host denial;
report an unavailable handoff rather than reproducing a denied workflow.

Start with provider-native issue identities, accepted scope and acceptance,
known owner tasks, dependency evidence, user decisions, and the router's
existing controller-local ledger. Read the router before the first routing
pass. Resolve missing context from the tracker and owner reports; request only
the missing decision when evidence cannot settle it. A request to coordinate
does not independently authorize new tasks, owner messages, publication, or
scheduling: honor the current host and user authorization for each effect.

Keep coordination notes alongside the existing ledger: actual dependency edges,
combined acceptance and its existing owner, validation revision evidence,
controller location and any acknowledged successor, and the loaded policy's
source revision or content fingerprint. These are local recovery facts, not a
new schema, event store, tracker substitute, or source of approval. Use a
stable location accessible after owner checkout cleanup. Do not store the only
copy inside an owner worktree scheduled for removal.

## Coordination cycle

1. **Refresh.** On entry, watchdog wake, resume, or controller handoff, reread
   this skill's canonical file and the references required by the current
   action. Use the active library bundle, not a remembered summary or policy
   copied into a timer prompt. Record its revision or fingerprint in existing
   local state. Refresh the affected owner and provider evidence through the
   router. Before a material routing action, recheck the applicable policy and
   live bindings even if the timer has not elapsed.
2. **Classify.** Keep running work, verified unfinished non-gate work, genuine
   gates, and terminal outcomes distinct. An idle owner is not automatically
   unfinished or complete. Let running owners work; use the router's receipt
   procedure for eligible unfinished continuation and its gate path for real
   decisions. Preserve dependency and readiness distinctions below.
3. **Route once.** Explicitly invoke `issue-batch-routing` with the affected
   provider-tagged items, current owner evidence, scope, relevant policy, and
   existing approval facts. The router validates and deduplicates each route;
   do not create a second key or approval mechanism here. Advance eligible
   queued work within authorization without a generic “proceed” request. A
   blocked item need not stop independent eligible siblings.
4. **Record and yield.** Integrate the router's outcome into the existing
   ledger. Keep its full monitor result locally; give the user a concise delta
   with meaningful progress, completion, failure, or the concrete decision
   needed. Suppress repeated unchanged waits. Owner gate reports are the
   primary continuation signal; use supported waits or the optional watchdog,
   not repeated messages asking running owners to continue.

When refreshed policy differs, assess its effect before using it. Editorial
changes do not invalidate approvals by themselves. A changed authority or
scope requirement, or unresolved policy conflict, needs the owning decision
before the affected action; refresh cannot expand prior permission. If a
required policy or reference is unreadable, stop affected routing and identify
the missing source. Continue independent work only when its own policy and
authority remain available. Pass relevant current policy and the exact current
authority binding from the router in owner handoffs; if that binding is
unavailable, hold the affected handoff rather than reconstructing permission.
Refreshing the controller does not refresh active owners' contexts.

## Scope and combined readiness

Before routing review-driven repairs, read the existing
[finding proportionality reference](../play-review-response/references/finding-proportionality.md)
and use the review-disposition owner. That reference classifies current
contract defects, adjacent work, proof/test defects, and speculative findings.
Do not create another review layer or turn severity, a technically possible
fix, or a successful experiment into scope authority. Keep acceptance and
validation proportional to the approved behavior; do not add a general repair
or proof framework to clear a batch.

Track actual producer/consumer dependencies separately from shared-file
conflicts. Two issues editing one registry may need publication sequencing or
conflict resolution without one requiring the other's behavior. Use a stack
only when its dependency and publication strategy are authorized; do not turn
all siblings into a linear chain for convenience.

Assess these readiness questions separately:

- **Combined behavior:** where accepted behavior spans issues, use an existing
  appropriate owner to run bounded combined validation against the intended
  current revisions, including relevant uncommitted changes or build inputs.
  Record the exact revisions and working-tree state tested. Green component
  tests or stubbed integration tests do not prove the cross-issue acceptance.
  Evidence predating changed inputs must be refreshed. Create a separate
  validation task only if the owning workflow requires it or the user has
  explicitly authorized that scope.
- **Publication:** compare each owner's local revision with the actual PR head
  and remote ancestry. A green local result does not make the published PR
  green, and approval for an old remote head does not transfer to a new local
  head. Conversely, old-head publication approval is not a reason to validate
  obsolete code instead of the intended combined implementation. Run authorized
  local validation and route publication reconciliation separately. If a
  rebase leaves no normal push path, route branch-continuity recovery to the
  existing owner; preserve work, forbid force-push, and require fresh evidence
  and the router's applicable approvals after the revision changes.
- **Delivery and completion:** distinguish implementation, combined acceptance,
  publication, merge or source disposition, owner task completion, cleanup,
  and separately authorized post-merge work. An archived task or “done” report
  proves none of the other states. Invoke the router's terminal checks before
  archival and retain outstanding acceptance or follow-up work in the batch.

## Recovery and watchdog

On resume, validate both the controller's own checkout and owner locations.
Use the host's existing recovery or worktree workflow for a stale or deleted
checkout; do not silently operate from a different repository. Restore the
ledger from its stable location, then revalidate its hints against live state.
If authority or replay evidence was lost, report that missing evidence; a
receipt or an archived transcript cannot reconstruct approval.

For an authorized successor, transfer the existing context and require its
acknowledgement before it dispatches. When a watchdog exists, also reconcile
its target and status through supported host controls before successor
dispatch. Archiving the predecessor does not transfer or stop the timer.

Read [Watchdog operation](references/watchdog.md) when a timer is requested,
already exists, or needs recovery. Scheduling is optional host functionality;
this skill creates no timer by itself. Missing scheduling support does not
prevent owner-driven coordination. A refresh can reveal drift, but neither
prose nor a timer guarantees policy compliance.
