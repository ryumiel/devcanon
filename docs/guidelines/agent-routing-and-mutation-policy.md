# Agent Routing and Mutation Policy

This guideline is the current inventory and procedure owner for shared semantic
agent routing and mutation authority. The stable decision and rationale live in
[ADR-0027](../adr/adr-0027-semantic-agent-routing-and-mutation-authority.md).
Agent and AFDS workflow specs own observable role, render, routing, and guard
behavior. Source skills retain task-local prompts, phase mechanics, fallbacks,
and termination.

This is a target contract, not a claim that every source-agent, skill, runtime,
test, or generated-output migration has already landed. Deployment remains
blocked until the ADR's complete acceptance gate passes.

## Semantic Role Catalog

| Agent           | Capability | Claude effort | Codex effort | Mutation default   | Primary use                                           |
| --------------- | ---------- | ------------- | ------------ | ------------------ | ----------------------------------------------------- |
| `assessor`      | balanced   | medium        | medium       | `source-immutable` | Bounded classification or evaluation                  |
| `investigator`  | balanced   | high          | high         | `source-immutable` | Repository, document, or external evidence collection |
| `executor`      | efficient  | medium        | medium       | `source-mutable`   | Exact validated no-policy operations                  |
| `implementer`   | balanced   | high          | high         | `source-mutable`   | Judgment-bearing scoped implementation                |
| `reviewer`      | frontier   | high          | high         | `source-immutable` | Ordinary synthesis and adversarial review             |
| `deep-reviewer` | frontier   | xhigh         | xhigh        | `source-immutable` | Existing high-assurance review gates                  |

All role names are provider- and effort-neutral. Capability resolves through
`devcanon.config.yaml`; Claude and Codex effort stay explicit and independent.

| Agent           | Claude tools                                 | Codex sandbox   | Default network |
| --------------- | -------------------------------------------- | --------------- | --------------- |
| `assessor`      | Read, Grep, Bash, Write                      | workspace-write | None            |
| `investigator`  | Read, Grep, Bash, Write, WebFetch, WebSearch | workspace-write | Dispatch-owned  |
| `executor`      | Read, Grep, Bash, Edit, Write                | workspace-write | None            |
| `implementer`   | Read, Grep, Bash, Edit, Write                | workspace-write | Task-owned      |
| `reviewer`      | Read, Grep, Bash, Write                      | workspace-write | None            |
| `deep-reviewer` | Read, Grep, Bash, Write                      | workspace-write | None            |

Every role may run its permitted commands and write at most one
dispatch-named direct-child `.ephemeral` handoff. Tools, sandbox, network,
capability, and effort do not imply source or external mutation authority.
Every role defaults to no external authority.

## Closed Classifications

### Cognitive demand and stance

| Demand       | Meaning                                                                 | Default route                                              |
| ------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| `mechanical` | Closed algorithm over validated facts; no semantic or policy choice     | Deterministic helper, guarded inline path, or `executor`   |
| `bounded`    | One scope and closed acceptance condition                               | `assessor`, `investigator`, or `implementer`               |
| `synthesis`  | Multiple authorities, ambiguity, trade-offs, or cross-module conclusion | `reviewer` or an owning controller                         |
| `inherited`  | Wrapper or generic workflow whose active phase owns classification      | Resolve before dispatch; never use ambient model or effort |

Stance is exactly `normal` or `adversarial` and is independent of demand.
`deep-reviewer` is not an ambient escalation target. It is selected only for
the critic, per-task high-assurance reviews, and final whole-implementation
review named in the direct-child inventory.

This policy adds no capability or effort escalation rules. The separately
tracked escalation owner, issue #528, remains authoritative for that work. Until
that owner establishes a durable policy, direct routes use the exact pairs
below and unresolved routing blocks rather than escalating by guesswork.

### Mutation axes

Source authority is exactly one of:

- `source-immutable`: inspect and run permitted commands; write only one
  dispatch-named direct-child `.ephemeral` handoff; do not change durable
  source, tests, configuration, or documentation.
- `source-mutable`: alter only dispatch-authorized durable workspace paths.

External authority is exactly one of:

