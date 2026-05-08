# ADR-0005: Per-Target Skill Rendering

## Status

Accepted

## Context

Before this decision, skills were copied verbatim from
`skills/<name>/` to both `~/.claude/skills/<name>/` and
`~/.agents/skills/<name>/`. The two targets have diverged enough
that a single file cannot satisfy both:

- Codex whitelists skill frontmatter (`name`, `description`,
  `license`, `allowed-tools`, `metadata`) and rejects Claude-only
  keys like `model` or `effort`.
- Claude and Codex accept different model identifiers
  (`claude-opus-4-7` vs `gpt-5.4`).
- Codex configures UI/policy/tool dependencies through a sidecar
  `generated/codex/skills/<name>/agents/openai.yaml` file Claude
  does not understand.

Investigation across 15 existing skills showed body divergence is
concentrated in 3 skills. The majority are already target-neutral.

## Decision

Adopt the existing agent-renderer pattern for skills. A single
`skills/<name>/SKILL.md` is authoritative. At render time it
produces per-target output under
`generated/<target>/skills/<name>/SKILL.md`, plus a Codex-only
`agents/openai.yaml` sidecar when declared.

Authors express divergence in three places:

1. Optional `claude:` / `codex:` frontmatter override blocks.
2. An optional top-level `codex_sidecar:` block (emitted as
   a separate file for the Codex target only).
3. `{{model:fast}}` / `{{model:standard}}` / `{{model:deep}}`
   placeholders in body prose and top-level string values inside
   override blocks, resolved at render time against a `modelTiers`
   glossary in config.

**Namespace scope-lock:** only namespaces declared in
`PlaceholderGlossary` (`model`, `tool`, `file`) are permitted; any
other namespace is rejected at render time. Adding a new namespace
requires a new ADR.

**Substitution scope:**

- Placeholders inside fenced code blocks (backtick or tilde) are
  intentionally not substituted, so authors can document the
  syntax verbatim. A single leading backslash escapes a
  placeholder: `\{{model:x}}` renders literally.
- Substitution is applied to body prose AND to top-level string
  values inside `claude:` / `codex:` override blocks. Nested
  values (for example `codex.metadata.*`) pass through
  unchanged.

## Consequences

- Skills become first-class rendered outputs. Install/sync
  operates on per-target generated directories, not the source.
- `symlink` install mode relinks from source → per-target
  generated directory on next `sync`; handled automatically.
- A glossary in `devcanon.config.yaml` maps tier names to
  target-native model IDs. Changing a tier is one config edit.
- The placeholder system is intentionally minimal. New namespaces
  are added only via the `PlaceholderGlossary` pattern under a new
  ADR; body-level conditionals remain out of scope.

## Alternatives considered

- **Keep everything neutral (superpowers approach):** reject all
  target-specific fields and model names from skill bodies. Too
  restrictive for skills whose behavior depends on reasoning
  depth escalation.
- **Full body templating (`{{#claude}}...{{/claude}}`):** more
  power, more authoring surface, more places to get it wrong.
  Deferred — adopt only when concrete need emerges.
- **Per-target source files (`SKILL.claude.md` /
  `SKILL.codex.md`):** doubles authoring cost and invites drift.

## See also

- [ADR-0006](adr-0006-tool-and-file-placeholders.md) -- adds `{{tool:*}}` and `{{file:*}}` namespaces
- [Skills](../specs/skills.md) -- skill authoring and frontmatter
- [Configuration](../specs/configuration.md) -- `modelTiers` glossary
- [`src/render/placeholders.ts`](../../src/render/placeholders.ts) -- `{{model:*}}` resolver
- [`src/render/skill-claude.ts`](../../src/render/skill-claude.ts) -- Claude skill renderer
- [`src/render/skill-codex.ts`](../../src/render/skill-codex.ts) -- Codex skill renderer (with sidecar)
- [`src/config/schema.ts`](../../src/config/schema.ts) -- frontmatter and config schemas
