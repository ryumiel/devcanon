# Agent Source Schema

---

## File format

YAML

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
  model: sonnet
  tools:
    - Read
    - Grep
    - Bash

codex:
  sandbox_mode: read-only
```

---

## Required fields

- `name`
- `description`
- `instructions`

---

## Optional fields

- `skills`
- `claude`
- `codex`
- `tags`
- `notes`

### Description style

The agent `description` is what both Claude and Codex use to decide when to
delegate to the agent. Same shape as skills: name **what** the role is for,
then **when** to delegate. Third person.

```yaml
description: <Role — what the agent does>. Use when <delegation triggers>. Do not use when <contrastive cue against sibling agents or general work>.
```

Agents benefit more than skills from a `Do not use when…` clause because role
selection often hinges on disambiguation against general work or sibling
agents. See the [authoring guide](../guidelines/agent-authoring-guide.md) for
worked examples and [`skills.md` § Description style](skills.md#description-style)
for the full rule, red flags, and mechanical constraints.

### Documented target-specific fields in v1

Within `claude`:

- `model`
- `tools`

Within `codex`:

- `model`
- `model_reasoning_effort`
- `sandbox_mode`
- `nickname_candidates`
- `approval_policy`

These are the repository's documented target-specific fields in v1. Do not use
this spec to imply support for other target fields unless they are documented
here.

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
