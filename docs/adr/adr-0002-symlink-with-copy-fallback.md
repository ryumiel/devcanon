# ADR-0002: Symlink Install with Copy Fallback

## Status

Accepted

## Context

Managed outputs (skills and rendered agent files) need to be installed from
the source library into user home directories (`~/.claude/`, `~/.codex/`,
`~/.agents/`). The install mechanism must handle:

- live updates when source files change
- cross-platform support (macOS, Linux, Windows)
- safe coexistence with unmanaged files in target directories

## Decision

Default install mode is `symlink`. Symlinks point from the install path back
to the source, so changes to source files are immediately reflected without
re-syncing.

On Windows, where symlinks may require Developer Mode or elevated privileges,
the tool falls back to `copy` mode. Copy mode can also be selected explicitly
via config or CLI flag.

## Consequences

- On macOS/Linux, source edits are instantly live in Claude Code and Codex
  without running `sync` again.
- On Windows, users must re-run `sync` after source changes to propagate
  updates.
- The manifest must track install mode per output so the tool knows how to
  clean up or update each managed file.
- Symlink detection logic must handle broken symlinks during cleanup.

## Alternatives considered

- **Copy-only:** simpler but requires re-sync after every source change.
  Rejected as the default because it adds friction to the primary workflow.
- **Hardlinks:** would work for files but not directories. Rejected because
  skills are directories with multiple files.
- **Watch mode:** auto-sync on file change. Deferred as a v1 non-goal to keep
  the tool simple.
