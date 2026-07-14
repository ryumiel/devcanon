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

## ADR-0027 target example

This is the canonical ADR-0027 post-migration `assessor` source example. While
ADR-0027 is Proposed, it is an acceptance target rather than evidence that the
current source file already exists.

```yaml
name: assessor
description: Bounded assessment role for classification or evaluation against a closed acceptance condition. Use when a workflow needs a focused source-immutable decision. Do not use for open-ended investigation, implementation, or synthesis review.
instructions: |
  Evaluate only the dispatch-defined scope and acceptance condition.
  You may inspect files, run permitted commands, and write only one
  dispatch-named direct-child .ephemeral handoff when requested.
  Do not modify durable source, tests, configuration, or documentation.
  Do not mutate external systems.

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

ADR-0027 defines this section as the post-migration target. The migration begins
from four legacy source roles and no accepted six-role render inventory. While
the ADR remains Proposed, `agents/` and fresh render output remain the authority
for implementation state; this table does not claim source convergence.
Acceptance requires the source library and both generated targets to converge
on exactly these six semantic roles. Agent names describe reusable work
identity, not provider models, effort levels, or workflow phases.

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
roles must carry self-contained instructions prohibiting changes to durable
source, tests, configuration, and documentation. Their write-capable envelope
exists for the optional handoff; it is not durable mutation authority.

`executor` instructions must limit it to exact validated operations on
dispatch-authorized paths and require it to stop or hand off when a guardrail is
missing or judgment appears. `implementer` remains the role for scoped
judgment-bearing implementation.

Every shared role defaults to no external-system mutation. An owning workflow
may separately grant one named external mutation, but external authority must
not be inferred from role, capability, effort, tools, sandbox, network access,
or source authority.

`investigator` receives network access or a diagnostic handoff path only when
the dispatch explicitly names it. Ambient network availability and an unnamed
diagnostic artifact are outside the role contract.

### Render and runtime acceptance

Under the post-migration contract, each source role renders to both targets with
the same semantic identity, capability-selected model, explicit target effort,
and target-native tool or sandbox envelope above. Acceptance requires exactly
six source roles to produce exactly six Claude agent files and six Codex agent
files. Generated previews remain disposable and do not become authority; a
fresh render is convergence evidence, not source authority.

The canonical `assessor` example above must render balanced/medium on both
targets, retain its command and named-handoff envelope, prohibit durable and
external mutation, and omit no Codex effort. A rendered role count other than
six, omitted effort, or broader mutation instructions fails the contract.

After local validation and both-target render parsing, runtime acceptance is
bounded to one no-tool attempt for each selected capability/effort pair on each
target plus one guarded Codex named-role handoff for each of the six roles. The
exact pair matrix, output tokens, blocker rules, and human-only deployment gate
are owned by
[ADR-0027](../adr/adr-0027-semantic-agent-routing-and-mutation-authority.md).
Local validation does not prove client, account, model, effort, or named-agent
availability and must never substitute an alias or fallback.

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
Target fields document executable capability; they do not authorize mutation.

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
