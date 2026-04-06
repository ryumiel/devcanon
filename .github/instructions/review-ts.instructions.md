---
applyTo: "**/*.{ts,tsx}"
---

When performing a code review on TypeScript files, apply these checks in addition to the general review guideline (`docs/guidelines/code-review-guideline.md`):

**P0 -- Correctness & safety:**

- Zod schemas in `src/config/schema.ts` and `src/models/types.ts` must match the config format defined in SPEC.md
- File write operations in `src/install/` and `src/utils/fs.ts` must validate paths to prevent writing outside intended directories
- Errors in async functions must be handled -- no fire-and-forget promises
- No `any` in production code; `as any` only acceptable in test files for private member access

**P1 -- Architectural boundaries:**

- `src/render/` must not import from `src/install/` or vice versa
- Target-specific logic (Claude `.md` vs Codex `.toml`) must stay inside the respective renderer (`claude.ts`, `codex.ts`), not leak into shared modules
- Config schema changes must be accompanied by SPEC.md updates in the same PR
- New CLI commands must be accompanied by AGENTS.md command table updates

**P2 -- Tests & verification:**

- Renderer output changes require updated snapshot tests
- New validation rules require test cases for both valid and invalid inputs
- File system operations require tests covering error paths (missing dirs, permission errors, broken symlinks)
