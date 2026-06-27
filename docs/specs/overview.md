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

A behavior spec is a durable repository artifact that owns exact intended
behavior, requirements, boundaries, acceptance criteria, verification
expectations, and agent-facing context for behavior stable enough to execute
against.

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
- Most generated outputs under `generated/<target>/` are disposable render
  results. Selected tracked generated support files are derived review evidence;
  see [Target mapping](target-mapping.md#generated-output-rules).
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
- [AFDS mechanical documentation checks](afds-mechanical-documentation-checks.md)
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
│  │  └─ ...
│  └─ write-product-spec/
│     └─ SKILL.md
├─ agents/
│  ├─ code-quality-reviewer.yaml
│  ├─ implementer.yaml
│  ├─ research-agent.yaml
│  └─ spec-compliance-reviewer.yaml
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
- `generated/` is primarily a render preview/debug directory and is not
  authoritative; selected tracked support files remain derived evidence from
  source.

## Installed Target Layout Context

### Claude Target

```text
~/.claude/
└─ skills/
   ├─ pr-review/
   └─ write-product-spec/

~/.claude/agents/
├─ code-quality-reviewer.md
├─ implementer.md
├─ research-agent.md
└─ spec-compliance-reviewer.md
```

### Codex Target

```text
~/.agents/
└─ skills/
   ├─ pr-review/
   └─ write-product-spec/

~/.codex/agents/
├─ code-quality-reviewer.toml
├─ implementer.toml
├─ research-agent.toml
└─ spec-compliance-reviewer.toml
```

Notes:

- Codex shared skills are installed to `~/.agents/skills`.
- Codex native custom agents are installed to `~/.codex/agents/`.
- `devcanon` does not manage `~/.codex/config.toml` in v1.
