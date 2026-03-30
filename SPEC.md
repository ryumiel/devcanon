# agents-manager SPEC

Version: 1.0  
Status: Draft for implementation  
Scope: v1  
Runtime: Node.js CLI  
Targets: Claude Code, Codex  
Install scope: User-wide only

---

## 1. Overview

`agents-manager` is a Node.js CLI for managing a personal library of:

- shared **skills**
- tool-specific **agent wrappers**
- generated outputs for **Claude Code** and **Codex**

The tool is designed for **user-wide** setup, not repository-level setup.

The core design is:

- skills are the primary reusable unit
- agent roles are defined once in a neutral source format
- native Claude and Codex agent files are generated from those role definitions
- generated outputs are installed into the user’s home directories

`agents-manager` does **not** manage global `CLAUDE.md` or `AGENTS.md` files in v1.

---

## 2. Product Goal

Provide one maintainable source of truth for personal AI workflows across Claude Code and Codex without forcing the user to manually maintain multiple agent files.

---

## 3. Non-Goals

The following are out of scope for v1:

- repository-level management
- GitHub Copilot support
- management of `CLAUDE.md`
- management of `AGENTS.md`
- remote registries or skill marketplaces
- watch mode
- GUI or TUI
- cloud sync
- inheritance between agents
- editing generated outputs in place as source of truth
- management of `~/.codex/config.toml`

---

## 4. Core Concepts

### 4.1 Skill

A **skill** is a reusable workflow stored as a directory containing `SKILL.md` and optional supporting assets.

Examples:

- `pr-review`
- `implementation-plan`
- `bug-triage`
- `release-check`

Skills are shared across Claude Code and Codex.

### 4.2 Agent Role

An **agent role** is a tool-agnostic source definition of a specialist.

Examples:

- `reviewer`
- `planner`
- `debugger`

Agent roles are not installed directly. They are rendered into native target formats.

### 4.3 Target

A **target** is a supported output environment.

Supported in v1:

- `claude`
- `codex`

### 4.4 Install Mode

Defines how managed outputs are installed:

- `symlink`
- `copy`

### 4.5 Managed Output

A generated file or installed skill directory that is owned and tracked by `agents-manager`.

---

## 5. Design Principles

1. **Source-first**  
   Source files are authoritative. Generated outputs are disposable.

2. **Skills first**  
   Reusable operational knowledge belongs in skills.

3. **Thin wrappers**  
   Agents should remain lightweight wrappers over skills and role guidance.

4. **Native outputs**  
   Generated Claude and Codex files should look like ordinary native files for those tools.

5. **Safe sync**  
   Unmanaged files must not be overwritten by default.

6. **Deterministic rendering**  
   Same source plus same config must produce identical outputs.

7. **Cross-platform support**  
   Must work on macOS, Linux, and Windows.

---

## 6. User Stories

### 6.1 Initialize a library

As a user, I want to initialize a personal library so I can manage my skills and agents in one place.

### 6.2 Create a skill

As a user, I want to scaffold a new skill so I can define a reusable workflow quickly.

### 6.3 Create an agent role

As a user, I want to define an agent once and generate Claude and Codex wrappers from it.

### 6.4 Validate source files

As a user, I want to validate my library before install so I can catch mistakes early.

### 6.5 Preview generated outputs

As a user, I want to render generated files locally before syncing them into my home directories.

### 6.6 Install managed outputs

As a user, I want to sync my source library into Claude and Codex user directories.

### 6.7 Inspect differences

As a user, I want to see what changed between source-generated and installed outputs.

### 6.8 Diagnose environment problems

As a user, I want a doctor command to tell me whether my system paths, permissions, and symlink support are working.

---

## 7. Source Layout

Recommended v1 layout:

```text
agents-manager/
├─ package.json
├─ agents-manager.config.yaml
├─ skills/
│  ├─ pr-review/
│  │  ├─ SKILL.md
│  │  └─ examples/
│  └─ implementation-plan/
│     └─ SKILL.md
├─ agents/
│  ├─ reviewer.yaml
│  ├─ planner.yaml
│  └─ debugger.yaml
├─ generated/
│  ├─ claude/
│  │  └─ agents/
│  └─ codex/
│     └─ agents/
└─ src/
   └─ ...
```

Notes:

- `skills/` is the shared source of truth for reusable skills.
- `agents/` contains neutral agent role definitions in YAML.
- `generated/` is a render preview/debug directory and is not authoritative.

---

## 8. Installed Target Layout

### 8.1 Claude target

```text
~/.claude/
└─ skills/
   ├─ pr-review/
   └─ implementation-plan/

~/.claude/agents/
├─ reviewer.md
├─ planner.md
└─ debugger.md
```

### 8.2 Codex target

```text
~/.agents/
└─ skills/
   ├─ pr-review/
   └─ implementation-plan/

~/.codex/agents/
├─ reviewer.toml
├─ planner.toml
└─ debugger.toml
```

Notes:

- Codex shared skills are installed to `~/.agents/skills`.
- Codex native custom agents are installed to `~/.codex/agents/`.
- `agents-manager` does not manage `~/.codex/config.toml` in v1.

---

## 9. Configuration

### 9.1 Config file name

`agents-manager.config.yaml`

### 9.2 Example

```yaml
version: 1

library:
  skillsDir: ./skills
  agentsDir: ./agents
  generatedDir: ./generated

targets:
  claude:
    enabled: true
    skillsHome: ~/.claude/skills
    agentsHome: ~/.claude/agents
    installMode: symlink

  codex:
    enabled: true
    skillsHome: ~/.agents/skills
    agentsHome: ~/.codex/agents
    installMode: symlink

defaults:
  installMode: symlink
  overwritePolicy: overwrite-managed
  cleanManagedOutputs: true

platform:
  windowsSymlinkFallback: copy

manifest:
  path: ~/.agents-manager/manifest.json
```

### 9.3 Rules

- relative paths are resolved relative to the config file directory
- `~` must be expanded
- target-specific settings override defaults
- unknown top-level config fields produce warnings in normal mode and errors in strict mode

---

## 10. Skill Specification

### 10.1 Required structure

Each skill is a directory under `skills/` and must contain:

- `SKILL.md`

### 10.2 Optional content

A skill may also contain:

- `assets/`
- `examples/`
- `references/`
- `scripts/`

### 10.3 Validation rules

- skill directory name must be filesystem-safe
- `SKILL.md` must exist
- skill names must be unique
- broken internal symlinks are errors

### 10.4 Install behavior

Skills are installed to:

- Claude: `~/.claude/skills/<skill-name>`
- Codex: `~/.agents/skills/<skill-name>`

Each target is treated as a separate install target even when the source content is shared.

---

## 11. Agent Source Schema

### 11.1 File format

YAML

### 11.2 Example

```yaml
name: reviewer
description: Review code for correctness, regressions, and missing tests.
instructions: |
  Lead with concrete findings.
  Prefer correctness and regression issues over style comments.
  Use the pr-review skill when relevant.

skills:
  - pr-review
  - release-check

claude:
  model: sonnet
  tools:
    - Read
    - Grep
    - Bash

codex:
  sandbox_mode: read-only
```

### 11.3 Required fields

- `name`
- `description`
- `instructions`

### 11.4 Optional fields

- `skills`
- `claude`
- `codex`
- `tags`
- `notes`

### 11.5 Not supported in v1

- inheritance
- extends/merge behavior
- overlays as a first-class feature
- automatic prompt composition from multiple files

### 11.6 Validation rules

- `name` must be filesystem-safe
- agent names must be unique
- referenced skills must exist
- unknown shared fields are warnings in normal mode and errors in strict mode
- unknown target-specific fields are warnings in normal mode and errors in strict mode

---

## 12. Target Mapping Policy

Because Claude and Codex do not use the same native agent format, `agents-manager` follows this rule:

