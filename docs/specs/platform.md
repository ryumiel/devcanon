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

The portable-execution acceptance proof has three distinct environments on
every supported platform.

1. A package manager may create only a clean fixture by installing the packed
   tarball and its declared CLI dependencies into a temporary prefix.
2. With package-manager and global-CLI access removed, the package-local
   `devcanon` executable from that prefix initializes, validates, renders, and
   syncs a temporary library under a dedicated empty temporary home selected
   through both `HOME` and `USERPROFILE`. The proof must remove any inherited
   `DEVCANON_CONFIG` and explicitly select the fixture configuration. Before a
   non-dry sync, it must resolve all four target homes and the manifest path and
   assert that each is contained by the fixture root. The executable must not
   resolve a source checkout or an ambient dependency tree.
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
validated selected-runtime entrypoint, preserve exact arguments and exit
status, and reject a target outside that selected runtime before child
execution. The fixed sibling bootstrap remains the trust anchor, but a valid
explicit override may select a structurally validated runtime outside the
bootstrap's copied runtime under PR-BOOT-01 through PR-BOOT-03. A separate A/B
fixture supplies a controlled override and proves that the bootstrap loads from
A, dispatches a contained target from disjoint selected runtime B, and rejects
a target escaping B. Before
execution, the harness must assert that no `node_modules` directory is
reachable through the selected entrypoint's or working directory's ancestor
chains; successful execution under that condition and the sanitized
environment is the ambient-resolution proof. The
[Passive Runtime Contract](passive-runtime.md#trusted-bootstrap-and-selected-runtime)
owns the shared containment semantics.

The same final phase invokes the copied public `scripts/resolve-bash.mjs`
adapter through the test process's current Node executable under the same
sanitized boundary. Under identical controlled resolver inputs, one successful
resolution and one no-usable-Bash refusal must match the corresponding direct
runtime call's stdout bytes, stderr bytes, and exit status. Success emits
exactly one absolute executable path followed by LF, emits no stderr, and exits
zero. Refusal emits no stdout and preserves the direct runtime's single
actionable diagnostic and nonzero exit status. This focused adapter-equivalence
check does not duplicate the resolver's complete candidate matrix.

On POSIX, the same final phase additionally invokes
`scripts/devcanon-runtime.sh` and proves that its contract and bootstrap
stdout bytes, stderr bytes, and exit status each match the corresponding direct
`.mjs` call exactly. The shell file is only a delegation proof; direct Node
execution remains the cross-platform proof surface.

Native Windows implementation and machine proof are deferred to the dedicated
Windows follow-up. That work runs the fixture, package-local CLI, copied-runtime
and disjoint selected-runtime phases from native Node. Native Node, rather than
Bash or a `.sh` adapter, launches the copied runtime and public resolver; the
resolver may execute a controlled Git-for-Windows Bash candidate as the
behavior under proof. The work must prove direct `.mjs` runtime and bootstrap
behavior, copied public-resolver success and actionable refusal, exact output
and exit propagation, and absence of ambient resolution. The follow-up's live
state is not a normative dependency of this specification.

For the same canonical inputs and `artifact_origin`, clean independent builds
must produce byte-identical runtime bundle, manifest, and third-party-license
artifacts. Failure of package preparation, package-local CLI execution, copied
runtime isolation, attribution, or same-origin reproducibility fails the
production or proof flow. Supported-platform acceptance consumes the passive
runtime behavior spec's isolation and reproducibility requirements; ADR-0024
records their architecture rationale. Implementation choices must not weaken
that accepted contract.

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
