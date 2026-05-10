# Behavior Specs Overview

Scope: DevCanon behavior specs\
Runtime: Node.js CLI\
Targets: Claude Code, Codex\
Install scope: User-wide only\
Product requirements:\
[Portable AFDS Toolkit](../product-requirements/portable-afds-toolkit.md)

---

This file is the index and shared context for DevCanon behavior specs. Product
intent, target users, goals, risks, and broad requirements belong in
`docs/product-requirements/`. This overview summarizes behavior-spec scope,
shared boundaries, and links to acceptance-ready specs.

## Behavior Scope

DevCanon is a user-wide Node.js CLI and source library for portable AFDS skills,
thin agent roles, and generated Claude Code and Codex files.

Behavior specs under this directory own exact intended behavior for:

- CLI commands and command output;
- configuration format and schema behavior;
- skill and agent source formats;
- Portable AFDS Toolkit lifecycle routing and evidence behavior;
- target rendering for Claude Code and Codex;
- install, sync, uninstall, and diff behavior;
- platform, security, error handling, and testing requirements.

## Shared Boundaries

These boundaries apply across DevCanon behavior specs:

- DevCanon is user-wide only.
- Source artifacts under `skills/`, `agents/`, `docs/`, and `src/` are the
  authoring surfaces.
- Generated outputs under `generated/<target>/` are disposable render results.
- Installed managed outputs are target-home files or directories installed by
  `devcanon sync` and tracked by the install manifest.
- DevCanon does not make generated or installed outputs authoritative source
  files.
- DevCanon does not manage consumer-repository docs as a repository-level
  document manager.
- DevCanon does not duplicate live issue state, PR state, or agent-run state in
  repository docs.

## Behavior Spec Index

- [Core concepts and principles](core-concepts.md)
- [AFDS workflow routing and evidence behavior](afds-workflow-routing.md)
- [Configuration format](configuration.md)
- [Skill specification](skills.md)
- [Agent source schema](agents.md)
- [Target mapping](target-mapping.md)
- [Install and sync policy](install-and-sync.md)
- [CLI command reference](cli-commands.md)
- [Error handling and logging](error-handling.md)
- [Platform and security](platform.md)
- [Testing requirements](testing.md)

## Source Layout Context

Behavior specs use this layout as shared context for source and generated paths:

```text
devcanon/
├─ package.json
├─ devcanon.config.yaml
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

## Installed Target Layout Context

### Claude Target

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

### Codex Target

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
- `devcanon` does not manage `~/.codex/config.toml` in v1.
