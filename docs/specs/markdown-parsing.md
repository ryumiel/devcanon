# Markdown Parsing Behavior

- Scope: DevCanon production Markdown structure parsing
- Status: Accepted
- Product requirement:
  [Markdown Structure Parsing](../product-requirements/markdown-structure-parsing.md)

---

## Purpose

This specification defines the Markdown syntax model, parsed-input boundary,
compatibility behavior, and source-preservation requirements for DevCanon
production consumers that inspect Markdown structure.

The parser identifies syntax. The consumer's owning artifact continues to
define semantic validity, required content, diagnostics, and workflow policy.

## Scope

This specification applies only to production Markdown consumers explicitly
selected by an owning contract. The initial selected behavior is skill
placeholder resolution and skill drift validation, which currently need to
distinguish block code from active content.

For that initial behavior, the parsed inputs are:

- the Markdown body extracted from `SKILL.md` after YAML frontmatter parsing;
- the skill `description` when drift validation inspects it as an independent
  Markdown fragment; and
- each top-level string value in the `claude` or `codex` override blocks when
  existing placeholder checks or rendering consume it as an independent
  Markdown fragment.

Other headings, sections, links, or tables become production parsed surfaces
only when their artifact owner defines a concrete semantic use. Existing
test-local adapters do not make those surfaces part of this production
contract.

## Supported Grammar

### MP-001: GFM Syntax Model

DevCanon interprets selected Markdown inputs as GitHub Flavored Markdown. The
supported model is CommonMark plus the GFM autolink-literal, strikethrough,
table, task-list-item, and tag-filter extensions.

GFM support means the parser can identify these structures when an owning
consumer needs them. It does not require authored documents to contain them,
and a checker must ignore structures outside its semantic contract.

Malformed or incomplete Markdown is interpreted using the grammar's normal
recoverable parse behavior. Parsing alone does not reject a document. A
consumer may report a failure only when its owning contract defines the failed
semantic condition.

### MP-002: Frontmatter and Fragment Boundary

YAML frontmatter is not Markdown. The existing frontmatter parser remains
responsible for detecting and parsing it. For `SKILL.md`, structural Markdown
parsing receives only the extracted body.

String values selected from parsed frontmatter are consumed independently as
Markdown fragments. Their source locations and syntax context are relative to
the exact fragment string, not to the YAML document. DevCanon does not pass
frontmatter wholesale to the Markdown parser.

## Parser and Checker Responsibilities

### MP-003: Syntax Facts

The shared parsing boundary may report facts established by the supported
grammar, including node kind, nesting, textual content, and source position.
It must not decide whether a particular artifact requires a heading, section,
table, link, or field.

### MP-004: Artifact Semantics

Artifact-specific checkers retain responsibility for:

- required structure, names, depth, order, location, and cardinality;
- normalization used for semantic matching;
- table columns, row contents, and relationships;
- active placeholder forms and glossary rules;
- diagnostics and severity; and
- workflow timing, interpretation, escalation, and approval.

There is no generic required-section contract for `SKILL.md`, and this
specification does not create one.

## Placeholder and Drift Compatibility

