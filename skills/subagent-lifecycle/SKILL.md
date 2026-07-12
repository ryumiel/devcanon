---
name: subagent-lifecycle
description: Internal controller procedure for tracking, cleaning up, and recovering subagent sessions before workflows spawn additional subagents. Use only when another shared workflow invokes or references it.
claude:
  user-invocable: false
codex_sidecar:
  policy:
    allow_implicit_invocation: false
---

# Subagent Lifecycle

Shared workflows that spawn subagents directly use this procedure to keep
controller state recoverable and target lifecycle claims honest. The procedure
is controller-local orchestration hygiene: it does not change task status,
reviewer independence, git state, or any workflow's own dispatch and review
rules.

## Controller Lifecycle Ledger

Maintain a compact lifecycle ledger while spawning and integrating subagents.
The ledger is agent-local/controller-local state; do not write it as durable
repository documentation and do not pass it to reviewer agents as evidence.
Reviewers and implementers still read the worktree from disk.

Track one row per pending, active, waiting, interrupted, completed, timed-out,
failed, or superseded session. Operational state, reuse state, target capability
class, and cleanup outcome are independent ledger dimensions. Each row records:

- task, phase, or review scope;
- role;
- one `agent_id` or `agent_id=pending`;
- optional open-agent inventory when the target exposes it;
- base/head SHA or equivalent source-state anchor when relevant;
- one current operational state: `pending`, `active`, `waiting`, `interrupted`,
  `completed`, `timed-out`, `failed`, or `superseded`;
- reuse state when relevant, such as `reusable` after a context-preserving
  interruption;
- the target capability class when relevant;
- one cleanup evaluation state: `not-evaluated` or `evaluated`;
- an ordered, append-only lifecycle-event history with event-associated detail
  needed to recover the fact, including the concrete workflow-owned reason on
  every `close-deferred` event;
- the current workflow-owned retention reason only while the latest cleanup
  decision is deliberate retention;
- the current unavailable-cleanup reason only while the latest cleanup decision
  is unavailable, plus append-only concrete reason history for every
  `closure-unavailable` event;
- the latest workflow return status projection plus append-only status history
  for every observed returned turn;
- the latest reviewer disposition projection plus append-only classification
  history with each disposition's concise reason and source-state anchor;
- role-specific captured state;
- fixup count or blocker state when relevant;
- one cleanup outcome: `closed=yes`, `closed=no`, or
  `close-unavailable: <reason>`.

Role-specific captured state is whatever the owning workflow needs before it
can safely close, supersede, or replace that role. Examples include implementer
reports, changed files, test results, snapshot state, reviewer scope, reviewer
report, concrete findings, routing target, re-review target, gate result,
research brief path, CI investigation summary, and any open question or
blocker detail that must survive session loss.

Update the ledger before and after every dispatch. A pre-dispatch row uses
`agent_id=pending` until the runtime returns a stable id. A pre-dispatch row has
operational state `pending` and `agent_id=pending`; do not fabricate a stable
id. After dispatch, append the observed identity event and set current
operational state to `active`. Reuse state may be
`reusable`; `inventory-only` is a capability class, not an operational state.
New and pre-dispatch rows use cleanup evaluation `not-evaluated`. They may use
`closed=no` only to mean the session is currently open; do not append
`closure-unavailable` merely because `agent_id=pending` is temporary. Cleanup
outcome remains `closed=yes`, `closed=no`, or `close-unavailable: <reason>`.
Interruption and supersession never imply
completion or closure; record completion events and cleanup outcomes
separately. The ledger is the source for controller recovery after
orchestration failures; git remains the source for repository state.

## Ordered Lifecycle Events

Each row keeps an ordered, append-only lifecycle-event history alongside its
current operational state. Append events such as `dispatch-requested`,
`identity-assigned`, `followup-dispatch-requested`,
`interrupted-reuse-dispatch-requested`, `waiting`, `interrupted`,
`required-state-captured`, `replacement-secured`, `turn-completed`,
`superseded`, `turn-timed-out`, `turn-failed`,
`close-attempted`, `close-deferred`, `retention-resolved`, `close-failed`,
`close-succeeded`, and `closure-unavailable` when those facts occur. Record the
concrete workflow-owned retention reason as event-associated detail on each
`close-deferred`; an event name without its reason is incomplete. State changes
never erase prior events or their associated detail. An identity assignment,
wait, interruption, completion, supersession, deferral reason, or closure result
therefore remains recoverable after current state advances.

