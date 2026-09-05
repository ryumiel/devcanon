---
name: play-skill-authoring
description: Explicit-invocation workflow for TDD-style skill authoring with subagent pressure scenarios for baseline testing and loophole closure. Use only when the user explicitly invokes `play-skill-authoring` or an owning workflow explicitly requires skill-authoring verification.
codex_sidecar:
  policy:
    allow_implicit_invocation: false
---

# Writing Skills

Source-immutability invocation and failure mechanics are owned by the adjacent
[source-immutability usage](references/source-immutability-usage.md); preserve
the RED/GREEN/REFACTOR pressure-test policy below.

## Invocation Policy

This workflow is explicit-invocation-only. Do not select it from ordinary
discussion, review-shaped text, possible behavior-change wording, or
implementation-adjacent language. Run it only when the user explicitly invokes
`play-skill-authoring` or when an owning workflow explicitly hands off to
`play-skill-authoring`.

## Overview

Skills are reusable guidance for techniques, patterns, tools, or reference
material. Skill authoring is Test-Driven Development applied to that reusable
guidance: observe a meaningful failure, make the smallest useful change, and
retest the behavior.

Personal skills live in each target's configured skills directory; shared
source skills belong in the repository `skills/` tree. Do not turn a one-off
story, a project-specific convention, or an objectively enforceable mechanical
rule into a general skill. Claude and Codex renders are derived outputs, not
editable source authority.

**Core principle:** If no agent failed without the skill or prior revision,
there is no demonstrated behavior gap for the skill to fix.

When dispatching pressure-scenario subagents, use `subagent-lifecycle` for the
controller-local lifecycle ledger, target lifecycle capability classification,
cleanup gate before spawns, target-honest cleanup outcomes, and slot-limit
recovery. Capture each pressure-scenario subagent's prompt, baseline/pass
result, observed rationalizations, and pressure conditions before closing or
superseding the session.

**REQUIRED BACKGROUND:** You MUST understand play-tdd before using this skill.
That skill defines the fundamental RED-GREEN-REFACTOR cycle. This skill adapts
TDD to process documentation.

## Pressure-Scenario Evaluator Contract

Every pressure-scenario evaluator is a response-only `assessor`,
balanced/medium and source-immutable, with zero handoffs. Use the scenario's
existing closed acceptance condition as a bounded evaluation; do not substitute
another role, capability, or effort. The controller retains the expected
disposition and acceptance condition outside the spawned scenario input. Never
include the expected answer, pass/fail criteria, or equivalent hints in that
input.

Before every D11 RED, GREEN, or REFACTOR capture, resolve and validate the
complete fresh-Codex tuple: `semantic_role: assessor`; `capability: balanced`;
full `model` resolved exactly from the Codex-bound rendered D11 binding;
independent `reasoning_effort: medium`; `source_authority: source-immutable`;
`external_authority: none`; and zero handoffs. Build a self-contained scenario
prompt naming the repository root, the exact skill/artifact paths the scenario
may read, scenario identifier, task and pressure conditions, allowed context,
response-only output boundary, and the closed input contract—while retaining
the expected disposition and acceptance condition only in the controller. Do
not derive model, effort, or scenario context from inherited conversation or an
ambient runtime. Require all tuple and prompt inputs, a balanced assessor role,
and a nonblank resolved model before capture. Before capture, choose
`<instance_ordinal>` as the next positive base-10 integer not already used by a
retained D11 lifecycle-ledger row. The ledger retains completed and superseded
rows, so do not reuse it. Resolve `task_name` as `d11_<instance_ordinal>` and
require it to be nonblank, match `^[a-z0-9_]+$`, and be absent from all retained
controller ledger task names. Keep phase, scenario, and retest identity in the
existing ledger dimensions, not in `task_name`.

