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

- Use Conventional Commits with `type(scope): subject` or `type: subject`; scope is optional but recommended when it adds signal.
- Allowed types: `feat`, `fix`, `refactor`, `perf`, `style`, `test`, `docs`, `build`, `ops`, `chore`.
- Recommended scopes: `cli`, `config`, `render`, `install`, `validate`, `diff`, `doctor`, `skills`, `agents`.
- Keep the subject imperative, do not end it with a period, and keep it at or under 80 characters.
- If you add a body, leave one blank line after the subject and wrap each body line at 80 characters.
- A blank body is only acceptable when the change is too trivial to need extra context. If the reader might ask why, what changed behavior, or what follow-up is implied, add a body.
- Use the body for intent, behavior changes, follow-up context, or migration notes. Explain why the change exists and any behavior shifts; do not just restate file moves.
- If you add footers, separate them from the body with one blank line. Use footers for issue links, follow-ups, or breaking-change notes.
- The shared `commit-msg` hook enforces the header format, the no-trailing-period rule, the 80-character subject cap, the blank line after the subject, and 80-character body wrapping. It does not require a body because triviality is a judgment call.

## Pre-commit Checks

The shared `pre-commit` hook enforces the following quality gates on staged files:

- **Case-sensitivity detection** -- catches filenames that differ only in case (breaks Linux CI)
- **Code formatting** -- `biome check` on staged `.ts`, `.js`, `.json` files
- **Code linting** -- `biome lint` on staged code files
- **Markdown formatting** -- Prettier on staged `.md` files
- **Markdown linting** -- markdownlint on staged `.md` files

## Pull Request Policy

Every PR should answer:

- **Source schema changed?**
  - Update validation logic in `src/validate/`.
  - Update Zod schemas in `src/config/schema.ts` or `src/models/types.ts`.
- **Renderer output changed?**
  - Update snapshot tests in `src/render/`.
- **CLI commands added or changed?**
  - Update [AGENTS.md](AGENTS.md) command table.
- **Config format changed?**
  - Update `agents-manager.config.yaml` example in [SPEC.md](SPEC.md).
- **New major path or file added?**
  - Update [MAP.md](MAP.md).
- **Root workflow changed?**
  - Update [AGENTS.md](AGENTS.md).
- **New module or complex feature added?**
  - Update relevant documentation in [SPEC.md](SPEC.md) and [MAP.md](MAP.md).
