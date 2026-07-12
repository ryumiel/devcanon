# ADR-0020: Subagent Lifecycle Ownership

## Status

Accepted

## Context

Several shared skills spawn subagents directly. Each spawning controller needs
the same operational hygiene: track active and completed sessions, capture
role-specific state before cleanup, classify target lifecycle capability
honestly, and recover from session-slot exhaustion without treating the
resource limit as task failure.

That procedure is reusable workflow policy. Keeping the complete policy inside
one implementation workflow makes other spawning workflows depend on a local
owner or duplicate the guidance. Duplicated lifecycle prose is likely to drift,
especially across target-specific capability classes and slot-limit recovery.

The existing skills-first architecture establishes skills as the reusable unit
for operational knowledge. The script-authority decision keeps deterministic
mechanics in skill-owned scripts, but this lifecycle concern is policy and
controller judgment rather than deterministic shell behavior.

## Decision

Generic subagent lifecycle cleanup guidance is owned by the internal
`subagent-lifecycle` skill.

This ADR owns the durable lifecycle ownership and recovery decision; the
source skill owns the reusable controller procedure. Examples, tests, and
generated target previews are evidence of that contract, not authority that
can override either source.

Shared workflows that spawn subagents directly reference that skill before
their spawn points. The shared procedure owns:

- controller-local lifecycle ledger expectations;
- target lifecycle capability classes;
- surface-specific capability mapping;
- ordered append-only lifecycle-event history;
- append-only value-bearing cleanup-decision reason histories with separate
  current reason projections;
- append-only value-bearing return-status and reviewer-disposition histories
  with separate latest projections;
- total usable-control capability classification;
- independent operational, reuse, capability, and cleanup-state semantics;
- separate current state, workflow return status, reviewer disposition, and
  cleanup projection;
- orthogonal cleanup evaluation and irreversible reevaluation semantics;
- deliberate same-session retention as a reasoned `close-deferred` decision,
  distinct from close attempts and failures;
- resolved same-session retention as an append-only decision event that clears
  current retention without adding a cleanup family or proving closure;
- deterministic cleanup projections for unevaluated, deferred, unavailable,
  failed-attempt, and successful-close histories;
- target-honest cleanup outcomes;
- cleanup gates before spawns;
- normal-gate continuation separately from slot-recovery retry authorization;
- provider-neutral timeout and runtime-failure terminal outcomes;
- classification and safe capture of open capacity-blocking rows;
- session-row ownership of identity, operational and reuse state, capture, row
  events, retention, cleanup projection, and close history;
- separate controller-level recovery episodes that own a sanitized failed-spawn
  origin, immutable exact-tag blocker snapshot, ordered episode events,
  authorization, reconstruction, one retry dispatch/result, and escalation;
- exact `ledger-row:<row-id>` and `inventory-only:<inventory-id>` authorization,
  without fabricating rows for pure inventory or deriving a second blocker from
  inventory evidence attached to a row;
- terminal retry success or sanitized failure, with one episode per recovery
  origin and no same-origin recovery after terminal failure.

Workflow-specific dispatch rules stay with the workflow that owns them. For
example, `play-subagent-execution` owns task execution, per-task review routing,
implementer snapshot consumption, and same-session implementer fix-loop
exceptions. `play-review` owns reviewer and critic fanout, and records
reviewer state separately from critic verdict state.

Both ledger levels remain controller-local state. They are not durable
repository documentation or reviewer evidence; reviewers and implementers
continue to read the worktree from disk.

## Consequences

- Subagent cleanup policy has one reusable owner instead of being copied into
  every spawning workflow.
- Direct spawning workflows must make the shared lifecycle obligation visible
  near their spawn points.
- Target capability claims remain target-honest: controllers can record
  automatic closure only when the current runtime exposes stable ids and a
  close operation.
- Interruption, supersession, completion, reuse, capability, and cleanup remain
  separate facts, so one lifecycle dimension cannot silently imply another.
- Ordered lifecycle events preserve observed transitions while current state,
  workflow return status, reviewer disposition, and cleanup outcome remain
  separately derived facts.
- Every observed return status and reviewer disposition remains in append-only
  value-bearing history while a separate latest value serves as the current
  projection through re-entry and reclassification.
- Runtime `timed-out` and `failed` are operational terminal outcomes with
  sanitized detail, not task or reviewer verdicts. They add no return status;
  sessions with prior returned turns preserve their return and disposition
  histories and projections, while never-returned sessions keep them absent.
