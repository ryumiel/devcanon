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

Defines how installed managed outputs are written:

- `symlink`
- `copy`

### Generated Output

A disposable render result under `generated/<target>/`.

### Installed Managed Output

A target-home file or directory installed by `devcanon sync` and tracked by the
install manifest.

### AFDS Project

An **AFDS project** is a development project that uses agent-friendly durable
docs, issue tracking, pull requests, and reusable skills as separate systems of
record.

DevCanon supports AFDS projects by providing portable skills, thin agent roles,
and setup guidance. It does not automatically rewrite or manage consumer
project repositories.

### Roadmap Item

A **roadmap item** is a durable, forward-looking outcome that is larger than a
single pull request.

Roadmap items live in `docs/roadmap/` when the direction needs to survive
beyond the current issue or agent session. Live status, assignees, sub-issue
lists, and PR state stay in GitHub Issues, Linear, or pull requests.

### Guided Adoption

**Guided adoption** means DevCanon gives projects reusable workflows,
generated target-native files, and documentation patterns for adopting AFDS,
while the consumer project remains responsible for its own repository docs and
migration choices.

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

8. **Guided adoption**\
   DevCanon helps projects adopt AFDS through portable skills, thin agent roles,
   and setup guidance; it does not automatically manage consumer repositories.
