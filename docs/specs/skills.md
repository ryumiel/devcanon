# Skill Specification

---

## Required structure

Each skill is a directory under `skills/` and must contain:

- `SKILL.md` with YAML frontmatter + Markdown body.

---

## Frontmatter schema

### Shared keys (emitted to both targets)

| Key             | Type           | Required | Notes                                           |
| --------------- | -------------- | -------- | ----------------------------------------------- |
| `name`          | string         | yes      | `^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$`, ≤ 64 chars |
| `description`   | string         | yes      | ≤ 1024 chars, no `<` / `>`                      |
| `allowed-tools` | string or list | no       | Space-separated string or YAML list             |

### Optional per-target override blocks

`claude:` accepts Claude-specific frontmatter fields (`model`,
`effort`, `when_to_use`, `argument-hint`, `arguments`,
`disable-model-invocation`, `user-invocable`, `context`, `agent`,
`paths`, `shell`). Strict — unknown keys are rejected.

`codex:` accepts Codex-whitelisted fields (`license`, `metadata`).
Strict.

### Codex sidecar

`codex_sidecar:` is a top-level block emitted as
`agents/openai.yaml` next to the generated Codex `SKILL.md`.
Supports `interface.*`, `policy.*`, `dependencies.*`.

---

## Placeholders

`{{model:fast}}`, `{{model:standard}}`, `{{model:deep}}` resolve at
render time against the `modelTiers` glossary in
`agents-manager.config.yaml`. The resolution target depends on
the rendering pass. Escape with a leading backslash: `\{{model:deep}}`.
Placeholders inside fenced code blocks are not substituted.

Only the `model:` namespace is permitted. Other namespaces
(`path:`, `tool:`, etc.) are a validator error.

---

## Optional content

A skill may also contain:

- `assets/`
- `examples/`
- `references/`
- `scripts/`

These subdirectories are mirrored per target into
`generated/<target>/skills/<name>/` as-is.

---

## Validation rules

- Skill directory name must be filesystem-safe.
- `SKILL.md` must exist.
- Frontmatter must parse and match `SkillSourceSchema`.
- Frontmatter `name` must equal the directory name.
- Skill names must be unique.
- Every `{{X:Y}}` placeholder must use `X = model` and `Y` must
  be defined in `modelTiers`.
- Broken internal symlinks are errors.

---

## Install behavior

Per-target rendered outputs live under:

- `generated/claude/skills/<name>/`
- `generated/codex/skills/<name>/`

At install time they are linked or copied to:

- Claude: `~/.claude/skills/<name>/`
- Codex: `~/.agents/skills/<name>/`

Each target is treated as a separate install target.

---

## Example

```markdown
---
name: example-skill
description: Use when X. Triggers on Y.
allowed-tools: Bash Read Grep

claude:
  model: "{{model:deep}}"
  effort: high

codex:
  license: MIT
  metadata:
    short-description: "Short blurb for Codex UI"

codex_sidecar:
  interface:
    display_name: Example Skill
    brand_color: "#00ccff"
  policy:
    allow_implicit_invocation: true
---

# Example

Use {{model:deep}} for synthesis, then {{model:fast}} for cleanup.
```

---

## See also

- [Agent source schema](agents.md) — agents reference skills
- [Install and sync](install-and-sync.md) — how skills are installed
- [Target mapping](target-mapping.md) — skill install paths per target
- [ADR-0005](../adr/adr-0005-per-target-skill-rendering.md) — decision record
