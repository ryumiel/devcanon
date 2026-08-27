# Configuration

---

## Config file name

`devcanon.config.yaml`

---

## Discovery and explicit configuration

DevCanon resolves configuration in this order:

1. the global `--config <path>` option
2. the `DEVCANON_CONFIG` environment variable
3. `devcanon.config.yaml` in the current working directory

The stable DevCanon checkout is the normal configuration root, so running
`devcanon sync` from its root uses its `devcanon.config.yaml`. To run the
globally registered CLI from another directory, pass the checkout's config as
an absolute path before the subcommand:

```sh
devcanon --config /absolute/path/to/devcanon.config.yaml sync
```

The selected config file remains the base for all relative configuration paths;
the invoking directory does not change that resolution.

---

## Runtime configuration discovery

This section owns selection for the public [`config path` and `config get`
commands](cli-commands.md#config-path-and-config-get). It does not change the
source-configuration requirement for commands that render, validate, install,
or otherwise operate on a library.

### Scope and non-goals

`config` inspects either a selected source configuration or the packaged runtime
catalog. It is read-only. It neither creates a configuration file nor selects a
model, installs output, or establishes that a provider account accepts a model.
The source schema in
[`src/config/schema.ts`](../../src/config/schema.ts) and the selection code in
[`src/config/runtime-config.ts`](../../src/config/runtime-config.ts) remain the
executable contract authority.

### Selection requirements

For `config path` and `config get`, DevCanon selects exactly one value in this
order:

1. the global `--config <path>` source configuration;
2. `DEVCANON_CONFIG` source configuration;
3. `devcanon.config.yaml` in the current directory; or
4. the packaged `devcanon-runtime` catalog when no source configuration is
   selected.

An explicit or environment path that is missing is an error; it does not fall
through to a lower-precedence source or the catalog. Likewise, once a source
configuration is selected, YAML or schema failure is reported for that source
and no fallback occurs. A present current-directory config also wins over the
catalog and fails closed when invalid.

The first three choices load the normal source configuration, including its
relative-path resolution. The selected value exposes `version` and the resolved
source configuration, but not loader-only state such as `configDir`.

The fourth choice is the catalog packaged with
`skills/devcanon-runtime/config/runtime-config.json`. It is an exact JSON
envelope containing its schema identifier and the required capability-profile
catalog; it is not a substitute user configuration and cannot supply library,
target-home, manifest, or installation settings. The catalog must be a regular,
non-symlink file with a valid exact shape and no duplicate JSON object keys. An
invalid packaged catalog is an error, not a reason to search another location.

Existing commands keep their source-configuration discovery contract. In
particular, `init`, `validate`, `render`, `sync`, `uninstall`, `diff`, `doctor`,
and `list` do not use the packaged catalog as a fallback when no source
configuration is available.

### Catalog projection and runtime custody

The source `capabilityProfiles` catalog selects model strings while DevCanon
renders a target. For every enabled target, the renderer writes a runtime
catalog containing that selected source catalog beside the target's passive
runtime scripts. An installed runtime reads only its sibling catalog; it does
not rediscover the source checkout, the invoking directory, or an ambient
configuration file.

The passive runtime's current payload is exactly its validated `config/` and
`scripts/` trees, without `SKILL.md` or a Codex invocation sidecar. It is
current-format-only: a scripts-only runtime is invalid and is neither upgraded
nor given installation, sync, identity, or uninstall compatibility guarantees.
The runtime catalog is transport data for the generated or installed runtime,
not a second authoritative user-configuration file.

### Scenarios

- From an unrelated directory with no selected source configuration,
  `devcanon config get capabilityProfiles.balanced.codex` reads the packaged
  catalog and prints `gpt-5.6-terra`. `devcanon --json config path` reports an
  absolute `path` and `source: "bundled"`.
- With `--config` pointing to a valid custom source configuration,
  `devcanon --config <path> --json config get capabilityProfiles.balanced.codex`
  reports that path, `source: "explicit"`, the requested key, and the custom
  Codex value. Rendering from that configuration projects its paired Claude and
  Codex values into their respective target runtime bundles.
- A missing `--config` path, a malformed selected source configuration, an
  unknown dotted key, a non-scalar key, a malformed catalog, or a catalog with
  an unsupported schema or duplicate object key fails with an error. None is
  replaced by a lower-precedence source, a nearby catalog, an alias, or an
  ambient model.

### Acceptance and verification

- Public inspection observes the precedence and no-fallback behavior above in
  an unrelated current directory, with explicit source configuration, and with
  invalid selected inputs.
- Plain and JSON command behavior is verified by the command-action tests;
  catalog shape, file-kind, and key-safety behavior are verified by the runtime
  configuration tests.
- Render and install verification confirms that each target runtime receives
  its selected catalog and rejects an incomplete payload.

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
- `defaults.installMode` and target `installMode` values are requested modes;
  install/sync resolves the effective mode for each output. Codex agent roles
  always materialize as `copy`, so an explicit `symlink` request cannot
  override that constraint. Codex skills and Claude outputs retain the
  requested mode.
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
  `model_reasoning_effort` remain explicit target-native fields and are never
  inherited from a profile. The agent contract separately defines literal,
  absent, and explicit-null Codex-model source states; explicit suppression is
  not configuration syntax or a profile behavior.
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
capability; omission preserves ambient target behavior. Fresh semantic-child
route effort is owned by the Agent Routing and Mutation Policy, not by
`capabilityProfiles`.

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
- requested install mode: symlink by default
- Windows fallback: copy for eligible symlink outputs
- Codex agent roles: effective copy mode
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
