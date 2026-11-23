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

An explicit path that is empty or missing, or an environment path that is
missing, is an error; it does not fall through to a lower-precedence source or
the catalog. Likewise, once a source
configuration is selected, YAML or schema failure is reported for that source
and no fallback occurs. A present current-directory config also wins over the
catalog and fails closed when invalid.

The first three choices load the normal source configuration, including its
relative-path resolution. The selected value exposes `version` and the resolved
source configuration, but not loader-only state such as `configDir`.

The fourth choice is the catalog packaged with
`skills/devcanon-runtime/config/runtime-config.json`. It has literal schema
`devcanon/runtime-config/v2` and a closed top-level
`{ schema, modelProfiles }` object. Its `modelProfiles` value uses
the strict existing source authority in
[`src/config/schema.ts`](../../src/config/schema.ts); this spec does not repeat
the profile fields. The catalog is not a substitute user configuration and
cannot supply library, target-home, manifest, or installation settings. It must
be a regular, non-symlink file with a valid exact shape and no duplicate JSON
object keys. An invalid packaged catalog is an error, not a reason to search
another location.

For `config get`, each dotted segment must match
`[A-Za-z0-9][A-Za-z0-9_-]*`. A key may not contain `__proto__`, `constructor`,
or `prototype` in any segment. Lookup returns only a string, number, or boolean;
arrays and containers are not scalar results.

Commands that operate on an existing library retain source-configuration
discovery. `init` independently creates a source configuration and does not
perform discovery or fallback. No non-`config` command uses the packaged catalog
as a fallback.

### Runtime artifact-provider selection

This section defines the current provider-selection behavior.

Source-configuration selection and runtime artifact selection are separate
inputs. The target common CLI receives exactly one explicit internal runtime
provider: source development, including `pnpm dev` and the `setup:cli` shim,
supplies the `source-build` provider; the npm `bin` entrypoint supplies the
`package` provider. The selected provider supplies its generated runtime root
to the commands that validate, compose, render, initialize, or transport the
passive runtime.

