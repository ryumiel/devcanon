# Roadmap

Roadmap docs describe durable, forward-looking product direction for outcomes
that are larger than a single pull request.

Use this directory when a target state, sequencing model, adoption direction,
or first usable slice needs to survive beyond the current issue or agent
session. Keep roadmap docs focused on outcomes, appetite, sequencing,
validation signals, and ownership boundaries, not live execution state.

Roadmaps translate product intent into an outcome-level path. They are not
product requirements documents: product requirements own the problem, users,
goals, broad requirements, assumptions, risks, and open questions; roadmaps own
how that intent is sequenced into durable target outputs and validated over
time.

## What Roadmap Docs Own

- target outcomes and why they matter
- scope and non-goals for roadmap-scale work
- appetite or first-slice framing for work larger than one pull request
- durable sequencing at the outcome level
- validation targets that show the outcome is real
- links to product requirements, owning behavior specs, architecture docs,
  guidelines, ADRs, and live planning containers

## What Roadmap Docs Must Not Contain

- live issue status
- sub-issue inventories
- pull request lists
- assignees or scheduling state
- agent run state
- single-PR implementation plans
- capability inventories that duplicate source files, generated outputs, or
  navigation maps
- validation summary stores, postmortem archives, execution ledgers, or other
  history that belongs in trackers, PRs, CI/check systems, source tests, Git
  history, or linked evidence

GitHub Issues or Linear own live work tracking. Pull requests own review and
merge state. Agent sessions own temporary execution plans.

## Practice Notes

- Start from current product and workflow constraints, but avoid duplicating a
  live inventory of files, skills, commands, issues, or PRs.
- Prefer outcome-level sequencing such as "first usable slice", "pilot",
  "parity milestone", or "validation target" over task-by-task plans.
- Keep the roadmap adaptable: when implementation or validation changes durable
  product intent, update the owning product requirements or behavior artifact;
  when sequencing changes, update the roadmap.
- Route live progress, blockers, assignees, dates, and work-item decomposition
  to the external issue tracker.

## Active Roadmap Items

- [Portable AFDS Toolkit](portable-afds-toolkit.md)
