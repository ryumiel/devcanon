# Agent Source Schema

---

## File format

YAML

---

## When to use an agent source file

Use an agent source file for a thin role wrapper that adds stable reusable role
identity plus documented target-supported constraints.

Valid reasons include dedicated:

- model capability
- effort level
- tool access
- sandbox mode
- Codex approval policy (`codex.approval_policy`)

If the main reusable value is still workflow method, checklist content, or
task-local prompt assembly, use a skill or keep the delegate as a prompt
template instead.

---

## ADR-0027 `assessor` source example

This is an abridged, non-authoritative `assessor` example. The authoritative
current source is [`agents/assessor.yaml`](../../agents/assessor.yaml).
ADR-0027 remains Proposed because bounded runtime acceptance is incomplete,
not because this source file or source/render convergence is absent.

```yaml
name: assessor
description: Bounded assessment role for classification or evaluation against a closed acceptance condition. Use when a workflow needs a focused source-immutable decision. Do not use for open-ended investigation, implementation, or synthesis review.
instructions: |
  Evaluate only the dispatch-defined scope and acceptance condition.
  You may inspect files, run permitted commands, and write only one
  dispatch-named direct-child .ephemeral handoff when requested.
  Do not make durable file edits.
  Mutating commands are permitted only when required to create, write,
  validate, or clean up the exact dispatch-named direct-child .ephemeral
  handoff. Do not run any other mutating commands.
  Do not modify durable source, tests, configuration, or documentation.
  Do not mutate GitHub, Linear, Notion, or any other external system.

capability: balanced

claude:
  effort: medium
  tools:
    - Read
    - Grep
    - Bash
    - Write

codex:
  model_reasoning_effort: medium
  sandbox_mode: workspace-write
```

---

## Semantic role catalog

This section is the sole exact catalog for the current six semantic roles.
Source definitions under `agents/` are authoritative for implementation state.
Existing render-contract evidence verifies that the six configured roles render
and parse for both targets; generated outputs and fresh renders are convergence
evidence, not co-authority. ADR-0027 remains Proposed because bounded runtime
acceptance is incomplete. Agent names describe reusable work identity, not
provider models, effort levels, or workflow phases.

| Agent           | Capability | Claude effort | Codex effort | Source default     | External default | Primary use                                           |
| --------------- | ---------- | ------------- | ------------ | ------------------ | ---------------- | ----------------------------------------------------- |
| `assessor`      | balanced   | medium        | medium       | `source-immutable` | `none`           | Bounded classification or evaluation                  |
| `investigator`  | balanced   | high          | high         | `source-immutable` | `none`           | Repository, document, or external evidence collection |
| `executor`      | efficient  | medium        | medium       | `source-mutable`   | `none`           | Exact validated no-policy operations                  |
| `implementer`   | balanced   | high          | high         | `source-mutable`   | `none`           | Judgment-bearing scoped implementation                |
| `reviewer`      | frontier   | high          | high         | `source-immutable` | `none`           | Ordinary synthesis and adversarial review             |
| `deep-reviewer` | frontier   | xhigh         | xhigh        | `source-immutable` | `none`           | Existing high-assurance review gates                  |

Capability and target-native effort are both explicit for all six roles and
remain independent. Neither setting implies tools, sandbox, network, mutation,
or escalation behavior.

### Tool and sandbox behavior

| Agent           | Claude tools                                 | Codex sandbox   | Default network |
| --------------- | -------------------------------------------- | --------------- | --------------- |
| `assessor`      | Read, Grep, Bash, Write                      | workspace-write | None            |
| `investigator`  | Read, Grep, Bash, Write, WebFetch, WebSearch | workspace-write | Dispatch-owned  |
| `executor`      | Read, Grep, Bash, Edit, Write                | workspace-write | None            |
| `implementer`   | Read, Grep, Bash, Edit, Write                | workspace-write | Task-owned      |
| `reviewer`      | Read, Grep, Bash, Write                      | workspace-write | None            |
| `deep-reviewer` | Read, Grep, Bash, Write                      | workspace-write | None            |

Every role may run permitted routine commands and may write one
dispatch-named direct-child `.ephemeral` handoff. The four source-immutable
roles must carry self-contained instructions that prohibit durable file edits,
permit mutating commands only when required to create, write, validate, or
clean up the exact dispatch-named direct-child handoff, prohibit every other
mutating command, and prohibit GitHub, Linear, Notion, or other external writes.
Their write-capable envelope exists for the optional handoff; it is not durable
mutation authority.

