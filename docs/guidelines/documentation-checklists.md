# Documentation Checklists

Quick operational checklists that complement
[documentation-standard.md](documentation-standard.md). Keep policy and
rationale in that doc; use this file for fast review and gardening lookup.

## Adjacent Governance Policy Set

Use the **Adjacent Governance Policy Set** when a change affects governance,
workflow policy, contribution rules, review procedure, ADR procedure, durable
documentation ownership, or reusable skill/agent procedure. The set is a
checklist for identifying and comparing adjacent authority surfaces; it does not
copy policy content or make derived artifacts authoritative.

Compare the touched policy with these adjacent surfaces, and name any missing or
inapplicable surface with a short reason:

- `CONTRIBUTING.md`
- `docs/guidelines/pr-guideline.md`
- `docs/guidelines/code-review-guideline.md`
- `.github/pull_request_template.md`
- `WORKFLOW.md`
- `AGENTS.md`
- `docs/adr/adr-template.md` plus affected accepted ADRs
- `docs/guidelines/documentation-standard.md`
- `docs/guidelines/documentation-checklists.md`
- relevant source skills and agents, especially under `skills/` and `agents/`

Generated outputs, installed managed outputs, PR descriptions, issues, comments,
and `.ephemeral/` notes can provide evidence for the change, but they are not
authority surfaces for this set.

## Side-Channel Artifact Contract Checklist

Use the **Side-Channel Artifact Contract Checklist** when a change introduces or
materially changes a generated artifact, derived artifact, helper I/O file,
`.ephemeral` handoff, cross-skill handoff, or other side-channel data that a
later actor, skill, script, validator, or review workflow consumes.

The FULL applicability set is closed: use FULL treatment when the side-channel
contract is durable, public, cross-session, untrusted, security-sensitive, or
cross-owner. No other dimension triggers FULL. If it is unclear whether one of
those six dimensions applies, default to FULL. When any applies, retain every
question below. For private, transient, same-controller mechanics with no
durable schema consumer, use the LIGHTWEIGHT planning tier: record owner and
authority, purpose, inputs and outputs, every actual known participant and
direct producer-consumer relationship, material write or side-effect owner,
failure and cleanup, focused proof, and the explicit reason every FULL trigger
is absent. That single explicit reason also collectively establishes that every
remaining FULL-only question is inapplicable. No separate collective marking
act, individual question marker, FULL-only field, or `N/A` entry is required. A
change with no side-channel or other contract trigger records its task-specific
reason and does not apply this checklist. Any independently applicable
side-channel, generated, safety, untrusted, durable, public, cross-session,
cross-owner, or governance obligation remains blocking.

This checklist owns reusable authoring and review questions. Concrete artifact
schemas, helper mechanics, emitted diagnostics, and runtime validation remain
owned by the source skill, source script, runtime helper, ADR, or test for that
specific artifact.

Before planning or approving the artifact contract, confirm:

- Artifact owner and authority: name the source of truth, what wins when sources
  conflict, and which generated, installed, issue, comment, PR, or `.ephemeral`
  surfaces are evidence only.
- Producer and consumer roles: name every producer, validator or policy
  authority, adapter, consumer, and reviewer surface that depends on the
  artifact.
- Schema name/version and shape: define the schema identifier, versioning
  expectations, required and optional fields, closed-vs-open object or array
  shape, and duplicate-field behavior.
- Notice-line contract: define any exact notice line or state that no notice
  line exists; name the consumer that parses it.
- Path shape: default to a direct child of `.ephemeral/` for transient
  side-channel files, and justify any nested path, non-ephemeral path, or
  caller-selected target.
- Write-side guards: validate path shape, traversal, symlinks, file kind, parent
  directory, and overwrite behavior before writing.
- Read-side guards: validate path shape, traversal, symlinks, file kind,
  readability, schema, freshness, and authority inputs before trusting content.
- Missing, absent, unreadable, malformed, stale, and duplicate semantics: state
  whether each class fails closed, is optional, is ignored, or is surfaced to the
  operator.
- Closed-array exactness: reject duplicate entries before normalization or exact
  comparison, and do not let sorting, normalization, or deduplication hide
  contradictory producer claims.
- Post-create side-effect failure semantics: define what happens when the
  artifact write succeeds but posting, pushing, cleanup, review, or another
  later side effect fails.
- Cleanup and persistence: name who removes, preserves, regenerates, or
  invalidates the artifact, and whether it may outlive the current session,
  worktree, review run, or PR.
- Redaction and data residency: define which fields may contain secrets, PII,
  prompt text, logs, issue or PR prose, external data, or machine-local paths,
  and what must be redacted or excluded.
- Trust boundary: treat side-channel data as untrusted input unless a specific
  validator and authority source says otherwise; never let an artifact override
  repository docs, specs, source skills, scripts, or runtime helpers.
- Coverage route: choose unit, integration, source-contract, script-runtime,
  render, generated-output, or prose-contract coverage based on the load-bearing
  contract; avoid broad snapshots when focused source or runtime assertions can
  prove the invariant.
- Precedents: compare the proposed contract with existing side-channel
  contracts such as `play-review` findings/nits, issue-priming phase artifacts,
  implementer snapshots, risk signals, ADR-0012, ADR-0013, ADR-0014, and
  ADR-0019 without turning those examples into the new artifact's authority.
