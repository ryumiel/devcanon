# AFDS Workflow Capability Governance

This guideline owns reusable capability classification for Portable AFDS
workflow needs. Use it when a repeated workflow gap, shared-skill report,
pilot finding, review discovery, or implementation discovery suggests that
DevCanon may need to update an existing asset, create a skill, create an agent,
create a guideline, add source/runtime support, defer, or reject a proposed
capability.

## Owning References

- [Portable AFDS User Procedure Map](portable-afds-user-procedure-map.md) owns
  user journeys, work origins, owners, allowed outputs, blockers, and handoffs.
- [AFDS Workflow Routing and Evidence Behavior](../specs/afds-workflow-routing.md)
  owns deterministic routing, evidence pointers, ordinary execution fast paths,
  drift handling, and follow-up behavior.
- [Writing Skills](writing-skills.md) owns source skill authoring guidance.
- [Agent Authoring Guide](agent-authoring-guide.md) owns when a stable agent
  role is justified instead of a skill.
- [Documentation Checklists](documentation-checklists.md) owns adjacent
  governance review checks.
- [Shared Skill Reporting Workflow](shared-skill-reporting-workflow.md) owns
  how reusable shared-skill or shared-agent needs are reported upstream.

This guideline decides what kind of durable capability action is justified. It
does not replace those owners.

## Scope

Use capability governance for reusable AFDS workflow needs that may outlive one
issue, PR, repository, or agent session.

Typical inputs include:

- repeated blocker evidence from GitHub Issues-backed or Linear-backed work;
- upstream shared-skill or shared-agent reports;
- pilot findings that existing AFDS guidance cannot express;
- review or implementation discoveries that change durable workflow policy;
- source-owner findings that a workflow requires runtime or validation support.

Ordinary issue execution stays on the fast path. If work starts from an
executable issue, review comment, failing test, CI check, audit finding, or
documentation gap and does not change durable product intent, behavior,
workflow policy, architecture, contract ownership, verification expectations,
or reusable capability, do not run capability classification and do not create
a new durable surface.

## Non-Goals

Capability governance does not:

- approve provider-specific live issue or PR automation;
- mutate GitHub Issues, Linear issues, PRs, labels, assignees, statuses, or
  branch protection;
- create source skills, source agents, schemas, generated output, or runtime
  behavior by itself;
- preserve live issue state, PR review state, validation logs, or agent-local
  execution detail in repo docs;
- turn every execution issue into a product requirements document, behavior
  spec, guideline, ADR, skill, or agent;
- override the skill, agent, routing, source, renderer, install, or validation
  owners named in the repository docs.

## Classification Inputs

Before choosing an outcome, identify:

1. The work origin from the
   [Portable AFDS User Procedure Map](portable-afds-user-procedure-map.md).
2. The user who was blocked and the workflow step that failed.
3. The current owner, if any: guideline, source skill, source agent, behavior
   spec, ADR, source module, renderer, installer, runtime helper, or tracker
   integration.
4. The evidence owner: external issue tracker, PR note, source diff, test/CI
   output, audit result, pilot finding, or design artifact.
5. The allowed output the existing owner cannot currently produce.
6. Whether the need repeats beyond one issue or repository.
7. Whether the proposal would change durable workflow policy, reusable method,
   role identity, target configuration defaults or layers, source/runtime
   behavior, or a non-goal.

If the evidence is inaccessible or incomplete, classify the result as a
blocker or deferral instead of inventing a local summary.

## Classification Worksheet

Fill these fields before selecting a decision-table outcome:

- Request:
- Work origin: one exact row from the
  [Portable AFDS User Procedure Map](portable-afds-user-procedure-map.md).
- Blocked user and failed step:
- Current or proposed owner:
- Evidence pointer(s):
- Existing allowed output:
- Requested durable change:

Then apply these gates in order:

1. Fast-path gate:
   If the request is ordinary execution and does not change durable product
   intent, behavior, workflow policy, architecture, contract ownership,
   verification expectations, or reusable capability, stop. Decision:
   `ordinary execution fast path`; route to the owning execution workflow.
2. Boundary gate:
   If the request duplicates an owner, violates a non-goal, belongs only to a
   consumer repo, requests provider-specific live automation as durable AFDS
   behavior, or adds process overhead to ordinary execution, stop. Decision:
   `reject`. If the provider-specific request may be a real integration need
   but lacks an integration owner or provider-neutral contract, continue to the
   evidence and owner gate and defer.
