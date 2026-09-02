# Target Mapping and Generated Output Rules

---

## Target Mapping Policy

Because Claude and Codex do not use the same native agent format,
`devcanon` follows this rule:

**Shared source defines the role intent. Target-specific blocks define native
behavior. Unsupported target fields are ignored with warning.**

The source schema does not define first-class delegation or orchestration
controls in v2. If authors describe coordination behavior, that guidance lives
in the role's prose instructions and remains target-dependent rather than a
validated source-schema field.

### Agent model and effort mapping

Claude target `model` is literal or absent: a literal emits as supplied; when
absent, the shared resolver maps the top-level `capability` through
`capabilityProfiles`, or leaves the field omitted when there is no capability.

Codex target `model` is literal, absent, or explicit `null`: a literal emits as
supplied; when absent, the shared resolver maps the top-level `capability`
through `capabilityProfiles`, or leaves the field omitted when there is no
capability; explicit `null` suppresses both capability resolution and model
emission. `src/render/codex.ts` owns that explicit-null suppression, while
`src/render/capability-profiles.ts` owns the shared literal/absent mapping.
Neither resolver owns effort. Claude `effort` and Codex
`model_reasoning_effort` are emitted only when explicitly present in the
corresponding target block; otherwise they remain omitted. Tools, sandbox,
approval policy, context, authority, orchestration, retries, and escalation do
not derive from capability.

Skills use the same catalog only through canonical model placeholders in prose
and supported top-level override strings. Agent target `model` fields accept
literal strings, not placeholders. `{{model:<capability>}}` follows the
artifact target. `{{model-codex:<capability>}}` selects the Codex member in
both artifact targets and is reserved for a value passed to an explicit Codex
execution primitive.

### Claude mapping

Source agent definitions render to:

- `generated/claude/agents/<name>.md`
- installed at `~/.claude/agents/<name>.md`

Render format:

- Markdown
- YAML frontmatter
- body contains normalized instructions

### Codex mapping

Source agent definitions render to:

- `generated/codex/agents/<name>.toml`
- installed at `~/.codex/agents/<name>.toml`

Render format:

- TOML
- normalized multiline instruction fields

---

## Generated Output Rules

### Determinism

Rendering must be deterministic.

### Full regeneration

Source-driven renders recreate generated outputs from source on each
`renderAll()` run. The loaded-input render core may render an already-validated
partial input set without treating omitted skills or agents as stale.

### Manual editing policy

Generated outputs are not intended to be hand-edited. Managed-state is tracked
by the install manifest; generated files do not embed a managed header.

### Generated output rules

Files under `generated/` are disposable previews and remain ignored by Git.
Do not commit generated preview output as review evidence, even when a source
change intentionally affects rendered Claude or Codex skill output. Review the
authoritative source or runtime change first, then regenerate or run the
relevant check locally when generated output needs inspection.

Source skill directories with `SKILL.md`, source agent definitions, source
runtime TypeScript, renderer code, tests, and the install manifest remain
authoritative for their respective contracts. The passive-runtime classification
below is required provider-backed target behavior whose implementation is
deferred. The current tracked fixed payload remains governed by existing
contributor guidance until that implementation replaces it. Target
passive-runtime authority is partitioned by the
[artifact-custody matrix](passive-runtime.md#artifact-custody). For this
mapping surface, render consumes the accepted provider and the selected source
configuration's catalog projection under ADR-0035 to create the generated
composition. That composition is the only runtime tree a symlink installation
may target; installed copy and symlink outputs remain derived managed
representations whose identity comes from the manifest and install rules.

Under that deferred provider-backed target behavior, all generated provider
artifacts, source-sibling copies, rendered previews, and installed outputs are
uncommitted derived evidence. Package inclusion of
the package provider root does not make it a Git-tracked source artifact.
[The passive-runtime behavior spec](passive-runtime.md) owns provider custody
and composition behavior; ADR-0024 records the architecture rationale, and
[ADR-0035](../adr/adr-0035-installed-runtime-configuration-discovery.md) owns
the transported catalog's schema, semantic contents, projection inputs, and
selection behavior.

Do not hand-edit generated preview files to change behavior. If generated
preview drift appears in a worktree, regenerate from source or fix the
authoritative source/renderer behavior, but keep `generated/` out of commits.
Generated previews are local verification only; they are not committed
authority or migration baselines.

### Normalization

Renderer should normalize:

- trailing newline
- line endings
- indentation
- multiline formatting
- stable field ordering where applicable

---

## See also

- [Agent source schema](agents.md) -- source format that renderers consume
- [Install and sync](install-and-sync.md) -- how generated outputs are installed
- [Configuration](configuration.md) -- target-level install settings
