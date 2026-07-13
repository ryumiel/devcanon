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

For each target, agent model selection follows one precedence chain:

1. a literal model in the target block;
2. the target model from the agent's top-level `capability` and the required
   `capabilityProfiles` catalog;
3. omission, leaving model choice to the target's ambient configuration.

`src/render/capability-profiles.ts` owns this model-only resolution. It does not
resolve effort. Claude `effort` and Codex `model_reasoning_effort` are emitted
only when explicitly present in the corresponding target block; otherwise
they remain omitted. Tools, sandbox, approval policy, context, authority,
orchestration, retries, and escalation do not derive from capability.

Skills use the same catalog only through canonical model placeholders in prose
and supported top-level override strings. Agent target `model` fields accept
literal strings, not placeholders.

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
