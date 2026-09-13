# Dispatch ritual usage

## Role

Documents the generic fresh-Codex dispatch ritual that every route-owning
skill follows for its fixed D1-D18 route or planner-selected D4 route: resolve
the Codex-bound model binding, validate the complete tuple, allocate the
route-local `task_name`, freeze one self-contained prompt, capture, create
exactly one fresh child, verify, clean up, and only then integrate. Load it
from the installed `play-agent-dispatch` bundle at the dispatch site, before
that route's capture.

## Ownership

This reference owns only the generic ritual order and its blocking rule. It
consumes, and neither restates nor overrides, these owners:

- The shared agent routing policy owns the D1-D18 route inventory, the
  complete fresh-Codex tuple fields, and the D4 declaration obligation.
- `subagent-lifecycle` owns the controller ledger, `<instance_ordinal>` and
  `task_name` allocation, configuration continuity, the cleanup gate,
  slot-limit recovery, and native-rejection mechanics.
- Each consuming skill owns its route values (semantic role, capability, model
  marker, effort, authority, and prompt name), its prompt inputs, its literal
  `Codex.spawn_agent({...})` block, and its task-local output, failure, and
  termination contract. This reference hosts no spawn block.
- Each consuming skill's source-immutability usage owns the guard helper's
  invocation, inputs, outputs, and refusals; the skill owns its guard
  lifecycle obligations and disposition.

## Inputs

The dispatch site supplies one row per route before the ritual starts: route
ID, `agent_type` (the semantic role), capability, the Codex-bound model marker
(`<ROUTE>_MODEL`, already rendered to the literal full Codex model for that
capability), independent `reasoning_effort`, `source_authority`, and the prompt
name. Every route has `external_authority: none` and zero handoffs unless the
owning skill explicitly declares a handoff.

## Ritual

Keep this order exact for every fresh child.

1. Resolve the model binding. The route's model marker is the literal full
   Codex model produced from the route capability during rendering; the
   independent route effort is never derived from it. A missing, blank,
   unresolved, or mismatched marker blocks before capture or spawn. Do not
   search a source checkout, use a sibling runtime or passive runtime catalog,
   or select an alias, nearby, or ambient model.
2. Validate the complete tuple before capture: semantic role; source
   capability parity with that role, where a capability-less or mismatched
   source fails before model resolution; nonblank resolved full model;
   independent `reasoning_effort` taken from the route and never from the
   capability, an ambient runtime, an alias, or inherited conversation;
   `source_authority`; `external_authority: none`; the handoff count; every
   prompt input; expected output; and termination. Any missing, unresolved,
   unknown, nearby, ambient, or mismatched value blocks before capture or
   spawn. No field is optional, and the child never fills or discovers a tuple
   field.
3. Allocate the route-local `task_name` as `d<N>_<instance_ordinal>` under the
   `subagent-lifecycle` fresh-allocation rule and record the pending ledger
   row. A pending row is not spawn authority.
4. Freeze one self-contained prompt. It names the repository root, exact
   scope, authorized durable paths or the response-only constraint, every
   guarded artifact or context path, expected output, termination, and each
   dispatch constraint the route requires. It relies on no inherited turns.
5. For a source-immutable route, capture the source-immutability baseline
   before spawn with the consuming skill's own guard helper and retain the
   returned baseline path in the controller. Capture failure prevents the
   spawn.
6. Create exactly one fresh child with `Codex.spawn_agent`, passing
   `task_name`, `agent_type`, `model`, `reasoning_effort`, `fork_turns`, and
   `message` in that order. `fork_turns: "none"` is mandatory: no child
   inherits conversation history. Capture only the child's raw terminal
   response and status.
7. For a source-immutable route, verify before semantic validation or
   consumption, and clean up the exact retained baseline after successful
   verification; every post-capture terminal branch attempts exact cleanup.
   For every route, validate and retain the response in controller memory,
   then integrate it only after any required cleanup succeeds, under the
   consuming skill's existing integration, verification, and lifecycle policy.

## Native rejection

If native Codex rejects the requested pair, report the exact
`model=<resolved full model> effort=<route effort>`, complete the required
cleanup, and take the consuming skill's existing unavailable or blocked
terminal for that route. Do not retry, select an alias, change effort,
escalate, or substitute a role.

## Workflow boundary

The dispatch site owns route values, prompt inputs, disposition, and
continuation. [Play agent dispatch workflow context](../SKILL.md) owns the D4
declaration and focused-specialist integration.
