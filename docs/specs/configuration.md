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
```

---

## Rules

- relative paths are resolved relative to the config file directory
- `~` must be expanded
- target-specific settings override defaults
- unknown top-level config fields produce warnings in normal mode and errors in
  strict mode

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