3. Evidence and owner gate:
   If evidence is inaccessible, repetition is unproven, owner approval is
   missing, target support is unavailable, or no current/proposed owner can be
   named, stop. Decision: `defer` with a named blocker and revisit condition.
4. Existing-owner gate:
   If an existing guideline, skill, agent, spec, ADR, source module, renderer,
   installer, runtime helper, or validation surface can express the change
   without taking over another owner's job, stop. Decision:
   `update existing asset`.
5. Method-owner gate:
   If the reusable content is operational method that should travel across
   supported agent targets, stop. Decision: `create skill`.
   If the reusable content is DevCanon-local governance, contributor policy,
   capability classification, documentation ownership, or architecture
   guidance that does not need to render into user-wide skill installations,
   stop. Decision: `create guideline`.
   If the rule is mechanically enforceable, continue to the source/runtime
   gate after the durable owner is clear.
6. Agent gate:
   If a thin role wrapper is justified by the
   [Agent Authoring Guide](agent-authoring-guide.md), stop. Decision:
   `create agent`. Otherwise route the reusable method back to the
   method-owner gate or reject generic orchestration.
7. Source/runtime gate:
   If an accepted durable rule requires executable validation, rendering,
   install, schema, runtime, CLI behavior, or tests that prose cannot enforce,
   stop. Decision: `add source/runtime support`.

If no gate selects an outcome, defer and state the missing evidence, owner, or
decision authority.

## Deterministic Outcome Selection

Normalize these fields before choosing an outcome:

- Work origin: one exact row from the Portable AFDS User Procedure Map.
- Durable truth change: `yes` | `no` | `unknown`.
- Owner: current exact artifact/system | proposed exact artifact/system |
  `unknown`.
- Evidence state: `adequate` | `thin` | `inaccessible` | `incomplete`.
- Repetition: `multiple issues/repos` | `single authoritative accepted owner` |
  `single local/preference/chat` | `unknown`.
- Existing owner fit: `fits` | `would become misleading` | `no owner` |
  `unknown`.
- Capability kind: `method/procedure` | `role wrapper` |
  `source/runtime enforcement` | `provider-live automation` |
  `consumer-local convention`.
- Agent gate: `not applicable` | `tool/sandbox configuration` |
  `target configuration` |
  `reusable specialist` | `fails gate`.
- Source/runtime proof: `not applicable` |
  `accepted owner plus missing executable proof` | `source owner unclear`.
- Non-goal boundary: `none` | `ordinary execution overhead` |
  `consumer-local only` | `provider-specific live state` | `duplicate owner`.

Select exactly one outcome in this order:

1. If durable truth change is `no`, outcome is
   `ordinary execution fast path`; do not create a capability classification
   unless a record is needed for traceability.
2. If evidence is `inaccessible` or `incomplete`, outcome is `defer`; include
   blocker wording.
3. If owner is `unknown`, outcome is `defer`; include owner blocker wording.
4. If non-goal boundary is `ordinary execution overhead`,
   `consumer-local only`, or `duplicate owner`, outcome is `reject`.
5. If non-goal boundary is `provider-specific live state`, outcome is `reject`
   unless the missing item is an integration owner or provider-neutral contract;
   in that case outcome is `defer`.
6. If evidence is `thin`, or repetition is `single local/preference/chat` or
   `unknown`, outcome is `defer`.
7. If existing owner fit is `fits`, outcome is `update existing asset`.
8. If capability kind is `source/runtime enforcement`, outcome is
   `add source/runtime support` only when source/runtime proof is
   `accepted owner plus missing executable proof`; otherwise outcome is
   `defer`.
9. If capability kind is `role wrapper`, outcome is `create agent` only when
   the agent gate passes; otherwise classify the reusable method as a skill or
   guideline, or reject generic orchestration.
10. If capability kind is `method/procedure`, outcome is `create skill` when it
    must travel across agent targets; outcome is `create guideline` when it is
    repository governance or policy guidance.

Treat evidence as `adequate` when it includes either multiple independent
evidence points or one authoritative accepted owner artifact that explicitly
approves the durable rule. Treat a single local preference, one chat thread, or
one agent's repeated uncertainty as `thin`.

An existing owner `fits` only when the change stays within that owner's stated
scope, does not duplicate another owner, does not require behavior the owner
cannot enforce, and does not turn the owner into a catch-all reference.

## Decision Table

