# Target Mapping and Generated Output Rules

---

## Target Mapping Policy

Because Claude and Codex do not use the same native agent format,
`devcanon` follows this rule:

**Shared source defines the role intent. Target-specific blocks define native
behavior. Unsupported target fields are ignored with warning.**

The source schema does not define first-class delegation or orchestration
controls in v3. If authors describe coordination behavior, that guidance lives
in the role's prose instructions and remains target-dependent rather than a
validated source-schema field.

### Agent model and effort mapping

For both targets, `modelProfile` selects a model ID from `modelProfiles`. Native
output omits the model when the source selector is absent. Claude `effort`
and Codex `model_reasoning_effort` are explicit independent fields. Model
selection has no effect on tools, sandbox, approvals, or mutation authority.

Skill placeholders resolve through the same catalog. `{{model:<profile>}}`
follows the artifact target. `{{model-codex:<profile>}}` selects Codex in either
artifact target and supplies a binding for explicit Codex execution.

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
Required sibling declarations remain source-only; their availability rules are
defined by the [Skill Specification](skills.md).

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
authoritative for their respective contracts. The current provider-backed
passive-runtime authority is partitioned by the
[artifact-custody matrix](passive-runtime.md#artifact-custody). For this
mapping surface, render consumes the accepted provider and the selected source
configuration's catalog projection under ADR-0035 to create the generated
composition. That composition is the only runtime tree a symlink installation
may target; installed copy and symlink outputs remain derived managed
representations whose identity comes from the manifest and install rules.

Under this provider-backed behavior, all generated provider
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
