# Documentation Standard

**Based on:** Agent-Friendly Documentation Standard (AFDS)\
**Scope:** DevCanon repository\
**Goal:** Make repository knowledge discoverable, durable, low-rot, and legible
to both humans and agents.

---

## 1) Core principles

1. **One canonical agent entry point:** `AGENTS.md` at repo root.
   - Short table of contents, not an encyclopedia.
2. **One canonical answer to "where is X?":** `MAP.md` at repo root.
3. **One source of truth per concern:**
   - Agent entry point -> `AGENTS.md`
   - Navigation / file discovery -> `MAP.md`
   - Product requirements -> `docs/product-requirements/`
   - Behavior specs -> `docs/specs/`
   - System architecture -> `docs/arch/`
   - Decisions / rationale -> `docs/adr/`
   - Contributor policy, engineering guidelines, and workflows ->
     `CONTRIBUTING.md`, `docs/guidelines/`, or `WORKFLOW.md`
   - Roadmap direction -> `docs/roadmap/` (when needed)
   - Tech debt records -> `docs/tech-debt/` (when issue labels are
     insufficient)
4. **Code-as-contract by default:** source-owned Zod schemas and TypeScript
   types are the authoritative interface definitions. A `contracts/` directory
   is conditional, not mandatory.
5. **Progressive disclosure:** agents start from `AGENTS.md`, then load deeper
   docs only when needed.
6. **Docs close to change:** module-specific knowledge lives near the module
   when possible.
7. **Mechanical anti-rot:** correctness of docs and structure should be
   enforced by scripts, CI, or lint rules where practical.
8. **Durable repo knowledge only:** the repository stores durable knowledge,
   not ephemeral run-state.

### 1.1 Terminology

- **AFDS**: Agent-Friendly Documentation Standard, the repository documentation
  model that separates durable repo knowledge, live issue tracking, PR review
  state, and agent-local execution detail.
- **Owning durable AFDS artifact**: a repository-owned doc, source file, schema,
  ADR, roadmap item, guideline, or other maintained artifact that remains
  authoritative after a single issue, PR, or agent session ends.
- **Agent-local artifact**: temporary execution context produced or used by an
  agent session, such as plans, scratch files, preserved issue context, or
  `.ephemeral/` files.
- **Generated output**: a disposable render result under `generated/<target>/`.
- **Installed managed output**: a target-home file or directory installed by
  `devcanon sync` and tracked by the install manifest.

---

## 2) AFDS document profiles

Profiles define the ownership boundary for a durable document. They do not
force every document into one template. New or substantially changed docs should
align with their profile first; existing docs are gardened opportunistically.

