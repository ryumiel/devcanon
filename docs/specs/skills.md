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
| `name`          | string         | yes      | `^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$`, 2-64 chars |
| `description`   | string         | yes      | ≤ 1024 chars, no `<` / `>`                      |
| `allowed-tools` | string or list | no       | Non-empty space-separated string or YAML list   |

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

Supported sidecar fields:

| Block          | Fields                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------ |
| `interface`    | `display_name`, `short_description`, `icon_small`, `icon_large`, `brand_color`, `default_prompt` |
| `policy`       | `allow_implicit_invocation`                                                                      |
| `dependencies` | `tools`                                                                                          |

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
description: Multi-agent code review of a local branch's commits against a base ref. Use when reviewing a branch before creating a PR or when the user asks to review changes without a GitHub PR.
```

```yaml
# ❌ Procedural summary
description: Use when implementing — dispatches a subagent per task and conditionally routes reviewers between tasks.

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

These are enforced by `SkillSourceSchema` and surfaced by
`devcanon validate`:

- `description` is required (non-empty).
- ≤ 1024 chars (hard cap); aim for ≤ 500.
- No `<` or `>`.

The style rules above (third person, capability + trigger, no
procedural detail) are not mechanically validated — see § Red flags
for the rewrite triggers.

---

## Placeholders

Three placeholder namespaces resolve at render time against
glossaries in `devcanon.config.yaml`:

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

`validate` also reports an advisory prompt-size diagnostic for
unusually large `SKILL.md` files. It counts the raw `SKILL.md`
source with the `o200k_base` GPT tokenizer and warns when the
estimate is greater than `8,000` tokens. The warning includes the
estimated token count, UTF-8 byte count, line count, encoding name,
and threshold.

Prompt-size counts are estimates for authoring feedback. They are
not billing-accurate, provider-neutral, or guaranteed to match the
final prompt after target rendering, host-side wrappers, hidden
payloads, or provider-specific tokenizers are applied. This diagnostic
is warning-only in the first implementation, including under
`validate --strict`; strict enforcement and baseline mechanics are
deferred until explicitly designed and implemented.

---

## Optional content

A skill may also contain:

- `assets/`
- `examples/`
- `references/`
- `scripts/`

These subdirectories are mirrored per target into
`generated/<target>/skills/<name>/` as-is.

Keep `SKILL.md` focused on the always-loaded instructions needed to
route and execute the skill. Move non-eager material into the optional
subdirectories: worked examples into `examples/`, supporting rationale
or long references into `references/`, binary or visual inputs into
`assets/`, and deterministic mechanics into `scripts/`. Branch-specific
policy and other project-local detail should usually live in
`references/` or in the owning project documentation rather than in the
always-loaded skill prompt.

Only `SKILL.md` and these four subdirs are part of the installed bundle —
any other top-level _file_ is flagged by `validate` (and rejected under
`validate --strict`). Hidden files (e.g. `.DS_Store`) are ignored. Stray
top-level subdirectories are not flagged.

---

## Validation rules

- Skill directory name must be filesystem-safe.
- `SKILL.md` must exist.
- Frontmatter must parse and match `SkillSourceSchema`.
- Frontmatter `name` must match the stricter skill-name regex above and equal
  the directory name.
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
- `SKILL.md` files estimated above `8,000` GPT tokens using
  `o200k_base` emit an advisory prompt-size warning with estimated
  tokens, bytes, and lines. This warning is not promoted to an error
  by `--strict`; strict enforcement and baseline mechanics are not
  implemented.
- Top-level entries other than `SKILL.md` and the four optional subdirs
  (`assets/`, `examples/`, `references/`, `scripts/`) are flagged: stray
  files emit warnings (errors under `--strict`); hidden files and stray
  subdirectories are not flagged.

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

- `skills/issue-priming-workflow/SKILL.md` uses `claude.model` because its
  workflow orchestrates gate, research, planning, and execution. The
  `skills/github-issue-priming/SKILL.md` and
  `skills/linear-issue-priming/SKILL.md` entrypoints that hand off to it
  also pin `claude.model` so the source-specific fetch and routing run on
  the same tier.
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