Codex-bound route binding: `D11_MODEL` = `{{model-codex:balanced}}`. The binding
is the exact full Codex model; the independent effort remains `medium`. A
missing, blank, unresolved, or mismatched marker blocks before capture or
spawn. Do not search a source checkout, use an alias, or fall back to a nearby
or ambient model.

After validation and the existing capture, create exactly one fresh evaluator:

```text
# D11_MODEL is the Codex-bound balanced model
Codex.spawn_agent({
  task_name: d11_<instance_ordinal>,
  agent_type: "assessor",
  model: D11_MODEL,
  reasoning_effort: "medium",
  fork_turns: "none",
  message: D11_SCENARIO_PROMPT,
})
```

`fork_turns: "none"` is mandatory: evaluator evidence cannot inherit parent
history. A missing or mismatched tuple blocks creation. A native Codex rejection
reports the exact `model=<D11_MODEL> effort=medium` and stops the applicable
scenario as unavailable after required cleanup; it never enters the ordinary
fresh-scenario/retest path. Do not retry, select an alias, change effort,
escalate, or substitute a role.

Resolve `SKILL_PRESSURE_GUARD` to this installed skill bundle's
`scripts/source-immutability.sh` shim. For every RED baseline, GREEN
same-scenario check, and REFACTOR retest, keep this order exact:

Before the first guarded evaluator, run
`bash "$SKILL_PRESSURE_GUARD" --help` once for this enclosing pressure-test
flow.

1. capture before spawn and retain the returned baseline path in the
   controller;
2. spawn the already-defined pressure scenario and capture only the evaluator's
   raw terminal response and status;
3. verify before semantic validation or consumption;
4. validate and retain the raw response in controller memory;
5. cleanup the exact retained baseline; and
6. apply the retained scenario evidence only after cleanup.

Only a valid guarded response can prove RED or GREEN. Capture failure prevents
the spawn. After capture, every post-capture terminal path attempts exact
cleanup, including dispatch or spawn failure or unavailability before an
evaluator session exists, child failure, response rejection, verification
rejection, and semantic validation rejection. A failed, invalid, malformed, or
verification-rejected response, after safe cleanup, follows the existing
fresh-scenario/retest path and cannot count as baseline failure, compliance, or
retained rationalization evidence. Rerun the same pressure scenario with a
fresh evaluator under the applicable RED, GREEN, or REFACTOR retest step.

The fresh-scenario/retest rule is for an ordinary evaluator outcome after an
accepted creation attempt. It never converts a missing D11 tuple or native
model/effort rejection into a second creation attempt.

Detected source mutation or cleanup failure is guard-integrity terminal:
preserve the visible source state, stop the skill-authoring run, and never
repair the source to make the evidence appear acceptable. A source-mutation
verification failure never enters the ordinary fresh-scenario/retest path.

This evaluator route and guard do not change the pressure scenarios, scenario
options or pressures, RED baseline observation, GREEN same-scenario evidence,
rationalizations captured verbatim, REFACTOR loophole closure,
new-rationalization handling, or fresh-evaluator retest lifecycle.

## RED-GREEN-REFACTOR for Skills

Use one observable behavior gap as the test. For a new skill, evaluate the task
without the skill. For an edit, evaluate the prior revision or current behavior
before changing it.

### RED — Observe the Failure

Run a realistic scenario and record the agent's decision and relevant
rationalization. A valid RED demonstrates a meaningful failure in applying,
finding, or following reusable guidance. An academic paraphrase check or a test
that merely looks for preferred wording is not a RED.

If the baseline already behaves correctly, stop or narrow the proposed change;
do not manufacture a failure.

### GREEN — Make the Smallest Useful Change

Write only the guidance needed to address the observed failure. Re-run the same
scenario with the candidate skill and require the expected behavior, not an
exact sentence.

### REFACTOR — Close Observed Loopholes

If the agent finds a new rationalization or the candidate creates a navigation
gap, add the smallest direct correction and retest with a fresh evaluator. Do
not accumulate universal rules for hypothetical failures.