| Profile                    | Location                                             | Status                                    | Owns                                                                                                                                    | Must not own                                                                                       | Creation trigger                                                                                               |
| -------------------------- | ---------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Agent entry point          | `AGENTS.md`                                          | Mandatory baseline                        | Compact repo orientation, golden path, commands, structure, and decision matrix                                                         | Exhaustive subsystem detail, troubleshooting, implementation notes, or historical plans            | Every AFDS repo has one root agent entry point                                                                 |
| Navigation map             | `MAP.md`                                             | Mandatory baseline                        | Canonical path and index answers                                                                                                        | Policy rationale, workflow state, or duplicate explanations                                        | Every AFDS repo has one root navigation index                                                                  |
| Product requirements       | `docs/product-requirements/`                         | Conditional                               | Product intent, target users, goals, outcomes, broad functional and non-functional requirements, assumptions, risks, and open questions | Exact behavior specs, architecture, roadmap sequencing, live issue status, or implementation plans | Product intent is not clear enough to write acceptance-ready specs or slice implementation issues              |
| Behavior spec              | `docs/specs/`                                        | Mandatory baseline area                   | Exact intended behavior, requirements, boundaries, acceptance criteria, verification expectations, and agent context                    | Product discovery, implementation architecture, live issue status, or one-off execution plans      | Product/domain behavior needs durable acceptance-ready ownership                                               |
| Contract registry/artifact | `contracts/`                                         | Conditional                               | Machine-readable or registry-style contract authority when the contract is artifact-owned or externally deployed                        | Duplicates of source-owned schemas, runtime-boundary diagrams, or prose-only requirements          | A contract artifact owns the external/deployed interface, or a registry is needed to locate contract authority |
| Architecture doc           | `docs/arch/`                                         | Mandatory baseline area                   | Current system shape, module boundaries, data/control flow, invariants, and dependency direction                                        | Product requirements, decision history, or live planning                                           | System structure needs durable explanation                                                                     |
| ADR                        | `docs/adr/`                                          | Recommended baseline when decisions exist | Durable decision, rationale, consequences, and considered alternatives                                                                  | Temporary notes, brainstorming with no decision, or duplicated specs                               | An architectural, boundary, technology, or major tradeoff decision is made                                     |
| Roadmap item               | `docs/roadmap/`                                      | Conditional                               | Durable target output, scope, non-goals, outcome-level sequencing, and validation targets                                               | Live issue status, sub-issue inventories, PR lists, assignees, or schedules                        | Product direction is larger than one PR and needs durable framing                                              |
| Tech-debt item             | `docs/tech-debt/`                                    | Conditional                               | Durable structural debt record, impact, cleanup trigger, and status when issue labels are insufficient                                  | Routine task tracking or transient cleanup notes                                                   | Debt must survive beyond a single issue and cannot be tracked clearly by issue label alone                     |
| Guideline/workflow         | `CONTRIBUTING.md`, `docs/guidelines/`, `WORKFLOW.md` | Mandatory baseline area                   | Repeatable procedure, contributor policy, decision flow, and repo norms                                                                 | Product requirements, product behavior specs, live work state, or implementation logs              | A procedure or policy should be reused across issues                                                           |
| Harness boundary           | `docs/harness/`                                      | Conditional                               | Durable assumptions for external harnesses, fixtures, adapters, and validation environments                                             | General architecture or live test-run output                                                       | External harness behavior becomes a stable integration constraint                                              |
| Knowledge/reference        | `docs/knowledge/`, `docs/references/`                | Conditional                               | Stable external-system facts, reference notes, and domain knowledge that support repo work                                              | Ephemeral research dumps or copied source material without durable ownership                       | External facts are reused often enough to merit curation                                                       |
| Module breadcrumb          | Module-local `README.md`                             | Conditional                               | Local purpose, public entry points, invariants, and verification hints for a major module                                               | Root navigation, global architecture, or details obvious from nearby code                          | A module's purpose or verification is not obvious from names and code structure                                |

### 2.1 Baseline vs conditional profiles

Mandatory baseline profiles are expected in every AFDS repo: `AGENTS.md`,
`MAP.md`, `CONTRIBUTING.md`, `WORKFLOW.md`, `docs/specs/`, `docs/arch/`, and
`docs/guidelines/`.

`CONTRIBUTING.md` is the root contributor-policy instance of the
guideline/workflow profile. Keep commit, PR, and branch policy canonical there;
companion files in `docs/guidelines/` may elaborate but should link back instead
of becoming competing policy owners.

`docs/adr/` is a recommended baseline once durable decisions exist.

Conditional profiles are created only when their trigger is real. Do not create
empty `contracts/`, `docs/product-requirements/`, `docs/harness/`,
`docs/knowledge/`, `docs/references/`, `docs/roadmap/`, or `docs/tech-debt/`
directories just to satisfy the taxonomy.

### 2.2 Product requirements precede specs when intent is unclear

Product requirements documents capture product intent before behavior is stable
enough for a behavior spec or issue slicing. They should answer why the product
area matters, who it serves, what outcomes it should enable, what broad
requirements and constraints exist, what is out of scope, and what assumptions,
risks, or open questions remain.

Product requirements are maintained while discovery changes product intent.
When enough product uncertainty is resolved, derive the next owning artifact:
behavior spec, guideline, roadmap update, ADR, or implementation issues.

