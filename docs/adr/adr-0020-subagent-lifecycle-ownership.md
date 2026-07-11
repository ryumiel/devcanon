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

Shared workflows that spawn subagents directly reference that skill before
their spawn points. The shared procedure owns:

- controller-local lifecycle ledger expectations;
- target lifecycle capability classes;
- surface-specific capability mapping;
- ordered append-only lifecycle-event history;
- total usable-control capability classification;
- independent operational, reuse, capability, and cleanup-state semantics;
- separate current state, workflow return status, reviewer disposition, and
  cleanup projection;
- orthogonal cleanup evaluation and irreversible reevaluation semantics;
- target-honest cleanup outcomes;
- cleanup gates before spawns;
- slot-limit recovery and one retry after cleanup or manual confirmation.

Workflow-specific dispatch rules stay with the workflow that owns them. For
example, `play-subagent-execution` owns task execution, per-task review routing,
implementer snapshot consumption, and same-session implementer fix-loop
exceptions. `play-review` owns reviewer and critic fanout, and records
reviewer state separately from critic verdict state.

The lifecycle ledger remains controller-local state. It is not durable
repository documentation and is not evidence for reviewers; reviewers and
implementers continue to read the worktree from disk.

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
- Cleanup projection depends on usable closure, and failed automatic close
  attempts enter the same sanitized manual-cleanup confirmation path as
  unavailable automatic cleanup before the single spawn retry.
- Cleanup evaluation distinguishes open, not-yet-evaluated rows from evaluated
  projection and remains evaluated when later capability facts cause
  reevaluation.
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
