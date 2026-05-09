# Product Requirements

Product requirements documents define product intent before behavior is stable
enough for a behavior spec or issue slicing.

Use this directory when work needs durable ownership for:

- the problem being solved;
- target users or maintainers;
- product goals and outcomes;
- broad functional and non-functional requirements;
- assumptions, risks, dependencies, and open questions;
- readiness criteria for the product requirements document;
- expected follow-up artifact types.

Product requirements are not implementation plans, task boards, roadmaps,
architecture docs, or behavior specs. They should avoid live issue state,
assignees, PR state, branch names, schedules, and agent-local execution detail.

## Lifecycle

1. Create or update a product requirements document when product intent is not
   clear enough to write an acceptance-ready behavior spec or slice
   implementation issues.
2. Keep the document current while discovery changes product goals,
   requirements, risks, or open questions.
3. Derive behavior specs, guidelines, roadmap updates, ADRs, or implementation
   issues only after the product requirement is stable enough for that next
   artifact.
4. Update the product requirements document when later implementation or
   validation changes product intent.

## Readiness Checklist

A product requirements document is stable enough to derive another artifact
when:

- key terms are defined or linked to their owning definitions;
- users and priority users are named;
- goals, outcomes, requirements, and non-goals are explicit;
- assumptions, risks, dependencies, and open questions are triaged;
- product validation criteria are identified;
- the immediate next owning artifact is named, or the document explicitly says
  which unresolved product decision blocks derivation.

## Relationship to Other Artifacts

- `docs/specs/` owns exact intended behavior, acceptance-ready requirements,
  scenarios, and verification expectations.
- `docs/roadmap/` owns durable direction and outcome-level sequencing.
- `docs/guidelines/` owns repeatable procedure and policy.
- `docs/arch/` owns system shape and module boundaries.
- External issue trackers own live work state.
- Pull requests own review and merge state.
- Agent-local artifacts own temporary execution detail.
