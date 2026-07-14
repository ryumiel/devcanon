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

DevCanon has exactly six shared semantic agent roles. Role names describe the
reusable work identity and contain neither provider model names nor effort
levels.

| Agent           | Capability | Claude effort | Codex effort | Source default     | Primary use                                           |
| --------------- | ---------- | ------------- | ------------ | ------------------ | ----------------------------------------------------- |
| `assessor`      | balanced   | medium        | medium       | `source-immutable` | Bounded classification or evaluation                  |
| `investigator`  | balanced   | high          | high         | `source-immutable` | Repository, document, or external evidence collection |
| `executor`      | efficient  | medium        | medium       | `source-mutable`   | Exact validated no-policy operations                  |
| `implementer`   | balanced   | high          | high         | `source-mutable`   | Judgment-bearing scoped implementation                |
| `reviewer`      | frontier   | high          | high         | `source-immutable` | Ordinary synthesis and adversarial review             |
| `deep-reviewer` | frontier   | xhigh         | xhigh        | `source-immutable` | Existing high-assurance review gates                  |

Capability resolves through the configured capability profile. Claude and
Codex effort remain explicit, target-native, and independent. Capability,
effort, tools, sandbox, network access, mutation authority, and escalation are
separate choices.

All six roles may run permitted commands and may write one dispatch-named
direct-child `.ephemeral` handoff. Source-immutable roles use write-capable
target envelopes only for that limited handoff need. Tool or sandbox
availability never grants durable source or external mutation.

Skills remain the reusable method owner. They assemble task-local prompts,
inputs, output contracts, retry and fallback behavior, skip criteria, and
termination conditions. Agent definitions remain thin role wrappers.

### Closed mutation vocabulary

Mutation authority uses two separate axes:

- Source authority is exactly `source-immutable` or `source-mutable`.
  `source-immutable` may inspect, run permitted commands, and write only one
  dispatch-named direct-child `.ephemeral` handoff. It may not change durable
  source, tests, configuration, or documentation. `source-mutable` may alter
  only dispatch-authorized durable workspace paths.
- External authority is exactly `none` or `external-mutable`.
  `external-mutable` permits only the owning root/controller to perform a
  separately named and authorized mutation in GitHub, Linear, Notion, or
  another external system.

Every semantic child role has external authority `none` and may not receive
`external-mutable` authority. Only the owning root/controller may hold that
authority under separate authorization; it must not infer the authority from
source authority, model, effort, tools, sandbox, network access, or provider
capability.

The current complete skill and direct-child inventories live in the
[Agent Routing and Mutation Policy](../guidelines/agent-routing-and-mutation-policy.md).
The inventory is the current procedure owner; this ADR owns the stable role,
classification, and authority decisions.

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
escalation rule; escalation remains owned by its separate policy work.

### Minimum source-immutable guard

The existing packaged `devcanon-runtime` entrypoint gains one command group:

```text
source-immutability capture [--handoff .ephemeral/<direct-child>]
source-immutability verify --baseline .ephemeral/<generated> [--handoff <same-path>]
source-immutability cleanup --baseline .ephemeral/<generated> [--handoff <same-path>]
```

The command uses the existing runtime compatibility boundary. Workflow-owned
shims are thin argument, stdout, stderr, and exit-code forwarders and do not
define a second protocol.

`capture` requires a real Git worktree with `HEAD`, a real nonsymlinked ignored
`.ephemeral` directory, and at most one declared handoff that is absent,
ignored, untracked, and a direct child of `.ephemeral`. It retains an internal
collision-safe baseline and prints only the repository-relative baseline path.
The internal JSON shape is not a public or versioned schema.

The fingerprint covers canonical worktree identity, `HEAD` and symbolic ref,
raw index entries, and file kind, mode, and content for every tracked and
non-ignored untracked path. It preserves already-dirty staged, unstaged,
binary, and untracked content.

`verify` recomputes the fingerprint before any child result is semantically
validated or consumed. A declared handoff must be the exact fresh readable,
nonempty, nonsymlinked regular file. The owning skill validates its payload.
Success prints only `unchanged`; verification never repairs source or removes
artifacts.

`cleanup` runs after every terminal branch and may unlink only the retained
baseline and declared handoff leaves. Missing leaves are already clean,
symlinks are unlinked without following, and directories or other file kinds
fail. Success prints only `cleaned`. Cleanup never discovers paths from child
output, recursively deletes, resets, checks out, stages, or repairs source.

The controller order is fixed:

1. validate the route and optional handoff path;
2. capture;
3. spawn;
4. verify before semantic validation or consumption;
5. validate the response or read and validate the handoff into controller
   memory;
6. clean up the exact owned paths;
7. consume or apply the validated result.

Capture failure prevents spawn. Spawn, child, verification, or payload failure
rejects the result and still runs exact cleanup. Cleanup failure is a manual
blocker. A detected source mutation stays visible and is never repaired.

This deliberately minimal guard is not a filesystem monitor, security sandbox,
durable evidence protocol, race detector, cleanup receipt, retention state
machine, stable error ontology, ordered JSON protocol, or duplicate-key parser.
Ignored files, paths outside the worktree, external-system mutation, and
provider-internal behavior are outside its coverage.

### Bounded runtime acceptance

After local tests and both-target render parsing pass, the selected capability
and effort pairs receive exactly one native no-tool attempt on each target:

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
- [Agent source schema](../specs/agents.md)
- [AFDS workflow routing and evidence behavior](../specs/afds-workflow-routing.md)