**Shared source defines the role intent. Target-specific blocks define native behavior. Unsupported target fields are ignored with warning.**

### 12.1 Claude mapping

Source agent definitions render to:

- `generated/claude/agents/<name>.md`
- installed at `~/.claude/agents/<name>.md`

Render format:

- Markdown
- YAML frontmatter
- body contains normalized instructions

### 12.2 Codex mapping

Source agent definitions render to:

- `generated/codex/agents/<name>.toml`
- installed at `~/.codex/agents/<name>.toml`

Render format:

- TOML
- normalized multiline instruction fields

---

## 13. Generated Output Rules

### 13.1 Determinism

Rendering must be deterministic.

### 13.2 Full regeneration

Generated outputs are recreated from source on each render.

### 13.3 Manual editing policy

Generated outputs are not intended to be hand-edited.

### 13.4 Managed header

Generated files should include a machine-readable managed header where format allows.

Examples:

- Markdown comment for Claude files
- TOML comment for Codex files

Example text:

```text
Managed by agents-manager. Do not edit directly.
Source: agents/reviewer.yaml
```

### 13.5 Normalization

Renderer should normalize:

- trailing newline
- line endings
- indentation
- multiline formatting
- stable field ordering where applicable

---

## 14. Ownership and Manifest

### 14.1 Ownership model

`agents-manager` owns only files and directories it installed as managed outputs.

### 14.2 Manifest

Manifest is authoritative for tracking installed outputs.

Default path:

```text
~/.agents-manager/manifest.json
```

### 14.3 Suggested manifest fields

Each managed record should include:

- target
- type (`skill` or `agent`)
- source path
- generated path
- installed path
- install mode
- content hash
- timestamp

### 14.4 Header vs manifest

Both managed headers and manifest should be used, but the manifest is authoritative.

---

## 15. Install and Sync Policy

### 15.1 Sync steps

1. load config
2. validate source
3. render outputs
4. compute install plan
5. apply install plan
6. update manifest
7. print summary

### 15.2 Default install mode

- default: `symlink`
- Windows fallback: `copy`

### 15.3 Overwrite policy

Supported policies:

- `skip-existing`
- `overwrite-managed`
- `overwrite-all`

Default:

- `overwrite-managed`

### 15.4 Conflict policy

- unmanaged files are never overwritten by default
- managed files may be replaced during sync
- unmanaged conflicts require explicit force behavior to overwrite
- deleted managed outputs may be cleaned up if manifest tracking confirms ownership

### 15.5 Partial failure policy

If multiple targets are requested and one fails:

- report success and failure per target
- exit with non-zero status if any requested target failed

---

## 16. CLI Commands

### 16.1 `init`

Initialize a new `agents-manager` library.

Example:

```bash
agents-manager init
```

Creates:

- config file
- source directories
- sample skill
- sample agent

### 16.2 `new skill <name>`

Create a new skill scaffold.

Example:

```bash
agents-manager new skill pr-review
```

### 16.3 `new agent <name>`

Create a new agent scaffold.

Example:

```bash
agents-manager new agent reviewer
```

### 16.4 `validate`

Validate config, skills, and agents.

Example:

```bash
agents-manager validate
```

### 16.5 `render`

Generate outputs into `generated/` without installing.

Example:

```bash
agents-manager render
```

### 16.6 `sync`

Render and install managed outputs.

Example:

```bash
agents-manager sync
```

Supported options should include:

- `--target claude`
- `--target codex`
- `--mode copy`
- `--mode symlink`
- `--dry-run`
- `--force`

### 16.7 `diff`

Show differences between generated outputs and installed outputs.

Example:

```bash
agents-manager diff
```

### 16.8 `doctor`

Inspect environment health.

Example:

```bash
agents-manager doctor
```

Checks should include:

- Node version
- config discovery
- path expansion
- target directory existence
- write permission
- symlink capability
- manifest accessibility

### 16.9 `list`

List known skills and agents.

Example:

```bash
agents-manager list
```

---

## 17. Diff Behavior

`diff` compares:

- current generated outputs
- current installed managed outputs

It should report:

- added
- removed
- changed
- unmanaged conflicts

Diff output may be line-based for v1.

---

## 18. Error Handling

### 18.1 User errors

Examples:

- invalid config
- missing `SKILL.md`
- duplicate agent names
- missing referenced skill
- invalid install mode

Behavior:

- print human-readable error
- return non-zero exit code

### 18.2 Environment errors

Examples:

- missing permission
- invalid home path
- symlink creation failure
- broken target directory

Behavior:

- print actionable guidance
- include fallback hint where possible

### 18.3 Strict mode

In strict mode:

- warnings for unknown fields become errors

---

## 19. Logging and Output

### 19.1 Default mode

Human-readable CLI output.

### 19.2 Optional machine-readable mode

Support `--json` for structured output.

### 19.3 Log levels

- `quiet`
- `normal`
- `verbose`
- `debug`

---

## 20. Cross-Platform Requirements

### 20.1 Supported platforms

- macOS
- Linux
- Windows

### 20.2 Windows requirements

- symlink support may depend on Developer Mode or privileges
- copy fallback must always be supported

### 20.3 Path rules

- resolve all internal paths to normalized absolute paths
- normalize separators as needed

---

## 21. Security and Safety

- no network access in v1
- no shell execution during normal sync flow
- no deletion of unmanaged files
- no overwrite of unmanaged files by default
- generated outputs should never be treated as source of truth

---

## 22. Performance and Reliability Requirements

- deterministic rendering
- idempotent sync
- acceptable performance for at least 100 skills and 100 agents
- startup should feel fast for normal local usage
- filesystem operations should be testable and predictable

---

## 23. Implementation Architecture

Suggested high-level structure:

```text
src/
├─ cli/
│  ├─ index.ts
│  └─ commands/
├─ config/
│  ├─ load.ts
│  └─ schema.ts
├─ models/
│  ├─ skill.ts
│  └─ agent.ts
├─ validate/
│  ├─ skills.ts
│  ├─ agents.ts
│  └─ config.ts
├─ render/
│  ├─ claude.ts
│  └─ codex.ts
├─ install/
│  ├─ sync.ts
│  ├─ manifest.ts
│  ├─ copy.ts
│  └─ symlink.ts
├─ diff/
│  └─ diff.ts
└─ utils/
   ├─ paths.ts
   ├─ fs.ts
   ├─ hash.ts
   └─ output.ts
```

Suggested stack:

- TypeScript
- Node.js LTS
- `commander` or `cac`
- `zod`
- `yaml`
- `fs-extra`
- `diff`
- optional color library for CLI output

---

## 24. Testing Requirements

### 24.1 Unit tests

- config parsing
- schema validation
- path resolution
- renderer mapping
- manifest update logic

### 24.2 Integration tests

- init
- validate
- render
- sync in copy mode
- sync in symlink mode where supported
- diff
- doctor

### 24.3 Snapshot tests

- Claude generated `.md`
- Codex generated `.toml`

---

## 25. v1 Milestones

### Milestone 1: Project skeleton

- CLI bootstrap
- config loader
- init
- new skill
- new agent

### Milestone 2: Validation and rendering

- skill validation
- agent validation
- Claude renderer
- Codex renderer

### Milestone 3: Sync and ownership

- manifest support
- copy install mode
- symlink install mode
- doctor

### Milestone 4: Diff and hardening

- diff
- conflict handling
- JSON output
- improved error messages

---

## 26. Recommended v1 Defaults

The following defaults are part of the intended v1 design:

- source layout: `skills/`, `agents/`, `generated/`
- agent format: YAML
- install mode: symlink by default
- Windows fallback: copy
- ownership: manifest plus generated header
- overwrite policy: overwrite managed only
- shared skill source, native generated agents

---

## 27. One-Sentence Definition

`agents-manager` is a user-wide Node.js CLI that manages shared AI skills and generates native Claude Code and Codex agent files from a single source of truth.