Codex `sandbox_mode` and `approval_policy` values are reusable inherited
configuration defaults or layers, not immutable enforcement. An active parent
or runtime policy may apply a different live setting. Those target fields
describe available execution configuration and never grant mutation authority.

`executor` instructions must limit it to exact validated operations on
dispatch-authorized paths and require it to stop or hand off when a guardrail is
missing or judgment appears. `implementer` remains the role for scoped
judgment-bearing implementation.

Every semantic child role has external authority `none`; no workflow may grant
`external-mutable` authority to a child. Only the owning root/controller may
hold one separately authorized, named external mutation. External authority
must not be inferred from role, capability, effort, tools, sandbox, network
access, or source authority.

`investigator` receives network access or a diagnostic handoff path only when
the dispatch explicitly names it. Ambient network availability and an unnamed
diagnostic artifact are outside the role contract.

### Instruction mutation boundaries

This table is the normative owner of exact shared instruction text for mutation
boundaries. Tests and rendered targets consume these clauses; they do not define
parallel positive wording.

| Dimension               | Applies to         | Required instruction                                                                                                                                                                           |
| ----------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `durable-file-edit`     | `source-immutable` | `Do not make durable file edits.`                                                                                                                                                              |
| `exact-handoff-command` | `source-immutable` | `Mutating commands are permitted only when required to create, write, validate, or clean up the exact dispatch-named direct-child .ephemeral handoff. Do not run any other mutating commands.` |
| `external-write`        | `all roles`        | `Do not mutate GitHub, Linear, Notion, or any other external system.`                                                                                                                          |

### Render and runtime acceptance

Under the current contract, each source role renders to both targets with
the same semantic identity, capability-selected model, explicit target effort,
and target-native tool or sandbox envelope above. Acceptance requires exactly
six source roles to produce exactly six Claude agent files and six Codex agent
files. Generated previews remain disposable and do not become authority; a
fresh render is convergence evidence, not source authority.

The canonical `assessor` example above must render balanced/medium on both
targets, retain its command and named-handoff envelope, prohibit durable and
external mutation, and omit no Codex effort. A rendered role count other than
six, omitted effort, or broader mutation instructions fails the contract.

Source and render convergence do not complete runtime acceptance. After local
validation and both-target render parsing, runtime acceptance is bounded to one
no-tool attempt for each selected capability/effort pair on each target plus one
guarded Codex named-role handoff for each of the six roles. The exact pair
matrix, output tokens, blocker rules, and human-only deployment gate are owned by
[ADR-0027](../adr/adr-0027-semantic-agent-routing-and-mutation-authority.md).
Local validation does not prove client, account, model, effort, or named-agent
availability and must never substitute an alias or fallback.

Static source and render checks are derived behavioral evidence, not runtime
enforcement. A hard claim that workspace or file non-mutation is enforced
requires an actually enforced read-only workspace policy. Any broader hard
non-mutation claim requires enforced denial for every claimed mutation surface,
including external-action capabilities. Broader-permission trials or
observations must inspect relevant repository state and modeled external-action
state, state their residual unobserved risk, and be labeled behavioral evidence
rather than a security proof. This contract creates no new runtime harness;
ADR-0027 owns the bounded runtime acceptance procedure.

---

## Shared keys

| Key            | Type   | Required | Notes                                                                    |
| -------------- | ------ | -------- | ------------------------------------------------------------------------ |
| `name`         | string | yes      | `^[a-z0-9][a-z0-9._-]*$` (filesystem-safe); must be unique across agents |
| `description`  | string | yes      | ≤ 1024 chars, no `<` / `>`                                               |
| `instructions` | string | yes      | Non-empty                                                                |
| `skills`       | list   | no       | List of skill names (must exist in `skills/`); defaults to `[]`          |
| `capability`   | enum   | no       | `efficient`, `balanced`, or `frontier`; selects only a target model      |
| `tags`         | list   | no       | Free-form tag strings                                                    |
| `notes`        | string | no       | Free-form notes                                                          |

The optional `claude:` and `codex:` blocks host per-target overrides — see
§ Documented target-specific fields in v2 below.

---

### Description style

The agent `description` is what both Claude and Codex use to decide when to
delegate to the agent. The recommended shape is the same as for skills: name
**what** the role is for, then **when** to delegate. Third person.

