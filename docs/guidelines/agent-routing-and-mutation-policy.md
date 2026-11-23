# Agent Routing and Mutation Policy

This guideline is the current inventory owner for shared semantic agent routing
and mutation authority. The stable decision and rationale live in
[ADR-0027](../adr/adr-0027-semantic-agent-routing-and-mutation-authority.md).
The [agent spec](../specs/agents.md) owns the exact seven-role envelope,
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
owner of the seven semantic identities and their exact capability, Claude effort,
route effort, tools, sandbox, network, source default, and external default.
This policy consumes that envelope and records the complete route tuple for each active route;
it does not add a source-level Codex model or effort default.

## Review Route Contract

[ADR-0038](../adr/adr-0038-single-reviewer-targeted-verification.md) replaces
topical fanout with one independent review and conditional targeted verification. Both use
`reviewer`, frontier, source-immutable, external authority none, response-only,
zero handoffs and fresh history. Independent review uses ordinary `high` effort; targeted verification is the
sole explicit `high` targeted-verifier exception. The existing configured
capability binding, tools, sandbox, exact-pair checks, dispatch ritual, and
source-protection lifecycle are unchanged.

Independent review covers baseline quality/data safety and all applicable architecture, spec,
documentation, examples, platform and external-invocation checks. Targeted verification covers
only consequential, disputed or uncertain Blocking candidates. The
[workflow contract](../../skills/play-review/references/single-reviewer-contract.md)
owns exact triggers, terminals, evidence and failure handling. Missing required
coverage or verification cannot approve. Independent review owns the complete review coverage;
Semantic review context and all other active routes remain unchanged. Neither review child delegates
or mutates.

## Closed Classifications

### Cognitive demand and stance

