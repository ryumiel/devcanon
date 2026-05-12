# DevCanon

A user-wide Node.js CLI and source library for portable
Agent-Friendly Documentation Standard (AFDS) skills, thin agent roles, and
generated Claude Code and Codex files.

DevCanon helps development projects run an AFDS-based product workflow across
Claude Code and Codex while preserving one source of truth for reusable skills
and agent roles.

## What It Does

- **Portable AFDS toolkit** provides reusable skills, thin agent roles, and
  supporting guidance for projects adopting AFDS with GitHub Issues or Linear.
- **Skills** are reusable operational workflows (review checklists, debugging
  methodologies, planning frameworks) shared across AI tools.
- **Agent roles** are defined once in neutral YAML and rendered into native
  formats for each target.
- **Sync** writes installed managed outputs into user home directories via
  symlink or copy, with manifest-based ownership tracking.

Source files are authoritative. Generated outputs are disposable.

## Quick Start

```sh
pnpm install
pnpm run build
pnpm run dev -- sync
```

## Breaking Rename From agents-manager

DevCanon does not support legacy `agents-manager` CLI, config, env-var, or
manifest names. Existing users must uninstall with the old CLI before
installing DevCanon:

```sh
agents-manager uninstall
```

After installing DevCanon, use:

```sh
devcanon sync
```

## Documentation

| Topic                | Location                                                 |
| -------------------- | -------------------------------------------------------- |
| Getting started      | [AGENTS.md](AGENTS.md)                                   |
| Navigation index     | [MAP.md](MAP.md)                                         |
| Product requirements | [docs/product-requirements/](docs/product-requirements/) |
| Behavior specs       | [docs/specs/](docs/specs/)                               |
| Architecture         | [docs/arch/overview.md](docs/arch/overview.md)           |
| Contributing         | [CONTRIBUTING.md](CONTRIBUTING.md)                       |
| Decision records     | [docs/adr/](docs/adr/)                                   |
| Roadmap              | [docs/roadmap/](docs/roadmap/)                           |

## Status

Active development. v1 CLI is implemented with 9 commands, 23 skills, and
support for Claude Code and Codex targets.