- `none`: perform no external-system mutation.
- `external-mutable`: perform only a separately named and authorized mutation
  in GitHub, Linear, Notion, or another external system.

The two axes are recorded separately. A source-mutable route may still have
external authority `none`; a source-immutable workflow may hold a separately
named external mutation. Never infer one axis from the other.

## Complete Skill Inventory

This table contains every current source skill exactly once. Phase
qualifications belong in the final column; the source and external columns use
only the closed values above.

| Skill                              | Demand / stance         | Source authority | External authority | Material override / owner note                                              |
| ---------------------------------- | ----------------------- | ---------------- | ------------------ | --------------------------------------------------------------------------- |
| `branch-review`                    | inherited / adversarial | source-mutable   | none               | Mutable only in explicit fix mode                                           |
| `devcanon-runtime`                 | mechanical / normal     | source-mutable   | none               | Caller-bounded deterministic local mechanics                                |
| `doc-gardening`                    | synthesis / adversarial | source-mutable   | none               | Audit immutable; selected fixes mutable                                     |
| `git-workspace-cleanup`            | mechanical / normal     | source-mutable   | none               | Destructive local Git only after approval                                   |
| `github-issue-priming`             | inherited / normal      | source-mutable   | external-mutable   | Worktree setup plus required auto-workflow handoff; downstream owns effects |
| `issue-batch-routing`              | synthesis / normal      | source-immutable | external-mutable   | Routing/messages/archival only; implementation and merge delegated          |
| `issue-priming-workflow`           | synthesis / normal      | source-mutable   | external-mutable   | Auto flow may implement and create a gated PR; never merges                 |
| `issue-slicing`                    | synthesis / normal      | source-immutable | none               | Draft only; live issue mutation excluded                                    |
| `issue-worktree-setup`             | mechanical / normal     | source-mutable   | none               | Local worktree/ref mutation                                                 |
| `linear-issue-priming`             | inherited / normal      | source-mutable   | external-mutable   | Worktree setup plus required auto-workflow handoff; Linear status excluded  |
| `play-agent-dispatch`              | inherited / normal      | source-mutable   | none               | Each child independently classified; current integration may edit source    |
| `play-brainstorm`                  | synthesis / normal      | source-immutable | none               | Named `.ephemeral` design only                                              |
| `play-branch-finish`               | synthesis / normal      | source-mutable   | external-mutable   | Chosen local or gated push/PR action                                        |
| `play-debug`                       | bounded / normal        | source-mutable   | none               | Investigation immutable; verified fix mutable                               |
| `play-planning`                    | synthesis / normal      | source-immutable | none               | Named `.ephemeral` plan only                                                |
| `play-review-response`             | synthesis / adversarial | source-mutable   | external-mutable   | Fix/commit and gated provider closeout phases                               |
| `play-review`                      | synthesis / adversarial | source-immutable | none               | Named review artifacts only; never fixes/posts                              |
| `play-skill-authoring`             | synthesis / adversarial | source-mutable   | none               | Authoring edits source; pressure children immutable                         |
| `play-subagent-execution`          | inherited / normal      | source-mutable   | none               | Task edits/commits; reviews immutable                                       |
| `play-tdd`                         | inherited / normal      | source-mutable   | none               | Task-owned test and implementation edits                                    |
| `play-validate-review-artifacts`   | mechanical / normal     | source-immutable | none               | Schema/path validation only                                                 |
| `play-verification`                | bounded / adversarial   | source-immutable | none               | Runs commands and reports evidence                                          |
| `pr-authoring`                     | synthesis / normal      | source-immutable | none               | Returns title/body; wrapper owns GitHub effects                             |
| `pr-merge`                         | inherited / normal      | source-mutable   | external-mutable   | CI fix may commit; root owns PR edit/push/merge                             |
| `pr-review`                        | inherited / adversarial | source-mutable   | external-mutable   | Local review worktree plus approved GitHub effects                          |
| `report-devcanon-issue`            | synthesis / normal      | source-immutable | external-mutable   | Explicit confirmation authorizes issue creation/linking                     |
| `spec-readiness-review`            | synthesis / adversarial | source-immutable | none               | Read-only findings/status                                                   |
| `subagent-lifecycle`               | bounded / normal        | source-immutable | none               | Controller-local session hygiene                                            |
| `write-linear-project-description` | synthesis / normal      | source-immutable | external-mutable   | Apply mode updates selected Linear fields                                   |
| `write-linear-project-update`      | synthesis / normal      | source-immutable | external-mutable   | Apply creates/updates the selected project update                           |
| `write-product-requirements`       | synthesis / normal      | source-mutable   | none               | Scoped product-requirements edits                                           |
| `write-product-spec`               | synthesis / normal      | source-mutable   | none               | Scoped behavior-spec edits                                                  |
| `write-prose`                      | bounded / normal        | source-mutable   | none               | File mode is scoped; external writes forbidden                              |

