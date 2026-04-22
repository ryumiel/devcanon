# Agent Source Schema

---

## File format

YAML

---

## Example

```yaml
name: reviewer
description: Review code for correctness, regressions, and missing tests.
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
