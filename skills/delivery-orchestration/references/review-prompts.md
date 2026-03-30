# Review Prompts

Use these prompts when coordinating review passes during a delivery phase.

Choose review roles using the review matrix in `SKILL.md` before running these prompts.

## Architect Plan Review

Review this implementation plan as a senior architect. Check architectural alignment against the referenced design documents, verify responsibility boundaries, verify that compatibility constraints are preserved, and flag any blocking or non-blocking concerns. Focus on boundary changes, dependency changes, transport or contract changes, and cases where the plan may violate existing architecture. Be specific about where the plan is weak and how to fix it.

## Critic Plan Review

Review this implementation plan as a skeptical critic. Look for hidden assumptions, edge cases, unverified API expectations, scope creep, missing error handling at boundaries, platform-specific risks, and quality-gate gaps. Focus on what could break even if the plan appears reasonable. Be specific about what is wrong and how to tighten the plan.

## Domain Plan Review

Review this implementation plan for product or domain correctness before execution. Check that the acceptance criteria, behavior changes, external contracts, and compatibility guarantees are covered by the plan and tests. Flag missing scenarios, contract misunderstandings, or user-visible behavior risks before implementation begins.

## Documentation Plan Review

Review this implementation plan for documentation completeness before execution. Check whether the plan names the public workflows, commands, contracts, operator guidance, or design docs that may need updates. Flag documentation gaps early enough that they can shape implementation instead of being retrofitted later.

## Language-Specific Plan Review

Review this implementation plan using the standards for one specific affected language. Run this prompt once per materially affected language. Check that the planned files, tests, error handling, API boundaries, and verification commands are appropriate for that language and that the scope does not hide speculative refactors.

## Architect Implementation Review

Review this implementation as a senior architect. Check that the final change still matches the approved plan, respects the referenced design documents, preserves responsibility boundaries, and does not introduce architectural drift through convenience refactors or hidden dependency changes. Report findings by priority.

## Critic Implementation Review

Review this implementation as a skeptical critic. Look for breakage that the approved plan did not fully protect against: hidden assumptions, edge cases, boundary failures, missing negative-path tests, and quality-gate blind spots. Focus on what can still go wrong even if the implementation appears aligned with the plan. Report findings by priority.

## Domain Implementation Review

Review the implementation for product or domain correctness. Check boundary contracts, behavior preservation, compatibility guarantees, and mismatches between the implementation and the design intent. Verify that acceptance criteria and external contracts are actually covered by the implementation and tests. Report findings by priority.

## Documentation Implementation Review

Review the documentation impact of this change. Check whether new public behavior, commands, contracts, or workflows are documented, whether existing docs need correction, and whether any design or proposal docs should be updated to reflect implementation decisions. Include missing verification docs, operator guidance, or approval-flow updates if they affect how the phase is run. Report findings by priority.

## Language-Specific Implementation Review

Review the implementation using the standards for one specific affected language. Run this prompt once per materially affected language. Check correctness, error handling, type discipline, API boundaries, test coverage, and maintainability. Confirm that the implementation stayed within the approved phase scope and did not add speculative refactors. Report findings by priority.

## Validation-Only Review

Review an existing implementation without assuming new code changes are allowed. Focus on whether the current behavior, tests, documentation, and verification evidence are sufficient for the stated acceptance criteria and risk profile. Report findings by priority, and distinguish between missing evidence, missing tests, and actual implementation defects.
