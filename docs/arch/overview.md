# Architecture Overview

`agents-manager` is a user-wide Node.js CLI that manages shared AI skills and
generates native Claude Code and Codex agent files from a single source of
truth.

---

## Design Principles

Defined in [`docs/specs/core-concepts.md`](../specs/core-concepts.md). The
architecture implements all seven design principles defined there.

---

## Module Responsibilities

```
src/
├─ cli/        CLI entrypoint and command wiring (commander)
├─ config/     Config loading, Zod schema, defaults
├─ models/     Shared domain types (Skill, AgentRole, Target, Manifest)
├─ validate/   Validation for config, skills, and agent source files
├─ render/     Deterministic rendering to Claude (.md) and Codex (.toml)
├─ install/    Sync orchestration, install plan, manifest, copy/symlink modes
├─ diff/       Diff between generated outputs and installed managed outputs
└─ utils/      Filesystem helpers, path resolution, hashing, managed headers,
               CLI output, naming validation
```

### Dependency Direction

```
cli -> config, diff, install, models, render, utils, validate
render -> config, models, utils, validate
install -> config, models, render, utils
validate -> config, models, utils
diff -> config, install, models, render, utils
config -> utils
models -> (none)
utils -> (none)
```

`cli/` has the broadest dependency fan-out. `models/` and `utils/` are leaf
modules with no internal dependencies.

---

## Data Flow

The primary flow is the **sync pipeline**:

```
Source files          Config
(skills/, agents/)   (agents-manager.config.yaml)
       │                    │
       ▼                    ▼
   ┌────────────────────────────┐
   │         validate           │
   └────────────┬───────────────┘
                ▼
   ┌────────────────────────────┐
   │          render            │
   │  (Claude .md, Codex .toml) │
   └────────────┬───────────────┘
                ▼
   ┌────────────────────────────┐
   │      compute install plan  │
   └────────────┬───────────────┘
                ▼
   ┌────────────────────────────┐
   │    apply (symlink / copy)  │
   └────────────┬───────────────┘
                ▼
   ┌────────────────────────────┐
   │      update manifest       │
   └────────────────────────────┘
```

Steps: load config -> validate source -> render outputs -> compute install
plan -> apply install plan -> update manifest -> print summary.

---

## Core Concepts

### Skill

A reusable workflow stored as a directory containing `SKILL.md` and optional
supporting assets (`examples/`, `references/`, `scripts/`, `assets/`). Skills
are shared across Claude Code and Codex targets.

### Agent Role

A tool-agnostic source definition of a specialist, written in YAML. Agent
roles are not installed directly -- they are rendered into native target
formats (Claude `.md`, Codex `.toml`).

### Target

A supported output environment. v1 supports `claude` and `codex`.

### Managed Output

A generated file or installed skill directory that is owned and tracked by
`agents-manager` via the manifest.

---

## Target Mapping

Source agent definitions render to target-native formats:

| Target | Agent format | Agent install path          | Skill install path       |
| ------ | ------------ | --------------------------- | ------------------------ |
| Claude | Markdown     | `~/.claude/agents/<name>.md`  | `~/.claude/skills/<name>/` |
| Codex  | TOML         | `~/.codex/agents/<name>.toml` | `~/.agents/skills/<name>/` |

**Rule:** Shared source defines the role intent. Target-specific blocks in the
YAML define native behavior. Unsupported target fields are ignored with a
warning.

---

## Ownership and Manifest

`agents-manager` owns only files it installed as managed outputs. The manifest
(`~/.agents-manager/manifest.json`) is authoritative for tracking what was
installed.

Each manifest record includes: target, type (skill or agent), source path,
generated path, installed path, install mode, content hash, and timestamp.

Generated files include a machine-readable managed header (markdown comment or
TOML comment) identifying the source.

---

## Install Modes

| Mode    | Behavior                                                          | When used              |
| ------- | ----------------------------------------------------------------- | ---------------------- |
| symlink | Symlink from install path to source directory (skills) or generated file (agents) | Default on macOS/Linux |
| copy    | Full copy from generated output to install path                   | Windows fallback       |

### Overwrite Policy

- `skip-existing` -- never overwrite
- `overwrite-managed` -- replace only files tracked in manifest (default)
- `overwrite-all` -- replace anything at the install path

Unmanaged files are never overwritten unless explicitly forced.

---

## Safety Boundaries

- No network access
- No shell execution during normal sync flow
- No deletion of unmanaged files
- No overwrite of unmanaged files by default
- Generated outputs are never treated as source of truth
- Partial failure reports per-target success/failure and exits non-zero

---

## Generated Output Rules

- Rendering is deterministic and produces full regeneration each time
- Generated files are not intended to be hand-edited
- Renderer normalizes: trailing newlines, line endings, indentation, multiline
  formatting, and field ordering
- The `generated/` directory is a preview/debug area, not authoritative
