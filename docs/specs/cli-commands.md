# CLI Commands

---

## `init`

Initialize a new `agents-manager` library.

```bash
agents-manager init
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
agents-manager new skill pr-review
```

---

## `new agent <name>`

Create a new agent scaffold.

```bash
agents-manager new agent reviewer
```

---

## `validate`

Validate config, skills, and agents.

```bash
agents-manager validate
```

---

## `render`

Generate outputs into `generated/` without installing.

```bash
agents-manager render
```

---

## `sync`

Render and install managed outputs.

```bash
agents-manager sync
```

Supported options:

- `--target claude`
- `--target codex`
- `--mode copy`
- `--mode symlink`
- `--dry-run`
- `--force`

---

## `diff`

Show differences between generated outputs and installed outputs.

```bash
agents-manager diff
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
agents-manager doctor
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
agents-manager list
```
