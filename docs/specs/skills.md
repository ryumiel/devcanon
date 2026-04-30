# Skill Specification

---

## Required structure

Each skill is a directory under `skills/` and must contain:

- `SKILL.md` with YAML frontmatter + Markdown body.

---

## Frontmatter schema

Frontmatter is `.strict()` — unknown top-level keys are rejected.
Three optional top-level keys (`claude`, `codex`, `codex_sidecar`)
host target-specific overrides; the rest are shared.

### Shared keys (emitted to both targets)

| Key             | Type           | Required | Notes                                           |
| --------------- | -------------- | -------- | ----------------------------------------------- |
| `name`          | string         | yes      | `^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$`, ≤ 64 chars |
| `description`   | string         | yes      | ≤ 1024 chars, no `<` / `>`                      |
| `allowed-tools` | string or list | no       | Space-separated string or YAML list             |

### Optional per-target override blocks

`claude:` accepts Claude-specific frontmatter fields (`model`,
`effort`, `when_to_use`, `argument-hint`, `arguments`,
`disable-model-invocation`, `user-invocable`, `context`, `agent`,
`paths`, `shell`). Strict — unknown keys are rejected.

`codex:` accepts Codex-whitelisted fields (`license`, `metadata`).
Strict.

Placeholder substitution inside override blocks is applied to
top-level string values only. Nested values (for example
`codex.metadata.*`) pass through unchanged.

### Codex sidecar

`codex_sidecar:` is a top-level block. When present in the source,
the renderer emits it for the Codex target only as a separate YAML
file at `generated/codex/skills/<name>/agents/openai.yaml`. It is
not inlined into the Codex `SKILL.md`. Supports `interface.*`,
`policy.*`, `dependencies.*`, each strict.

---

## Description style

The `description` field is what both Claude and Codex pre-load into
context to decide whether a skill applies to the current task. The
shared `description` is rendered identically into both targets, so
it must satisfy both upstream conventions — which agree on the same
shape:

- Anthropic's official skill-authoring guide and `anthropics/skills`
  repo prescribe **what + when**.
- Codex's `skill-creator` skill prescribes the same: "Include both
  what the Skill does and specific triggers/contexts for when to
  use it."

**Rule:** name the capability, then name the trigger. Third person.

- **What** — a third-person declarative clause naming what the
  skill does. The reader should know what kind of work the skill
  is for from the first sentence.
- **When** — explicit triggers led by "Use when…": situations,
  artifacts, user phrases, error symptoms.
- **Distinguishing detail** when sibling skills exist — add a
  "Do not use when…" or contrastive cue. Distinct names alone
  are not enough once the catalog grows.

**Do not** encode procedural detail (step counts, ordered stage
names, decision branches). The description is pre-loaded
unconditionally; a procedural one-liner can substitute for the
body and cause the model to skip nuance the body owns. Describe
capability and trigger, not the process.

### Examples

```yaml
# ❌ Trigger-only — omits the "what", can't disambiguate from siblings
description: Use when reviewing code on a local branch before creating a PR.

# ❌ Procedural summary — encodes the workflow into the description
description: Reviews a branch by running spec-compliance review then code-quality review.

# ✅ What + when, no procedure
description: Multi-agent code review of uncommitted changes on a local branch. Use when reviewing a branch before creating a PR or when the user asks to review changes without a GitHub PR.
```

```yaml
# ❌ Procedural summary
description: Use when implementing — dispatches a subagent per task with two-stage review between tasks.

# ✅ What + when
description: Executes an implementation plan by dispatching a fresh subagent per independent task. Use when running a written plan whose tasks have no shared state.
```

### Red flags

A description that contains any of these has leaked the procedure
into the description and should be rewritten:

- A count: "two reviews", "three stages", "five steps".
- An ordered sequence: "first… then…", "before X, after Y".
- A branching word: "when X do Y, otherwise Z".
- First or second person: "I", "you", "we", "our".

### Constraints (mechanical)

- `description` is required.
- ≤ 1024 chars (hard cap from schema); aim for ≤ 500.
- No `<` or `>`.
- No first or second person.

---

## Placeholders

Three placeholder namespaces resolve at render time against
glossaries in `agents-manager.config.yaml`:

- `{{model:<tier>}}` against `modelTiers` (e.g. `{{model:deep}}`).
- `{{tool:<key>}}` against `toolNames` (e.g.
  `{{tool:task-tracker}}`).
- `{{file:<key>}}` against `fileArtifacts` (e.g.
  `{{file:project-instructions}}`).

All three share the same shape: each glossary entry is a
`{claude, codex}` pair. During the Claude render pass, the entry's
`claude` value is substituted; during the Codex pass, the `codex`
value. The same skill source therefore produces different rendered
strings in `generated/claude/...` and `generated/codex/...`.

Escape with a leading backslash: `\{{model:deep}}`,
`\{{tool:task-tracker}}`, `\{{file:project-instructions}}`.
Placeholders inside fenced code blocks (backtick or tilde) are
not substituted.

