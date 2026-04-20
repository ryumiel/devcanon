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
