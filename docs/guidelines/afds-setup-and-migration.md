# AFDS Setup and Migration

This guide helps new and existing projects adopt the Agent-Friendly
Documentation Standard (AFDS) incrementally. It is a runbook over the owning
AFDS policy docs, not a replacement for them.

Use this guide when a project needs to introduce AFDS entry points,
navigation, durable docs, issue-tracker boundaries, contract authority, and
DevCanon skill or agent sync without forcing a large rewrite.

## Scope

This guide covers both new project setup and existing project migration.
Durable docs should stay provider-neutral unless a section intentionally
compares supported external issue trackers. In this guide, external issue
tracker means GitHub Issues or Linear.

This guide does not introduce automatic consumer-repo management, big-bang
migration, mandatory template rewrites for legacy docs, new CLI behavior,
validation rules, or generated-output format changes. It also does not define
new baseline profiles, define new conditional profiles, make conditional
profiles mandatory, or use durable examples that name specific consumer
projects.

## Owning References

- [Documentation standard](documentation-standard.md) owns AFDS document
  profiles, the mandatory baseline, conditional profiles, and contract
  authority.
- [Project management model](project-management-model.md) owns the boundaries
  among repo docs, issues, PRs, and agent-local systems of record.
- [AI-assisted product workflow guideline](ai-assisted-product-workflow-guideline.md)
  owns the shaping path, issue implementation path, same-PR documentation
  impact, and PR workflow.
- [Portable AFDS user procedure map](portable-afds-user-procedure-map.md) owns
  lifecycle procedure routing.
- [Writing skills](writing-skills.md) owns source skill authoring.
- [Agent authoring guide](agent-authoring-guide.md) owns when stable agent roles
  are justified.
- [Install and sync behavior spec](../specs/install-and-sync.md) owns DevCanon
  install and sync behavior.

## Adoption Principles

- Start with `AGENTS.md` and `MAP.md` so humans and agents have an entry point
  and navigation answer before deeper restructuring.
- Keep one source of truth per concern, and link to that owner instead of
  copying policy or contract text into secondary docs.
- Use existing docs as evidence, then align them opportunistically with their
  AFDS profile when they are touched.
- Do not create empty conditional directories just to satisfy the taxonomy.
- Keep durable repo docs separate from live tracker state, PR review state, and
  agent-local execution artifacts.
- Treat generated preview output and installed managed output as derived from
  source; source skill and agent files remain authoritative.

## New Project Setup

1. Create `AGENTS.md` as the compact agent entry point.
2. Create `MAP.md` as the canonical navigation index.
3. Establish baseline AFDS areas: `CONTRIBUTING.md`, `WORKFLOW.md`,
   `docs/specs/`, `docs/arch/`, and `docs/guidelines/`.
4. Add `docs/adr/` when durable architecture, boundary, technology, or major
   tradeoff decisions exist.
5. Decide whether product requirements or roadmap direction are needed before
   behavior specs or issue slicing.
6. Choose an external issue tracker.
7. Decide contract authority before creating `contracts/`.
8. Add DevCanon source skills under `skills/` and agent roles under `agents/`
   only when the project uses DevCanon to sync reusable capabilities.
9. Run the project's normal formatting, linting, and documentation checks after
   introducing new paths.

DevCanon does not automatically manage consumer repositories. Projects remain
responsible for their own durable docs, tracker configuration, and repository
checks.

## Existing Project Migration

1. Audit durable docs, root instructions, local agent files, issue-tracker
   practices, generated outputs, and repeated manual procedures.
2. Identify source-of-truth conflicts across repo docs, issues, PR comments,
   and agent-local files.
3. Introduce or tighten `AGENTS.md` and `MAP.md` before broad content movement.
4. Classify existing durable docs by AFDS profile using
   [documentation-standard.md](documentation-standard.md).
5. Avoid strict-template rewrites for all old specs; garden existing docs when
   they are touched or when ownership is wrong.
6. Move, narrow, or redirect documents only when ownership or discoverability is
   broken.
7. Extract repeated procedures into skills only when the procedure is reused
   across issues or projects.
8. Create or promote agent roles only when stable delegate identity or
   target-supported constraints justify them.
9. Sync DevCanon managed outputs only after source ownership is clear.

## Choosing GitHub Issues Or Linear

Live status, assignment, blockers, prioritization, scheduling, triage, and work
state belong in the external issue tracker.

Choose GitHub Issues when the team wants repo-native issue links, labels,
projects, and close coupling with GitHub pull requests.

Choose Linear when the team already uses Linear for triage, cycles, cross-repo
planning, project health, or roadmap views.

Durable repo docs should not depend on either provider; link to tracker work
only when a live planning container or evidence pointer is useful.

## Identifying Contract Authority

Contract authority follows the ownership or deployment boundary, not the
runtime boundary. This matches
[ADR-0004: Code-as-Contract by Default](../adr/adr-0004-code-as-contract.md).

Use source-owned contracts when schemas, types, validation code, or source
modules own and enforce the interface. Tests can verify that contract behavior,
but they do not become the contract authority. Use artifact-owned contracts
when an external, generated, deployed, or registry artifact owns or indexes the
interface.

Do not create `contracts/` merely because two modules communicate at runtime.
For DevCanon itself, current contract authority is code-owned through Zod
schemas, TypeScript types, validation code, manifest handling, and source
modules.

## Conditional Profiles

Conditional paths most relevant to setup and migration include:

- `contracts/`
- `docs/roadmap/`
- `docs/harness/`
- `docs/tech-debt/`
- `docs/knowledge/`

These paths are trigger-based and should not be created empty. The full AFDS
taxonomy includes other conditional profiles, such as
`docs/product-requirements/`, `docs/references/`, and module-local `README.md`;
see [documentation-standard.md](documentation-standard.md) for the owning
profile definitions and triggers.

## DevCanon Skill And Agent Sync

DevCanon is user-wide source library and CLI tooling, not a repository-level
document manager for consumer projects.

Source skills live under `skills/`; source agent roles live under `agents/`.
When the project uses DevCanon, run `devcanon validate` and `devcanon render`
after source changes. Run `devcanon sync` only from a trusted source library
after reviewing changed `skills/`, `agents/`, and rendered output, because sync
writes managed outputs into user-wide target homes.

Generated preview output and installed managed output are disposable and should
not be edited as authoritative source.

## Checklists

New project checklist:

- [ ] `AGENTS.md` gives humans and agents the compact entry point.
- [ ] `MAP.md` answers canonical navigation questions.
- [ ] Baseline docs and areas exist where needed: `CONTRIBUTING.md`,
      `WORKFLOW.md`, `docs/specs/`, `docs/arch/`, and `docs/guidelines/`.
- [ ] The project has chosen an external issue tracker.
- [ ] Contract authority is identified before any `contracts/` path is added.
- [ ] Conditional-profile paths are created only when their triggers exist.
- [ ] DevCanon source skills or agent roles are validated, rendered, and synced
      only when the project uses DevCanon.

Existing project checklist:

- [ ] Durable docs, root instructions, local agent files, issue-tracker
      practices, generated outputs, and repeated manual procedures are audited.
- [ ] Source-of-truth conflicts across repo docs, issues, PR comments, and
      agent-local files are identified.
- [ ] `AGENTS.md` and `MAP.md` exist or are tightened before broad content
      movement.
- [ ] Existing durable docs are classified by AFDS profile.
- [ ] Legacy docs are gardened incrementally when touched or when ownership is
      wrong.
- [ ] Repeated procedures are extracted into skills only when reuse justifies
      them.
- [ ] DevCanon managed outputs are synced only after source ownership is clear.
