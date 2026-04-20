# agents-manager

A user-wide Node.js CLI that manages shared AI skills and generates native
Claude Code and Codex agent files from a single source of truth.

## What It Does

- **Skills** are reusable operational workflows (review checklists, debugging
  methodologies, planning frameworks) shared across AI tools.
- **Agent roles** are defined once in neutral YAML and rendered into native
  formats for each target.
- **Sync** installs managed outputs into user home directories via symlink or
  copy, with manifest-based ownership tracking.

Source files are authoritative. Generated outputs are disposable.

## Quick Start

```sh
pnpm install
pnpm run build
pnpm run dev -- sync
```

## Documentation

| Topic              | Location                                               |
| ------------------ | ------------------------------------------------------ |
| Getting started    | [AGENTS.md](AGENTS.md)                                 |
| Navigation index   | [MAP.md](MAP.md)                                       |
| Product specs      | [docs/specs/](docs/specs/)                             |
| Architecture       | [docs/arch/overview.md](docs/arch/overview.md)         |
| Contributing       | [CONTRIBUTING.md](CONTRIBUTING.md)                     |
| Decision records   | [docs/adr/](docs/adr/)                                 |

## Status

Active development. v1 CLI is implemented with 9 commands, 15 skills, and
support for Claude Code and Codex targets.