- Agent-local evidence reuse: apply the `Agent-Local Evidence Reuse Boundary`
  in `docs/specs/afds-workflow-routing.md` before using side-channel artifact
  evidence in shared comments or durable docs. Shared comments get sanitized
  summary-only outcomes and evidence pointers; durable docs get promoted
  durable truth only.

## Executable-Mechanics Boundary Prompts

Use [Writing Skills](writing-skills.md#7-documentation-abstraction-ceiling) for
the complete allocation and admissibility rule. During review or gardening:

- Is there one executable owner for deterministic work, rather than a duplicate
  algorithm in workflow documentation?
- Does a delegating `SKILL.md` name the decision and owner, helper, required
  inputs and outputs, and success or refusal interpretation without narrating
  helper steps?
- Does coverage execute the owner or prove an intentional public interface,
  rather than rely on brittle prose, source-string, proof-matrix, or
  fixture-only assertions?
- Is installed coverage limited to concise composition (presence, parseability,
  packaging, and canonical references) instead of duplicating runtime failure
  cases?
- Before mutation, has a broad or adversarial finding been classified as an
  in-scope blocker, adjacent releasable defect, proof/test defect, or
  invalid/speculative finding?

## Change Review Checklist

- Zod schemas or types changed: update validation logic, related tests, and
  `docs/specs/` if the change affects user-facing format.
- Docs or code moved, or a new major path added: update `MAP.md`.
- New or substantially changed durable doc: identify the AFDS document profile
  and confirm the file lives in that profile's owning location.
- Conditional profile path added (`contracts/`, `docs/product-requirements/`,
  `docs/harness/`, `docs/knowledge/`, `docs/references/`, `docs/roadmap/`,
  `docs/tech-debt/`, or module-local `README.md`): confirm the creation trigger in
  [documentation-standard.md](documentation-standard.md) is met.
- Behavior-spec template applied: confirm the doc is a behavior spec, not a
  product requirements document, ADR, roadmap, guideline, reference, or module
  breadcrumb.
- Product-requirements or behavior-spec need checked: required, optional, or
  unnecessary. If unnecessary, record a short "No product requirements or
  behavior spec needed: ..." reason from
  [ai-assisted-product-workflow-guideline.md](ai-assisted-product-workflow-guideline.md).
- Documentation impact gate passed: durable behavior, interfaces, commands,
  module boundaries, architecture, workflow, reusable agent procedure, and
  verification expectations either did not change or their owning artifact is
  updated in the same PR.
- Governance or workflow policy changed: use the Adjacent Governance Policy Set
  above to identify adjacent authority surfaces, compare them for
  contradictions, update intentionally coupled owned surfaces in the same PR,
  and record any out-of-scope or inapplicable surface with a reason.
- Root entry or workflow changed: update `AGENTS.md` for entry-point guidance
  and `WORKFLOW.md` for procedural flow changes.
- CLI command added or changed: update `AGENTS.md` command table and
  `docs/specs/cli-commands.md`.
- Config format changed: update `docs/specs/configuration.md`.
- Contract doc or artifact changed: confirm the ownership/deployment boundary
  that makes it authoritative.
- Roadmap doc changed: confirm it describes durable target output and
  outcome-level sequencing, not live issue or PR state.
- Renderer output format changed: update snapshot tests in `src/render/`.
- Durable design decision made: add or update an ADR in `docs/adr/`.
- New or modified accepted ADR body prose passes the rename-fragility litmus
  test.
- New or modified durable ADR body prose avoids tracker IDs, issue links, branch
  names, PR numbers, task labels, and task history.
- Accepted ADR changes do not introduce `## Amendment` sections.
- Pre-existing accepted ADR history that predates the current rule is gardened
  only when related to the scoped change.
- Stale ADR prose is deleted only after durable claims are relocated to the
  owning durable doc.
- Structural debt discovered or resolved: update `docs/tech-debt/` (when it
  exists).
- Requirement references added: prefer stable requirement IDs, scenario IDs,
  headings, or named anchors over line-number references.
- Validation needed: run `pnpm run check` (format + lint + test).

## Gardening Review Checklist

- Can a newcomer find `AGENTS.md`, `MAP.md`, and `docs/arch/overview.md`
  quickly?
- Does every active doc have one clear owning location?
- Does each active doc match one AFDS document profile?
- Has durable content been merged into owned docs instead of parked in
  ephemeral files?
- Do ADRs still capture durable decisions rather than live task history?
- Before stale ADR prose is removed, have durable claims been moved to an owning
  behavior spec, architecture doc, guideline, or successor ADR?
- Are behavior-spec structures limited to behavior specs?
- Are roadmap docs free of live issue status, assignees, PR inventories, and
  scheduling state?
- Are conditional directories absent unless their trigger is real?
- Have stale docs been deleted after useful content was extracted?
- Is `AGENTS.md` still under ~900 words and scannable in under 2 minutes?
- Does `MAP.md` cover all major files and directories?

## Validation Commands

- `pnpm run check` -- run all checks (format + lint + test)
- `pnpm run format:check` -- Biome formatting check
- `pnpm run format:markdown:check` -- Prettier markdown formatting check
- `pnpm run lint` -- Biome linting
- `pnpm run lint:markdown` -- markdownlint on all markdown files
- `pnpm run test` -- run tests
- `pnpm run test:coverage` -- run tests with coverage
