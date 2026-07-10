# Agent Source Schema

---

## File format

YAML

---

## When to use an agent source file

Use an agent source file for a thin role wrapper that adds stable reusable role
identity plus documented target-supported constraints.

Valid reasons include dedicated:

- model tier
- effort level
- tool access
- sandbox mode
- Codex approval policy (`codex.approval_policy`)

If the main reusable value is still workflow method, checklist content, or
task-local prompt assembly, use a skill or keep the delegate as a prompt
template instead.

---

## Example

```yaml
name: reviewer
description: Focused code review role for correctness, regressions, and missing tests. Use when reviewing implementation against a plan or before merging. Do not use for general coding work or broad orchestration.
instructions: |
  Lead with concrete findings.
  Prefer correctness and regression issues over style comments.
  Use the pr-review skill when relevant.

skills:
  - pr-review
  - release-check

claude:
  model: "{{model:standard}}"
  tools:
    - Read
    - Grep
    - Bash

codex:
  model: "{{model:standard}}"
  sandbox_mode: read-only
```

---

## Shared keys

| Key            | Type   | Required | Notes                                                                    |
| -------------- | ------ | -------- | ------------------------------------------------------------------------ |
| `name`         | string | yes      | `^[a-z0-9][a-z0-9._-]*$` (filesystem-safe); must be unique across agents |
| `description`  | string | yes      | ≤ 1024 chars, no `<` / `>`                                               |
| `instructions` | string | yes      | Non-empty                                                                |
| `skills`       | list   | no       | List of skill names (must exist in `skills/`); defaults to `[]`          |
| `tags`         | list   | no       | Free-form tag strings                                                    |
| `notes`        | string | no       | Free-form notes                                                          |

The optional `claude:` and `codex:` blocks host per-target overrides — see § Documented target-specific fields in v1 below.

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

### Documented target-specific fields in v1

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

These are the repository's documented target-specific fields in v1. Do not use
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

A dedicated model tier or effort level is a valid reason to define an agent
when the role itself is stable and reusable. Those settings are part of the
role boundary, not just render-time metadata.

When an agent target uses `model: "{{model:<tier>}}"`, the renderer resolves
that placeholder against `modelTiers.<tier>.<target>`. For Claude, the tier's
`effort` is emitted unless the agent explicitly sets `claude.effort`. For
Codex, the tier's `model_reasoning_effort` is emitted unless the agent
explicitly sets `codex.model_reasoning_effort`; an explicit value takes
precedence over the inherited tier value. When neither source supplies an
effort, the field remains omitted.

Effort validation is local and syntactic. Accepting an effort such as `max`
does not prove that a particular Codex client, model, or account can run it;
operators must establish runtime availability separately.

---

## Not supported in v1

- inheritance
- extends/merge behavior
- overlays as a first-class feature
- automatic prompt composition from multiple files
- first-class delegation or orchestration policy fields

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
