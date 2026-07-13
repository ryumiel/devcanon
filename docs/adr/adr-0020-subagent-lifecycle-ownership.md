# ADR-0020: Subagent Lifecycle Ownership

## Status

Accepted

## Context

Several shared skills spawn subagents directly. Each spawning controller needs
the same operational hygiene: track active and completed sessions, capture
role-specific state before cleanup, classify target lifecycle capability
honestly, and recover from session-slot exhaustion without treating the
resource limit as task failure.

Agent surfaces expose different controls. Local Codex can expose
model-visible requests without exposing identically named low-level runtime
actions. Responses API Multi-agent documents inventory and interruption but no
hosted close action. Claude Code and unknown targets cannot safely inherit
either provider's assumptions. A shared policy therefore needs an explicit
surface map while keeping observed operational state, inventory, reuse, and
cleanup outcome separate.

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

- the compact controller-local ledger dimensions: session identity when
  available, role/scope, current operational state, observed reuse and
  inventory evidence when relevant, captured role result, and current cleanup
  outcome;
- the three target lifecycle capability classes
  (`automatic-close-supported`, `inventory-only`, and
  `cleanup-unavailable`);
- the four-surface capability map for Local Codex, Responses API Multi-agent,
  Claude Code, and unknown targets;
- target-honest conditional cleanup outcomes;
- cleanup gates before spawns;
- slot-limit recovery and one retry after cleanup or manual confirmation.

Responses API Multi-agent's documented hosted set is exactly `spawn_agent`,
`send_message`, `followup_task`, `wait_agent`, `interrupt_agent`, and
`list_agents`. Interruption stops an active turn without deleting its context;
it is not closure. No hosted close action is documented, so that surface is
`inventory-only`. Claude Code and unknown targets are classified only from
observed runtime capabilities. Local Codex low-level action names are claimed
only when the current runtime exposes them; model-visible requests to steer,
stop, or close tasks or threads are not proof of those actions.

The policy may record `closed=yes` only when the controller observes all three
session facts: stable identity, an exposed usable close operation, and a
successful close result. Capability class, waiting, interruption, completion,
inventory, or reuse cannot stand in for that evidence. Role-specific state is
captured before cleanup or supersession.

Supersession is a workflow/controller decision recorded with the captured role
result after required role-specific state is captured. It does not replace the
session's actual operational state or add another ledger dimension. Cleanup
eligibility reads that captured decision.

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
  automatic closure only after observing stable identity, an exposed usable
  close operation, and its successful result.
- Slot-limit failures are handled as orchestration resource exhaustion, with
  state reconstruction and one retry after cleanup or manual confirmation.
- Workflow-local exceptions remain explicit, so shared cleanup policy does not
  close sessions that a workflow still needs for same-session follow-up.
- The shared policy remains a compact controller procedure, not an
  event-sourced lifecycle engine, retention proof system, or duplicated
  consumer recovery algorithm.

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
