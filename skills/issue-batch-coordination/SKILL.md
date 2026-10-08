---
name: issue-batch-coordination
description: Coordinates issue batches across existing owners, dependencies, readiness checks, and controller recovery. Use when the user asks to manage a batch, keep several issues moving, or resume batch coordination; users need not name a skill. Do not use for a single issue's implementation or a bounded explicit routing request.
requires:
  - issue-batch-routing
  - play-review-response
  - pr-review
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
substituting this skill for an owner. A request to execute a concrete accepted
batch can authorize routine orchestration within that scope; invocation alone
does not decide whether work or inspection was requested.

## Entry and working context

Select this skill from ordinary batch-management intent. A bounded explicit
router request can run the router directly. The router must not invoke this
skill back. To call the router, use the host's skill invocation surface when
available; otherwise explicitly read and apply the linked router in the same
controller. Do not require the user to type its name. Respect a host denial;
report an unavailable handoff rather than reproducing a denied workflow.

Before a create or release route, read the router and establish or recover its
existing controller ledger. Start with provider identities, scope and
acceptance, owners, dependencies, and decisions. A fresh accepted batch may
initialize current facts from supported evidence; a resumed historical attempt
with missing ledger or replay facts waits or reports, never reconstructing
keys, digests, approvals, or bindings. The controller owns recovery, creation
reconciliation, binding delivery, and readiness observation; the provider owner
owns priming and later work. Resolve missing context from tracker and owner
reports; request only the missing decision when evidence cannot settle it.
Interpret the current request with surrounding human decisions and the concrete
accepted batch scope before any owner handoff or effect. An execution-oriented
request to start or keep that batch moving authorizes routine creation of
missing owner tasks, worktree provisioning through the existing owning setup
workflow, targeted instructions to those owners, and dependency-driven
continuation within the accepted scope, where the host permits each action.
Retain compatible prior authorization across turns; naming this skill neither
grants execution nor discards established work intent. A status or inspection
request remains read-only: discover and report, but do not create or message
owners or release priming. If intent or accepted scope is missing or
conflicting, ask only for that decision before affected effects. Publication,
merge, recurring scheduling, destructive cleanup, and scope expansion each
retain their applicable separate decisions, including any still-current prior
authorization. An accepted delivery decision may cover publication, conditional
merge, and scoped cleanup through completion. Coordination interprets that
human scope and produces a concrete current instruction for the existing effect
owner; routing validates its exact binding. Changed head, checks, review,
mergeability, source state, or gate evidence invalidates the dependent action
binding and readiness, not that standing scope. Refresh the affected facts and
required gates, then issue a new exact instruction within retained authority
without generic reapproval. Escalate only revoked or missing scope, expansion,
a materially unresolved choice, an explicitly reserved human decision, or a
required exception; reports, planning PASS, and tool availability supply none
of that authority. Report an explicit host restriction or denial for the specific
action; do not invent an alternative permission or route around it. One
blocked item does not hold independently eligible siblings.

Keep the ledger as the single current view: provider identity, accepted scope
and applicable authority, dependencies, owner/host/repository, current head,
validation/readiness, gate/blocker/next action and evidence references. Keep
controller/successor, policy revision and monitor state as current batch facts.
There is no separate current view, history section, append-only event log or
coordinator archive. Derive batch summaries from the current items.

Compare observations for the same item and operation using supported identity,
applicable head/revision and verification evidence; timestamps alone do not
order effects. A duplicate or superseded observation leaves verified facts and
routed effects unchanged. Refresh conflicting or incomparable evidence from
the affected authoritative owner/provider before action or reporting. Missing
or conflicting evidence holds only its action. Replace obsolete observations,
resolved blockers and completed queue entries; keep unknown facts explicit.

Apply the router's [operational retention](../issue-batch-routing/SKILL.md#operational-retention)
rules to authority, pending effects, route/receipt guards and notifications.
A head change invalidates affected readiness and exact action bindings without
revoking compatible standing authority. Keep review and recovery evidence at
its owning workflow and link only what the current decision needs; never copy
an execution diary or delete owner evidence while compacting the ledger.
Store the ledger stably, never only in a removable owner worktree.

## Reporting path and bounded observation

During initial setup, before releasing an owner into unattended work, establish
an actual supported return-report path. Reuse the setup decision for execution
and monitoring; do not add a recurring reporting-approval phase. Retain the
verified coordinator recipient/host, sending owner/host, covered reporting
scope, and a supported reference to the actual human authorization when the
sender's host requires it. Deliver those facts in the owner handoff and verify
that the recipient can access or otherwise validate the human evidence. Chat
creation, skill invocation, a copied controller instruction, or approval in an
inaccessible side conversation supplies no human messaging permission.