## Direct-Child Route Inventory

The row IDs and source anchors are inventory keys, not a marker or annotation
language. Each source-immutable row is response-only unless it explicitly
declares a handoff. It uses the minimum source-immutable guard around the
existing response contract.

| ID  | Surface and owner                                                                       | Route                                                                                                                                | Existing output / termination                                                             |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| D1  | Issue gate — `issue-priming-workflow` Phase 2                                           | `assessor`, balanced/medium, source-immutable                                                                                        | Gate enum; terminal Phase 2 route                                                         |
| D2  | Internal research — issue priming Phase 3                                               | `investigator`, balanced/high, source-immutable                                                                                      | Existing report headings; root synthesizes                                                |
| D3  | External research — issue priming Phase 3                                               | `investigator`, balanced/high, source-immutable, named network                                                                       | Existing necessity/URL/headings; root synthesizes                                         |
| D4  | Focused specialist — `play-agent-dispatch`                                              | Independently classified semantic role and exact pair                                                                                | Response-only in #530; unresolved route blocks                                            |
| D5  | Plan review — `play-planning`                                                           | `reviewer`, frontier/high, source-immutable                                                                                          | Existing PASS/FAIL; revise or advance                                                     |
| D6  | Executability review — `play-planning`                                                  | `reviewer`, frontier/high, source-immutable                                                                                          | Distinct PASS/FAIL; restart or advance                                                    |
| D7  | Code-quality topical — `play-review` Phase 3                                            | `reviewer`, frontier/high, source-immutable                                                                                          | Existing findings; controller aggregates                                                  |
| D8  | Architecture topical — `play-review` Phase 3                                            | `reviewer`, frontier/high, source-immutable                                                                                          | Existing triggered findings; controller aggregates                                        |
| D9  | Spec topical — `play-review` Phase 3                                                    | `reviewer`, frontier/high, source-immutable                                                                                          | Existing triggered findings; controller aggregates                                        |
| D10 | Critic — `play-review` Phase 5                                                          | `deep-reviewer`, frontier/xhigh, source-immutable                                                                                    | Existing finding verdicts; no recursion                                                   |
| D11 | Skill pressure scenario — `play-skill-authoring`                                        | `assessor`, balanced/medium, source-immutable                                                                                        | Existing scenario evidence; invalid evidence retested                                     |
| D12 | Default implementation — `play-subagent-execution`                                      | `implementer`, balanced/high, source-mutable                                                                                         | Existing status/snapshot; scoped commit                                                   |
| D13 | Exact task — `play-subagent-execution`                                                  | Inline or `executor`, efficient/medium, source-mutable                                                                               | Five guardrails; stop/reclassify on judgment                                              |
| D14 | Per-task spec review — execution review routing                                         | `deep-reviewer`, frontier/xhigh, source-immutable                                                                                    | Existing distinct prompt/same-head fix loop                                               |
| D15 | Per-task quality review — execution review routing                                      | `deep-reviewer`, frontier/xhigh, source-immutable                                                                                    | Existing distinct prompt/provisional same-head loop                                       |
| D16 | Final whole-implementation quality review — execution Process step 10/final-review gate | `deep-reviewer`, frontier/xhigh, source-immutable                                                                                    | Whole-range prompt; narrow ADR-0016 skip; final fix/fresh-review or terminal-owner route  |
| D17 | CI diagnosis/fix — `pr-merge` Step 4                                                    | Diagnosis: `investigator` balanced/high immutable; exact fix: `executor` efficient/medium; judgment fix: `implementer` balanced/high | Guard diagnosis before fix classification; mutable child commits only; root pushes/merges |

