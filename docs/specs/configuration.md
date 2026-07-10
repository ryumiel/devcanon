# Configuration

---

## Config file name

`devcanon.config.yaml`

---

## Example

```yaml
version: 1

library:
  skillsDir: ./skills
  agentsDir: ./agents
  generatedDir: ./generated

targets:
  claude:
    enabled: true
    skillsHome: ~/.claude/skills
    agentsHome: ~/.claude/agents
    installMode: symlink

  codex:
    enabled: true
    skillsHome: ~/.agents/skills
    agentsHome: ~/.codex/agents
    installMode: symlink

defaults:
  installMode: symlink
  overwritePolicy: overwrite-managed
  cleanManagedOutputs: true

platform:
  windowsSymlinkFallback: copy

manifest:
  path: ~/.devcanon/manifest.json

modelTiers:
  fast:
    claude:
      model: claude-haiku-4-5
    codex:
      model: gpt-5.6-terra
      reasoning_effort: low
  standard:
    claude:
      model: claude-sonnet-4-6
      effort: medium
    codex:
      model: gpt-5.6-sol
      reasoning_effort: high
  deep:
    claude:
      model: claude-opus-4-7
      effort: high
    codex:
      model: gpt-5.6-sol
      reasoning_effort: xhigh

toolNames:
  task-tracker:
    claude: TodoWrite
    codex: update_plan

fileArtifacts:
  project-instructions:
    claude: CLAUDE.md
    codex: AGENTS.md
```

---

## Rules

- relative paths are resolved relative to the config file directory
- `~` must be expanded
- target-specific settings override defaults
- `targets.codex.skillDisplayNameSuffix`, when present, is a raw namespace value
  appended to generated Codex skill UI display names in `(<value>)` form
- unknown top-level config fields produce warnings in normal mode and errors in
  strict mode

---

## Codex display name suffix

Optional. `targets.codex.skillDisplayNameSuffix` configures a Codex UI-only suffix
for rendered skill sidecar display names.

- The value is trimmed, must be non-empty, and must not contain control
  characters or line breaks.
- The renderer formats the value in `(<value>)` form; for example, `devcanon`
  renders as `(devcanon)`.
- The suffix affects only `generated/codex/skills/<name>/agents/openai.yaml`
  `interface.display_name`.
- If a skill has no source `codex_sidecar.interface.display_name`, the Codex
  renderer derives a readable display name from the skill name, then appends
  the suffix.
- It does not change skill `name`, `description`, install paths, Claude output,
  or CLI `list` output.

---

## modelTiers

Optional. Defines a glossary of model tier aliases that skills can reference
through the `{{model:<tier>}}` placeholder.

- Tier keys must match `^\w+$` (letters, digits, underscores).
- Each tier maps to a nested per-target profile:
  `{ claude: { model, effort? }, codex: { model, reasoning_effort? } }`.
- Both `claude.model` and `codex.model` are required, non-empty strings capped
  at 256 characters.
- `claude.effort` is optional and must be one of `low`, `medium`, `high`,
  `xhigh`, or `max`.
- `codex.reasoning_effort` is optional and must be one of `none`, `minimal`,
  `low`, `medium`, `high`, `xhigh`, or `max`. `ultra` is an orchestration mode,
  not a reasoning-effort value, and is rejected.
- In skill prose and skill-side overrides, `{{model:<tier>}}` resolves to the
  model ID for the active target: `{{model:deep}}` becomes
  `modelTiers.deep.claude.model` for Claude output and
  `modelTiers.deep.codex.model` for Codex output.
- In agent target blocks, `model: "{{model:<tier>}}"` resolves against the full
  target profile. Claude inherits `effort` from the tier unless the agent sets
  `claude.effort`, and Codex inherits `model_reasoning_effort` unless the agent
  sets `codex.model_reasoning_effort`.
- An empty `modelTiers: {}` is rejected; either omit the key entirely or
  define at least one tier.

### Codex defaults and availability

The active repository config and newly initialized libraries use the same
Codex defaults:

| Tier       | Model           | Reasoning effort |
| ---------- | --------------- | ---------------- |
| `fast`     | `gpt-5.6-terra` | `low`            |
| `standard` | `gpt-5.6-sol`   | `high`           |
| `deep`     | `gpt-5.6-sol`   | `xhigh`          |

These defaults pin named family members. DevCanon does not use the moving
`gpt-5.6` alias or automatically select a different family member, model, or
effort. This pinning keeps the intended tier stable if an alias is retargeted.

Configuration validation is local and syntactic. Acceptance of a model and
effort does not prove that a Codex client version recognizes the model or that
an account can run it. An incompatible client or unavailable account
entitlement must fail closed at runtime; DevCanon does not substitute a
fallback model, alias, family member, or effort.

See [Skills](skills.md) for skill-frontmatter overrides that consume tier
placeholders.

---

## toolNames

Optional. Defines a glossary of tool-name aliases that skills can reference
through the `{{tool:<key>}}` placeholder.

- Keys must match `^[a-z0-9][a-z0-9-]*$` (lowercase, digits, hyphens;
  e.g. `task-tracker`).
- Each entry maps to a `{ claude: <tool-name>, codex: <tool-name> }` pair.
- Both `claude` and `codex` values are required, non-empty strings.
- During render, `{{tool:<key>}}` resolves to the tool name for the active
  target: `{{tool:task-tracker}}` becomes `toolNames.task-tracker.claude`
  for Claude output and `toolNames.task-tracker.codex` for Codex output.
- An empty `toolNames: {}` is rejected; either omit the key entirely or
  define at least one entry.
- Each `claude` / `codex` value is a non-empty string capped at 256
  characters.

Drift validation auto-derives token warnings from configured values --
literal mentions of e.g. `TodoWrite` in shared prose surface as warnings
under `validate` and as errors under `validate --strict`. See
[Skills](skills.md) for the full drift policy.

---

## fileArtifacts

Optional. Defines a glossary of artifact-file aliases that skills can
reference through the `{{file:<key>}}` placeholder.

- Keys must match `^[a-z0-9][a-z0-9-]*$` (lowercase, digits, hyphens;
  e.g. `project-instructions`).
- Each entry maps to a `{ claude: <file-name>, codex: <file-name> }` pair.
- Both `claude` and `codex` values are required, non-empty strings.
- During render, `{{file:<key>}}` resolves to the artifact filename for
  the active target: `{{file:project-instructions}}` becomes
  `fileArtifacts.project-instructions.claude` for Claude output and
  `fileArtifacts.project-instructions.codex` for Codex output.
- An empty `fileArtifacts: {}` is rejected; either omit the key entirely or
  define at least one entry.
- Each `claude` / `codex` value is a non-empty string capped at 256
  characters.

Drift validation auto-derives token warnings from configured values --
literal mentions of e.g. `CLAUDE.md` or `AGENTS.md` in shared prose
surface as warnings under `validate` and as errors under
`validate --strict`. See [Skills](skills.md) for the full drift policy.

See [ADR-0006](../adr/adr-0006-tool-and-file-placeholders.md) for the
decision record covering the `{{tool:*}}` and `{{file:*}}` namespaces.

---

## Skill frontmatter override blocks

Skill `SKILL.md` frontmatter accepts three optional, target-scoped override
blocks: `claude:`, `codex:`, and `codex_sidecar:`. The `claude:` and
`codex:` blocks fold target-specific frontmatter keys into the rendered
output; `codex_sidecar:` is emitted as a separate
`generated/codex/skills/<name>/agents/openai.yaml` file. All three blocks
use `.strict()` validation -- unknown keys are rejected.

See [Skills](skills.md) for the full list of allowed keys per block.

---

## Recommended v1 Defaults

- source layout: `skills/`, `agents/`, `generated/`
- agent format: YAML
- install mode: symlink by default
- Windows fallback: copy
- ownership: manifest
- overwrite policy: overwrite managed only
- shared skill source, native generated agents

---

## See also

- [Install and sync](install-and-sync.md) -- sync steps and overwrite policy
- [Platform](platform.md) -- cross-platform path rules
- [Core concepts](core-concepts.md) -- install mode and target concepts