Request only missing recipient-visible authorization through a supported
surface. A transport or permission gap holds unattended release/reporting with
that specific limitation; do not claim a reporting path or substitute polling.
Retain and reuse valid authorization across reports, continuation, and
compatible resume. A routine gate or head change alone needs no reapproval;
request a new decision only for missing/unverifiable evidence, revocation,
uncovered recipient/effect, or an actual host requirement.

Owners deliver the required initial handoff, hard gates requiring coordinator
routing/decision, dependency readiness, material readiness invalidation, and
one verified completion of their accepted job. Delivery uses the router's
[Delivery and evidence](../issue-batch-routing/SKILL.md#delivery-and-evidence)
contract. At a hard gate hold its affected action; independent authorized work
may continue. A successful completion delivery needs no routine acknowledgement
and does not by itself establish terminal batch completion.

Do not poll owner progress: repeated reads, snapshots, or wait loops to discover
ordinary progress or whether a gate appeared are prohibited, including
`read_thread`, `wait_threads`, and equivalent tools. Longer intervals do not
change the boundary. End a routing pass by yielding for delivered reports.
A watchdog observes external events, never owner progress.

Bounded purpose-specific owner reads are allowed:

- **Initial binding:** confirm the exact created/located owner and initial
  waiting state for release; stop at confirmation or the specific unknown fact.
  Await the owner's required handoff after release, without a progress loop.
- **Received report:** resolve its evidence and current route/owner/head/authority
  before dependent routing; stop at validation or the exact missing/stale fact.
- **Explicit user status:** read the named owner's current evidence to answer
  that request; stop after the answer, without arming repeated status reads.
- **Concrete recovery:** reconcile the supported result of a named uncertain
  creation, delivery, or interrupted operation under the router's recovery rules;
  stop at the established outcome or exhausted supported recovery/gap. Do not
  use recovery as a pretext to watch ordinary progress.

These reads create no unattended discovery loop or polling fallback. Missing
facts hold the affected action and expose the required evidence/intervention.

## Coordination cycle

1. **Refresh.** On entry, watchdog wake, resume, or controller handoff, reread
   this skill's canonical file and the references required by the current
   action. Use the active library bundle, not a remembered summary or policy
   copied into a timer prompt. Record its revision or fingerprint in existing
   local state. Validate affected received owner reports and provider evidence through the
   router, within the bounded observation purposes above. Before a material routing action, recheck the applicable policy and
   live bindings even if the timer has not elapsed.
2. **Classify.** Keep running work, verified unfinished non-gate work, genuine
   gates, and terminal outcomes distinct. An idle owner is not automatically
   unfinished or complete. Let running owners work; use the router's receipt
   procedure for eligible unfinished continuation and its gate path for real
   decisions. Preserve dependency and readiness distinctions below.
3. **Route once.** After that ledger bootstrap or recovery, explicitly
   invoke `issue-batch-routing` with the affected provider-tagged items,
   current owner evidence, scope, relevant policy, and existing approval facts.
   The router validates and deduplicates each route; do not create a second key,
   owner-dispatch procedure, or approval mechanism here. Forward accepted scope
   and applicable authority unchanged; the router alone decides whether a
   compatible top-level owner is reused, host creation is allowed, or the item
   waits. Advance eligible
   queued work within authorization without a generic “proceed” request. A
   blocked item need not stop independent eligible siblings.
4. **Record and yield.** Reconcile the router's outcome into the affected
   current ledger item, then derive the batch summary from the updated items. Before
   treating facts as current or using them for an action, compare the incoming
   observation with retained current facts as above, then make the current
   gate, blocker, next action, evidence, and any retained snapshot, digest and
   observation time agree. Replace the prior monitor summary and clear only
   positively obsolete or inapplicable fields; preserve unrelated items and
   router-required operational markers under its retention rules.
   Missing, unavailable, stale or conflicting required evidence holds the
   affected action with its references rather than concealing the gap or
   refreshing stale facts. For a terminal item, retain its disposition,
   verified terminal evidence references, unresolved obligations and still-needed
   operational markers; a closed source issue alone does not authorize archival. After an
   already-authorized cleanup, replace location and availability claims with
   the observed result; an unknown result remains unresolved. Select the
   audience after reconciliation. Owners retain routine commits, intermediate
   checks, review preparation, shared-resource waits, bounded fixes and
   recoverable errors locally; these produce no coordinator message or
   acknowledgement wait. Send the coordinator only a required routing/decision
   action, dependency readiness, exhausted recovery needing intervention, a
   material head/scope/ownership/readiness change affecting a pending action or
   invalidating recorded readiness, or one verified completion. A running owner
   continues authorized work without waiting for routine acknowledgement.
   Use the router's compact delta and evidence-reference contract; resolve and
   validate complete evidence before dependent action. Silence never preserves
   old-head readiness or proves completion. Give the user one concise report when a decision or
   action is needed, an actionable blocker or failure arises, a meaningful
   delivery milestone is reached, the batch reaches verified terminal
   completion without a delivery milestone, or the user requests status.
   Report that terminal outcome after authoritative reconciliation, even when
   no further action is needed and monitoring will stop. Answer a status
   request from current evidence even without a new milestone. Suppress
   no-action notices and duplicate commentary/final reports for the same
   event, including a terminal outcome already reported with delivery or
   status; retain exact notices required by an owning phase or other consumer.
   Missing authority or required evidence holds the affected action and
   surfaces the concrete missing decision or evidence when user action is
   needed. Creation or a sent binding is not readiness: consume the owner's
   delivered initial handoff or gate report and validate its supported evidence.
   Yield for reports after routing; do not repeatedly inspect or wait for owner
   progress, and do not ask running owners to continue. The optional watchdog
   checks external events under its separate notification boundary.

Use the [reporting scenarios](references/reporting-scenarios.md) to verify
quiet local work, actionable delivery, evidence resolution and deduplication.

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
and apply its classifications and dispositions without duplicating them here.
Do not create another review layer or turn severity, a technically possible
fix, or a successful experiment into scope authority. Keep acceptance and
validation proportional to the approved behavior; do not add a general repair
or proof framework to clear a batch.

For confirmed Connector review quota or unavailability, apply the accepted
conditional policy in ROUTE-007-REVIEW.
Validate supported provider evidence, policy, current PR/head, and independent
recipient/reviewer bindings before dispatch. Slow eyes alone is not this event.
Use the router's existing complete `bot-review-signal` context to reconcile and
reuse an existing independent `pr-review` task or create one when supported and
authorized; suppress duplicate unchanged fallback tasks and review requests.
Keep route eligibility and keys with the router and review lifecycle with
`pr-review`. Only its complete current passing verdict, including all required
verification, satisfies the conditional review gate; task creation, partial
results, and same-account GitHub APPROVE do not. Return findings to the existing
implementation owner for classified correction, validation, and independent
scope-selected changed-head follow-up. Missing authority, host control,
bindings, or complete verdict holds the affected handoff and reports the gap;
never invent an owner or review approval.

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
  green, and an action binding or readiness evidence for an old remote head does
  not transfer to a new local head. Conversely, a stale publication binding is
  not a reason to validate obsolete code instead of the intended combined implementation. Run authorized
  local validation and route publication reconciliation separately. If a
  rebase leaves no normal push path, route branch-continuity recovery to the
  existing owner; preserve work, forbid force-push, and require fresh evidence
  and a newly bound current instruction under retained scope after the revision
  changes; request only an actually missing decision.
- **Delivery and completion:** distinguish implementation, combined acceptance,
  publication, merge or source disposition, owner task completion, cleanup,
  and separately authorized post-merge work. An archived task or “done” report
  proves none of the other states. Invoke the router's terminal checks before
  archival and retain outstanding acceptance or follow-up work in the batch.

## Recovery and watchdog

On resume, validate controller and owner locations. Use existing host recovery
for a stale or deleted checkout; never silently use another repository. Restore
the stable ledger and revalidate its hints. Remove positively superseded
content and regenerate summaries from reconciled items, retaining unresolved
effects and obligations under the router’s retention rules. Report lost authority or replay
evidence; a receipt or archived transcript cannot reconstruct approval.

For an authorized successor, transfer the existing context and require its
acknowledgement before it dispatches. When a watchdog exists, also reconcile
its target and status through supported host controls before successor
dispatch. Archiving the predecessor does not transfer or stop the timer.

Read [Watchdog operation](references/watchdog.md) when a timer is requested,
already exists, when a separate watcher is authorized, or when either mode
needs recovery or shutdown. Use its one-mode startup, observation, handoff,
and verified-stop procedure; owner reports remain primary. For requested new
monitoring, default to a supported, separately authorized watcher; a coordinator
heartbeat requires explicit selection. Unsupported watcher controls never
silently select a heartbeat. Preserve a compatible existing monitor's settings
and cadence, and do not recreate an explicitly stopped monitor without later
explicit scheduling authority.

The target-native new-watcher binding is `WATCHER_MODEL` = `{{model:efficient}}`.
Pass this already-rendered value to the host task's supported model setting,
unless an applicable explicit user model override takes precedence. Effort is
independent of this binding. Missing, unresolved, or rejected bindings or controls
hold activation with the concrete limitation; do not rediscover source or ambient
configuration or substitute a model.

Scheduling is optional host functionality; this skill creates no timer by
itself. Missing scheduling support does not prevent independently authorized
owner-driven coordination. A refresh can reveal drift, but neither prose nor a
timer guarantees policy compliance.
