# CLI Commands

---

## `init`

Initialize a new `devcanon` library.

```bash
devcanon init
```

Creates:

- config file
- source directories
- sample skill
- sample agent

---

## `new skill <name>`

Create a new skill scaffold.

```bash
devcanon new skill pr-review
```

---

## `new agent <name>`

Create a new agent scaffold.

```bash
devcanon new agent reviewer
```

Scaffold behavior:

- uses `{{model:standard}}` when a `standard` tier exists
- otherwise uses the first configured tier key
- if no `modelTiers` are configured, omits target `model` fields

---

## `validate`

Validate config, skills, and agents.

```bash
devcanon validate
```

Current behavior:

- skill drift diagnostics are emitted as warnings in normal mode
- stray top-level files inside skill folders are flagged with the same
  warn/strict promotion behavior; hidden files and stray subdirectories
  are not flagged
- `validate --strict` promotes those warnings to validation failures
- the current skill drift checks cover reasoning-tier tokens and
  target-specific path segments in shared prose

---

## `render`

Generate outputs into `generated/` without installing.

```bash
devcanon render
```

---

## `sync`

Render and install managed outputs.

```bash
devcanon sync
```

Supported options:

- `--target claude`
- `--target codex`
- `--mode copy`
- `--mode symlink`
- `--dry-run`
- `--force`

---

## `uninstall`

Remove managed outputs recorded in the install manifest.

```bash
devcanon uninstall
```

Supported options:

- `--target claude`
- `--target codex`
- `--dry-run`

Behavior:

- Manifest-driven: only paths recorded in `manifest.json` are removed.
- Source files under `skills/` and `agents/` are never touched.
- `--target` filters by Claude or Codex; default is all targets.
- `--dry-run` previews the plan without filesystem or manifest writes.
- An empty manifest (or empty filtered set) prints `Nothing to remove.`
  and exits 0.
- Per-record failures are accumulated; the run continues to subsequent
  records and exits non-zero at the end if any failed. Successfully
  removed records are still cleared from the manifest.

---

## `diff`

Show differences between generated outputs and installed outputs.

```bash
devcanon diff
```

Reports:

- added
- removed
- changed
- unmanaged conflicts

Diff output may be line-based for v1.

---

## `doctor`

Inspect environment health.

```bash
devcanon doctor
```

Checks:

- Node version
- config discovery
- path expansion
- target directory existence
- write permission
- symlink capability
- manifest accessibility

---

## `list`

List known skills and agents.

```bash
devcanon list
```
