# AFDS Pilot Checklist

This checklist helps apply the Portable AFDS Toolkit to a target repository
before repo-specific pilot issues are created. Use it for DevCanon first, then
for one GitHub Issues-backed AFDS project and one Linear-backed AFDS project.

The checklist is reusable pilot procedure. It does not replace AFDS profile
policy, workflow routing behavior, issue tracking, PR review state, validation
history, or agent-local execution detail.

## Owning References

- [Documentation standard](documentation-standard.md) owns AFDS document
  profiles, baseline docs, conditional profiles, and contract authority.
- [AFDS setup and migration](afds-setup-and-migration.md) owns the general
  adoption runbook for new and existing projects.
- [Project management model](project-management-model.md) owns repo docs,
  issues, PRs, and agent-local systems of record.
- [AI-assisted product workflow guideline](ai-assisted-product-workflow-guideline.md)
  owns shaping, issue implementation, same-PR documentation impact, and PR
  workflow.
- [Portable AFDS user procedure map](portable-afds-user-procedure-map.md) owns
  user-facing procedure routing.
- [Documentation checklists](documentation-checklists.md) owns fast review,
  gardening, and validation checks.
- [AFDS workflow routing spec](../specs/afds-workflow-routing.md) owns exact
  routing and evidence behavior.
- [AFDS mechanical documentation checks spec](../specs/afds-mechanical-documentation-checks.md)
  owns the boundary between deterministic repository-documentation checks and
  judgment-heavy review.
- [AFDS workflow capability governance](afds-workflow-capability-governance.md)
  owns reusable capability classification before new shared workflow assets,
  source/runtime support, deferrals, or rejections are accepted.
- [Writing skills](writing-skills.md) and
  [agent authoring guide](agent-authoring-guide.md) own skill and agent
  authoring thresholds after capability classification identifies the right
  asset type.
- [Portable AFDS Toolkit product requirements](../product-requirements/portable-afds-toolkit.md)
  and [roadmap](../roadmap/portable-afds-toolkit.md) own pilot validation
  targets and product-level success criteria.

## Scope

Use this checklist to decide whether a target repository is ready for an AFDS
pilot and what evidence the pilot must produce.

The checklist covers:

- mandatory AFDS baseline docs;
- conditional document profile decisions;
- GitHub Issues and Linear as external issue tracker options;
- contract authority classification;
- workflow and guideline alignment;
- installed or available AFDS skills and agents;
- deterministic validation expectations;
- judgment-heavy review and audit expectations;
- required pilot evidence;
- follow-up routing after the pilot.

The checklist does not:

- create repo-specific pilot issues;
- name concrete consumer repositories as durable validation targets;
- copy live issue state, PR review state, validation logs, or agent-local plans
  into durable docs;
- add new CLI commands, validation behavior, hooks, CI, schemas, generated
  output formats, or sync behavior.

## Pilot Readiness Checklist

### Baseline AFDS Docs

- [ ] `AGENTS.md` exists and gives humans and agents the compact repository
      entry point.
- [ ] `MAP.md` exists and answers canonical navigation questions.
- [ ] `CONTRIBUTING.md` exists and owns contributor, branch, commit, and PR
      policy or links to the owning policy docs.
- [ ] `WORKFLOW.md` exists and owns contributor workflow.
- [ ] `docs/specs/` exists with tracked owner files for behavior specs.
- [ ] `docs/arch/` exists with tracked owner files for architecture.
- [ ] `docs/guidelines/` exists with tracked owner files for repeatable
      procedures and repository norms.
- [ ] `docs/adr/` exists when durable architecture, boundary, technology, or
      major tradeoff decisions already exist.

### Conditional Profile Decisions

For each conditional profile, record `needed`, `not needed`, or `blocked`, with
an evidence pointer to the owner or blocker.

| Profile                                 | Trigger to check                                                                                           | Pilot decision |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------- |
| `contracts/`                            | Artifact-owned or externally deployed contract authority exists                                            |                |
| `docs/product-requirements/`            | Product intent is not clear enough for behavior specs or issue slicing                                     |                |
| `docs/roadmap/`                         | Durable target output or outcome-level sequencing is needed                                                |                |
| `docs/tech-debt/`                       | Structural debt must survive beyond issue labels                                                           |                |
| `docs/harness/`                         | External harness behavior is a stable integration constraint                                               |                |
| `docs/knowledge/` or `docs/references/` | Stable external facts are reused often enough to curate                                                    |                |
| module-local `README.md`                | A major module's purpose, public entry points, invariants, or verification hints are not obvious from code |                |

