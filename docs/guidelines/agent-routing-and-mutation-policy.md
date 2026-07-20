# Agent Routing and Mutation Policy

This guideline is the current inventory owner for shared semantic agent routing
and mutation authority. The stable decision and rationale live in
[ADR-0027](../adr/adr-0027-semantic-agent-routing-and-mutation-authority.md).
The [agent spec](../specs/agents.md) owns the exact six-role envelope and
observable target fields. The AFDS workflow spec owns observable dispatch and
guard behavior. Source skills retain task-local prompts, phase mechanics,
fallbacks, and termination.

This is a target contract, not a claim that every source-agent, skill, runtime,
test, or generated-output migration has already landed. Deployment remains
blocked until the ADR's complete acceptance gate passes.

## Role Envelope Owner

The [agent spec](../specs/agents.md#semantic-role-catalog) is the single
owner of the six semantic identities and their exact capability, Claude effort,
Codex effort, tools, sandbox, network, source default, and external default.
This policy does not repeat that envelope. Its matrices below reference the
spec-owned roles and record only skill- and route-specific classification.

## Closed Classifications

### Cognitive demand and stance

The
[ADR cognitive-classification decision](../adr/adr-0027-semantic-agent-routing-and-mutation-authority.md#cognitive-classification-and-escalation-boundary)
owns the definitions of mechanical, bounded, synthesis, and inherited demand;
the independence of adversarial stance; and the issue #528 escalation boundary.
This policy consumes those classifications in the inventories below without
redefining their meanings or default routes.

Direct-child rows use their exact recorded capability and effort pair. An
unresolved route blocks rather than escalating by guesswork.

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
| `devcanon-runtime`                 | mechanical / normal     | source-mutable   | none               | Caller-bounded deterministic local mechanics                                |
| `doc-gardening`                    | synthesis / adversarial | source-mutable   | none               | Audit immutable; selected fixes mutable                                     |
| `git-workspace-cleanup`            | mechanical / normal     | source-mutable   | none               | Destructive local Git only after approval                                   |
| `github-issue-priming`             | inherited / normal      | source-mutable   | external-mutable   | Worktree setup plus required auto-workflow handoff; downstream owns effects |
| `issue-batch-routing`              | synthesis / normal      | source-immutable | external-mutable   | Routing/messages/archival only; implementation and merge delegated          |
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

The row IDs and source anchors are inventory keys, not a marker or annotation
language. Each source-immutable row is response-only unless it explicitly
declares a handoff. It uses the minimum source-immutable guard around the
existing response contract.

| ID  | Surface and owner                                                                       | Route                                                                                                                                                                                                      | Existing output / termination                                                                                                 |
| --- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| D1  | Issue gate — `issue-priming-workflow` Phase 2                                           | `assessor`, balanced/medium, source-immutable                                                                                                                                                              | Gate enum; terminal Phase 2 route                                                                                             |
| D2  | Internal research — issue priming Phase 3                                               | `investigator`, balanced/high, source-immutable                                                                                                                                                            | Existing report headings; root synthesizes                                                                                    |
| D3  | External research — issue priming Phase 3                                               | `investigator`, balanced/high, source-immutable, network-binding `dispatch-named`, evidence-qualifier `named-network`                                                                                      | Existing necessity/URL/headings; root synthesizes                                                                             |
| D4  | Focused specialist — `play-agent-dispatch`                                              | Resolve exactly one of the six semantic roles before spawn; use its exact configured capability/effort and matching source default; declare scope/termination; external authority `none`                   | Source-immutable selection is response-only under B3; unresolved route blocks                                                 |
| D5  | Plan review — `play-planning`                                                           | `reviewer`, frontier/high, source-immutable                                                                                                                                                                | Distinct digest-bound PASS/FAIL; join paired results for one digest                                                           |
| D6  | Executability review — `play-planning`                                                  | `reviewer`, frontier/high, source-immutable                                                                                                                                                                | Distinct digest-bound PASS/FAIL; join paired results for one digest                                                           |
| D7  | Code-quality topical — `play-review` Phase 3                                            | `reviewer`, frontier/high, source-immutable                                                                                                                                                                | Existing findings; controller aggregates                                                                                      |
| D8  | Architecture topical — `play-review` Phase 3                                            | `reviewer`, frontier/high, source-immutable                                                                                                                                                                | Existing triggered findings; controller aggregates                                                                            |
| D9  | Spec topical — `play-review` Phase 3                                                    | `reviewer`, frontier/high, source-immutable                                                                                                                                                                | Existing triggered findings; controller aggregates                                                                            |
| D10 | Critic — `play-review` Phase 5                                                          | `deep-reviewer`, frontier/xhigh, source-immutable                                                                                                                                                          | Existing finding verdicts; no recursion                                                                                       |
| D11 | Skill pressure scenario — `play-skill-authoring`                                        | `assessor`, balanced/medium, source-immutable                                                                                                                                                              | Existing scenario evidence; invalid evidence retested                                                                         |
| D12 | Default implementation — `play-subagent-execution`                                      | `implementer`, balanced/high, source-mutable                                                                                                                                                               | Existing status/snapshot; scoped commit                                                                                       |
| D13 | Exact task — `play-subagent-execution`                                                  | `executor`, efficient/medium, source-mutable, selection-mode `inline-or-delegated`                                                                                                                         | Five guardrails; stop/reclassify on judgment                                                                                  |
| D14 | Per-task spec review — execution review routing                                         | `deep-reviewer`, frontier/xhigh, source-immutable                                                                                                                                                          | Existing distinct prompt/same-head fix loop                                                                                   |
| D15 | Per-task quality review — execution review routing                                      | `deep-reviewer`, frontier/xhigh, source-immutable                                                                                                                                                          | Existing distinct prompt/provisional same-head loop                                                                           |
| D16 | Final whole-implementation quality review — execution Process step 10/final-review gate | `deep-reviewer`, frontier/xhigh, source-immutable                                                                                                                                                          | Whole-range prompt; narrow ADR-0016 skip; final fix/fresh-review or terminal-owner route                                      |
| D17 | CI diagnosis/fix — `pr-merge` Step 4                                                    | branch `diagnosis`: `investigator`, balanced/high, source-immutable; branch `exact-fix`: `executor`, efficient/medium, source-mutable; branch `judgment-fix`: `implementer`, balanced/high, source-mutable | Guard diagnosis before fix classification; mutable child commits only; root alone separately owns external-mutable push/merge |

## Capability Escalation Adoption Inventory

For every current non-D4 route, ordered `direct_route_clauses` is this
owner's machine adoption representation of clause count, order, role IDs, and
operand presence and values. The Direct-Child Route Inventory table is the same
owner's readable projection and must agree index by index. This representation
does not authorize workflow evolution: workflow-local operational behavior
remains owned by the applicable skill and workflow sources.

<!-- escalation-adoption-anchor
{
  "declaration_id": "ESC-INVENTORY-OWNER",
  "source_path": "docs/guidelines/agent-routing-and-mutation-policy.md",
  "surface_mode": "inventory-owner",
  "contract_id": "capability-escalation-adoption",
  "common_owner_path": "skills/subagent-lifecycle/SKILL.md",
  "authority_ref": "inventory-owner",
  "adoptions": [
    {"route_id":"D1","adoption_ref":"ESC-ADOPT-D1","target_ids":["claude","codex"],"target_permission":"exact-only","role_permission":"same-role-must-match","direct_route_clauses":[{"role_id":"assessor"}],"current_state":"opt-out","transition":"none","next_tuple":"none","mechanism":"none","escalation_budget":"none","relation":"none","counter":"none","producer_source_path":"none"},
    {"route_id":"D2","adoption_ref":"ESC-ADOPT-D2","target_ids":["claude","codex"],"target_permission":"exact-only","role_permission":"same-role-must-match","direct_route_clauses":[{"role_id":"investigator"}],"current_state":"opt-out","transition":"none","next_tuple":"none","mechanism":"none","escalation_budget":"none","relation":"none","counter":"none","producer_source_path":"none"},
    {"route_id":"D3","adoption_ref":"ESC-ADOPT-D3","target_ids":["claude","codex"],"target_permission":"exact-only","role_permission":"same-role-must-match","direct_route_clauses":[{"role_id":"investigator","network_binding":"dispatch-named","evidence_qualifier":"named-network"}],"current_state":"opt-out","transition":"none","next_tuple":"none","mechanism":"none","escalation_budget":"none","relation":"none","counter":"none","producer_source_path":"none"},
    {"route_id":"D4","adoption_ref":"ESC-ADOPT-D4","target_ids":["claude","codex"],"target_permission":"exact-only","role_permission":"selected-role-must-match","current_state":"opt-out","transition":"none","next_tuple":"none","mechanism":"none","escalation_budget":"none","relation":"none","counter":"none","producer_source_path":"skills/play-agent-dispatch/SKILL.md"},
    {"route_id":"D5","adoption_ref":"ESC-ADOPT-D5","target_ids":["claude","codex"],"target_permission":"exact-only","role_permission":"same-role-must-match","direct_route_clauses":[{"role_id":"reviewer"}],"current_state":"opt-out","transition":"none","next_tuple":"none","mechanism":"none","escalation_budget":"none","relation":"none","counter":"none","producer_source_path":"none"},
    {"route_id":"D6","adoption_ref":"ESC-ADOPT-D6","target_ids":["claude","codex"],"target_permission":"exact-only","role_permission":"same-role-must-match","direct_route_clauses":[{"role_id":"reviewer"}],"current_state":"opt-out","transition":"none","next_tuple":"none","mechanism":"none","escalation_budget":"none","relation":"none","counter":"none","producer_source_path":"none"},
    {"route_id":"D7","adoption_ref":"ESC-ADOPT-D7","target_ids":["claude","codex"],"target_permission":"exact-only","role_permission":"same-role-must-match","direct_route_clauses":[{"role_id":"reviewer"}],"current_state":"opt-out","transition":"none","next_tuple":"none","mechanism":"none","escalation_budget":"none","relation":"none","counter":"none","producer_source_path":"none"},
    {"route_id":"D8","adoption_ref":"ESC-ADOPT-D8","target_ids":["claude","codex"],"target_permission":"exact-only","role_permission":"same-role-must-match","direct_route_clauses":[{"role_id":"reviewer"}],"current_state":"opt-out","transition":"none","next_tuple":"none","mechanism":"none","escalation_budget":"none","relation":"none","counter":"none","producer_source_path":"none"},
    {"route_id":"D9","adoption_ref":"ESC-ADOPT-D9","target_ids":["claude","codex"],"target_permission":"exact-only","role_permission":"same-role-must-match","direct_route_clauses":[{"role_id":"reviewer"}],"current_state":"opt-out","transition":"none","next_tuple":"none","mechanism":"none","escalation_budget":"none","relation":"none","counter":"none","producer_source_path":"none"},
    {"route_id":"D10","adoption_ref":"ESC-ADOPT-D10","target_ids":["claude","codex"],"target_permission":"exact-only","role_permission":"same-role-must-match","direct_route_clauses":[{"role_id":"deep-reviewer"}],"current_state":"opt-out","transition":"none","next_tuple":"none","mechanism":"none","escalation_budget":"none","relation":"none","counter":"none","producer_source_path":"none"},
    {"route_id":"D11","adoption_ref":"ESC-ADOPT-D11","target_ids":["claude","codex"],"target_permission":"exact-only","role_permission":"same-role-must-match","direct_route_clauses":[{"role_id":"assessor"}],"current_state":"opt-out","transition":"none","next_tuple":"none","mechanism":"none","escalation_budget":"none","relation":"none","counter":"none","producer_source_path":"none"},
    {"route_id":"D12","adoption_ref":"ESC-ADOPT-D12","target_ids":["claude","codex"],"target_permission":"exact-only","role_permission":"same-role-must-match","direct_route_clauses":[{"role_id":"implementer"}],"current_state":"opt-out","transition":"none","next_tuple":"none","mechanism":"none","escalation_budget":"none","relation":"none","counter":"none","producer_source_path":"none"},
    {"route_id":"D13","adoption_ref":"ESC-ADOPT-D13","target_ids":["claude","codex"],"target_permission":"exact-only","role_permission":"same-role-must-match","direct_route_clauses":[{"role_id":"executor","selection_mode":"inline-or-delegated"}],"current_state":"opt-out","transition":"none","next_tuple":"none","mechanism":"none","escalation_budget":"none","relation":"D13-to-D12-reclassification","counter":"none","producer_source_path":"none"},
    {"route_id":"D14","adoption_ref":"ESC-ADOPT-D14","target_ids":["claude","codex"],"target_permission":"exact-only","role_permission":"same-role-must-match","direct_route_clauses":[{"role_id":"deep-reviewer"}],"current_state":"opt-out","transition":"none","next_tuple":"none","mechanism":"none","escalation_budget":"none","relation":"none","counter":"none","producer_source_path":"none"},
    {"route_id":"D15","adoption_ref":"ESC-ADOPT-D15","target_ids":["claude","codex"],"target_permission":"exact-only","role_permission":"same-role-must-match","direct_route_clauses":[{"role_id":"deep-reviewer"}],"current_state":"opt-out","transition":"none","next_tuple":"none","mechanism":"none","escalation_budget":"none","relation":"none","counter":"none","producer_source_path":"none"},
    {"route_id":"D16","adoption_ref":"ESC-ADOPT-D16","target_ids":["claude","codex"],"target_permission":"exact-only","role_permission":"same-role-must-match","direct_route_clauses":[{"role_id":"deep-reviewer"}],"current_state":"opt-out","transition":"none","next_tuple":"none","mechanism":"none","escalation_budget":"none","relation":"none","counter":"none","producer_source_path":"none"},
    {"route_id":"D17","adoption_ref":"ESC-ADOPT-D17","target_ids":["claude","codex"],"target_permission":"exact-only","role_permission":"same-role-must-match","direct_route_clauses":[{"role_id":"investigator","branch_id":"diagnosis"},{"role_id":"executor","branch_id":"exact-fix"},{"role_id":"implementer","branch_id":"judgment-fix"}],"current_state":"opt-out","transition":"none","next_tuple":"none","mechanism":"none","escalation_budget":"none","relation":"none","counter":"independent-from-escalation","producer_source_path":"none"}
  ],
  "d4_route_set": {"route_id":"D4","allowed_role_ids":["assessor","investigator","executor","implementer","reviewer","deep-reviewer"],"selection_mode":"planner-selected","adoption_ref":"ESC-ADOPT-D4"}
}
-->

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
| D6  | opt-out        | none       |
| D7  | opt-out        | none       |
| D8  | opt-out        | none       |
| D9  | opt-out        | none       |
| D10 | opt-out        | none       |
| D11 | opt-out        | none       |
| D12 | opt-out        | none       |
| D13 | opt-out        | none       |
| D14 | opt-out        | none       |
| D15 | opt-out        | none       |
| D16 | opt-out        | none       |
| D17 | opt-out        | none       |

`adopt`, `specialize`, and `opt-out` remain the conceptual closed adoption
states. Current parser validation is deliberately fail-closed: it accepts only
an `opt-out` row with literal transition `none`. Until an authorized
implementation defines and validates the complete exact declaration grammar,
`adopt` and `specialize` rows are unsupported and rejected rather than treated
as a marker language or partial declaration.

Task-specific prompts, schemas, skip criteria, retries, fallbacks, and
termination remain owned by the source skill. A route may not collapse two
distinct sessions just because they share a semantic agent.

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
`capability`, target-native `effort`, `source_authority`,
`external_authority`, ordered duplicate-free `claude_tools`, `codex_sandbox`,
and `default_network`. The selected governed agent source supplies its
target-local literal `claude.model` or `codex.model` when present;
[`devcanon.config.yaml`](../../devcanon.config.yaml) supplies the
exact-target/capability `model` only as fallback. The selected source must
match the selected role's capability before model resolution; a
capability-less or mismatched source fails that parity check rather than
entering model resolution.

`agents/*.yaml` are governed declarations/instances and parity inputs, never
peer semantic authorities. Cognitive demand and stance remain planner
classification inputs only, not declaration fields or authority. Missing,
unresolved, unknown, nearby, ambient, or mismatched controller-bound or
owner-derived values block before spawn; no declaration field is optional or
may be inferred from the child, parent, workflow, or runtime environment. Under
the B3 routing boundary, a source-immutable D4 selection is response-only.

### Ordinary child failure disposition

After safe cleanup, existing unavailable or invalid-child behavior remains in
force. The four surfaces that need a minimum explicit disposition use this
table:

| Routes                                  | Ordinary unavailable, failed, malformed, or verification-rejected child after safe cleanup                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Generic focused specialist (D4)         | Let already-started siblings settle and clean up, integrate no results, and return the failed domain plus successful summaries to the controller |
| Per-task reviews (D14-D15)              | Keep the task incomplete and return the existing execution `BLOCKED` state with the failed review named; no verdict passes                       |
| Final whole-implementation review (D16) | Keep final review incomplete and return `BLOCKED` to the owning caller or direct/manual terminal-status path; do not enter branch finish         |
| CI diagnosis (D17)                      | Keep retry count unchanged, perform no fix/push/merge, and report the failed check plus manual-resolution recommendation                         |

Other routes retain their current gate/revision, partial research, missing
topical, unverified critic, or fresh-scenario behavior. Only detected source
mutation or cleanup failure is a guard-integrity terminal condition. An owning
workflow may still return its ordinary recoverable failure or `BLOCKED` state.

## Referenced Contracts

- The [agent spec](../specs/agents.md) owns the exact role envelope, canonical
  rendered example, and role-level render/runtime acceptance.
- The [AFDS workflow spec](../specs/afds-workflow-routing.md) owns observable
  route resolution, source-immutability guard ordering, valid handoff example,
  and failure routing.
- [ADR-0027](../adr/adr-0027-semantic-agent-routing-and-mutation-authority.md)
  owns the stable role decision, minimum guard rationale, bounded 10+6 runtime
  gate, human deployment block, and explicit deferrals.

## See Also

- [Agent source schema](../specs/agents.md)
- [AFDS workflow routing and evidence behavior](../specs/afds-workflow-routing.md)
- [Agent authoring guide](agent-authoring-guide.md)
- [Code review guideline](code-review-guideline.md)
- [ADR-0013: Path-Based Phase-Artifact Handoff](../adr/adr-0013-path-based-phase-artifact-handoff.md)
- [ADR-0016: Single-Task Auto Final-Review Carve-Out](../adr/adr-0016-single-task-auto-final-review-carve-out.md)
- [ADR-0024: Shared Support Skill Runtime](../adr/adr-0024-shared-support-skill-runtime.md)
- [ADR-0026: Replace Model Tiers with Capability Profiles](../adr/adr-0026-capability-profiles.md)
