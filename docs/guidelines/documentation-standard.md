# Documentation Standard

**Based on:** AFDS v2 (Agent-Friendly Documentation Standard)\
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
   - Product/domain specifications -> `docs/specs/`
   - System architecture -> `docs/arch/`
   - Decisions / rationale -> `docs/adr/`
   - Engineering guidelines -> `docs/guidelines/`
   - Roadmap direction -> `docs/roadmap/` (when needed)
   - Tech debt register -> `docs/tech-debt/` (when needed)
4. **Code-as-contract:** Zod schemas and TypeScript types are the authoritative
   interface definitions. A separate `contracts/` folder is not needed.
5. **Progressive disclosure:** agents start from `AGENTS.md`, then load deeper
   docs only when needed.
6. **Docs close to change:** module-specific knowledge lives near the module
   when possible.
7. **Mechanical anti-rot:** correctness of docs and structure should be
   enforced by scripts, CI, or lint rules where practical.
8. **Durable repo knowledge only:** the repository stores durable knowledge,
   not ephemeral run-state.

---

## 2) Repository layout

### Required

- `AGENTS.md` -- canonical agent entry point
- `MAP.md` -- canonical navigation index
- `CONTRIBUTING.md` -- commit, PR, and branch policies
- `WORKFLOW.md` -- contributor procedural guide
- `docs/specs/` -- product and domain specifications
- `docs/arch/` -- system architecture
- `docs/guidelines/` -- engineering rules and norms

### Should have

- `docs/adr/` -- architecture decision records
- `docs/tech-debt/` -- known debt and cleanup backlog (create when needed)

### Optional

- `README.md` -- GitHub landing page (not canonical for navigation)
- `docs/roadmap/` -- durable forward-looking direction docs (create when
  needed)

### Not used (and why)

- `contracts/` -- code-as-contract via Zod schemas in `src/config/schema.ts`
  and `src/models/types.ts`
- `docs/ipc/` -- single CLI tool, no cross-service communication
- `docs/harness/` -- no external harness
- `docs/plans/` -- ephemeral; not part of steady-state documentation

---

## 3) Document responsibilities

### 3.1 `AGENTS.md` (root, canonical)

**Purpose:** Let an agent or new engineer orient within minutes.

**Must include:**

- one-paragraph repo overview
- golden path / end-to-end flow
- minimum run / test / debug commands
- top-level repo structure
- links to `MAP.md` and key docs
- decision matrix

**Must not include:**

- exhaustive subsystem detail
- long troubleshooting sections
- deep implementation notes
- historical planning logs

**Soft constraint:** scannable in under 2 minutes; roughly 400-900 words;
5-8 top-level sections.

### 3.2 `MAP.md` (root, canonical index)

**Purpose:** Answer "Where do I find X?" reliably.

**Format:** Map common questions to the single best file, folder, or entry
point.

**Rules:**

- If files move, `MAP.md` must be updated in the same PR.
- `MAP.md` is the canonical index.

### 3.3 `docs/specs/` (product/domain specifications)

**Purpose:** Capture durable product and domain behavior, requirements, and
constraints.

**Covers:** core concepts, user stories, configuration format, skill spec,
agent source schema, CLI commands, error handling, platform requirements.

**Rule:** Specs describe intended behavior, not implementation detail.
Implementation architecture lives in `docs/arch/`.

### 3.4 `docs/arch/` (system architecture)

**Purpose:** Explain the current system-level architecture.

**Should cover:**

- major modules and responsibilities
- data and control flow between modules
- design principles and invariants
- dependency direction rules
- target mapping policy
- failure and safety boundaries

**Rule:** System-wide structure belongs here, not in `AGENTS.md` or
`docs/specs/`.

### 3.5 `docs/adr/` (decision records)

**Purpose:** Preserve durable "why" for important choices.

**Use for:**

- architecture decisions
- technology adoption/removal
- boundary changes
- major tradeoffs and rejected alternatives

**Do not use for:**

- temporary task notes
- brainstorming with no decision outcome

**Naming:** `adr-NNNN-short-title.md`

