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

**Prerequisites:** Node.js `>=24.0.0` and pnpm `10.33.0`.

### Breaking Rename From agents-manager

If you are migrating from `agents-manager`, run the old CLI's uninstall command
before installing DevCanon.

```sh
agents-manager uninstall
```

DevCanon uses new CLI, config, environment variable, and manifest names.

### Configure PATH

Before installing or refreshing DevCanon, make sure your platform's global
executable directory is on `PATH`.

- **Native Windows** (PowerShell, cmd, or Git Bash). Run
  `npm config get prefix` to find npm's global prefix and add that directory
  to `PATH` if needed. Open a new shell after changing `PATH` so it picks up
  the change. DevCanon uses npm for global registration on native Windows.
- **macOS, Linux, or WSL.** Use pnpm's user-global bin directory. If pnpm
  reports that the directory is missing, run `pnpm setup` and follow its
  shell-reload guidance before continuing.

DevCanon does not modify `PATH`.

### First install

Clone into a stable location and keep the checkout there. The globally
registered CLI points to it, and the checkout remains the source library
and default configuration root.

```sh
git clone https://github.com/ryumiel/devcanon.git
cd devcanon
pnpm install
pnpm run setup:cli
devcanon sync
```

`pnpm run setup:cli` builds the CLI and registers it from the checkout.
`devcanon sync` separately installs the managed skills and agents into your
configured target directories. Contributors can use `pnpm run setup` to
configure Git hooks and the commit template. See
[contributor hook setup](CONTRIBUTING.md#getting-started).

### Refreshing an existing checkout

Check your [PATH setup](#configure-path), then update the stable checkout,
refresh dependencies, register the updated CLI, and sync managed outputs.

```sh
cd "/absolute/path/to/devcanon"
git pull
pnpm install
pnpm run setup:cli
devcanon sync
```

### Selecting the checkout config from another directory

To run the registered CLI from another directory with the stable checkout's
config, pass its absolute config path before the subcommand.

```sh
devcanon --config "/absolute/path/to/devcanon/devcanon.config.yaml" sync
```

## Documentation

| Topic                  | Location                                                 |
| ---------------------- | -------------------------------------------------------- |
| Repository orientation | [AGENTS.md](AGENTS.md)                                   |
| Navigation index       | [MAP.md](MAP.md)                                         |
| Product requirements   | [docs/product-requirements/](docs/product-requirements/) |
| Behavior specs         | [docs/specs/](docs/specs/)                               |
| Architecture           | [docs/arch/overview.md](docs/arch/overview.md)           |
| Contributing           | [CONTRIBUTING.md](CONTRIBUTING.md)                       |
| Decision records       | [docs/adr/](docs/adr/)                                   |
| Roadmap                | [docs/roadmap/](docs/roadmap/)                           |

## Status

Active development. The CLI supports Claude Code and Codex targets.
