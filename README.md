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

Before `pnpm run setup:cli`, configure the platform's global executable
directory on `PATH`:

- On macOS, Linux, and WSL, configure pnpm's user-global bin directory. If
  pnpm reports it missing, run `pnpm setup` and follow its shell-reload
  guidance.
- On native Windows, including PowerShell, cmd, and Git Bash, ensure npm's
  global prefix is on `PATH`; `setup:cli` uses npm for global registration.

DevCanon does not modify `PATH`.

```sh
# Clone into a stable location: the globally registered CLI points here, and
# this checkout remains the source library and configuration root.
git clone <repo-url> devcanon
cd devcanon

pnpm install
pnpm run setup:cli
devcanon sync
```

`setup:cli` is a package setup script, not a `devcanon` application
subcommand. It builds and globally registers the CLI from this checkout.
`devcanon sync` is a separate application command that writes managed skills
and agents; registering the CLI does not run sync.

Keep the checkout at its stable path. To run the globally registered CLI from
elsewhere, select that checkout's config explicitly:

```sh
devcanon --config /absolute/path/to/devcanon.config.yaml sync
```

### Refreshing an existing checkout

Update the stable checkout, refresh dependencies, register the updated CLI,
then refresh managed outputs:

```sh
cd /absolute/path/to/devcanon
git pull
pnpm install
pnpm run setup:cli
devcanon sync
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

Active development. The CLI supports Claude Code and Codex targets.
