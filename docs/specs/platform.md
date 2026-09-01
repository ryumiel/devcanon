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

The following portable-execution acceptance proof is required target behavior;
its implementation is deferred with the prebuilt runtime. It has three distinct
environments on every supported platform.

1. A package manager may create only a clean fixture by installing the packed
   tarball and its declared CLI dependencies into a temporary prefix.
2. With package-manager and global-CLI access removed, the package-local
   `devcanon` executable from that prefix initializes, validates, renders, and
   syncs a temporary library. The executable must not resolve a source checkout
   or an ambient dependency tree.
3. The proof copies the resulting composed passive runtime, without manual
   assembly, to a second isolated directory. From a working directory outside
   both the checkout and install prefix, it invokes the copied runtime using
   the test process's current Node executable. Child processes receive a
   constructed allowlisted environment rather than inherited process state.
   `NODE_PATH`, `NODE_OPTIONS`, `DEVCANON_RUNTIME_DIR`, and uncontrolled npm,
   pnpm, Corepack, and Yarn variables are explicitly absent; `PATH` exposes no
   package manager or global `devcanon`; no ancestor or working directory
   contains `node_modules`; and the copied payload is the only runtime input.

In the final phase on every platform, Node invokes
`scripts/runtime/devcanon-runtime.mjs` directly for the `runtime contract`,
typed-runtime, resolver, and `bootstrap` surfaces. The contract command must
exit zero and emit exactly the documented single-line JSON descriptor with the
`devcanon-runtime` command group and supported integer major. Each successful
typed command must produce its documented stdout, stderr, and exit status;
malformed or extra output fails the proof. Trusted bootstrap must dispatch the
validated copied entrypoint, preserve exact arguments and exit status, and
reject an override or target outside the copied runtime before child execution.
Before execution, the harness must assert that no `node_modules` directory is
reachable through the copied entrypoint's or working directory's ancestor
chains; successful execution under that condition and the sanitized
environment is the ambient-resolution proof.

On POSIX, the same final phase additionally invokes
`scripts/devcanon-runtime.sh` and proves that its contract and bootstrap
stdout bytes, stderr bytes, and exit status each match the corresponding direct
`.mjs` call exactly. The shell file is only a delegation proof; direct Node
execution remains the cross-platform proof surface.

On native Windows, the fixture, package-local CLI phase, and copied-runtime
phase run from a native Node test process and invoke neither Bash nor any `.sh`
file. Runtime contract and trusted-bootstrap acceptance use the direct `.mjs`
surface. The child environment allowlist contains only controlled values for
`SystemRoot`, `WINDIR`, `SystemDrive`, `ComSpec`, `HOME`, `TEMP`, `TMP`,
`PATHEXT`, and `PATH`, plus `DEVCANON_GIT_BASH` only in the positive resolver
case. Additional platform variables require an explicit test-owned reason;
inherited `npm_*`, `NPM_CONFIG_*`, `PNPM_*`, `COREPACK_*`, and `YARN_*`
variables are omitted. The suite explicitly verifies that `NODE_PATH`,
`NODE_OPTIONS`, and `DEVCANON_RUNTIME_DIR` are absent.

After tarball installation, package-local CLI execution, and copied-runtime
setup, every native-Windows acceptance run exercises both resolver subcases:

- **Verified Git for Windows:** the harness supplies a controlled real
  Git-for-Windows installation through an absolute `DEVCANON_GIT_BASH` and a
  controlled `PATH`. Resolution must exit zero, emit exactly one LF-terminated
  absolute `bash.exe` path on stdout, emit empty stderr, and prove the required
  Bash, `cygpath`, and Git capabilities through that selected installation.
- **Actionable refusal:** the harness unsets `DEVCANON_GIT_BASH`, uses a
  controlled `PATH` with no valid Git-for-Windows installation, and provides
  explicit WindowsApps or WSL-launcher decoys and unusable Git-derived
  candidates for every applicable rejection path. Resolution must exit
  non-zero, emit empty stdout, emit exactly the specified actionable diagnostic
  on stderr, and select none of the decoys or unusable candidates.

Command assertions must identify the copied entrypoint, outside-checkout
working directory, allowlisted environment, exact contract output, exact
stdout/stderr bytes and exit status, and absence of ambient resolution.
Manually assembling a runtime payload or invoking a checkout-local helper does
not prove this boundary.

For the same canonical inputs and `artifact_origin`, clean independent builds
must produce byte-identical runtime bundle, manifest, and third-party-license
artifacts. Failure of package preparation, package-local CLI execution, copied
runtime isolation, attribution, or same-origin reproducibility fails the
production or proof flow. Supported-platform acceptance consumes ADR-0024's
sole isolation and reproducibility architecture ownership; implementation
choices must not weaken that accepted contract.

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
