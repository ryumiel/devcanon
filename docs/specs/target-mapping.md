# Target Mapping and Generated Output Rules

---

## Target Mapping Policy

Because Claude and Codex do not use the same native agent format,
`devcanon` follows this rule:

**Shared source defines the role intent. Target-specific blocks define native
behavior. Unsupported target fields are ignored with warning.**

The source schema does not define first-class delegation or orchestration
controls in v1. If authors describe coordination behavior, that guidance lives
in the role's prose instructions and remains target-dependent rather than a
validated source-schema field.

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

### Tracked generated support output

Most files under `generated/` are disposable previews, and new local preview
churn remains ignored. Some generated support files are intentionally tracked so
reviewers can inspect the runtime and review-support artifacts that DevCanon
ships for Claude and Codex targets.

Tracked generated support files do not become source of truth. Source skills,
source agent definitions, source runtime TypeScript, renderer code, tests, and
the install manifest remain authoritative for their respective contracts.
Packaged runtime JavaScript under `skills/devcanon-runtime/scripts/runtime/`
is also derived support output: it is tracked because installed skill bundles
need version-aligned helper files, while `src/runtime/` owns the deterministic
runtime behavior.

The repository can ignore `generated/` and still track selected generated
support files. Ignore rules keep additional untracked preview output out of
ordinary diffs; they do not remove files that are already tracked. When a source
change intentionally affects tracked generated support output, review the
source or runtime change first, regenerate or run the relevant check, then
commit the tracked derived diff as evidence of the same change. Do not hand-edit
tracked generated support files to change behavior.

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