No new or edited skill is complete without a valid failing RED followed by
GREEN and any necessary REFACTOR retest.

## Common-Path Authoring Rules

- Use the repository's authoritative skill schema. In DevCanon,
  `docs/specs/skills.md` and `SkillSourceSchema` in `src/config/schema.ts` own
  frontmatter validation.
- Use a lowercase, hyphenated name. The description must say what the skill
  does, then name concrete triggers with `Use when…`, in third person and
  without encoding the procedure.
- Put the outcome, essential constraints, and common workflow in `SKILL.md`.
  Add supporting files only for reusable tools or substantial conditional
  guidance.
- Prefer one complete, realistic example over several shallow examples. Test
  observable behavior and meaningful invariants, not headings, sentence order,
  keyword counts, or whole-document prose.
- Match detail to risk. Automate objective mechanics when practical; keep
  judgment-bearing guidance in prose.
- Repository-owned schemas, workflows, and policies take precedence. External
  guidance can inform authoring choices, but it is not a substitute for the
  owning workflow or its lifecycle contract.

## Conditional Resources

Load only the resource whose condition applies, and read it directly rather
than through a catch-all or reference chain.

- When shaping discovery, structure, concision, progressive disclosure, or
  degrees of freedom, read `references/anthropic-best-practices.md`. If it is
  unavailable, do not invent or finalize branch-specific guidance; continue
  only with rules already owned by the repository.
- Before designing or running pressure scenarios, read
  `references/testing-skills-with-subagents.md`. This methodology is required
  for that branch, while this main skill remains the evaluator and lifecycle
  owner. If the reference is unavailable, stop before claiming RED, GREEN, or
  REFACTOR evidence.
- When an observed rationalization warrants research-backed persuasion
  framing, read `references/persuasion-principles.md`. It is optional; if
  unavailable, use only the direct counter supported by the observed evidence.
- When a worked campaign would materially clarify the task, read
  `examples/CLAUDE_MD_TESTING.md`. For a ready-made prompt, select only the
  applicable leaf: `examples/test-academic.md`,
  `examples/test-pressure-1.md`, `examples/test-pressure-2.md`, or
  `examples/test-pressure-3.md`. These examples are optional; if unavailable,
  continue from the eager contract without inventing their content.
- When a non-obvious decision diagram is justified, read
  `references/graphviz-conventions.dot` and render it with
  `scripts/render-graphs.js`. If either is unavailable, omit the diagram and
  use concise prose.

## Scenario Selection

Choose the smallest realistic scenario set that exercises the behavior at
risk:

| Skill kind           | Useful evaluation                                              |
| -------------------- | -------------------------------------------------------------- |
| Discipline-enforcing | A pressured decision where compliance has a real cost          |
| Technique            | Application to a new case, including a relevant edge condition |
| Pattern              | Recognition, application, and a meaningful counterexample      |
| Reference            | Retrieval and correct application of the needed fact           |

For discipline skills, combine pressures only when needed to expose the likely
rationalization. Give concrete constraints and require a decision or artifact.
Do not leak the controller-held expected answer into the scenario.

Capture rationalizations verbatim when they explain the failure. Add explicit
counters only for rationalizations actually observed; never turn one agent's
wording into a universal requirement.

## Completion Gate

Before moving to another skill, finish the current skill's complete cycle:

- confirm a valid RED and preserve the behavior it exposed;
- verify the candidate passes the matched GREEN scenario and any necessary
  REFACTOR retest;
- validate name, description, frontmatter, direct resource paths, and
  unavailable behavior;
- verify examples or scripts that changed;
- run the repository's skill validation and relevant tests; and
- complete only the handoff, installation, commit, push, or publication that
  the caller authorized.

Do not batch unfinished skills or infer permission for external mutation.

Skill authoring is TDD for reusable guidance: RED identifies the real gap,
GREEN teaches the smallest correction, and REFACTOR closes demonstrated
loopholes without turning the skill into a transcript of past failures.
