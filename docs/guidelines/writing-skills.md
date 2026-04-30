# Writing Skills

This guide covers how to author or edit skills under `skills/` in this
repository: the project-specific layer that the
[skill spec](../specs/skills.md) and the
[`play-skill-authoring`](../../skills/play-skill-authoring/SKILL.md) skill
do not cover.

For general skill-writing discipline (TDD with subagent pressure scenarios,
rationalization tables, anti-patterns), use `play-skill-authoring`. For the
authoritative frontmatter schema, see `docs/specs/skills.md`. This guide
focuses on the dual-target rendering pipeline and the local authoring loop.

## 1. Skill, Agent, or Project Doc?

Default to a skill for reusable operational knowledge — workflows,
checklists, reference material, and methods that apply across projects.

Choose differently when:

- You need a role wrapper with tool, sandbox, or model constraints. Create
  an agent. See [`agent-authoring-guide.md`](agent-authoring-guide.md).
- The content is a project rule or convention specific to this repo. Put it
  in [`AGENTS.md`](../../AGENTS.md) or a `docs/guidelines/` doc.
- The constraint is mechanically enforceable (regex, schema, validator).
  Automate it; reserve documentation for judgment calls.

## 2. Authoring Loop

Skills in this repo render to two targets (Claude Code and Codex). The
local loop is:

1. Scaffold: `pnpm run dev -- new skill <name>`.
2. Edit `skills/<name>/SKILL.md`, plus optional `assets/`, `examples/`,
   `references/`, or `scripts/` subdirectories. These mirror per target
   into `generated/<target>/skills/<name>/` as-is.
3. Validate: `pnpm run dev -- validate`. Use `validate --strict` to
   promote shared-prose drift warnings (see § 5) into errors before
   committing.
4. Render: `pnpm run dev -- render`. Inspect both
   `generated/claude/skills/<name>/` and `generated/codex/skills/<name>/`
   to confirm each target receives the expected frontmatter and body.
5. Diff: `pnpm run dev -- diff` against installed home directories.
6. Sync: `pnpm run dev -- sync` writes to `~/.claude/skills/<name>/` and
   `~/.agents/skills/<name>/`. Install mode (symlink vs. copy) determines
   whether subsequent renders are picked up automatically; see
   [`shared-skill-reporting-workflow.md`](shared-skill-reporting-workflow.md)
   § 5 for the install-mode note.

## 3. Dual-Target Frontmatter

Frontmatter is strict: unknown top-level keys are rejected. Three optional
override blocks (`claude:`, `codex:`, `codex_sidecar:`) host
target-specific fields; everything else is shared and emitted to both
targets. Reach for an override block only when the shared default is
inadequate.

### Shared-only (default)

Most skills need only `name`, `description`, and optionally
`allowed-tools`. Examples: `branch-review`, `pr-merge`,
`play-verification`.

### `claude:` for model and effort

Use when a Claude run benefits from a specific reasoning tier or effort.
The `claude:` block accepts `model`, `effort`, `when_to_use`,
`argument-hint`, `arguments`, `disable-model-invocation`,
`user-invocable`, `context`, `agent`, `paths`, and `shell`.

```yaml
claude:
  model: "{{model:deep}}"
```

Shipped example: `skills/github-issue-priming/SKILL.md` uses
`{{model:deep}}` because its workflow orchestrates gate, research,
planning, and execution.

### `codex:` for license and metadata

Use to set Codex-specific frontmatter that ships in the rendered Codex
`SKILL.md`. Accepts `license` and `metadata`.

```yaml
codex:
  license: MIT
  metadata:
    short-description: Prime a GitHub issue into a research-backed implementation workflow
```

### `codex_sidecar:` for Codex UI

The sidecar emits a separate
`generated/codex/skills/<name>/agents/openai.yaml` for the Codex target
only — it is not inlined into the Codex `SKILL.md`. Use it when the skill
benefits from a Codex UI label, description, or brand color. Accepts
`interface`, `policy`, and `dependencies`.

`skills/pr-review/SKILL.md` uses `codex_sidecar:` without a `codex:`
block: it needs a UI label but no extra Codex frontmatter.

