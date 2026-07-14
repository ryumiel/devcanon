# Architecture Overview

DevCanon is a user-wide Node.js CLI that manages shared AI skills and
generates native Claude Code and Codex agent files from a single source of
truth.

---

## Design Principles

Defined in [`docs/specs/core-concepts.md`](../specs/core-concepts.md). The
architecture implements all eight design principles defined there.

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
├─ runtime/    Shared typed helper foundation for packaged skill runtime code
└─ utils/      Filesystem helpers, path resolution, hashing, CLI output,
               naming validation
```

### Dependency Direction

Current production source imports use this top-level dependency shape
(test-only helpers excluded):

```
cli -> config, diff, install, models, render, utils, validate
render -> config, models, utils, validate
install -> config, models, render, utils, validate
validate -> config, models, render, utils
diff -> config, install, models, render, utils
config -> utils
runtime -> (node built-ins, zod)
models -> config
utils -> (none)
```

`cli/` has the broadest dependency fan-out. `utils/` is the only internal leaf
module.
`runtime/` is also isolated from CLI/render/install workflow authority; it owns
only deterministic helper mechanics used by packaged support skill entrypoints.

Some current dependencies are intentionally documented as implementation state,
not as a claim that the dependency direction is ideal:

- `models/` currently imports source schema types from `config/`, so schema
  ownership remains with `config/schema.ts` while shared domain types live in
  `models/types.ts`.
- `validate/` currently consumes frontmatter parsing from `render/`; the
  parser and serializer live in `render/frontmatter.ts`.
- `render/` currently imports validation loaders for `renderAll()` and
  `KNOWN_SUBDIRS` for generated skill mirroring.
- `install/` currently imports `KNOWN_SUBDIRS` from `validate/skills.ts` when
  checking mirrored skill subdirectories for copy-mode executable drift.

### Capability Profile Boundary

`src/config/schema.ts` owns the strict version 2 source contract and required
`capabilityProfiles` shape. `src/render/capability-profiles.ts` owns the small
model-only resolver used by both agent renderers: literal target model,
otherwise top-level capability mapping, otherwise ambient omission.

Capability resolution does not own target-native effort, tools, sandbox,
approval policy, context, authority, orchestration, retries, or escalation.
Those fields remain explicit in their source or workflow owners. Skill model
tokens are resolved separately by `src/render/placeholders.ts` against the same
catalog, within the existing prose, escape, and fence boundaries.

[ADR-0026](../adr/adr-0026-capability-profiles.md) owns the policy decision,
[Configuration](../specs/configuration.md) owns the user-facing behavior, and
[Capability Profiles v2 Migration](../guidelines/capability-profiles-v2-migration.md)
owns the manual operator cutover and rollback procedure.

### Semantic Agent Routing Boundary

ADR-0027 defines this section as the post-migration architecture. The
pre-migration implementation has four legacy source roles and no converged
six-role render inventory. While ADR-0027 remains Proposed, source files and
fresh render output remain the implementation-state evidence; this section does
not assert that migration has landed. Acceptance requires source, tests, and
both target outputs to converge on the target below.

The post-migration architecture exposes six thin semantic source roles:
`assessor`, `investigator`, `executor`, `implementer`, `reviewer`, and
`deep-reviewer`. Agent definitions own stable identity plus target-native
capability, effort, tools, and sandbox constraints. Skills own task-local
prompts, phase logic, schemas, fallbacks, retries, and termination.

Direct dispatch resolves cognitive demand and stance before selecting a
semantic role and exact capability/effort pair. Capability, effort, source
authority, external authority, tools, sandbox, network access, and escalation
remain independent. The evolving complete inventories live in the
[Agent Routing and Mutation Policy](../guidelines/agent-routing-and-mutation-policy.md);
[ADR-0027](../adr/adr-0027-semantic-agent-routing-and-mutation-authority.md)
owns the stable decision.

Source authority and external authority are separate closed axes. A
source-immutable role may run permitted commands and write one
dispatch-named direct-child `.ephemeral` handoff, but it may not edit durable
source. Every shared role defaults to no external authority; workflows grant a
named external mutation separately.

### Source-Immutability Runtime Boundary

The pre-migration runtime has no source-immutability command group or seven
workflow shims. Under the ADR-0027 post-migration architecture, packaged
`devcanon-runtime` owns the deterministic capture, verify, and cleanup mechanics
for the minimum source-immutable guard. The existing runtime entrypoint and
compatibility contract remain the only runtime-version boundary. Acceptance
requires thin adapters under `issue-priming-workflow`, `play-agent-dispatch`,
`play-planning`, `play-review`, `play-skill-authoring`,
`play-subagent-execution`, and `pr-merge` to locate the runtime and forward only
arguments, stdout, stderr, and exit status.

The guard fingerprints canonical worktree identity, `HEAD`, symbolic ref, raw
index entries, and tracked plus non-ignored untracked file kind, mode, and
content. An owner captures before spawn, verifies before semantic validation or
consumption, validates any exact named handoff into memory, cleans only the
owned baseline and handoff leaves, then consumes. It never repairs a source
mutation.

This is a deliberately minimal Git-visible comparison, not a filesystem
monitor, security sandbox, or durable evidence system. Ignored files other than
the named handoff, outside-worktree paths, races, external systems, and
provider-internal behavior remain outside coverage.

### Render Pipeline Boundary

The render module exposes two orchestration levels:

- `renderAll()` is the source-driven full-library facade. It loads and
  validates skills and agents from the configured source directories, renders
  the selected targets, and when writing generated output, removes stale
  generated files for the selected full source set.
- `renderLoaded()` is the loaded-input core. It consumes already-loaded and
  validated `LoadedSkill[]` and `LoadedAgent[]` values, so validation-owning
  callers can render cached or partial input sets. It does not reload skill or
  agent source definitions, does not write generated output by default, and
  does not perform stale generated-output cleanup. When writing skills with
  mirrored subdirectories, it still reads those subdirectories from
  `LoadedSkill.dirPath`. Agent-only or skill-omitting partial renders must pass
  `validatedSkills` with the full already-validated skill reference universe.

Generated-output cleanup is a full-library operation. Partial loaded-input
renders may write the supplied outputs when explicitly requested, but omitted
skills or agents are not treated as stale.

---

## Data Flow

The primary flow is the **sync pipeline**:

```
Source files          Config
(skills/, agents/)   (devcanon.config.yaml)
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

