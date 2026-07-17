# ADR-0027: Semantic Agent Routing and Mutation Authority

## Status

Proposed

## Context

Shared agent roles previously mixed reusable work identity with workflow-local
review names. Direct child dispatches also used a mixture of explicit and
ambient model and effort selection, while write-capable tools and sandboxes did
not distinguish session-local handoffs from durable source or external-system
mutation.

DevCanon needs a compact semantic role catalog, independent capability and
effort selection, and a closed mutation vocabulary. Skills must remain the
owners of task prompts, schemas, phase mechanics, fallbacks, and termination.
The guard for source-immutable work must be strong enough to reject unexpected
Git-visible source changes without being represented as a general filesystem
monitor or a security sandbox.

## Decision

### Semantic roles

DevCanon adopts the compact post-migration semantic role catalog defined by the
[agent spec](../specs/agents.md#semantic-role-catalog). That spec is the sole
normative owner of the exact role identities and envelope, including capability
and target-native effort tuples, tools, sandbox, network behavior, source and
external defaults, and handoff fields. This ADR does not repeat those values;
examples and runtime checks consume the spec-owned catalog.

The architectural decision is that shared roles describe stable reusable work
identity rather than provider models, effort levels, or workflow phases.
Capability and effort, tools, sandbox, authority, orchestration, retries, and
escalation remain separate choices. Tool or sandbox availability never grants
durable source or external mutation.

Skills remain the reusable method owner. They assemble task-local prompts,
inputs, output contracts, retry and fallback behavior, skip criteria, and
termination conditions. Agent definitions remain thin role wrappers.

### Closed mutation vocabulary

The architectural decision is that durable source mutation and external-system
mutation are separate authority axes. Source permissions never imply an
external effect. Semantic child roles receive no external-system mutation
authority; only the owning root/controller may hold separately authorized
authority for a named external mutation. Model, effort, tools, sandbox, network
access, and provider capability do not change that boundary.

The [Agent Routing and Mutation Policy](../guidelines/agent-routing-and-mutation-policy.md#mutation-axes)
is the sole normative owner of the exact closed values and their operational
permissions. This ADR records the separation rationale and does not reproduce
that vocabulary. The current complete skill and direct-child inventories also
live in the
[Agent Routing and Mutation Policy](../guidelines/agent-routing-and-mutation-policy.md).

### Cognitive classification and escalation boundary

Direct work is classified as mechanical, bounded, synthesis, or inherited.
Mechanical work is a closed algorithm over validated facts and prefers a
deterministic helper, guarded inline execution, or `executor`. Bounded work has
one scope and a closed acceptance condition. Synthesis combines authorities,
ambiguity, trade-offs, or a cross-module conclusion. Inherited work must be
resolved by its active phase before dispatch and may not use ambient model or
effort selection.

Adversarial stance is independent of cognitive demand. `deep-reviewer` is
reserved for the existing critic, per-task high-assurance reviews, and final
whole-implementation review. This decision establishes no capability or effort
escalation rule. The shared `subagent-lifecycle` procedure owns declaration,
support, invariants, evidence, budget, and terminal semantics; the
[Agent Routing and Mutation Policy](../guidelines/agent-routing-and-mutation-policy.md)
owns the current adoption inventory. Controllers consume those sources without
claiming current target support or duplicating their policy.

### Minimum source-immutable guard

The architecture requires a minimal content-sensitive guard around
source-immutable child work and any named direct-child `.ephemeral` handoff.
Its purpose is to detect unexpected Git-visible source mutation before a result
is consumed while keeping controller-owned artifact cleanup bounded.

The [AFDS workflow spec](../specs/afds-workflow-routing.md#guard-001-source-immutable-result-gate)
is the sole normative owner of observable guard behavior, including command
syntax, path preconditions, fingerprint coverage, lifecycle ordering, output
and failure behavior, and cleanup rules. Runtime commands and workflow shims
implement that contract; they do not create a second protocol, and this ADR
does not restate one.

The guard remains deliberately minimal. It is not a general filesystem monitor,
security sandbox, durable evidence protocol, race detector, retention system,
or public interchange protocol. Comprehensive workspace enforcement and
broader evidence machinery remain explicit follow-up categories rather than
part of this decision.

### Bounded runtime acceptance

After local tests and both-target render parsing pass, the selected capability
and effort pairs receive exactly one native no-tool attempt on each target.

This smoke matrix defines acceptance attempts, not role-to-pair assignments.
Each named-role case resolves its exact tuple and envelope from the
[agent spec](../specs/agents.md#semantic-role-catalog).

The required attempts are:

| Capability / effort | Claude                      | Codex           |
| ------------------- | --------------------------- | --------------- |
| efficient / medium  | `claude-haiku-4-5-20251001` | `gpt-5.6-luna`  |
| balanced / medium   | `claude-sonnet-5`           | `gpt-5.6-terra` |
| balanced / high     | `claude-sonnet-5`           | `gpt-5.6-terra` |
| frontier / high     | `claude-opus-4-8`           | `gpt-5.6-sol`   |
| frontier / xhigh    | `claude-opus-4-8`           | `gpt-5.6-sol`   |

The ten pair attempts use the exact full model and effort, no alias, fallback,
substitution, or retry. A pair passes only when the native output contains no
tool event and its sole extracted final text is exactly
`DEVCANON_SMOKE_OK <full-model> <effort>`.

Codex also receives one bounded named-role case for each of the six roles. The
only permitted command is `git rev-parse --verify HEAD`. Each role writes one
named direct-child handoff containing exactly
`DEVCANON_ROLE_SMOKE_OK <role> <head>`. The controller applies the minimum
guard, exact-compares the line into memory, cleans the two owned artifacts, and
only then records success.

The dated report is concise prose evidence with ten pair rows, six role rows,
client versions, revision, and an aggregate result. It is not a parsed schema
or durable evidence store and contains no raw logs, secrets, absolute paths,
per-row timestamps or digests, resumable state, or retention protocol.

This ADR remains Proposed while any of the sixteen runtime rows or the final
repository gate is blocked. It may become Accepted only after all of them pass.
A human operator, not render, sync, or install behavior, blocks deployment to
affected targets until then.

The bounded run on 2026-07-15 leaves this ADR **Proposed**. All five Claude
pair rows passed. Three of five Codex pair rows passed; the two `gpt-5.6-sol`
rows were blocked by final-text literal mismatches. All six Codex named-role
rows were blocked because the installed client exposed no supported native
named-role selection interface, so no role was substituted or emulated.
Deployment to the Codex target remains operator-blocked pending a later bounded
rerun under separately authorized acceptance work.

## Consequences

- Six stable semantic identities replace workflow-named shared roles while
  reusable workflow method remains in skills.
- Capability and effort are explicit for every direct route and remain
  independent from mutation authority.
- `executor` is limited to exact validated work and must stop or hand off when
  a guardrail is missing or judgment appears.
- Source-immutable results are rejected on unexpected Git-visible source
  change, but the minimum guard does not claim comprehensive workspace or
  external-system enforcement.
- Existing path-based response and handoff contracts remain response-only
  where required by ADR-0013. The final-review carve-out in ADR-0016 remains
  narrow and caller-scoped.
- Deterministic mechanics remain governed by ADR-0019 and the packaged runtime
  boundary accepted by ADR-0024.
- ADR-0025 remains historical model-selection evidence. ADR-0026 remains the
  accepted owner of the model-only capability catalog and capability/effort
  independence.
- Generated outputs remain disposable and neither source schemas nor rendered
  target formats change because of this decision.
- No product requirement, extra behavior spec, root workflow, contribution
  policy, PR template, install/sync behavior, or external tracker lifecycle is
  introduced.

The following remain explicit follow-up categories rather than part of this
decision's implementation:

1. benchmark corpora, fixtures, oracle scoring, comparative thresholds, or
   large model-run matrices;
2. resumable evidence stores, databases, redaction pipelines, or retention and
   deletion protocols;
3. a direct-dispatch marker or annotation language;
4. comprehensive ignored-file or workspace-integrity monitoring and role-aware
   filesystem enforcement;
5. a general cross-provider evaluation framework.

## Alternatives considered

- **Keep workflow-named shared agents.** Rejected because it duplicates
  skill-owned method and encourages one agent per workflow phase.
- **Name agents after providers, models, or effort.** Rejected because those
  are independently selected target constraints, not reusable work identity.
- **Treat write-capable tools or workspace-write as mutation authority.**
  Rejected because source-immutable roles need routine commands and one named
  handoff without receiving durable or external mutation rights.
- **Use one combined mutation class.** Rejected because durable workspace and
  external-system changes require independent authorization.
- **Promote the guard into comprehensive workspace enforcement.** Rejected
  because ignored files, outside-worktree paths, races, and external systems
  require a broader security and evidence design.
- **Build a broad evaluation framework before routing.** Rejected because the
  selected pairs need a bounded availability check, not a benchmark platform.

## Related

- [ADR-0013: Path-Based Phase-Artifact Handoff](adr-0013-path-based-phase-artifact-handoff.md)
- [ADR-0016: Single-Task Auto Final-Review Carve-Out](adr-0016-single-task-auto-final-review-carve-out.md)
- [ADR-0019: Script Authority for Deterministic Skill Mechanics](adr-0019-script-authority-for-deterministic-skill-mechanics.md)
- [ADR-0024: Shared Support Skill Runtime](adr-0024-shared-support-skill-runtime.md)
- [ADR-0025: Select Named GPT-5.6 Codex Tiers](adr-0025-codex-model-tier-selection.md)
- [ADR-0026: Replace Model Tiers with Capability Profiles](adr-0026-capability-profiles.md)
- [Shared subagent lifecycle procedure](../../skills/subagent-lifecycle/SKILL.md)
- [Agent Routing and Mutation Policy](../guidelines/agent-routing-and-mutation-policy.md)
- [Agent source schema and semantic role catalog](../specs/agents.md#semantic-role-catalog)
- [AFDS workflow routing and evidence behavior](../specs/afds-workflow-routing.md)
