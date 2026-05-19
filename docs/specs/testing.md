# Testing Requirements

---

## Unit tests

- config parsing
- schema validation
- path resolution
- renderer mapping
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

Source-contract tests should pin load-bearing invariants, not every reviewer
quoted phrase. Test durable behavior boundaries: required inputs and outputs,
authority/ownership rules, handoff schemas and notice lines, path and trust
boundaries, fail-closed behavior, required helper/script references, routing
decisions, and compatibility promises. Do not test explanatory prose, examples,
section narration, repeated wording, reviewer-quoted snippets, or every guard
message unless changing that text would break a consumer, safety property, or
documented contract.

During review response, add the smallest source-owned assertion set that would
fail for a real contract regression and leave non-load-bearing wording to
source review.

---

## Snapshot tests

- focused fixture-based renderer output when byte-for-byte formatting is the
  behavior under test
- generated metadata fragments when structured parsing is not enough
