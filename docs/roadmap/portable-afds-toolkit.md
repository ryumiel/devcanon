# Portable AFDS Toolkit

**Status:** Direction set\
**Live planning:** [GitHub issue #217](https://github.com/ryumiel/devcanon/issues/217)\
**Established by:** [GitHub issue #218](https://github.com/ryumiel/devcanon/issues/218)

## Summary

DevCanon's durable product direction is to provide portable skills, thin agent
roles, and supporting guidance for development projects that follow AFDS.

It helps teams run an AFDS-based product workflow across Claude Code and Codex,
and provides migration/setup guidance for existing or new projects adopting
that methodology.

DevCanon remains a user-wide CLI and source library. Consumer-project adoption
is guided by reusable skills, generated target-native agent files, and
documentation patterns; it is not automatic repository rewriting or
repository-level document management.

## Target Output

The Portable AFDS Toolkit should make it practical to adopt a consistent
AI-assisted development workflow across projects that use either GitHub Issues
or Linear.

The target output includes:

- portable AFDS skills for shaping, issue priming, planning, review, and
  documentation impact workflows
- thin agent roles that provide stable delegate identities and target-supported
  controls
- guidance for specs, roadmaps, workflows, issue slicing, PRs, review, and
  documentation impact
- migration/setup guidance for projects adopting AFDS from an existing state
- Claude Code and Codex outputs generated from the same source library

## Scope

- Preserve the user-wide DevCanon CLI and source-library model.
- Support both GitHub Issues-backed and Linear-backed AFDS projects.
- Keep skills as the primary reusable workflow unit.
- Keep agents as thin wrappers for stable roles and target-specific controls.
- Provide durable guidance that helps consumer projects adopt AFDS deliberately.

## Non-Goals

- DevCanon does not become a repository-level document manager.
- DevCanon does not automatically rewrite or manage consumer repositories.
- DevCanon does not force every old document into one mandatory template.
- DevCanon does not duplicate live issue or PR tracking in repository docs.
- DevCanon does not make generated outputs authoritative source files.

## Related Docs

- [Product overview](../specs/overview.md)
- [Core concepts and design principles](../specs/core-concepts.md)
- [Documentation standard](../guidelines/documentation-standard.md)
- [Project management model](../guidelines/project-management-model.md)
- [Agent authoring guide](../guidelines/agent-authoring-guide.md)
- [Writing skills in this repo](../guidelines/writing-skills.md)

## Outcome-Level Sequencing

1. State the product direction and roadmap ownership model.
2. Reconcile AFDS taxonomy and workflow guidance into durable docs.
3. Define migration/setup guidance for GitHub Issues-backed and Linear-backed
   AFDS projects.
4. Align validation policy and review workflows with the reconciled guidance.
5. Implement or refine portable skills and thin agent roles that encode the
   adopted workflows.
6. Prove the toolkit against one GitHub Issues-backed AFDS project and one
   Linear-backed AFDS project.

## Validation Targets

- A new project can understand DevCanon's AFDS direction from `README.md`,
  `AGENTS.md`, `MAP.md`, and this roadmap item.
- A contributor can tell where durable roadmap direction belongs and where live
  issue tracking belongs.
- A GitHub Issues-backed AFDS project can adopt the guidance without
  repository-specific hard-coding.
- A Linear-backed AFDS project can adopt the guidance without repository-
  specific hard-coding.
- Generated Claude Code and Codex outputs continue to come from the same source
  skills and agent role definitions.
