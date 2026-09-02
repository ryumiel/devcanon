# CLI Commands

---

## Repository CLI setup

`pnpm run setup:cli` currently builds DevCanon and globally registers the
authoritative checkout as `devcanon`. Run it from the checkout root after
dependencies are installed. It is not a `devcanon` application subcommand and
does not render or install managed outputs.

Before this operation, the platform's global executable directory must be on
`PATH`. On macOS, Linux, and WSL, this is pnpm's user-global bin directory; if
pnpm reports it missing, the operator runs `pnpm setup` and follows its
shell-reload guidance. On native Windows, including PowerShell, cmd, and Git
Bash, npm's global prefix must be on `PATH`, and `setup:cli` uses npm for global
registration. DevCanon does not modify `PATH`.

The package manifest owns the exact script, the required Node.js version
(`>=24.0.0`), and the pinned package manager (`pnpm@10.33.0`). The registered
CLI points at the checkout, so operators must retain that checkout at a stable
path as the source library and default configuration root.

The current setup and its focused integration verification support macOS,
Linux, and Windows.

Required target behavior, whose implementation is deferred, adds the prebuilt
runtime provider boundary to this setup. Before registration, `setup:cli` must
build and verify the explicitly selected `source-build` runtime artifact. A
missing, stale, or corrupt artifact must stop setup before registration and
direct the operator to `pnpm run build:runtime`.

