# agents-manager -- Agent Entry Point

`agents-manager` is a user-wide Node.js CLI that manages shared AI skills and generates native Claude Code and Codex agent files from a single source of truth.

---

## Overview

The tool is designed for **user-wide** setup, not repository-level setup.

- **Skills** are the primary reusable unit -- shared across Claude Code and Codex
- **Agent roles** are defined once in neutral YAML and rendered into native target formats
- **Generated outputs** are installed into the user's home directories via symlink or copy

Agents are thin role wrappers. Prefer skills for reusable workflow method, and
create an agent when stable delegate identity or target-supported constraints
such as dedicated model/effort, tools, sandbox, or approval policy justify it.

Source files are authoritative. Generated outputs are disposable.

For product specs, see [`docs/specs/`](docs/specs/).

---

## Golden Path

The primary end-to-end workflow is:

1. Initialize a library with `agents-manager init`.
2. Create reusable skills under `skills/` with `agents-manager new skill <name>`.
3. Define agent roles in `agents/` with `agents-manager new agent <name>`.
4. Validate source files with `agents-manager validate`.
5. Preview generated outputs with `agents-manager render`.
6. Install to Claude Code and Codex home directories with `agents-manager sync`.
7. Iterate: update skills and agent roles in source, then re-sync to propagate changes.

---

## Quick Start

**Prerequisites:** Node.js >= 18, pnpm

```sh
# Clone the repo
git clone <repo-url>
cd agents-manager

# Install dependencies
pnpm install

# Set up git hooks and commit template
pnpm run setup

# Build
pnpm run build

# Run the CLI in dev mode
pnpm run dev -- <command>
```

---

## Build and Test

```sh
# Build
pnpm run build

# Run tests
pnpm run test

# Run tests in watch mode
pnpm run test:watch

# Run tests with coverage
pnpm run test:coverage

# Format check (Biome)
pnpm run format:check

# Format check (Markdown)
pnpm run format:markdown:check

# Lint (Biome)
pnpm run lint

# Lint (Markdown)
pnpm run lint:markdown

# Run all checks (format + lint + test)
pnpm run check
```

---

## Repository Structure

```
agents-manager/
  README.md                  # GitHub landing page
  package.json               # Project manifest
  tsconfig.json              # TypeScript config
  agents-manager.config.yaml # CLI config (dogfooding)
  biome.json                 # Biome formatter/linter config
  vitest.config.ts           # Vitest test config
  .editorconfig              # Editor settings
  .markdownlint.json         # Markdown lint rules
  .gitmessage.txt            # Commit message template
  .prettierrc.json           # Prettier config (Markdown only)

  src/
    cli/
      index.ts               # CLI entrypoint (commander)
      commands/               # Command implementations
    config/
      load.ts                # Config loader
      schema.ts              # Zod schema for config
      defaults.ts            # Default config values
    models/
      types.ts               # Shared domain types
    validate/
      skills.ts              # Skill validation
      agents.ts              # Agent validation
      config.ts              # Config validation
    render/
      pipeline.ts            # Render orchestration
      claude.ts              # Claude target renderer (.md)
      codex.ts               # Codex target renderer (.toml)
    install/
      sync.ts                # Sync orchestration
      plan.ts                # Install plan computation
      manifest.ts            # Manifest read/write
      copy.ts                # Copy install mode
      symlink.ts             # Symlink install mode
    diff/
      diff.ts                # Diff between generated and installed
    utils/
      errors.ts              # Error types
      fs.ts                  # Filesystem helpers
      hash.ts                # Content hashing
      output.ts              # CLI output formatting
      paths.ts               # Path resolution and normalization

  skills/                    # Shared skill source files
  agents/                    # Neutral agent role definitions (YAML)
  generated/                 # Render preview directory (not authoritative)
    claude/agents/           # Generated Claude agent files (.md)
    codex/agents/            # Generated Codex agent files (.toml)

  docs/
    specs/                   # Product and domain specifications
    arch/
      overview.md            # System architecture overview
    adr/                     # Architecture decision records
    guidelines/              # Engineering rules and norms

  scripts/
    hooks/                   # Shared git hooks
      pre-commit             # Pre-commit quality gates
      commit-msg             # Commit message validation
    format-tracked-markdown.mjs
    lint-tracked-markdown.mjs
    run-pre-commit-checks.mjs
    validate-commit-message.mjs
```

For module responsibilities, dependency rules, and data flow, see
[`docs/arch/overview.md`](docs/arch/overview.md).

---

## CLI Commands

