# Product Overview

Version: 1.0\
Status: Draft for implementation\
Scope: v1\
Runtime: Node.js CLI\
Targets: Claude Code, Codex\
Install scope: User-wide only

---

## One-Sentence Definition

`agents-manager` is a user-wide Node.js CLI that manages shared AI skills and
generates native Claude Code and Codex agent files from a single source of
truth.

---

## Product Goal

Provide one maintainable source of truth for personal AI workflows across
Claude Code and Codex without forcing the user to manually maintain multiple
agent files.

---

## Non-Goals

The following are out of scope for v1:

- repository-level management
- GitHub Copilot support
- management of `CLAUDE.md`
- management of `AGENTS.md`
- remote registries or skill marketplaces
- watch mode
- GUI or TUI
- cloud sync
- inheritance between agents
- editing generated outputs in place as source of truth
- management of `~/.codex/config.toml`

---

## User Stories

### Initialize a library

As a user, I want to initialize a personal library so I can manage my skills
and agents in one place.

### Create a skill

As a user, I want to scaffold a new skill so I can define a reusable workflow
quickly.

### Create an agent role

As a user, I want to define an agent once and generate Claude and Codex
wrappers from it.

### Validate source files

As a user, I want to validate my library before install so I can catch
mistakes early.

### Preview generated outputs

As a user, I want to render generated files locally before syncing them into
my home directories.

### Install managed outputs

As a user, I want to sync my source library into Claude and Codex user
directories.

### Inspect differences

As a user, I want to see what changed between source-generated and installed
outputs.

### Diagnose environment problems

As a user, I want a doctor command to tell me whether my system paths,
permissions, and symlink support are working.

---

## Source Layout

Recommended v1 layout:

```text
agents-manager/
├─ package.json
├─ agents-manager.config.yaml
├─ skills/
│  ├─ pr-review/
│  │  ├─ SKILL.md
│  │  └─ examples/
│  └─ implementation-plan/
│     └─ SKILL.md
├─ agents/
│  ├─ reviewer.yaml
│  ├─ planner.yaml
│  └─ debugger.yaml
├─ generated/
│  ├─ claude/
│  │  └─ agents/
│  └─ codex/
│     └─ agents/
└─ src/
   └─ ...
```

Notes:

- `skills/` is the shared source of truth for reusable skills.
- `agents/` contains neutral agent role definitions in YAML.
- `generated/` is a render preview/debug directory and is not authoritative.

---

## Installed Target Layout

### Claude target

```text
~/.claude/
└─ skills/
   ├─ pr-review/
   └─ implementation-plan/

~/.claude/agents/
├─ reviewer.md
├─ planner.md
└─ debugger.md
```

### Codex target

```text
~/.agents/
└─ skills/
   ├─ pr-review/
   └─ implementation-plan/

~/.codex/agents/
├─ reviewer.toml
├─ planner.toml
└─ debugger.toml
```

Notes:

- Codex shared skills are installed to `~/.agents/skills`.
- Codex native custom agents are installed to `~/.codex/agents/`.
- `agents-manager` does not manage `~/.codex/config.toml` in v1.
