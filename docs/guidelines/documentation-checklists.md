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
- `docs/adr/adr-template.md` plus affected accepted ADRs
- `docs/guidelines/documentation-standard.md`
- `docs/guidelines/documentation-checklists.md`
- relevant source skills and agents, especially under `skills/` and `agents/`

Generated outputs, installed managed outputs, PR descriptions, issues, comments,
and `.ephemeral/` notes can provide evidence for the change, but they are not
authority surfaces for this set.

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
