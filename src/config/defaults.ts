import { DEFAULT_MANIFEST_PATH } from "./identity.js";

export const DEFAULT_CONFIG_YAML = `version: 2

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

capabilityProfiles:
  efficient:
    claude: claude-haiku-4-5-20251001
    codex: gpt-5.6-luna
  balanced:
    claude: claude-sonnet-5
    codex: gpt-5.6-terra
  frontier:
    claude: claude-opus-4-8
    codex: gpt-5.6-sol
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
capability: balanced

claude:
  tools:
    - Read
    - Grep

codex:
  sandbox_mode: read-only
`;
