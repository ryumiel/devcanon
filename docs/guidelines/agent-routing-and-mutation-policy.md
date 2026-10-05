# Agent Routing and Mutation Policy

This guideline is the current inventory owner for shared semantic agent routing
and mutation authority. The stable decision and rationale live in
[ADR-0027](../adr/adr-0027-semantic-agent-routing-and-mutation-authority.md).
The [agent spec](../specs/agents.md) owns the exact six-role envelope,
source-level model omission, and observable target fields. This policy owns the
complete fresh-Codex route tuple and route-level continuity permission. The AFDS
workflow spec references that routing owner and owns observable dispatch and
guard behavior. Source skills retain task-local prompts, phase mechanics,
route-local output, failure, and termination.

This contract governs the current semantic routes. ADR-0027 retires its
separate runtime acceptance and deployment gate; ordinary repository checks
verify the configured baseline. Live dispatch still requires the exact route
declaration and retains the existing unavailable/rejected-pair behavior.

## Role Envelope Owner

The [agent spec](../specs/agents.md#semantic-role-catalog) is the single
owner of the six semantic identities and their exact capability, Claude effort,
route effort, tools, sandbox, network, source default, and external default.
This policy consumes that envelope and records the complete route tuple for each active route;
it does not add a source-level Codex model or effort default.

## Review Route Contract

[ADR-0038](../adr/adr-0038-single-reviewer-targeted-verification.md) replaces
topical fanout with one independent D7 and conditional targeted D10. Both use
`reviewer`, frontier, source-immutable, external authority none, response-only,
zero handoffs and fresh history. D7 uses ordinary `medium` effort; D10 is the
sole explicit `high` targeted-verifier exception. The existing configured
capability binding, tools, sandbox, exact-pair checks, dispatch ritual, and
source-protection lifecycle are unchanged.

D7 covers baseline quality/data safety and all applicable architecture, spec,
documentation, examples, platform and external-invocation checks. D10 covers
only consequential, disputed or uncertain Blocking candidates. The
[workflow contract](../../skills/play-review/references/single-reviewer-contract.md)
owns exact triggers, terminals, evidence and failure handling. Missing required
coverage or verification cannot approve. D7 owns the complete review coverage;
D18 and all other active routes remain unchanged. Neither review child delegates
or mutates.

## Closed Classifications

### Cognitive demand and stance

The
[ADR cognitive-classification decision](../adr/adr-0027-semantic-agent-routing-and-mutation-authority.md#cognitive-classification-and-escalation-boundary)
owns the definitions of mechanical, bounded, synthesis, and inherited demand;
the independence of adversarial stance; and the issue #528 escalation boundary.
This policy consumes those classifications in the inventories below without
redefining their meanings or default routes.

Direct-child rows use their exact recorded capability and effort pair. An
unresolved route blocks rather than escalating by guesswork. Capability resolves
only the full native model unless a target-specific role model override is
explicitly recorded; route effort is explicit and independent. Codex reviewer
routes use the literal role override `gpt-6.1-sol`; deep-reviewer continues to
use the frontier binding.
The executor retains `medium` for Codex. Claude executor dispatch omits named
effort for Haiku, as specified by the agent role catalog; this omission does
not change the recorded Codex route tuple.

### Mutation axes

Source authority is exactly one of:

- `source-immutable`: inspect and run permitted commands; write only one
  dispatch-named direct-child `.ephemeral` handoff; do not change durable
  source, tests, configuration, or documentation.
- `source-mutable`: alter only dispatch-authorized durable workspace paths.

External authority is exactly one of:

- `none`: perform no external-system mutation.
- `external-mutable`: permit only the owning root/controller to perform a
  separately named and authorized mutation in GitHub, Linear, Notion, or
  another external system.

The two axes are recorded separately. Every semantic child route has external
authority `none`; no semantic child may receive `external-mutable` authority.
Only the owning root/controller may hold that separately authorized authority,
regardless of whether its source work is mutable or immutable. Never infer one
axis from the other.

## Complete Skill Inventory

This table contains every current source skill exactly once. Phase
qualifications belong in the final column; the source and external columns use
only the closed values above. An `external-mutable` entry records authority of
the owning root/controller for that workflow, never authority of a semantic
child role.

| Skill                              | Demand / stance         | Source authority | External authority | Material override / owner note                                              |
| ---------------------------------- | ----------------------- | ---------------- | ------------------ | --------------------------------------------------------------------------- |
| `branch-review`                    | inherited / adversarial | source-mutable   | none               | Mutable only in explicit fix mode                                           |
| `doc-gardening`                    | synthesis / adversarial | source-mutable   | none               | Audit immutable; selected fixes mutable                                     |
| `git-workspace-cleanup`            | mechanical / normal     | source-mutable   | none               | Destructive local Git only after approval                                   |
| `github-issue-priming`             | inherited / normal      | source-mutable   | external-mutable   | Worktree setup plus required auto-workflow handoff; downstream owns effects |
| `issue-batch-coordination`         | synthesis / normal      | source-immutable | external-mutable   | Coordination and authorized host watchdog controls; routing delegated       |
| `issue-batch-routing`              | synthesis / normal      | source-immutable | external-mutable   | Explicit routing/messages/archival only; implementation and merge delegated |
| `issue-priming-workflow`           | synthesis / normal      | source-mutable   | external-mutable   | Auto flow may implement and create a gated PR; never merges                 |
| `issue-slicing`                    | synthesis / normal      | source-immutable | none               | Draft only; live issue mutation excluded                                    |
| `issue-worktree-setup`             | mechanical / normal     | source-mutable   | none               | Local worktree/ref mutation                                                 |
| `linear-issue-priming`             | inherited / normal      | source-mutable   | external-mutable   | Worktree setup plus required auto-workflow handoff; Linear status excluded  |
| `play-agent-dispatch`              | inherited / normal      | source-mutable   | none               | Each child independently classified; current integration may edit source    |
| `play-brainstorm`                  | synthesis / normal      | source-immutable | none               | Named `.ephemeral` design only                                              |
| `play-branch-finish`               | synthesis / normal      | source-mutable   | external-mutable   | Chosen local or gated push/PR action                                        |
| `play-debug`                       | bounded / normal        | source-mutable   | none               | Investigation immutable; verified fix mutable                               |
| `play-planning`                    | synthesis / normal      | source-immutable | none               | Named `.ephemeral` plan only                                                |
| `play-review-response`             | synthesis / adversarial | source-mutable   | external-mutable   | Fix/commit and gated provider closeout phases                               |
| `play-review`                      | synthesis / adversarial | source-immutable | none               | Named review artifacts only; never fixes/posts                              |
| `play-skill-authoring`             | synthesis / adversarial | source-mutable   | none               | Authoring edits source; pressure children immutable                         |
| `play-subagent-execution`          | inherited / normal      | source-mutable   | none               | Task edits/commits; reviews immutable                                       |
| `play-tdd`                         | inherited / normal      | source-mutable   | none               | Task-owned test and implementation edits                                    |
| `play-validate-review-artifacts`   | mechanical / normal     | source-immutable | none               | Schema/path validation only                                                 |
| `play-verification`                | bounded / adversarial   | source-immutable | none               | Runs commands and reports evidence                                          |
| `pr-authoring`                     | synthesis / normal      | source-immutable | none               | Returns title/body; wrapper owns GitHub effects                             |
| `pr-merge`                         | inherited / normal      | source-mutable   | external-mutable   | CI fix may commit; root owns PR edit/push/merge                             |
| `pr-review`                        | inherited / adversarial | source-mutable   | external-mutable   | Local review worktree plus approved GitHub effects                          |
| `report-devcanon-issue`            | synthesis / normal      | source-immutable | external-mutable   | Explicit confirmation authorizes issue creation/linking                     |
| `spec-readiness-review`            | synthesis / adversarial | source-immutable | none               | Read-only findings/status                                                   |
| `subagent-lifecycle`               | bounded / normal        | source-immutable | none               | Controller-local session hygiene                                            |
| `write-linear-project-description` | synthesis / normal      | source-immutable | external-mutable   | Apply mode updates selected Linear fields                                   |
| `write-linear-project-update`      | synthesis / normal      | source-immutable | external-mutable   | Apply creates/updates the selected project update                           |
| `write-product-requirements`       | synthesis / normal      | source-mutable   | none               | Scoped product-requirements edits                                           |
| `write-product-spec`               | synthesis / normal      | source-mutable   | none               | Scoped behavior-spec edits                                                  |
| `write-prose`                      | bounded / normal        | source-mutable   | none               | File mode is scoped; external writes forbidden                              |

## Direct-Child Route Inventory

The **active route set** is D1–D5, D7 and D10–D18. Every inventory and
normative route consumer uses exactly these 15 routes.

The row IDs and source anchors are inventory keys, not a marker or annotation
language. Each source-immutable row is response-only unless it explicitly
declares a handoff. It uses the minimum source-immutable guard around the
existing response contract.

| ID  | Surface and owner                                                                     | Route                                                                                                                                                                                                          | Source-owner locator / summary (non-authoritative)                                                                            |
| --- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| D1  | Issue gate — `issue-priming-workflow` Phase 2                                         | `assessor`, balanced/low, source-immutable                                                                                                                                                                     | Gate enum; terminal Phase 2 route                                                                                             |
| D2  | Internal research — `issue-priming-workflow` Phase 3                                  | `investigator`, balanced/medium, source-immutable                                                                                                                                                              | Existing report headings; root synthesizes                                                                                    |
| D3  | External research — `issue-priming-workflow` Phase 3                                  | `investigator`, balanced/medium, source-immutable, network-binding `dispatch-named`, evidence-qualifier `named-network`                                                                                        | Existing necessity/URL/headings; root synthesizes                                                                             |
| D4  | Focused specialist — `play-agent-dispatch`                                            | Resolve exactly one of the six semantic roles before spawn; use its exact configured capability/effort and matching source default; declare scope/termination; external authority `none`                       | Source-immutable selection is response-only under B3; unresolved route blocks                                                 |
| D5  | Combined planning review — `play-planning`                                            | `reviewer`, frontier/high, source-immutable                                                                                                                                                                    | One digest-bound result covers correctness and executability                                                                  |
| D7  | Complete independent review — `play-review` Phase 3                                   | `reviewer`, frontier/high, source-immutable                                                                                                                                                                    | Workflow-owned terminal disposition; controller aggregates completed findings                                                 |
| D10 | Targeted verifier — `play-review` Phase 5                                             | `reviewer`, frontier/high, source-immutable                                                                                                                                                                    | Workflow-owned terminal disposition; controller retains critic verdicts; no recursion                                         |
| D11 | Skill pressure scenario — `play-skill-authoring`                                      | `assessor`, balanced/low, source-immutable                                                                                                                                                                     | Existing scenario evidence; invalid evidence retested                                                                         |
| D12 | Default implementation — `play-subagent-execution`                                    | `implementer`, balanced/medium, source-mutable                                                                                                                                                                 | Existing status/snapshot; scoped commit                                                                                       |
| D13 | Exact task — `play-subagent-execution`                                                | `executor`, efficient/medium, source-mutable, selection-mode `inline-or-delegated`                                                                                                                             | Five guardrails; stop/reclassify on judgment                                                                                  |
| D14 | Per-task spec review — `play-subagent-execution` review routing                       | `deep-reviewer`, frontier/high, source-immutable                                                                                                                                                               | Existing distinct prompt/same-head fix loop                                                                                   |
| D15 | Per-task quality review — `play-subagent-execution` review routing                    | `deep-reviewer`, frontier/high, source-immutable                                                                                                                                                               | Existing distinct prompt/provisional same-head loop                                                                           |
| D16 | Final whole-implementation quality review — `play-subagent-execution` Process step 10 | `deep-reviewer`, frontier/high, source-immutable                                                                                                                                                               | Whole-range prompt; narrow ADR-0016 skip; final fix/fresh-review or terminal-owner route                                      |
| D17 | CI diagnosis/fix — `pr-merge` Step 4                                                  | branch `diagnosis`: `investigator`, balanced/medium, source-immutable; branch `exact-fix`: `executor`, efficient/medium, source-mutable; branch `judgment-fix`: `implementer`, balanced/medium, source-mutable | Guard diagnosis before fix classification; mutable child commits only; root alone separately owns external-mutable push/merge |
| D18 | Semantic review context — `play-review` Phase 2.25                                    | `assessor`, balanced/low, source-immutable                                                                                                                                                                     | Response-only four-family summary; controller validates, cleans, maps, and continues                                          |

## Active combined planning route

[ADR-0039](../adr/adr-0039-combined-planning-review.md) records the accepted
replacement decision; the [planning owner](../../skills/play-planning/references/combined-review-contract.md)
owns detailed results, coverage, correction, failure and reassessment.

D5 is the combined correctness/executability review. Its
tuple remains `reviewer`, frontier/high, source-immutable, external authority
`none`, response-only, zero handoffs, fresh history with the configured target
binding. D6 is retired, never reassigned or interpreted as implicit PASS. The
active set becomes D1–D5, D7 and D10–D18 (15 routes); remove D6 from both the
active inventory and escalation adoption inventory together. D5 remains opt-out
with transition `none`. No new semantic agent or target override is needed.

Exceptional planning specialists use the existing D4 declaration and source
role constraints, with the planning owner's bounded evidence-only scope. They
do not change D5's pass budget or borrow D10. D18 ownership, D7/D10 final-review
behavior, D14–D16, source guards, lifecycle and all other tuples/adoption states
remain unchanged. Rendering and migration checks must reconcile the complete
active inventory on both targets before activation.

## Capability Escalation Adoption Inventory

The Direct-Child Route Inventory and the adoption table below are the single
authoritative representation of current route identity, tuple, authority, and
adoption state. The final inventory column is a source-owner locator and summary,
not a second output or termination authority. They do not authorize workflow
evolution: workflow-local prompts, output, failure, and termination remain owned
by the applicable skill and workflow sources.

The shared [`subagent-lifecycle`](../../skills/subagent-lifecycle/SKILL.md)
procedure owns eligibility, declaration, support, invariants, evidence, budget,
and terminal semantics. This table is the authoritative current adoption record;
it does not replace any route's workflow-local dispatch or termination owner.

| ID  | Adoption state | Transition |
| --- | -------------- | ---------- |
| D1  | opt-out        | none       |
| D2  | opt-out        | none       |
| D3  | opt-out        | none       |
| D4  | opt-out        | none       |
| D5  | opt-out        | none       |
| D7  | opt-out        | none       |
| D10 | opt-out        | none       |
| D11 | opt-out        | none       |
| D12 | opt-out        | none       |
| D13 | opt-out        | none       |
| D14 | opt-out        | none       |
| D15 | opt-out        | none       |
| D16 | opt-out        | none       |
| D17 | opt-out        | none       |
| D18 | opt-out        | none       |

`adopt`, `specialize`, and `opt-out` remain the conceptual closed adoption
states. Current parser validation is deliberately fail-closed: it accepts only
an `opt-out` row with literal transition `none`. Until an authorized
implementation defines and validates the complete exact declaration grammar,
`adopt` and `specialize` rows are unsupported and rejected rather than treated
as a marker language or partial declaration.

Task-specific prompts, schemas, skip criteria, retries, fallbacks, and
termination remain owned by the source skill. A route may not collapse two
distinct sessions just because they share a semantic agent.

## Fresh Codex Route Contract

This policy is the sole owner of the complete fresh-Codex spawn contract for
the active route set. For every fresh child, the controller validates and supplies all of the
following from the selected policy route and its Codex-bound rendered binding:

- a lifecycle-owned, route-local `task_name`;
- the selected semantic `agent_type`;
- the rendered full Codex model produced from the route capability, or the
  explicitly recorded Codex reviewer override `gpt-6.1-sol`;
- the exact independent route `reasoning_effort`;
- `fork_turns: "none"`; and
- a self-contained message that includes the task context and the route's
  authority plus source-skill-owned output and termination instructions.

The source route capability selects its binding only during rendering.
Reviewer routes instead declare the literal Codex override `gpt-6.1-sol`,
matching the role source. At dispatch, either binding is already a literal
full target model. The controller
must not derive a fresh Codex model or effort from source-agent Codex fields,
rediscover a source configuration, or read a sibling passive-runtime catalog
to replace the rendered binding. A missing, blank, unresolved, or mismatched
binding blocks before spawn; no alias, nearby or ambient model, effort change,
or fallback is permitted. Compatible same-session reuse is permitted only for D12's
original stable-task fix or within-scope continuation and D17's unchanged stable
branch/task. Every other route in the active route set is fresh-only; D14, D15, and D16 are
explicitly one-shot fresh reviewers. After this route permission, the existing
lifecycle owner performs task-name allocation, follow-up, capture,
supersession, cleanup, slot recovery, and terminal model-capacity recovery;
this policy does not create a naming schema or lifecycle registry.

A follow-up for D12 or D17 is permitted only under the route permission above,
when the stable task identity and complete tuple are unchanged, and the existing
session remains compatible. It supplies incremental context and the
verified-auto attestation when applicable, without configuration overrides. A
changed tuple or task identity requires a complete fresh session; the lifecycle
owner performs the transition mechanics.

If native Codex rejects the selected model/effort configuration, report exactly
`model=<rendered-full-model> effort=<route-effort>` and use the route-local
unavailable or `BLOCKED` terminal. No fallback, alias, effort change, retry,
escalation, or role substitution is permitted. Slot-limit creation failures and
an already-created child's explicit terminal model-capacity failure are distinct;
the lifecycle owner owns their separate bounded recovery procedures.

The installed
[`play-agent-dispatch` dispatch-ritual usage](../../skills/play-agent-dispatch/references/dispatch-ritual-usage.md)
is the installed projection that documents this generic dispatch ritual for
every route-owning skill; it consumes this contract and the lifecycle owner's
allocation rule and does not become a second owner of either.

### D4 Declaration Obligation

This policy is the sole D4 route owner: it owns the D4 route identity, exact
six-role allowed set, controller declaration obligation, producer path
[`skills/play-agent-dispatch/SKILL.md`](../../skills/play-agent-dispatch/SKILL.md),
and current D4 adoption record. The producer consumes this obligation; it does
not define a peer route or role registry.

Before D4 spawns, the controller must issue one complete pre-spawn declaration.
Its controller-bound fields are exactly `route_id` (`D4`), `target_id`, the
planner-selected `selected_role_id`, `scope`, `termination`, `context_ref`, and
`approval_ref`; `termination` includes the declared output behavior. The
[agent spec](../specs/agents.md) is the sole semantic-role catalog and
role-envelope owner. For the exact selected role and target, it derives
`capability`, route `effort`, `source_authority`,
`external_authority`, ordered duplicate-free `claude_tools`, `codex_sandbox`,
and `default_network`. Effort selection is target-specific: Codex uses the
catalog's route effort and Claude uses its Claude effort. For a Claude
`executor`, `effort` must be absent from both the declaration and native spawn
arguments; validate this required absence against the role catalog. All Codex
roles (including executor at `medium`) and the other five Claude roles still
require their exact catalog effort. Do not replace omission with an ambient
value or a thinking budget. A fresh Codex D4 model is the rendered full model from
the selected route capability's Codex-bound binding; its effort is the
independent selected route effort. The selected source must match the selected
role's capability before that render-time binding is used; a capability-less or
mismatched source fails that parity check rather than entering model resolution.
Source-level explicit-null suppression remains a source-to-render contract and
does not override the fresh-route tuple. The controller does not reload source
configuration or use the sibling passive runtime to supply this binding.

`agents/*.yaml` are governed declarations/instances and parity inputs, never
peer semantic authorities. Cognitive demand and stance remain planner
classification inputs only, not declaration fields or authority. Missing
required, unresolved, unknown, nearby, ambient, or mismatched controller-bound
or owner-derived values block before spawn. The required Claude-executor effort
omission above is the sole exception to field presence; supplying effort for
that selection also blocks. No other declaration field is optional or may be
inferred from the child, parent, workflow, or runtime environment. Under
the B3 routing boundary, a source-immutable D4 selection is response-only.

### Ordinary child failure disposition

After safe cleanup, existing unavailable or invalid-child behavior remains in
force. The five surfaces that need a minimum explicit disposition use this
table:

| Routes                                  | Ordinary unavailable, failed, malformed, or verification-rejected child after safe cleanup                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Generic focused specialist (D4)         | Let already-started siblings settle and clean up, integrate no results, and return the failed domain plus successful summaries to the controller |
| Per-task reviews (D14-D15)              | Keep the task incomplete and return the existing execution `BLOCKED` state with the failed review named; no verdict passes                       |
| Final whole-implementation review (D16) | Keep final review incomplete and return `BLOCKED` to the owning caller or direct/manual terminal-status path; do not enter branch finish         |
| CI diagnosis (D17)                      | Keep retry count unchanged, perform no fix/push/merge, and report the failed check plus manual-resolution recommendation                         |
| Semantic review context (D18)           | Stop before shared-context construction and topical fanout; do not use controller summarization, partial context, or the rejected result         |

Other routes retain their current gate/revision, partial research, missing
topical, unverified critic, or fresh-scenario behavior. Only detected source
mutation or cleanup failure is a guard-integrity terminal condition. An owning
workflow may still return its ordinary recoverable failure or `BLOCKED` state.

## Referenced Contracts

- The [agent spec](../specs/agents.md) owns the exact role envelope, canonical
  rendered example, ordinary render checks, and live-dispatch availability
  boundaries.
- The [AFDS workflow spec](../specs/afds-workflow-routing.md) owns observable
  route resolution, source-immutability guard ordering, valid handoff example,
  and failure routing.
- [ADR-0027](../adr/adr-0027-semantic-agent-routing-and-mutation-authority.md)
  owns the stable role decision, minimum guard rationale, retirement of the
  runtime acceptance/deployment gate, historical trial evidence, and explicit
  exclusions.
- Each route-owning source skill owns its task-local prompt, output, failure,
  and termination contract. The Direct-Child Route Inventory's final column is
  only its locator/summary.

## See Also

- [Agent source schema](../specs/agents.md)
- [AFDS workflow routing and evidence behavior](../specs/afds-workflow-routing.md)
- [Agent authoring guide](agent-authoring-guide.md)
- [Code review guideline](code-review-guideline.md)
- [ADR-0013: Path-Based Phase-Artifact Handoff](../adr/adr-0013-path-based-phase-artifact-handoff.md)
- [ADR-0016: Single-Task Auto Final-Review Carve-Out](../adr/adr-0016-single-task-auto-final-review-carve-out.md)
- [ADR-0024: Shared Passive Runtime Support Bundle](../adr/adr-0024-shared-support-skill-runtime.md)
- [ADR-0026: Replace Model Tiers with Capability Profiles](../adr/adr-0026-capability-profiles.md)
