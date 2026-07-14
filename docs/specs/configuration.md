# Configuration

---

## Config file name

`devcanon.config.yaml`

---

## Example

```yaml
version: 2

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

capabilityProfiles:
  efficient:
    claude: claude-haiku-4-5-20251001
    codex: gpt-5.6-luna
  balanced:
    claude: claude-sonnet-5
    codex: gpt-5.6-terra
  frontier:
    claude: claude-opus-4-8
    codex: gpt-5.6-sol

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
- source configuration accepts only `version: 2`; version 1 is rejected with a
  dedicated migration diagnostic before ordinary schema validation
- a version 2 config that still declares `modelTiers` is rejected with a
  dedicated replacement diagnostic before ordinary schema validation

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

## capabilityProfiles

Required. This exact strict object is the portable model-capability catalog.
The executable details live in `CapabilityProfilesSchema`; this spec records
the user-facing boundary without replacing that source authority.

- The only profile keys are `efficient`, `balanced`, and `frontier`; all three
  are required and additional keys are rejected.
- Every profile is a strict `{ claude: <model>, codex: <model> }` object. Both
  values are required render-safe, non-blank strings capped at 256 characters.
  Additional profile fields, including effort, are rejected.
- The default and repository catalog is exact:

  | Capability  | Claude                      | Codex           |
  | ----------- | --------------------------- | --------------- |
  | `efficient` | `claude-haiku-4-5-20251001` | `gpt-5.6-luna`  |
  | `balanced`  | `claude-sonnet-5`           | `gpt-5.6-terra` |
  | `frontier`  | `claude-opus-4-8`           | `gpt-5.6-sol`   |

- The paired values are DevCanon policy mappings, not provider equivalences.
- Capability selects a model only. Claude `effort` and Codex
  `model_reasoning_effort` remain explicit target-native agent or skill fields
  and are never inherited from a profile.
- Skill tokens resolve per target: `{{model:frontier}}` becomes the configured
  `frontier.claude` or `frontier.codex` string. Agent target model fields do not
  accept model placeholders.
- DevCanon provides no custom, compatibility, transitional, or legacy profiles
  and no automatic translation from v1.

Configuration validation is local and syntactic. Acceptance of a model or
effort does not prove that a provider client recognizes it or that an account
can run it. Runtime incompatibility must fail closed; DevCanon does not
substitute a fallback model, alias, family member, or effort.

See [Agents](agents.md) for capability and model precedence,
[Skills](skills.md) for model placeholders, and
[Capability Profiles v2 Migration](../guidelines/capability-profiles-v2-migration.md)
for the manual cutover and rollback procedure.

### Target-native effort

Effort is not part of `capabilityProfiles`. Where the agent or skill source
schema supports it, `claude.effort` accepts `low`, `medium`, `high`, `xhigh`,
or `max`. Agent `codex.model_reasoning_effort` accepts `none`, `minimal`,
`low`, `medium`, `high`, `xhigh`, or `max`. `ultra` is orchestration, not a
reasoning-effort value, and is rejected by this source contract.

Local acceptance does not prove a selected provider model, client, or account
supports the effort. Explicit effort takes effect independently of model
capability; omission preserves ambient target behavior.

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

## Recommended v2 defaults

- source layout: `skills/`, `agents/`, `generated/`
- agent format: YAML
- install mode: symlink by default
- Windows fallback: copy
- ownership: manifest
- overwrite policy: overwrite managed only
- shared skill source, native generated agents
- required exact `capabilityProfiles` catalog
- new agent scaffolds use top-level `capability: balanced` and omit effort

---

## See also

- [Install and sync](install-and-sync.md) -- sync steps and overwrite policy
- [Platform](platform.md) -- cross-platform path rules
- [Core concepts](core-concepts.md) -- install mode and target concepts
