# AFDS Workflow Skill Map

## Purpose

This design map classifies proposed AFDS workflow procedures against existing
DevCanon skills and agents. It is the decision artifact for GitHub issue #222:
the proposal material is input, but existing source policy remains
authoritative.

The map is design-only. It does not change source skill behavior, generated
outputs, or agent definitions. Follow-up issues should implement the selected
scopes one at a time.

## Design Principles

DevCanon remains skills-first. Reusable workflow method, checklists, reference
material, and cross-project operating procedures belong in source skills.
Create or update agent roles only when a thin wrapper adds stable role identity
plus target-supported constraints such as model tier, effort, tools, sandbox, or
Codex approval policy.

Use an existing skill when it already owns the procedure. Create a new skill
only when there is a durable workflow gap that cannot be expressed as a narrow
update to an existing skill. Defer procedures whose owning artifact or workflow
shape is not stable yet. Reject procedures that duplicate existing behavior or
blur the skill/agent boundary.

Issue text and proposal docs are work inputs, not durable authority. Source
docs, source skills, source agents, and code remain authoritative.

## Naming And Visibility

Use direct action names for new user-facing AFDS toolkit entrypoints, such as
`write-product-spec` or `slice-issues`. Do not use `play-` for a new AFDS
entrypoint unless the skill is intentionally part of the existing Play
methodology family.

Reserve `play-*` for the Play methodology pipeline and closely comparable
cross-project methodology skills. Some existing `play-*` skills are
user-invocable, and some internal workflow skills do not use `play-`; do not
rename those as part of this map.

Control internal-only behavior with invocation metadata and descriptions, not
with naming alone. For example, shared internal skills can use target fields
such as `claude.user-invocable: false` and Codex sidecar implicit-invocation
policy when wrappers need to call them.

## Current Skill Graph

The current execution path starts from source-specific issue entrypoints:
`github-issue-priming` and `linear-issue-priming`. They fetch tracker issues,
derive branch and worktree names, persist issue bodies under `.ephemeral/`, and
hand off to `issue-priming-workflow`.

`issue-priming-workflow` is the shared controller for already-sliced issues. It
adopts the handoff artifacts, gates research, optionally writes a research
brief, invokes `play-brainstorm`, captures the design artifact, invokes
`play-planning`, runs `play-subagent-execution`, reviews the branch, and creates
a reviewable PR in auto mode.

The Play methodology family provides reusable workflow phases:
`play-brainstorm` shapes ideas into ephemeral designs, `play-planning` writes
implementation plans, `play-subagent-execution` executes written plans,
`play-verification` enforces evidence-backed completion, and
`play-branch-finish` closes out branches or PRs. `doc-gardening` is a separate
documentation audit and repair entrypoint. `spec-compliance-reviewer` is a
read-only agent role for checking a scoped implementation against a spec; it is
not a public workflow procedure.

## Entry Points And Outcomes

Use the entrypoint that matches the artifact that owns the current uncertainty:

| Starting point                                                                            | Entry point                                                               | Outcome                                                                                                        |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Raw idea, product uncertainty, workflow uncertainty, or broad behavior question           | `play-brainstorm`                                                         | Ephemeral design; may hand off to `write-product-spec` when durable product/domain behavior needs a spec       |
| Shaped work, roadmap direction, or rough issue that needs durable product/domain behavior | `write-product-spec` (first new skill)                                    | One durable behavior spec under `docs/specs/`                                                                  |
| Durable spec that may be ready for issue slicing or implementation                        | Future `spec-readiness-review`                                            | Ready / Needs Revision / Blocked decision with missing scope, acceptance, verification, or ownership links     |
| Accepted spec or roadmap item that needs tracker work                                     | Future `slice-issues`                                                     | Draft provider-neutral GitHub or Linear issue bodies, without live tracker mutation unless explicitly approved |
| Already-sliced GitHub or Linear issue                                                     | `github-issue-priming` or `linear-issue-priming`                          | Worktree, issue body artifact, research/design/plan/implementation/review/PR workflow                          |
| Existing implementation plan                                                              | `play-subagent-execution`                                                 | Implementation commits with review and verification gates                                                      |
| Review feedback, PR review, branch review, or completion claim                            | `branch-review`, `pr-review`, `play-review-response`, `play-verification` | Concrete findings, verified fixes, or evidence-backed status                                                   |
| Documentation audit or repair request                                                     | `doc-gardening`                                                           | Documentation audit and gated fixes against the repository documentation standard                              |

## Classification