Provider identity is never inferred from `.git`, the current directory,
configuration-path shape, the presence of another artifact root, or any other
filesystem heuristic. A missing, invalid, stale, corrupt, or
provider/origin-mismatched artifact fails before the command continues; a
source-build failure directs the operator to `pnpm run build:runtime`, and a
package failure directs the operator to reinstall the package. The provider
does not select source configuration, replace the catalog fallback, or change
the catalog authority owned by
[ADR-0035](../adr/adr-0035-installed-runtime-configuration-discovery.md).
The [Passive Runtime Contract](passive-runtime.md#provider-acceptance) owns
generated-root custody, integrity, and the behavior after selection.

### Catalog projection and runtime consumption

The source `modelProfiles` catalog selects model strings while DevCanon
renders a target. For each enabled target selected for that render, the renderer
projects the same complete model profile catalog
beside the target's passive runtime scripts. An installed runtime reads only its
sibling catalog; it does not rediscover the source checkout, the invoking
directory, or an ambient configuration file. See
[ADR-0035](../adr/adr-0035-installed-runtime-configuration-discovery.md) for
the decision rationale and alternatives.

The current implementation validates and transports the composed passive-runtime
tree selected by the explicit provider without `SKILL.md` or a Codex invocation
sidecar. A scripts-only runtime is invalid and is neither
upgraded nor given installation, sync, identity, or uninstall compatibility
guarantees. The runtime catalog is transport data for the generated or
installed runtime, not a second authoritative user-configuration file. This
specification and ADR-0035 own its schema, semantic projection inputs, and
selection behavior; PR-ART-02A and PR-ART-02B own physical stage custody and
overwrite behavior.

### Installed passive-runtime command contract

This contract is distinct from the public `devcanon config` commands above.
The shell adapter dispatches `runtime config path`, which accepts no arguments,
or `runtime config get --key <nonempty>`, which accepts exactly that one flag
and value. The typed dispatcher receives the corresponding `config path` or
`config get --key <nonempty>` arguments. Duplicate flags, extra arguments, and
path overrides are rejected.

The commands consume only the sibling validated runtime catalog. They do not
consult an explicit source path, `DEVCANON_CONFIG`, or the current directory.
On success, `path` writes the JSON object `{ "path": "<absolute sibling catalog
path>" }`; `get` writes `{ "key": "<key>", "value": "<string>" }`. On
failure they exit non-zero with no success output and write the stable JSON
envelope `{ "ok": false, "code": "<code>", "message": "<message>" }` to
standard error. The command and error-code details remain owned by
[`src/runtime/command.ts`](../../src/runtime/command.ts).

### Scenarios

- From an unrelated directory with no selected source configuration,
  `devcanon config get modelProfiles.balanced.codex` reads the packaged
  catalog and prints the bundled balanced Codex model ID. `devcanon --json config path` reports an
  absolute `path` and `source: "bundled"`.
- With `--config` pointing to a valid custom source configuration,
  `devcanon --config <path> --json config get modelProfiles.balanced.codex`
  reports that path, `source: "explicit"`, the requested key, and the custom
  Codex value. Rendering from that configuration projects its paired Claude and
  Codex values into their respective target runtime bundles.
- A missing `--config` path, a malformed selected source configuration, an
  unknown dotted key, a non-scalar key, a malformed catalog, or a catalog with
  an unsupported schema or duplicate object key fails with an error. None is
  replaced by a lower-precedence source, a nearby catalog, an alias, or an
  ambient model.

### Acceptance and verification expectations

- Selector coverage must exercise precedence, malformed selected source,
  no-fallback behavior, catalog validation, and scalar-key rejection in
  [`src/config/runtime-config.test.ts`](../../src/config/runtime-config.test.ts).
- Public-command registration and entrypoint behavior must remain in
  [`src/cli/index.test.ts`](../../src/cli/index.test.ts).
- Plain output, JSON output, and command-action error behavior must remain in
  [`src/cli/commands/config.test.ts`](../../src/cli/commands/config.test.ts).
- Render and install coverage must confirm the selected catalog projection and
  reject incomplete runtime payloads in
  [`src/render/devcanon-runtime.integration.test.ts`](../../src/render/devcanon-runtime.integration.test.ts)
  and
  [`src/install/devcanon-runtime.integration.test.ts`](../../src/install/devcanon-runtime.integration.test.ts).
- Runtime-command coverage must exercise sibling lookup, exact arguments,
  typed-and-shell parity, unrelated-current-directory behavior, and failures in
  [`src/skill-scripts/devcanon-runtime-typed-entrypoint.integration.test.ts`](../../src/skill-scripts/devcanon-runtime-typed-entrypoint.integration.test.ts).

---

## Example

```yaml
version: 3

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

modelProfiles:
  efficient:
    claude: example-claude-efficient
    codex: example-codex-efficient
  balanced:
    claude: example-claude-balanced
    codex: example-codex-balanced
  implementation:
    codex: example-codex-implementation
  frontier:
    claude: example-claude-frontier
    codex: example-codex-frontier

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
- source configuration accepts only `version: 3`; versions 1 and 2 are rejected
  with a migration diagnostic
- legacy `modelTiers` and `capabilityProfiles` keys are rejected

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

## modelProfiles

Required. The strict catalog has four profiles. The `efficient`, `balanced`, and
`frontier` entries require `claude` and `codex` model IDs. The `implementation`
entry requires only `codex`. IDs start with an ASCII letter or digit and contain up to 256 characters.
The remaining characters may also include `.`, `_`, `:`, `/`, `@`, `+`, and `-`. Additional profile and target keys are rejected.

Edit a model ID in `devcanon.config.yaml` and run `devcanon sync`. The agent
renderer resolves each target's `modelProfile` selection. Skills resolve
`{{model:frontier}}` for the artifact target and
`{{model-codex:implementation}}` for Codex in either artifact target. A profile
must define the requested target.

The build derives the scaffold models and packaged catalog from the repository
config. The installed runtime catalog projects the operator's selected config.
Model selection, routing capability, and reasoning effort are independent.
Provider availability is evaluated by the provider when a model is used.

### Cut over to v3

Uninstall managed outputs with the old CLI and original v2 configuration before
updating the checkout or CLI. Use the same target homes and manifest throughout.
Update the library config, authored runtime catalog, agents, and workflow sources
to v3, or select a fresh v3 library. The old uninstall leaves source files in
place. Run the new CLI's `validate` and `sync` against the updated library.

### Target-native effort

Effort is not part of `modelProfiles`. Where the agent or skill source
schema supports it, `claude.effort` accepts `low`, `medium`, `high`, `xhigh`,
or `max`. Agent `codex.model_reasoning_effort` accepts `none`, `minimal`,
`low`, `medium`, `high`, `xhigh`, or `max`. `ultra` is orchestration, not a
reasoning-effort value, and is rejected by this source contract.

Local acceptance does not prove a selected provider model, client, or account
supports the effort. Explicit effort takes effect independently of model
capability; omission preserves ambient target behavior. Fresh semantic-child
route effort is owned by the Agent Routing and Mutation Policy, not by
`modelProfiles`.

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

## Recommended v3 defaults

- source layout: `skills/`, `agents/`, `generated/`
- agent format: YAML
- requested install mode: symlink by default
- Windows fallback: copy for eligible symlink outputs
- Codex agent roles: effective copy mode
- ownership: manifest
- overwrite policy: overwrite managed only
- shared skill source, native generated agents
- required exact `modelProfiles` catalog
- new agent scaffolds use top-level `capability: balanced` and omit effort

---

## See also

- [Install and sync](install-and-sync.md) -- sync steps and overwrite policy
- [Platform](platform.md) -- cross-platform path rules
- [Core concepts](core-concepts.md) -- install mode and target concepts
