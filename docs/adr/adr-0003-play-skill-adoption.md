# ADR-0003: Play Skill Adoption from Superpowers

## Status

Accepted

## Context

The Superpowers plugin provided 10 methodology skills (brainstorming, planning,
TDD, debugging, etc.) that were used daily across projects. These skills were
coupled to the Superpowers plugin ecosystem with cross-references, visual
companion features, and platform-specific notes for tools other than Claude
Code and Codex.

With `agents-manager` managing user-wide skills, the Superpowers plugin could
be replaced entirely by adopting these skills into the local library.

## Decision

Adopt all 10 methodology skills with a `play-` prefix and moderate adaptations:

| Superpowers Original             | Local Name                |
| -------------------------------- | ------------------------- |
| `brainstorming`                  | `play-brainstorm`         |
| `writing-plans`                  | `play-planning`           |
| `subagent-driven-development`    | `play-subagent-execution` |
| `verification-before-completion` | `play-verification`       |
| `finishing-a-development-branch` | `play-branch-finish`      |
| `systematic-debugging`           | `play-debug`              |
| `writing-skills`                 | `play-skill-authoring`    |
| `dispatching-parallel-agents`    | `play-agent-dispatch`     |
| `test-driven-development`        | `play-tdd`                |
| `receiving-code-review`          | `play-review-response`    |

Adaptations applied: rename cross-references to local `play-*` names, remove
platform-specific notes (Cursor, Gemini, Copilot CLI), remove visual companion
features, soften prescriptive phrasing, update output paths to project-local
conventions.

## Consequences

- The Superpowers plugin is no longer needed and can be uninstalled.
- All methodology skills are now under local control and can evolve
  independently.
- The `play-` prefix visually groups methodology skills and avoids name
  conflicts with domain skills.
- Existing skills (`pr-review`, `pr-merge`, `branch-review`,
  `github-issue-priming`) had their cross-references updated to point to
  local `play-*` names.

## Alternatives considered

- **Keep Superpowers plugin:** continue using the upstream plugin. Rejected
  because it added a dependency and prevented local customization.
- **Fork without prefix:** adopt with original names. Rejected because it
  risked name collisions with domain skills and made it harder to distinguish
  methodology from domain skills.
- **Selective adoption:** adopt only a subset. Rejected because the skills
  form an interconnected methodology (brainstorm -> plan -> execute -> verify
  -> finish) and partial adoption breaks the workflow chain.