### 3.6 `docs/guidelines/` (rules and norms)

**Purpose:** Hold reusable engineering guidance too detailed for `AGENTS.md`.

**Examples:**

- commit conventions
- PR policy
- code review priorities
- documentation standard (this file)

### 3.7 `docs/roadmap/` (roadmap direction)

**Purpose:** Capture durable forward-looking product direction for outcomes
larger than a single pull request.

**Use for:**

- target outcomes and why they matter
- scope and non-goals for roadmap-scale work
- outcome-level sequencing
- validation targets
- links to owning specs, architecture docs, guidelines, ADRs, and live planning
  containers

**Do not use for:**

- live issue status
- sub-issue inventories
- pull request lists
- assignees or scheduling state
- agent run state
- single-PR implementation plans

**Rule:** Create this directory when durable forward-looking direction docs are
needed. GitHub Issues or Linear remain the system of record for live work.

### 3.8 `docs/tech-debt/` (debt register)

**Purpose:** Track known structural debt that should survive beyond any one
PR.

**Recommended fields:** title, affected module(s), impact, why it exists,
cleanup trigger, status.

**Rule:** Create this directory when the first debt item is identified.

### 3.9 `README.md` (optional landing page)

**Purpose:** Give first-visit readers a short answer to what the project is,
why it exists, and what to open next.

**Must not include:**

- canonical navigation (that's `MAP.md`)
- contributor workflow (that's `WORKFLOW.md`)
- detailed architecture (that's `docs/arch/`)

---

## 4) Boundary rules: where information belongs

- "What is this project at a glance?" -> `README.md`
- "What is this repo and how do I start?" -> `AGENTS.md`
- "Where do I find X?" -> `MAP.md`
- "What should the product do?" -> `docs/specs/`
- "What is the system shape?" -> `docs/arch/`
- "Why did we choose this design?" -> `docs/adr/`
- "What are the team/repo rules?" -> `docs/guidelines/`
- "Where is durable roadmap direction?" -> `docs/roadmap/`
- "What structural debt is known?" -> `docs/tech-debt/`
- "What is the interface contract?" -> Zod schemas in source code
- "How do I contribute?" -> `CONTRIBUTING.md`
- "What is the contributor workflow?" -> `WORKFLOW.md`

---

## 5) Governance to prevent doc rot

### 5.1 No duplicate sources of truth

If something is authoritative, it must live in exactly one place:

- agent entry point -> `AGENTS.md`
- navigation index -> `MAP.md`
- product specs -> `docs/specs/`
- interfaces -> Zod schemas in source
- architecture decisions -> `docs/adr/`
- system architecture -> `docs/arch/`
- roadmap direction -> `docs/roadmap/`

### 5.2 Same-PR update rules

A PR must update docs when it changes:

- interfaces or schemas
- major file paths or directory layout
- module boundaries
- externally visible behavior
- run/test/debug procedures
- CLI commands

### 5.3 Review checklists

Use [documentation-checklists.md](documentation-checklists.md) for the quick
review checklist and gardening checklist.

### 5.4 Mechanical validation

Repositories should add automated checks where practical:

- markdown linting (`pnpm run lint:markdown`)
- markdown formatting (`pnpm run format:markdown:check`)
- pre-commit hooks enforce formatting and linting on staged files

### 5.5 Ongoing gardening

After adoption, documentation should be maintained through continuous small
maintenance in normal feature and refactor PRs:

- keep `AGENTS.md` small and navigational
- update `MAP.md` whenever files or directories move
- add ADRs when durable decisions are made
- update `docs/roadmap/` when durable product direction changes
- update `docs/tech-debt/` when structural debt is discovered or resolved
- remove or merge stale docs that no longer have clear ownership
- keep examples, contracts, and tests aligned in the same PR

---

## 6) Writing rules

1. Prefer navigability over completeness at the root.
2. Prefer links over duplication.
3. Prefer stable responsibility boundaries over ad hoc folder growth.
4. Prefer narrow docs with clear ownership.
5. Prefer durable decisions over transient chatter.
6. Prefer documentation that helps verification, not just explanation.

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