`followup-dispatch-requested(session-id=...)` requires a `completed` row,
matching stable identity, positive observed reuse, and value-bearing capture
newer than the latest `turn-completed` or capture-invalidating mutation; capture
precedes dispatch.
`interrupted-reuse-dispatch-requested(session-id=...)` is legal only when the
row is currently `interrupted`, the supplied id matches its stable identity,
observed reuse capability is positive, and required role-state capture is
strictly newer than its latest `interrupted` event. Append the interrupted-reuse
event without erasing history or detail and project `active`. Project `waiting`
only after an observed `waiting` event. This re-entry never fabricates
`turn-completed`, a workflow return status, or any other return fact.

Any `active`, `waiting`, or `interrupted` row may be superseded only
after its latest open-state transition by ordered `required-state-captured`,
`replacement-secured`, and `superseded` events. Cleanup never authorizes it.

Use `retention-resolved(basis=need-finished, evidence=...)` only when the
deferred need finished. `basis=captured-and-replaced` requires latest
`close-deferred` < value-bearing `required-state-captured` <
`replacement-secured` < `retention-resolved`. Either basis requires current
`completed`, `timed-out`,
`failed`, or `superseded`, and fresh capture; open re-entry must return or be
superseded and recaptured. It preserves deferral history while clearing current
retention. `retention-resolved` is a
lifecycle decision event, not a fifth cleanup projection family, cleanup outcome, or proof
of closure. Its current projection keeps cleanup `evaluated`, decision `none`,
clears current retention and unavailable reasons, and sets `closed=no`.
Deferral reasons and resolution evidence remain history; a later close attempt
or `closure-unavailable` selects an existing projection family.

Every `closure-unavailable` event carries its concrete reason as
event-associated detail and appends that value to unavailable-reason history.
The current unavailable-cleanup reason is a separate latest-decision projection;
later retention or a real close attempt may clear that projection but never the
historical event reason.

A runtime timeout appends `turn-timed-out` and sets current operational state
to `timed-out`; a runtime/session failure appends `turn-failed` and sets it to
`failed`. Attach only the sanitized reason or error detail needed for recovery.
These are runtime terminal outcomes, not task failure, reviewer findings, or a
workflow-returned `BLOCKED`. The abnormal turn appends no workflow return value.
Workflow return status and its history remain absent only when the session has
never returned; an abnormal same-session follow-up preserves all prior return
statuses, reviewer dispositions, their histories, and their latest projections.
A `timed-out` or `failed` row becomes cleanup-eligible only after its available
role state, sanitized runtime detail, and error or blocker context are captured.
That capture requirement follows the abnormal event through later operational
projections such as `superseded`; changing current state does not erase it.