| Command            | Description                                              |
| ------------------ | -------------------------------------------------------- |
| `init`             | Initialize a new agents-manager library                  |
| `new skill <name>` | Scaffold a new skill                                     |
| `new agent <name>` | Scaffold a new agent role                                |
| `validate`         | Validate config, skills, and agents                      |
| `render`           | Generate outputs into `generated/` without installing    |
| `sync`             | Render and install managed outputs to target directories |
| `diff`             | Show differences between generated and installed outputs |
| `doctor`           | Inspect environment health                               |
| `list`             | List known skills and agents                             |

---

## Documentation

| Topic                               | Location                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Product specs                       | [`docs/specs/`](docs/specs/)                                                                               |
| Core concepts and principles        | [`docs/specs/core-concepts.md`](docs/specs/core-concepts.md)                                               |
| Architecture overview               | [`docs/arch/overview.md`](docs/arch/overview.md)                                                           |
| Architecture decisions              | [`docs/adr/`](docs/adr/)                                                                                   |
| Configuration format                | [`docs/specs/configuration.md`](docs/specs/configuration.md)                                               |
| Skill specification                 | [`docs/specs/skills.md`](docs/specs/skills.md)                                                             |
| Agent source schema                 | [`docs/specs/agents.md`](docs/specs/agents.md)                                                             |
| Target mapping (Claude/Codex)       | [`docs/specs/target-mapping.md`](docs/specs/target-mapping.md)                                             |
| Install and sync policy             | [`docs/specs/install-and-sync.md`](docs/specs/install-and-sync.md)                                         |
| CLI command reference               | [`docs/specs/cli-commands.md`](docs/specs/cli-commands.md)                                                 |
| Error handling and logging          | [`docs/specs/error-handling.md`](docs/specs/error-handling.md)                                             |
| Platform and security               | [`docs/specs/platform.md`](docs/specs/platform.md)                                                         |
| Testing requirements                | [`docs/specs/testing.md`](docs/specs/testing.md)                                                           |
| When to create an agent vs. a skill | [`docs/guidelines/agent-authoring-guide.md`](docs/guidelines/agent-authoring-guide.md)                     |
| Writing skills in this repo         | [`docs/guidelines/writing-skills.md`](docs/guidelines/writing-skills.md)                                   |
| Contributing and commit policy      | [`CONTRIBUTING.md`](CONTRIBUTING.md)                                                                       |
| Decision matrix                     | [`AGENTS.md`](AGENTS.md) § Decision Matrix                                                                 |
| Documentation standard              | [`docs/guidelines/documentation-standard.md`](docs/guidelines/documentation-standard.md)                   |
| Shared skill reporting workflow     | [`docs/guidelines/shared-skill-reporting-workflow.md`](docs/guidelines/shared-skill-reporting-workflow.md) |
| Commit guideline                    | [`docs/guidelines/commit-guideline.md`](docs/guidelines/commit-guideline.md)                               |
| PR guideline                        | [`docs/guidelines/pr-guideline.md`](docs/guidelines/pr-guideline.md)                                       |
| Code review guideline               | [`docs/guidelines/code-review-guideline.md`](docs/guidelines/code-review-guideline.md)                     |
| Contributor workflow                | [`WORKFLOW.md`](WORKFLOW.md)                                                                               |
| Project management model            | [`docs/guidelines/project-management-model.md`](docs/guidelines/project-management-model.md)               |
| Navigation index                    | [`MAP.md`](MAP.md)                                                                                         |

---

## Decision Matrix

| **Do without asking:**                                                                                                                                                                                                                                                                                                        | **Ask first:**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **Do not do:**                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fix typos in code and documentation<br>Add or update tests for existing behavior<br>Update stale documentation (broken links, outdated examples)<br>Run the full validation suite (`pnpm run check`)<br>Create follow-up issues for problems found during work<br>Refactor code without changing behavior when scope is small | Change Zod schemas in `src/config/schema.ts` or `src/models/types.ts`<br>Add or remove npm dependencies<br>Move, rename, or delete source files<br>Modify CI workflows (`.github/workflows/`)<br>Modify git hooks (`scripts/hooks/`)<br>Change `docs/specs/`, `AGENTS.md`, or `CONTRIBUTING.md` (except in issues or PRs explicitly about process or docs policy)<br>Create new CLI commands<br>Change rendered output format (Claude `.md` or Codex `.toml`)<br>Modify install/sync behavior that writes to user home directories | Push directly to `main`<br>Merge your own PR without review<br>Skip or bypass pre-commit hooks (`--no-verify`)<br>Commit secrets, credentials, or tokens<br>Expand PR scope beyond the linked issue<br>Delete or overwrite the install manifest without backup<br>Force-push to shared branches |

---

## Key Links

- Navigation index: [`MAP.md`](MAP.md)
- Contributing and commit policy: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Product specs: [`docs/specs/`](docs/specs/)
