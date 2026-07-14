# Testing Requirements

---

## Unit tests

- config parsing
- schema validation
- strict version 2 capability-profile shape and default catalog
- path resolution
- renderer mapping
- literal-model, capability-model, and ambient-omission precedence
- explicit target-native effort without capability inheritance
- manifest update logic

---

## Integration tests

- init
- validate
- render
- sync in copy mode
- sync in symlink mode where supported
- diff
- doctor

---

## Test ownership

Render tests prove generated artifact behavior:

- artifact parseability, including Claude frontmatter, Codex TOML, and Codex
  skill sidecars
- target-specific field behavior and placeholder resolution
- generated packaging, mirrored skill files, metadata, hashes, and stale-output
  cleanup
- shipped skill and agent smoke coverage for both supported targets
- all three capability profiles rendered for both targets
- shipped implementer/reviewer capability plus explicit effort and research
  agent ambient-model/ambient-effort omission
- canonical skill model placeholders, former-token diagnostics, escapes, and
  fenced-code boundaries
- agent model-placeholder rejection in validation and direct render entrypoints

Render tests should not own broad skill prose, prompt wording, ADR wording,
workflow policy, or helper runtime behavior. Keep those contracts in the
authoritative source area:

- `src/skill-contracts/` tests source-owned skill prose, workflow policy,
  routing, handoff, and ADR alignment by reading `skills/**`, `docs/**`, and
  reference files directly.
- `src/skill-scripts/` tests executable helper runtime behavior by running
  source scripts from `skills/**/scripts/**` against focused fixtures.

Avoid long-lived full-output snapshots or phrase inventories for shipped skill
and agent bodies. Use structured artifact assertions and source-level contract
tests instead.

Source-contract tests should pin load-bearing invariants. Include coverage for:

- required inputs, outputs, handoff schemas, and notice lines consumed by other
  skills, agents, scripts, or generated outputs
- authority and ownership rules that decide which artifact wins when sources
  disagree
- path, trust-boundary, fail-closed, and compatibility behavior that protects
  safety or prevents ambiguous execution
- required helper/script references, routing decisions, and cross-skill
  preconditions that would break downstream workflows if removed

Do not use source-contract tests for:

- explanatory prose, examples, section narration, or repeated wording that has
  no consumer contract
- every guard message when the guard behavior is already covered by an
  executable helper test or a higher-level invariant
- duplicated checks whose only purpose is to keep old render-body phrase
  inventories alive in a different test suite

Only assert exact text when that text is itself the contract surface, such as a
schema name, emitted notice, CLI flag, environment variable, helper path, or
documented error consumed by another workflow.

For a breaking source-contract migration, compare deterministic v1 and v2
renders in isolation: require identical relative artifact inventory, parse
representative outputs, and enumerate an explicit allowlist of intentional
semantic deltas. Ignored `generated/` previews remain local evidence and are
not committed snapshot authority.

During review response, add the smallest source-owned assertion set that would
fail for a real contract regression and leave non-load-bearing wording to
source review.

---

## Snapshot tests

- focused fixture-based renderer output when byte-for-byte formatting is the
  behavior under test
- generated metadata fragments when structured parsing is not enough
