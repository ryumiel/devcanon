# Configuration

---

## Config file name

`agents-manager.config.yaml`

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
  path: ~/.agents-manager/manifest.json

modelTiers:
  fast:
    claude: claude-haiku-4
    codex: gpt-5.4-mini
  standard:
    claude: claude-sonnet-4-7
    codex: gpt-5.4
  deep:
    claude: claude-opus-4-7
    codex: gpt-5.4
```

---

## Rules

- relative paths are resolved relative to the config file directory
- `~` must be expanded
- target-specific settings override defaults
- unknown top-level config fields produce warnings in normal mode and errors in
  strict mode

---

## modelTiers

Optional. Defines a glossary of model tier aliases that skills can reference
through the `{{model:<tier>}}` placeholder.

- Tier keys must match `^\w+$` (letters, digits, underscores).
- Each tier maps to a `{ claude: <model-id>, codex: <model-id> }` pair.
- Both `claude` and `codex` model IDs are required, non-empty strings.
- During render, `{{model:<tier>}}` resolves to the model ID for the active
  target: `{{model:deep}}` becomes `modelTiers.deep.claude` for Claude output
  and `modelTiers.deep.codex` for Codex output.
- An empty `modelTiers: {}` is rejected; either omit the key entirely or
  define at least one tier.

See [Skills](skills.md) for skill-frontmatter overrides that consume tier
placeholders.

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
- ownership: manifest plus generated header
- overwrite policy: overwrite managed only
- shared skill source, native generated agents

---

## See also

- [Install and sync](install-and-sync.md) -- sync steps and overwrite policy
- [Platform](platform.md) -- cross-platform path rules
- [Core concepts](core-concepts.md) -- install mode and target concepts
