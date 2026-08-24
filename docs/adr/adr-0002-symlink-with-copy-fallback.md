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

Default requested install mode is `symlink`. Symlinks point from the install
path to generated outputs, so updates to linked generated outputs are
immediately reflected without re-copying.

On Windows, where symlinks may require Developer Mode or elevated privileges,
eligible symlink outputs fall back to `copy` mode. Copy mode can also be
requested explicitly via config or CLI flag.

Codex user agent roles are a narrow effective-mode exception: they always
materialize as regular copied files, regardless of the requested mode. This
constraint does not change requested-mode behavior for Codex skills or Claude
outputs.

## Consequences

- On macOS/Linux, updates to linked generated outputs are instantly reflected
  for symlinked outputs without re-copying.
- Copied outputs, including Codex user agent roles, require `sync` after
  generated-output changes to propagate updates.
- On Windows, copied fallback outputs likewise require `sync` after source
  generated-output changes.
- The manifest tracks the actual install mode per output so the tool can clean
  up or update each managed file.
- Symlink detection logic must handle broken symlinks during cleanup.

## Alternatives considered

- **Copy-only:** simpler but requires re-sync after every generated-output
  update.
  Rejected as the default because it adds friction to the primary workflow.
- **Hardlinks:** would work for files but not directories. Rejected because
  skills are directories with multiple files.
- **Watch mode:** auto-sync on file change. Deferred as a v1 non-goal to keep
  the tool simple.
