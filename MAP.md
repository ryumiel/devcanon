# MAP -- Where is X?

Quick navigation index for the agents-manager repository.

---

## Project entry points

- Where is the GitHub landing page? -> [`README.md`](README.md)
- Where is the agent entry point? -> [`AGENTS.md`](AGENTS.md)
- Where is the Claude Code entry point? -> [`CLAUDE.md`](CLAUDE.md)
- Where is this navigation index? -> [`MAP.md`](MAP.md)
- Where is the contributing and commit policy? -> [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Where is the decision matrix? -> [`AGENTS.md`](AGENTS.md) § Decision Matrix
- Where is the contributor workflow? -> [`WORKFLOW.md`](WORKFLOW.md)
- Where are product specs? -> [`docs/specs/`](docs/specs/)
- Where is the product overview? -> [`docs/specs/overview.md`](docs/specs/overview.md)
- Where are core concepts and principles? -> [`docs/specs/core-concepts.md`](docs/specs/core-concepts.md)
- Where is the config format spec? -> [`docs/specs/configuration.md`](docs/specs/configuration.md)
- Where is the skill spec? -> [`docs/specs/skills.md`](docs/specs/skills.md)
- Where is the agent schema spec? -> [`docs/specs/agents.md`](docs/specs/agents.md)
- Where is the target mapping spec? -> [`docs/specs/target-mapping.md`](docs/specs/target-mapping.md)
- Where is the install/sync spec? -> [`docs/specs/install-and-sync.md`](docs/specs/install-and-sync.md)
- Where is the CLI command spec? -> [`docs/specs/cli-commands.md`](docs/specs/cli-commands.md)
- Where is the error handling spec? -> [`docs/specs/error-handling.md`](docs/specs/error-handling.md)
- Where is the platform/security spec? -> [`docs/specs/platform.md`](docs/specs/platform.md)
- Where is the testing requirements spec? -> [`docs/specs/testing.md`](docs/specs/testing.md)

---

## Build and workspace

- Where are build and test commands? -> [`AGENTS.md`](AGENTS.md) § Build and Test
- Where is the project manifest? -> [`package.json`](package.json)
- Where is the TypeScript config? -> [`tsconfig.json`](tsconfig.json)
- Where is the Biome config? -> [`biome.json`](biome.json)
- Where is the Vitest config? -> [`vitest.config.ts`](vitest.config.ts)
- Where is the CLI config (dogfooding)? -> [`agents-manager.config.yaml`](agents-manager.config.yaml)

---

## Architecture and decisions

- Where is the system architecture overview? -> [`docs/arch/overview.md`](docs/arch/overview.md)
- Where are architecture decision records? -> [`docs/adr/`](docs/adr/)
- Where is the ADR template? -> [`docs/adr/adr-template.md`](docs/adr/adr-template.md)

---

## Guidelines and templates

- Where is the documentation standard? -> [`docs/guidelines/documentation-standard.md`](docs/guidelines/documentation-standard.md)
- Where is guidance on choosing an agent vs. a skill? -> [`docs/guidelines/agent-authoring-guide.md`](docs/guidelines/agent-authoring-guide.md)
- Where are the documentation checklists? -> [`docs/guidelines/documentation-checklists.md`](docs/guidelines/documentation-checklists.md)
- Where is the commit guideline? -> [`docs/guidelines/commit-guideline.md`](docs/guidelines/commit-guideline.md)
- Where is the PR guideline? -> [`docs/guidelines/pr-guideline.md`](docs/guidelines/pr-guideline.md)
- Where is the code review guideline? -> [`docs/guidelines/code-review-guideline.md`](docs/guidelines/code-review-guideline.md)
- Where is the project management model? -> [`docs/guidelines/project-management-model.md`](docs/guidelines/project-management-model.md)
- Where are the Copilot review instructions? -> [`.github/copilot-instructions.md`](.github/copilot-instructions.md)
- Where are the TypeScript review instructions? -> [`.github/instructions/review-ts.instructions.md`](.github/instructions/review-ts.instructions.md)
- Where is the PR template? -> [`.github/pull_request_template.md`](.github/pull_request_template.md)
- Where is the branch naming convention? -> [`CONTRIBUTING.md`](CONTRIBUTING.md) § Branch Naming

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
- Where is the Claude agent renderer? -> [`src/render/claude.ts`](src/render/claude.ts)
- Where is the Codex agent renderer? -> [`src/render/codex.ts`](src/render/codex.ts)
- Where is the skill render orchestrator? -> [`src/render/skill.ts`](src/render/skill.ts)
- Where is the Claude skill renderer? -> [`src/render/skill-claude.ts`](src/render/skill-claude.ts)
- Where is the Codex skill renderer (with sidecar)? -> [`src/render/skill-codex.ts`](src/render/skill-codex.ts)
- Where is the `{{model:*}}` placeholder resolver? -> [`src/render/placeholders.ts`](src/render/placeholders.ts)
- Where is frontmatter parse/serialize? -> [`src/render/frontmatter.ts`](src/render/frontmatter.ts)

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
- Where is the filesystem-safe name regex? -> [`src/utils/naming.ts`](src/utils/naming.ts)
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
