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