The
[ADR cognitive-classification decision](../adr/adr-0027-semantic-agent-routing-and-mutation-authority.md#cognitive-classification-and-escalation-boundary)
owns the definitions of mechanical, bounded, synthesis, and inherited demand;
the independence of adversarial stance; and the issue #528 escalation boundary.
This policy consumes those classifications in the inventories below without
redefining their meanings or default routes.

Direct-child rows use their recorded capability and effort. Each route selects
an explicit model profile for rendering. Codex reviewer routes select balanced,
implementer routes select implementation, and architect and deep-reviewer routes
select frontier. An unresolved model binding blocks the route.
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

| Skill                              | Demand / stance         | Source authority | External authority | Material override / owner note                                                                     |
| ---------------------------------- | ----------------------- | ---------------- | ------------------ | -------------------------------------------------------------------------------------------------- |
| `branch-review`                    | inherited / adversarial | source-mutable   | none               | Mutable only in explicit fix mode                                                                  |
| `doc-gardening`                    | synthesis / adversarial | source-mutable   | none               | Audit immutable; selected fixes mutable                                                            |
| `git-workspace-cleanup`            | mechanical / normal     | source-mutable   | none               | Destructive local Git only after approval                                                          |
| `github-issue-priming`             | inherited / normal      | source-mutable   | external-mutable   | Worktree setup plus required auto-workflow handoff; downstream owns effects                        |
| `issue-batch-coordination`         | synthesis / normal      | source-immutable | external-mutable   | Event-driven coordination through owner reports and authorized provider notices; routing delegated |
| `issue-batch-routing`              | synthesis / normal      | source-immutable | external-mutable   | Explicit routing/messages/archival only; implementation and merge delegated                        |
| `issue-priming-workflow`           | synthesis / normal      | source-mutable   | external-mutable   | Auto flow may implement and create a gated PR; never merges                                        |
| `issue-slicing`                    | synthesis / normal      | source-immutable | none               | Draft only; live issue mutation excluded                                                           |
| `issue-worktree-setup`             | mechanical / normal     | source-mutable   | none               | Local worktree/ref mutation                                                                        |
| `linear-issue-priming`             | inherited / normal      | source-mutable   | external-mutable   | Worktree setup plus required auto-workflow handoff; Linear status excluded                         |
| `play-agent-dispatch`              | inherited / normal      | source-mutable   | none               | Each child independently classified; current integration may edit source                           |
| `play-brainstorm`                  | synthesis / normal      | source-immutable | none               | Named `.ephemeral` design only                                                                     |
| `play-branch-finish`               | synthesis / normal      | source-mutable   | external-mutable   | Chosen local or gated push/PR action                                                               |
| `play-debug`                       | bounded / normal        | source-mutable   | none               | Investigation immutable; verified fix mutable                                                      |
| `play-planning`                    | synthesis / normal      | source-immutable | none               | Named `.ephemeral` plan only                                                                       |
| `play-review-response`             | synthesis / adversarial | source-mutable   | external-mutable   | Fix/commit and gated provider closeout phases                                                      |
| `play-review`                      | synthesis / adversarial | source-immutable | none               | Named review artifacts only; never fixes/posts                                                     |
| `play-skill-authoring`             | synthesis / adversarial | source-mutable   | none               | Authoring edits source; pressure children immutable                                                |
| `play-subagent-execution`          | inherited / normal      | source-mutable   | none               | Task edits/commits; reviews immutable                                                              |
| `play-tdd`                         | inherited / normal      | source-mutable   | none               | Task-owned test and implementation edits                                                           |
| `play-validate-review-artifacts`   | mechanical / normal     | source-immutable | none               | Schema/path validation only                                                                        |
| `play-verification`                | bounded / adversarial   | source-immutable | none               | Runs commands and reports evidence                                                                 |
| `pr-authoring`                     | synthesis / normal      | source-immutable | none               | Returns title/body; wrapper owns GitHub effects                                                    |
| `pr-merge`                         | inherited / normal      | source-mutable   | external-mutable   | CI fix may commit; root owns PR edit/push/merge                                                    |
| `pr-review`                        | inherited / adversarial | source-mutable   | external-mutable   | Local review worktree plus approved GitHub effects                                                 |
| `report-devcanon-issue`            | synthesis / normal      | source-immutable | external-mutable   | Explicit confirmation authorizes issue creation/linking                                            |
| `spec-readiness-review`            | synthesis / adversarial | source-immutable | none               | Read-only findings/status                                                                          |
| `subagent-lifecycle`               | bounded / normal        | source-immutable | none               | Controller-local session hygiene                                                                   |
| `write-linear-project-description` | synthesis / normal      | source-immutable | external-mutable   | Apply mode updates selected Linear fields                                                          |
| `write-linear-project-update`      | synthesis / normal      | source-immutable | external-mutable   | Apply creates/updates the selected project update                                                  |
| `write-product-requirements`       | synthesis / normal      | source-mutable   | none               | Scoped product-requirements edits                                                                  |
| `write-product-spec`               | synthesis / normal      | source-mutable   | none               | Scoped behavior-spec edits                                                                         |
| `write-prose`                      | bounded / normal        | source-mutable   | none               | File mode is scoped; external writes forbidden                                                     |

## Direct-Child Route Inventory

The inventory defines the 15 active direct-child routes. Each row pairs a
stable kebab-case ID and anchor with a readable display name. The escalation
inventory links to these rows by ID. Use display names in prose and the exact
semantic ID for route lookup or serialized evidence. Editing a display name
leaves the ID, anchor and existing semantic-ID evidence valid.

Each source-immutable row is response-only unless it explicitly
declares a handoff. It uses the minimum source-immutable guard around the
existing response contract.

| ID                                                                                    | Surface and owner                                                               | Route                                                                                                                                                                                                          | Source-owner locator / summary (non-authoritative)                                                                            |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| <a id="issue-gate-assessment"></a>`issue-gate-assessment`                             | Issue gate assessment — `issue-priming-workflow` Phase 2                        | `assessor`, balanced/low, source-immutable                                                                                                                                                                     | Gate enum; terminal Phase 2 route                                                                                             |
| <a id="internal-research"></a>`internal-research`                                     | Internal research — `issue-priming-workflow` Phase 3                            | `investigator`, balanced/medium, source-immutable                                                                                                                                                              | Existing report headings; root synthesizes                                                                                    |
| <a id="external-research"></a>`external-research`                                     | External research — `issue-priming-workflow` Phase 3                            | `investigator`, balanced/medium, source-immutable, network-binding `dispatch-named`, evidence-qualifier `named-network`                                                                                        | Existing necessity/URL/headings; root synthesizes                                                                             |
| <a id="focused-specialist-dispatch"></a>`focused-specialist-dispatch`                 | Focused specialist dispatch — `play-agent-dispatch`                             | Resolve exactly one of the seven semantic roles before spawn; use its exact configured capability/effort and matching source default; declare scope/termination; external authority `none`                     | Source-immutable selection is response-only under B3; unresolved route blocks                                                 |
| <a id="combined-planning-review"></a>`combined-planning-review`                       | Combined planning review — `play-planning`                                      | `reviewer`, frontier/high, source-immutable                                                                                                                                                                    | One digest-bound result covers correctness and executability                                                                  |
| <a id="independent-review"></a>`independent-review`                                   | Independent review — `play-review` Phase 3                                      | `reviewer`, frontier/high, source-immutable                                                                                                                                                                    | Workflow-owned terminal disposition; controller aggregates completed findings                                                 |
| <a id="targeted-verification"></a>`targeted-verification`                             | Targeted verification — `play-review` Phase 5                                   | `reviewer`, frontier/high, source-immutable                                                                                                                                                                    | Workflow-owned terminal disposition; controller retains critic verdicts; no recursion                                         |
| <a id="skill-pressure-scenario"></a>`skill-pressure-scenario`                         | Skill pressure scenario — `play-skill-authoring`                                | `assessor`, balanced/low, source-immutable                                                                                                                                                                     | Existing scenario evidence; invalid evidence retested                                                                         |
| <a id="default-implementation"></a>`default-implementation`                           | Default implementation — `play-subagent-execution`                              | `implementer`, balanced/medium, source-mutable                                                                                                                                                                 | Existing status/snapshot; scoped commit                                                                                       |
| <a id="exact-task-execution"></a>`exact-task-execution`                               | Exact task execution — `play-subagent-execution`                                | `executor`, efficient/medium, source-mutable, selection-mode `inline-or-delegated`                                                                                                                             | Five guardrails; stop/reclassify on judgment                                                                                  |
| <a id="task-spec-review"></a>`task-spec-review`                                       | Task specification review — `play-subagent-execution` review routing            | `reviewer`, frontier/high, source-immutable                                                                                                                                                                    | Existing distinct prompt/same-head fix loop                                                                                   |
| <a id="task-quality-review"></a>`task-quality-review`                                 | Task quality review — `play-subagent-execution` review routing                  | `reviewer`, frontier/high, source-immutable                                                                                                                                                                    | Existing distinct prompt/provisional same-head loop                                                                           |
| <a id="whole-implementation-quality-review"></a>`whole-implementation-quality-review` | Whole-implementation quality review — `play-subagent-execution` Process step 10 | `reviewer`, frontier/high, source-immutable                                                                                                                                                                    | Whole-range prompt; narrow ADR-0016 skip; final fix/fresh-review or terminal-owner route                                      |
| <a id="ci-diagnosis-and-fix"></a>`ci-diagnosis-and-fix`                               | CI diagnosis and fix — `pr-merge` Step 4                                        | branch `diagnosis`: `investigator`, balanced/medium, source-immutable; branch `exact-fix`: `executor`, efficient/medium, source-mutable; branch `judgment-fix`: `implementer`, balanced/medium, source-mutable | Guard diagnosis before fix classification; mutable child commits only; root alone separately owns external-mutable push/merge |
| <a id="semantic-review-context"></a>`semantic-review-context`                         | Semantic review context — `play-review` Phase 2.25                              | `assessor`, balanced/low, source-immutable                                                                                                                                                                     | Response-only four-family summary; controller validates, cleans, maps, and continues                                          |

## Active combined planning route

[ADR-0039](../adr/adr-0039-combined-planning-review.md) records the accepted
replacement decision; the [planning owner](../../skills/play-planning/references/combined-review-contract.md)
owns detailed results, coverage, correction, failure and reassessment.

Combined planning review covers correctness and executability. It uses a
`reviewer`, frontier/high, source-immutable, external authority `none`, a
response-only result, zero handoffs, and fresh history with the configured
target binding. The route is opt-out with transition `none`. The retired D6
route stays absent from both inventories and provides no implicit PASS.

The same fresh independent combined planning review tuple also performs the planning owner's narrow
verification-only check of accepted-source declaration corrections. Explicit
mode and complete composite coverage/provenance distinguish current assurance
from historical semantic results. Verification consumes no semantic pass;
failed verification stops existing recovery without automatic redispatch.
This adds no route, role, authority or budget reset.

Exceptional planning specialists use the existing focused specialist dispatch declaration and source
role constraints, with the planning owner's bounded evidence-only scope. They
do not change combined planning review's pass budget or borrow targeted verification. Semantic review context ownership, independent review and targeted verification final-review
behavior, per-task and whole-implementation reviews, source guards, lifecycle and all other tuples/adoption states
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

| ID                                                                            | Adoption state | Transition |
| ----------------------------------------------------------------------------- | -------------- | ---------- |
| [`issue-gate-assessment`](#issue-gate-assessment)                             | opt-out        | none       |
| [`internal-research`](#internal-research)                                     | opt-out        | none       |
| [`external-research`](#external-research)                                     | opt-out        | none       |
| [`focused-specialist-dispatch`](#focused-specialist-dispatch)                 | opt-out        | none       |
| [`combined-planning-review`](#combined-planning-review)                       | opt-out        | none       |
| [`independent-review`](#independent-review)                                   | opt-out        | none       |
| [`targeted-verification`](#targeted-verification)                             | opt-out        | none       |
| [`skill-pressure-scenario`](#skill-pressure-scenario)                         | opt-out        | none       |
| [`default-implementation`](#default-implementation)                           | opt-out        | none       |
| [`exact-task-execution`](#exact-task-execution)                               | opt-out        | none       |
| [`task-spec-review`](#task-spec-review)                                       | opt-out        | none       |
| [`task-quality-review`](#task-quality-review)                                 | opt-out        | none       |
| [`whole-implementation-quality-review`](#whole-implementation-quality-review) | opt-out        | none       |
| [`ci-diagnosis-and-fix`](#ci-diagnosis-and-fix)                               | opt-out        | none       |
| [`semantic-review-context`](#semantic-review-context)                         | opt-out        | none       |

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
- the full Codex model produced by rendering the route's model profile;
- the exact independent route `reasoning_effort`;
- `fork_turns: "none"`; and
- a self-contained message that includes the task context and the route's
  authority plus source-skill-owned output and termination instructions.

The route's model profile resolves during rendering. At dispatch, the
controller consumes the resulting full target model and
must not derive a fresh Codex model or effort from source-agent Codex fields,
rediscover a source configuration, or read a sibling passive-runtime catalog
to replace the rendered binding. A missing, blank, unresolved, or mismatched
binding blocks before spawn; no alias, nearby or ambient model, effort change,
or fallback is permitted. The following routes allow compatible same-session
reuse within their existing limits:

- Default implementation for an original stable-task fix or within-scope continuation.
- CI diagnosis and fix for an unchanged stable branch and task.
- Independent review and targeted verification for bounded result correction under the
  [review recovery contract](../../skills/play-review/references/terminal-result-boundaries.md#routine-recovery).
  Reuse requires the same frozen candidate, scope, complete tuple, and
  independent reviewer. It cannot reopen a completed substantive judgment.

Every other route requires a fresh session. Task specification review, task
quality review, and whole-implementation quality review are one-shot.
After this route permission, the existing
lifecycle owner performs task-name allocation, follow-up, capture,
supersession, cleanup, slot recovery, and terminal model-capacity recovery;
this policy does not create a naming schema or lifecycle registry.

A follow-up for independent review, targeted verification, default implementation, or CI diagnosis and fix is permitted only under the route permission above,
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

### Focused Specialist Dispatch Declaration Obligation

This policy owns the focused specialist dispatch identity, exact seven-role
allowlist, controller declaration obligation, producer path
[`skills/play-agent-dispatch/SKILL.md`](../../skills/play-agent-dispatch/SKILL.md),
and current adoption record. The producer consumes this declaration contract.

Before spawning a focused specialist, issue one complete pre-spawn declaration.
Its controller-bound fields are exactly `route_id` (`focused-specialist-dispatch`), `target_id`, the
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
value or a thinking budget. A fresh Codex focused specialist dispatch model is the rendered full model from
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
the B3 routing boundary, a source-immutable focused specialist dispatch selection is response-only.

### Ordinary child failure disposition

After safe cleanup, existing unavailable or invalid-child behavior remains in
force. The five surfaces that need a minimum explicit disposition use this
table:

| Routes                                                                  | Ordinary unavailable, failed, malformed, or verification-rejected child after safe cleanup                                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Generic focused specialist (focused specialist dispatch)                | Let already-started siblings settle and clean up, integrate no results, and return the failed domain plus successful summaries to the controller |
| Per-task reviews (per-task reviews)                                     | Keep the task incomplete and return the existing execution `BLOCKED` state with the failed review named; no verdict passes                       |
| Final whole-implementation review (whole-implementation quality review) | Keep final review incomplete and return `BLOCKED` to the owning caller or direct/manual terminal-status path; do not enter branch finish         |
| CI diagnosis (CI diagnosis and fix)                                     | Keep retry count unchanged, perform no fix/push/merge, and report the failed check plus manual-resolution recommendation                         |
| Semantic review context (semantic review context)                       | Stop before shared-context construction and topical fanout; do not use controller summarization, partial context, or the rejected result         |

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

## Codex specialist routing

The portable dispatch procedure lives in
[focused specialist selection](../../skills/play-agent-dispatch/SKILL.md#risk-based-specialist-selection).
This policy owns role/route selection; the source skill owns its invocation.

Allocation decision: [ADR-0043](../adr/adr-0043-risk-based-specialist-review.md).
The route table records Codex defaults. On Claude, per-task and whole-implementation reviews retain
`deep-reviewer`, frontier capability and its catalog Claude effort; other
existing routes retain their behavior. The
[agent spec](../specs/agents.md#codex-specialist-roles) owns model allocation
and role responsibilities.

Use the balanced Codex model at high effort for ordinary design and review, including task specification review, task quality review and whole-implementation quality review. Keep
those gates, their reduced-review paths, finding disposition, source guards and
existing lifecycle rules. Use the implementation Codex model at medium effort for implementation and repairs.

Request frontier Codex specialist attention at high effort when actual scope or code changes pose
material risk to:

- architectural contracts, module ownership, persisted formats or core invariants;
- shared state, cancellation, ordering, atomicity or task lifetime;
- authentication, authorization, trust boundaries, secrets or command execution;
- a consequential judgment still unresolved after reasonable evidence gathering.

Record a short reason naming the affected guarantee, consequence and question.
Keywords, file count or adding an async function alone do not justify escalation.
Missing evidence, tools or authority must be addressed by their owner; a stronger
model does not replace them.

For known design risk, consult the architect before implementation and review
the resulting design independently. For implementation risk found during review,
request focused deep review with relevant code, design evidence and the unresolved
question. Assess actual scope before work and the actual diff during review;
do not depend solely on the ordinary reviewer's findings. Reuse applicable
specialist evidence for the same unchanged candidate and question instead of
repeating it at every gate; required fresh ordinary reviews still run.

Use existing focused specialist dispatch and lifecycle procedures, with explicit
role/model selection. Focused specialist dispatch includes architect on Codex and rejects it on Claude;
do not introduce S1–S3 routes, a new retry budget framework or a rollout state
machine. Cross-role specialist selection is a new focused task, not a same-role
capability retry, and cannot bypass current same-role escalation restrictions.
Workflow owners retain completion and fix-loop authority. A required specialist
result that is unavailable or inconclusive leaves the affected decision unresolved;
failed checks and unresolved blockers cannot be approved by model choice.

The [Kiki practical trial](../specs/workflow-specialist-pilot.md) supplies supporting
feedback on detection, repairs and unnecessary Astra usage. It is not a mandatory
publication or installation gate. Normal review, verification and authorization
requirements continue to apply.
