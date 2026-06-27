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

### Generated output rules

Files under `generated/` are disposable previews and remain ignored by Git.
Do not commit generated preview output as review evidence, even when a source
change intentionally affects rendered Claude or Codex skill output. Review the
authoritative source or runtime change first, then regenerate or run the
relevant check locally when generated output needs inspection.

Source skills, source agent definitions, source runtime TypeScript, renderer
code, tests, and the install manifest remain authoritative for their
respective contracts. Packaged runtime JavaScript under
`skills/devcanon-runtime/scripts/runtime/` is derived support output that stays
tracked because installed skill bundles need version-aligned helper files,
while `src/runtime/` owns the deterministic runtime behavior.

Do not hand-edit generated preview files to change behavior. If generated
preview drift appears in a worktree, regenerate from source or fix the
authoritative source/renderer behavior, but keep `generated/` out of commits.

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
