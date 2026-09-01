# Platform, Security, and Performance

---

## Cross-Platform Requirements

### Supported platforms

- macOS
- Linux
- Windows

### Windows requirements

- symlink support may depend on Developer Mode or privileges
- copy fallback must always be supported

### Workflow helper execution

Deterministic workflow helpers that support native Windows use a public Node
`.mjs` entrypoint. That entrypoint is the cross-platform command surface and
owns argument forwarding plus validation of the passive runtime's documented
stdout contract. A successful child exit is insufficient when stdout is empty,
multiline, malformed, or unsafe for a command that promises a token or path.
Commands with intentional silent success must declare that contract and reject
unexpected output.

POSIX `.sh` files beside a canonical `.mjs` helper are compatibility adapters
only. They delegate to Node and must not reimplement path, filesystem, schema,
state-transition, or output policy. Invoke the `.mjs` file directly on both
Windows and POSIX unless a POSIX-only caller specifically needs the adapter.

Native Windows workflows must never invoke bare `bash`. `bash.exe` on `PATH`
may be the Windows Store or WSL launcher, which is not evidence that a helper
ran against native Windows Git metadata. A workflow that still genuinely
requires Bash must run inside an already established POSIX environment or use
an explicitly resolved and usability-checked Git-for-Windows Bash executable.
Resolution must reject `WindowsApps` and WSL launchers, must not fall back to an
unverified first `PATH` match, and must stop with an actionable diagnostic when
Git Bash is unavailable. Native Windows Git worktree metadata must not be
translated into WSL paths.

The passive runtime's `scripts/resolve-bash.mjs` program is the sole shell
resolver for workflows that cannot yet avoid Bash. On Windows it considers an
explicit `DEVCANON_GIT_BASH` path and Git-for-Windows locations derived from
`git.exe` on `PATH`, verifies Bash, `cygpath`, and Git capabilities, and prints
exactly one absolute executable path. Callers must stop if that path output is
missing or malformed. Other skills and references may show invocation but must
not duplicate candidate selection or verification semantics.

For issue priming, `phase-artifacts.mjs`, `source-immutability.mjs`,
`write-research-brief.mjs`, `write-auto-handoff.mjs`, and
`write-assumptions-comment.mjs` are Node-first and require no Bash or WSL.
Their adjacent usage documents own concrete Windows and POSIX examples. Other
cataloged `.sh` helpers remain Bash-only until separately migrated; their usage
contracts must describe the supported shell boundary and must not imply that a
bare PowerShell `bash` lookup is supported.

When a Node-first helper reports a missing, unreadable, or incompatible passive
runtime, restore or re-sync the sibling `devcanon-runtime` bundle and rerun the
same `.mjs` entrypoint. For input, working-directory, path-safety,
artifact-state, or source-drift refusals, follow the adjacent helper usage
contract and correct the reported condition instead of re-syncing blindly.
When a remaining Bash-only helper cannot find verified Git Bash, install or
repair Git for Windows or rerun from a supported POSIX environment; do not
bypass the helper or infer success from missing output.

### Runtime package and isolation boundary

The runtime's portable-execution proof has three distinct environments on every
supported platform. A package manager may be used only to create a clean
fixture: install the packed tarball and its declared CLI dependencies into a
temporary prefix. The next phase uses the package-local `devcanon` CLI from
that prefix to initialize, validate, render, and sync a temporary library. It
must not resolve a package manager, globally registered CLI, source checkout,
or ambient dependency tree.

The final phase copies the resulting composed passive runtime to a second
isolated directory. Its wrapper, typed runtime, resolver, and trusted bootstrap
must execute there without `node_modules`, a global `devcanon` executable, or
ambient package resolution. Manually assembling a runtime payload does not
prove this boundary.

For the same canonical inputs and `artifact_origin`, clean independent builds
must produce byte-identical runtime bundle, manifest, and third-party-license
artifacts. Failure of package preparation, package-local CLI execution, copied
runtime isolation, attribution, or same-origin reproducibility fails the
production or proof flow. ADR-0024 owns artifact construction and attribution;
this section owns the platform-independent execution boundary and must not be
weakened by an implementation choice.

### PR-review session creation

The numbered transaction guarantees and failure equivalence classes are owned
by the
[`session-create` lifecycle contract](../../skills/pr-review/references/review-lease-lifecycle-contract.md#operating-model-and-guarantees).

- **SC-P1 — Supported actors:** transactional creation coordinates cooperating
  creators that share one primary-repository filesystem, including supported
  Linux and native Windows/Git Bash environments.
- **SC-P2 — Filesystem failure boundary:** unsupported no-clobber or filesystem
  behavior fails closed and preserves observed evidence for manual cleanup.
  Crash-retained evidence blocks later creation; no stale-owner reclamation is
  automatic.
- **SC-P3 — Non-guarantees:** the product does not guarantee coordination with
  hostile or uncooperative writers, distributed hosts, signal-complete
  recovery, pathname TOCTOU resistance, exhaustive ABA or race matrices, or
  filesystem behavior beyond fail-closed manual cleanup.
- **SC-P4 — Review acceptance:** a blocking finding must cite a violated
  numbered `SC-*` requirement or demonstrate a reproducible ordinary-use
  failure within SC-P1. A desired guarantee outside this operating model
  requires a deliberate spec change and separate issue.

### Path rules

- resolve all internal paths to normalized absolute paths
- normalize separators as needed

---

## Security and Safety

- no network access in v1
- no shell execution during normal sync flow
- no deletion of unmanaged files
- no overwrite of unmanaged files by default
- generated outputs should never be treated as source of truth

---

## Performance and Reliability

- deterministic rendering
- idempotent sync
- acceptable performance for at least 100 skills and 100 agents
- startup should feel fast for normal local usage
- filesystem operations should be testable and predictable
