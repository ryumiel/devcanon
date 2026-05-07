# Contributing to agents-manager

`AGENTS.md` is the repository entry point. This file is the canonical home for
commit policy, pull request policy, and shared hook usage.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/)

## Getting Started

Start with [AGENTS.md](AGENTS.md) for:

- Build and test commands
- Repository structure and documentation

This repository uses shared hooks from `scripts/hooks/`. Run `pnpm run setup`
to configure them. This sets `core.hooksPath` and the commit message template.
If hooks stop running after local Git config changes, re-run `pnpm run setup` or
manually set `git config core.hooksPath scripts/hooks`.

## Commit Policy

For detailed guidance, examples, and common mistakes, see the [Commit Guideline](docs/guidelines/commit-guideline.md).

- Use Conventional Commits with `type(scope): subject` or `type: subject`; scope is optional but recommended when it adds signal.
- Allowed types: `feat`, `fix`, `refactor`, `perf`, `style`, `test`, `docs`, `build`, `ops`, `chore`.
- Recommended scopes: `cli`, `config`, `render`, `install`, `validate`, `diff`, `doctor`, `skills`, `agents`, `ci`.
- Keep the subject imperative, do not end it with a period, and keep it at or under 80 characters.
- If you add a body, leave one blank line after the subject and wrap each body line at 80 characters.
- A blank body is only acceptable when the change is too trivial to need extra context. If the reader might ask why, what changed behavior, or what follow-up is implied, add a body.
- Use the body for intent, behavior changes, follow-up context, or migration notes. Explain why the change exists and any behavior shifts; do not just restate file moves.
- If you add footers, separate them from the body with one blank line. Use footers for issue links, follow-ups, or breaking-change notes.
- The shared `commit-msg` hook enforces the header format, the no-trailing-period rule, the 80-character subject cap, the blank line after the subject, and 80-character body wrapping. It does not require a body because triviality is a judgment call.

## Branch Naming

**Convention:** `<type>/<scope>-<short-description>` or `<type>/<short-description>` when scope is omitted

The branch name uses one path segment after `type/`. When scope is present, it is the leading prefix of that post-`/` slug, followed by the short description.

- `type` and `scope` follow the same vocabulary as the Commit Policy
- Scope is optional but recommended when it narrows the area
- Use hyphens for word separation in the description (not underscores or camelCase)
- Keep the description short and specific

| Branch name                     | What it means                            |
| ------------------------------- | ---------------------------------------- |
| `feat/render-codex-support`     | New feature in the render module         |
| `fix/config-schema-validation`  | Bug fix in config validation             |
| `docs/review-guideline`         | Documentation addition (no scope needed) |
| `refactor/install-plan-extract` | Refactoring in the install module        |
| `test/sync-integration`         | Test addition for sync                   |

## Pre-commit Checks

The shared `pre-commit` hook enforces the following quality gates on staged files:

- **Case-sensitivity detection** -- catches filenames that differ only in case (breaks Linux CI)
- **Code formatting** -- `biome check` on staged `.ts`, `.js`, `.json` files
- **Code linting** -- `biome lint` on staged code files
- **Markdown formatting** -- Prettier on staged `.md` files
- **Markdown linting** -- markdownlint on staged `.md` files

`pnpm run check:staged` prints concise per-gate summaries by default. For full
child-tool output while debugging, use the command shape that matches your
shell:

- POSIX shells: `AGENTS_MANAGER_PRECOMMIT_VERBOSE=1 pnpm run check:staged`
- PowerShell: `$env:AGENTS_MANAGER_PRECOMMIT_VERBOSE=1; pnpm run check:staged`
- `cmd.exe`: `set AGENTS_MANAGER_PRECOMMIT_VERBOSE=1 && pnpm run check:staged`

## Pull Request Policy

PR titles and descriptions must follow the [PR Guideline](docs/guidelines/pr-guideline.md). Use the GitHub PR template for the required structure.
Review PRs and self-review changes using the [Code Review Guideline](docs/guidelines/code-review-guideline.md).

Every PR should answer:

- **Source schema changed?**
  - Update validation logic in `src/validate/`.
  - Update Zod schemas in `src/config/schema.ts` or `src/models/types.ts`.
- **Renderer output changed?**
  - Update snapshot tests in `src/render/`.
- **CLI commands added or changed?**
  - Update [AGENTS.md](AGENTS.md) command table.
- **Config format changed?**
  - Update `agents-manager.config.yaml` example in [docs/specs/configuration.md](docs/specs/configuration.md).
- **New major path or file added?**
  - Update [MAP.md](MAP.md).
- **Root workflow changed?**
  - Update [AGENTS.md](AGENTS.md).
- **New module or complex feature added?**
  - Update relevant documentation in [docs/specs/](docs/specs/) and [MAP.md](MAP.md).
