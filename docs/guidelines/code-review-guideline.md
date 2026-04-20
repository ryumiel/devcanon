# Code Review Guideline

## 1. Scope

This guideline applies to all code and documentation changes, and covers three review modes:

- **Self-review**: Author checks their own code before opening a PR
- **Agent-assisted review**: AI agents (Claude Code, Codex) review code using these priorities
- **Peer review**: Human reviewers follow the same priorities when reviewing others' code

## 2. Review Priorities

| Priority | Focus                    | Blocking? | What to check                                                                                                                                                                                                                                                                                                                                                            |
| -------- | ------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **P0**   | Correctness & safety     | Yes       | Logic bugs in validation, rendering, or install. Path traversal or symlink escape in `src/install/` and `src/utils/fs.ts`. Unhandled errors that silently corrupt output. File operations that write outside intended target directories. Zod schema mismatches between config parsing and runtime usage.                                                                |
| **P1**   | Architectural boundaries | Yes       | Render module (`src/render/`) must not depend on install module (`src/install/`) or vice versa. Config schema changes in `src/config/schema.ts` must stay aligned with `docs/specs/configuration.md`. Target-specific logic (Claude vs Codex) must stay inside respective renderers, not leak into shared code. Skill and agent models must match the source schema defined in `docs/specs/`. |
| **P2**   | Tests & verification     | Yes       | New logic has tests. Bug fixes include a regression test. All CI checks pass (`pnpm run check`). Snapshot tests updated when renderer output changes.                                                                                                                                                                                                                    |
| **P3**   | Maintainability          | Nit only  | Naming clarity. Nesting depth (3+ levels = signal). Dead code. Comments only where logic is non-obvious.                                                                                                                                                                                                                                                                 |

## 3. Review Workflow

1. Read the PR description (or diff summary for self-review)
2. Check CI status -- if red, fix before reviewing further
3. Review in priority order: P0 -> P1 -> P2 -> P3
4. For each finding, classify by priority level
5. Stop detailed review if a P0 issue is found -- flag it immediately
6. Prefix optional suggestions with `nit:`

## 4. What Reviewers Should NOT Do

- Request style changes already enforced by Biome or Prettier
- Block on hypothetical future requirements
- Rewrite the PR in comments -- name the problem, suggest a direction
- Request changes you would not actually reject the PR over
- Hold approval waiting for nits to be addressed

## 5. Self-Review Checklist

Before opening a PR, the author should verify:

- [ ] `pnpm run check` passes locally
- [ ] No P0 issues in changed files (scan for unsafe file operations, unvalidated paths, schema mismatches)
- [ ] No P1 boundary violations (render ↔ install separation, config schema ↔ spec alignment)
- [ ] Tests exist for new behavior; bug fixes have regression tests
- [ ] PR description follows the PR guideline (see `docs/guidelines/pr-guideline.md`)
- [ ] CONTRIBUTING.md PR checklist answered (schema, snapshot, docs updates)

## 6. Agent-Assisted Review

When an AI agent reviews code, it must:

- Follow the same P0-P3 priority order as human reviewers
- Never approve its own authored code -- a separate review (human or different agent session) is required
- Cite specific file paths and line numbers for each finding
- Provide a concrete example or fix suggestion for P0/P1 findings
- Classify each comment by priority level (e.g., `[P0]`, `[P1]`, `[nit]`)
- Verify CI status rather than assuming correctness
- Check the CONTRIBUTING.md PR checklist items that can be verified mechanically (schema alignment, snapshot freshness, MAP.md coverage)
