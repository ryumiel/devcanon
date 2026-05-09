# ADR-0006: `{{tool:*}}` and `{{file:*}}` placeholder namespaces

## Status

Accepted

## Context

ADR-0005 scope-locks placeholders to `{{model:*}}`. Shared skill prose
referencing tool names (e.g. `TodoWrite`) and artifact files
(e.g. `CLAUDE.md`) has only two options under that lock: hard-code the
Claude name (loses Codex correctness) or neutralize entirely (loses
action-ability — readers cannot grep or copy-paste). The resulting
shared-prose drift showed that tool and artifact names needed the same
per-target resolution model as model names.

## Decision

Extend the placeholder system with two new namespaces sharing the
`{claude, codex}` shape of `modelTiers`:

- `{{tool:*}}` resolves against `toolNames.<key>`.
- `{{file:*}}` resolves against `fileArtifacts.<key>`.

Both glossaries live alongside `modelTiers` in
`devcanon.config.yaml`. Resolution semantics (per-target pass,
backslash escape, fenced-code exemption) match ADR-0005 exactly. The
resolver is reshaped to dispatch through a `PlaceholderGlossary` map so
that adding a future namespace is a config + Zod schema change rather
than a resolver edit.

The drift validator auto-derives literal tokens to flag from each
glossary's values, so adding a new mapping (e.g. `{{tool:foo}}: { claude: Foo, codex: bar }`)
also adds `Foo` and `bar` to the drift token set without code changes.

## Consequences

- Adding a future namespace is a smaller change: extend
  `PlaceholderGlossary`, add a Zod schema, thread through `ResolvedConfig`.
  Resolver does not need a new `if`-branch.
- Drift token list is now config-driven for these two namespaces; manual
  hardcoding is unnecessary.
- ADR-0005's namespace scope-lock is relaxed but not removed: namespaces
  in `PlaceholderGlossary` are permitted; adding a new namespace still
  requires a new ADR.
- Skill prose can replace `TodoWrite` / `CLAUDE.md` / `AGENTS.md` with
  placeholders. Migration of existing prose is a separate cleanup from
  this decision.

## Alternatives considered

- **Parallel `else if` branches in `substituteLine`**: minimal patch,
  but namespace-gating becomes a growing chain.
- **Namespace registry** (`Map<namespace, resolver>`): over-engineered
  for three namespaces with identical shape.
- **Hardcode drift tokens for the new namespaces**: rejected. The
  `modelTiers`-derived approach already exists and is strictly better:
  zero maintenance when adding new mappings.

## See also

- [ADR-0005](adr-0005-per-target-skill-rendering.md) — original scope-lock
- [`src/render/placeholders.ts`](../../src/render/placeholders.ts)
- [`src/validate/skills.ts`](../../src/validate/skills.ts)
- [`docs/specs/skills.md`](../specs/skills.md)
- [`docs/guidelines/writing-skills.md`](../guidelines/writing-skills.md)