Do not use product requirements as live product backlogs, roadmap schedules,
architecture docs, behavior specs, or implementation plans.

### 2.3 Behavior specs are not every doc

Strict behavior-spec structure applies to exact product or domain behavior only.
A behavior spec should capture exact intended behavior, boundaries, acceptance
criteria, verification, and agent context.

Do not rewrite every file under `docs/specs/` or every AFDS document into one
feature-spec template. Existing behavior specs should be aligned with their
approved profile when they are substantially changed; otherwise, garden them
opportunistically.

### 2.4 Contract authority

Contract authority follows the ownership or deployment boundary, not the
runtime boundary.

Use source code as the contract when the source artifact owns and enforces the
interface. In DevCanon today, config schemas, skill validation, agent
validation, manifest handling, and domain types are source-owned contracts.

Use `contracts/` only when one of these is true:

- an external or generated artifact is the deployed contract;
- consumers need a stable contract artifact outside the source module;
- a registry is useful to answer where contract authority lives.

Generated contract artifacts are acceptable when they are clearly derived from
the source owner or explicitly own the external contract. Avoid maintaining a
second hand-written contract that can drift from the artifact that actually
owns enforcement.

### 2.5 Roadmaps are target-output frames

Roadmap docs describe durable target output and outcome-level sequencing. They
are not issue trackers.

Roadmap docs may link to product requirements, owning behavior specs,
architecture docs, guidelines, ADRs, and live planning containers. They must not
contain live issue status, sub-issue inventories, PR lists, assignees, schedules,
agent run state, or single-PR implementation plans.

---

## 3) Repository layout

### Required

- `AGENTS.md` -- canonical agent entry point
- `MAP.md` -- canonical navigation index
- `CONTRIBUTING.md` -- commit, PR, and branch policies
- `WORKFLOW.md` -- contributor procedural guide
- `docs/specs/` -- behavior specifications
- `docs/arch/` -- system architecture
- `docs/guidelines/` -- engineering rules and norms

### Recommended

- `docs/adr/` -- architecture decision records, once durable decisions exist

### Conditional

- `contracts/` -- artifact-owned contracts or contract-authority registry
- `docs/product-requirements/` -- durable product requirements before specs or
  issue slicing
- `docs/roadmap/` -- durable forward-looking direction docs
- `docs/tech-debt/` -- durable structural debt records
- `docs/harness/` -- durable external harness assumptions
- `docs/knowledge/` or `docs/references/` -- curated external-system facts
- module-local `README.md` -- breadcrumbs for non-obvious major modules

### Not used in current DevCanon

- `contracts/` -- current contract authority is source-owned; see ADR-0004
- `docs/ipc/` -- single CLI tool, no cross-service communication
- `docs/harness/` -- no external harness
- `docs/knowledge/` and `docs/references/` -- no curated external reference set
- `docs/plans/` -- ephemeral; not part of steady-state documentation

---

## 4) Boundary rules: where information belongs

- "What is this project at a glance?" -> `README.md`
- "What is this repo and how do I start?" -> `AGENTS.md`
- "Where do I find X?" -> `MAP.md`
- "What problem should the product solve, for whom, and with what outcomes?" ->
  `docs/product-requirements/`
- "What exact behavior should the product have?" -> `docs/specs/`
- "What is the system shape?" -> `docs/arch/`
- "Why did we choose this design?" -> `docs/adr/`
- "What are the team/repo rules?" -> `CONTRIBUTING.md` and
  `docs/guidelines/`
- "How do I contribute?" -> `CONTRIBUTING.md`
- "What is the contributor workflow?" -> `WORKFLOW.md`
- "Where is durable roadmap direction?" -> `docs/roadmap/`
- "What structural debt is known?" -> `docs/tech-debt/`
- "What is the interface contract?" -> source-owned schemas/types or
  `contracts/`, depending on the ownership/deployment boundary
- "What external harness assumptions exist?" -> `docs/harness/`
- "What stable external facts does this repo rely on?" -> `docs/knowledge/` or
  `docs/references/`
