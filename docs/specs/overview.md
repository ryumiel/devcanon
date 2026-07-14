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
- Portable AFDS Toolkit lifecycle routing, semantic child routing, mutation
  authority, and evidence behavior;
- target rendering for Claude Code and Codex;
- install, sync, uninstall, and diff behavior;
- platform, security, error handling, and testing requirements.

## Shared Boundaries

These boundaries apply across DevCanon behavior specs:

- DevCanon is user-wide only.
- Source artifacts under `skills/`, `agents/`, `docs/`, and `src/` are the
  authoring surfaces.
- Generated outputs under `generated/<target>/` are disposable render results
  and stay untracked; see
  [Target mapping](target-mapping.md#generated-output-rules).
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

The pre-migration source layout has four legacy agent definitions. The agent
portion of the diagram below is the ADR-0027 post-migration target, not a claim
that those six files already exist while the ADR is Proposed. Acceptance
requires `agents/` and both generated targets to converge on the diagram;
current implementation state is determined from source and a fresh render.

Behavior specs use this target layout as shared context for source and
generated paths:

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
│  ├─ assessor.yaml
│  ├─ deep-reviewer.yaml
│  ├─ executor.yaml
│  ├─ implementer.yaml
│  ├─ investigator.yaml
│  └─ reviewer.yaml
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
- `generated/` is a render preview/debug directory and is not authoritative or
  tracked.

## Installed Target Layout Context

The agent filenames below are likewise the post-migration target. Installed
managed outputs do not prove source convergence and remain derived.

### Claude Target

```text
~/.claude/
└─ skills/
   ├─ pr-review/
   └─ write-product-spec/

~/.claude/agents/
├─ assessor.md
├─ deep-reviewer.md
├─ executor.md
├─ implementer.md
├─ investigator.md
└─ reviewer.md
```

### Codex Target

```text
~/.agents/
└─ skills/
   ├─ pr-review/
   └─ write-product-spec/

~/.codex/agents/
├─ assessor.toml
├─ deep-reviewer.toml
├─ executor.toml
├─ implementer.toml
├─ investigator.toml
└─ reviewer.toml
```

Notes:

- Codex shared skills are installed to `~/.agents/skills`.
- Codex native custom agents are installed to `~/.codex/agents/`.
- `devcanon` does not manage `~/.codex/config.toml` in v1.
- The exact semantic catalog and direct-child routes are owned by the
  [Agent Routing and Mutation Policy](../guidelines/agent-routing-and-mutation-policy.md).
