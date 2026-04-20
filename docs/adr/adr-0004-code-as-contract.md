# ADR-0004: Code-as-Contract (No Separate Contracts Directory)

## Status

Accepted

## Context

AFDS v2 recommends a `contracts/` directory with machine-readable schemas for
cross-module interfaces. In `agents-manager`, the interfaces are:

- config file format (validated by Zod schema in `src/config/schema.ts`)
- skill directory structure (validated in `src/validate/skills.ts`)
- agent YAML format (validated by Zod schema and rules in `src/validate/agents.ts`)
- manifest format (defined in `src/install/manifest.ts`)
- domain types (defined in `src/models/types.ts`)

All of these are already machine-readable, validated at runtime, and
authoritative by virtue of being the actual code that processes the data.

## Decision

Use code-as-contract: Zod schemas and TypeScript types in source code are the
authoritative interface definitions. Do not create a separate `contracts/`
directory.

The product specifications (`docs/specs/`) document the intended format in
human-readable prose. The code is the enforcement mechanism.

## Consequences

- No risk of contract/code drift -- the code _is_ the contract.
- One fewer directory to maintain.
- Developers must read source code to understand exact validation rules, but
  `docs/specs/` provides the human-readable overview.
- If the project later needs to expose contracts to external consumers (e.g.,
  a skill registry), a `contracts/` directory may be reconsidered.

## Alternatives considered

- **JSON Schema in `contracts/`:** extract Zod schemas to standalone JSON
  Schema files. Rejected because it would create a second source of truth
  that must stay in sync with the Zod schemas.
- **Generated contracts:** auto-generate JSON Schema from Zod at build time.
  Viable but premature for a single-user CLI with no external consumers.
