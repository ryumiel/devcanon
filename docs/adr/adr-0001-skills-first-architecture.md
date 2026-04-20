# ADR-0001: Skills-First Architecture

## Status

Accepted

## Context

When managing personal AI workflows across Claude Code and Codex, the user
needs reusable operational knowledge (review checklists, debugging
methodologies, planning workflows) and tool-specific agent definitions.

The question was whether agents or skills should be the primary unit of reuse.

## Decision

Skills are the primary reusable unit. Agent roles are thin wrappers that
reference skills and add role-specific guidance.

Skills are tool-agnostic directories containing `SKILL.md` and optional
supporting assets. They install identically to both Claude Code and Codex
targets. Agent roles are defined once in neutral YAML and rendered into
native target formats.

## Consequences

- Operational knowledge is maintained in one place (skills) rather than
  duplicated across agent definitions.
- Adding a new target requires only a new renderer, not rewriting all
  operational knowledge.
- Agent definitions stay small and focused on role identity, model selection,
  and tool access.
- Skills must be self-contained enough to be useful without an agent wrapper.

## Alternatives considered

- **Agents-first:** embed all knowledge in agent definitions. Rejected because
  it leads to duplication across agents and coupling to specific target
  formats.
- **Monolithic prompt files:** single large files per agent with everything
  inlined. Rejected because it prevents sharing knowledge across agents and
  makes maintenance harder.
