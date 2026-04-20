# Documentation Checklists

Quick operational checklists that complement
[documentation-standard.md](documentation-standard.md). Keep policy and
rationale in that doc; use this file for fast review and gardening lookup.

## Change Review Checklist

- Zod schemas or types changed: update validation logic, related tests, and
  `docs/specs/` if the change affects user-facing format.
- Docs or code moved, or a new major path added: update `MAP.md`.
- Root entry or workflow changed: update `AGENTS.md` for entry-point guidance
  and `WORKFLOW.md` for procedural flow changes.
- CLI command added or changed: update `AGENTS.md` command table and
  `docs/specs/cli-commands.md`.
- Config format changed: update `docs/specs/configuration.md`.
- Renderer output format changed: update snapshot tests in `src/render/`.
- Durable design decision made: add or update an ADR in `docs/adr/`.
- Structural debt discovered or resolved: update `docs/tech-debt/` (when it
  exists).
- Validation needed: run `pnpm run check` (format + lint + test).

## Gardening Review Checklist

- Can a newcomer find `AGENTS.md`, `MAP.md`, and `docs/arch/overview.md`
  quickly?
- Does every active doc have one clear owning location?
- Has durable content been merged into owned docs instead of parked in
  ephemeral files?
- Have stale docs been deleted after useful content was extracted?
- Is `AGENTS.md` still under ~900 words and scannable in under 2 minutes?
- Does `MAP.md` cover all major files and directories?

## Validation Commands

- `pnpm run check` -- run all checks (format + lint + test)
- `pnpm run format:check` -- Biome formatting check
- `pnpm run format:markdown:check` -- Prettier markdown formatting check
- `pnpm run lint` -- Biome linting
- `pnpm run lint:markdown` -- markdownlint on all markdown files
- `pnpm run test` -- run tests
- `pnpm run test:coverage` -- run tests with coverage