Do not create empty conditional directories just to satisfy this checklist.

### External Issue Tracker

- [ ] The project chooses GitHub Issues or Linear as the external issue tracker
      for live work state.
- [ ] Live status, assignment, blockers, prioritization, scheduling, and triage
      stay in the external issue tracker.
- [ ] Durable repo docs use provider-neutral language except when they
      intentionally compare GitHub Issues and Linear.
- [ ] Pilot execution can start from either a GitHub Issues-backed issue or a
      Linear-backed issue using the same AFDS workflow concepts.

### Contract Authority

- [ ] The pilot identifies whether each relevant interface is source-owned,
      artifact-owned, or blocked by unclear ownership.
- [ ] Source-owned contracts stay with schemas, types, validators, or source
      modules that enforce them.
- [ ] `contracts/` is added only when an external or generated artifact owns
      the deployed contract, consumers need a stable contract artifact outside
      source, or a registry is needed to locate contract authority.
- [ ] Any contract authority blocker names the missing owner or evidence.

### Workflow And Guideline Alignment

- [ ] Work-origin routing follows the project management model and Portable
      AFDS user procedure map.
- [ ] Same-PR documentation impact is checked for durable behavior, workflow,
      architecture, contract ownership, verification expectations, and
      navigation changes.
- [ ] Reusable workflow policy stays in guidelines or source skills.
- [ ] Stable agent roles are used only when stable delegate identity or
      target-supported constraints justify them.
- [ ] Repo docs avoid live tracker state, PR review state, validation-history
      stores, postmortem archives, execution ledgers, and agent-local plans.

### Skill And Agent Availability

- [ ] Required AFDS skills are installed, available from the source library, or
      explicitly blocked with an owner.
- [ ] Required agent roles are installed, available from the source library, or
      explicitly blocked with an owner.
- [ ] Capability gaps route through AFDS workflow capability governance before
      any shared skill, agent, source/runtime support, deferral, or rejection is
      accepted.
- [ ] Generated and installed managed outputs are treated as derived from
      source, not authoritative.

### Validation Expectations

- [ ] Deterministic checks are run with the target repository's documented
      commands.
- [ ] Markdown formatting and linting are run when Markdown docs change.
- [ ] Source validation is run when DevCanon source skills, agents, or config
      are present.
- [ ] Repository-documentation checks are run when the target project provides
      them.
- [ ] Judgment-heavy review or audit checks profile fit, ownership, duplicated
      durable truth, workflow routing, and capability gaps.
- [ ] Unavailable or failing validation is recorded as a blocker or follow-up
      evidence pointer, not copied into durable docs as a validation log.

## Pilot Evidence Checklist

Each pilot should produce evidence pointers for:

- [ ] linked pilot issue in GitHub Issues or Linear;
- [ ] docs touched, plus docs explicitly left unchanged with a short reason;
- [ ] validation commands run, including result state;
- [ ] skills and agents found, installed, unavailable, or blocked;
- [ ] review, readiness review, or documentation audit result;
- [ ] follow-up issue list, including owner and tracker target.

Evidence pointers should identify the evidence system, stable reference, checked
requirement or owner, result state, and blocker or follow-up owner when
incomplete.

## Follow-Up Routing

Create repo-specific pilot issues only after this shared checklist exists.

After each pilot:

- route durable product intent changes to product requirements;
- route exact behavior changes to behavior specs;
- route workflow or guideline changes to the owning guideline or source skill;
- route architecture or boundary decisions to ADRs or architecture docs;
- route contract authority changes to the source owner or `contracts/` only
  when the trigger is real;
- route live work, status, blockers, and scheduling to GitHub Issues or Linear;
- route review state to PR comments or reviews;
- route validation evidence to CI, checks, source tests, or linked command
  output;
- route reusable skill or agent gaps through AFDS workflow capability governance
  and use the shared reporting workflow when the gap should be reported
  upstream.
