---
applyTo: "**/*.{ts,tsx}"
---

<!-- GitHub repository custom instructions / Copilot consume the `applyTo` frontmatter in `.github/instructions/*.instructions.md`; see https://docs.github.com/en/copilot/how-tos/custom-instructions/adding-repository-custom-instructions-for-github-copilot for the authoritative format and matcher semantics. -->

When performing a code review on TypeScript files, apply these checks in addition to the general review guideline (`docs/guidelines/code-review-guideline.md`):

- `Blocking | Contracts`: Zod schemas in `src/config/schema.ts` and
  `src/models/types.ts` must match the config format defined in
  `docs/specs/configuration.md`
- `Blocking | Safety`: File write operations in `src/install/` and
  `src/utils/fs.ts` must validate paths to prevent writing outside intended
  directories
- `Blocking | Logic`: Errors in async functions must be handled; no
  fire-and-forget promises
- `Blocking | Maintainability`: No `any` in production code; `as any` is
  acceptable only in test files for private member access

- `Blocking | Architecture`: `src/render/` must not import from `src/install/`
  or vice versa
- `Blocking | Architecture`: Target-specific logic (Claude `.md` vs Codex
  `.toml`) must stay inside the respective renderer (`claude.ts`,
  `codex.ts`), not leak into shared modules
- `Blocking | Contracts`: Config schema changes must be accompanied by
  `docs/specs/configuration.md` updates in the same PR
- `Blocking | Documentation`: New CLI commands must be accompanied by AGENTS.md
  command table updates

- `Blocking | Tests`: Renderer output changes require updated snapshot tests
- `Blocking | Tests`: New validation rules require test cases for both valid
  and invalid inputs
- `Blocking | Tests`: File system operations require tests covering error
  paths (missing dirs, permission errors, broken symlinks)