Task-specific prompts, schemas, skip criteria, retries, fallbacks, and
termination remain owned by the source skill. A route may not collapse two
distinct sessions just because they share a semantic agent.

### Ordinary child failure disposition

After safe cleanup, existing unavailable or invalid-child behavior remains in
force. The four surfaces that need a minimum explicit disposition use this
table:

| Routes                                  | Ordinary unavailable, failed, malformed, or verification-rejected child after safe cleanup                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Generic focused specialist (D4)         | Let already-started siblings settle and clean up, integrate no results, and return the failed domain plus successful summaries to the controller |
| Per-task reviews (D14-D15)              | Keep the task incomplete and return the existing execution `BLOCKED` state with the failed review named; no verdict passes                       |
| Final whole-implementation review (D16) | Keep final review incomplete and return `BLOCKED` to the owning caller or direct/manual terminal-status path; do not enter branch finish         |
| CI diagnosis (D17)                      | Keep retry count unchanged, perform no fix/push/merge, and report the failed check plus manual-resolution recommendation                         |

Other routes retain their current gate/revision, partial research, missing
topical, unverified critic, or fresh-scenario behavior. Only detected source
mutation or cleanup failure is a guard-integrity terminal condition. An owning
workflow may still return its ordinary recoverable failure or `BLOCKED` state.

## Minimum Source-Immutability Procedure

Seven workflow owners use identical thin shims to the packaged runtime:
`issue-priming-workflow`, `play-agent-dispatch`, `play-planning`, `play-review`,
`play-skill-authoring`, `play-subagent-execution`, and `pr-merge`. Bounded root
role smokes invoke the same runtime directly and do not add an eighth shim.

```text
source-immutability capture [--handoff .ephemeral/<direct-child>]
source-immutability verify --baseline .ephemeral/<generated> [--handoff <same-path>]
source-immutability cleanup --baseline .ephemeral/<generated> [--handoff <same-path>]
```

The owner must:

1. validate the route and zero or one optional direct-child handoff;
2. capture before spawn;
3. spawn only after successful capture;
4. verify before semantic validation or consumption;
5. validate a response or read and validate the exact handoff into memory;
6. clean up the exact baseline and handoff on every terminal branch;
7. consume or apply only the retained validated result.

The baseline covers canonical worktree identity, `HEAD`, symbolic ref, raw
index entries, and file kind, mode, and content for tracked and non-ignored
untracked paths. It preserves pre-existing staged, unstaged, binary, and
untracked dirt. Verification prints only `unchanged`. Cleanup prints only
`cleaned`, unlinks only the two exact owned leaves, treats absence as clean,
unlinks symlinks without following them, and fails on directories or other file
kinds.

Capture failure prevents dispatch. Spawn, child, verification, and payload
failures reject the result but still require exact cleanup. Cleanup failure is a
manual blocker. Detected source mutation remains visible; no owner may reset,
checkout, stage, repair, or recursively delete it.

### Canonical guard and handoff example

Given a private baseline `B` is newly created and the optional named
direct-child handoff `H` was absent at capture, the child may leave Git-visible
content unchanged and create a valid `H`. The controller verifies unchanged
state, validates and retains `H` in memory, removes exactly `B` and `H`, then
applies the retained result.

Reject the example when exactly one of these dimensions changes: tracked or
non-ignored untracked content changes; `H` is nested, pre-existing, symlinked,
missing, empty, unreadable, or outside `.ephemeral`; or `B` or `H` is a
directory. These are guard failures, not payload-level findings.

The guard intentionally excludes ignored-file changes other than the named
handoff, outside-worktree paths, external systems, malicious provider-internal
telemetry, races, arbitrary future prose discovery, and comprehensive
role-aware filesystem enforcement. It is a content-sensitive Git-visible
comparison plus one optional named handoff, not a security boundary.

## Route Examples

### Canonical rendered role

`assessor` renders with capability `balanced`, effort `medium` on both targets,
its command and handoff tool envelope, source-immutable instructions, and no
external authority. Reject representative variants that omit Codex effort,
render a role count other than six, or grant source/external authority beyond
the catalog.

