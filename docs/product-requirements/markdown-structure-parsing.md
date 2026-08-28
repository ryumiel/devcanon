# Markdown Structure Parsing Product Requirements

Scope: DevCanon production Markdown consumers

---

## Purpose

DevCanon should use one documented Markdown syntax interpretation when
production behavior needs to distinguish prose from structural Markdown. This
product capability lets maintainers replace narrowly handwritten syntax
recognition without turning Markdown representation into workflow policy or
artifact validity.

The initial product need is the existing skill placeholder and drift behavior,
which must distinguish active content from literal block-code examples. Future
artifact checkers may reuse the same syntax interpretation only after the
artifact's durable owner defines the semantic rules they enforce.

## Problem

DevCanon production code currently recognizes Markdown prose and block code
with project-owned scanner logic. Other repository checks have their own
test-local heading and table adapters. As more consumers need syntax facts,
independent scanners can disagree about the same source and accumulate edge
case handling that established Markdown parsers already provide.

At the same time, adopting a general parser without a product boundary could
make incidental heading order, prose wording, or optional Markdown constructs
part of artifact validity. It could also encourage parse-and-reserialize flows
that alter author formatting. DevCanon needs shared syntax understanding while
keeping each artifact's semantic contract with its existing owner.

## Users

### DevCanon Maintainers

Maintainers need production Markdown consumers to share a predictable syntax
model, preserve established behavior, and avoid growing project-owned Markdown
grammar logic.

### Skill Authors

Skill authors need placeholder examples and other literal block code to remain
unchanged while active skill prose continues to render and validate as
documented.

### Workflow and Documentation Authors

Authors of future written-artifact contracts need reliable syntax facts and
source locations without having a parser invent semantic requirements for
their artifacts.

## Product Goals

### MSP-PR-001: One Supported Syntax Model

DevCanon should define one supported Markdown grammar for production surfaces
that explicitly opt into structural parsing.

### MSP-PR-002: Preserve Owned Behavior

Replacing handwritten syntax recognition should preserve the observable
behavior already owned by skill, rendering, validation, and artifact
contracts.

### MSP-PR-003: Separate Syntax From Policy

Shared parsing should report Markdown syntax facts. Artifact-specific owners
should continue to define required structures, matching rules, diagnostics,
and workflow validity.

### MSP-PR-004: Preserve Source Fidelity

Production transformations should operate on the original Markdown source and
must not normalize author formatting by parsing and reserializing the document.

### MSP-PR-005: Remain Portable Across Installed Skills

If an installed skill later uses parser-backed mechanics, those mechanics
should follow the existing version-aligned sibling passive-runtime contract
without requiring a separately installed `devcanon` executable on `PATH`.

## Broad Requirements

### MSP-PR-FR-001: Explicit Opt-In Surfaces

Only production consumers with a documented need and an owning artifact
contract should parse Markdown structure. Parser availability alone must not
expand validation scope.

### MSP-PR-FR-002: Defined Grammar

The supported grammar and the boundary between Markdown, YAML frontmatter, and
independently consumed Markdown fragments must be defined before production
migration.

### MSP-PR-FR-003: Shared Syntax Interpretation

Eligible production consumers should derive block-code, heading, link, table,
and other selected syntax facts from the same grammar instead of introducing
new delimiter scanners or regular-expression grammars.

### MSP-PR-FR-004: Source-Aware Results

Syntax interpretation should retain locations relative to the exact parsed
input so diagnostics and transformations can refer back to original source.

### MSP-PR-FR-005: Bounded Compatibility

Migration should preserve canonical artifacts and explicitly documented syntax
behavior. DevCanon is not required to preserve undocumented scanner quirks or
support every alternative representation accepted by a general Markdown
parser.

### MSP-PR-FR-006: Passive Runtime Boundary

Future installed parser-backed helpers must remain passive deterministic
mechanics delivered through the managed sibling `devcanon-runtime`. The owning
skill retains workflow policy, interpretation, escalation, and approval.

## Non-Goals

- Defining generic required sections for `SKILL.md` or other Markdown files.
- Making optional Markdown features mandatory in authored documents.
- Defining a generic "valid DevCanon document" schema.
- Using Markdown syntax representation as planning or execution validity.
- Rewriting or formatting Markdown through syntax-tree serialization.
- Building a general CommonMark or GFM conformance suite.
- Designing a future planning or review artifact checker.
- Selecting internal module placement, dependency packaging, build tooling, or
  runtime command names.
- Making the global `devcanon` CLI a runtime dependency of installed skills.

## Assumptions, Risks, and Dependencies

### Assumptions

- Markdown source remains authoritative; any parsed structure is transient.
- Existing artifact owners continue to own semantic validation and user-facing
  diagnostics.
- New parser-backed surfaces are adopted incrementally against a concrete
  production need.

### Risks

- A grammar or parser upgrade can change syntax interpretation and therefore
  alter consumer results unless compatibility behavior is verified.
- Consumers can accidentally turn parser structure into new semantic policy if
  they query more syntax than their artifact contract needs.
- Parse-and-reserialize behavior can create formatting drift and noisy source
  changes.
- A future installed helper can violate portability if its parser code depends
  on an ambient checkout, package manager, or global CLI.

### Dependencies

- [Markdown parsing behavior](../specs/markdown-parsing.md) owns the supported
  grammar, exact parsed surfaces, compatibility behavior, and verification
  expectations.
- [Skill specification](../specs/skills.md) remains the semantic owner for
  skill placeholders and drift validation.
- [ADR-0024](../adr/adr-0024-shared-support-skill-runtime.md) owns passive
  runtime packaging, sibling resolution, and the prohibition on global CLI
  discovery for installed helper behavior.
- Repository policy separately governs approval of production dependencies and
  architecture-affecting implementation choices.

## Open Questions

No product decision blocks replacing the existing placeholder and drift
scanner under the linked behavior spec. Each additional production Markdown
surface must identify its own artifact contract and benefit before adoption.

## Readiness Criteria

The product intent is ready for implementation slicing when
[Markdown parsing behavior](../specs/markdown-parsing.md):

- defines the supported grammar and frontmatter boundary;
- identifies the initial parsed inputs;
- preserves the existing placeholder and drift behavior baseline;
- separates syntax facts from artifact semantics; and
- defines source-preservation and verification expectations.

Future installed written-artifact checks are not ready from this product
requirement alone. Their owning durable artifact must first define the exact
semantic contract.

## Product Validation Criteria

The product capability is successful when:

- the initial production consumer uses the shared supported syntax model
  without changing its documented results;
- project-owned Markdown grammar logic decreases as migrated consumers stop
  using superseded scanners;
- no parser adoption introduces new required sections or representation-based
  workflow validity;
- source-preserving behavior leaves all unrelated Markdown bytes unchanged;
  and
- any installed consumer remains version-aligned with its sibling passive
  runtime and independent of a global `devcanon` executable.

## Expected Follow-Up Artifacts

- [Markdown parsing behavior](../specs/markdown-parsing.md) is the immediate
  behavior owner for the initial production migration.
- Implementation work may replace one existing handwritten production scanner
  after the behavior spec is accepted and dependency changes are approved.
- A future written-artifact checker requires a separate owning behavior
  contract and executable issue before runtime implementation begins.
