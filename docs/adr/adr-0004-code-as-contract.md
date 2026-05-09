# ADR-0004: Code-as-Contract by Default

## Status

Accepted

## Context

AFDS v2 includes a contract registry/artifact profile for machine-readable
schemas and other durable contract authority surfaces. Contract artifacts are
useful when consumers need a deployed contract outside the source module, when
the contract is artifact-owned, or when a registry is needed to answer where
contract authority lives.

In DevCanon today, the durable interfaces are source-owned:

- config file format (validated by Zod schema in `src/config/schema.ts`)
- skill directory structure (validated in `src/validate/skills.ts`)
- agent YAML format (validated by Zod schema and rules in
  `src/validate/agents.ts`)
- manifest format (defined in `src/install/manifest.ts`)
- domain types (defined in `src/models/types.ts`)

All of these are machine-readable, validated at runtime, and authoritative by
virtue of being the code that processes the data.

## Decision

Use code-as-contract by default for DevCanon's current interfaces: Zod schemas,
TypeScript types, and validation code in source are the authoritative interface
definitions.

Do not create a hand-written `contracts/` directory that duplicates
source-owned schemas or types.

Create `contracts/` only when contract authority crosses an ownership or
deployment boundary:

- an external or generated artifact is the deployed contract;
- consumers need a stable contract artifact outside the source module;
- a registry is useful to make contract authority discoverable.

Contract authority follows the ownership/deployment boundary, not the runtime
boundary. Two modules communicating at runtime do not automatically require
`contracts/`; a contract artifact is warranted only when that artifact owns or
indexes authority.

Generated contracts are acceptable when they are clearly derived from the source
owner or explicitly own the external contract. The generation path must make the
authority clear so generated artifacts do not become a drifting second source of
truth.

The product specifications (`docs/specs/`) document intended behavior in
human-readable prose. The authoritative enforcement mechanism remains the
source owner unless a conditional contract artifact is introduced under the
rules above.

## Consequences

- Current DevCanon interfaces avoid contract/code drift because the code owns
  the contract.
- `contracts/` remains available for future artifact-owned or externally
  deployed contracts without weakening the current source-owned model.
- Reviewers must check ownership/deployment boundary before requesting a
  contract artifact.
- Developers may need to read source code for exact validation rules, while
  `docs/specs/` provides the human-readable overview.

## Alternatives considered

- **Always require JSON Schema in `contracts/`:** rejected because it would make
  a second source of truth for DevCanon's current source-owned interfaces.
- **Never allow `contracts/`:** rejected because future external consumers,
  generated artifacts, or contract registries may need an artifact-owned
  authority surface.
- **Generated contracts for every Zod schema:** viable later, but premature for
  a single-user CLI unless the generated artifact becomes the deployed contract
  or registry entry.
