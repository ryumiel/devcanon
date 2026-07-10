import { DEFAULT_MANIFEST_PATH } from "./identity.js";

export const DEFAULT_CONFIG_YAML = `version: 1

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
  path: ${DEFAULT_MANIFEST_PATH}

modelTiers:
  fast:
    claude:
      model: claude-haiku-4-5
    codex:
      model: gpt-5.6-terra
      reasoning_effort: low
  standard:
    claude:
      model: claude-sonnet-4-6
      effort: medium
    codex:
      model: gpt-5.6-sol
      reasoning_effort: high
  deep:
    claude:
      model: claude-opus-4-7
      effort: high
    codex:
      model: gpt-5.6-sol
      reasoning_effort: xhigh
`;

export const SAMPLE_SKILL_MD = `---
name: example-skill
description: A sample skill scaffold.
---

# Example Skill

Describe the workflow this skill supports.

## When To Use

- Describe when this skill should be used.

## Procedure

1. Step one.
2. Step two.
3. Step three.
`;

export const SAMPLE_AGENT_YAML = `name: example-agent
description: A sample agent scaffold.
instructions: |
  Describe what this agent does and how it should behave.

skills: []

claude:
  model: "{{model:standard}}"
  tools:
    - Read
    - Grep

codex:
  model: "{{model:standard}}"
  sandbox_mode: read-only
`;
