## Task 1 Assertion Inventory

Selected lifecycle-family assertions migrated from
`src/render/play-subagent-routing.integration.test.ts` to
`src/skill-contracts/play-subagent-routing.test.ts`.

| Old assertion group | Disposition | New owner / notes |
| --- | --- | --- |
| Rendered `subagent-lifecycle` owner contract: controller ledger, target capability classes, cleanup gate, target-honest outcomes, and slot-limit recovery. | Source-contract | Covered directly from `skills/subagent-lifecycle/SKILL.md`; render test no longer initializes or asserts rendered `subagent-lifecycle` body content for this family. |
| ADR-0020 lifecycle ownership split between generic lifecycle policy and workflow-local exceptions. | Source-contract | Covered directly from `docs/adr/adr-0020-subagent-lifecycle-ownership.md` to keep source ownership explicit. |
| `play-subagent-execution` lifecycle delegation to `subagent-lifecycle`, execution-specific captured state, cleanup gate before implementer/reviewer/re-reviewer/final reviewer dispatch, and same-session fix-loop exception. | Source-contract | Covered directly from `skills/play-subagent-execution/SKILL.md` § Subagent Lifecycle. |
| Implementer status lifecycle handling: capture artifacts/status before reviewer dispatch, do not wait for unavailable artifacts on `NEEDS_CONTEXT`/`BLOCKED`, and repeated blocker-family behavior after slot-limit recovery. | Source-contract | Covered directly from `skills/play-subagent-execution/SKILL.md` § Handling Implementer Status. |
| Example workflow lifecycle evidence: ledger pre/post dispatch rows, cleanup checkpoints, target capability variants, target-honest `close-unavailable`, slot-limit recovery, and repeated blocker-family branch. | Source-contract | Covered directly from `skills/play-subagent-execution/references/example-workflow.md`. |
| Example workflow routing evidence: authored task boundaries, executor-computed route examples, reduced-route Phase 6/7 guarantees, route ordering after task work, and no runtime regrouping/batching. | Render-owned | Left in `src/render/play-subagent-routing.integration.test.ts` because it is not part of the migrated lifecycle family for Task 1. |
| Play-subagent routing/checklist/auto-handoff/skip-dispatch/process/red-flag assertions. | Render-owned | Left in `src/render/play-subagent-routing.integration.test.ts`; these are outside the selected lifecycle family. |
| Issue-priming implementation and review handoff assertions, including Phase 6 cleanup-gate ordering before invoking `play-subagent-execution`. | Render-owned | Left in `src/render/play-subagent-routing.integration.test.ts`; the issue-priming handoff surface is explicitly outside Task 1 except for already source-owned lifecycle-family contracts. |
| Planning contract checklist and task-spec assertions. | Render-owned | Left in `src/render/play-subagent-routing.integration.test.ts`; not part of the selected lifecycle family. |
| Prompt/reference trust-boundary, implementer source-read, and invalid-example contracts. | Render-owned / left-for-later | Left unchanged; not part of the selected lifecycle family. |