- Once observed or classified, workflow return status and reviewer disposition
  survive same-session operational re-entry to active or waiting state.
- Cleanup projection depends on usable closure, and failed automatic close
  attempts enter the same sanitized manual-cleanup confirmation path as
  unavailable automatic cleanup before the single spawn retry.
- Cleanup evaluation distinguishes open, not-yet-evaluated rows from evaluated
  projection and remains evaluated when later capability facts cause
  reevaluation.
- Evaluated deliberate retention records `close-deferred`, `closed=no`, and a
  concrete workflow-owned reason without fabricating an attempt or failure;
  the reason remains event-associated append-only history after the current
  decision advances, and later real attempts append to rather than erase it.
- A retained row requires current `completed`, `timed-out`, `failed`, or
  `superseded` and fresh capture. A finished need records
  `retention-resolved(basis=need-finished, evidence=...)`; otherwise require
  latest `close-deferred` < value-bearing `required-state-captured` <
  `replacement-secured` <
  `retention-resolved(basis=captured-and-replaced, evidence=...)`. Resolution
  preserves the historical deferral and clears current retention. Its sole
  current projection is evaluated, decision
  `none`, no current retention or unavailable reason, and `closed=no`. The event
  neither changes the four cleanup families nor authorizes slot retry without
  actual or operator-confirmed cleanup.
- Every unavailable-cleanup decision preserves its concrete reason in
  append-only event history. Later reevaluation may clear the current
  unavailable reason projection but cannot erase or conflate that history.
- Observed successful closure is terminal for its session row; later capability
  loss cannot reverse `closed=yes` or create contradictory unavailable cleanup.
- A normal cleanup gate may continue after target-honest retained, unavailable,
  or failed results when capacity has not failed. Once a spawn reports slot
  exhaustion, retry remains blocked until actual closure or operator-confirmed
  manual cleanup.
- A capacity-blocking retained session requires the basis and proof above before
  actual or operator-confirmed cleanup; otherwise stop and escalate.
- Active, waiting, interrupted, pending, and unknown-identity capacity blockers
  require state-specific classification before cleanup; unsafe or unresolved
  open state stops recovery instead of being destroyed or guessed.
- Session rows never own recovery origins, episode identities, blocker
  snapshots, episode authorization, reconstruction, retry, or escalation.
  Episode authorization and terminal results leave row histories and cleanup
  projections unchanged.
- `slot-recovery-started`, `recovery-state-reconstructed`,
  `slot-retry-dispatched`, `slot-retry-succeeded`, `slot-retry-failed`, and
  every `manual-cleanup-confirmed` are ordered episode events, including manual
  confirmation for a row blocker. A row's `close-succeeded` remains a row event
  referenced by exact row/event identity.
- Each blocker accepts at most one current-episode authorization. Row blockers
  accept exact referenced close success or episode manual confirmation;
  inventory blockers accept only episode manual confirmation. Invalid or
  duplicate evidence fails before overwriting accepted evidence.
- Reconstruction requires complete authorization; dispatch requires
  reconstruction and consumes authorization exactly once; a retry result
  requires dispatch and is terminal. Terminal failure stores only sanitized
  escalation, forbids another episode for that origin, and does not prevent a
  distinct recovery origin.
- Known-surface mappings are detection-first capability guidance, not frozen
  provider action schemas; interruption and inventory never imply closure.
- Slot-limit failures are handled as orchestration resource exhaustion, with
  state reconstruction and one retry after cleanup or manual confirmation.
- Workflow-local exceptions remain explicit, so shared cleanup policy does not
  close sessions that a workflow still needs for same-session follow-up.

## Alternatives considered

- Keep lifecycle policy local to `play-subagent-execution`. Rejected because
  other shared workflows spawn subagents directly and would either miss the
  cleanup gate or depend on an unrelated implementation workflow as the owner.
- Duplicate lifecycle text in every spawning workflow. Rejected because target
  capability classes, cleanup outcomes, and slot-limit recovery would drift.
- Put the procedure under `play-agent-dispatch` references. Rejected because
  lifecycle cleanup is broader than parallel dispatch and applies to review,
  planning, issue priming, merge investigation, skill-authoring pressure
  scenarios, and other direct subagent-spawning controllers.
- Move lifecycle mechanics into a shared script. Rejected because the concern is
  controller policy and target-specific judgment, not deterministic executable
  mechanics.
