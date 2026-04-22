# Core Concepts and Design Principles

---

## Core Concepts

### Skill

A **skill** is a reusable workflow stored as a directory containing `SKILL.md`
and optional supporting assets.

Examples:

- `pr-review`
- `implementation-plan`
- `bug-triage`
- `release-check`

Skills are shared across Claude Code and Codex.

### Agent Role

An **agent role** is a tool-agnostic source definition of a specialist.

In this repository, agent roles are intended to stay narrow. They are the
right choice when a contributor needs a specialist shell that carries role
identity plus documented target-specific controls, while reusable operational
knowledge still lives in skills.

Examples:

- `reviewer`
- `planner`
- `debugger`

Agent roles are not installed directly. They are rendered into native target
formats.

### Target

A **target** is a supported output environment.

Supported in v1:

- `claude`
- `codex`

### Install Mode

Defines how managed outputs are installed:

- `symlink`
- `copy`

### Managed Output

A generated file or installed skill directory that is owned and tracked by
`agents-manager`.

---

## Design Principles

1. **Source-first**\
   Source files are authoritative. Generated outputs are disposable.

2. **Skills first**\
   Reusable operational knowledge belongs in skills.

3. **Thin wrappers**\
   Agents should remain lightweight wrappers over skills plus narrow,
   role-specific guidance and documented target controls.

4. **Native outputs**\
   Generated Claude and Codex files should look like ordinary native files for
   those tools.

5. **Safe sync**\
   Unmanaged files must not be overwritten by default.

6. **Deterministic rendering**\
   Same source plus same config must produce identical outputs.

7. **Cross-platform support**\
   Must work on macOS, Linux, and Windows.