```yaml
codex_sidecar:
  interface:
    display_name: PR Review
    short_description: Run a multi-agent review of a GitHub pull request
    brand_color: "#0969da"
```

## 4. Placeholders

Three placeholder namespaces resolve at render time against
glossaries in
[`agents-manager.config.yaml`](../../agents-manager.config.yaml):

- `{{model:fast}}`, `{{model:standard}}`, `{{model:deep}}` for
  reasoning-tier references.
- `{{tool:<key>}}` for tool names that differ across targets, e.g.
  `{{tool:task-tracker}}` → `TodoWrite` (Claude) / `update_plan`
  (Codex).
- `{{file:<key>}}` for artifact files, e.g.
  `{{file:project-instructions}}` → `CLAUDE.md` (Claude) /
  `AGENTS.md` (Codex).

Rules:

- Only `model:`, `tool:`, and `file:` namespaces are permitted;
  other namespaces are validation errors.
- Escape with a leading backslash: `\{{tool:task-tracker}}`.
- Placeholders inside fenced code blocks (backtick or tilde) are
  not substituted.
- Override-block top-level string values are substituted; nested
  values (for example `codex.metadata.*`) pass through unchanged.

Glossaries (`modelTiers`, `toolNames`, `fileArtifacts`) are
config-driven. Adding a new key is a one-line edit to
`agents-manager.config.yaml`.

## 5. Shared-Prose Conventions

Shared body prose must read sensibly under both targets.

1. Use placeholders (`{{model:*}}`, `{{tool:*}}`, `{{file:*}}`)
   for target-specific names whenever a glossary entry exists or
   can be added.
2. Use intent-based language (e.g. "task tracker", "project
   instructions file") when no concrete spelling adds value or
   when the prose is conceptual rather than operational.
3. Avoid hard-coded product-specific home paths.

Drift diagnostics flag literal target-specific tokens (model IDs,
tool names, artifact files, and target paths). Token sets for
models, tools, and files are auto-derived from
`agents-manager.config.yaml`; the path check covers `.claude/`,
`.codex/`, and `.agents/`.

`pnpm run dev -- validate` reports drift as a warning.
`validate --strict` treats it as a failure; run that before
opening a PR.

## 6. Testing

The general discipline lives in
[`play-skill-authoring`](../../skills/play-skill-authoring/SKILL.md):
RED (baseline pressure scenarios with subagents) → GREEN (write the
minimal skill) → REFACTOR (close loopholes). Apply it to new skills and
to non-trivial edits.

In addition, this repo expects:

- `pnpm run dev -- validate --strict` passes.
- Both rendered outputs (`generated/claude/skills/<name>/` and
  `generated/codex/skills/<name>/`) read correctly under their target.
- Tests under `src/render/` that snapshot shipped skill metadata are
  updated in the same PR if the change affects them.

## 7. PR Checklist for `skills/` Changes

- [ ] Frontmatter validates and uses an override block only when the
      shared default is inadequate.
- [ ] Both rendered targets diffed locally and read correctly.
- [ ] `pnpm run dev -- validate --strict` passes.
- [ ] Any supporting files validate per
      [`../specs/skills.md`](../specs/skills.md).
- [ ] Snapshot tests for shipped skill metadata updated if affected.
- [ ] [`MAP.md`](../../MAP.md) and [`AGENTS.md`](../../AGENTS.md) updated
      if a new skill or doc is introduced (per
      [`documentation-standard.md`](documentation-standard.md) § 5.2).
- [ ] PR follows [`pr-guideline.md`](pr-guideline.md) and the relevant
      items from
      [`documentation-checklists.md`](documentation-checklists.md).

## 8. See Also

- [`../specs/skills.md`](../specs/skills.md) — frontmatter schema and
  validation rules
- [`../specs/target-mapping.md`](../specs/target-mapping.md) — install
  paths per target
- [`../adr/adr-0005-per-target-skill-rendering.md`](../adr/adr-0005-per-target-skill-rendering.md)
  — decision record for per-target skill rendering
- [`../../skills/play-skill-authoring/SKILL.md`](../../skills/play-skill-authoring/SKILL.md)
  — TDD-for-skills discipline
- [`agent-authoring-guide.md`](agent-authoring-guide.md) — when to create
  an agent instead