- "What does this non-obvious module own?" -> module-local `README.md`

For issue/behavior-spec relationships and work-origin routing, use
[project-management-model.md](project-management-model.md).

---

## 5) Governance to prevent doc rot

### 5.1 No duplicate sources of truth

If something is authoritative, it must live in exactly one place:

- agent entry point -> `AGENTS.md`
- navigation index -> `MAP.md`
- product requirements -> `docs/product-requirements/`
- behavior specs -> `docs/specs/`
- source-owned interfaces -> Zod schemas and TypeScript types in source
- artifact-owned contracts -> `contracts/`
- architecture decisions -> `docs/adr/`
- system architecture -> `docs/arch/`
- roadmap direction -> `docs/roadmap/`
- contributor policy -> `CONTRIBUTING.md`
- reusable procedures and policies -> `docs/guidelines/` or `WORKFLOW.md`

### 5.2 Same-PR update rules

A PR must update docs when it changes:

- interfaces or schemas
- major file paths or directory layout
- module boundaries
- externally visible behavior
- run/test/debug procedures
- CLI commands
- contract ownership or deployed contract artifacts
- durable product requirements, roadmap direction, workflow policy, or
  structural debt status

### 5.3 Profile alignment

When creating or substantially changing a durable doc:

1. Identify the document profile.
2. Confirm the file lives in that profile's owning location.
3. Check whether `MAP.md` needs a navigation answer.
4. Avoid duplicating another profile's authority.
5. Prefer stable requirement IDs, scenario IDs, headings, or named anchors over
   line-number references.

### 5.4 Review checklists

Use [documentation-checklists.md](documentation-checklists.md) for the quick
review checklist and gardening checklist.

### 5.5 Mechanical validation

Repositories should add automated checks where practical:

- markdown linting (`pnpm run lint:markdown`)
- markdown formatting (`pnpm run format:markdown:check`)
- pre-commit hooks enforce formatting and linting on staged files

### 5.6 Ongoing gardening

After adoption, documentation should be maintained through continuous small
maintenance in normal feature and refactor PRs:

- keep `AGENTS.md` small and navigational
- update `MAP.md` whenever files or directories move
- add or update ADRs when durable decisions are made
- update `docs/roadmap/` when durable product direction changes
- update `docs/tech-debt/` when durable structural debt is discovered or
  resolved and issue labels are insufficient
- remove or merge stale docs that no longer have clear ownership
- keep examples, contracts, and tests aligned in the same PR

No big-bang migration is required. Existing docs should be gardened as they are
touched for real work.

---

## 6) Writing rules

1. Prefer navigability over completeness at the root.
2. Prefer links over duplication.
3. Prefer stable responsibility boundaries over ad hoc folder growth.
4. Prefer narrow docs with clear ownership.
5. Prefer durable decisions over transient chatter.
6. Prefer documentation that helps verification, not just explanation.
7. Prefer profile-specific structure over one mandatory template.

---

## 7) File naming conventions

### Root-level canonical docs

Use uppercase for repo-wide entrypoint files: `AGENTS.md`, `MAP.md`,
`CONTRIBUTING.md`, `WORKFLOW.md`.

### General naming rule

For docs under `docs/`:

- use lowercase `kebab-case`
- use `.md` for prose docs
- keep names short but specific
- prefer stable semantic names over process/history names

### ADR numbering

Use `adr-NNNN-short-title.md` with zero-padded sequence numbers.

### Avoid

- `final.md`, `new-plan.md`, `notes-v2.md`, `misc.md`, `temp.md`
- dates in filenames for enduring docs (use dates only for archives, incident
  reports, or time-bound artifacts)
- version markers (`v2`, `v3`, `final`) in filenames for active docs

---

## 8) Reference docs

- ADR template: [adr-template.md in docs/adr/](../adr/adr-template.md)
- Documentation checklists: [documentation-checklists.md](documentation-checklists.md)
- Project management model: [project-management-model.md](project-management-model.md)