### Canonical final review route

D16 is a response-only `deep-reviewer` session at `frontier`/`xhigh`. It reviews
the whole implementation range under source-immutable instructions, applies
only the narrow ADR-0016 skip, and ends in a final fix/fresh-review loop or the
owning blocked terminal transition. Reject variants that collapse D16 into
D15, use `high` or ambient effort, or treat unavailable review passes as a
passing verdict.

### Canonical pair smoke

The Codex efficient/medium pair uses the exact model `gpt-5.6-luna`, effort
`medium`, no tool event, and sole final text
`DEVCANON_SMOKE_OK gpt-5.6-luna medium`. Reject variants that use an alias,
change effort or token text, emit a tool event, or omit native selection
evidence.

Positive examples must match the target contract. Unless explicitly identified
as a multi-fault case, each invalid example changes one named contract
dimension. Derived fields must remain consistent with source facts. Missing or
unverifiable source facts block rather than invite guessed routing.

## Runtime Acceptance and Deployment Gate

After local tests and both-target render parsing pass, run exactly one native
attempt for each pair on each target:

| Capability / effort | Claude                      | Codex           |
| ------------------- | --------------------------- | --------------- |
| efficient / medium  | `claude-haiku-4-5-20251001` | `gpt-5.6-luna`  |
| balanced / medium   | `claude-sonnet-5`           | `gpt-5.6-terra` |
| balanced / high     | `claude-sonnet-5`           | `gpt-5.6-terra` |
| frontier / high     | `claude-opus-4-8`           | `gpt-5.6-sol`   |
| frontier / xhigh    | `claude-opus-4-8`           | `gpt-5.6-sol`   |

Each attempt receives the exact full model and effort, a no-tool prompt, and no
alias, fallback, substitution, or retry. Success requires no tool event and the
sole extracted final text
`DEVCANON_SMOKE_OK <full-model> <effort>`. Missing client support, flags,
authentication, entitlement, named-agent selection, model or effort
availability, or parseable exact output is a blocker, not permission to
substitute.

Codex additionally runs one named-role case for each of the six roles. The only
permitted command is `git rev-parse --verify HEAD`; the child writes one named
direct-child handoff containing
`DEVCANON_ROLE_SMOKE_OK <role> <head>`. The root guards the source, exact-compares
the line into memory, cleans the baseline and handoff, and only then records
success.

Write the report to
`.ephemeral/2026-07-14-530-agent-routing-smoke.md`. It contains date, revision,
client versions, ten pair rows, six role rows, and one aggregate sentence. It
contains no raw logs, secrets, absolute paths, per-row timestamps or digests,
resumable state, or retention protocol. It is prose evidence, not a versioned
schema.

All sixteen rows and the final repository gate must pass before ADR-0027 can be
Accepted. A human operator blocks affected-target deployment while any row is
blocked. Render, sync, and install behavior do not enforce that deployment
decision.

## Explicit Deferrals

The following are follow-up categories, not part of this policy's implementation:

1. benchmark corpora, fixtures, oracle scoring, comparative thresholds, or
   large model-run matrices;
2. resumable evidence stores, databases, redaction pipelines, or retention and
   deletion protocols;
3. a direct-dispatch marker or annotation language;
4. comprehensive ignored-file or workspace-integrity monitoring and role-aware
   filesystem enforcement;
5. a general cross-provider evaluation framework.

## See Also

- [Agent source schema](../specs/agents.md)
- [AFDS workflow routing and evidence behavior](../specs/afds-workflow-routing.md)
- [Agent authoring guide](agent-authoring-guide.md)
- [Code review guideline](code-review-guideline.md)
- [ADR-0013: Path-Based Phase-Artifact Handoff](../adr/adr-0013-path-based-phase-artifact-handoff.md)
- [ADR-0016: Single-Task Auto Final-Review Carve-Out](../adr/adr-0016-single-task-auto-final-review-carve-out.md)
- [ADR-0024: Shared Support Skill Runtime](../adr/adr-0024-shared-support-skill-runtime.md)
- [ADR-0026: Replace Model Tiers with Capability Profiles](../adr/adr-0026-capability-profiles.md)