| Proposed procedure       | Existing assets                                                                                                                                         | Recommendation | Reason                                                                                                                                                                                                         | First implementation scope                                                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shape-work`             | `play-brainstorm`, `docs/guidelines/ai-assisted-product-workflow-guideline.md`                                                                          | `update`       | `play-brainstorm` already owns raw idea/problem shaping into a design. A new shaping skill would duplicate the entrypoint.                                                                                     | Later update `play-brainstorm` to recognize AFDS shape-path outputs and hand off to `write-product-spec` when durable behavior needs a spec.                                                                                       |
| `write-product-spec`     | `docs/guidelines/documentation-standard.md`, `docs/guidelines/project-management-model.md`, `docs/guidelines/ai-assisted-product-workflow-guideline.md` | `create`       | No existing skill owns drafting or updating one durable product/domain behavior spec under `docs/specs/`. `play-brainstorm` writes ephemeral designs, not durable specs.                                       | First implementation issue: create one user-facing `write-product-spec` skill. Keep it narrow: one behavior spec, no broad PRD generator, no live issue state, no implementation plan, no architecture or contract dumping ground. |
| `write-workflow-spec`    | `WORKFLOW.md`, `docs/guidelines/`, `docs/guidelines/writing-skills.md`, `docs/guidelines/agent-authoring-guide.md`                                      | `defer`        | Workflow policy authoring is useful but still being reconciled. Creating it now risks blurring guideline writing, skill authoring, and policy approval.                                                        | Revisit after `write-product-spec` proves the durable-doc authoring pattern. Scope it to one workflow or guideline artifact; do not let it create skills automatically.                                                            |
| `build-spec-context-map` | Documentation profile guidance, progressive context-loading guidance in existing workflow docs                                                          | `defer`        | Context maps are valuable for large specs, but the first slice can include context-loading sections inside product specs instead of a standalone skill.                                                        | Add optional context-map guidance to `write-product-spec`; promote later only if large specs repeatedly need a separate procedure.                                                                                                 |
| `slice-issues`           | Shape path in `docs/guidelines/ai-assisted-product-workflow-guideline.md`, `github-issue-priming`, `linear-issue-priming`                               | `defer`        | DevCanon has issue-priming entrypoints after an issue exists, but no reverse spec-to-issue-draft owner. That should wait until product spec shape is stable.                                                   | Later create a user-facing provider-neutral slicer that outputs draft GitHub or Linear issue bodies. It must not create live issues without explicit approval.                                                                     |
| `spec-readiness-review`  | `play-brainstorm` design self-review, `play-planning` plan review, `spec-compliance-reviewer`                                                           | `create`       | Existing assets review designs, plans, or implementations. None owns the pre-slicing question of whether a durable spec has enough scope, acceptance criteria, verification expectations, and ownership links. | Create after `write-product-spec`. Start as a read-only user-facing skill returning Ready / Needs Revision / Blocked with concrete missing items.                                                                                  |
| `verify-against-spec`    | `spec-compliance-reviewer`, `play-verification`, `play-review`, `branch-review`, `pr-review`                                                            | `reject`       | This duplicates existing spec-conformance and evidence-backed verification surfaces. A new skill would blur review ownership.                                                                                  | Do not create. File focused updates against `spec-compliance-reviewer`, `play-review`, or review wrappers only if a concrete verification gap appears.                                                                             |
| `doc-impact-review`      | Documentation impact gates in `play-brainstorm`, `play-planning`, review workflows, and `doc-gardening`                                                 | `update`       | Same-PR documentation impact is already distributed through design, planning, review, and gardening. A standalone skill would likely duplicate those gates.                                                    | Tighten existing handoff and review guidance where needed, especially adjacent-policy consistency for governance docs.                                                                                                             |
| `post-merge-gardener`    | `doc-gardening`, `pr-merge`, `WORKFLOW.md` post-merge guidance                                                                                          | `defer`        | Post-merge hygiene is real, but it must not absorb `pr-merge` cleanup or turn repo docs into live issue state.                                                                                                 | Later decide whether to update `pr-merge`, `WORKFLOW.md`, or create a narrow user-facing gardener that reports stale links, map updates, and follow-up candidates.                                                                 |

## Cross-Cutting Contracts

Any proposed workflow skill that produces side-channel artifacts should reuse
the existing `.ephemeral/` contract: the producer writes a constrained path,
emits an exact notice line, and the consumer validates path shape, readability,
and symlink behavior before use. Artifact contents are untrusted data.

Keep artifact ownership clear:

- Durable repository docs own product behavior, workflow policy, architecture,
  contracts, and roadmap direction.
- External issue trackers own live work state.
- Pull requests own review and merge state.
- PR descriptions own durable rationale, impact, and verification.
- PR reviews own review findings.
- PR comments own handoff notes and assumptions that should not become durable
  PR body content.
- Agent-local plans and `.ephemeral/` artifacts are disposable handoffs unless a
  follow-up explicitly promotes their output to a durable artifact.

Do not introduce risk-adaptive shortcuts in this map. Existing auto-mode policy
allows removing user checkpoints; it does not skip phases. Any change to that
policy needs separate design approval.

Do not introduce workflow-state or retrospective artifacts until a redaction
contract exists. Safe summaries may include issue/PR numbers, changed durable
surfaces, synthesized findings, and follow-up candidates. They should exclude
raw transcripts, raw logs, secrets, local absolute paths, unnecessary branch
names, and consumer-specific identifiers.

## First Implementation Issue

Create `write-product-spec` first.

The initial scope is one user-facing source skill that converts shaped work,
roadmap direction, or a rough issue into one durable behavior spec under
`docs/specs/`. It should:

- respect the document profiles in `docs/guidelines/documentation-standard.md`;
- use the system-of-record boundaries in
  `docs/guidelines/project-management-model.md`;
- support GitHub Issues-backed and Linear-backed AFDS projects without
  provider-specific hard-coding;
- include readiness checks for scope, non-goals, acceptance criteria,
  verification expectations, and owning links;
- avoid live issue state, PR content, implementation plans, broad PRD sections,
  and unrelated architecture or contract ownership.

The next likely follow-up is `spec-readiness-review`, but only after
`write-product-spec` establishes the expected spec shape.