A supported output environment. Version 2 supports `claude` and `codex`.

### Managed Output

A generated file or installed skill directory that is owned and tracked by
`devcanon` via the manifest.

---

## Target Mapping

Source agent definitions render to target-native formats:

| Target | Agent format | Agent install path            | Skill install path         |
| ------ | ------------ | ----------------------------- | -------------------------- |
| Claude | Markdown     | `~/.claude/agents/<name>.md`  | `~/.claude/skills/<name>/` |
| Codex  | TOML         | `~/.codex/agents/<name>.toml` | `~/.agents/skills/<name>/` |

**Rule:** Shared source defines the role intent. Target-specific blocks in the
YAML define native behavior. Unsupported target fields are ignored with a
warning.

---

## Ownership and Manifest

`devcanon` owns only files it installed as managed outputs. The manifest
(`~/.devcanon/manifest.json`) is authoritative for tracking what was
installed.

Each manifest record includes: target, type (skill or agent), source path,
generated path, installed path, install mode, content hash, and timestamp.

---

## Install Modes

| Mode    | Behavior                                                                          | When used              |
| ------- | --------------------------------------------------------------------------------- | ---------------------- |
| symlink | Symlink from install path to source directory (skills) or generated file (agents) | Default on macOS/Linux |
| copy    | Full copy from generated output to install path                                   | Windows fallback       |

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

- Source-driven `renderAll()` rendering is deterministic and produces full
  regeneration each time
- Loaded-input `renderLoaded()` rendering is deterministic for the supplied
  already-validated inputs and may render partial sets without stale cleanup
- Generated files are not intended to be hand-edited
- Renderer normalizes: trailing newlines, line endings, indentation, multiline
  formatting, and field ordering
- The `generated/` directory is a preview/debug area, not authoritative
- Generated previews remain ignored and uncommitted local verification output
