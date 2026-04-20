# Install and Sync Policy

---

## Ownership Model

`agents-manager` owns only files and directories it installed as managed
outputs.

---

## Manifest

Manifest is authoritative for tracking installed outputs.

Default path:

```text
~/.agents-manager/manifest.json
```

### Suggested manifest fields

Each managed record should include:

- target
- type (`skill` or `agent`)
- source path
- generated path
- installed path
- install mode
- content hash
- timestamp

### Header vs manifest

Both managed headers and manifest should be used, but the manifest is
authoritative.

---

## Sync Steps

1. load config
2. validate source
3. render outputs
4. compute install plan
5. apply install plan
6. update manifest
7. print summary

---

## Default Install Mode

- default: `symlink`
- Windows fallback: `copy`

---

## Overwrite Policy

Supported policies:

- `skip-existing`
- `overwrite-managed`
- `overwrite-all`

Default:

- `overwrite-managed`

---

## Conflict Policy

- unmanaged files are never overwritten by default
- managed files may be replaced during sync
- unmanaged conflicts require explicit force behavior to overwrite
- deleted managed outputs may be cleaned up if manifest tracking confirms
  ownership

---

## Partial Failure Policy

If multiple targets are requested and one fails:

- report success and failure per target
- exit with non-zero status if any requested target failed

---

## See also

- [Configuration](configuration.md) -- install mode and overwrite policy defaults
- [Target mapping](target-mapping.md) -- generated output rules
- [CLI commands](cli-commands.md) -- `sync` and `diff` command details
- [Platform](platform.md) -- symlink requirements and path rules
