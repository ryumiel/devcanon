# Project Management Model

## 1. Core Principles

1. **Repository owns durable truth**: specs, architecture, contracts, and decisions belong in repo docs and code. Example: `docs/specs/configuration.md` defines config format -- not a GitHub issue comment.
2. **Issue tracker owns live work**: assignments, status, blocking relationships, and scheduling belong in GitHub Issues. Example: "fix broken symlink handling" is an issue, not a doc.
3. **PR system owns review and merge flow**: review state, approval, and merge status belong in GitHub PRs. Example: review feedback lives in PR comments, not in docs.
4. **Agent sessions own temporary detail**: step-by-step implementation plans stay in the active session unless their result is durable. Example: an agent's plan for implementing an issue is session-local; the resulting code and docs are repo artifacts.
5. **One system of record per artifact**: do not duplicate the same information across repo docs, issues, and PR comments.

Companion guideline docs may expand an owning document, but they should link back to that owner instead of becoming a second source of truth.

## 2. Planning Vocabulary

| Artifact             | Meaning                                                | System of record               | Example                                                  |
| -------------------- | ------------------------------------------------------ | ------------------------------ | -------------------------------------------------------- |
| **Spec**             | Durable statement of intended behavior and constraints | `docs/specs/`                  | "Config file must be named `agents-manager.config.yaml`" |
| **Issue**            | One concrete problem or task to solve                  | GitHub Issues                  | "#5 -- diff command crashes on broken symlinks"          |
| **Pull Request**     | Proposed repository change that ships a solution       | GitHub PRs                     | "fix(diff): handle broken symlinks at install paths"     |
| **Agent-local plan** | Temporary execution steps for the current task         | Active session (not persisted) | "1. Read diff.ts, 2. Add symlink check, 3. Add test"     |

## 3. Ownership Table

| What                                         | Belongs in              | Does NOT belong in     |
| -------------------------------------------- | ----------------------- | ---------------------- |
| Intended behavior, constraints, format specs | `docs/specs/`           | Issue comments         |
| Repository structure                         | AGENTS.md, MAP.md       | Agent session notes    |
| Module responsibilities and architecture     | `docs/arch/overview.md` | Agent session notes    |
| Commit/PR/branch policy                      | CONTRIBUTING.md         | Scattered across docs/ |
| Bug reports, feature requests, task tracking | GitHub Issues           | Repository docs        |
| Review feedback, approval status             | GitHub PRs              | Repository docs        |
| Implementation plans for a single PR         | Agent session           | Repository docs        |

Detailed companion guides may elaborate on commit, PR, or branch policy, but `CONTRIBUTING.md` remains the canonical summary and owner for those rules.

## 4. Tech Debt Handling

- Small tech debt: create a GitHub issue with the `tech-debt` label when it is actionable.
- If resolution creates durable decisions or constraints not obvious from code, capture in the owning doc (`docs/specs/`, CONTRIBUTING.md, etc.) in the same PR.
- Do not create tech-debt tracking documents in the repo at this project stage -- GitHub Issues with the `tech-debt` label are the system of record.

## 5. When to Update Repo Docs After Implementation

When a merged PR changes any of these, update the owning doc in the same PR:

- Config format or schema -> `docs/specs/configuration.md`
- CLI commands -> AGENTS.md command table
- Module boundaries or file structure -> MAP.md, AGENTS.md repository structure
- Commit/PR/branch policy -> CONTRIBUTING.md
- Review or workflow procedures -> respective guideline doc