Under that target behavior, the npm `bin` entrypoint instead injects the
`package` provider. The common compiled CLI accepts exactly one explicit
provider and does not infer it from the checkout, current directory, configured
path, or another filesystem artifact. A package artifact that cannot pass
verification is an incomplete or corrupt package; commands that consume or
verify the runtime provider stop and direct the operator to reinstall, while
source-independent `uninstall` remains available. Provider acceptance is
defined by the [Passive Runtime Contract](passive-runtime.md#provider-acceptance),
while
[Configuration](configuration.md#runtime-artifact-provider-selection) owns the
observable provider-selection boundary.

The target `prepack` behavior is the sole package-production gate: it creates
and verifies the package provider's prebuilt runtime before `npm pack` collects
the package. PR-PKG-01 and PR-PKG-02 own its lifecycle and inventory. Build,
package, provider, and setup integration remain deferred to a separate
implementation change.

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
- packaged fixed `skills/devcanon-runtime/` passive runtime bundle
- sample agent

Required composed-runtime behavior, whose implementation is deferred:

- fresh `init` performs
  [PR-LIFE-04](passive-runtime.md#lifecycle-and-repair-transitions) and produces
  the new-library payload under the central artifact-custody policy
- `init` is not a refresh command for an existing configured library; the
  explicit repair surface is `devcanon render`
- the resulting payload has the exact closed inventory in
  [Artifact custody](passive-runtime.md#artifact-custody), with neither
  `SKILL.md` nor a Codex invocation sidecar
- a scripts-only legacy runtime is not an accepted payload and is not upgraded
  or reconciled by `init`
- generated outputs remain disposable render results, not authoritative source
  files; the packed-tarball flow can run package-local `init` and then
  `validate` against the same explicit package provider

---

## `config path` and `config get`

Inspect the configuration selected for this command without rendering or
installing anything.

```bash
devcanon [--config <path>] [--json] [--strict] config path
devcanon [--config <path>] [--json] [--strict] config get <key>
```

`config path` prints only the selected absolute path in plain output. With
`--json`, it writes one JSON object with `path` and `source`, where `source` is
`explicit`, `environment`, `cwd`, or `bundled`.

`config get <key>` accepts dotted segments matching
`[A-Za-z0-9][A-Za-z0-9_-]*`; it rejects `__proto__`, `constructor`, and
`prototype` in every segment. It returns only scalar string, number, or boolean
values. Plain output prints string values directly and JSON-spells numbers and
booleans. With `--json`, it writes one JSON object with `path`, `source`, `key`,
and `value`. Containers and arrays, missing keys, unsafe key syntax, and
inherited-key paths are errors.

When no source configuration is selected, the command reads the packaged
`devcanon/runtime-config/v1` catalog. Its closed top-level object is
`{ schema, capabilityProfiles }`; `capabilityProfiles` remains owned by the
strict source schema rather than this command specification.

Selection, catalog-validation, and key errors use the CLI's ordinary error
output and exit non-zero; they do not emit a plain or JSON success value.

These commands select `--config`, then `DEVCANON_CONFIG`, then a current
directory `devcanon.config.yaml`, and finally the packaged runtime catalog only
when none of those source configurations is selected. A missing explicit or
environment path, an invalid selected source configuration, or an invalid
catalog fails closed; the command does not use a lower-precedence source or
fallback model. The full selection, catalog, and source-command boundary is
owned by [Configuration](configuration.md#runtime-configuration-discovery).

Commands operating on an existing library retain source-configuration discovery.
`init` independently creates configuration and does not discover or fall back.
No non-`config` command uses the packaged catalog as a fallback.

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

Validate config, the current fixed passive runtime bundle,
declaration-bearing skills, and agents. The passive runtime bundle is not
included in the source-skill count.

```bash
devcanon validate
```

Current implemented behavior:

- after config validation, the fixed passive runtime is validated separately
  before declaration-bearing source skills and is not included in the
  source-skill count
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

Required target behavior, whose implementation is deferred, validates the
explicit provider and its prebuilt runtime artifact after config validation and
before composition, passive-runtime validation, and declaration-bearing source
skills. It remains read-only and follows
[PR-LIFE-05](passive-runtime.md#lifecycle-and-repair-transitions): invalid
derived runtime state fails with `devcanon render` repair guidance. Provider
validation ordering is not current implemented behavior.

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
devcanon render --target <claude|codex>
```

`--target` limits generated outputs and stale-output cleanup to the selected
enabled target. Without it, `render` processes every enabled target. Only
`claude` and `codex` are accepted; any other supplied value, including an empty
string, is an error.

Required target behavior, whose implementation is deferred, makes `render`
accept and validate the explicit provider artifact before it writes a composed
passive-runtime tree. Under
[PR-LIFE-06](passive-runtime.md#lifecycle-and-repair-transitions), `render` is
also the explicit repair path for missing, stale, or provider-mismatched
derived runtime state and reconciles the subtree through PR-LIFE-11 before
writing generated output. It never selects an artifact from filesystem hints
or builds an artifact as a fallback. Source-build verification failures direct
the operator to `pnpm run build:runtime`; package verification failures direct
the operator to reinstall. The rendered payload and manifest identity are
owned by
[Install and sync](install-and-sync.md#passive-runtime-composition-and-transport).

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

`--mode` supplies the requested install mode. `--mode symlink` cannot override
the Codex agent-role constraint: those roles materialize as copies. Codex
skills and Claude outputs retain the requested mode. See
[Install and sync](install-and-sync.md) for effective-mode and migration
behavior.

`--reconcile-manifest` is available only to reconcile an unbound legacy
manifest that contains foreign records. It removes those foreign records from
the manifest only; it never deletes or rewrites their installed outputs. With
`--dry-run`, DevCanon previews the reconciliation and install plan without
writing or deleting anything.

A bound manifest whose configured-home boundary does not match fails before
rendering or mutation, and reconciliation cannot repurpose it. Bound manifests
with foreign records are rejected as well; use the original configured homes or
repair the manifest from a verified backup.

Manifest inspection is pure. Non-dry `sync` may explicitly recover invalid
manifest state only after an exact invalid-byte backup is verified, source
freshness is verified, and the invalid source is successfully unlinked. A clean
recovery warns with its exact verified allocated backup path and continues. A
cleanup-degraded recovery warns with the exact committed backup path, exits 1,
and performs no render, install, remove, no-op, or manifest save. Non-dry
`sync` exits 1 for source changed, lock unavailable, source unavailable or
unsafe, backup creation or verification failure (including suffix exhaustion),
and source retirement failure. Neither unrecovered nor cleanup-degraded state
produces a successful or no-op result or successful-backup wording.
For an unrecovered result, the primary category and cause remain authoritative.
When structured custody says a candidate remains, the error then names its
exact path and distinguishes unverifiable, retained-owned, and unmanaged
replacement custody; removed or never-created candidates receive no retained
artifact instruction. A pre-existing or retained recovery lock likewise names
the exact sibling-lock path and requires the operator to establish inactivity
before manual correction or removal. A lock already removed receives no lock
removal instruction. These ordered secondary actions do not replace the
primary failure, and every unrecovered result exits 1.
`sync` first inspects the manifest purely. An invalid `sync --dry-run` retains
that manifest-error precedence and exits before runtime validation. Under the
required deferred provider behavior, every other sync accepts and validates the
explicit prebuilt provider artifact before non-dry recovery, normalization or
binding, composition, rendering, or install mutation. Under PR-LIFE-07 and
PR-LIFE-08, dry run previews any required derived-subtree reconciliation
without mutation, while non-dry sync reuses the renderer-owned compositor and
may reconcile that subtree through PR-LIFE-11 before transport. Installed
`sync` only verifies and transports the prebuilt artifact: it never builds it
or resolves ambient dependencies. These transitions are owned by the
[Passive Runtime Contract](passive-runtime.md#lifecycle-and-repair-transitions)
and are target behavior, not claims about the current implementation.

For a non-dry invalid manifest, explicit recovery disposition follows, and only
recovered-clean state may continue. Sync then
normalizes and classifies accepted state; applies ownership disposition and
foreign-record policy; reconciles authorized foreign records record-only;
partitions accepted records and selected outputs into active/passive scope; and
validates component-aware managed-path collisions before legacy binding or save,
writable render, plan construction, printing, execution, managed-output
mutation or removal, and the final manifest save. Equal or lexical
ancestor/descendant installed paths conflict for distinct tuples when either is
active; same tuples, `foo`/`foobar` prefix siblings, and passive-passive pairs
outside the request are allowed. Reconciled-away foreign records are excluded
from collision validation but their paths remain protected for that invocation.

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
- Uninstall is source-independent and does not validate the authored runtime
  root, provider artifact, or rendered passive runtime from the source library.
- `--target` filters by Claude or Codex; default is all targets.
- `--dry-run` previews the plan without filesystem or manifest writes.
- An accepted or recovered-clean empty manifest (or empty filtered set) prints
  `Nothing to remove.` and exits 0.
- Per-record failures are accumulated; the run continues to subsequent
  records and exits non-zero at the end if any failed. Successfully
  removed records are still cleared from the manifest.
- Non-dry uninstall may explicitly recover invalid manifest state under the
  same verified-backup, freshness, commit, warning, and cleanup-degradation
  rules as `sync`. It exits 1 for source changed, lock unavailable, source
  unavailable or unsafe, backup creation or verification failure (including
  suffix exhaustion), and source retirement failure. A cleanup-degraded
  recovery warns with the exact committed backup path and exits 1. Neither
  class produces a successful or no-op result, and uninstall does not print
  `Nothing to remove.`. `--dry-run` performs inspection only and exits 1 on
  invalid or residual-lock state.
- Unrecovered candidate and sibling-lock custody uses the same exact-path,
  primary-first reporting contract as `sync`: retained unverifiable or owned
  candidates require inspection, replacements are explicitly unmanaged and
  never auto-deletable, and only pre-existing or retained locks receive manual
  inactivity/correction guidance. Removed or never-created artifacts are not
  reported as remaining. Every such result exits 1 before removal, save, or
  no-op output.
- After pure inspection and, for non-dry invalid state, only recovered-clean
  explicit recovery, component-aware collision validation occurs after
  ownership disposition and before uninstall plan construction, printing,
  execution, managed-output removal, and final manifest save. Target filtering
  makes nonselected identities passive, so passive-passive pairs are
  nonblocking; reconciliation protection for foreign paths remains separate
  from collision validation.

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

`diff` performs pure manifest inspection and never recovers or mutates the
manifest; invalid or residual-lock state fails actionably with exit 1 before
runtime validation or reporting differences. Under the required deferred
provider behavior, it then accepts and validates the explicit prebuilt provider
artifact through its source-driven composed render projection. It remains
read-only and does not repair invalid derived runtime state; PR-LIFE-09 owns
that failure and repair guidance. That provider addition is not current
implemented behavior.

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
- manifest inspection state; invalid or residual-lock state is reported as a
  warning through the existing manifest-accessibility catch rather than as a
  healthy result. `doctor` never recovers or mutates the manifest, and its
  overall exit behavior is unchanged unless another check independently errors.
- managed `.worktrees/` drift diagnostics, including orphaned entries,
  cross-repo Git metadata pointers, and unsafe symlink or path-containment
  shapes; this check is read-only and reports manual cleanup guidance

---

## `list`

List known skills and agents.

```bash
devcanon list
```
