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
- packaged `skills/devcanon-runtime/` support skill
- sample agent

Runtime support skill behavior:

- fresh libraries receive the packaged runtime support skill at
  `skills/devcanon-runtime/`
- an existing matching `skills/devcanon-runtime/` path is preserved
- an existing non-matching `skills/devcanon-runtime/` path causes `init` to
  fail with repair guidance; DevCanon does not overwrite the existing support
  runtime path
- generated outputs remain disposable render results, not authoritative source
  files

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

- writes top-level `capability: balanced`
- omits target model placeholders and target effort fields
- relies on the required version 2 `capabilityProfiles` catalog during render

---

## `validate`

Validate config, skills, and agents.

```bash
devcanon validate
```

Current behavior:

- version 1 config fails with a dedicated migration diagnostic; version 2
  `modelTiers` fails with a dedicated `capabilityProfiles` replacement
  diagnostic before ordinary schema validation
- active skill model placeholders accept only `efficient`, `balanced`, and
  `frontier`; former or malformed model tokens fail with the source
  `SKILL.md` path and canonical migration guidance
- agent target `model` fields reject model placeholders and direct authors to
  top-level capability or literal target models
- skill drift diagnostics are emitted as warnings in normal mode
- oversized `SKILL.md` prompt diagnostics are emitted as advisory warnings
  when the raw file is estimated above the `5,000` GPT-token soft upper
  bound with the `o200k_base` encoding or reaches `500` lines; the warning
  also reports UTF-8 bytes and lines
- stray top-level files and unknown non-hidden support directories inside skill
  folders are flagged with the same warn/strict promotion behavior; unknown
  support directories are not rendered or mirrored into generated skills;
  hidden entries are not flagged
- `validate --strict` promotes those warnings to validation failures
  except for the oversized `SKILL.md` prompt diagnostic, which remains
  warning-only in this first implementation
- the current skill drift checks cover configured model tokens and
  target-specific path segments in shared prose; configured capability model
  strings are included in the model drift set

For human output, `validate` groups skill warnings into a readable warning
report after the skill status line. The skill status line includes the number
of collected warnings, and the warning report includes an overall warning
count. Warning blocks identify the diagnostic kind, affected skill, whether the
diagnostic is advisory or strictable, relevant metrics when available, and
remediation guidance. This grouped report is presentation for humans, not a
stable parseable output contract and not a change to warning semantics.

With `--json`, `validate` keeps stdout reserved for the JSON payload and emits
collected skill warnings through the warning channel. The JSON payload keeps
the existing top-level `config`, `skills`, and `agents` fields and does not add
a diagnostics field.

Prompt-size token counts are authoring estimates, not billing-accurate
or cross-provider exact counts. They may differ from the final target
prompt after rendering, host wrappers, hidden payloads, or
provider-specific tokenizers. Skill authors should target `1,500`-`3,500`
estimated GPT tokens and keep critical instructions, safety rules, and
output contracts before token `5,000`. Configurable thresholds, strict
enforcement, and baseline mechanics are deferred and are not current
`validate` behavior.

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
- `--reconcile-manifest`

`--reconcile-manifest` is available only to reconcile an unbound legacy
manifest that contains foreign records. It removes those foreign records from
the manifest only; it never deletes or rewrites their installed outputs. With
`--dry-run`, DevCanon previews the reconciliation and install plan without
writing or deleting anything.

A bound manifest whose configured-home boundary does not match fails before
rendering or mutation, and reconciliation cannot repurpose it. Bound manifests
with foreign records are rejected as well; use the original configured homes or
repair the manifest from a verified backup.

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

Changed agent files use a line-based patch. Skill-directory changes are
reported as status summaries.

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
- managed `.worktrees/` drift diagnostics, including orphaned entries,
  cross-repo Git metadata pointers, and unsafe symlink or path-containment
  shapes; this check is read-only and reports manual cleanup guidance

---

## `list`

List known skills and agents.

```bash
devcanon list
```