| Outcome                    | Use when                                                                                                                                                                                                                                                                                                                   | Allowed output                                                                                                             | Do not use when                                                                                                                            | Evidence to record                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Update existing asset      | An owning guideline, source skill, source agent, spec, ADR, source module, runtime helper, or validation surface already owns the behavior and can express the needed change without becoming misleading.                                                                                                                  | Same-owner update, with adjacent docs updated only when their ownership is directly affected.                              | The current owner would become an omnibus document, duplicate another owner, or need behavior it cannot enforce.                           | Link the issue, PR, review finding, pilot note, source finding, or design artifact that proves the owner and change.      |
| Create guideline           | The reusable need governs DevCanon contributors, repository-local policy, capability classification, documentation ownership, or architecture guidance and does not need to render into user-wide skill installations.                                                                                                     | Guideline under `docs/guidelines/`, with adjacent links updated when their ownership is directly affected.                 | The method must travel to supported agent targets, belongs in an existing owner, or is mechanically enforceable.                           | Show the durable governance gap, why existing guidelines cannot cover it, and why a source skill is not required.         |
| Create skill               | The reusable need is primarily operational method, checklist, workflow procedure, reference material, or repeatable how-to guidance that should travel across supported agent targets.                                                                                                                                     | Source skill under `skills/`, with tests/render updates when required by the skill authoring guidance.                     | The need is one-off execution, project-specific policy, exact product behavior, source/runtime behavior, or only a role wrapper.           | Show the repeated workflow gap, why existing skills/guidelines cannot cover it, and which target users need the method.   |
| Create agent               | The [Agent Authoring Guide](agent-authoring-guide.md) justifies a thin role wrapper through tool or sandbox configuration defaults or layers a skill cannot declare or carry, stable role identity with target configuration defaults or layers, or a reusable specialist delegate, and reusable method remains in skills. | Source agent under `agents/`, plus any required source skill references.                                                   | The proposal mostly contains workflow method, prompt growth, generic orchestration, or a wrapper without an agent-authoring justification. | Cite the role boundary, target-configuration benefit or specialist reuse evidence, and why a skill alone is insufficient. |
| Add source/runtime support | The accepted workflow needs executable validation, rendering, installation, runtime helper behavior, CLI behavior, schema support, or tests that prose cannot enforce.                                                                                                                                                     | Source code, tests, runtime helper, renderer, installer, schema, or validation update owned by the relevant source module. | Prose guidance can express the rule, the behavior is provider-specific automation without approval, or the source owner is unclear.        | Link the accepted policy/spec/ADR/source-owner evidence and the failing or missing executable proof.                      |
| Defer                      | The need may be real, but evidence is too thin, repetition is unproven, owner approval is missing, target support is unavailable, or the change would be premature before another owner lands.                                                                                                                             | Named revisit condition, blocker, or follow-up candidate with evidence pointer.                                            | The current issue has enough authority and evidence to update an existing owner safely.                                                    | State the missing evidence, owner, target support, or repetition threshold and the condition that reopens classification. |
| Reject                     | The proposal duplicates an existing owner, violates a non-goal, belongs to a consumer repo, is provider-specific live automation without an owning path, would add process overhead to ordinary execution, or lacks a durable AFDS need.                                                                                   | Rejection note with the existing owner or non-goal link.                                                                   | The proposal identifies a genuine owner gap that should be deferred instead.                                                               | Link the existing owner, non-goal, fast-path rule, or consumer boundary that explains the rejection.                      |

## Skill-First Rule

Skills are the primary reusable unit for DevCanon workflow method. Choose a
skill when the reusable content is "how to do the work": procedures, checklists,
reference material, workflows, examples, or repeatable operational judgment.

Do not create an agent just because a prompt grew large. Move reusable
operational method into a source skill first; use a guideline only for
DevCanon-local governance or policy. If a role wrapper is still needed
afterward, apply the agent gate below.

## Guideline, Skill, Or Automation Gate

After deciding that reusable method is needed, choose the smallest durable
owner:

- Use a source skill when the method should travel to supported agent targets
  as reusable operational knowledge: workflows, checklists, examples,
  references, or repeatable judgment that apply across repositories.
- Use a guideline when the rule governs DevCanon contributors, repository-local
  policy, capability classification, documentation ownership, or architecture
  governance, and does not need to render into user-wide skill installations.
- Use source/runtime support when the accepted rule is mechanically enforceable
  through schema, validation, rendering, install behavior, CLI behavior, or
  tests.
- Do not put cross-project workflow method only in a guideline when agents or
  users need it at runtime. Do not create a skill for a DevCanon-local
  convention that belongs in `AGENTS.md` or `docs/guidelines/`.

## Agent Gate

Create or update an agent only when the
[Agent Authoring Guide](agent-authoring-guide.md) justifies a thin role wrapper.
Valid justifications include at least one of:

