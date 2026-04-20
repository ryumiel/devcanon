# Skill Specification

---

## Required structure

Each skill is a directory under `skills/` and must contain:

- `SKILL.md`

---

## Optional content

A skill may also contain:

- `assets/`
- `examples/`
- `references/`
- `scripts/`

---

## Validation rules

- skill directory name must be filesystem-safe
- `SKILL.md` must exist
- skill names must be unique
- broken internal symlinks are errors

---

## Install behavior

Skills are installed to:

- Claude: `~/.claude/skills/<skill-name>`
- Codex: `~/.agents/skills/<skill-name>`

Each target is treated as a separate install target even when the source
content is shared.

---

## See also

- [Agent source schema](agents.md) -- agents reference skills
- [Install and sync](install-and-sync.md) -- how skills are installed
- [Target mapping](target-mapping.md) -- skill install paths per target