A normal returned turn appends `turn-completed` and sets current operational
state to `completed`, including when its workflow return status is `DONE`,
`DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, `BLOCKED`, or `findings-recorded`.
Superseding that session later appends `superseded` and changes current
operational state to `superseded` without erasing its completion or earlier
events.

## Result and Disposition Dimensions

Workflow return status is absent before a return is observed and required after
it is observed. Every `turn-completed` carries the observed status as
event-associated detail and appends that value to status history; the latest
value is the current projection. Reviewer disposition is absent before
classification and required after classification. Every classification or
reclassification appends the disposition plus a concise reason and source-state
anchor; the latest value is the current projection. Neither projection replaces
or determines operational state. A returned reviewer can therefore have
operational state `completed`, workflow return status `findings-recorded`, and
reviewer disposition `advisory`; a later `stale` classification appends a new
value without erasing `advisory` or its reason.

Completed-session follow-up uses the exact `followup-dispatch-requested` guard
above, never the interrupted-reuse event. It projects `active`, preserves
history, and fabricates no completion or return; only an observed wait projects
`waiting`.

## Target Lifecycle Capability

Before promising automatic cleanup, identify what lifecycle controls the
current target runtime exposes. Do this once before the first subagent dispatch
in the workflow and update the conclusion if later tool availability proves it
wrong.

- `automatic-close-supported`: a stable agent/session identity and an exposed,
  usable close/session-cleanup operation exist, so a close attempt is possible;
  cleanup projection records whether that attempt fails or succeeds.
- `inventory-only` applies when reliable inventory or a tracked stable identity
  exists without usable closure. Record available inventory or tracked ids and
  the concrete `close-unavailable` reason, such as
  `close-unavailable: inventory-only; no close operation`.
- `cleanup-unavailable`: no reliable inventory, tracked stable-identity
  evidence, or usable closure exists. Record
  the concrete `close-unavailable` reason, such as
  `close-unavailable: no inventory or close operation`, and give explicit
  operator/UI cleanup guidance.

These classes are total over the usable controls actually observed. An exposed
close operation without stable identity is unusable. It selects
`inventory-only` only when other reliable inventory or tracked stable-identity
evidence remains; otherwise it selects `cleanup-unavailable`.

Codex runtimes may expose a `close_agent` operation; Claude Code or other
targets may expose different lifecycle controls or none at all. Treat
`close_agent` as conditional: use it only when active runtime detection exposes
it. Do not infer support from another target. If either the id source or close
operation is missing, automatic closure is unavailable for that target.

## Known-Surface Capability Map

Use this compact map as a detection starting point, not as a substitute for
observing the active runtime:

- **Local Codex:** use model-visible requests to steer, wait, stop, and close
  threads. Do not promise a low-level action name. Active runtime detection
  decides whether closure is supported.
- **Responses API Multi-agent:** detect the actions exposed by the active
  runtime instead of treating a remembered action list as a closed schema.
  When exposed, spawn, send, and wait actions provide only their observed
  semantics; `interrupt_agent` is interruption, not closure;
  `followup_task` may reuse retained context; and `list_agents` may provide
  inventory. No hosted close action is promised. Even if a close-like action
  appears, classify automatic closure only from a detected stable identity plus
  an exposed, usable close operation and its observed result.
- **Claude Code:** detect actual identity, inventory, interruption, reuse, and
  closure controls. Claude Code inherits no Codex or Responses API assumptions.
- **Unknown targets:** Unknown targets inherit no known-surface assumptions.
  Use detected capabilities; otherwise classify them as
  `cleanup-unavailable`.

This map does not change the provider-neutral decision classes above. Stable
identity plus an exposed, usable close operation plus a successful close are
all required before recording `closed=yes`.

## Cleanup Projection

Cleanup evaluation is orthogonal to cleanup outcome. Establish the evaluation
state, captured role facts, capability tuple, observed events, and any proposed
retention reason before projecting cleanup. Before the cleanup gate,
`not-evaluated` permits `closed=no` only as an open-session observation and
does not project a cleanup decision or any closure event. The cleanup gate
transitions the row to `evaluated`; after that transition, these families make
the projection deterministic:

- An evaluated session deliberately retained for same-session follow-up
  appends `close-deferred` with its concrete workflow-owned reason as
  event-associated detail, records that reason as the current retention reason,
  and projects `closed=no`. That decision does not append `close-attempted` or
  `close-failed`; deferral is not a fabricated close attempt.
- An evaluated deferred session with a valid resolution event keeps evaluation
  `evaluated`, sets the current cleanup decision to
  `none`, clears current retention and unavailable reasons, and projects
  `closed=no`. This evidenced transition is not another cleanup family. A later
  actual close or unavailable fact still uses one of the four families listed
  here.
- An evaluated session without stable identity or without an exposed, usable
  close operation appends `closure-unavailable` with the concrete reason as
  event-associated detail, appends the reason to unavailable-reason history,
  and projects `close-unavailable: <reason>` with that same current reason. An
  exposed-but-unusable close operation follows this unavailable path, not
  `closed=no`.
- An evaluated session with stable identity and an exposed, usable close
  operation whose real close attempt fails appends `close-attempted` and
  `close-failed`, then projects `closed=no`.
- An evaluated session whose real close attempt succeeds appends
  `close-attempted` and `close-succeeded`, then projects `closed=yes`.

An evaluated row with no applicable decision and reason is invalid or ambiguous
except for the exact evidenced post-`retention-resolved` projection above.
Facts that contradict their events or projection remain invalid. Do not
normalize invalid state into another family and do not write external state from
it. A missing retention or unavailability reason is invalid, as is a claimed
attempt without an observed success or failure.

Observed `close-succeeded` is terminal and dominant for that session row. Later
loss of identity, inventory, or operation capability does not change
`closed=yes` and must not append `closure-unavailable`; preserve the successful
close and its history.

Do not retain a cleanup outcome that contradicts the latest closure decision,
event, or capability facts. A failed close is not unavailable, and a deferred
close is not a failed attempt. Before a later attempt or unavailable family,
require a valid `retention-resolved` event. The current retention reason no
longer applies after that event, but the historical `close-deferred` reason
remains recoverable. After `retention-resolved`, a later real attempt appends to
history without erasing `close-deferred`, its associated reason, or the
resolution evidence. Likewise, a later retention or close
attempt clears the current unavailable-cleanup reason while preserving every
prior `closure-unavailable` reason in append-only history. A later success
replaces `closed=no` with `closed=yes` without deleting deferral, unavailable,
or failed-attempt history.

For rows not already successfully closed, later capability changes trigger
reevaluation by appending newly observed capability and closure events, keeping
cleanup evaluation `evaluated`, and projecting from the latest applicable fact.
Successfully closed rows do not undergo capability reevaluation. Evaluation never returns to
`not-evaluated`; it is not an escape hatch for an outcome, event, or capability
contradiction.

## Cleanup Gate Before Spawns

Before every new subagent spawn, inspect the lifecycle ledger for completed,
timed-out, failed, or superseded sessions. The cleanup gate may close only
sessions whose role-specific state and any required runtime error or blocker
detail have already been captured.

1. Capture the role-specific state needed by the owning workflow before
   closing or superseding any session.
2. Transition cleanup evaluation from `not-evaluated` to `evaluated`. A row
   already evaluated remains `evaluated` during later reevaluation.
   A row with observed `close-succeeded` remains terminal and is not
   reevaluated.
3. When the owning workflow still requires same-session follow-up, append
   `close-deferred`, record its concrete workflow-owned reason, and project
   `closed=no` without appending attempt or failure events for that decision.
4. Otherwise, when the target is `automatic-close-supported`, attempt to close
   cleanup-eligible sessions after the required state is recorded,
   append the observed attempt and result events, and project `closed=no` or
   `closed=yes` from the result.
5. Otherwise, when the target is `inventory-only` or `cleanup-unavailable`,
   first capture the same role-specific state, then append
   `closure-unavailable` and record the concrete `close-unavailable` reason
   before spawning instead of claiming closure.

Target-honest outcomes matter more than a clean-looking ledger. Never record
`closed=yes` unless the current target actually exposed stable ids plus a usable
close operation and the close completed.

This normal cleanup gate records target-honest evidence; it is not itself a
capacity-recovery authorization gate. When no spawn has reported slot or
session exhaustion, the controller may continue after recording a deferred
family (`close-deferred` plus `closed=no`), unavailable family
(`closure-unavailable` plus `close-unavailable: <reason>`), failed-attempt
family (`close-attempted`, `close-failed`, and `closed=no`), or successful-close
family. Once a spawn reports slot exhaustion, the separate retry guard below
applies and only its authorization evidence permits a retry.

## Slot-Limit Recovery

A spawn failure caused by open agent/session limits is orchestration resource
exhaustion, not implementation failure, reviewer failure, or CI failure.

Recovery uses two controller-local ledger levels. Session rows continue to own
session identity, operational and reuse state, capture, row events, retention,
cleanup evaluation and projection, and close attempt/result history. A
controller-level recovery episode record owns the sanitized recovery-origin
identity, episode identity, immutable tagged blocker snapshot, ordered episode
events, authorization projection, reconstruction, retry dispatch/result, and
escalation. Episode facts never live on or fabricate a session row, and episode
events never change a row cleanup projection or row history.

One recovery origin identifies the failed spawn attempt. At most one episode
may exist for that origin; a later unrelated failed spawn uses a distinct
origin. Apply these transitions in order:

Treat every accepted snapshot, authorization, and episode event as an immutable
controller-owned copy rather than retaining caller-owned objects. Before every
transition, require the episode record and recovery-origin index to agree
bidirectionally and uniquely; inconsistent indexes fail before mutation.

1. Validate the sanitized origin and episode identities, unused origin and
   episode, an independently observed nonempty tagged blocker inventory, the
   proposed nonempty exact-tag snapshot, sanitized identities, and unique
   references before creating anything. Require bidirectional membership and
   tag equality between the observed inventory and proposed snapshot; reject an
   omission, addition, duplicate, or retag before creating the episode. A
   blocker is exactly
   `ledger-row:<row-id>` or `inventory-only:<inventory-id>`. Inventory evidence
   attached to a row does not create a second blocker. Equal raw values under
   different tags are distinct only when independently observed. On success,
   append the episode event `slot-recovery-started` and project `authorizing`.
   Invalid start mutates neither level.
2. Classify and safely prepare every referenced row under the ordinary row
   rules above. Pure inventory blockers never enter row eligibility, retention,
   cleanup, or close logic. Unsafe capture, unresolved identity, or unresolved
   retention stops and escalates without fabricating cleanup.
3. Authorize blockers one at a time on the episode. Validate the current
   episode and origin, exact snapshot tag and identity, evidence kind and
   metadata, then absence of prior authorization before appending. A row
   blocker accepts either an exact current-episode reference to that row's
   value-bearing `close-succeeded` event by row and stable event identity, or an
   episode `manual-cleanup-confirmed` event with sanitized provenance and time.
   The referenced close event remains row-owned and carries stable row/session
   ownership, not episode ownership; the episode reference and ordering make it
   current-episode admissible. Missing or contradictory row history fails. An
   inventory blocker accepts only the episode manual-confirmation event; row
   close evidence cannot authorize it. Reject duplicate, stale, non-snapshot,
   cross-kind, incomplete, or inventory-close evidence before mutation. Keep
   the first accepted evidence unchanged when a later authorization fails.
   A failed automatic close with `closed=no` is not permission to retry the
   spawn; it still requires exact episode authorization.
4. After all blockers authorize, reconstruct active workflow state from the
   row ledger and required repository/lifecycle anchors. Append
   `recovery-state-reconstructed` and project `ready`. Reconstruction rejects
   incomplete, consumed, or terminal episodes.
5. From `ready`, append exactly one `slot-retry-dispatched`, consume the
   authorization once, and project `retry-dispatched`. Missing reconstruction
   or a second dispatch fails before retry or mutation.
6. A retry result requires that dispatch and no prior result. Append exactly one
   `slot-retry-succeeded` and project terminal `retry-succeeded`, or append
   `slot-retry-failed`, store only a closed structured escalation containing an
   `available` or `unavailable` inventory state and a unique list of exact
   sanitized tagged snapshot blockers that remain, and project terminal
   `retry-failed`. Reject extra fields, free-form text, non-snapshot blockers,
   malformed identities, and escalation metadata on success. Duplicate or
   conflicting results fail. Either result is terminal. Failure forbids another
   episode or retry for the same origin; a distinct recovery origin remains
   eligible for a later unrelated failure.

The episode ledger's retry-failure escalation uses only the closed inventory
state and remaining tagged-blocker fields above. Any broader user-facing
summary may include only session ids, operational state, observed workflow
return status, role, scope, needed repository anchors, and sanitized open-agent
inventory, or state that inventory is unavailable. Never disclose
secrets, credentials, tokens, PII, environment values, raw prompts,
transcripts, logs, stack traces, validation dumps, captured state, internal
decision trails, or session chronology. Shared comments also follow the
`Agent-Local Evidence Reuse Boundary` in
`docs/specs/afds-workflow-routing.md`. Use summary-only prompt, transcript, log,
stack, validation, and captured-state context on those shared surfaces.
