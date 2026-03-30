# MAP -- Where is X?

Quick navigation index for the agents-manager repository.

---

## Project entry points

- Where is the agent entry point? -> [`AGENTS.md`](AGENTS.md)
- Where is the Claude Code entry point? -> [`CLAUDE.md`](CLAUDE.md)
- Where is this navigation index? -> [`MAP.md`](MAP.md)
- Where is the contributing and commit policy? -> [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Where is the product spec? -> [`SPEC.md`](SPEC.md)

---

## Build and workspace

- Where are build and test commands? -> [`AGENTS.md`](AGENTS.md) § Build and Test
- Where is the project manifest? -> [`package.json`](package.json)
- Where is the TypeScript config? -> [`tsconfig.json`](tsconfig.json)
- Where is the Biome config? -> [`biome.json`](biome.json)
- Where is the Vitest config? -> [`vitest.config.ts`](vitest.config.ts)
- Where is the CLI config (dogfooding)? -> [`agents-manager.config.yaml`](agents-manager.config.yaml)

---

## CLI

- Where is the CLI entrypoint? -> [`src/cli/index.ts`](src/cli/index.ts)
- Where are the CLI command implementations? -> [`src/cli/commands/`](src/cli/commands/)

---

## Config

- Where is the config loader? -> [`src/config/load.ts`](src/config/load.ts)
- Where is the config Zod schema? -> [`src/config/schema.ts`](src/config/schema.ts)
- Where are the config defaults? -> [`src/config/defaults.ts`](src/config/defaults.ts)

---

## Models

- Where are the shared domain types? -> [`src/models/types.ts`](src/models/types.ts)

---

## Validation

- Where is skill validation? -> [`src/validate/skills.ts`](src/validate/skills.ts)
- Where is agent validation? -> [`src/validate/agents.ts`](src/validate/agents.ts)
- Where is config validation? -> [`src/validate/config.ts`](src/validate/config.ts)

---

## Rendering

- Where is the render pipeline? -> [`src/render/pipeline.ts`](src/render/pipeline.ts)
- Where is the Claude renderer? -> [`src/render/claude.ts`](src/render/claude.ts)
- Where is the Codex renderer? -> [`src/render/codex.ts`](src/render/codex.ts)

---

## Install and sync

- Where is the sync orchestration? -> [`src/install/sync.ts`](src/install/sync.ts)
- Where is the install plan computation? -> [`src/install/plan.ts`](src/install/plan.ts)
- Where is the manifest read/write? -> [`src/install/manifest.ts`](src/install/manifest.ts)
- Where is the copy install mode? -> [`src/install/copy.ts`](src/install/copy.ts)
- Where is the symlink install mode? -> [`src/install/symlink.ts`](src/install/symlink.ts)

---

## Diff

- Where is the diff logic? -> [`src/diff/diff.ts`](src/diff/diff.ts)

---

## Utilities

- Where are error types? -> [`src/utils/errors.ts`](src/utils/errors.ts)
- Where are filesystem helpers? -> [`src/utils/fs.ts`](src/utils/fs.ts)
- Where is content hashing? -> [`src/utils/hash.ts`](src/utils/hash.ts)
- Where is managed header generation? -> [`src/utils/managed-header.ts`](src/utils/managed-header.ts)
- Where is CLI output formatting? -> [`src/utils/output.ts`](src/utils/output.ts)
- Where is path resolution? -> [`src/utils/paths.ts`](src/utils/paths.ts)

---

## Source content

- Where are shared skill source files? -> [`skills/`](skills/)
- Where are agent role definitions? -> [`agents/`](agents/)
- Where are generated preview outputs? -> [`generated/`](generated/)

---

## Scripts and hooks

- Where are git hooks? -> [`scripts/hooks/`](scripts/hooks/)
- Where is the pre-commit check runner? -> [`scripts/run-pre-commit-checks.mjs`](scripts/run-pre-commit-checks.mjs)
- Where is the commit message validator? -> [`scripts/validate-commit-message.mjs`](scripts/validate-commit-message.mjs)
- Where is the markdown formatter? -> [`scripts/format-tracked-markdown.mjs`](scripts/format-tracked-markdown.mjs)
- Where is the markdown linter? -> [`scripts/lint-tracked-markdown.mjs`](scripts/lint-tracked-markdown.mjs)
- Where is the commit message template? -> [`.gitmessage.txt`](.gitmessage.txt)