```yaml
description: <Role — what the agent does>. Use when <delegation triggers>. Do not use when <contrastive cue against sibling agents or general work>.
```

Agents benefit more than skills from a `Do not use when…` clause because role
selection often hinges on disambiguation against general work or sibling
agents.

The style above is a recommendation. See the
[authoring guide](../guidelines/agent-authoring-guide.md) for worked
examples and [`skills.md` § Description style](skills.md#description-style)
for the full rationale and red flags.

### Constraints (mechanical)

These are enforced by `AgentSourceSchema` and surfaced by
`devcanon validate`:

- `description` is required (non-empty).
- ≤ 1024 chars (hard cap); aim for ≤ 500.
- No `<` or `>`.

The style rules above (third person, capability + trigger) are not
mechanically validated.

### Documented target-specific fields in v2

Within `claude`:

- `model`
- `effort` (see `docs/specs/configuration.md` for allowed values)
- `tools`

Within `codex`:

- `model`
- `model_reasoning_effort` (allowed values are listed below)
- `sandbox_mode`
- `nickname_candidates`
- `approval_policy`

These are the repository's documented target-specific fields in v2. Do not use
this spec to imply support for other target fields unless they are documented
here.

Field constraints:

- `model_reasoning_effort` is optional and must be one of `none`, `minimal`,
  `low`, `medium`, `high`, `xhigh`, or `max`. `ultra` is not a reasoning-effort
  value in this contract; it is an orchestration mode and is rejected here.
- `sandbox_mode` is optional and must be one of `read-only`,
  `workspace-write`, or `danger-full-access`.
- `nickname_candidates` is optional. When present, it must be a non-empty list
  of unique names after trimming whitespace. Names may contain only ASCII
  letters, digits, spaces, hyphens, and underscores.
- `approval_policy` is optional. It may be one of `untrusted`, `on-request`,
  `on-failure`, or `never`, or an object with `granular`.
- `approval_policy.granular` requires `mcp_elicitations`, `rules`, and
  `sandbox_approval` booleans. It may also include `request_permissions` and
  `skill_approval` booleans.

A dedicated model capability or effort level is a valid reason to define an agent
when the role itself is stable and reusable. Those settings are part of the
role boundary, not just render-time metadata.

Model selection is target-local. A literal `claude.model` or `codex.model`
takes precedence over the model mapped by top-level `capability`. If neither is
present, the rendered model field is omitted and the target's ambient model
selection applies. Literal target model fields must not contain `{{model:*}}`;
validation and both render paths reject those former agent placeholders with
guidance to use top-level capability or a literal model.

Effort is independent. An explicit `claude.effort` or
`codex.model_reasoning_effort` is emitted as written; when absent it remains
omitted and ambient target behavior applies. Capability never supplies or
inherits effort.

Effort validation is local and syntactic. Accepting an effort such as `max`
does not prove that a particular Codex client, model, or account can run it;
operators must establish runtime availability separately.

Mutation authority is a workflow contract rather than a first-class schema
field. The closed source and external axes, complete skill inventory, and
direct-child routes are owned by the
[Agent Routing and Mutation Policy](../guidelines/agent-routing-and-mutation-policy.md).
Codex sandbox and approval values are reusable inherited configuration defaults
or layers that a live parent policy may override; they are not immutable
enforcement. Target fields document executable capability; they do not
authorize mutation.

---

## Not supported in v2

- inheritance
- extends/merge behavior
- overlays as a first-class feature
- automatic prompt composition from multiple files
- first-class delegation or orchestration policy fields
- custom, transitional, compatibility, or legacy capabilities
- automatic v1 tier translation or agent model placeholders

---

## Validation rules

- `name` must be filesystem-safe
- agent names must be unique
- referenced skills must exist
- unknown shared fields are warnings in normal mode and errors in strict mode
- unknown target-specific fields are warnings in normal mode and errors in
  strict mode

---

## See also

- [Skill specification](skills.md) -- skills referenced by agents
- [Target mapping](target-mapping.md) -- how agents render to native formats
- [Configuration](configuration.md) -- target-level settings
- [Agent routing and mutation policy](../guidelines/agent-routing-and-mutation-policy.md)
- [Semantic routing decision](../adr/adr-0027-semantic-agent-routing-and-mutation-authority.md)
