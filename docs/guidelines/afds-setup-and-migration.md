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
- [AFDS workflow capability governance](afds-workflow-capability-governance.md)
  owns reusable capability classification when repeated workflow needs may
  require existing-asset updates, new skills, new agents, source/runtime
  support, deferrals, or rejections.
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
4. Because Git does not track empty directories, represent baseline areas with
   tracked owner files such as `docs/specs/overview.md`,
   `docs/arch/overview.md`, or `docs/guidelines/README.md`. Keep starter files
   lightweight when detailed content is not ready: they should point to the
   owner and next expected artifact, while the profile rules remain in
   [documentation-standard.md](documentation-standard.md).
5. Add `docs/adr/` when durable architecture, boundary, technology, or major
   tradeoff decisions exist.
6. Decide whether product requirements or roadmap direction are needed before
   behavior specs or issue slicing.
7. Choose an external issue tracker.
8. Decide contract authority before creating `contracts/`.
9. Add DevCanon source skills under `skills/` and agent roles under `agents/`
   only when the project uses DevCanon to sync reusable capabilities.
10. Run the project's normal formatting, linting, and documentation checks after
    introducing new paths.

DevCanon does not automatically manage consumer repositories. Projects remain
responsible for their own durable docs, tracker configuration, and repository
checks.

## Existing Project Migration

1. Audit durable docs, root instructions, local agent files, issue-tracker
   practices, generated outputs, and repeated manual procedures.
2. Identify source-of-truth conflicts across repo docs, issues, PR comments,
   and agent-local files.
3. Resolve source-of-truth conflicts before moving or promoting content: update
   the owning artifact, remove or narrow non-owner copies, redirect readers to
   the owner, or stop with an ownership blocker when the owner is unclear.
4. Introduce or tighten `AGENTS.md` and `MAP.md` before broad content movement.
5. Before preserving an existing document as durable truth, check it against
   current source, tests, source-owned contracts, and linked tracker evidence.
   If it is stale, update the owner or mark the owner update needed instead of
   treating the old document as authoritative.
6. Classify existing durable docs by AFDS profile using
   [documentation-standard.md](documentation-standard.md).
7. Avoid strict-template rewrites for all old specs; garden existing docs when
   they are touched or when ownership is wrong.
8. Move, narrow, or redirect documents only when ownership or discoverability is
   broken.
9. Route repeated procedures before extraction: keep project-local policy in
   `WORKFLOW.md` or `docs/guidelines/`, create a source skill only for portable
   reusable method, create an agent role only when stable delegate identity or
   target-supported constraints justify it, and use
   [AFDS workflow capability governance](afds-workflow-capability-governance.md)
   when reusable capability ownership is unclear.
10. Sync DevCanon managed outputs only after source ownership is clear.

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

Before creating `contracts/`, identify the owning contract surface using
[documentation-standard.md](documentation-standard.md) and
[ADR-0004: Code-as-Contract by Default](../adr/adr-0004-code-as-contract.md).
Record whether the current authority is source-owned or artifact-owned in the
owning doc or navigation pointer, then create `contracts/` only when those
owners call for an artifact-owned contract or registry.

For DevCanon itself, ADR-0004 remains the owner for the current code-owned
contract decision. This guide only adds the migration action: find and preserve
that owner before adding or moving contract artifacts.

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

DevCanon is a user-wide source library and CLI tooling, not a repository-level
document manager for consumer projects.

Source skills live under `skills/`; source agent roles live under `agents/`.
When the project uses DevCanon, run `devcanon validate` and `devcanon render`
after source changes. Run `devcanon sync` only from a trusted source library
after reviewing changed `skills/`, `agents/`, and rendered output, because sync
writes managed outputs into user-wide target homes.

Generated preview output and installed managed output are disposable and should
not be edited as authoritative source. Generated preview output under
`generated/` stays ignored and untracked; regenerate it locally when inspection
is useful, but keep commits on source, renderer, tests, and tracked packaged
support files such as `skills/devcanon-runtime/scripts/runtime/`. Before
deciding whether generated output should be ignored, regenerated, reviewed, or
committed, use the
[target mapping generated output rules](../specs/target-mapping.md#generated-output-rules)
as the owner.

## Checklists

New project checklist:

- [ ] `AGENTS.md` gives humans and agents the compact entry point.
- [ ] `MAP.md` answers canonical navigation questions.
- [ ] Baseline docs and areas are represented by tracked owner files:
      `CONTRIBUTING.md`, `WORKFLOW.md`, `docs/specs/`, `docs/arch/`, and
      `docs/guidelines/`.
- [ ] Starter owner files stay lightweight when detailed content is not ready,
      and empty directories are not treated as durable owners.
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
- [ ] Conflicts are resolved by updating the owner, narrowing non-owner copies,
      redirecting readers, or stopping with an ownership blocker.
- [ ] `AGENTS.md` and `MAP.md` exist or are tightened before broad content
      movement.
- [ ] Existing docs are checked against current source, tests, source-owned
      contracts, and linked tracker evidence before being preserved as durable
      truth.
- [ ] Existing durable docs are classified by AFDS profile.
- [ ] Legacy docs are gardened incrementally when touched or when ownership is
      wrong.
- [ ] Repeated procedures are routed to local workflow docs, portable source
      skills, agent roles, or AFDS workflow capability governance blockers
      before extraction.
- [ ] DevCanon managed outputs are synced only after source ownership is clear.