[Skill placeholders](skills.md#placeholders) remain semantically owned by the
skill specification. Structural parsing must preserve the following source
classification for placeholder resolution, active-placeholder validation, and
drift inspection.

### MP-005: Literal Block Code

Placeholder-shaped or drift-prone text inside a GFM block-code node is literal
content. This includes:

- backtick or tilde fenced code;
- indented block code; and
- fenced or indented block code nested in a block quote or list.

The consumer must not substitute, validate as active, or report drift for text
inside those block-code ranges.

### MP-006: Active Non-Block-Code Source

All source outside block-code ranges remains active under the existing
placeholder and drift contracts. In particular:

- ordinary list and block-quote prose is active;
- list continuation prose is active;
- inline code is active; and
- headings, links, HTML, and other non-block-code source are active.

Parser node names do not independently grant an exemption. A later change to
any active context requires an explicit update by the owning artifact rather
than an automatic expansion of code-like exclusions.

Existing placeholder escape, namespace, glossary, substitution, and diagnostic
behavior remains unchanged and is owned by the skill specification.

## Source Positions and Preservation

### MP-007: Input-Relative Positions

Syntax facts used for diagnostics or transformations must retain source ranges
relative to the exact string passed to the Markdown parser. Body
positions are relative to the extracted Markdown body; fragment positions are
relative to the independently parsed fragment.

Consumers must not combine positions from different inputs without an explicit
mapping owned by that consumer. A future need for raw-file positions may add a
frontmatter-to-body origin mapping, but it does not change the input-relative
contract here.

### MP-008: Source-Preserving Transformation

Production transformations operate on the original input string. Parsed node
values are inspection data and must not be serialized to replace the source.
Edits use original source ranges and preserve every untouched source slice.

## Compatibility and Runtime Boundaries

### MP-009: Migration Compatibility

Replacing a handwritten syntax recognizer must preserve:

- results for canonical DevCanon artifacts;
- behavior explicitly documented by the owning artifact;
- established diagnostics when syntax interpretation does not change the
  semantic failure; and
- source bytes outside intentional consumer-owned replacements.

Undocumented handwritten-scanner quirks are not compatibility commitments. If
the supported grammar changes an externally observable result, the owning
artifact must accept or reject that behavior explicitly instead of hiding the
decision in shared parsing mechanics.

### MP-010: Parser Upgrade Control

A grammar or parser upgrade that changes syntax classification on a selected
production surface is a behavior change. It requires compatibility review
against the owning consumer's canonical fixtures and documented syntax forms.
Parser availability alone must not broaden the fixture corpus into a general
CommonMark or GFM conformance suite.

### MP-011: Installed Helper Delivery

An installed skill that later uses parser-backed behavior must invoke its
managed, version-aligned sibling `devcanon-runtime` through its owning helper
adapter. It must not discover or invoke a separately installed `devcanon`
executable from `PATH`.

That sibling delivers parser behavior through the composed prebuilt ESM bundle
at `scripts/runtime/devcanon-runtime.mjs`. The generated artifact is accepted
before composition and transport; this delivery requirement does not select a
bundler, alter the GFM grammar, or add per-invocation hashing. The runtime
artifact architecture and verification regimes remain owned by
[ADR-0024](../adr/adr-0024-shared-support-skill-runtime.md), and the runtime
catalog carried alongside it remains owned by
[ADR-0035](../adr/adr-0035-installed-runtime-configuration-discovery.md).

The passive runtime may provide deterministic syntax facts or findings. The
owning skill continues to own the public helper contract and all judgment or
workflow policy. [ADR-0024](../adr/adr-0024-shared-support-skill-runtime.md)
remains authoritative for runtime packaging, resolution, and compatibility.

## Behavior Scenarios

### MP-SC-001: Literal Example in Block Code

Given a selected Markdown input containing an active placeholder in prose and
the same placeholder inside fenced, indented, or nested block code, the prose
placeholder is processed and the block-code placeholder remains byte-for-byte
literal.

### MP-SC-002: Active Code-Like and Container Source

Given placeholder-shaped text in inline code, a heading, a link, HTML, ordinary
list prose, or ordinary block-quote prose, the text remains active under the
existing placeholder contract because it is not inside block code.

### MP-SC-003: Skill Frontmatter Boundary

Given a `SKILL.md` with YAML frontmatter and a Markdown body, DevCanon parses
the frontmatter as YAML and the extracted body as GFM. A selected top-level
override string is parsed separately when its existing consumer processes it.

### MP-SC-004: Parser Capability Without Semantic Policy

Given a valid GFM table or heading in an artifact whose checker does not own a
table or heading rule, parsing succeeds and introduces no validation finding.

### MP-SC-005: Source-Preserving Replacement

Given a transformation that replaces active placeholders, only the intended
source ranges change. Original whitespace, fence spelling, inline markup,
wrapping, and all unrelated source remain unchanged.

### MP-SC-006: Future Installed Consumer

Given a separately approved installed artifact checker, its helper resolves
the sibling passive runtime's prebuilt ESM bundle and does not require a global
`devcanon` executable. Parser support alone does not approve or create that
checker.

## Acceptance Criteria

- [ ] Selected production Markdown inputs use the GFM syntax model in MP-001.
- [ ] Frontmatter and fragment handling follows MP-002 without parsing YAML as
      Markdown.
- [ ] Shared parsing exposes syntax facts without adding artifact semantics.
- [ ] Placeholder resolution and drift validation preserve MP-005 and MP-006.
- [ ] Source positions and transformations follow MP-007 and MP-008.
- [ ] Initial migration preserves the compatibility outcomes in MP-009.
- [ ] Parser changes are reviewed proportionately under MP-010 rather than
      treated as general conformance work.
- [ ] Any future installed consumer follows MP-011 and the accepted passive
      runtime architecture.
- [ ] No generic `SKILL.md` required-section rule, generic DevCanon-document
      schema, or parse-and-reserialize path is introduced.

## Verification Expectations

The initial implementation must verify:

- canonical skill renders and validations retain their existing results;
- focused cases cover fenced, indented, block-quoted, and list-nested block
  code as literal;
- focused cases cover ordinary container prose, inline code, headings, links,
  and HTML as active;
- at least one representative source-range assertion uses the exact parsed
  input coordinate space;
- transformations preserve all unrelated source bytes;
- existing user-facing diagnostics remain unchanged for the same semantic
  failures; and
- the superseded production scanner is removed after all of its consumers
  migrate.

Tests should use canonical artifacts and focused fixtures. They must not become
an exhaustive CommonMark/GFM parser suite or add unsupported representation
requirements solely for test completeness.

A future installed runtime consumer must additionally verify its actual
parser-backed operation from the second isolated copied runtime produced by the
clean source-build and packed-tarball proof. That execution has no source
checkout, package manager, ambient `node_modules`, or global `devcanon`
executable. This is an implementation-owned proof for issue #654, not the
initial source-side migration.

## Evidence Pointers

- [Markdown Structure Parsing product requirements](../product-requirements/markdown-structure-parsing.md):
  product intent, users, outcomes, and adoption boundaries - accepted owner.
- [Documentation Standard, Markdown contract-testing boundary](../guidelines/documentation-standard.md#55-markdown-contract-testing-boundary):
  production parsing requires an approved product need and supported grammar -
  accepted policy constraint.
- [Skill Specification, Placeholders](skills.md#placeholders): placeholder
  forms, escaping, active validation, and block-code exemption - accepted
  behavior owner.
- [ADR-0024, Runtime Packaging and Resolution](../adr/adr-0024-shared-support-skill-runtime.md#runtime-packaging-and-resolution):
  installed helpers use the version-aligned sibling passive runtime rather than
  a global CLI - accepted architecture owner.
- [`src/utils/markdown-structure.ts`](../../src/utils/markdown-structure.ts):
  shared GFM block-code range adapter used by production consumers - current
  source evidence.
- [`src/render/placeholders.test.ts`](../../src/render/placeholders.test.ts):
  current focused placeholder behavior corpus - passing source evidence.

## Agent Context

- Treat GFM as a syntax interpretation, not an artifact schema.
- Add a parsed surface only when its durable owner defines the semantic need.
- Keep required headings, tables, links, fields, and diagnostics in the owning
  artifact checker.
- Preserve the block-code-only exemption; do not exempt `inlineCode` or other
  syntax merely because it looks code-like.
- Never parse and reserialize authored Markdown for a source transformation.
- Keep installed skill mechanics in the sibling passive runtime, not the
  global DevCanon CLI.
- When implementation reveals a different observable behavior, update the
  owning durable contract instead of silently encoding policy in a parser
  adapter.

## Non-Goals

- Selecting a parser package, internal adapter API, module path, bundler, or
  runtime command name.
- Adding production dependencies or runtime commands.
- Defining generic required `SKILL.md` sections.
- Implementing planning, review, or other written-artifact validation.
- Replacing bounded test-only adapters without a production benefit.
- Preserving undocumented behavior that conflicts with the supported grammar.