- tool or sandbox configuration defaults or layers that a skill cannot declare
  or carry;
- stable role identity with documented target configuration defaults or layers
  such as model capability, explicit target-native effort, tool access, sandbox
  mode, or Codex approval policy;
- a reusable specialist delegate where the operational method remains in source
  skills.

Capability classification should record which agent-authoring justification
applies and why a skill or guideline alone is insufficient.

Model capability is only one target-configuration field. Classify and justify
target-native effort, tools, sandbox, approval policy, context, authority,
orchestration, retry, and escalation policy independently; none is implied by
`efficient`, `balanced`, or `frontier`. The current configuration and rendering
contract is owned by [ADR-0026](../adr/adr-0026-capability-profiles.md), the
[Configuration spec](../specs/configuration.md), and source schema/renderers.
Codex sandbox and approval values are reusable inherited configuration defaults
or layers, not immutable enforcement; a live parent policy can apply different
settings. Classify authority and enforcement independently from those values.

Reject an agent proposal when it is generic orchestration, duplicated skill
method, prompt-template scaffolding for one call site, or a convenience wrapper
without a qualifying agent-authoring justification.

Do not promote workflow-local prompt templates into agents mechanically.
Reviewer-style or delegate prompt templates should remain templates unless they
meet the
[Agent Authoring Guide](agent-authoring-guide.md#4-promoting-prompt-templates-into-agents)
promotion threshold: stable reusable role identity, documented target
configuration defaults or layers, and reusable operational method that remains
in skills.

## Source And Runtime Support Gate

Add source or runtime support only after the durable behavior owner is clear.
Source/runtime support is justified when prose cannot provide the required
proof or enforcement, such as:

- validation of a source format, schema, or artifact contract;
- render or install behavior that must be deterministic;
- runtime helper behavior consumed by generated skills;
- CLI behavior users invoke directly;
- tests that protect an accepted contract.

When source ownership is unclear, defer with a named owner blocker. Do not use
capability governance to smuggle source changes into a documentation-only
proposal.

Generated previews and installed managed outputs are evidence of rendered
behavior only. They are not durable owners. If generated or installed output
drifts, classify the source owner, renderer, installer, manifest, or validation
surface that must prevent the drift.

Classify runtime claims by the evidence they can support. An actually enforced
read-only workspace policy supports a hard workspace or file non-mutation claim.
Any broader hard claim requires enforced denial for every claimed mutation
surface, including external-action capabilities. A broader-permission trial or
observation is behavioral evidence, not a security proof: it must inspect
relevant repository and modeled external-action state and state residual
unobserved risk. Do not create a runtime harness when no owner exists; defer
with the missing owner instead.

Before classifying provider-specific source/runtime support, map the request to
a provider-neutral concept. Defer when the only available framing is live
GitHub or Linear state and no provider integration owner or provider-neutral
contract exists.

## Evidence And Revisit Rules

Classification evidence should be durable enough for a later human or agent to
reconstruct the decision without private chat history or agent-local memory.

Use stable links to:

- GitHub or Linear issues when they own live work state;
- PRs or review comments when they own review evidence;
- source files, specs, ADRs, guidelines, or roadmap items when they own durable
  truth;
- CI/check output, tests, or audit output when they own validation evidence.

Do not copy live tracker state, PR review history, validation logs, prompts,
transcripts, stack traces, or `.ephemeral/` artifacts into durable docs. Promote
only the durable conclusion into the owning artifact and link to evidence when
needed.

Revisit deferred capability candidates only when at least one condition is met:

- the same procedure gap blocks multiple issues or repositories;
- users cannot identify the authoritative owner with existing guidance;
- evidence pointers repeatedly fail because the current procedure is unclear;
- an existing skill, guideline, or source behavior cannot express the accepted
  workflow without becoming misleading;
- generated-output or installed-output drift exposes a missing source or
  manifest-owned procedure;
- a target adds a configuration option or default that previously blocked the
  proposal.

## Provider-Neutral Examples

### GitHub-backed reusable workflow gap

A GitHub issue reports that multiple PR reviews across different repositories
produce the same blocker: contributors cannot tell whether to update an
existing skill or create a new agent role for a reusable review workflow.

Classification:

- Work origin: reusable workflow policy, procedure, or role boundary.
- Evidence owner: GitHub issue and linked PR review comments.
- Decision: update existing asset if `agent-authoring-guide.md`,
  `writing-skills.md`, or this guideline can cover the missing rule; create a
  source skill only if the accepted reusable method is not already covered;
  create an agent only if the Agent Authoring Guide's role-wrapper
  justification is met.
- Non-goal: do not create GitHub automation, labels, or live issue mutation as
  part of this classification.

### Linear-backed source/runtime gap

A Linear issue from a pilot project shows that contributors repeatedly defer
issue slicing because readiness review cannot validate a packaged evidence
pointer shape that the accepted workflow now requires.

Classification:

- Work origin: implementation discovery plus reusable workflow procedure.
- Evidence owner: Linear issue and linked source or validation evidence.
- Decision: add source/runtime support only after the owning spec or guideline
  defines the evidence pointer contract; otherwise defer with the missing owner
  and revisit condition.
- Non-goal: do not encode Linear-specific status, assignee, cycle, or project
  behavior in provider-neutral source unless a separate provider integration
  owner approves it.

### Ordinary execution mistaken for governance

A GitHub issue asks for a broken link in a guideline to be fixed. The link is
stale, but the owning policy is still correct.

Classification:

- Work origin: concrete documentation gap during issue execution.
- Evidence owner: GitHub issue and source diff.
- Decision: ordinary execution fast path. Update the broken link in the owning
  document.
- Non-goal: do not create a capability classification, PRD, behavior spec,
  skill, or agent when durable workflow policy is unchanged.

### Proposed agent becomes a skill update

A review note proposes a new `issue-router` agent because several workflows
need the same checklist for deciding whether a GitHub or Linear issue should
be sliced, executed, or deferred.

Classification:

- Work origin: reusable workflow method.
- Evidence owner: review note plus linked GitHub and Linear examples.
- Decision: create or update a source skill that owns the routing checklist, or
  update a guideline only if the accepted change is DevCanon-local governance
  or policy. Create an agent only if a later classification identifies a
  qualifying role-wrapper justification.
- Non-goal: do not create a generic orchestration agent just because the
  checklist appears in more than one prompt.

### Deferred provider integration

A Linear pilot asks DevCanon to sync issue health, assignee, and cycle fields
into generated AFDS artifacts. The request may reflect a real integration need,
but no provider integration owner or provider-neutral contract exists yet.

Classification:

- Work origin: pilot finding plus provider integration request.
- Evidence owner: Linear issue and pilot notes.
- Decision: defer. Name the missing provider integration owner and require a
  provider-neutral contract before source/runtime support can be classified.
- Non-goal: do not encode Linear-specific live state in durable AFDS docs.

### Rejected consumer-local convention

A consumer repository asks DevCanon to add a new shared skill for its local
branch naming convention. The convention is useful in that repository but does
not describe a reusable AFDS workflow need.

Classification:

- Work origin: consumer-repo execution preference.
- Evidence owner: consumer repository issue.
- Decision: reject for DevCanon capability governance. Keep the convention in
  the consumer repository's own docs or automation.
- Non-goal: do not promote project-local policy into shared DevCanon workflow
  assets without a repeated provider-neutral AFDS need.

## Classification Result Shape

When recording a classification result in an issue, PR, design, or owner
artifact, include:

- decision outcome;
- work origin;
- current owner or proposed owner;
- evidence pointer;
- evidence state;
- repetition finding;
- owner-fit finding;
- affected provider context, if any, stated provider-neutrally first;
- why existing assets do or do not cover the need;
- agent-gate justification, if applicable;
- source/runtime proof, if applicable;
- explicit non-goals;
- revisit condition for deferrals;
- blocker wording when ownership or evidence is missing.

Use this compact template when a result needs to be recorded:

```md
Decision: <ordinary execution fast path | update existing asset | create guideline | create skill | create agent | add source/runtime support | defer | reject>
Work origin: <exact procedure-map row>
Owner: <current exact artifact/system | proposed exact artifact/system | unknown>
Evidence: <stable issue, PR, source, test, CI, audit, pilot, or design pointer>
Evidence state: <adequate | thin | inaccessible | incomplete>
Repetition: <multiple issues/repos | single authoritative accepted owner | single local/preference/chat | unknown>
Owner fit: <fits | would become misleading | no owner | unknown>
Provider context: <provider-neutral statement first; GitHub/Linear details only if relevant>
Existing coverage: <why existing assets do or do not cover the need>
Agent gate: <not applicable | tool/sandbox configuration | target configuration | reusable specialist | fails gate>
Source/runtime proof: <not applicable | accepted owner plus missing executable proof | source owner unclear>
Non-goals: <what this classification does not approve>
Revisit condition: <required only for deferrals>
Blocker: <required when ownership or evidence is missing>
```

Keep the result concise. Capability governance should reduce routing ambiguity,
not become a parallel project log.
