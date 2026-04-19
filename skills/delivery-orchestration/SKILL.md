---
name: delivery-orchestration
description: "Use when coordinating multi-phase work with explicit scope, acceptance criteria, and quality gates - especially behavior-preserving refactors or changes requiring plan review before execution."
argument-hint: "Describe the phase, deliverable, constraints, and required quality gates."
user-invocable: true
---

# Delivery Orchestration

Use this skill when work should be run as a controlled delivery phase rather than as ad hoc implementation.

Use the Technical Orchestrator agent when you want a separate coordinator to own delegation and approvals. Use this skill directly when you want the same workflow, templates, and review structure inside the current agent.

## Reference Inputs

Build the phase from the documents closest to the change surface:

- Root instructions or contribution rules such as `AGENTS.md`, `CONTRIBUTING.md`, or workspace instructions
- Architecture or design docs for the affected subsystem
- Specs, contracts, ADRs, API docs, or proposal docs that define behavior or boundaries
- Existing verification commands already used by the repository or subsystem

## When To Use

- Multi-phase work with explicit scope and acceptance criteria
- Refactors that must preserve current behavior while changing internals
- Changes that require plan review before execution
- Work that benefits from architect, critic, domain, or language-specific review passes
- Branch, verify, fix, and merge workflows where quality gates matter

## When Not To Use

- Small one-off fixes where a normal coding flow is enough: typically one-file changes with no boundary change, no dependency change, and no explicit gate requirements
- Pure research or codebase exploration with no implementation plan yet
- Tasks where the user explicitly wants direct implementation without orchestration

## Operating Principles

- Treat planning, verification, and review as first-class deliverables.
- Keep each phase narrow enough to review in one pass.
- Preserve existing behavior unless the phase explicitly changes it.
- Prefer explicit acceptance criteria over implied success.
- Fix blocking issues before commit or merge.
- Prefer specialized delegates, but fall back to a general coding agent rather than stalling.

## Phase Modes

- Full implementation phase: plan, review, execute, verify, review, fix, and release.
- Plan-only phase: stop after plan review and approval.
- Validation-only phase: verify or review an existing implementation without adding new code.
- Spike phase: produce findings and a decision recommendation instead of a production change.

## Lightweight Path

Use a lighter path when the change is small, bounded, and does not alter architecture, public contracts, or dependency boundaries.

Use the normal direct coding flow instead when the change is a tiny one-off fix that does not need explicit gates at all.

- Keep the plan compact, but still include goal, scope, acceptance criteria, verification commands, and risks.
- Use one approval gate before substantial execution.
- Skip architect review unless boundaries, contracts, or dependencies change.
- Keep verification and at least one review pass; lightweight does not mean unreviewed.
- Require language-specific review for each materially affected language.
- Add critic review only when the lightweight phase has behavioral, contract, or boundary risk.
- Add domain review when product rules or external behavior may change.

## Review Matrix

- Architect review: required for architecture changes, boundary changes, new dependencies, transport changes, or contract changes.
- Critic review: required for non-trivial implementation phases that do not qualify for the lightweight path, and recommended by default when risk is unclear.
- Domain review: required when behavior, product rules, or external contracts may change.
- Documentation review: required when public workflows, commands, contracts, or operator expectations change.
- Language-specific review: required for each materially affected language in a non-trivial code phase. Split the phase if that review surface becomes too broad.

## Procedure

1. Define the phase contract.
   Capture the goal, in-scope changes, out-of-scope changes, acceptance criteria, constraints, reference docs, and compatibility requirements.

2. Prepare the plan.
   Include files to change, dependencies to add or avoid, test strategy, documentation updates, build or verification commands, and proposal or design references.

3. Review the plan before execution.
   Apply the review matrix first, then use the plan-review prompts in [review-prompts.md](./references/review-prompts.md). Run plan-stage reviews for every role the matrix requires, not only architect and critic. Resolve blocking feedback before proceeding.

4. Get approval.
   Show the final plan and wait for explicit approval before substantial execution.

5. Choose the execution path.
   Prefer a specialized implementation agent. If none exists, delegate to a general coding agent with a strict contract that includes scope, non-goals, acceptance criteria, verification commands, and expected output. Use direct implementation only if the governing agent policy explicitly allows it.

6. Execute within scope.
   Keep the implementation focused on the approved phase. Do not add speculative refactors or future-proofing unless the plan explicitly includes them.

7. Verify before review.
   Run all applicable quality gates. Include behavior-preservation checks for existing paths, not just new code paths.

8. Review the implementation.
   Run the implementation-review passes required by the review matrix using the templates in [review-prompts.md](./references/review-prompts.md).

9. Fix blocking findings and re-verify.
   Address all P0, P1, and P2 issues. Re-run the relevant checks after each fix set.

10. Release the phase deliberately.
    Commit only when the user asks. Keep one commit per approved phase when that constraint exists. Merge only after verification and review are clean.

## Escalation Rules

- If a required specialized agent is unavailable, fall back to a general coding agent and state that fallback explicitly.
- If a required review specialization is unavailable, perform the same review explicitly and state the missing specialization.
- If a verification gate cannot run, record it as omitted with the reason, residual risk, and next action.
- If the user chooses to proceed with known risk, record the override explicitly before continuing.
- If external blockers stop the phase, stop at the narrowest blocked state and return a concrete unblock decision.

## Phase Checklist

Use the planning template in [phase-template.md](./references/phase-template.md) for each new phase.

Minimum plan contents:

- Goal and non-goals
- Files or modules affected
- Dependency changes with justification
- Tests to add or update
- Documentation to add or update
- Verification commands
- Risks, assumptions, and compatibility constraints
- Execution path and fallback plan
- Required approvals

Use the lightweight path only when the change clearly stays within existing boundaries.

## Review Priorities

- P0: correctness, safety, data loss, unrecoverable failure, broken compatibility
- P1: likely functional regression, contract mismatch, missing boundary handling
- P2: missing tests, weak documentation, maintainability issues that affect confidence
- P3: polish and nits

## Outputs

During orchestration, keep outputs compact and decision-oriented:

- Phase summary
- State
- Plan or delegation contract
- Delegation summary
- Blocking findings
- Gates executed
- Gates omitted with reason
- Decision or next action