Other namespaces are rejected at render time. The renderer also
re-validates each captured key against the namespace's stricter
config-time format -- the runtime regex `[\w-]+` is intentionally
permissive for matching, but a key that does not match the
namespace's contract (`^\w+$` for `model`, `^[a-z0-9][a-z0-9-]*$`
for `tool` / `file`) raises an "invalid placeholder key" error
before glossary lookup, so e.g. `{{tool:taskTracker}}` fails
fast rather than appearing as an undefined entry.

---

## Shared prose conventions

- Use `{{model:fast}}`, `{{model:standard}}`, and
  `{{model:deep}}` for reasoning-tier references in shared
  skill bodies.
- Use `{{tool:<key>}}` and `{{file:<key>}}` for tool and
  artifact names whose spelling differs across targets. Example:
  `{{tool:task-tracker}}` instead of literal `TodoWrite`;
  `{{file:project-instructions}}` instead of literal `CLAUDE.md`.
- Prefer neutral worktree and path language in shared prose.
  Avoid hard-coded product-specific home paths.
- Describe delegation, review, and skill invocation by intent
  rather than product-specific API spellings.

In `validate`, drift diagnostics cover reasoning tiers, tool
names, artifact files, and target-specific path segments in
shared prose. The token list is auto-derived from `modelTiers`,
`toolNames`, and `fileArtifacts`; new entries become drift tokens
automatically. The path check additionally flags `.claude/`,
`.codex/`, and `.agents/`. Diagnostics are reported as warnings
in normal mode and as validation failures in `validate --strict`.

---

## Optional content

A skill may also contain:

- `assets/`
- `examples/`
- `references/`
- `scripts/`

These subdirectories are mirrored per target into
`generated/<target>/skills/<name>/` as-is.

---

## Validation rules

- Skill directory name must be filesystem-safe.
- `SKILL.md` must exist.
- Frontmatter must parse and match `SkillSourceSchema`.
- Frontmatter `name` must equal the directory name.
- Skill names must be unique.
- Every `{{X:Y}}` placeholder must use `X` ∈ {`model`, `tool`,
  `file`}, and `Y` must be defined in the corresponding glossary
  (`modelTiers`, `toolNames`, or `fileArtifacts`).
- Glossary key formats differ by namespace: `modelTiers` keys
  match `^\w+$` (letters, digits, underscores; e.g.
  `fast`, `standard`, `deep`); `toolNames` and `fileArtifacts`
  keys match `^[a-z0-9][a-z0-9-]*$` (lowercase, digits, hyphens;
  e.g. `task-tracker`, `project-instructions`).
- Broken internal symlinks are errors.

---

## Install behavior

Per-target rendered outputs live under:

- `generated/claude/skills/<name>/`
- `generated/codex/skills/<name>/`

At install time they are linked or copied to:

- Claude: `~/.claude/skills/<name>/`
- Codex: `~/.agents/skills/<name>/`

Each target is treated as a separate install target.

---

## Example

```markdown
---
name: example-skill
description: Use when X. Triggers on Y.
allowed-tools: Bash Read Grep

claude:
  model: "{{model:deep}}"
  effort: high

codex:
  license: MIT
  metadata:
    short-description: "Short blurb for Codex UI"

codex_sidecar:
  interface:
    display_name: Example Skill
    brand_color: "#00ccff"
  policy:
    allow_implicit_invocation: true
---

# Example

Use {{model:deep}} for synthesis, then {{model:fast}} for cleanup.
```

---

## Shipped examples

The synthetic example above shows the full shape. These shipped skills show
when each block is actually useful:

- `skills/github-issue-priming/SKILL.md` uses `claude.model` because its
  workflow orchestrates gate, research, planning, and execution. The same
  pattern also appears in `skills/linear-issue-priming/SKILL.md`.
- `skills/github-issue-priming/SKILL.md` and
  `skills/linear-issue-priming/SKILL.md` use
  `codex.metadata.short-description` in rendered Codex frontmatter and
  `codex_sidecar.interface` in the emitted Codex sidecar.
- `skills/pr-review/SKILL.md` uses `codex_sidecar.interface` without a
  `codex:` block because it benefits from a Codex UI label/description without
  needing extra Codex frontmatter overrides.

```yaml
claude:
  model: "{{model:deep}}"

codex:
  license: MIT
  metadata:
    short-description: Prime a GitHub issue into a research-backed implementation workflow

codex_sidecar:
  interface:
    display_name: GitHub Issue Priming
    short_description: Research and stage a GitHub issue for implementation
    brand_color: "#24292f"
```

```yaml
codex_sidecar:
  interface:
    display_name: PR Review
    short_description: Run a multi-agent review of a GitHub pull request
    brand_color: "#0969da"
```

---

## See also

- [Agent source schema](agents.md) — agents reference skills
- [Install and sync](install-and-sync.md) — how skills are installed
- [Target mapping](target-mapping.md) — skill install paths per target
- [ADR-0005](../adr/adr-0005-per-target-skill-rendering.md) — decision record
